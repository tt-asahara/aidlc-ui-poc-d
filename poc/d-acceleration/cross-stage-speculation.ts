#!/usr/bin/env bun
// Read-only speculative cross-stage analysis (issue #5 / #6, bounded scope).
//
// While official stage U waits at its human gate (`orchestrate next` emits
// `present-gate`), independent read-only analysis tasks for a later stage S may
// run and leave D-private draft notes. Nothing here writes an official
// artifact, workflow state, audit entry, approval, or review receipt, and
// nothing here calls anything other than `orchestrate next`. A draft is
// consumable only after a fresh official `run-stage` directive for S exists and
// every `requires_stage` upstream of S is settled; the official stage still
// produces its own artifact and treats the draft as evidence input only.
// See cross-stage-speculation.md for the design and what remains out of scope.
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import policy from "./stage-policy.json";
import { resolveDParallel } from "./d-config.ts";
import { DirectiveFingerprintMismatchError, loadResumeLedger, recordUnitSuccess } from "./resume-ledger.ts";
import { runWorker, type WorkerLaunch } from "./worker-adapters.ts";
import { validateDirective } from "../../core/tools/aidlc-directive.ts";
import { parseCheckboxes, parseStageFrontmatter } from "../../core/tools/aidlc-lib.ts";

export const SPECULATION_SCHEMA = "d-cross-stage-speculation/1" as const;
const TASK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_INPUT_BYTES = 196_608;
const MAX_TOTAL_INPUT_BYTES = 524_288;
const MAX_PARALLEL = 4;
const SETTLED = new Set(["completed", "skipped"]);

type PolicyTier = "fast" | "balanced" | "judgment";
export type SpeculativeTask = { id: string; targetStage: string; agent: string; objective: string; inputs: string[] };
export type SpeculationInput = { tasks: SpeculativeTask[]; modelCatalog?: Partial<Record<PolicyTier, string>>; maxParallel?: number };
export type MerkleLeaf = { role: "agent" | "input" | "memory" | "stage-file" | "task"; path: string; sha256: string };
export type PreparedTask = { task: SpeculativeTask; leaves: MerkleLeaf[]; merkleRoot: string; prompt: string; tier: PolicyTier; effort: string; requestedModel: string | null; inputBytes: Array<{ path: string; text: string }> };
export type TaskOutput = { ok: boolean; output: string; requestedModel: string | null; runtimeReportedModel: string | null; failure?: string | null };
export type TaskRunner = (prepared: PreparedTask) => Promise<TaskOutput>;
export type SpeculationOptions = { projectDir: string; frameworkDir: string; engineDir?: string; claudeExecutable?: string; timeoutMs?: number; runTask?: TaskRunner; now?: () => number };
export type Interval = { taskId: string; mode: "speculative" | "serial-fallback"; startedAt: number; endedAt: number };

// ---------------------------------------------------------------- hashing ---

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const leafHash = (leaf: MerkleLeaf) => sha256(`aidlc-d-spec-leaf\0${leaf.role}\0${leaf.path}\0${leaf.sha256}`);

/** Domain-separated binary Merkle root over leaves sorted by (role, path); an odd node is promoted unchanged. */
export function merkleRoot(leaves: readonly MerkleLeaf[]): string {
  if (!leaves.length) throw new Error("Merkle root requires at least one leaf");
  const sorted = [...leaves].sort((a, b) => (a.role + "\0" + a.path).localeCompare(b.role + "\0" + b.path));
  for (let index = 1; index < sorted.length; index += 1) if (sorted[index - 1]!.role === sorted[index]!.role && sorted[index - 1]!.path === sorted[index]!.path) throw new Error(`duplicate Merkle leaf ${sorted[index]!.role}:${sorted[index]!.path}`);
  let level = sorted.map(leafHash);
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) next.push(index + 1 < level.length ? sha256(`aidlc-d-spec-node\0${level[index]}${level[index + 1]}`) : level[index]!);
    level = next;
  }
  return level[0]!;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => (value as any)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson((value as any)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

// ------------------------------------------------------------ project view ---

const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); };
const posix = (path: string) => path.split(sep).join("/");

function projectFile(root: string, path: string, label: string): { rel: string; absolute: string; bytes: Buffer } {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new Error(`${label} must be a project-relative path: ${path}`);
  const candidate = resolve(root, path);
  if (!existsSync(candidate) || lstatSync(candidate).isSymbolicLink() || !lstatSync(candidate).isFile()) throw new Error(`${label} is missing, a symlink, or not a regular file: ${path}`);
  const absolute = realpathSync(candidate);
  if (!inside(root, absolute)) throw new Error(`${label} escapes the project: ${path}`);
  const bytes = readFileSync(absolute);
  if (bytes.length > MAX_INPUT_BYTES) throw new Error(`${label} exceeds ${MAX_INPUT_BYTES} bytes: ${path}`);
  return { rel: posix(relative(root, absolute)), absolute, bytes };
}

export type OfficialSnapshot = { directive: any; space: string; intentDir: string; intentRel: string; stages: Map<string, string> };

function readNext(projectDir: string, engineDir: string, timeoutMs: number): any {
  const next = spawnSync(process.execPath, [join(engineDir, "aidlc-orchestrate.ts"), "next", "--project-dir", projectDir], { cwd: projectDir, encoding: "utf8", timeout: timeoutMs });
  if (next.status !== 0) throw new Error(`fresh official next failed: ${(next.stderr || next.stdout).trim()}`);
  let value: any;
  try { value = JSON.parse(next.stdout); } catch { throw new Error("fresh official next was not JSON"); }
  const directive = value?.directive ?? value;
  const validation = validateDirective(directive);
  if (!validation.valid) throw new Error(`fresh official next is invalid: ${validation.errors.join("; ")}`);
  return directive;
}

/** One fresh `orchestrate next` plus the active Intent's Stage Progress. Read-only. */
export function readOfficialSnapshot(options: SpeculationOptions): OfficialSnapshot {
  const root = realpathSync(options.projectDir);
  const directive = readNext(root, options.engineDir ?? join(options.frameworkDir, "tools"), options.timeoutMs ?? 30_000);
  const spacePointer = join(root, "aidlc", "active-space");
  const space = existsSync(spacePointer) ? readFileSync(spacePointer, "utf8").trim() : "default";
  if (!/^[A-Za-z0-9._-]+$/.test(space)) throw new Error("active space is invalid");
  const intents = join(root, "aidlc", "spaces", space, "intents");
  const intent = readFileSync(join(intents, "active-intent"), "utf8").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(intent)) throw new Error("active Intent is invalid");
  const intentDir = realpathSync(join(intents, intent));
  if (!inside(root, intentDir)) throw new Error("active Intent escapes project");
  const stages = new Map(parseCheckboxes(readFileSync(join(intentDir, "aidlc-state.md"), "utf8")).map((entry) => [entry.slug, entry.state as string]));
  return { directive, space, intentDir, intentRel: posix(relative(root, intentDir)), stages };
}

function policyStage(stage: string) { return policy.stages.find((entry) => entry.stage === stage); }
function stageFilePath(frameworkDir: string, stage: string): string {
  const entry = policyStage(stage);
  if (!entry) throw new Error(`unknown official stage: ${stage}`);
  return join(frameworkDir, "aidlc-common", "stages", entry.phase, `${stage}.md`);
}
function requiresStage(frameworkDir: string, stage: string): string[] {
  const value = parseStageFrontmatter(readFileSync(stageFilePath(frameworkDir, stage), "utf8")).requires_stage;
  return Array.isArray(value) ? value.map(String) : [];
}
function recordDir(snapshot: OfficialSnapshot, stage: string): string {
  return join(snapshot.intentDir, policyStage(stage)!.phase, stage);
}

// ------------------------------------------------------------ admission ----

export type Classification = { taskId: string; eligible: true } | { taskId: string; eligible: false; reason: string; detail?: string };

/** Deterministic admission. Only a task whose every input is already settled may run while the gate is open. */
export function classifyTask(task: SpeculativeTask, snapshot: OfficialSnapshot, options: SpeculationOptions): Classification {
  const no = (reason: string, detail?: string): Classification => ({ taskId: task.id, eligible: false, reason, ...(detail ? { detail } : {}) });
  if (!TASK_ID.test(task.id)) return no("invalid-task-id");
  if (snapshot.directive.kind !== "present-gate") return no("no-open-human-gate", snapshot.directive.kind);
  const gateStage = snapshot.directive.stage as string;
  if (snapshot.stages.get(gateStage) !== "awaiting-approval") return no("gate-state-disagrees-with-directive", gateStage);
  const target = policyStage(task.targetStage);
  if (!target || target.status !== "implemented-read-only-fanout" || target.parallelism !== "read-only-fanout") return no("target-stage-not-speculation-eligible", task.targetStage);
  if (task.targetStage === gateStage) return no("target-is-gated-stage");
  if (snapshot.stages.get(task.targetStage) !== "pending") return no("target-stage-not-pending", snapshot.stages.get(task.targetStage) ?? "absent-from-plan");
  const unsettledUpstream = requiresStage(options.frameworkDir, task.targetStage).filter((stage) => stage !== gateStage && snapshot.stages.has(stage) && !SETTLED.has(snapshot.stages.get(stage)!));
  if (unsettledUpstream.length) return no("upstream-not-settled", unsettledUpstream.join(","));
  if (!Array.isArray(task.inputs) || !task.inputs.length || !task.objective?.trim()) return no("task-requires-objective-and-inputs");
  const root = realpathSync(options.projectDir);
  const settledDirs = [...snapshot.stages].filter(([stage, state]) => SETTLED.has(state) && policyStage(stage)).map(([stage]) => recordDir(snapshot, stage));
  for (const input of task.inputs) {
    let absolute: string;
    try { absolute = projectFile(root, input, "speculative input").absolute; } catch (error) { return no("input-unreadable", error instanceof Error ? error.message : String(error)); }
    if (inside(join(root, "aidlc", ".aidlc-engine"), absolute)) return no("input-is-engine-private", input);
    if (inside(snapshot.intentDir, absolute)) {
      if (inside(recordDir(snapshot, gateStage), absolute)) return no("dependent-on-gated-stage", input);
      if (!settledDirs.some((dir) => inside(dir, absolute))) return no("input-not-in-settled-stage-record", input);
    } else if (inside(join(root, "aidlc"), absolute)) return no("input-is-workflow-state", input);
  }
  return { taskId: task.id, eligible: true };
}

// ------------------------------------------------------------- preparation --

function memoryLeaves(root: string, space: string): MerkleLeaf[] {
  const base = join(root, "aidlc", "spaces", space, "memory");
  if (!existsSync(base)) return [{ role: "memory", path: posix(relative(root, base)), sha256: "absent" }];
  const leaves: MerkleLeaf[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), stat = lstatSync(path);
      if (stat.isSymbolicLink()) leaves.push({ role: "memory", path: posix(relative(root, path)), sha256: "symlink-refused" });
      else if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) leaves.push({ role: "memory", path: posix(relative(root, path)), sha256: sha256(readFileSync(path)) });
    }
  };
  walk(base);
  return leaves.length ? leaves : [{ role: "memory", path: posix(relative(root, base)), sha256: "empty" }];
}

function persona(frameworkDir: string, agent: string): { text: string; sha: string; path: string } {
  if (!/^aidlc-[a-z-]+-agent$/.test(agent)) throw new Error(`invalid official agent: ${agent}`);
  const path = join(frameworkDir, "agents", `${agent}.md`);
  if (!existsSync(path)) throw new Error(`official agent projection is missing: ${agent}`);
  const bytes = readFileSync(path);
  return { text: bytes.toString("utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""), sha: sha256(bytes), path: `agents/${agent}.md` };
}

/** Binds a task to the immutable Merkle root over its inputs, the target stage file, the agent persona, memory, and the task contract. */
export function prepareTask(task: SpeculativeTask, snapshot: Pick<OfficialSnapshot, "space">, options: SpeculationOptions, modelCatalog: SpeculationInput["modelCatalog"] = {}): PreparedTask {
  const root = realpathSync(options.projectDir);
  const entry = policyStage(task.targetStage);
  if (!entry) throw new Error(`unknown official stage: ${task.targetStage}`);
  const tier = entry.tier as PolicyTier, effort = entry.effort;
  const requestedModel = modelCatalog?.[tier]?.trim() || null;
  const inputs = task.inputs.map((path) => projectFile(root, path, "speculative input"));
  if (inputs.reduce((sum, item) => sum + item.bytes.length, 0) > MAX_TOTAL_INPUT_BYTES) throw new Error(`speculative inputs exceed ${MAX_TOTAL_INPUT_BYTES} bytes`);
  const stageBytes = readFileSync(stageFilePath(options.frameworkDir, task.targetStage));
  const agent = persona(options.frameworkDir, task.agent);
  const contract = { schema: SPECULATION_SCHEMA, id: task.id, targetStage: task.targetStage, agent: task.agent, objective: task.objective, inputs: inputs.map((item) => item.rel), tier, effort, requestedModel };
  const leaves: MerkleLeaf[] = [
    ...inputs.map((item) => ({ role: "input" as const, path: item.rel, sha256: sha256(item.bytes) })),
    { role: "stage-file", path: `aidlc-common/stages/${entry.phase}/${task.targetStage}.md`, sha256: sha256(stageBytes) },
    { role: "agent", path: agent.path, sha256: agent.sha },
    ...memoryLeaves(root, snapshot.space),
    { role: "task", path: `task/${task.id}`, sha256: sha256(canonicalJson(contract)) },
  ];
  const inputBytes = inputs.map((item) => ({ path: item.rel, text: item.bytes.toString("utf8") }));
  const prompt = [
    agent.text.trim(),
    "",
    `You are doing D-private, read-only pre-research for the later official AI-DLC stage "${task.targetStage}". That stage has NOT started; an earlier stage is waiting for a human decision.`,
    "Your notes are draft evidence only. They are not an official artifact, not an approval, and not a decision. Do not ask the person anything.",
    `Objective: ${task.objective}`,
    "Use only the inputs below. Report findings, open questions, risks, and the input path each finding comes from.",
    ...inputBytes.flatMap((item) => [`=== ${item.path} ===`, item.text]),
  ].join("\n");
  return { task, leaves, merkleRoot: merkleRoot(leaves), prompt, tier, effort, requestedModel, inputBytes };
}

/** No-tool Claude launch: the worker sees exactly the hashed inputs and can neither read nor write anything else. */
export function speculativeClaudeLaunch(prepared: PreparedTask, executable = "claude"): WorkerLaunch {
  if (!prepared.requestedModel) throw new Error(`a caller-supplied ${prepared.tier} model request is required`);
  return {
    kind: "claude", executable, requestedModel: prepared.requestedModel, requestedEffort: prepared.effort,
    args: ["--print", "--output-format", "json", "--no-session-persistence", "--restricted", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands", "--permission-mode", "dontAsk", "--permission-prompts", "none", "--tools", "", "--allowed-tools", "", "--disallowed-tools", "Bash,Edit,Write,NotebookEdit,Agent,Task,WebFetch,WebSearch,Read,Grep,Glob", "--model", prepared.requestedModel, "--effort", prepared.effort, prepared.prompt],
  };
}

function defaultRunner(options: SpeculationOptions): TaskRunner {
  return async (prepared) => {
    const result = await runWorker(speculativeClaudeLaunch(prepared, options.claudeExecutable), { projectDir: options.projectDir, timeoutMs: options.timeoutMs ?? 120_000, maxStdoutBytes: 256_000, maxStderrBytes: 64_000 });
    let output = result.stdout;
    try { const parsed = JSON.parse(result.stdout); if (typeof parsed?.result === "string") output = parsed.result; } catch { /* keep raw */ }
    return { ok: result.ok, output, requestedModel: result.requestedModel, runtimeReportedModel: result.runtimeReportedModel, failure: result.failure };
  };
}

// ----------------------------------------------------------- D-private store

export function speculationDir(projectDir: string, snapshot: Pick<OfficialSnapshot, "space" | "intentDir">, targetStage: string): string {
  const root = realpathSync(projectDir);
  return join(root, "aidlc", ".aidlc-engine", "d-speculation", snapshot.space, relative(join(root, "aidlc", "spaces", snapshot.space, "intents"), snapshot.intentDir), targetStage);
}
const ledgerPath = (dir: string, id: string) => join(dir, `${id}.ledger.json`);
const draftPath = (dir: string, id: string) => join(dir, `${id}.draft.json`);
const ledgerDirective = (snapshot: Pick<OfficialSnapshot, "intentRel">, prepared: PreparedTask) => ({ schema: SPECULATION_SCHEMA, intent: snapshot.intentRel, targetStage: prepared.task.targetStage, task: prepared.task.id, merkleRoot: prepared.merkleRoot });

function atomicWrite(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
}
function discard(dir: string, id: string): void { for (const path of [ledgerPath(dir, id), draftPath(dir, id)]) if (existsSync(path)) unlinkSync(path); }

type DraftCheck = { state: "valid"; draft: any; draftSha256: string } | { state: "absent" } | { state: "invalid"; reason: string };
function checkDraft(dir: string, snapshot: Pick<OfficialSnapshot, "intentRel">, prepared: PreparedTask): DraftCheck {
  const path = ledgerPath(dir, prepared.task.id);
  if (!existsSync(path)) return { state: "absent" };
  let ledger;
  try { ledger = loadResumeLedger(path, ledgerDirective(snapshot, prepared)); }
  catch (error) { return { state: "invalid", reason: error instanceof DirectiveFingerprintMismatchError ? "input-merkle-mismatch" : "ledger-unreadable" }; }
  const completion = ledger.succeeded[prepared.task.id];
  if (!completion) return { state: "absent" };
  const draftFile = draftPath(dir, prepared.task.id);
  if (!existsSync(draftFile)) return { state: "invalid", reason: "draft-missing" };
  const bytes = readFileSync(draftFile), digest = sha256(bytes);
  if ((completion.result as any)?.draftSha256 !== digest) return { state: "invalid", reason: "draft-hash-mismatch" };
  const draft = JSON.parse(bytes.toString("utf8"));
  if (draft.merkleRoot !== prepared.merkleRoot) return { state: "invalid", reason: "input-merkle-mismatch" };
  return { state: "valid", draft, draftSha256: digest };
}

// --------------------------------------------------------------- speculate --

/**
 * Runs eligible speculative tasks while the official gate is open. `parallel.enabled`
 * is snapshotted once at entry; OFF does no work at all (not even `next`).
 */
export async function runSpeculation(input: SpeculationInput, options: SpeculationOptions) {
  if (!isAbsolute(options.projectDir) || !existsSync(options.projectDir)) throw new Error("projectDir must be an existing absolute path");
  const parallelEnabled = resolveDParallel(options.projectDir).enabled;
  if (!parallelEnabled) return { action: "speculation-disabled", reason: "parallel.enabled=false", parallelEnabled, launched: [], intervals: [] as Interval[] };
  const maxParallel = input.maxParallel ?? 3;
  if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > MAX_PARALLEL) throw new Error(`maxParallel must be an integer from 1 through ${MAX_PARALLEL}`);
  const now = options.now ?? Date.now;
  const runTask = options.runTask ?? defaultRunner(options);
  const snapshot = readOfficialSnapshot(options);
  if (snapshot.directive.kind !== "present-gate") return { action: "no-speculation", reason: "no-open-human-gate", directiveKind: snapshot.directive.kind, parallelEnabled, launched: [], intervals: [] as Interval[] };
  const gateStage = snapshot.directive.stage as string;
  const ids = new Set<string>();
  for (const task of input.tasks ?? []) { if (ids.has(task.id)) throw new Error(`duplicate speculative task: ${task.id}`); ids.add(task.id); }
  const classifications = (input.tasks ?? []).map((task) => classifyTask(task, snapshot, options));
  const deferred = classifications.filter((item) => !item.eligible);
  const reused: any[] = [], discarded: any[] = [], pending: Array<{ prepared: PreparedTask; dir: string }> = [];
  for (const task of input.tasks ?? []) {
    if (!classifications.find((item) => item.taskId === task.id)!.eligible) continue;
    const prepared = prepareTask(task, snapshot, options, input.modelCatalog);
    const dir = speculationDir(options.projectDir, snapshot, task.targetStage);
    const check = checkDraft(dir, snapshot, prepared);
    if (check.state === "valid") { reused.push({ taskId: task.id, merkleRoot: prepared.merkleRoot }); continue; }
    if (check.state === "invalid") { discard(dir, task.id); discarded.push({ taskId: task.id, reason: check.reason }); }
    else if (existsSync(draftPath(dir, task.id))) { discard(dir, task.id); discarded.push({ taskId: task.id, reason: "orphan-draft-without-ledger" }); }
    pending.push({ prepared, dir });
  }
  const intervals: Interval[] = [], completed: any[] = [], failed: any[] = [];
  for (let offset = 0; offset < pending.length; offset += maxParallel) {
    const batch = pending.slice(offset, offset + maxParallel);
    await Promise.all(batch.map(async ({ prepared, dir }) => {
      const startedAt = now();
      let output: TaskOutput;
      try { output = await runTask(prepared); } catch (error) { output = { ok: false, output: "", requestedModel: prepared.requestedModel, runtimeReportedModel: null, failure: error instanceof Error ? error.message : String(error) }; }
      const endedAt = now();
      intervals.push({ taskId: prepared.task.id, mode: "speculative", startedAt, endedAt });
      if (!output.ok) { failed.push({ taskId: prepared.task.id, failure: output.failure ?? "worker-failed" }); return; }
      // Pre-land revalidation: inputs must still hash to the launch root.
      let landed: PreparedTask;
      try { landed = prepareTask(prepared.task, snapshot, options, input.modelCatalog); } catch (error) { discarded.push({ taskId: prepared.task.id, reason: "inputs-unreadable-at-land" }); return; }
      if (landed.merkleRoot !== prepared.merkleRoot) { discarded.push({ taskId: prepared.task.id, reason: "input-merkle-mismatch-at-land" }); return; }
      const draft = { schema: SPECULATION_SCHEMA, kind: "d-speculative-draft", authority: "none: D-private evidence input for the official stage; not an artifact, approval, or decision", intent: snapshot.intentRel, gateStageAtLaunch: gateStage, targetStage: prepared.task.targetStage, taskId: prepared.task.id, agent: prepared.task.agent, objective: prepared.task.objective, merkleRoot: prepared.merkleRoot, leaves: prepared.leaves, routing: { tier: prepared.tier, effort: prepared.effort, requestedModel: output.requestedModel, runtimeReportedModel: output.runtimeReportedModel }, startedAt, endedAt, notes: output.output };
      const body = `${JSON.stringify(draft, null, 2)}\n`;
      atomicWrite(draftPath(dir, prepared.task.id), body);
      recordUnitSuccess(ledgerPath(dir, prepared.task.id), ledgerDirective(snapshot, prepared), prepared.task.id, { draftSha256: sha256(body), merkleRoot: prepared.merkleRoot });
      completed.push({ taskId: prepared.task.id, merkleRoot: prepared.merkleRoot });
    }));
  }
  return { action: "speculation-recorded", gateStage, parallelEnabled, maxParallel, launched: pending.map((item) => item.prepared.task.id), completed, reused, discarded, failed, deferred, intervals, policy: { officialArtifactWritten: false, stateWritten: false, gateBypassed: false, engineCommands: ["next"] } };
}

// ----------------------------------------------------------------- consume --

/**
 * Hands valid drafts to the official stage only after a fresh `run-stage` for that
 * stage exists and every upstream is settled. Mismatched drafts are discarded and
 * their tasks fall back to stable serial execution.
 */
export function consumeSpeculativeDrafts(input: SpeculationInput & { targetStage: string }, options: SpeculationOptions) {
  const snapshot = readOfficialSnapshot(options);
  const directive = snapshot.directive;
  if (directive.kind !== "run-stage" || directive.stage !== input.targetStage) return { action: "not-consumable", reason: "no-fresh-official-run-stage-for-target", directiveKind: directive.kind, directiveStage: directive.stage ?? null, drafts: [] };
  const unsettled = requiresStage(options.frameworkDir, input.targetStage).filter((stage) => snapshot.stages.has(stage) && !SETTLED.has(snapshot.stages.get(stage)!));
  if (unsettled.length) return { action: "not-consumable", reason: "upstream-not-settled", unsettled, drafts: [] };
  const tasks = (input.tasks ?? []).filter((task) => task.targetStage === input.targetStage);
  const parallelEnabled = resolveDParallel(options.projectDir).enabled;
  const drafts: any[] = [], discarded: any[] = [], serialFallback: string[] = [];
  for (const task of tasks) {
    if (!parallelEnabled) { serialFallback.push(task.id); continue; }
    const dir = speculationDir(options.projectDir, snapshot, task.targetStage);
    let prepared: PreparedTask;
    try { prepared = prepareTask(task, snapshot, options, input.modelCatalog); } catch { discard(dir, task.id); discarded.push({ taskId: task.id, reason: "inputs-unreadable" }); serialFallback.push(task.id); continue; }
    const check = checkDraft(dir, snapshot, prepared);
    if (check.state === "valid") drafts.push({ taskId: task.id, path: posix(relative(realpathSync(options.projectDir), draftPath(dir, task.id))), draftSha256: check.draftSha256, merkleRoot: prepared.merkleRoot, notes: check.draft.notes });
    else { if (check.state === "invalid") { discard(dir, task.id); discarded.push({ taskId: task.id, reason: check.reason }); } serialFallback.push(task.id); }
  }
  return { action: "lead-integration-required", stage: input.targetStage, directive, parallelEnabled, drafts, discarded, serialFallback, policy: { draftIsEvidenceInputOnly: true, officialStageWritesItsOwnArtifact: true, officialArtifactWritten: false } };
}

/** Stable serial fallback: runs tasks one at a time, only inside the fresh official run-stage for the target. */
export async function runSerialFallback(input: SpeculationInput & { targetStage: string; taskIds: string[] }, options: SpeculationOptions) {
  const snapshot = readOfficialSnapshot(options);
  if (snapshot.directive.kind !== "run-stage" || snapshot.directive.stage !== input.targetStage) return { action: "not-runnable", reason: "no-fresh-official-run-stage-for-target", results: [], intervals: [] as Interval[] };
  const now = options.now ?? Date.now, runTask = options.runTask ?? defaultRunner(options);
  const results: any[] = [], intervals: Interval[] = [];
  for (const id of input.taskIds) {
    const task = input.tasks.find((candidate) => candidate.id === id && candidate.targetStage === input.targetStage);
    if (!task) throw new Error(`unknown serial fallback task: ${id}`);
    const prepared = prepareTask(task, snapshot, options, input.modelCatalog);
    const startedAt = now();
    let output: TaskOutput;
    try { output = await runTask(prepared); } catch (error) { output = { ok: false, output: "", requestedModel: prepared.requestedModel, runtimeReportedModel: null, failure: String(error) }; }
    intervals.push({ taskId: id, mode: "serial-fallback", startedAt, endedAt: now() });
    results.push({ taskId: id, ok: output.ok, notes: output.output, merkleRoot: prepared.merkleRoot, routing: { requestedModel: output.requestedModel, runtimeReportedModel: output.runtimeReportedModel } });
  }
  return { action: "lead-integration-required", stage: input.targetStage, results, intervals, policy: { draftIsEvidenceInputOnly: true, officialArtifactWritten: false } };
}

/** Maximum number of intervals open at once (end is exclusive). */
export function maxConcurrency(intervals: readonly Pick<Interval, "startedAt" | "endedAt">[]): number {
  const events = intervals.flatMap((item) => [[item.startedAt, 1], [item.endedAt, -1]] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0, peak = 0;
  for (const [, delta] of events) { open += delta; peak = Math.max(peak, open); }
  return peak;
}

if (import.meta.main) {
  const args = process.argv.slice(2), value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const command = args[0], inputPath = value("--input"), projectDir = value("--project-dir"), frameworkDir = value("--framework-dir");
  if (!["speculate", "consume"].includes(command ?? "") || !inputPath || !projectDir || !frameworkDir) {
    process.stderr.write("usage: cross-stage-speculation.ts speculate|consume --input PLAN.json --project-dir ABS --framework-dir DIR [--engine-dir DIR] [--target-stage STAGE] [--model-fast|--model-balanced|--model-judgment ID]\n");
    process.exit(2);
  }
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as SpeculationInput;
  input.modelCatalog = { ...input.modelCatalog, ...(value("--model-fast") ? { fast: value("--model-fast") } : {}), ...(value("--model-balanced") ? { balanced: value("--model-balanced") } : {}), ...(value("--model-judgment") ? { judgment: value("--model-judgment") } : {}) };
  const options = { projectDir, frameworkDir, engineDir: value("--engine-dir") };
  const result = command === "speculate" ? await runSpeculation(input, options) : consumeSpeculativeDrafts({ ...input, targetStage: value("--target-stage") ?? "" }, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
