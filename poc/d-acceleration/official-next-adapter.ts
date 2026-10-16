#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import type { Input, Task } from "./aidlc-acceleration-plan.ts";

const WAVE_STAGES = new Set(["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design"]);
export function adaptOfficialNext(value: any): Input {
  const directive = value?.directive ?? value;
  if (directive?.kind !== "run-stage") throw new Error(`expected official run-stage directive, got ${String(directive?.kind)}`);
  if (!directive.wave || !WAVE_STAGES.has(directive.stage)) throw new Error("run-stage has no supported official design wave");
  if (!Array.isArray(directive.wave.entries) || !Number.isInteger(directive.wave.batch_index)) throw new Error("invalid official wave shape");
  const tasks: Task[] = directive.wave.entries.filter((entry: any) => entry.build_required === true).map((entry: any) => {
    if (typeof entry.unit !== "string" || !Array.isArray(entry.produces)) throw new Error("invalid official wave entry");
    return { id: `${directive.stage}:${entry.unit}`, stage: directive.stage, unit: entry.unit, dependsOn: [], estimatedMs: 1, taskType: "design", difficulty: "medium", risk: "medium", execution: "official-wave", writeSet: entry.required_produces };
  });
  if (!tasks.length) throw new Error("official wave contains no build_required entries");
  return { tasks, directives: [{ kind: "wave", stage: directive.stage, entries: tasks.map((task) => task.id) }], sourceDirective: structuredClone(directive) };
}
if (import.meta.main) {
  const path = process.argv[2]; const text = path ? readFileSync(path, "utf8") : await Bun.stdin.text();
  process.stdout.write(`${JSON.stringify(adaptOfficialNext(JSON.parse(text)), null, 2)}\n`);
}
