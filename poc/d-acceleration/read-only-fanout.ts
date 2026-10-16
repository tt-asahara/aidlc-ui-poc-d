#!/usr/bin/env bun
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";
import policy from "./stage-policy.json";
import { runWorker, type WorkerLaunch } from "./worker-adapters.ts";
import { validateDirective } from "../../core/tools/aidlc-directive.ts";

export type ResearchTask = { id: string; agent: string; objective: string; evidencePaths: string[] };
type PolicyTier = "fast" | "balanced" | "judgment";
type PolicyEffort = "low" | "medium" | "high";
export type FanoutInput = { directive: any; tasks: ResearchTask[]; modelCatalog: Partial<Record<PolicyTier, string>>; maxParallel?: number };
export type FanoutOptions = { projectDir: string; frameworkDir: string; engineDir?: string; claudeExecutable?: string; timeoutMs?: number };

const OFFICIAL_TOPOLOGIES = new Set(["mob", "subagent", "pipeline"]);
const SAFE_TOOLS = "Read,Grep,Glob";
const MAX_PARALLEL = 4;
const REQUIRED_CLAUDE_FLAGS = ["--print", "--output-format", "--no-session-persistence", "--restricted", "--strict-mcp-config", "--mcp-config", "--disable-slash-commands", "--permission-mode", "--permission-prompts", "--tools", "--allowed-tools", "--disallowed-tools", "--agents", "--agent", "--model", "--effort"];

export function validateClaudeReadOnlyCapabilities(help: string): void {
  const missing = REQUIRED_CLAUDE_FLAGS.filter((flag) => !help.includes(flag));
  if (missing.length) throw new Error(`Claude CLI cannot enforce read-only fanout; missing: ${missing.join(", ")}`);
}

function inside(root: string, path: string): string {
  const realRoot = realpathSync(root); const absolute = realpathSync(resolve(realRoot, path)); const rel = relative(realRoot, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`evidence path escapes project: ${path}`);
  return absolute;
}

function persona(frameworkDir: string, agent: string): string {
  if (!/^aidlc-[a-z-]+-agent$/.test(agent)) throw new Error(`invalid official agent: ${agent}`);
  const path = join(frameworkDir, "agents", `${agent}.md`);
  if (!existsSync(path)) throw new Error(`official agent projection is missing: ${agent}`);
  return readFileSync(path, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

export function planReadOnlyFanout(input: FanoutInput, options: FanoutOptions) {
  if (!isAbsolute(options.projectDir) || !existsSync(options.projectDir)) throw new Error("projectDir must be an existing absolute path");
  const directive = input.directive?.directive ?? input.directive;
  const validation = validateDirective(directive);
  if (!validation.valid) return { action: "official-host-action-required", reason: "invalid-official-directive", errors: validation.errors, directive, launches: [] };
  if (directive.kind !== "run-stage" || directive.gate !== false) return { action: "official-host-action-required", reason: "not-an-active-run-stage", directive, launches: [] };
  if (OFFICIAL_TOPOLOGIES.has(directive.mode)) return { action: "official-host-action-required", reason: `official-${directive.mode}-contract`, directive, launches: [] };
  if (directive.mode !== "inline") return { action: "official-host-action-required", reason: "read-only-fanout-requires-inline-stage", directive, launches: [] };
  const stage = policy.stages.find((entry) => entry.stage === directive.stage);
  if (!stage || stage.status !== "implemented-read-only-fanout" || stage.parallelism !== "read-only-fanout") return { action: "official-host-action-required", reason: "stage-policy-does-not-enable-read-only-fanout", directive, launches: [] };
  if (!Array.isArray(input.tasks) || input.tasks.length < 2) throw new Error("read-only fanout requires at least two independent tasks");
  const tier = stage.tier as PolicyTier; const effort = stage.effort as PolicyEffort;
  const model = input.modelCatalog?.[tier];
  if (!model?.trim()) throw new Error(`a runtime-confirmed ${tier} model ID is required`);
  const maxParallel = input.maxParallel ?? 3;
  if (!Number.isFinite(maxParallel) || !Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > MAX_PARALLEL) throw new Error(`maxParallel must be an integer from 1 through ${MAX_PARALLEL}`);
  const ids = new Set<string>();
  const launches = input.tasks.map((task) => {
    if (!task.id || ids.has(task.id) || !task.objective.trim() || !task.evidencePaths.length) throw new Error(`invalid or duplicate research task: ${task.id}`); ids.add(task.id);
    const paths = task.evidencePaths.map((path) => inside(options.projectDir, path));
    const agents = JSON.stringify({ [task.agent]: { description: `Official AI-DLC read-only specialist for ${directive.stage}`, prompt: persona(options.frameworkDir, task.agent), tools: ["Read", "Grep", "Glob"] } });
    const prompt = [`Active official stage: ${directive.stage}.`, `Read-only subtask: ${task.objective}`, `Evidence paths: ${paths.join(", ")}`, "Return findings, evidence paths, uncertainty, and recommendations in your response. Do not create or edit files. The lead alone decides what to adopt and writes official artifacts."].join("\n");
    const launch: WorkerLaunch = { kind: "claude", executable: options.claudeExecutable ?? "claude", requestedModel: model, requestedEffort: effort, args: ["--print", "--output-format", "json", "--no-session-persistence", "--restricted", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands", "--permission-mode", "dontAsk", "--permission-prompts", "none", "--tools", SAFE_TOOLS, "--allowed-tools", SAFE_TOOLS, "--disallowed-tools", "Bash,Edit,Write,NotebookEdit,Agent,Task,WebFetch,WebSearch", "--agents", agents, "--agent", task.agent, "--model", model, "--effort", effort, prompt] };
    return { id: task.id, agent: task.agent, evidencePaths: paths, launch };
  });
  return { action: "unverified-read-only-fanout-plan", stage: directive.stage, directive, maxParallel: Math.min(maxParallel, launches.length), launches, verifiedAgainstFreshNext: false, routing: { tier, effort, requestedModel: model, source: "stage-policy" } };
}

export function verifyFreshDirective(caller: any, freshValue: any): { valid: true; directive: any } | { valid: false; reason: string; directive: any } {
  const fresh = freshValue?.directive ?? freshValue;
  const validation = validateDirective(fresh);
  if (!validation.valid) return { valid: false, reason: "fresh-next-invalid", directive: fresh };
  if (fresh.kind !== "run-stage" || fresh.gate !== false || fresh.mode !== "inline") return { valid: false, reason: "fresh-next-is-not-active-inline-stage", directive: fresh };
  const identityFields = ["stage", "phase", "mode", "memory_path", "stage_file"];
  if (identityFields.some((field) => caller[field] !== fresh[field])) return { valid: false, reason: "fresh-next-does-not-match-caller-stage-record", directive: fresh };
  return { valid: true, directive: fresh };
}

export async function runReadOnlyFanout(input: FanoutInput, options: FanoutOptions) {
  const planned = planReadOnlyFanout(input, options);
  if (planned.action !== "unverified-read-only-fanout-plan") return planned;
  const orchestrate = join(options.engineDir ?? join(options.frameworkDir, "tools"), "aidlc-orchestrate.ts");
  const next = spawnSync(process.execPath, [orchestrate, "next", "--project-dir", options.projectDir], { cwd: options.projectDir, encoding: "utf8", timeout: options.timeoutMs ?? 30_000 });
  if (next.status !== 0) return { action: "official-host-action-required", reason: "fresh-next-failed", stderr: next.stderr, launches: [] };
  let fresh: any;
  try { fresh = JSON.parse(next.stdout); } catch { return { action: "official-host-action-required", reason: "fresh-next-invalid-json", launches: [] }; }
  const verification = verifyFreshDirective(planned.directive, fresh);
  if (!verification.valid) return { action: "official-host-action-required", reason: verification.reason, directive: verification.directive, launches: [] };
  const executable = options.claudeExecutable ?? "claude";
  const help = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 5_000 });
  if (help.status !== 0) throw new Error(`Claude CLI capability preflight failed: ${help.stderr || help.stdout}`);
  validateClaudeReadOnlyCapabilities(help.stdout);
  const results: any[] = [];
  for (let offset = 0; offset < planned.launches.length; offset += planned.maxParallel) {
    const batch = planned.launches.slice(offset, offset + planned.maxParallel);
    const settled = await Promise.allSettled(batch.map(async (item) => ({ id: item.id, agent: item.agent, result: await runWorker(item.launch, { projectDir: options.projectDir, timeoutMs: options.timeoutMs ?? 120_000, maxStdoutBytes: 256_000, maxStderrBytes: 64_000 }) })));
    results.push(...settled.map((item, index) => item.status === "fulfilled" ? item.value : { id: batch[index]!.id, agent: batch[index]!.agent, result: { ok: false, failure: "process-error", stderr: String(item.reason) } }));
  }
  return { action: "lead-integration-required", stage: planned.stage, directive: verification.directive, results, routing: planned.routing, verifiedAgainstFreshNext: true, policy: { workerWrites: false, leadIsOnlyArtifactWriter: true, officialStageTransition: false } };
}

if (import.meta.main) {
  const args = process.argv.slice(2); const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const inputPath = value("--input"); const projectDir = value("--project-dir"); const frameworkDir = value("--framework-dir");
  if (!inputPath || !projectDir || !frameworkDir) throw new Error("--input, --project-dir, and --framework-dir are required");
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const result = args.includes("--dry-run") ? planReadOnlyFanout(input, { projectDir, frameworkDir }) : await runReadOnlyFanout(input, { projectDir, frameworkDir });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.action === "official-host-action-required") process.exitCode = 2;
}
