import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createFileClaimStore, issueAutopilotRuntimePaths } from "../issue-autopilot-runtime.ts";

const cli = join(import.meta.dir, "..", "host-session-cli.ts");
const run = (root: string, args: string[]) => spawnSync(process.execPath, [cli, ...args, "--project-dir", root, "--session-file", ".aidlc-engine/session.json"], { cwd: root, encoding: "utf8" });

describe("durable claimed host session", () => {
  test("keeps the claim across approval, resumes the through boundary, then releases", async () => {
    const root = mkdtempSync(join(tmpdir(), "d-host-session-"));
    mkdirSync(join(root, ".aidlc-engine"), { recursive: true });
    const paths = issueAutopilotRuntimePaths(root);
    const store = createFileClaimStore({ directory: paths.claims, leaseMs: 60_000 });
    expect(await store.acquire(42, "session-owner")).toBe("acquired");
    const initArgs = ["init", "--active-stages", "functional-design,code-generation", "--through", "functional-design", "--deadline-ms", "60000", "--max-steps", "8", "--issue-number", "42", "--owner", "session-owner", "--claim-lease-ms", "60000"];
    expect(run(root, initArgs).status).toBe(0);

    const directive = join(root, "directive.json");
    writeFileSync(directive, JSON.stringify({ kind: "ask", stage: "functional-design", gate: true, receipt: "approval-1" }));
    const gate = run(root, ["checkpoint", "--directive-file", "directive.json"]);
    expect(JSON.parse(gate.stdout)).toMatchObject({ action: "stop", reason: "human-gate" });
    expect(existsSync(join(paths.claims, "issue-42.json"))).toBeTrue();

    const resumed = run(root, initArgs);
    expect(JSON.parse(resumed.stdout)).toMatchObject({ action: "continue", resumed: true, state: { lastStage: "functional-design", through: "functional-design" } });
    writeFileSync(directive, JSON.stringify({ kind: "run-stage", stage: "code-generation", receipt: "next-stage" }));
    const boundary = run(root, ["checkpoint", "--directive-file", "directive.json"]);
    expect(JSON.parse(boundary.stdout)).toMatchObject({ action: "stop", reason: "boundary-reached", state: { terminalReason: "boundary-reached" } });
    expect(existsSync(join(paths.claims, "issue-42.json"))).toBeFalse();
  });

  test("refuses a concurrent checkpoint while the session lock is live", () => {
    const root = mkdtempSync(join(tmpdir(), "d-host-session-lock-"));
    mkdirSync(join(root, ".aidlc-engine"), { recursive: true });
    expect(run(root, ["init", "--active-stages", "functional-design", "--through", "functional-design"]).status).toBe(0);
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "run-stage", stage: "functional-design" }));
    writeFileSync(join(root, ".aidlc-engine", "session.json.lock"), "held\n");
    const blocked = run(root, ["checkpoint", "--directive-file", "directive.json"]);
    expect(JSON.parse(blocked.stdout)).toMatchObject({ action: "stop", reason: "session-busy" });
    expect(JSON.parse(readFileSync(join(root, ".aidlc-engine", "session.json"), "utf8")).steps).toBe(0);
  });

  test("renews the owner claim during a long host action and finishes by token", async () => {
    const root = mkdtempSync(join(tmpdir(), "d-host-heartbeat-"));
    mkdirSync(join(root, ".aidlc-engine"), { recursive: true });
    const paths = issueAutopilotRuntimePaths(root);
    const owner = createFileClaimStore({ directory: paths.claims, leaseMs: 150 });
    expect(await owner.acquire(42, "session-owner")).toBe("acquired");
    const init = ["init", "--active-stages", "functional-design", "--through", "functional-design", "--deadline-ms", "5000", "--issue-number", "42", "--owner", "session-owner", "--claim-lease-ms", "150"];
    expect(run(root, init).status).toBe(0);
    const action = JSON.parse(run(root, ["action-start"]).stdout) as { action: string; token: string; heartbeatEveryMs: number };
    expect(action).toMatchObject({ action: "continue", heartbeatEveryMs: 50 });
    expect(JSON.parse(run(root, init).stdout)).toMatchObject({ action: "stop", reason: "host-action-busy" });
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "run-stage", stage: "functional-design" }));
    expect(JSON.parse(run(root, ["checkpoint", "--directive-file", "directive.json"]).stdout)).toMatchObject({ action: "stop", reason: "host-action-busy" });
    await Bun.sleep(650);
    expect(await createFileClaimStore({ directory: paths.claims, leaseMs: 150 }).acquire(42, "other-owner")).toBe("busy");
    expect(JSON.parse(run(root, ["action-finish", "--action-token", action.token]).stdout)).toMatchObject({ action: "continue" });
    const racing = JSON.parse(run(root, ["action-start"]).stdout) as { token: string };
    const recoveryLock = join(paths.claims, "issue-42.json.recovery");
    writeFileSync(recoveryLock, "busy\n");
    const finishing = Bun.spawn([process.execPath, cli, "action-finish", "--action-token", racing.token, "--project-dir", root, "--session-file", ".aidlc-engine/session.json"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    await Bun.sleep(80); unlinkSync(recoveryLock);
    const racingOutput = await new Response(finishing.stdout).text();
    expect(await finishing.exited).toBe(0);
    expect(JSON.parse(racingOutput)).toMatchObject({ action: "continue" });
    const stoppedAction = JSON.parse(run(root, ["action-start"]).stdout) as { token: string };
    writeFileSync(paths.stop, "stop\n");
    await Bun.sleep(200);
    expect(JSON.parse(run(root, ["action-finish", "--action-token", stoppedAction.token]).stdout)).toMatchObject({ action: "stop", reason: "operator-stop", state: { terminalReason: "operator-stop" } });
    expect(existsSync(join(paths.claims, "issue-42.json"))).toBeFalse();
  });

  test("cleans the checkpoint lock when an exception escapes", () => {
    const root = mkdtempSync(join(tmpdir(), "d-host-lock-cleanup-"));
    mkdirSync(join(root, ".aidlc-engine"), { recursive: true });
    writeFileSync(join(root, ".aidlc-engine", "session.json"), JSON.stringify({ startedAt: Date.now(), deadlineMs: 5000, maxSteps: 2, steps: 0, through: null, claim: { issueNumber: 42, owner: "owner", leaseMs: 0 } }));
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "run-stage", stage: "functional-design" }));
    expect(run(root, ["checkpoint", "--directive-file", "directive.json"]).status).not.toBe(0);
    expect(existsSync(join(root, ".aidlc-engine", "session.json.lock"))).toBeFalse();
  });

  test("status atomically recovers worker crashes and action crash windows", async () => {
    for (const fixture of [
      { name: "state-only", hostAction: { token: "lost", startedAt: Date.now() }, heartbeat: null, failure: null, reason: "host-action-orphaned" },
      { name: "dead-worker", hostAction: { token: "dead", startedAt: Date.now() }, heartbeat: { token: "dead", pid: 2147483647, startedAt: Date.now(), lastRenewedAt: Date.now(), expiresAt: Date.now() + 5000, status: "running" }, failure: null, reason: "heartbeat-stale" },
      { name: "record-only", hostAction: undefined, heartbeat: { token: "orphan", pid: 2147483647, startedAt: Date.now(), lastRenewedAt: Date.now(), expiresAt: Date.now() + 5000, status: "starting" }, failure: null, reason: "host-action-orphaned" },
      { name: "failed-deadline", hostAction: { token: "failed", startedAt: Date.now() }, heartbeat: { token: "failed", pid: 2147483647, startedAt: Date.now(), lastRenewedAt: Date.now(), expiresAt: Date.now(), status: "failed" }, failure: { token: "failed", reason: "deadline-exceeded" }, reason: "deadline-exceeded" },
    ] as const) {
      const root = mkdtempSync(join(tmpdir(), `d-host-recover-${fixture.name}-`));
      mkdirSync(join(root, ".aidlc-engine"), { recursive: true });
      const paths = issueAutopilotRuntimePaths(root), store = createFileClaimStore({ directory: paths.claims, leaseMs: 5000 });
      expect(await store.acquire(42, "owner")).toBe("acquired");
      writeFileSync(join(root, ".aidlc-engine", "session.json"), JSON.stringify({ startedAt: Date.now(), deadlineMs: 5000, maxSteps: 4, steps: 1, through: null, claim: { issueNumber: 42, owner: "owner", leaseMs: 5000 }, ...(fixture.hostAction ? { hostAction: fixture.hostAction } : {}) }));
      if (fixture.heartbeat) writeFileSync(join(root, ".aidlc-engine", "session.json.heartbeat.json"), JSON.stringify(fixture.heartbeat));
      if (fixture.failure) writeFileSync(join(root, ".aidlc-engine", "session.json.heartbeat-failed"), JSON.stringify(fixture.failure));
      const status = JSON.parse(run(root, ["status"]).stdout);
      expect(status).toMatchObject({ active: false, recoveredReason: fixture.reason, state: { terminalReason: fixture.reason } });
      expect(existsSync(join(paths.claims, "issue-42.json"))).toBeFalse();
      expect(existsSync(join(root, ".aidlc-engine", "session.json.heartbeat.json"))).toBeFalse();
    }
  });

  test("a stopping record left after state save is cleaned without ending the session", () => {
    const root = mkdtempSync(join(tmpdir(), "d-host-finish-window-"));
    mkdirSync(join(root, ".aidlc-engine"), { recursive: true });
    writeFileSync(join(root, ".aidlc-engine", "session.json"), JSON.stringify({ startedAt: Date.now(), deadlineMs: 5000, maxSteps: 4, steps: 1, through: null }));
    writeFileSync(join(root, ".aidlc-engine", "session.json.heartbeat.json"), JSON.stringify({ token: "done", pid: 2147483647, startedAt: Date.now(), lastRenewedAt: Date.now(), expiresAt: Date.now() + 5000, status: "stopping" }));
    writeFileSync(join(root, ".aidlc-engine", "session.json.lifecycle.lock"), JSON.stringify({ pid: 2147483647, createdAt: Date.now() }));
    expect(JSON.parse(run(root, ["status"]).stdout)).toMatchObject({ active: true, recoveredReason: null });
    expect(existsSync(join(root, ".aidlc-engine", "session.json.heartbeat.json"))).toBeFalse();
    expect(existsSync(join(root, ".aidlc-engine", "session.json.lifecycle.lock"))).toBeFalse();
  });
});
