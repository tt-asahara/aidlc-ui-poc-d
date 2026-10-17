// Generic-auto lifecycle on a clean installed target, driven through the
// INSTALLED runtime and official engine (no source-tree imports at run time):
// wait at scope selection, bootstrap once, crash replay without a duplicate
// Intent, lock contention, injected heartbeat failure, bounded stops, operator
// stop, and restart. The test plays the person only through the official
// UserPromptSubmit hook, exactly as Claude Code would record a typed reply.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { install } from "../fresh-install.ts";

const SRC = resolve(import.meta.dir, "..", "..", "..");
const TIMEOUT = 600_000;
let product = "";
const tools = () => join(product, ".claude", "tools");
const bunJson = (script: string, args: string[], env: Record<string, string> = {}) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: product, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: product, ...env } });
  if (result.status !== 0) throw new Error(`${script} ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout) as Record<string, any>;
};
const bunJsonOrText = (script: string, args: string[]) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: product, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: product } });
  if (result.status !== 0) throw new Error(`${script} ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return result.stdout;
};
const auto = (...args: string[]) => bunJson(join(tools(), "d-acceleration", "generic-auto-cli.ts"), [...args, "--project-dir", product]);
const hook = (name: string, payload: object) => {
  const result = spawnSync(process.execPath, [join(tools(), "aidlc.ts"), "engine", "hook", name], { cwd: product, input: JSON.stringify({ session_id: "lifecycle", cwd: product, ...payload }), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: product } });
  expect(result.status, result.stderr).toBe(0);
};
const intents = () => {
  const root = join(product, "aidlc", "spaces", "default", "intents");
  return existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "aidlc-state.md"))).map((entry) => entry.name) : [];
};
const directive = (name: string, value: object) => { writeFileSync(join(product, ".aidlc-engine", name), JSON.stringify(value)); return `.aidlc-engine/${name}`; };
const session = () => JSON.parse(readFileSync(join(product, ".aidlc-engine", "d-autopilot-session.json"), "utf8")) as Record<string, any>;

beforeAll(async () => {
  product = mkdtempSync(join(tmpdir(), "d-lifecycle-"));
  spawnSync("git", ["init", "-q", "-b", "main", product]);
  spawnSync("git", ["-C", product, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "empty"]);
  await install(SRC, product);
  writeFileSync(join(product, ".claude", "d-acceleration.jsonc"), '{ "auto": { "enabled": true, "sessionOnly": false, "through": "requirements-analysis", "maxSteps": 6, "deadlineMs": 600000 } }');
  hook("session-start", { hook_event_name: "SessionStart", source: "startup" });
}, TIMEOUT);
afterAll(() => { if (product) rmSync(product, { recursive: true, force: true }); });

describe("generic auto lifecycle on an installed clean target", () => {
  test("waits at official scope selection, then bootstraps exactly one Intent", () => {
    hook("record-human-turn", { hook_event_name: "UserPromptSubmit", prompt: "/aidlc --auto Build a tiny todo CLI in TypeScript" });
    mkdirSync(join(product, ".aidlc-engine"), { recursive: true });
    writeFileSync(join(product, ".aidlc-engine", "d-auto-request-life1.txt"), "Build a tiny todo CLI in TypeScript");
    const routed = auto("start", "--description-file", ".aidlc-engine/d-auto-request-life1.txt");
    expect(routed).toMatchObject({ status: "routed", reason: "human-gate", directive: { kind: "ask" } });
    expect(existsSync(join(product, ".aidlc-engine", "d-auto-request-life1.txt"))).toBeFalse();
    expect(existsSync(join(product, ".aidlc-engine", "d-autopilot-session.json"))).toBeFalse();
    expect(intents()).toEqual([]);

    // The person picks "poc" (recorded by the official prompt hook); the host
    // runs the matching official scope command from the directive.
    hook("record-human-turn", { hook_event_name: "UserPromptSubmit", prompt: "poc" });
    const choice = (routed.directive.scope_commands as { scope: string; command: string }[]).find((entry) => entry.scope === "poc")!;
    const argv = choice.command.split(" ").slice(2);
    const print = bunJson(join(tools(), "aidlc-orchestrate.ts"), [...argv, "--project-dir", product]);
    // Upstream core names the creation command in the print's prose only; the
    // host runs it exactly as given (the ordinary run-then-continue print).
    expect(print.kind).toBe("print");
    const named = /^Run `bun \.claude\/tools\/aidlc\.ts (engine intent create [^`]+)`/.exec(print.message)?.[1];
    expect(named).toBeString();
    // The print leaves `--label "<2-3 word kebab essence>"` for the host to
    // fill from the request (LLM knowledge); everything else runs verbatim.
    expect(named).toMatch(/--label "<[^"]+>"/);
    const filled = named!.replace(/--label "<[^"]+>"/, "--label todo-cli");
    bunJsonOrText(join(tools(), "aidlc.ts"), [...filled.split(" "), "--project-dir", product]);
    const boot = auto("bootstrap");
    expect(boot).toMatchObject({ action: "continue", initialized: true, state: { steps: 1, through: "requirements-analysis" } });
    expect(intents()).toHaveLength(1);
  }, TIMEOUT);

  test("replayed and crash-interrupted bootstrap never creates a duplicate Intent", () => {
    expect(auto("bootstrap")).toMatchObject({ reason: "already-bootstrapped" });
    // Crash after the official create but before the journal recorded it.
    const journalPath = join(product, ".aidlc-engine", "d-auto-bootstrap.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    writeFileSync(journalPath, JSON.stringify({ version: 2, digest: journal.digest, preActive: journal.preActive, phase: "pending-create", parallel: journal.parallel }));
    rmSync(join(product, ".aidlc-engine", "d-autopilot-session.json"));
    const recovered = auto("bootstrap");
    expect(recovered.action).toBe("continue");
    expect(intents()).toHaveLength(1);
  }, TIMEOUT);

  test("lock contention admits exactly one host action and blocks checkpoints meanwhile", async () => {
    const script = join(tools(), "d-acceleration", "generic-auto-cli.ts");
    const racers = await Promise.all([0, 1, 2].map(() => new Promise<Record<string, any>>((done) => {
      const child = spawn(process.execPath, [script, "action-start", "--project-dir", product], { cwd: product });
      let out = ""; child.stdout.on("data", (chunk) => { out += chunk; });
      child.on("close", () => done(JSON.parse(out)));
    })));
    const winners = racers.filter((result) => result.action === "continue");
    expect(winners).toHaveLength(1);
    for (const loser of racers.filter((result) => result.action !== "continue")) expect(["host-action-busy", "lifecycle-busy"]).toContain(loser.reason);
    expect(auto("checkpoint", "--directive-file", directive("busy.json", { kind: "run-stage", stage: "intent-capture", gate: true }))).toMatchObject({ action: "stop", reason: "host-action-busy" });
    expect(auto("action-finish", "--action-token", winners[0].token)).toMatchObject({ action: "continue" });
  }, TIMEOUT);

  test("an injected heartbeat crash is a bounded terminal stop; restart initializes a fresh bounded session", async () => {
    const started = auto("action-start");
    expect(started.action).toBe("continue");
    const heartbeat = JSON.parse(readFileSync(join(product, ".aidlc-engine", "d-autopilot-session.json.heartbeat.json"), "utf8"));
    process.kill(heartbeat.pid, "SIGKILL");
    await Bun.sleep(300);
    const status = auto("status");
    expect(status).toMatchObject({ active: false, recoveredReason: "heartbeat-stale", state: { terminalReason: "heartbeat-stale" } });
    expect(auto("checkpoint", "--directive-file", directive("after-crash.json", { kind: "run-stage", stage: "intent-capture" }))).toMatchObject({ action: "stop" });
    // Restart: the same official Intent, a new bounded session window.
    const stateText = readFileSync(join(product, "aidlc", "spaces", "default", "intents", intents()[0], "aidlc-state.md"), "utf8");
    const stages = [...stateText.matchAll(/^- \[.\] ([a-z0-9-]+) — EXECUTE$/gm)].map((match) => match[1]);
    expect(stages).toContain("requirements-analysis");
    const restarted = auto("resume", "--active-stages", stages.join(","), "--directive-file", directive("restart.json", { kind: "run-stage", stage: "intent-capture", gate: true }));
    expect(restarted).toMatchObject({ action: "continue", initialized: false, state: { steps: 1 } });
    expect(intents()).toHaveLength(1);
  }, TIMEOUT);

  test("boundary, no-progress, and operator stop are terminal and bounded", () => {
    const ask = auto("checkpoint", "--directive-file", directive("ask.json", { kind: "ask", stage: "intent-capture", gate: true }));
    expect(ask).toMatchObject({ action: "stop", reason: "human-gate", state: { awaitingHuman: true } });
    expect(session().waitingSince).toBeNumber();
    expect(auto("checkpoint", "--directive-file", directive("ra.json", { kind: "run-stage", stage: "requirements-analysis", gate: true }))).toMatchObject({ action: "continue" });
    expect(session().pausedMs).toBeGreaterThanOrEqual(0);
    expect(auto("checkpoint", "--directive-file", "ra.json".replace(/^/, ".aidlc-engine/"))).toMatchObject({ action: "stop", reason: "no-progress" });
    expect(auto("status")).toMatchObject({ active: false, state: { terminalReason: "no-progress" } });
    const stages = session().activeStages as string[];
    auto("resume", "--active-stages", stages.join(","), "--directive-file", directive("ra2.json", { kind: "run-stage", stage: "requirements-analysis", gate: true, review_iteration: 1 }));
    expect(auto("checkpoint", "--directive-file", directive("cg.json", { kind: "run-stage", stage: "code-generation", gate: true }))).toMatchObject({ action: "stop", reason: "boundary-reached" });
    auto("resume", "--active-stages", stages.join(","), "--directive-file", directive("ra3.json", { kind: "run-stage", stage: "requirements-analysis", gate: true, review_iteration: 2 }));
    expect(auto("stop")).toMatchObject({ action: "stop", reason: "operator-stop" });
    expect(auto("status")).toMatchObject({ active: false });
    expect(intents()).toHaveLength(1);
  }, TIMEOUT);
});
