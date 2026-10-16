import { describe, expect, test } from "bun:test";
import { plan, type Input } from "../aidlc-acceleration-plan.ts";
import fixture from "../fixtures/synthetic-plan.json";

describe("D acceleration planner", () => {
  test("preserves barriers and uses only official parallel seams", async () => {
    const result = await plan(fixture as Input);
    expect(result.waves).toEqual([["requirements"], ["functional-design", "infrastructure-design", "nfr-design"], ["plan-approval"], ["unit-a", "unit-b"], ["review"]]);
    expect(result.routes["plan-approval"]?.tier).toBe("judgment");
    expect(result.qualityContract.humanApprovalDelegated).toBeFalse();
  });

  test("does not invent a model ID", async () => {
    const result = await plan(fixture as Input);
    expect(result.routes.review?.model).toBeUndefined();
    expect(result.routingMetrics.costObservable).toContain("unavailable");
  });

  test("uses only runtime-confirmed catalog entries", async () => {
    const input = structuredClone(fixture) as Input;
    input.modelCatalog = { balanced: "runtime-confirmed-balanced" };
    const result = await plan(input);
    expect(result.routes.review?.model).toBe("runtime-confirmed-balanced");
    expect(result.routes["plan-approval"]?.model).toBeUndefined();
  });

  test("falls back safely when local Clef is unavailable", async () => {
    const input: Input = { clef: { enabled: true, url: "http://127.0.0.1:1", timeoutMs: 25 }, tasks: [{ id: "x", dependsOn: [], estimatedMs: 1, taskType: "ambiguous", difficulty: "low", risk: "low", execution: "serial", writeSet: [] }] };
    const result = await plan(input);
    expect(result.routes.x?.source).toBe("fallback");
    expect(result.routes.x?.tier).toBe("judgment");
  });

  test("rejects unsafe swarm and dependency cycles", async () => {
    await expect(plan({ tasks: [{ id: "x", dependsOn: [], estimatedMs: 1, taskType: "implementation", difficulty: "low", risk: "low", execution: "official-swarm", writeSet: [] }] })).rejects.toThrow("isolatedWorktree");
    await expect(plan({ tasks: [{ id: "x", dependsOn: ["y"], estimatedMs: 1, taskType: "implementation", difficulty: "low", risk: "low", execution: "serial", writeSet: [] }, { id: "y", dependsOn: ["x"], estimatedMs: 1, taskType: "implementation", difficulty: "low", risk: "low", execution: "serial", writeSet: [] }] })).rejects.toThrow("cycle");
  });

  test("rejects invented wave seams and honors configurable backpressure", async () => {
    const invented = structuredClone(fixture) as Input;
    invented.tasks[1]!.id = "made-up-stage";
    invented.tasks[4]!.dependsOn[0] = "made-up-stage";
    await expect(plan(invented)).rejects.toThrow("official-wave is not available");
    const capped = structuredClone(fixture) as Input;
    capped.maxParallel = 1;
    const result = await plan(capped);
    expect(result.waves.every((wave) => wave.length === 1)).toBeTrue();
  });
});
