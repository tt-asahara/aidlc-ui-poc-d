// Regression for the dogfood-3 Issue #1 stop: a gated run-stage that comes back
// unchanged after the host worked on the stage was terminalized as
// `no-progress`, and a person-requested scope change left the session bound to
// the old stage list and boundary.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { MAX_IDENTICAL_REPEATS, checkpointHostSession, enterHumanWait, recordHostActionFinished, rescopeHostSession, type HostSessionState } from "../host-session.ts";

const runStage = { kind: "run-stage", stage: "intent-capture", gate: true };
const FEATURE = ["intent-capture", "requirements-analysis", "functional-design", "code-generation", "build-and-test", "ci-pipeline"];
const UI_APP = ["intent-capture", "requirements-analysis", "functional-design", "code-generation", "build-and-test"];

describe("host session progress evidence", () => {
  const initial: HostSessionState = { startedAt: 0, deadlineMs: 1_000_000, maxSteps: 50, steps: 0, through: null };

  test("an identical directive after a finished host action is progress, not a replay", () => {
    const first = checkpointHostSession(initial, runStage, 10);
    expect(first.action).toBe("continue");
    const worked = recordHostActionFinished(first.state);
    const again = checkpointHostSession(worked, runStage, 20);
    expect(again).toMatchObject({ action: "continue", state: { steps: 2, actionsSinceCheckpoint: 0, identicalRepeats: 1 } });
    // Nothing done since: a true replay still stops.
    expect(checkpointHostSession(again.state, runStage, 30)).toMatchObject({ action: "stop", reason: "no-progress" });
  });

  test("an identical directive after the person replied to a wait is progress", () => {
    const first = checkpointHostSession(initial, runStage, 10);
    const waited = enterHumanWait(first.state, "stage-question", 15);
    expect(checkpointHostSession(waited, runStage, 40).action).toBe("continue");
  });

  test("a different directive resets the repeat count", () => {
    const first = checkpointHostSession(initial, runStage, 10);
    const again = checkpointHostSession(recordHostActionFinished(first.state), runStage, 20);
    const moved = checkpointHostSession(again.state, { kind: "ask", stage: "intent-capture", gate: true }, 30);
    expect(moved.state.identicalRepeats).toBe(0);
  });

  test("acting forever without the engine moving still stops", () => {
    let state = checkpointHostSession(initial, runStage, 0).state;
    let result: ReturnType<typeof checkpointHostSession> | undefined;
    for (let i = 1; i <= MAX_IDENTICAL_REPEATS; i++) {
      result = checkpointHostSession(recordHostActionFinished(state), runStage, i);
      state = result.state;
      if (result.action === "stop") break;
    }
    expect(result).toMatchObject({ action: "stop", reason: "no-progress", state: { identicalRepeats: MAX_IDENTICAL_REPEATS } });
  });

  test("rescope re-binds the stage list and re-resolves a phase boundary", () => {
    const active: HostSessionState = { ...initial, steps: 3, through: "ci-pipeline", activeStages: FEATURE, claim: { issueNumber: 1, owner: "o", leaseMs: 60_000 } };
    const rescoped = rescopeHostSession(active, UI_APP, "construction", 99);
    expect(rescoped).toMatchObject({ through: "build-and-test", activeStages: UI_APP, steps: 3, claim: { issueNumber: 1 } });
    expect(rescoped.scopeChanges).toEqual([{ at: 99, from: { through: "ci-pipeline", activeStages: FEATURE }, to: { through: "build-and-test", activeStages: UI_APP } }]);
    expect(() => rescopeHostSession({ ...active, endedAt: 5 }, UI_APP, "construction")).toThrow("has ended");
    expect(() => rescopeHostSession(active, ["intent-capture"], "construction")).toThrow("no active stage");
  });
});

describe("host-session-cli across a multi-turn gated stage and a scope change", () => {
  const cli = join(import.meta.dir, "..", "host-session-cli.ts");
  const run = (root: string, args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args, "--project-dir", root, "--session-file", ".aidlc-engine/session.json"], { cwd: root, encoding: "utf8" });
    return JSON.parse(result.stdout || "null") as Record<string, any>;
  };

  test("reproduces the dogfood-3 sequence without a false no-progress stop", () => {
    const root = mkdtempSync(join(tmpdir(), "d-host-progress-"));
    mkdirSync(join(root, ".aidlc-engine"), { recursive: true });
    writeFileSync(join(root, "directive.json"), JSON.stringify(runStage));
    expect(run(root, ["init", "--active-stages", FEATURE.join(","), "--through", "construction"])).toMatchObject({ action: "continue", state: { through: "ci-pipeline" } });

    // Turn 1: checkpoint the gated run-stage, then work on the stage body.
    expect(run(root, ["checkpoint", "--directive-file", "directive.json"]).action).toBe("continue");
    const action = run(root, ["action-start"]);
    expect(action.action).toBe("continue");
    expect(run(root, ["action-finish", "--action-token", action.token]).action).toBe("continue");

    // The person changed the scope; the session follows it.
    expect(run(root, ["rescope", "--active-stages", UI_APP.join(","), "--through", "construction"])).toMatchObject({ action: "continue", rescoped: true, state: { through: "build-and-test", activeStages: UI_APP } });

    // Turn 2 ("続けて"): the same run-stage comes back before the gate opens.
    expect(run(root, ["checkpoint", "--directive-file", "directive.json"])).toMatchObject({ action: "continue", state: { identicalRepeats: 1 } });
    // With no work in between, a replay is still caught.
    expect(run(root, ["checkpoint", "--directive-file", "directive.json"])).toMatchObject({ action: "stop", reason: "no-progress" });
  }, 60_000);

  test("init after a scope change names the rescope command", () => {
    const root = mkdtempSync(join(tmpdir(), "d-host-progress-init-"));
    mkdirSync(join(root, ".aidlc-engine"), { recursive: true });
    run(root, ["init", "--active-stages", FEATURE.join(","), "--through", "construction"]);
    const result = spawnSync(process.execPath, [cli, "init", "--active-stages", UI_APP.join(","), "--through", "construction", "--project-dir", root, "--session-file", ".aidlc-engine/session.json"], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("host-session-cli.ts rescope");
  }, 30_000);
});
