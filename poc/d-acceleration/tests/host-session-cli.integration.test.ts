import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
});
