#!/usr/bin/env bun
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveDAutomation, resolveDIssueAutopilot } from "./d-config.ts";
import { runIssueAutopilot, issueAutopilotStatus, intakeBindingKey, canonicalGitHubRepository, type EngineAdapter, type OfficialDirective } from "./issue-autopilot.ts";
import { createFileAssumptionLedger, createFileClaimStore, createFileIntakeBindingStore, createGhIssueSource, issueAutopilotRuntimePaths } from "./issue-autopilot-runtime.ts";
import { resolveThroughBoundary, type HostSessionState } from "./host-session.ts";

type Json = Record<string, unknown>;
class OfficialCommandError extends Error {
  constructor(message: string, readonly retryClass: "transient" | "ambiguous" | "fatal") { super(message); }
}
const argv = process.argv.slice(2);
const value = (flag: string) => { const at = argv.indexOf(flag); return at < 0 ? undefined : argv[at + 1]; };
const projectDir = value("--project-dir");
if (!projectDir || !isAbsolute(projectDir)) throw new Error("--project-dir must be an absolute PRODUCT path");
const positional = argv.filter((item, index) => !item.startsWith("--") && (index === 0 || !argv[index - 1]?.startsWith("--")));
const command = positional[0] ?? "status";
const runtime = join(projectDir, ".claude", "tools");
const orchestrate = join(runtime, "aidlc-orchestrate.ts");
const utility = join(runtime, "aidlc-utility.ts");
const hostSessionFile = value("--session-file") ?? ".aidlc-engine/d-autopilot-session.json";
const hostSessionPath = resolve(projectDir, hostSessionFile);
if (relative(resolve(projectDir), hostSessionPath).startsWith("..")) throw new Error("session file escapes project");
type HostRecovery = { state: HostSessionState | null; lifecycleBusy: boolean; recoveredReason: string | null };
const recoverHostSession = (): HostRecovery => {
  if (!existsSync(hostSessionPath)) return { state: null, lifecycleBusy: false, recoveredReason: null };
  // This is deliberately an executable recovery boundary, not a JSON read.
  // status owns the lifecycle lock and atomically terminalizes stale workers,
  // releases their owner claim, and removes heartbeat debris before intake.
  const recovered = spawnSync(process.execPath, [join(import.meta.dir, "host-session-cli.ts"), "status", "--project-dir", projectDir, "--session-file", hostSessionFile], { cwd: projectDir, encoding: "utf8" });
  if (recovered.status !== 0) throw new Error((recovered.stderr || recovered.stdout || "host session recovery failed").trim());
  const parsed = JSON.parse(recovered.stdout) as { state?: HostSessionState | null; lifecycleBusy?: boolean; recoveredReason?: string | null };
  return { state: parsed.state ?? null, lifecycleBusy: parsed.lifecycleBusy ?? false, recoveredReason: parsed.recoveredReason ?? null };
};
const requireHostRecovery = (): HostRecovery => {
  try { return recoverHostSession(); }
  catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "session-recovery-failed", detail: String(error) }, null, 2)}\n`);
    process.exit(0);
  }
};

function runJson(executable: string, args: string[]): Json {
  const result = spawnSync(process.execPath, [executable, ...args, "--project-dir", projectDir], { cwd: projectDir, encoding: "utf8" });
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || result.error?.message || "official command failed").trim();
    const retryClass = result.status === 75 ? "transient"
      : /auth|permission|forbidden|unauthori[sz]ed|invalid|usage:/i.test(message) ? "fatal" : "ambiguous";
    throw new OfficialCommandError(message, retryClass);
  }
  try { return JSON.parse(result.stdout) as Json; } catch { return { kind: "print", message: result.stdout.trim() }; }
}

const configuredRepository = value("--repo");
let repository = "";
const intakeKey = (issueNumber: number) => intakeBindingKey({ provider: "github", repository }, issueNumber);

function issueIntentDetails(issueNumber: number): { state: "none" | "partial" | "active" | "unknown"; exactPartialDirs: string[] } {
  const spaces = join(projectDir, "aidlc", "spaces");
  if (!existsSync(spaces)) return { state: "none", exactPartialDirs: [] };
  const pending = [spaces];
  let partial = false;
  let activeFound = false;
  let unknown = false;
  const exactPartialDirs: string[] = [];
  let seen = 0;
  while (pending.length && seen++ < 4096) {
    const dir = pending.pop();
    if (!dir) break;
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { unknown = true; continue; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.name === "project-description.json") {
        try {
          const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
          const active = join(dir, "..", "active-intent");
          const routable = existsSync(join(dir, "aidlc-state.md")) && existsSync(active)
            && readFileSync(active, "utf8").trim() === basename(dir);
          const pendingValues: unknown[] = [value];
          while (pendingValues.length) {
            const candidate = pendingValues.pop();
            if (typeof candidate === "string") {
              const structured = /^AIDLC-INTAKE: (\{[^\n]+\})$/m.exec(candidate);
              if (structured) {
                try {
                  const binding = JSON.parse(structured[1]) as Record<string, unknown>;
                  if (binding.provider === "github" && binding.repository === repository && binding.issueNumber === issueNumber && binding.intakeKey === intakeKey(issueNumber)) {
                    if (routable) activeFound = true;
                    else { partial = true; exactPartialDirs.push(dir); }
                  }
                } catch { unknown = true; }
              }
              const match = /^Implement GitHub issue #(\d+):/m.exec(candidate);
              // Legacy descriptions had no repository identity. They are safe
              // to migrate only for this product's implicit current repo.
              if (!configuredRepository && match && Number(match[1]) === issueNumber) {
                if (routable) activeFound = true;
                partial = true;
              }
            } else if (Array.isArray(candidate)) pendingValues.push(...candidate);
            else if (candidate && typeof candidate === "object") pendingValues.push(...Object.values(candidate));
          }
        } catch { unknown = true; }
      }
    }
  }
  if (pending.length) unknown = true;
  return { state: unknown ? "unknown" : activeFound ? "active" : partial ? "partial" : "none", exactPartialDirs: [...new Set(exactPartialDirs)] };
}

const issueIntentState = (issueNumber: number) => issueIntentDetails(issueNumber).state;

class OfficialEngine implements EngineAdapter {
  async createIntent(args: readonly ["--new-intent", "--scope", string, "--label", string, string]): Promise<OfficialDirective> {
    const description = args[5];
    runJson(utility, ["intent-create", "--scope", args[2], "--label", args[4], "--arguments", description]);
    return runJson(orchestrate, ["next"]) as OfficialDirective;
  }
  async next() { return runJson(orchestrate, ["next"]) as OfficialDirective; }
  async execute(directive: Readonly<OfficialDirective>) { return { ...directive, kind: "official-host-action-required" }; }
  classifyCreateError(error: unknown) { return error instanceof OfficialCommandError ? error.retryClass : "ambiguous" as const; }
  async reconcileIntent(issueNumber: number) { return issueIntentState(issueNumber) === "active" ? this.next() : null; }
  async confirmIntentAbsent(issueNumber: number) { return issueIntentState(issueNumber) === "none"; }
}

const auto = resolveDAutomation(projectDir), autopilot = resolveDIssueAutopilot(projectDir);
const policy = JSON.parse(readFileSync(join(import.meta.dir, "stage-policy.json"), "utf8")) as { stages: Array<{ stage: string }> };
const activeStages = (value("--active-stages")?.split(",").filter(Boolean) ?? policy.stages.map((entry) => entry.stage));
// Phase resolution needs the actual active scope graph. Defer it to host init
// unless the host supplied that list on this invocation.
const through = value("--active-stages") ? resolveThroughBoundary(auto.through, activeStages) : auto.through;
const config = { enabled: auto.enabled && autopilot.enabled, labelAllowlist: auto.labelAllowlist, uncertaintyPolicy: auto.assumptionLedger ? auto.ambiguityPolicy : "halt" as const, through: through ?? undefined, sessionAuto: !auto.sessionOnly, maxRetries: auto.maxRetries, maxSteps: auto.maxSteps, deadlineMs: auto.deadlineMs };
if (command === "status") {
  const recovery = requireHostRecovery();
  process.stdout.write(`${JSON.stringify({ ...issueAutopilotStatus(config), activeSession: recovery.state?.endedAt ? null : recovery.state, sessionRecoveryBusy: recovery.lifecycleBusy }, null, 2)}\n`); process.exit(0);
}
if (!config.enabled && command !== "stop" && command !== "repair") { process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "disabled" })}\n`); process.exit(0); }
const paths = issueAutopilotRuntimePaths(projectDir);
if (command === "stop") {
  writeFileSync(paths.stop, "stop\n", { mode: 0o600 });
  // Recovery consumes the stop while holding the lifecycle lock, persists the
  // terminal session, and releases only its bound owner claim.
  const recovery = requireHostRecovery();
  const terminal = !recovery.state || recovery.state.endedAt && recovery.state.terminalReason === "operator-stop";
  if (recovery.lifecycleBusy || !terminal) {
    process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "stop-pending", stopFile: paths.stop })}\n`); process.exit(0);
  }
  if (existsSync(paths.stop)) unlinkSync(paths.stop);
  process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "operator-stop", stopFile: paths.stop })}\n`); process.exit(0);
}

// A new slash invocation has a new pid, but an active durable session already
// owns the Issue claim. Resume it before intake instead of contending under a
// freshly-generated owner and reporting claim-busy.
const recovery = requireHostRecovery();
if (existsSync(paths.stop)) {
  const terminal = !recovery.state || recovery.state.endedAt && recovery.state.terminalReason === "operator-stop";
  if (recovery.lifecycleBusy || !terminal) { process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "stop-pending" })}\n`); process.exit(0); }
  unlinkSync(paths.stop); process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "operator-stop" })}\n`); process.exit(0);
}
if (recovery.lifecycleBusy) { process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "session-recovery-busy" })}\n`); process.exit(0); }
const existingSession = recovery.state?.endedAt ? null : recovery.state;
if (existingSession?.claim) {
  const actionActive = Boolean(existingSession.hostAction) || existsSync(`${hostSessionPath}.heartbeat.json`);
  const resumed = {
    status: "stopped", reason: actionActive ? "host-action-busy" : "session-resume",
    issueNumber: existingSession.claim.issueNumber,
    hostControl: { through: existingSession.through, maxSteps: existingSession.maxSteps, deadlineMs: existingSession.deadlineMs, claim: existingSession.claim },
    ...(actionActive ? {} : { directive: runJson(orchestrate, ["next"]) }),
  };
  process.stdout.write(`${JSON.stringify(resumed, null, 2)}\n`); process.exit(0);
}

const origin = configuredRepository ? null : spawnSync("git", ["config", "--get", "remote.origin.url"], { cwd: projectDir, encoding: "utf8" });
repository = canonicalGitHubRepository(configuredRepository ?? (origin?.status === 0 ? origin.stdout.trim() : ""));
const bindings = createFileIntakeBindingStore(paths.bindings);

if (command === "repair") {
  const repairIssue = Number(value("--issue-number"));
  if (!Number.isSafeInteger(repairIssue) || repairIssue <= 0) throw new Error("repair requires --issue-number");
  const details = issueIntentDetails(repairIssue);
  const partialRepair = argv.includes("--partial");
  if (partialRepair && details.state === "partial" && details.exactPartialDirs.length === 1) {
    const owner = value("--owner") ?? `repair-${process.pid}`, key = intakeKey(repairIssue);
    const binding = { provider: "github", repository, issueNumber: repairIssue, intakeKey: key };
    await bindings.reserve(binding, "migration-partial");
    const repairLock = join(paths.bindings, `partial-repair-${key}.lock`);
    try { mkdirSync(repairLock); } catch { process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "repair-busy", issueNumber: repairIssue })}\n`); process.exit(0); }
    const claims = createFileClaimStore({ directory: paths.claims, leaseMs: 60_000 });
    if (await claims.acquire(repairIssue, owner) !== "acquired") { rmSync(repairLock, { recursive: true, force: true }); process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "repair-busy", issueNumber: repairIssue })}\n`); process.exit(0); }
    let quarantined = "";
    let repairError: unknown;
    try {
      const verified = issueIntentDetails(repairIssue);
      if (verified.state !== "partial" || verified.exactPartialDirs.length !== 1) throw new Error("partial intent changed during repair");
      const source = verified.exactPartialDirs[0], spaces = realpathSync(join(projectDir, "aidlc", "spaces")), actual = realpathSync(source);
      if (lstatSync(source).isSymbolicLink() || !lstatSync(source).isDirectory() || !actual.startsWith(`${spaces}/`)) throw new Error("unsafe partial intent path");
      const quarantineParent = join(paths.bindings, "quarantine"); mkdirSync(quarantineParent, { recursive: true, mode: 0o700 });
      quarantined = join(quarantineParent, `${key}-${Date.now()}-${basename(source)}`);
      renameSync(source, quarantined);
      writeFileSync(join(quarantined, "partial-repair-audit.json"), `${JSON.stringify({ repairedAt: Date.now(), repairedBy: owner, reason: value("--reason") ?? "operator-requested partial quarantine", binding, originalPath: relative(projectDir, source) })}\n`, { mode: 0o600, flag: "wx" });
      if (!bindings.repair) throw new Error("intake binding repair is unavailable");
      const repaired = await bindings.repair(binding, owner, value("--reason") ?? "operator-requested partial quarantine");
      if (repaired !== "repaired") throw new Error(`binding repair failed: ${repaired}`);
    } catch (error) {
      repairError = error;
      if (quarantined && existsSync(quarantined)) {
        try { unlinkSync(join(quarantined, "partial-repair-audit.json")); } catch {}
        const original = details.exactPartialDirs[0]; if (!existsSync(original)) renameSync(quarantined, original);
      }
    } finally { await claims.release(repairIssue, owner); rmSync(repairLock, { recursive: true, force: true }); }
    process.stdout.write(`${JSON.stringify(repairError
      ? { status: "stopped", reason: "repair-refused", issueNumber: repairIssue, detail: String(repairError) }
      : { status: "stopped", reason: "partial-quarantined", issueNumber: repairIssue, archive: quarantined })}\n`); process.exit(0);
  }
  if (details.state !== "none") {
    process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "repair-refused", issueNumber: repairIssue, detail: "official active or partial intent state still exists" })}\n`); process.exit(0);
  }
  if (!bindings.repair) throw new Error("intake binding repair is unavailable");
  const repaired = await bindings.repair({ provider: "github", repository, issueNumber: repairIssue, intakeKey: intakeKey(repairIssue) }, value("--owner") ?? `repair-${process.pid}`, value("--reason") ?? "operator-confirmed official absence");
  process.stdout.write(`${JSON.stringify({ status: "stopped", reason: `binding-${repaired}`, issueNumber: repairIssue })}\n`); process.exit(0);
}

const issueNumber = /^\d+$/.test(command) ? Number(command) : undefined;
const requiredLabel = issueNumber || command === "list" ? undefined : command;
const effective = requiredLabel ? { ...config, labelAllowlist: [...config.labelAllowlist, requiredLabel] } : config;
const issues = createGhIssueSource({ cwd: projectDir, repository, executable: value("--gh-executable") });
if (command === "list") { process.stdout.write(`${JSON.stringify({ status: "selection-required", issues: await issues.list() }, null, 2)}\n`); process.exit(0); }
const explicitState = issueNumber ? issueIntentState(issueNumber) : "none";
if (issueNumber && explicitState === "unknown") {
  process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "reconcile-required", issueNumber, detail: "official intent state scan is incomplete or unreadable" })}\n`); process.exit(0);
}
if (issueNumber && explicitState === "partial") {
  await bindings.reserve({ provider: "github", repository, issueNumber, intakeKey: intakeKey(issueNumber) }, "migration-partial");
}
const result = await runIssueAutopilot({
  config: effective,
  selection: issueNumber ? { issueNumber } : { candidatesFromList: async (choices) => choices.filter((item) => effective.labelAllowlist.every((label) => item.labels.includes(label)) && issueIntentState(item.number) === "none").map((item) => item.number) },
  owner: value("--owner") ?? `pid-${process.pid}`,
  scope: value("--scope") ?? "feature",
  binding: { provider: "github", repository },
  deps: {
    issues,
    // A successful auto intake transfers this lease to host-session-cli.  Keep
    // it valid for the whole bounded host deadline, including approval pauses.
    claims: createFileClaimStore({ directory: paths.claims, leaseMs: config.deadlineMs }),
    bindings,
    assumptions: createFileAssumptionLedger(paths.assumptions),
    assessor: { async assess(issue, mode) { const unresolved = issue.title.trim() && issue.body.trim() ? [] : ["Issue title and body are required"]; return { unresolved, description: issue.body, assumptions: mode === "assume" && unresolved.length ? unresolved : [], researchedFacts: [] }; } },
    engine: new OfficialEngine(),
  },
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
