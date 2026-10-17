import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plan, qualityFloor, type Input, type Task } from "../aidlc-acceleration-plan.ts";
import { adaptOfficialNext } from "../official-next-adapter.ts";
import { evaluateClef } from "../clef-eval.ts";

// A real loopback HTTP fixture (not a fetch mock) so transport, timeout,
// malformed-body, and hit-count behaviour are exercised end to end.
type Mode = { kind: "answer"; choice: string; confidence: number } | { kind: "malformed" } | { kind: "missing-choice" } | { kind: "http-500" } | { kind: "slow"; ms: number };
let mode: Mode = { kind: "answer", choice: "fast", confidence: 0.95 };
let hits = 0;
let server: ReturnType<typeof Bun.serve>;
let url = "";

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/systemone") return new Response("not found", { status: 404 });
      hits += 1;
      if (mode.kind === "malformed") return new Response("{not json", { headers: { "content-type": "application/json" } });
      if (mode.kind === "missing-choice") return Response.json({ answers: { tier: { confidence: 0.99 } } });
      if (mode.kind === "http-500") return Response.json({ error: { message: "fixture" } }, { status: 500 });
      if (mode.kind === "slow") { await Bun.sleep(mode.ms); return Response.json({ answers: { tier: { choice: "fast", confidence: 0.99 } } }); }
      return Response.json({ answers: { tier: { choice: mode.choice, confidence: mode.confidence } } });
    },
  });
  url = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

const task = (overrides: Partial<Task>): Task => ({ id: "t", stage: "custom", dependsOn: [], estimatedMs: 1, taskType: "ambiguous", difficulty: "low", risk: "low", execution: "serial", writeSet: [], ...overrides });
async function routeOf(t: Task, clef: Input["clef"] = { enabled: true, url, timeoutMs: 200 }) {
  const result = await plan({ tasks: [t], clef });
  return { route: result.routes[t.id]!, metrics: result.routingMetrics };
}

describe("Clef routing: enabled / disabled / unavailable / malformed / timeout", () => {
  test("enabled: a confident answer is applied to an eligible low-risk custom task", async () => {
    mode = { kind: "answer", choice: "fast", confidence: 0.95 };
    const { route } = await routeOf(task({}));
    expect(route).toMatchObject({ tier: "fast", effort: "low", source: "clef", clef: { attempted: true, available: true, used: true, outcome: "selected" } });
  });

  test("disabled: Clef is never contacted", async () => {
    const before = hits;
    const { route } = await routeOf(task({ fallbackTier: "balanced" }), { enabled: false, url });
    expect(route).toMatchObject({ tier: "balanced", source: "fallback", clef: { attempted: false, outcome: "not-eligible" } });
    expect(hits).toBe(before);
  });

  test("unavailable: closed loopback port falls back conservatively", async () => {
    const { route, metrics } = await routeOf(task({}), { enabled: true, url: "http://127.0.0.1:1", timeoutMs: 200 });
    expect(route).toMatchObject({ tier: "judgment", source: "fallback", clef: { attempted: true, available: false, used: false, outcome: "unavailable" } });
    expect(metrics.clefUnavailable).toBe(1);
  });

  test("HTTP error is unavailable", async () => {
    mode = { kind: "http-500" };
    expect((await routeOf(task({}))).route.clef.outcome).toBe("unavailable");
  });

  test("malformed JSON and a missing choice are invalid-response", async () => {
    mode = { kind: "malformed" };
    expect((await routeOf(task({}))).route).toMatchObject({ tier: "judgment", source: "fallback", clef: { available: true, used: false, outcome: "invalid-response" } });
    mode = { kind: "missing-choice" };
    expect((await routeOf(task({}))).route.clef.outcome).toBe("invalid-response");
  });

  test("low confidence is rejected", async () => {
    mode = { kind: "answer", choice: "fast", confidence: 0.4 };
    expect((await routeOf(task({}))).route).toMatchObject({ tier: "judgment", source: "fallback", clef: { outcome: "low-confidence", used: false } });
  });

  test("timeout aborts the request and falls back", async () => {
    mode = { kind: "slow", ms: 400 };
    const started = performance.now();
    const { route, metrics } = await routeOf(task({}), { enabled: true, url, timeoutMs: 50 });
    expect(performance.now() - started).toBeLessThan(350);
    expect(route).toMatchObject({ tier: "judgment", source: "fallback", clef: { attempted: true, used: false, outcome: "timeout" } });
    expect(metrics.clefTimeouts).toBe(1);
  });
});

describe("Clef never downgrades design work below balanced", () => {
  test("planner-owned floor applies even when a direct caller omits minimumTier", async () => {
    mode = { kind: "answer", choice: "fast", confidence: 0.99 };
    for (const stage of ["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design"]) {
      expect(qualityFloor({ stage, taskType: "ambiguous" })).toBe("balanced");
      const { route, metrics } = await routeOf(task({ id: stage, stage }));
      expect(route.tier).toBe("balanced");
      expect(route.effort).toBe("medium");
      expect(route.source).toBe("clef");
      expect(route.reason).toContain("quality floor");
      expect(metrics.floorRaised).toBe(1);
    }
  });

  test("a caller fallbackTier of fast cannot drop a design stage below balanced on any failure", async () => {
    for (const failing of [{ kind: "malformed" }, { kind: "http-500" }, { kind: "answer", choice: "fast", confidence: 0.1 }] as Mode[]) {
      mode = failing;
      expect((await routeOf(task({ stage: "functional-design", fallbackTier: "fast" }))).route.tier).toBe("balanced");
    }
    expect((await routeOf(task({ stage: "nfr-design", fallbackTier: "fast" }), { enabled: true, url: "http://127.0.0.1:1", timeoutMs: 100 })).route.tier).toBe("balanced");
  });

  test("design task type is ruled balanced without contacting Clef", async () => {
    mode = { kind: "answer", choice: "fast", confidence: 0.99 };
    const before = hits;
    const { route } = await routeOf(task({ taskType: "design", stage: "custom" }));
    expect(route).toMatchObject({ tier: "balanced", source: "rule", clef: { attempted: false } });
    expect(hits).toBe(before);
  });

  test("official adapter Units marked low-risk stay at or above balanced", async () => {
    mode = { kind: "answer", choice: "fast", confidence: 0.99 };
    const directive = { kind: "run-stage", stage: "functional-design", rules_in_context: [], wave: { batch_index: 0, entries: [{ unit: "alpha", unit_kind: "service", build_required: true, produces: [], required_produces: [], consumes: ["ui-poc-refined-contract"], consumes_absent: [] }] } };
    const input = adaptOfficialNext(directive, { clefLowRiskUnits: ["alpha"], clef: { enabled: true, url } });
    expect((await plan(input)).routes["functional-design:alpha"]?.tier).toBe("balanced");
  });
});

describe("Clef never handles human-only or protected decisions", () => {
  test("approval, security, and compliance tasks route to judgment without any Clef request", async () => {
    mode = { kind: "answer", choice: "fast", confidence: 0.99 };
    const before = hits;
    for (const taskType of ["approval", "security", "compliance"] as const) {
      const { route } = await routeOf(task({ id: taskType, taskType, difficulty: "low", risk: "low", fallbackTier: "fast", minimumTier: "fast" }));
      expect(route).toMatchObject({ tier: "judgment", effort: "high", source: "rule", escalation: "human-review", clef: { attempted: false, used: false } });
    }
    expect(hits).toBe(before);
  });

  test("stages whose policy says clef=never are not Clef-eligible even for an ambiguous low-risk task", async () => {
    const policy = JSON.parse(readFileSync(join(import.meta.dir, "..", "stage-policy.json"), "utf8")) as { stages: Array<{ stage: string; clef: string }> };
    const forbidden = policy.stages.filter((entry) => entry.clef === "never").map((entry) => entry.stage);
    expect(forbidden).toEqual(expect.arrayContaining(["approval-handoff", "requirements-analysis", "code-generation", "deployment-execution"]));
    mode = { kind: "answer", choice: "fast", confidence: 0.99 };
    const before = hits;
    for (const stage of forbidden) {
      const { route } = await routeOf(task({ id: stage, stage }));
      expect(route.source).toBe("fallback");
      expect(route.clef.attempted).toBe(false);
      expect(route.reason).toContain("not Clef-eligible");
    }
    expect(hits).toBe(before);
  });

  test("human-decision controllers and the ambiguity assessor have no Clef path", () => {
    for (const file of ["ai-approval-controller.ts", "ai-question-controller.ts", "issue-ambiguity-assessor.ts"]) {
      const source = readFileSync(join(import.meta.dir, "..", file), "utf8");
      expect(source).not.toMatch(/clef|18742|systemone|aidlc-acceleration-plan/i);
      expect(source).not.toMatch(/\bfetch\(/);
    }
  });
});

describe("clef-eval harness", () => {
  test("reports applied decisions, fallbacks, and the design floor against a fixture service", async () => {
    mode = { kind: "answer", choice: "fast", confidence: 0.99 };
    const report = await evaluateClef(url, 2, 500);
    expect(report.routes).toBe(10);
    expect(report.clefApplied).toBe(10);
    expect(report.designBelowBalanced).toBe(0);
    expect(report.detail.filter((route: any) => route.id === "fd-unit").every((route: any) => route.tier === "balanced")).toBeTrue();
  });
  test("a stopped endpoint yields only fallbacks", async () => {
    const report = await evaluateClef("http://127.0.0.1:1", 1, 200);
    expect(report).toMatchObject({ healthy: false, clefApplied: 0, fallbacks: 5, outcomes: { unavailable: 5 } });
  });
});
