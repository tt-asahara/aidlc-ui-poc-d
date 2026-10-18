#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveDAutomation, resolveDConstructionDefaults, resolveDParallel } from "./d-config.ts";

type Json = Record<string, unknown>;
const argv = process.argv.slice(2);
const value = (flag: string) => { const at = argv.indexOf(flag); return at < 0 ? undefined : argv[at + 1]; };
const command = argv[0];
const projectDir = value("--project-dir");
if (!projectDir || !isAbsolute(projectDir)) throw new Error("--project-dir must be an absolute PRODUCT path");
const product = realpathSync(projectDir);
const sessionFile = value("--session-file") ?? ".aidlc-engine/d-autopilot-session.json";
const runtime = join(product, ".claude", "tools");
const hostCli = join(import.meta.dir, "host-session-cli.ts");

function runJson(executable: string, args: string[]): Json {
  const result = spawnSync(process.execPath, [executable, ...args, "--project-dir", product], { cwd: product, encoding: "utf8", env: { ...process.env, AIDLC_UNATTENDED: "1" } });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || result.error?.message || "command failed").trim());
  try { return JSON.parse(result.stdout) as Json; }
  catch { throw new Error("command did not return a JSON directive"); }
}

function activeSpace(): string {
  const pointer = join(product, "aidlc", "active-space");
  const space = existsSync(pointer) ? readFileSync(pointer, "utf8").trim() : "default";
  if (!/^[A-Za-z0-9._-]+$/.test(space)) throw new Error("official active space pointer is invalid");
  return space;
}

function activeStagesFromOfficialState(space: string): string[] {
  const pointer = join(product, "aidlc", "spaces", space, "intents", "active-intent");
  if (!existsSync(pointer)) throw new Error("official active Intent pointer is missing after intent-create");
  const intent = readFileSync(pointer, "utf8").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(intent)) throw new Error("official active Intent pointer is invalid");
  const state = join(product, "aidlc", "spaces", space, "intents", intent, "aidlc-state.md");
  const stages = readFileSync(state, "utf8").split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^- \[(?: |-|\?|R|x)\] ([a-z0-9-]+) — EXECUTE$/);
    return match ? [match[1]] : [];
  });
  if (!stages.length) throw new Error("official active Intent has no executable stages");
  return stages;
}

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const intentsRoot = (space: string) => join(product, "aidlc", "spaces", space, "intents");

/** Every Intent record in the space (a folder holding aidlc-state.md), the pre-start inventory. */
function intentInventory(space: string): string[] {
  const root = intentsRoot(space);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => SAFE_NAME.test(name) && existsSync(join(root, name, "aidlc-state.md"))).sort();
}

/**
 * The earliest WORKFLOW_STARTED Timestamp in the Intent's official audit
 * shards (read-only). Upstream `intent create` writes that row into the
 * record it creates, so it is the recorded creation time.
 */
function workflowStartedAt(space: string, intent: string): number | null {
  const audit = join(intentsRoot(space), intent, "audit");
  if (!existsSync(audit) || lstatSync(audit).isSymbolicLink()) return null;
  let earliest: number | null = null;
  for (const name of readdirSync(audit).filter((entry) => entry.endsWith(".md"))) {
    const path = join(audit, name);
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) continue;
    for (const block of readFileSync(path, "utf8").replace(/\r\n/g, "\n").split("\n---\n")) {
      if (!/^\*\*Event\*\*:\s*WORKFLOW_STARTED\s*$/m.test(block)) continue;
      const at = Date.parse(block.match(/^\*\*Timestamp\*\*:\s*(\S+)\s*$/m)?.[1] ?? "");
      if (Number.isFinite(at) && (earliest === null || at < earliest)) earliest = at;
    }
  }
  return earliest;
}

/**
 * Bootstrap binds only to an Intent proven created after `start` from
 * recorded facts: absent from the inventory `start` recorded, and its own
 * WORKFLOW_STARTED row is at or after `startedAt` (audit Timestamps carry
 * whole seconds, so `startedAt` is compared floored to its second). A
 * switched-to or resumed Intent fails both and is never given D's
 * Construction defaults. Returns the refusal line, or null.
 */
function notCreatedSinceStart(start: Json, space: string, intent: string): string | null {
  const preIntents = start.preIntents;
  const startedAt = Date.parse(String(start.startedAt ?? ""));
  if (start.version !== 2 || !Array.isArray(preIntents) || !Number.isFinite(startedAt)) return "the generic auto start journal predates the Intent inventory: run generic auto start again, then follow its official print";
  const created = workflowStartedAt(space, intent);
  if (preIntents.includes(intent) || created === null || created < Math.floor(startedAt / 1000) * 1000) {
    return `active Intent ${intent} was not created after generic auto start (it existed before start or has no later WORKFLOW_STARTED), so D will not change its Construction policy: switch back to the Intent the official print created, or run start again for new work`;
  }
  return null;
}

function saveJson(path: string, value: unknown): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("bootstrap journal must not be a symlink");
  const parent = join(path, "..");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (relative(product, realpathSync(parent)).startsWith("..")) throw new Error("bootstrap journal parent must stay inside PRODUCT");
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

function confinedRegularFile(input: string): string {
  const requested = resolve(product, input);
  if (relative(product, requested).startsWith("..") || !existsSync(requested)) throw new Error("description file must exist inside PRODUCT");
  const metadata = lstatSync(requested);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("description file must be a regular non-symlink file");
  const actual = realpathSync(requested);
  if (relative(product, actual).startsWith("..")) throw new Error("description file resolves outside PRODUCT");
  if (metadata.size > 262_144) throw new Error("description file exceeds 262144 bytes");
  return actual;
}

const auto = resolveDAutomation(product);
const constructionDefaults = resolveDConstructionDefaults(product);
const parallel = resolveDParallel(product);
// A request file named by the skill's handoff contract is controller-owned:
// the controller removes it once read, so the host needs no separate `rm`
// (which Claude Code cannot pre-approve safely). Any other caller-supplied
// project file is read but never deleted.
const START_JOURNAL = join(product, ".aidlc-engine", "d-auto-start.json");
const REQUEST_HANDOFF = /^\.aidlc-engine\/d-auto-request-[A-Za-z0-9_-]{1,64}\.txt$/;
if (command === "start") {
  const descriptionFile = value("--description-file");
  if (!descriptionFile) throw new Error("start requires --description-file");
  const path = confinedRegularFile(descriptionFile);
  const description = readFileSync(path, "utf8");
  if (REQUEST_HANDOFF.test(relative(product, path).split("\\").join("/"))) unlinkSync(path);
  if (!auto.enabled) { process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "disabled" })}\n`); process.exit(0); }
  if (auto.sessionOnly) { process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "session-only" })}\n`); process.exit(0); }
  if (!description.trim()) throw new Error("description must not be empty");
  // Remember which Intent was active before official routing so `bootstrap`
  // can bind to the Intent the official print's intent-create makes. D never
  // runs that creation itself: the host follows the official print exactly.
  const space = activeSpace();
  const pointer = join(product, "aidlc", "spaces", space, "intents", "active-intent");
  saveJson(START_JOURNAL, { version: 2, space, preActive: existsSync(pointer) ? readFileSync(pointer, "utf8").trim() : null, preIntents: intentInventory(space), descriptionSha256: createHash("sha256").update(description).digest("hex"), startedAt: new Date().toISOString() });
  // The user's text is one argv value, never shell source. The official router
  // owns scope selection and intent creation; --auto is deliberately absent.
  const directive = runJson(join(runtime, "aidlc-orchestrate.ts"), ["next", description]);
  process.stdout.write(`${JSON.stringify({
    status: "routed", reason: directive.kind === "ask" ? "human-gate" : "official-routing",
    directive,
    hostControl: { through: auto.through ?? null, maxSteps: auto.maxSteps, deadlineMs: auto.deadlineMs },
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === "init") {
  if (!auto.enabled) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "disabled" })}\n`); process.exit(0); }
  if (auto.sessionOnly) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "session-only" })}\n`); process.exit(0); }
  const activeStages = value("--active-stages");
  if (!activeStages) throw new Error("init requires --active-stages from the official active scope graph");
  const result = runJson(hostCli, ["init", "--session-file", sessionFile, "--active-stages", activeStages, ...(auto.through ? ["--through", auto.through] : []), "--deadline-ms", String(auto.deadlineMs), "--max-steps", String(auto.maxSteps)]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

// The first directive after official intent creation is the point at which the
// active scope graph is authoritative. Chain session validation/creation and
// the first checkpoint in one command so the host has no stage action between
// them. The host-session owner still provides crash recovery for each write.
if (command === "resume") {
  if (!auto.enabled) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "disabled" })}\n`); process.exit(0); }
  if (auto.sessionOnly) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "session-only" })}\n`); process.exit(0); }
  const activeStages = value("--active-stages");
  const directiveFile = value("--directive-file");
  if (!activeStages) throw new Error("resume requires --active-stages from the official active scope graph");
  if (!directiveFile) throw new Error("resume requires --directive-file");
  const sessionPath = resolve(product, sessionFile);
  if (relative(product, sessionPath).startsWith("..")) throw new Error("session file must stay inside PRODUCT");
  const initialized = !existsSync(sessionPath);
  const init = runJson(hostCli, ["init", "--session-file", sessionFile, "--active-stages", activeStages, ...(auto.through ? ["--through", auto.through] : []), "--deadline-ms", String(auto.deadlineMs), "--max-steps", String(auto.maxSteps)]);
  if (init.action === "stop") { process.stdout.write(`${JSON.stringify({ ...init, initialized }, null, 2)}\n`); process.exit(0); }
  const result = runJson(hostCli, ["checkpoint", "--session-file", sessionFile, "--directive-file", directiveFile]);
  process.stdout.write(`${JSON.stringify({ ...result, initialized }, null, 2)}\n`);
  process.exit(0);
}

if (command === "bootstrap") {
  if (!auto.enabled) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "disabled" })}\n`); process.exit(0); }
  if (auto.sessionOnly) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "session-only" })}\n`); process.exit(0); }
  // core/ is upstream AI-DLC: the official print names its intent-create
  // command in prose only. The host runs that command exactly as the ordinary
  // print rule says; bootstrap then binds to the Intent it created.
  if (value("--directive-file")) throw new Error("bootstrap takes no directive: run the official print's intent-create command exactly as given, then run bootstrap");
  if (!existsSync(START_JOURNAL) || lstatSync(START_JOURNAL).isSymbolicLink()) throw new Error("bootstrap requires a generic auto start in this project");
  const start = JSON.parse(readFileSync(START_JOURNAL, "utf8")) as Json;
  const digest = createHash("sha256").update(JSON.stringify(start)).digest("hex");
  const journalPath = join(product, ".aidlc-engine", "d-auto-bootstrap.json");
  const space = activeSpace();
  if (start.space !== space) throw new Error("active space changed since generic auto start");
  const pointer = join(product, "aidlc", "spaces", space, "intents", "active-intent");
  let journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, "utf8")) as Json : null;
  if (journal && journal.digest !== digest) {
    const status = runJson(hostCli, ["status", "--session-file", sessionFile]);
    if (status.active) throw new Error("another generic auto session is still active in this project");
    renameSync(journalPath, `${journalPath}.completed-${Date.now()}`);
    journal = null;
  }
  if (journal?.phase === "initialized") {
    const status = runJson(hostCli, ["status", "--session-file", sessionFile]);
    process.stdout.write(`${JSON.stringify({ action: status.active ? "continue" : "stop", reason: "already-bootstrapped", initialized: false, state: status.state ?? null }, null, 2)}\n`);
    process.exit(0);
  }
  if (!journal) { journal = { version: 2, digest, preActive: start.preActive ?? null, phase: "pending-create", parallel }; saveJson(journalPath, journal); }
  if (journal.phase === "pending-create") {
    const activeNow = existsSync(pointer) ? readFileSync(pointer, "utf8").trim() : null;
    const created = activeNow && SAFE_NAME.test(activeNow) && activeNow !== journal.preActive && existsSync(join(intentsRoot(space), activeNow, "aidlc-state.md"));
    if (!created) throw new Error("no new official Intent since generic auto start: run the official print's intent-create command exactly as given, then run bootstrap");
    const refusal = notCreatedSinceStart(start, space, activeNow);
    if (refusal) throw new Error(refusal);
    journal = { ...journal, phase: "created", intent: activeNow };
    saveJson(journalPath, journal);
  }
  if (readFileSync(pointer, "utf8").trim() !== journal.intent) throw new Error("active Intent changed during generic auto bootstrap");
  const activeStages = activeStagesFromOfficialState(space);
  if (journal.phase === "created") {
    const supportsConstructionPolicy = activeStages.includes("units-generation") && activeStages.includes("code-generation");
    if (supportsConstructionPolicy && constructionDefaults.iteration === "stage-major") {
      runJson(join(runtime, "aidlc-state.ts"), ["set-construction-iteration", "stage-major"]);
    }
    if (supportsConstructionPolicy && constructionDefaults.execution === "swarm") {
      if (constructionDefaults.iteration !== "stage-major") throw new Error("D swarm default requires constructionDefaults.iteration=stage-major");
      runJson(join(runtime, "aidlc-state.ts"), ["set-construction-execution", "swarm"]);
    }
    journal = { ...journal, phase: "policy-applied", constructionPolicy: supportsConstructionPolicy ? constructionDefaults : { skipped: "unsupported-scope" } };
    saveJson(journalPath, journal);
  }
  const first = runJson(join(runtime, "aidlc-orchestrate.ts"), ["next"]);
  const firstPath = join(product, ".aidlc-engine", `d-auto-first-directive-${process.pid}-${Date.now()}.json`);
  writeFileSync(firstPath, `${JSON.stringify(first)}\n`, { mode: 0o600, flag: "wx" });
  let init: Json;
  let checkpoint: Json | undefined;
  try {
    init = runJson(hostCli, ["init", "--session-file", sessionFile, "--active-stages", activeStages.join(","), ...(auto.through ? ["--through", auto.through] : []), "--deadline-ms", String(auto.deadlineMs), "--max-steps", String(auto.maxSteps)]);
    if (init.action !== "stop") checkpoint = runJson(hostCli, ["checkpoint", "--session-file", sessionFile, "--directive-file", firstPath]);
  } finally {
    try { unlinkSync(firstPath); } catch { /* best effort for a project-confined temporary */ }
  }
  if (init.action === "stop") { process.stdout.write(`${JSON.stringify({ ...init, activeStages }, null, 2)}\n`); process.exit(0); }
  if (!checkpoint) throw new Error("first checkpoint did not return a result");
  journal = { ...journal, phase: "initialized" }; saveJson(journalPath, journal);
  process.stdout.write(`${JSON.stringify({ ...checkpoint, initialized: true, activeStages, directive: first }, null, 2)}\n`);
  process.exit(0);
}

if (["status", "stop", "checkpoint", "action-start", "action-finish", "rescope"].includes(command)) {
  const forwarded: string[] = [command, "--session-file", sessionFile];
  for (const flag of ["--directive-file", "--action-token", "--active-stages", "--through"]) { const supplied = value(flag); if (supplied) forwarded.push(flag, supplied); }
  process.stdout.write(`${JSON.stringify(runJson(hostCli, forwarded), null, 2)}\n`);
  process.exit(0);
}

throw new Error("mode must be start, init, bootstrap, resume, status, stop, checkpoint, action-start, action-finish, or rescope");
