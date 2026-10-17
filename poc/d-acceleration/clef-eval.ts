#!/usr/bin/env bun
/**
 * Clef routing evaluation on a fixed synthetic, labeled task set.
 * Never starts or stops Clef; it only probes `GET /health` on the given
 * loopback URL and routes through the production planner.
 *
 *   bun poc/d-acceleration/clef-eval.ts --url http://127.0.0.1:18742 [--repeat 5] [--out FILE]
 */
import { writeFileSync } from "node:fs";
import { plan, type Task, type Tier } from "./aidlc-acceleration-plan.ts";

/** Expected tiers are the reviewer's labels for these synthetic states. */
export const LABELED: Array<{ task: Task; expected: Tier }> = [
  { expected: "fast", task: { id: "rename-constant", stage: "custom", dependsOn: [], estimatedMs: 1, taskType: "ambiguous", difficulty: "low", risk: "low", execution: "serial", writeSet: [], assessmentState: { summary: "Rename one constant in a single file; no behaviour change." } } },
  { expected: "fast", task: { id: "fix-typo-docs", stage: "custom", dependsOn: [], estimatedMs: 1, taskType: "ambiguous", difficulty: "low", risk: "low", execution: "serial", writeSet: [], assessmentState: { summary: "Fix a spelling mistake in README." } } },
  { expected: "balanced", task: { id: "add-pagination", stage: "custom", dependsOn: [], estimatedMs: 1, taskType: "ambiguous", difficulty: "low", risk: "low", execution: "serial", writeSet: [], assessmentState: { summary: "Add cursor pagination to one list endpoint and its tests." } } },
  { expected: "judgment", task: { id: "cache-consistency", stage: "custom", dependsOn: [], estimatedMs: 1, taskType: "ambiguous", difficulty: "low", risk: "low", execution: "serial", writeSet: [], assessmentState: { summary: "Choose a cache invalidation strategy across three services with eventual consistency trade-offs." } } },
  // Design-wave Unit: the planner floor keeps it at balanced or above whatever Clef says.
  { expected: "balanced", task: { id: "fd-unit", stage: "functional-design", dependsOn: [], estimatedMs: 1, taskType: "ambiguous", difficulty: "low", risk: "low", execution: "serial", writeSet: [], assessmentState: { summary: "Functional design for a read-only settings page Unit." } } },
];

export async function evaluateClef(url: string, repeat = 3, timeoutMs = 1500) {
  let health: unknown = null; let healthy = false;
  try { const response = await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(1000) }); healthy = response.ok; health = await response.json().catch(() => null); } catch (error) { health = String(error); }
  const routes: any[] = []; const started = performance.now();
  for (let round = 0; round < repeat; round++) {
    const result = await plan({ tasks: LABELED.map(({ task }) => task), maxParallel: 1, clef: { enabled: true, url, timeoutMs } });
    for (const { task, expected } of LABELED) { const route = result.routes[task.id]!; routes.push({ round, id: task.id, expected, tier: route.tier, source: route.source, outcome: route.clef.outcome, confidence: route.confidence ?? null, routingMs: route.routingMs }); }
  }
  const wallMs = performance.now() - started; const used = routes.filter((route) => route.source === "clef");
  const sorted = routes.map((route) => route.routingMs).sort((a, b) => a - b); const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? null;
  return {
    endpoint: url, healthy, health, repeat, routes: routes.length,
    clefApplied: used.length, fallbacks: routes.filter((route) => route.source === "fallback").length,
    outcomes: Object.fromEntries([...new Set(routes.map((route) => route.outcome))].map((outcome) => [outcome, routes.filter((route) => route.outcome === outcome).length])),
    accuracyWhenApplied: used.length ? used.filter((route) => route.tier === route.expected).length / used.length : null,
    designBelowBalanced: routes.filter((route) => route.id === "fd-unit" && route.tier === "fast").length,
    throughputRoutesPerSec: routes.length / (wallMs / 1000), routingMsP50: pct(0.5), routingMsP95: pct(0.95),
    detail: routes,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2); const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const url = value("--url") ?? "http://127.0.0.1:18742";
  const result = await evaluateClef(url, Number(value("--repeat") ?? 3), Number(value("--timeout-ms") ?? 1500));
  const rendered = `${JSON.stringify({ recordedAt: new Date().toISOString(), ...result }, null, 2)}\n`;
  const out = value("--out"); if (out) writeFileSync(out, rendered); else process.stdout.write(rendered);
}
