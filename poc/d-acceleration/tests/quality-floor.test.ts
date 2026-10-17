import { describe, expect, test } from "bun:test";
import { plan, qualityFloor, type Task } from "../aidlc-acceleration-plan.ts";

const task = (overrides: Partial<Task>): Task => ({ id: "t", stage: "custom", dependsOn: [], estimatedMs: 1, taskType: "ambiguous", difficulty: "low", risk: "low", execution: "serial", writeSet: [], ...overrides });
const routeOf = async (t: Task) => { const result = await plan({ tasks: [t] }); return { route: result.routes[t.id]!, metrics: result.routingMetrics }; };

describe("planner-owned quality floor", () => {
  test("design-wave stages never route below balanced, whatever the caller's fallback or minimum", async () => {
    for (const stage of ["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design"]) {
      expect(qualityFloor({ stage, taskType: "ambiguous" })).toBe("balanced");
      const { route, metrics } = await routeOf(task({ id: stage, stage, fallbackTier: "fast", minimumTier: "fast" }));
      expect(route).toMatchObject({ tier: "balanced", effort: "medium", source: "fallback" });
      expect(route.reason).toContain("quality floor");
      expect(metrics.floorRaised).toBe(1);
      const templated = await routeOf(task({ id: `${stage}-t`, stage, taskType: "templated" }));
      expect(templated.route).toMatchObject({ tier: "balanced", source: "rule" });
      expect(templated.route.reason).toContain("quality floor");
    }
  });

  test("design task type is balanced on any stage", async () => {
    expect((await routeOf(task({ taskType: "design" }))).route).toMatchObject({ tier: "balanced", source: "rule" });
  });

  test("protected decisions are never downgraded below judgment", async () => {
    for (const taskType of ["approval", "security", "compliance"] as const) {
      expect(qualityFloor({ stage: "custom", taskType })).toBe("judgment");
      const { route } = await routeOf(task({ id: taskType, taskType, fallbackTier: "fast", minimumTier: "fast" }));
      expect(route).toMatchObject({ tier: "judgment", effort: "high", source: "rule", escalation: "human-review" });
    }
  });

  test("a caller minimumTier can raise but not lower the floor", async () => {
    expect((await routeOf(task({ taskType: "templated", minimumTier: "judgment" }))).route.tier).toBe("judgment");
    expect((await routeOf(task({ taskType: "templated" }))).route).toMatchObject({ tier: "fast", effort: "low" });
  });

  test("routing makes no network request", async () => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response("{}"); }) as unknown as typeof fetch;
    try { await routeOf(task({})); } finally { globalThis.fetch = original; }
    expect(calls).toBe(0);
  });
});
