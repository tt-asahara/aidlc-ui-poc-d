#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { adaptOfficialNext } from "./official-next-adapter.ts";
import { execute } from "./scheduler.ts";
import type { WorkerKind } from "./worker-adapters.ts";

type ConductOptions = { projectDir: string; engineDir: string; workerKind: WorkerKind; requestedClaudeModels?: Record<string, string | undefined>; requestedClaudeEffort?: string; disposableTestMode?: boolean; timeoutMs?: number; env?: Record<string, string | undefined> };
function invoke(tool: string, args: string[], options: ConductOptions): any {
  const result = spawnSync(process.execPath, [tool, ...args, "--project-dir", options.projectDir], { cwd: options.projectDir, env: options.env ?? process.env, encoding: "utf8", timeout: options.timeoutMs ?? 30_000 });
  if (result.status !== 0) throw new Error(`${tool} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

export async function conduct(options: ConductOptions) {
  const orchestrate = join(options.engineDir, "aidlc-orchestrate.ts"); const state = join(options.engineDir, "aidlc-state.ts"); const history: any[] = [];
  for (let step = 0; step < 100; step++) {
    const directive = invoke(orchestrate, ["next"], options); history.push(directive);
    if (!directive || directive.kind !== "run-stage" || !directive.wave || directive.gate === true) return { status: "official-host-action-required", directive, history };
    const entries = directive.wave.entries as any[]; const build = entries.filter((entry) => entry.build_required === true);
    if (build.length) {
      const adapted = adaptOfficialNext(directive); const result = await execute(adapted, { projectDir: options.projectDir, workerKind: options.workerKind, requestedClaudeModels: options.requestedClaudeModels, requestedClaudeEffort: options.requestedClaudeEffort, disposableTestMode: options.disposableTestMode, timeoutMs: options.timeoutMs });
      if (result.status !== "completed") return { status: "worker-action-required", directive, result, history };
      continue;
    }
    const completable = entries.filter((entry) => entry.completion_required === true && entry.review_state === "not-required");
    if (completable.length !== entries.length) return { status: "official-host-action-required", directive, history };
    for (const entry of completable) invoke(state, ["unit", "complete", "--wave", "--stage", directive.stage, "--unit", entry.unit], options);
  }
  return { status: "limit-reached", history };
}

if (import.meta.main) {
  const args = process.argv.slice(2); const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const projectDir = value("--project-dir"); const engineDir = value("--engine-dir"); const worker = value("--worker") as WorkerKind | undefined;
  if (!projectDir || !engineDir || !worker || !["fake", "claude"].includes(worker)) throw new Error("--project-dir, --engine-dir, and --worker fake|claude are required");
  const result = await conduct({ projectDir, engineDir, workerKind: worker, requestedClaudeModels: { fast: value("--claude-fast"), balanced: value("--claude-balanced"), judgment: value("--claude-judgment") }, requestedClaudeEffort: value("--claude-effort"), disposableTestMode: args.includes("--disposable-test-mode"), timeoutMs: value("--timeout-ms") ? Number(value("--timeout-ms")) : undefined });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.status !== "official-host-action-required") process.exitCode = result.status === "worker-action-required" ? 2 : 0;
}
