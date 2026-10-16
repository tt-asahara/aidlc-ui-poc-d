import { describe, expect, test } from "bun:test";
import { plan, type Input } from "../aidlc-acceleration-plan.ts";
import { execute } from "../scheduler.ts";
import fixture from "../fixtures/synthetic-plan.json";

describe("D acceleration harness", () => {
  test("parallelizes only entries in the same issued directive", async () => {
    const result = await plan(fixture as Input);
    expect(result.waves).toEqual([["requirements"], ["fd-a", "fd-b", "fd-c"], ["approval"], ["code-a"], ["code-b"], ["review"]]);
  });
  test("stops at approval and runs real children with overlap", async () => {
    const stopped = await execute(fixture as Input);
    expect(stopped.status).toBe("awaiting-approval");
    expect(stopped.records.map((record) => record.task).sort()).toEqual(["fd-a", "fd-b", "fd-c", "requirements"]);
    const completed = await execute(fixture as Input, { approvals: ["approval"] });
    const designs = completed.records.filter((record) => record.stage === "functional-design");
    expect(Math.max(...designs.map((record) => record.startedAt))).toBeLessThan(Math.min(...designs.map((record) => record.endedAt)));
    expect(completed.records.at(-1)?.task).toBe("review");
  });
  test("passes verified model argv and escalates failed child", async () => {
    const result = await execute(fixture as Input, { approvals: ["approval"], failOnce: ["code-a"] });
    const attempts = result.records.filter((record) => record.task === "code-a");
    expect(attempts.map((record) => record.launchedModel)).toEqual(["fixture-balanced", "fixture-judgment"]);
    expect(attempts.map((record) => record.retryOrdinal)).toEqual([0, 1]);
  });
  test("does not launch unverified model IDs", async () => {
    const input = structuredClone(fixture) as Input; input.modelCatalogVerified = false;
    expect((await plan(input)).routes.review?.model).toBeUndefined();
  });
  test("falls back when Clef is unavailable", async () => {
    const input: Input = { clef: { enabled: true, url: "http://127.0.0.1:1", timeoutMs: 25 }, tasks: [{ id: "x", stage: "custom", dependsOn: [], estimatedMs: 1, taskType: "ambiguous", difficulty: "low", risk: "low", execution: "serial", writeSet: [] }] };
    const result = await plan(input); expect(result.routes.x?.source).toBe("fallback");
  });
  test("rejects false directives, invalid levels, and unsafe swarm", async () => {
    const bad = structuredClone(fixture) as Input; bad.directives![0]!.stage = "nfr-design";
    await expect(plan(bad)).rejects.toThrow("active-stage");
    const level = structuredClone(fixture) as any; level.tasks[0].risk = "unknown";
    await expect(plan(level)).rejects.toThrow("risk or difficulty");
    const swarm = structuredClone(fixture) as Input; swarm.tasks.find((task) => task.id === "code-a")!.execution = "official-swarm"; swarm.tasks.find((task) => task.id === "code-a")!.isolatedWorktree = false;
    await expect(plan(swarm)).rejects.toThrow("isolatedWorktree");
  });
  test("serializes normalized parent-child conflicts and caps concurrency", async () => {
    const input = structuredClone(fixture) as Input; input.tasks[2]!.writeSet = ["a/design.md/child"];
    const result = await plan(input); expect(result.waves[1]).toEqual(["fd-a", "fd-c"]); expect(result.waves[2]).toEqual(["fd-b"]);
    const capped = structuredClone(fixture) as Input; capped.maxParallel = 1;
    expect((await plan(capped)).waves.every((wave) => wave.length === 1)).toBeTrue();
  });
});
