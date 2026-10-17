import { describe, expect, test } from "bun:test";
import { activeElapsedMs, checkpointHostSession, directiveProgressFingerprint, leaveHumanWait, resolveThroughBoundary } from "../host-session.ts";

describe("host-driven autopilot session", () => {
  test("resolves a phase to the last active scope stage", () => {
    expect(resolveThroughBoundary("inception", ["requirements-analysis", "domain-design", "units-generation"])).toBe("units-generation");
    expect(() => resolveThroughBoundary("inception", ["functional-design"])).toThrow("no active stage");
  });
  test("distinguishes Units, wave batches, attempts and review iterations", () => {
    const a = { kind: "run-stage", stage: "functional-design", unit: "a", wave: { batch_index: 0, entries: [{ unit: "a" }] }, attempt: 1, review_iteration: 1 };
    const b = { ...a, unit: "b", wave: { batch_index: 1, entries: [{ unit: "b" }] }, attempt: 2, review_iteration: 2 };
    expect(directiveProgressFingerprint(a)).not.toBe(directiveProgressFingerprint(b));
    const initial = { startedAt: 100, deadlineMs: 1000, maxSteps: 3, steps: 0, through: null };
    const first = checkpointHostSession(initial, a, 200); expect(first.action).toBe("continue");
    expect(checkpointHostSession(initial, { ...a, gate: true }, 200).action).toBe("continue");
    expect(checkpointHostSession(initial, { kind: "ask", stage: "functional-design", gate: true }, 200).reason).toBe("human-gate");
    expect(checkpointHostSession(first.state, a, 300).reason).toBe("no-progress");
    expect(checkpointHostSession(first.state, b, 300).action).toBe("continue");
    expect(checkpointHostSession(first.state, { kind: "complete", completed: true }, 300).reason).toBe("complete");
    const boundary = checkpointHostSession({ ...first.state, through: "functional-design", lastStage: "functional-design" }, { kind: "run-stage", stage: "code-generation" }, 300);
    expect(boundary.reason).toBe("boundary-reached");
  });
  test("stops immediately when a resumed workflow is already beyond the configured boundary", () => {
    const state = { startedAt: 100, deadlineMs: 1000, maxSteps: 3, steps: 0, through: "units-generation", activeStages: ["requirements-analysis", "units-generation", "functional-design"] };
    expect(checkpointHostSession(state, { kind: "run-stage", stage: "functional-design", gate: false }, 200)).toMatchObject({ action: "stop", reason: "boundary-already-passed", state: { steps: 0 } });
  });
  test("treats each official load-steering part and receipt as progress", () => {
    const first = { kind: "load-steering", stage: "functional-design", part: 1, parts: 2, receipt: "r1" };
    const second = { ...first, part: 2, receipt: "r2" };
    expect(directiveProgressFingerprint(first)).not.toBe(directiveProgressFingerprint(second));
    const initial = { startedAt: 100, deadlineMs: 1000, maxSteps: 3, steps: 0, through: null };
    const one = checkpointHostSession(initial, first, 200);
    expect(one.action).toBe("continue");
    expect(checkpointHostSession(one.state, second, 300).action).toBe("continue");
    expect(checkpointHostSession(one.state, first, 300).reason).toBe("no-progress");
  });
  test("credits official human-gate wait time against the deadline for unclaimed sessions only", () => {
    const initial = { startedAt: 0, deadlineMs: 1000, maxSteps: 5, steps: 0, through: null };
    const waiting = checkpointHostSession(initial, { kind: "ask", stage: "requirements-analysis", gate: true }, 400);
    expect(waiting).toMatchObject({ reason: "human-gate", state: { waitingSince: 400 } });
    const parked = { ...waiting.state, awaitingHuman: true };
    // The person answers 50 minutes later; only 400ms of unattended time was used.
    expect(activeElapsedMs(parked, 3_000_400)).toBe(400);
    const resumed = checkpointHostSession(parked, { kind: "run-stage", stage: "requirements-analysis", gate: true }, 3_000_400);
    expect(resumed).toMatchObject({ action: "continue", state: { pausedMs: 3_000_000 } });
    expect(resumed.state.waitingSince).toBeUndefined();
    expect(checkpointHostSession({ ...resumed.state, awaitingHuman: false }, { kind: "run-stage", stage: "code-generation" }, 3_001_000)).toMatchObject({ reason: "deadline-exceeded" });
    // A claimed Issue session keeps wall-clock semantics while it waits.
    const claimed = { ...parked, claim: { issueNumber: 1, owner: "o", leaseMs: 100 } };
    expect(activeElapsedMs(claimed, 3_000_400)).toBe(3_000_400);
    expect(leaveHumanWait(claimed, 3_000_400).pausedMs).toBe(0);
    expect(checkpointHostSession(claimed, { kind: "run-stage", stage: "requirements-analysis" }, 3_000_400).reason).toBe("deadline-exceeded");
  });
  test("an ended session never continues and the ordinary crossing reports boundary-reached", () => {
    const ended = { startedAt: 0, deadlineMs: 1000, maxSteps: 5, steps: 1, through: null, endedAt: 10, terminalReason: "heartbeat-stale" };
    expect(checkpointHostSession(ended, { kind: "run-stage", stage: "intent-capture" }, 20)).toMatchObject({ action: "stop", reason: "session-ended", state: { steps: 1 } });
    const atBoundary = { startedAt: 0, deadlineMs: 1000, maxSteps: 5, steps: 2, through: "requirements-analysis", lastStage: "requirements-analysis", activeStages: ["intent-capture", "requirements-analysis", "code-generation"] };
    expect(checkpointHostSession(atBoundary, { kind: "run-stage", stage: "code-generation" }, 20).reason).toBe("boundary-reached");
  });
});
