#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { plan, type Input, type Tier } from "./aidlc-acceleration-plan.ts";
import { loadResumeLedger, recordUnitSuccess } from "./resume-ledger.ts";
import { claudeWorkerLaunch, fakeWorkerLaunch, runWorker, type WorkerKind } from "./worker-adapters.ts";
const escalate = (tier: Tier): Tier | null => tier === "fast" ? "balanced" : tier === "balanced" ? "judgment" : null;
type RuntimeCatalog = { source: "runtime-response"; models: Partial<Record<Tier, string>>; rawResponse: unknown };
type Options = { failOnce?: string[]; workerKind?: WorkerKind; ledgerPath?: string; runtimeCatalog?: RuntimeCatalog; timeoutMs?: number };

export async function execute(input: Input, options: Options = {}) {
  const planned = await plan(input); const failOnce = new Set(options.failOnce ?? []); const records: any[] = []; const started = performance.now();
  const directive = input.sourceDirective ?? input.directives; const ledger = options.ledgerPath ? loadResumeLedger(options.ledgerPath, directive) : null;
  for (const wave of planned.waves) {
    const blocked = wave.map((id) => input.tasks.find((task) => task.id === id)!).find((task) => task.taskType === "approval");
    if (blocked) return { status: "awaiting-official-approval", blockedTask: blocked.id, records, elapsedMs: performance.now() - started, plan: planned };
    const pending = wave.filter((id) => !ledger?.succeeded[id]);
    const settled = await Promise.allSettled(pending.map(async (id) => {
      const task = input.tasks.find((candidate) => candidate.id === id)!; let tier = planned.routes[id]!.tier; let retryOrdinal = 0;
      while (true) {
        const model = options.workerKind === "claude" ? options.runtimeCatalog?.models[tier] : input.modelCatalog?.[tier];
        if (options.workerKind === "claude" && !model) return { ok: false, failure: "unverified-model-catalog" };
        const launch = options.workerKind === "claude"
          ? claudeWorkerLaunch({ model: model!, effort: tier === "fast" ? "low" : tier === "balanced" ? "medium" : "high", prompt: JSON.stringify({ directive: input.sourceDirective, unit: task.unit }) })
          : fakeWorkerLaunch({ script: `${import.meta.dir}/fake-worker.ts`, task: id, stage: task.stage, unit: task.unit, tier, model, durationMs: task.estimatedMs, retryOrdinal, fail: failOnce.has(id) && retryOrdinal === 0 });
        const result = await runWorker(launch, { timeoutMs: options.timeoutMs ?? 30_000, maxStdoutBytes: 1_048_576, maxStderrBytes: 262_144 }); records.push({ task: id, tier, retryOrdinal, ...result });
        if (result.ok) { if (options.ledgerPath) recordUnitSuccess(options.ledgerPath, directive, id, result); return result; }
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
  const result = await execute(JSON.parse(readFileSync(source, "utf8")), { failOnce: value("--fail-once")?.split(","), workerKind: value("--worker") as WorkerKind | undefined, ledgerPath: value("--ledger"), timeoutMs: value("--timeout-ms") ? Number(value("--timeout-ms")) : undefined });
  const rendered = `${JSON.stringify(result, null, 2)}\n`; const target = value("--output"); if (target) writeFileSync(target, rendered); else process.stdout.write(rendered); if (result.status !== "completed") process.exitCode = 3;
}
