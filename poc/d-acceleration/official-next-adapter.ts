#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import type { Input, Task } from "./aidlc-acceleration-plan.ts";

const WAVE_STAGES = new Set(["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design"]);
const REQUIRED_C_UI_CONSUMES: Record<string, string[]> = {
  "functional-design": ["ui-poc-refined-contract"],
};
function consumedArtifact(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const leaf = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return leaf.endsWith(".md") ? leaf.slice(0, -3) : leaf;
}
export function adaptOfficialNext(value: any, options: { clefLowRiskUnits?: string[]; clef?: Input["clef"] } = {}): Input {
  const directive = value?.directive ?? value;
  if (directive?.kind !== "run-stage") throw new Error(`expected official run-stage directive, got ${String(directive?.kind)}`);
  if (!directive.wave || !WAVE_STAGES.has(directive.stage)) throw new Error("run-stage has no supported official design wave");
  if (!Array.isArray(directive.wave.entries) || !Number.isInteger(directive.wave.batch_index)) throw new Error("invalid official wave shape");
  if (directive.rules_held !== undefined) throw new Error(`official ${directive.stage} wave holds rules only in the host chat; return to the official host instead of dispatching workers`);
  const rulePaths = directive.rules_in_context;
  if (!Array.isArray(rulePaths) || !rulePaths.every((path: unknown) => typeof path === "string")) throw new Error("official wave has invalid rules_in_context");
  const ruleContent = directive.rules_content;
  if (rulePaths.length > 0 && !Array.isArray(ruleContent)) throw new Error(`official ${directive.stage} wave rules arrived through prior load-steering and are unavailable to workers; return to the official host`);
  if (ruleContent !== undefined && (!Array.isArray(ruleContent) || ruleContent.length !== rulePaths.length || !ruleContent.every((entry: any, index: number) => entry && typeof entry.text === "string" && entry.path === rulePaths[index]))) {
    throw new Error("official wave rules_content does not exactly match rules_in_context order");
  }
  const requiredUiConsumes = REQUIRED_C_UI_CONSUMES[directive.stage] ?? [];
  const tasks: Task[] = directive.wave.entries.filter((entry: any) => entry.build_required === true).map((entry: any) => {
    if (typeof entry.unit !== "string" || !Array.isArray(entry.produces)) throw new Error("invalid official wave entry");
    const consumes = Array.isArray(entry.consumes) ? entry.consumes : [];
    const consumedArtifacts = new Set(consumes.map(consumedArtifact).filter(Boolean));
    const missingUiConsumes = requiredUiConsumes.filter((artifact) => !consumedArtifacts.has(artifact));
    if (missingUiConsumes.length) throw new Error(`official ${directive.stage} wave is missing composed Arm C UI consumes: ${missingUiConsumes.join(", ")}`);
    const clefEligible = options.clefLowRiskUnits?.includes(entry.unit) === true;
    const builderBrief = { ceremony: directive.ceremony, protocol_modules: directive.protocol_modules, stage_file: directive.stage_file, inline_context_paths: directive.inline_context_paths ?? [], context_warnings: directive.context_warnings ?? [], rules_content: ruleContent ?? [], rules_in_context: rulePaths, rules_held: directive.rules_held, rules_held_note: directive.rules_held_note, unit_memory_path: entry.unit_memory_path, entry: structuredClone(entry) };
    return { id: `${directive.stage}:${entry.unit}`, stage: directive.stage, unit: entry.unit, dependsOn: [], inputSet: consumes, builderBrief, estimatedMs: 1, taskType: clefEligible ? "ambiguous" : "design", difficulty: clefEligible ? "low" : "medium", risk: clefEligible ? "low" : "medium", execution: "official-wave", writeSet: entry.required_produces, ...(clefEligible ? { minimumTier: "balanced" as const, fallbackTier: "balanced" as const, assessmentState: { stage: directive.stage, unit: entry.unit, unit_kind: entry.unit_kind, consumes, consumes_absent: entry.consumes_absent, required_produces: entry.required_produces } } : {}) };
  });
  return { tasks, directives: [{ kind: "wave", stage: directive.stage, entries: tasks.map((task) => task.id) }], sourceDirective: structuredClone(directive), clef: options.clef };
}
if (import.meta.main) {
  const path = process.argv[2]; const text = path ? readFileSync(path, "utf8") : await Bun.stdin.text();
  process.stdout.write(`${JSON.stringify(adaptOfficialNext(JSON.parse(text)), null, 2)}\n`);
}
