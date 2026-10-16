import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DModelTier = "fast" | "balanced" | "judgment";
export type DModelCatalog = Record<DModelTier, string>;
export const DEFAULT_D_MODEL = "opus";

function readCatalog(path: string): Partial<DModelCatalog> {
  if (!existsSync(path)) return {};
  const value = JSON.parse(readFileSync(path, "utf8"));
  const models = value?.models ?? value;
  const result: Partial<DModelCatalog> = {};
  for (const tier of ["fast", "balanced", "judgment"] as const) {
    const model = models?.[tier];
    if (model !== undefined && (typeof model !== "string" || !model.trim())) throw new Error(`invalid D ${tier} model in ${path}`);
    if (typeof model === "string") result[tier] = model.trim();
  }
  return result;
}

/** D routing is deliberately separate from official per-agent model policy. */
export function resolveDModels(projectDir: string, cli: Partial<DModelCatalog> = {}): { models: DModelCatalog; sources: Record<DModelTier, "cli" | "local" | "project" | "default"> } {
  const project = readCatalog(join(projectDir, ".claude", "d-acceleration.json"));
  const local = readCatalog(join(projectDir, ".claude", "d-acceleration.local.json"));
  const models = {} as DModelCatalog;
  const sources = {} as Record<DModelTier, "cli" | "local" | "project" | "default">;
  for (const tier of ["fast", "balanced", "judgment"] as const) {
    const choices = [[cli[tier], "cli"], [local[tier], "local"], [project[tier], "project"], [DEFAULT_D_MODEL, "default"]] as const;
    const selected = choices.find(([model]) => typeof model === "string" && model.trim())!;
    models[tier] = selected[0]!.trim();
    sources[tier] = selected[1];
  }
  return { models, sources };
}
