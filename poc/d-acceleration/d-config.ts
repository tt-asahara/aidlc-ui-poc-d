import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DModelTier = "fast" | "balanced" | "judgment";
export type DModelCatalog = Record<DModelTier, string>;
export type DClefConfig = { enabled: boolean; url: string; lowRiskUnits: string[] };
export const DEFAULT_D_MODEL = "opus";
export const DEFAULT_CLEF_URL = "http://127.0.0.1:18742";

type DFileConfig = { models: Partial<DModelCatalog>; clef?: Partial<DClefConfig> };
function readConfig(path: string): DFileConfig {
  if (!existsSync(path)) return { models: {} };
  const value = JSON.parse(readFileSync(path, "utf8"));
  const models = value?.models ?? value;
  const result: Partial<DModelCatalog> = {};
  for (const tier of ["fast", "balanced", "judgment"] as const) {
    const model = models?.[tier];
    if (model !== undefined && (typeof model !== "string" || !model.trim())) throw new Error(`invalid D ${tier} model in ${path}`);
    if (typeof model === "string") result[tier] = model.trim();
  }
  const clef = value?.clef;
  if (clef !== undefined) {
    if (!clef || typeof clef !== "object" || (clef.enabled !== undefined && typeof clef.enabled !== "boolean")) throw new Error(`invalid D Clef config in ${path}`);
    if (clef.url !== undefined) {
      if (typeof clef.url !== "string") throw new Error(`invalid D Clef URL in ${path}`);
      const url = new URL(clef.url);
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error(`D Clef URL must be loopback http://127.0.0.1 in ${path}`);
    }
    if (clef.lowRiskUnits !== undefined && (!Array.isArray(clef.lowRiskUnits) || !clef.lowRiskUnits.every((unit: unknown) => typeof unit === "string" && unit.trim()))) throw new Error(`invalid D Clef lowRiskUnits in ${path}`);
  }
  return { models: result, clef };
}

/** D routing is deliberately separate from official per-agent model policy. */
export function resolveDModels(projectDir: string, cli: Partial<DModelCatalog> = {}): { models: DModelCatalog; sources: Record<DModelTier, "cli" | "local" | "project" | "default"> } {
  const project = readConfig(join(projectDir, ".claude", "d-acceleration.json")).models;
  const local = readConfig(join(projectDir, ".claude", "d-acceleration.local.json")).models;
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

/** Clef stays off unless a project or local D config explicitly enables it. */
export function resolveDClef(projectDir: string): DClefConfig {
  const project = readConfig(join(projectDir, ".claude", "d-acceleration.json")).clef ?? {};
  const local = readConfig(join(projectDir, ".claude", "d-acceleration.local.json")).clef ?? {};
  return {
    enabled: local.enabled ?? project.enabled ?? false,
    url: local.url ?? project.url ?? DEFAULT_CLEF_URL,
    lowRiskUnits: [...new Set((local.lowRiskUnits ?? project.lowRiskUnits ?? []).map((unit) => unit.trim()))],
  };
}

export function clefRunnerArgs(config: DClefConfig): string[] {
  if (!config.enabled) return [];
  return ["--clef-url", config.url, ...(config.lowRiskUnits.length ? ["--clef-low-risk-units", config.lowRiskUnits.join(",")] : [])];
}
