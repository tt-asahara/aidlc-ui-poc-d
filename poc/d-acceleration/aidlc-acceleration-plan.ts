#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { CLEF_REMOVED } from "./d-config.ts";

export type Tier = "fast" | "balanced" | "judgment";
export type TaskType = "templated" | "implementation" | "review" | "design" | "security" | "compliance" | "approval" | "ambiguous";
export type Execution = "serial" | "official-wave" | "official-swarm";
export type Task = { id: string; stage: string; unit?: string; dependsOn: string[]; inputSet?: string[]; builderBrief?: unknown; estimatedMs: number; taskType: TaskType; difficulty: "low" | "medium" | "high"; risk: "low" | "medium" | "high"; execution: Execution; writeSet: string[]; isolatedWorktree?: boolean; minimumTier?: Tier; fallbackTier?: Tier };
export type Directive = { kind: "wave" | "swarm"; stage: string; entries: string[] };
export type Input = { tasks: Task[]; directives?: Directive[]; sourceDirective?: unknown; maxParallel?: number; modelCatalog?: Partial<Record<Tier, string>> };
type Effort = "low" | "medium" | "high";
type Route = { tier: Tier; effort: Effort; model?: string; reason: string; source: "rule" | "fallback"; escalation: Tier | "human-review"; routingMs: number };

const TASK_TYPES = new Set(["templated", "implementation", "review", "design", "security", "compliance", "approval", "ambiguous"]);
const EXECUTIONS = new Set(["serial", "official-wave", "official-swarm"]);
const OFFICIAL_WAVE_STAGES = new Set(["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design"]);
const LEVELS = new Set(["low", "medium", "high"]);
const ORDER: Tier[] = ["fast", "balanced", "judgment"];
/** Task types that represent human-only or protected decisions; never routed below judgment. */
const PROTECTED_TASK_TYPES = new Set(["approval", "security", "compliance"]);
export const effortForTier = (tier: Tier): Effort => tier === "fast" ? "low" : tier === "balanced" ? "medium" : "high";
const maxTier = (a: Tier, b: Tier): Tier => ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
/**
 * Quality floor owned by the planner, not by callers: protected decisions
 * (approval/security/compliance) stay at judgment, and official design-wave
 * stages and design tasks never route below balanced, whatever a caller's
 * minimumTier/fallbackTier says.
 */
export function qualityFloor(task: Pick<Task, "stage" | "taskType" | "minimumTier">): Tier {
  const floor: Tier = PROTECTED_TASK_TYPES.has(task.taskType) ? "judgment" : OFFICIAL_WAVE_STAGES.has(task.stage) || task.taskType === "design" ? "balanced" : "fast";
  return maxTier(floor, task.minimumTier ?? "fast");
}



function validate(input: Input): void {
  if (input && typeof input === "object" && "clef" in input) throw new Error(`${CLEF_REMOVED}; delete the "clef" key from the planner input`);
  if (!input || !Array.isArray(input.tasks) || input.tasks.length === 0) throw new Error("tasks must be a non-empty array");
  const ids = new Set<string>();
  for (const task of input.tasks) {
    if (!task.id || ids.has(task.id)) throw new Error(`duplicate or empty task id: ${task.id}`);
    ids.add(task.id);
    if (!TASK_TYPES.has(task.taskType) || !EXECUTIONS.has(task.execution)) throw new Error(`invalid task contract: ${task.id}`);
    if (!LEVELS.has(task.risk) || !LEVELS.has(task.difficulty)) throw new Error(`invalid risk or difficulty: ${task.id}`);
    if (!Array.isArray(task.dependsOn) || (task.inputSet !== undefined && !Array.isArray(task.inputSet)) || !Array.isArray(task.writeSet) || !Number.isFinite(task.estimatedMs) || task.estimatedMs < 0) throw new Error(`invalid task fields: ${task.id}`);
    if (task.execution === "official-swarm" && !task.isolatedWorktree) throw new Error(`official-swarm requires isolatedWorktree: ${task.id}`);
    if (task.execution === "official-swarm") throw new Error(`official-swarm execution is unsupported: ${task.id}`);
    if (task.execution === "official-wave" && !OFFICIAL_WAVE_STAGES.has(task.stage)) throw new Error(`official-wave is not available for stage: ${task.stage}`);
  }
  for (const task of input.tasks) for (const dependency of task.dependsOn) if (!ids.has(dependency)) throw new Error(`unknown dependency ${dependency} for ${task.id}`);
  for (const directive of input.directives ?? []) for (const id of directive.entries) {
    if (directive.kind !== "wave" && directive.kind !== "swarm") throw new Error(`unsupported directive kind: ${String(directive.kind)}`);
    if (directive.kind === "swarm") throw new Error("swarm execution is unsupported by this harness");
    const task = input.tasks.find((candidate) => candidate.id === id);
    if (!task || task.stage !== directive.stage || ["approval", "review", "security", "compliance"].includes(task.taskType)) throw new Error(`directive entry does not match an eligible active-stage task: ${id}`);
    if (directive.kind === "wave" && (task.execution !== "official-wave" || !OFFICIAL_WAVE_STAGES.has(directive.stage))) throw new Error(`invalid wave directive entry: ${id}`);
  }
  if (input.maxParallel !== undefined && (!Number.isInteger(input.maxParallel) || input.maxParallel < 1)) throw new Error("maxParallel must be a positive integer");
  for (const [tier, model] of Object.entries(input.modelCatalog ?? {})) if (!(["fast", "balanced", "judgment"].includes(tier)) || typeof model !== "string" || !model.trim()) throw new Error(`invalid model catalog entry: ${tier}`);
}

function deterministicRoute(task: Task): Omit<Route, "routingMs" | "effort"> | null {
  if (["security", "compliance", "approval"].includes(task.taskType) || task.risk === "high" || task.difficulty === "high") return { tier: "judgment", reason: "high-risk, approval, or high-difficulty work cannot be downgraded", source: "rule", escalation: "human-review" };
  if (task.taskType === "review" || task.taskType === "design" || task.risk === "medium" || task.difficulty === "medium") return { tier: "balanced", reason: "review/design or medium complexity requires balanced reasoning", source: "rule", escalation: "judgment" };
  if (task.taskType === "templated") return { tier: "fast", reason: "explicit low-risk templated work", source: "rule", escalation: "balanced" };
  if (task.taskType === "implementation") return { tier: "balanced", reason: "implementation defaults to balanced reasoning", source: "rule", escalation: "judgment" };
  return null;
}

const escalationFor = (tier: Tier): Tier | "human-review" => tier === "fast" ? "balanced" : tier === "balanced" ? "judgment" : "human-review";

function route(task: Task): Route {
  const started = performance.now();
  const ruled = deterministicRoute(task);
  if (ruled) {
    const tier = maxTier(ruled.tier, qualityFloor(task));
    const reason = tier === ruled.tier ? ruled.reason : `${ruled.reason}; raised to the ${tier} quality floor`;
    return { ...ruled, tier, reason, effort: effortForTier(tier), escalation: escalationFor(tier), routingMs: performance.now() - started };
  }
  const floor = qualityFloor(task); const requested = task.fallbackTier ?? "judgment"; const fallback = maxTier(requested, floor);
  const reason = fallback === requested ? "ambiguous classification used the task's conservative fallback" : `ambiguous classification fallback ${requested} raised to the ${floor} quality floor`;
  return { tier: fallback, effort: effortForTier(fallback), reason, source: "fallback", escalation: escalationFor(fallback), routingMs: performance.now() - started };
}

function normalizedPath(value: string): string { return value.replaceAll("\\", "/").split("/").reduce<string[]>((parts, part) => part === ".." ? parts.slice(0, -1) : part && part !== "." ? [...parts, part] : parts, []).join("/"); }
function conflicts(a: Task, b: Task): boolean { return a.writeSet.some((left) => b.writeSet.some((right) => { const l = normalizedPath(left); const r = normalizedPath(right); return l === r || l.startsWith(`${r}/`) || r.startsWith(`${l}/`); })); }
function directiveFor(task: Task, input: Input): Directive | undefined { return input.directives?.find((directive) => directive.stage === task.stage && directive.entries.includes(task.id)); }

function buildWaves(tasks: Task[], input: Input, maxParallel: number): string[][] {
  const pending = new Map(tasks.map((task) => [task.id, task]));
  const done = new Set<string>();
  const waves: string[][] = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((task) => task.dependsOn.every((id) => done.has(id))).sort((a, b) => a.id.localeCompare(b.id));
    if (!ready.length) throw new Error("dependency cycle detected");
    const first = ready[0]!;
    const wave: Task[] = [first];
    const firstDirective = directiveFor(first, input);
    if (firstDirective) {
      for (const candidate of ready.slice(1)) {
        if (wave.length >= maxParallel) break;
        if (directiveFor(candidate, input) === firstDirective && wave.every((member) => !conflicts(member, candidate))) wave.push(candidate);
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
  const routes: Record<string, Route> = {};
  for (const task of input.tasks) routes[task.id] = route(task);
  const waves = buildWaves(input.tasks, input, input.maxParallel ?? 4);
  const routeValues = Object.values(routes);
  return { schemaVersion: 1, routes, waves, routingMetrics: { plannerWallMs: performance.now() - started, floorRaised: routeValues.filter((r) => r.reason.includes("quality floor")).length, fallbackCount: routeValues.filter((r) => r.source === "fallback").length, costObservable: Object.values(routes).every((r) => r.model !== undefined) ? "runtime-usage-required" : "unavailable-without-runtime-model-catalog" }, constraints: { deterministicRulesFirst: true, humanApprovalTasksSerial: true, securityTasksSerial: true, officialDirectiveEntriesOnly: true } };
}

async function main() {
  const args = process.argv.slice(2); const inputIndex = args.indexOf("--input"); const outputIndex = args.indexOf("--output");
  if (inputIndex < 0 || !args[inputIndex + 1]) throw new Error("usage: aidlc-acceleration-plan.ts --input FILE [--output FILE]");
  const result = await plan(JSON.parse(readFileSync(args[inputIndex + 1]!, "utf8")));
  const rendered = `${JSON.stringify(result, null, 2)}\n`;
  if (outputIndex >= 0 && args[outputIndex + 1]) writeFileSync(args[outputIndex + 1]!, rendered); else process.stdout.write(rendered);
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
