#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";

export type Tier = "fast" | "balanced" | "judgment";
export type TaskType = "templated" | "implementation" | "review" | "design" | "security" | "compliance" | "approval" | "ambiguous";
export type Execution = "serial" | "official-wave" | "official-swarm";
export type Task = { id: string; dependsOn: string[]; estimatedMs: number; taskType: TaskType; difficulty: "low" | "medium" | "high"; risk: "low" | "medium" | "high"; execution: Execution; writeSet: string[]; isolatedWorktree?: boolean };
export type Input = { tasks: Task[]; maxParallel?: number; modelCatalog?: Partial<Record<Tier, string>>; clef?: { enabled?: boolean; url?: string; timeoutMs?: number; confidenceThreshold?: number } };
type Route = { tier: Tier; model?: string; reason: string; source: "rule" | "clef" | "fallback"; escalation: Tier | "human-review"; confidence?: number; routingMs: number };

const TASK_TYPES = new Set(["templated", "implementation", "review", "design", "security", "compliance", "approval", "ambiguous"]);
const EXECUTIONS = new Set(["serial", "official-wave", "official-swarm"]);
const OFFICIAL_WAVE_STAGES = new Set(["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design"]);

function validate(input: Input): void {
  if (!input || !Array.isArray(input.tasks) || input.tasks.length === 0) throw new Error("tasks must be a non-empty array");
  const ids = new Set<string>();
  for (const task of input.tasks) {
    if (!task.id || ids.has(task.id)) throw new Error(`duplicate or empty task id: ${task.id}`);
    ids.add(task.id);
    if (!TASK_TYPES.has(task.taskType) || !EXECUTIONS.has(task.execution)) throw new Error(`invalid task contract: ${task.id}`);
    if (!Array.isArray(task.dependsOn) || !Array.isArray(task.writeSet) || !Number.isFinite(task.estimatedMs) || task.estimatedMs < 0) throw new Error(`invalid task fields: ${task.id}`);
    if (task.execution === "official-swarm" && !task.isolatedWorktree) throw new Error(`official-swarm requires isolatedWorktree: ${task.id}`);
    if (task.execution === "official-wave" && !OFFICIAL_WAVE_STAGES.has(task.id)) throw new Error(`official-wave is not available for stage: ${task.id}`);
  }
  for (const task of input.tasks) for (const dependency of task.dependsOn) if (!ids.has(dependency)) throw new Error(`unknown dependency ${dependency} for ${task.id}`);
  if (input.maxParallel !== undefined && (!Number.isInteger(input.maxParallel) || input.maxParallel < 1)) throw new Error("maxParallel must be a positive integer");
  for (const [tier, model] of Object.entries(input.modelCatalog ?? {})) if (!(["fast", "balanced", "judgment"].includes(tier)) || typeof model !== "string" || !model.trim()) throw new Error(`invalid model catalog entry: ${tier}`);
}

function deterministicRoute(task: Task): Omit<Route, "routingMs"> | null {
  if (["security", "compliance", "approval"].includes(task.taskType) || task.risk === "high" || task.difficulty === "high") return { tier: "judgment", reason: "high-risk, approval, or high-difficulty work cannot be downgraded", source: "rule", escalation: "human-review" };
  if (task.taskType === "review" || task.taskType === "design" || task.risk === "medium" || task.difficulty === "medium") return { tier: "balanced", reason: "review/design or medium complexity requires balanced reasoning", source: "rule", escalation: "judgment" };
  if (task.taskType === "templated") return { tier: "fast", reason: "explicit low-risk templated work", source: "rule", escalation: "balanced" };
  if (task.taskType === "implementation") return { tier: "balanced", reason: "implementation defaults to balanced reasoning", source: "rule", escalation: "judgment" };
  return null;
}

async function clefRoute(task: Task, config: NonNullable<Input["clef"]>): Promise<{ tier: Tier; confidence: number; ms: number }> {
  const url = config.url ?? "http://127.0.0.1:18742";
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") throw new Error("Clef URL must be local http://127.0.0.1");
  const started = performance.now();
  const response = await fetch(`${url.replace(/\/$/, "")}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(config.timeoutMs ?? 1500), body: JSON.stringify({ model: "clef", state: task, questions: { tier: { type: "choice", instructions: "Classify only the reasoning effort for this low-risk ambiguous task.", criteria: { fast: "deterministic or templated", balanced: "moderate reasoning", judgment: "complex or uncertain" } } } }) });
  if (!response.ok) throw new Error(`Clef HTTP ${response.status}`);
  const body = await response.json() as any;
  const answer = body?.answers?.tier;
  if (!answer || !["fast", "balanced", "judgment"].includes(answer.choice) || typeof answer.confidence !== "number") throw new Error("invalid Clef response");
  if (answer.confidence < (config.confidenceThreshold ?? 0.75)) throw new Error("low-confidence Clef response");
  return { tier: answer.choice, confidence: answer.confidence, ms: performance.now() - started };
}

async function route(task: Task, input: Input): Promise<Route> {
  const started = performance.now();
  const ruled = deterministicRoute(task);
  if (ruled) return { ...ruled, model: input.modelCatalog?.[ruled.tier], routingMs: performance.now() - started };
  if (task.risk === "low" && input.clef?.enabled) {
    try {
      const selected = await clefRoute(task, input.clef);
      return { tier: selected.tier, model: input.modelCatalog?.[selected.tier], reason: "local Clef classified an ambiguous low-risk task", source: "clef", escalation: selected.tier === "fast" ? "balanced" : selected.tier === "balanced" ? "judgment" : "human-review", confidence: selected.confidence, routingMs: performance.now() - started };
    } catch {
      // Fail closed; transport and model details intentionally do not affect policy.
    }
  }
  return { tier: "judgment", model: input.modelCatalog?.judgment, reason: "ambiguous classification used the conservative fallback", source: "fallback", escalation: "human-review", routingMs: performance.now() - started };
}

function conflicts(a: Task, b: Task): boolean { return a.writeSet.some((item) => b.writeSet.includes(item)); }
function parallelEligible(task: Task): boolean { return task.execution === "official-wave" || (task.execution === "official-swarm" && task.isolatedWorktree === true); }

function buildWaves(tasks: Task[], maxParallel: number): string[][] {
  const pending = new Map(tasks.map((task) => [task.id, task]));
  const done = new Set<string>();
  const waves: string[][] = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((task) => task.dependsOn.every((id) => done.has(id))).sort((a, b) => a.id.localeCompare(b.id));
    if (!ready.length) throw new Error("dependency cycle detected");
    const first = ready[0]!;
    const wave: Task[] = [first];
    if (parallelEligible(first)) {
      for (const candidate of ready.slice(1)) {
        if (wave.length >= maxParallel) break;
        if (parallelEligible(candidate) && candidate.execution === first.execution && wave.every((member) => !conflicts(member, candidate))) wave.push(candidate);
      }
    }
    for (const task of wave) { pending.delete(task.id); done.add(task.id); }
    waves.push(wave.map((task) => task.id));
  }
  return waves;
}

export async function plan(input: Input) {
  validate(input);
  const started = performance.now();
  const routes = Object.fromEntries(await Promise.all(input.tasks.map(async (task) => [task.id, await route(task, input)])));
  const waves = buildWaves(input.tasks, input.maxParallel ?? 4);
  const routeValues = Object.values(routes);
  return { schemaVersion: 1, routes, waves, routingMetrics: { plannerWallMs: performance.now() - started, clefCalls: routeValues.filter((r) => r.source === "clef").length, fallbackCount: routeValues.filter((r) => r.source === "fallback").length, retries: 0, costObservable: Object.values(routes).every((r) => r.model !== undefined) ? "runtime-usage-required" : "unavailable-without-runtime-model-catalog" }, qualityContract: { deterministicRulesFirst: true, humanApprovalDelegated: false, securityDelegated: false, officialParallelSeamsOnly: true, testingContractPreserved: true } };
}

async function main() {
  const args = process.argv.slice(2); const inputIndex = args.indexOf("--input"); const outputIndex = args.indexOf("--output");
  if (inputIndex < 0 || !args[inputIndex + 1]) throw new Error("usage: aidlc-acceleration-plan.ts --input FILE [--output FILE]");
  const result = await plan(JSON.parse(readFileSync(args[inputIndex + 1]!, "utf8")));
  const rendered = `${JSON.stringify(result, null, 2)}\n`;
  if (outputIndex >= 0 && args[outputIndex + 1]) writeFileSync(args[outputIndex + 1]!, rendered); else process.stdout.write(rendered);
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
