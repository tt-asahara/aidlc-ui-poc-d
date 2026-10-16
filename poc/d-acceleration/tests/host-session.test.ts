import { describe, expect, test } from "bun:test";
import { checkpointHostSession, directiveProgressFingerprint, resolveThroughBoundary } from "../host-session.ts";

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
    expect(checkpointHostSession(first.state, a, 300).reason).toBe("no-progress");
    expect(checkpointHostSession(first.state, b, 300).action).toBe("continue");
    const boundary = checkpointHostSession({ ...first.state, through: "functional-design", lastStage: "functional-design" }, { kind: "run-stage", stage: "code-generation" }, 300);
    expect(boundary.reason).toBe("boundary-reached");
  });
});
