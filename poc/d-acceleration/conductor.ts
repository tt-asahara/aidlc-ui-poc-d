#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { adaptOfficialNext } from "./official-next-adapter.ts";
import { execute } from "./scheduler.ts";
import type { WorkerKind } from "./worker-adapters.ts";

type ConductOptions = { projectDir: string; engineDir: string; workerKind: WorkerKind; requestedClaudeModels?: Record<string, string | undefined>; requestedClaudeEffort?: string; disposableTestMode?: boolean; clefUrl?: string; clefLowRiskUnits?: string[]; timeoutMs?: number; env?: Record<string, string | undefined> };
export const DEFAULT_CLAUDE_MODEL = "opus";
export function withDefaultClaudeModels(models: ConductOptions["requestedClaudeModels"]): Record<string, string> {
  return { fast: models?.fast?.trim() || DEFAULT_CLAUDE_MODEL, balanced: models?.balanced?.trim() || DEFAULT_CLAUDE_MODEL, judgment: models?.judgment?.trim() || DEFAULT_CLAUDE_MODEL };
}
function invoke(tool: string, args: string[], options: ConductOptions): any {
  const result = spawnSync(process.execPath, [tool, ...args, "--project-dir", options.projectDir], { cwd: options.projectDir, env: options.env ?? process.env, encoding: "utf8", timeout: options.timeoutMs ?? 30_000 });
  if (result.status !== 0) throw new Error(`${tool} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

export async function conduct(options: ConductOptions) {
  const requestedClaudeModels = options.workerKind === "claude" ? withDefaultClaudeModels(options.requestedClaudeModels) : options.requestedClaudeModels;
  const orchestrate = join(options.engineDir, "aidlc-orchestrate.ts"); const state = join(options.engineDir, "aidlc-state.ts"); const history: any[] = []; const workerRuns: any[] = []; const dispatchedBuildWaves = new Set<string>();
  for (let step = 0; step < 100; step++) {
    const directive = invoke(orchestrate, ["next"], options); history.push(directive);
    if (!directive || directive.kind !== "run-stage" || !directive.wave || directive.gate === true) return { status: "official-host-action-required", directive, history, workerRuns };
    const entries = directive.wave.entries as any[]; const build = entries.filter((entry) => entry.build_required === true);
    if (build.length) {
      const buildWaveKey = JSON.stringify({ stage: directive.stage, batch_index: directive.wave.batch_index, entries: build.map((entry) => ({ unit: entry.unit, required_produces: entry.required_produces })).sort((a, b) => a.unit.localeCompare(b.unit)) });
      if (dispatchedBuildWaves.has(buildWaveKey)) return { status: "worker-action-required", reason: "no-progress-repeated-official-build-wave", directive, history, workerRuns };
      dispatchedBuildWaves.add(buildWaveKey);
      let adapted;
      try {
        adapted = adaptOfficialNext(directive, { clefLowRiskUnits: options.clefLowRiskUnits, clef: options.clefUrl ? { enabled: true, url: options.clefUrl } : undefined });
      } catch (error) {
        return { status: "official-host-action-required", reason: "c-ui-baseline-not-composed", error: error instanceof Error ? error.message : String(error), directive, history, workerRuns };
      }
      const result = await execute(adapted, { projectDir: options.projectDir, workerKind: options.workerKind, requestedClaudeModels, requestedClaudeEffort: options.requestedClaudeEffort, disposableTestMode: options.disposableTestMode, timeoutMs: options.timeoutMs });
      workerRuns.push({ stage: directive.stage, batchIndex: directive.wave.batch_index, result });
      if (result.status !== "completed") return { status: "worker-action-required", directive, result, history, workerRuns };
      const missing = adapted.tasks.flatMap((task) => task.writeSet).filter((path) => !existsSync(isAbsolute(path) ? path : join(options.projectDir, path)));
      if (missing.length) return { status: "worker-action-required", reason: "no-progress-missing-required-outputs", missing, directive, result, history, workerRuns };
      continue;
    }
    const completable = entries.filter((entry) => entry.completion_required === true && entry.review_state === "not-required");
    if (completable.length !== entries.length) return { status: "official-host-action-required", directive, history, workerRuns };
    for (const entry of completable) invoke(state, ["unit", "complete", "--wave", "--stage", directive.stage, "--unit", entry.unit], options);
  }
  return { status: "limit-reached", history, workerRuns };
}

if (import.meta.main) {
  const args = process.argv.slice(2); const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const projectDir = value("--project-dir"); const engineDir = value("--engine-dir"); const worker = value("--worker") as WorkerKind | undefined;
  if (!projectDir || !engineDir || !worker || !["fake", "claude"].includes(worker)) throw new Error("--project-dir, --engine-dir, and --worker fake|claude are required");
  const result = await conduct({ projectDir, engineDir, workerKind: worker, requestedClaudeModels: { fast: value("--claude-fast"), balanced: value("--claude-balanced"), judgment: value("--claude-judgment") }, requestedClaudeEffort: value("--claude-effort"), disposableTestMode: args.includes("--disposable-test-mode"), clefUrl: value("--clef-url"), clefLowRiskUnits: value("--clef-low-risk-units")?.split(",").filter(Boolean), timeoutMs: value("--timeout-ms") ? Number(value("--timeout-ms")) : undefined });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.status === "worker-action-required" || result.reason === "c-ui-baseline-not-composed") process.exitCode = 2; else if (result.status === "limit-reached") process.exitCode = 4;
}
