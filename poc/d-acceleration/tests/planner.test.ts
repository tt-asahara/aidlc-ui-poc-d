import { describe, expect, test } from "bun:test";
import { plan, type Input } from "../aidlc-acceleration-plan.ts";
import { execute } from "../scheduler.ts";
import { adaptOfficialNext } from "../official-next-adapter.ts";
import { claudeLaunch } from "../claude-worker-adapter.ts";
import { DEFAULT_CLAUDE_MODEL, withDefaultClaudeModels } from "../conductor.ts";
import fixture from "../fixtures/synthetic-plan.json";
const projectDir = process.cwd();
const withoutApproval = () => { const input = structuredClone(fixture) as Input; input.tasks = input.tasks.filter((task) => task.id !== "approval"); input.tasks.find((task) => task.id === "code-a")!.dependsOn = ["fd-a", "fd-b", "fd-c"]; return input; };

describe("D acceleration harness", () => {
  test("parallelizes only entries in the same issued directive", async () => {
    const result = await plan(fixture as Input);
    expect(result.waves).toEqual([["requirements"], ["fd-a", "fd-b", "fd-c"], ["approval"], ["code-a"], ["code-b"], ["review"]]);
  });
  test("adapts the official run-stage.wave shape and build_required entries", () => {
    const input = adaptOfficialNext({ directive: { kind: "run-stage", stage: "functional-design", rules_in_context: [], wave: { batch_index: 0, entries: [{ unit: "api", build_required: true, produces: ["api/spec.md"], required_produces: ["api/spec.md"], consumes: ["evidence/ui-poc-refined-contract.md"] }, { unit: "done", build_required: false, produces: ["done/spec.md"], required_produces: [], consumes: [] }] } } });
    expect(input.tasks.map((task) => task.id)).toEqual(["functional-design:api"]);
    expect(input.directives?.[0]?.entries).toEqual(["functional-design:api"]);
    expect((input.sourceDirective as any).lead_agent).toBeUndefined();
  });
  test("constructs Claude argv without shell interpolation", () => {
    const launch = claudeLaunch("runtime-model", "medium", "synthetic prompt");
    expect(launch.args).toContain("runtime-model"); expect(launch.args.at(-1)).toBe("synthetic prompt");
  });
  test("defaults every Claude reasoning tier to the confirmed Opus alias", () => {
    expect(withDefaultClaudeModels(undefined)).toEqual({ fast: DEFAULT_CLAUDE_MODEL, balanced: DEFAULT_CLAUDE_MODEL, judgment: DEFAULT_CLAUDE_MODEL });
    expect(withDefaultClaudeModels({ balanced: "custom-balanced" })).toEqual({ fast: "opus", balanced: "custom-balanced", judgment: "opus" });
  });
  test("stops at approval and runs real children with overlap", async () => {
    const stopped = await execute(fixture as Input, { projectDir });
    expect(stopped.status).toBe("awaiting-official-approval");
    expect(stopped.records.map((record) => record.task).sort()).toEqual(["fd-a", "fd-b", "fd-c", "requirements"]);
    const completed = await execute(withoutApproval(), { projectDir });
    const designs = completed.records.filter((record) => record.stage === "functional-design");
    expect(Math.max(...designs.map((record) => record.startedAt))).toBeLessThan(Math.min(...designs.map((record) => record.endedAt)));
    expect(completed.records.at(-1)?.task).toBe("review");
  });
  test("passes caller model requests and escalates failed child", async () => {
    const result = await execute(withoutApproval(), { projectDir, failOnce: ["code-a"] });
    const attempts = result.records.filter((record) => record.task === "code-a");
    expect(attempts.map((record) => record.requestedModel)).toEqual(["fixture-balanced", "fixture-judgment"]);
    expect(attempts.map((record) => record.retryOrdinal)).toEqual([0, 1]);
  });
  test("does not treat caller model IDs as runtime verified", async () => {
    expect((await plan(fixture as Input)).routes.review?.model).toBeUndefined();
  });
  test("maps selected tier to an explicit Claude request without login retry", async () => {
    const input: Input = { tasks: [{ id: "impl", stage: "custom", dependsOn: [], estimatedMs: 1, taskType: "implementation", difficulty: "medium", risk: "medium", execution: "serial", writeSet: [] }] };
    const result = await execute(input, { projectDir, workerKind: "claude", requestedClaudeModels: { balanced: "requested-balanced" }, claudeExecutable: "/definitely/missing/claude" });
    expect(result.status).toBe("failed"); expect(result.records[0]?.requestedModel).toBe("requested-balanced"); expect(result.records[0]?.failure).toBe("unavailable");
  });
  test("rejects a leftover clef planner input instead of ignoring it", async () => {
    const input = { ...(structuredClone(fixture) as Input), clef: { enabled: false } } as Input;
    await expect(plan(input)).rejects.toThrow("Clef routing support was removed");
  });
  test("official design-wave Units route at balanced and reach the tier-specific worker model", async () => {
    const input = adaptOfficialNext({ kind: "run-stage", stage: "functional-design", rules_in_context: [], wave: { batch_index: 0, entries: [{ unit: "alpha", unit_kind: "service", build_required: true, produces: [], required_produces: [], consumes: ["ui-poc-refined-contract"], consumes_absent: [] }] } });
    input.modelCatalog = { balanced: "fixture-balanced" };
    expect((await plan(input)).routes["functional-design:alpha"]).toMatchObject({ tier: "balanced", effort: "medium", source: "rule" });
    const result = await execute(input, { projectDir, workerKind: "fake" });
    expect(result.records[0]).toMatchObject({ tier: "balanced", requestedModel: "fixture-balanced", route: { source: "rule", plannedTier: "balanced", plannedEffort: "medium" } });
  });
  test("rejects false directives, invalid levels, and unsafe swarm", async () => {
    const bad = structuredClone(fixture) as Input; bad.directives![0]!.stage = "nfr-design";
    await expect(plan(bad)).rejects.toThrow("active-stage");
    const level = structuredClone(fixture) as any; level.tasks[0].risk = "unknown";
    await expect(plan(level)).rejects.toThrow("risk or difficulty");
    const swarm = structuredClone(fixture) as Input; swarm.directives!.push({ kind: "swarm", stage: "code-generation", entries: ["code-a"] }); swarm.tasks.find((task) => task.id === "code-a")!.execution = "official-swarm";
    await expect(plan(swarm)).rejects.toThrow("isolatedWorktree");
  });
  test("serializes normalized parent-child conflicts and caps concurrency", async () => {
    const input = structuredClone(fixture) as Input; input.tasks[2]!.writeSet = ["a/design.md/child"];
    const result = await plan(input); expect(result.waves[1]).toEqual(["fd-a", "fd-c"]); expect(result.waves[2]).toEqual(["fd-b"]);
    const capped = structuredClone(fixture) as Input; capped.maxParallel = 1;
    expect((await plan(capped)).waves.every((wave) => wave.length === 1)).toBeTrue();
  });
});
