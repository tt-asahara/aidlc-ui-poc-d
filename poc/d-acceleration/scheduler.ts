#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { plan, type Input, type Tier } from "./aidlc-acceleration-plan.ts";
import { claudeWorkerLaunch, fakeWorkerLaunch, runWorker, type WorkerKind } from "./worker-adapters.ts";
const escalate = (tier: Tier): Tier | null => tier === "fast" ? "balanced" : tier === "balanced" ? "judgment" : null;
type Options = { failOnce?: string[]; workerKind?: WorkerKind; ledgerPath?: string; projectDir: string; requestedClaudeModels?: Partial<Record<Tier, string>>; requestedClaudeEffort?: string; claudeExecutable?: string; disposableTestMode?: boolean; timeoutMs?: number };

export async function execute(input: Input, options: Options) {
  if (options.workerKind && !["fake", "claude"].includes(options.workerKind)) throw new Error(`unsupported worker: ${options.workerKind}`);
  const planned = await plan(input); const failOnce = new Set(options.failOnce ?? []); const records: any[] = []; const started = performance.now();
  const root = realpathSync(options.projectDir);
  for (const task of input.tasks) for (const output of task.writeSet) {
    const target = isAbsolute(output) ? output : resolve(root, output); let parent = existsSync(target) ? target : dirname(target); while (!existsSync(parent) && parent !== dirname(parent)) parent = dirname(parent); const resolvedParent = realpathSync(parent);
    if (relative(root, resolvedParent).startsWith("..") || isAbsolute(relative(root, resolvedParent))) throw new Error(`write target escapes project boundary: ${output}`);
  }
  const directive = input.sourceDirective ?? input.directives;
  for (const wave of planned.waves) {
    const blocked = wave.map((id) => input.tasks.find((task) => task.id === id)!).find((task) => task.taskType === "approval");
    if (blocked) return { status: "awaiting-official-approval", blockedTask: blocked.id, records, elapsedMs: performance.now() - started, plan: planned };
    // The latest official directive is the authority for resume. The ledger is
    // retained as audit evidence only and never suppresses issued work.
    const pending = wave;
    const settled = await Promise.allSettled(pending.map(async (id) => {
      const task = input.tasks.find((candidate) => candidate.id === id)!; let tier = planned.routes[id]!.tier; let retryOrdinal = 0;
      while (true) {
        const model = options.workerKind === "claude" ? options.requestedClaudeModels?.[tier] : input.modelCatalog?.[tier];
        if (options.workerKind === "claude" && !model) return { ok: false, failure: "missing-requested-model" };
        const launch = options.workerKind === "claude"
          ? claudeWorkerLaunch({ model: model!, effort: options.requestedClaudeEffort ?? (tier === "fast" ? "low" : tier === "balanced" ? "medium" : "high"), prompt: JSON.stringify({ directive: input.sourceDirective, target: { stage: task.stage, unit: task.unit, dependencies: task.dependsOn, inputs: task.inputSet ?? [], outputs: task.writeSet, writeBoundary: options.projectDir }, uiBaseline: "C", instruction: "Honor the composed official stage instructions, consumes/produces, blocking sensors, approval receipts, and downstream handoff. Worker exit zero is candidate evidence only; the official host is the sole gate/state writer." }), executable: options.claudeExecutable })
          : fakeWorkerLaunch({ script: `${import.meta.dir}/fake-worker.ts`, task: id, stage: task.stage, unit: task.unit, tier, model, durationMs: task.estimatedMs, retryOrdinal, fail: failOnce.has(id) && retryOrdinal === 0, produces: options.disposableTestMode ? task.writeSet : [] });
        const result = await runWorker(launch, { projectDir: options.projectDir, timeoutMs: options.timeoutMs ?? 30_000, maxStdoutBytes: 1_048_576, maxStderrBytes: 262_144 }); records.push({ task: id, tier, retryOrdinal, ...result });
        // Worker completion is only candidate evidence. The official engine
        // must accept the Unit before a separate single writer records it in
        // the resume ledger.
        if (result.ok) return result;
        if (["authentication", "unavailable", "timeout", "cancelled", "output-limit"].includes(result.failure ?? "")) return result;
        const next = escalate(tier); if (!next) return result; tier = next; retryOrdinal += 1;
      }
    }));
    const failures = settled.filter((item) => item.status === "rejected" || !item.value?.ok);
    if (failures.length) return { status: "failed", failures, records, elapsedMs: performance.now() - started, plan: planned };
  }
  return { status: "completed", records, elapsedMs: performance.now() - started, plan: planned };
}

if (import.meta.main) {
  const args = process.argv.slice(2); const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; }; const source = value("--input"); if (!source) throw new Error("--input is required");
  const projectDir = value("--project-dir"); if (!projectDir) throw new Error("--project-dir is required");
  const result = await execute(JSON.parse(readFileSync(source, "utf8")), { failOnce: value("--fail-once")?.split(","), workerKind: value("--worker") as WorkerKind | undefined, ledgerPath: value("--ledger"), projectDir, requestedClaudeModels: { fast: value("--claude-fast"), balanced: value("--claude-balanced"), judgment: value("--claude-judgment") }, requestedClaudeEffort: value("--claude-effort"), claudeExecutable: value("--claude-executable"), disposableTestMode: args.includes("--disposable-test-mode"), timeoutMs: value("--timeout-ms") ? Number(value("--timeout-ms")) : undefined });
  const rendered = `${JSON.stringify(result, null, 2)}\n`; const target = value("--output"); if (target) writeFileSync(target, rendered); else process.stdout.write(rendered); if (result.status !== "completed") process.exitCode = 3;
}
