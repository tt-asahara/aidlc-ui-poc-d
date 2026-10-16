#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { plan, type Input, type Tier } from "./aidlc-acceleration-plan.ts";
const escalate = (tier: Tier): Tier | null => tier === "fast" ? "balanced" : tier === "balanced" ? "judgment" : null;
export async function execute(input: Input, options: { failOnce?: string[] } = {}) {
  const planned = await plan(input); const failOnce = new Set(options.failOnce ?? []); const records: any[] = []; const started = performance.now();
  for (const wave of planned.waves) {
    const blocked = wave.map((id) => input.tasks.find((task) => task.id === id)!).find((task) => task.taskType === "approval");
    if (blocked) return { status: "awaiting-approval", blockedTask: blocked.id, records, elapsedMs: performance.now() - started, plan: planned };
    await Promise.all(wave.map(async (id) => {
      const task = input.tasks.find((candidate) => candidate.id === id)!; let tier = planned.routes[id]!.tier; let retryOrdinal = 0;
      while (true) {
        const model = input.modelCatalogVerified ? input.modelCatalog?.[tier] : undefined; const argv = [process.execPath, `${import.meta.dir}/fake-worker.ts`, "--task", id, "--stage", task.stage, "--unit", task.unit ?? "", "--tier", tier, "--model", model ?? "", "--duration-ms", String(task.estimatedMs), "--retry-ordinal", String(retryOrdinal), "--fail", String(failOnce.has(id) && retryOrdinal === 0)];
        const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" }); const output = await new Response(child.stdout).text(); const exitCode = await child.exited; records.push({ ...JSON.parse(output), exitCode });
        if (exitCode === 0) break; const next = escalate(tier); if (!next) throw new Error(`${id} failed at judgment tier; human review required`); tier = next; retryOrdinal += 1;
      }
    }));
  }
  return { status: "completed", records, elapsedMs: performance.now() - started, plan: planned };
}
if (import.meta.main) {
  const args = process.argv.slice(2); const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; }; const source = value("--input"); if (!source) throw new Error("--input is required");
  const result = await execute(JSON.parse(readFileSync(source, "utf8")), { failOnce: value("--fail-once")?.split(",") }); const rendered = `${JSON.stringify(result, null, 2)}\n`; const target = value("--output"); if (target) writeFileSync(target, rendered); else process.stdout.write(rendered); if (result.status !== "completed") process.exitCode = 3;
}
