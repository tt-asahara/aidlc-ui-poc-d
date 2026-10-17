#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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

const CREATE_VALUE_FLAGS = new Set(["--scope", "--request", "--depth", "--test-strategy", "--project-type", "--review", "--guard-policy", "--sensors", "--learnings", "--summary-confirmation", "--plan-approval", "--collaborators", "--skip", "--add", "--plan-name"]);
function validateCreateArgv(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.every((entry) => typeof entry === "string")) throw new Error("typed intent-create argv must be strings");
  const argv = raw as string[];
  if (argv[0] !== "intent" || argv[1] !== "create") throw new Error("invalid typed intent-create argv");
  const seen = new Set<string>();
  for (let index = 2; index < argv.length; index += 2) {
    const flag = argv[index], supplied = argv[index + 1];
    if (!CREATE_VALUE_FLAGS.has(flag) || supplied === undefined || supplied.includes("\0") || seen.has(flag)) throw new Error("invalid typed intent-create argv");
    seen.add(flag);
  }
  if (!seen.has("--scope") || !seen.has("--request")) throw new Error("typed intent-create argv must bind scope and request");
  return argv;
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
  const directiveFile = value("--directive-file");
  if (!directiveFile) throw new Error("bootstrap requires --directive-file");
  const directivePath = confinedRegularFile(directiveFile);
  const directive = JSON.parse(readFileSync(directivePath, "utf8")) as Json;
  const action = directive.machine_action as Json | undefined;
  if (directive.kind !== "print" || action?.kind !== "intent-create") {
    throw new Error("bootstrap requires an official typed intent-create directive");
  }
  const argv = validateCreateArgv(action.argv);
  const digest = createHash("sha256").update(JSON.stringify({ kind: directive.kind, machine_action: action })).digest("hex");
  const journalPath = join(product, ".aidlc-engine", "d-auto-bootstrap.json");
  const space = activeSpace();
  const pointer = join(product, "aidlc", "spaces", space, "intents", "active-intent");
  const preActive = existsSync(pointer) ? readFileSync(pointer, "utf8").trim() : null;
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
  if (!journal) { journal = { version: 1, digest, request: argv[argv.indexOf("--request") + 1], preActive, phase: "pending-create", parallel }; saveJson(journalPath, journal); }
  const activeNow = existsSync(pointer) ? readFileSync(pointer, "utf8").trim() : null;
  if (journal.phase !== "created") {
    const candidateState = activeNow ? join(product, "aidlc", "spaces", space, "intents", activeNow, "aidlc-state.md") : "";
    const recovered = activeNow && activeNow !== journal.preActive && existsSync(candidateState) && readFileSync(candidateState, "utf8").includes(`- **Question Id**: ${journal.request}`);
    if (!recovered) {
      const created = spawnSync(process.execPath, [join(runtime, "aidlc.ts"), "engine", ...argv, "--project-dir", product], { cwd: product, encoding: "utf8", env: { ...process.env, AIDLC_UNATTENDED: "1" } });
      if (created.status !== 0) throw new Error((created.stderr || created.stdout || created.error?.message || "intent-create failed").trim());
    }
    const createdIntent = readFileSync(pointer, "utf8").trim();
    journal = { ...journal, phase: "created", intent: createdIntent };
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

if (["status", "stop", "checkpoint", "action-start", "action-finish"].includes(command)) {
  const forwarded: string[] = [command, "--session-file", sessionFile];
  for (const flag of ["--directive-file", "--action-token"]) { const supplied = value(flag); if (supplied) forwarded.push(flag, supplied); }
  process.stdout.write(`${JSON.stringify(runJson(hostCli, forwarded), null, 2)}\n`);
  process.exit(0);
}

throw new Error("mode must be start, init, bootstrap, resume, status, stop, checkpoint, action-start, or action-finish");
