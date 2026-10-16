import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DModelTier = "fast" | "balanced" | "judgment";
export type DModelCatalog = Record<DModelTier, string>;
export type DClefConfig = { enabled: boolean; url: string; lowRiskUnits: string[] };
export type DGitPersistenceConfig = { enabled: boolean; push: boolean; remote: string; branch?: string };
export type DFeatureFlags = { requirementIdValidation: boolean; functionalDesignDocumentDiscipline: boolean; sourceGrounding: boolean; specGrounding: boolean };
export type DAmbiguityPolicy = "halt" | "assume" | "research";
export type DAutomationConfig = { enabled: boolean; through?: string; sessionOnly: boolean; ambiguityPolicy: DAmbiguityPolicy; assumptionLedger: boolean; maxRetries: number; labelAllowlist: string[] };
export type DIssueAutopilotConfig = { enabled: boolean; oneIssuePerRun: boolean };
export type DFeatureInputs = { requirementIdBridges: Array<{ uiAc: string; officialId: string }>; functionalDesignBudgets: { artifactBytes: number; unitBytes: number; metadataBytes: number }; sourceRoots: string[]; specRoots: string[] };
export type DResolvedConfig = { features: DFeatureFlags; featureInputs: DFeatureInputs; auto: DAutomationConfig; issueAutopilot: DIssueAutopilotConfig };
export const DEFAULT_D_MODEL = "opus";
export const DEFAULT_CLEF_URL = "http://127.0.0.1:18742";

type DFileConfig = { models: Partial<DModelCatalog>; clef?: Partial<DClefConfig>; gitPersistence?: Partial<DGitPersistenceConfig>; features?: Partial<DFeatureFlags>; featureInputs?: Partial<DFeatureInputs>; auto?: Partial<DAutomationConfig>; issueAutopilot?: Partial<DIssueAutopilotConfig> };

/** Parse JSONC without changing comment-like text inside strings. */
export function parseDJsonc(source: string, path = "D configuration"): unknown {
  let output = "", inString = false, escaped = false, lineComment = false, blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index], next = source[index + 1];
    if (lineComment) { if (char === "\n" || char === "\r") { lineComment = false; output += char; } else output += " "; continue; }
    if (blockComment) { if (char === "*" && next === "/") { blockComment = false; output += "  "; index += 1; } else output += char === "\n" || char === "\r" ? char : " "; continue; }
    if (inString) { output += char; if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') { inString = true; output += char; continue; }
    if (char === "/" && next === "/") { lineComment = true; output += "  "; index += 1; continue; }
    if (char === "/" && next === "*") { blockComment = true; output += "  "; index += 1; continue; }
    output += char;
  }
  if (inString || blockComment) throw new Error(`invalid JSONC in ${path}`);
  let withoutTrailingCommas = "", quoted = false, quoteEscaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const char = output[index];
    if (quoted) {
      withoutTrailingCommas += char;
      if (quoteEscaped) quoteEscaped = false;
      else if (char === "\\") quoteEscaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; withoutTrailingCommas += char; continue; }
    if (char === ",") {
      let cursor = index + 1;
      while (/\s/.test(output[cursor] ?? "")) cursor += 1;
      if (output[cursor] === "}" || output[cursor] === "]") continue;
    }
    withoutTrailingCommas += char;
  }
  try { return JSON.parse(withoutTrailingCommas); } catch (error) { throw new Error(`invalid JSONC in ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}

function object(value: unknown, label: string, path: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid D ${label} config in ${path}`);
  return value as Record<string, unknown>;
}
function bool(value: unknown, label: string, path: string): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") throw new Error(`invalid D ${label} in ${path}`);
  return value as boolean | undefined;
}
function strings(value: unknown, label: string, path: string): string[] | undefined {
  if (value !== undefined && (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim()))) throw new Error(`invalid D ${label} in ${path}`);
  return value === undefined ? undefined : [...new Set((value as string[]).map((item) => item.trim()))];
}
function readConfig(path: string): DFileConfig {
  if (!existsSync(path)) return { models: {} };
  const value = object(parseDJsonc(readFileSync(path, "utf8"), path), "root", path) ?? {};
  const models = object(value.models, "models", path) ?? value;
  const result: Partial<DModelCatalog> = {};
  for (const tier of ["fast", "balanced", "judgment"] as const) { const model = models[tier]; if (model !== undefined && (typeof model !== "string" || !model.trim())) throw new Error(`invalid D ${tier} model in ${path}`); if (typeof model === "string") result[tier] = model.trim(); }
  const clef = object(value.clef, "Clef", path);
  if (clef) { bool(clef.enabled, "Clef enabled", path); if (clef.url !== undefined) { if (typeof clef.url !== "string") throw new Error(`invalid D Clef URL in ${path}`); const url = new URL(clef.url); if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error(`D Clef URL must be loopback http://127.0.0.1 in ${path}`); } strings(clef.lowRiskUnits, "Clef lowRiskUnits", path); }
  const gitPersistence = object(value.gitPersistence, "Git persistence", path);
  if (gitPersistence) { for (const key of Object.keys(gitPersistence)) if (!["enabled", "push", "remote", "branch"].includes(key)) throw new Error(`unknown D Git persistence key ${key} in ${path}`); for (const key of ["enabled", "push"] as const) bool(gitPersistence[key], `Git persistence ${key}`, path); for (const key of ["remote", "branch"] as const) if (gitPersistence[key] !== undefined && (typeof gitPersistence[key] !== "string" || !gitPersistence[key].trim())) throw new Error(`invalid D Git persistence ${key} in ${path}`); }
  const features = object(value.features, "features", path);
  if (features) for (const key of ["requirementIdValidation", "functionalDesignDocumentDiscipline", "sourceGrounding", "specGrounding"] as const) bool(features[key], `feature ${key}`, path);
  const featureInputs = object(value.featureInputs, "feature inputs", path);
  if (featureInputs) {
    strings(featureInputs.sourceRoots, "feature sourceRoots", path); strings(featureInputs.specRoots, "feature specRoots", path);
    if (featureInputs.requirementIdBridges !== undefined && (!Array.isArray(featureInputs.requirementIdBridges) || !featureInputs.requirementIdBridges.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).uiAc === "string" && typeof (entry as Record<string, unknown>).officialId === "string"))) throw new Error(`invalid D requirementIdBridges in ${path}`);
    const budgets = object(featureInputs.functionalDesignBudgets, "functional design budgets", path);
    if (budgets) for (const key of ["artifactBytes", "unitBytes", "metadataBytes"] as const) if (budgets[key] !== undefined && (!Number.isSafeInteger(budgets[key]) || Number(budgets[key]) <= 0)) throw new Error(`invalid D functional design budget ${key} in ${path}`);
  }
  const auto = object(value.auto, "auto", path);
  if (auto) { for (const key of ["enabled", "sessionOnly", "assumptionLedger"] as const) bool(auto[key], `auto ${key}`, path); if (auto.through !== undefined && (typeof auto.through !== "string" || !auto.through.trim())) throw new Error(`invalid D auto through in ${path}`); if (auto.ambiguityPolicy !== undefined && !["halt", "assume", "research"].includes(String(auto.ambiguityPolicy))) throw new Error(`invalid D auto ambiguityPolicy in ${path}`); if (auto.maxRetries !== undefined && (!Number.isSafeInteger(auto.maxRetries) || Number(auto.maxRetries) < 0 || Number(auto.maxRetries) > 10)) throw new Error(`invalid D auto maxRetries in ${path}`); strings(auto.labelAllowlist, "auto labelAllowlist", path); }
  const issueAutopilot = object(value.issueAutopilot, "issue autopilot", path);
  if (issueAutopilot) for (const key of ["enabled", "oneIssuePerRun"] as const) bool(issueAutopilot[key], `issue autopilot ${key}`, path);
  return { models: result, clef: clef as Partial<DClefConfig>, gitPersistence: gitPersistence as Partial<DGitPersistenceConfig>, features: features as Partial<DFeatureFlags>, featureInputs: featureInputs as Partial<DFeatureInputs>, auto: auto as Partial<DAutomationConfig>, issueAutopilot: issueAutopilot as Partial<DIssueAutopilotConfig> };
}
function layers(projectDir: string) { return { project: readConfig(join(projectDir, ".claude", "d-acceleration.json")), local: readConfig(join(projectDir, ".claude", "d-acceleration.local.json")) }; }

export function resolveDGitPersistence(projectDir: string): DGitPersistenceConfig { const { project, local } = layers(projectDir), base = project.gitPersistence ?? {}, override = local.gitPersistence ?? {}; return { enabled: override.enabled ?? base.enabled ?? false, push: override.push ?? base.push ?? false, remote: (override.remote ?? base.remote ?? "origin").trim(), branch: override.branch?.trim() ?? base.branch?.trim() }; }
export function resolveDModels(projectDir: string, cli: Partial<DModelCatalog> = {}): { models: DModelCatalog; sources: Record<DModelTier, "cli" | "local" | "project" | "default"> } { const { project, local } = layers(projectDir), models = {} as DModelCatalog, sources = {} as Record<DModelTier, "cli" | "local" | "project" | "default">; for (const tier of ["fast", "balanced", "judgment"] as const) { const choices = [[cli[tier], "cli"], [local.models[tier], "local"], [project.models[tier], "project"], [DEFAULT_D_MODEL, "default"]] as const, selected = choices.find(([model]) => typeof model === "string" && model.trim())!; models[tier] = selected[0]!.trim(); sources[tier] = selected[1]; } return { models, sources }; }
export function resolveDClef(projectDir: string): DClefConfig { const { project, local } = layers(projectDir), base = project.clef ?? {}, override = local.clef ?? {}; return { enabled: override.enabled ?? base.enabled ?? false, url: override.url ?? base.url ?? DEFAULT_CLEF_URL, lowRiskUnits: [...new Set((override.lowRiskUnits ?? base.lowRiskUnits ?? []).map((unit) => unit.trim()))] }; }
export function resolveDFeatureFlags(projectDir: string): DFeatureFlags { const { project, local } = layers(projectDir), base = project.features ?? {}, override = local.features ?? {}; return { requirementIdValidation: override.requirementIdValidation ?? base.requirementIdValidation ?? false, functionalDesignDocumentDiscipline: override.functionalDesignDocumentDiscipline ?? base.functionalDesignDocumentDiscipline ?? false, sourceGrounding: override.sourceGrounding ?? base.sourceGrounding ?? false, specGrounding: override.specGrounding ?? base.specGrounding ?? false }; }
export function resolveDFeatureInputs(projectDir: string): DFeatureInputs { const { project, local } = layers(projectDir), base = project.featureInputs ?? {}, override = local.featureInputs ?? {}, baseBudget = base.functionalDesignBudgets ?? {}, overrideBudget = override.functionalDesignBudgets ?? {}; return { requirementIdBridges: override.requirementIdBridges ?? base.requirementIdBridges ?? [], functionalDesignBudgets: { artifactBytes: overrideBudget.artifactBytes ?? baseBudget.artifactBytes ?? 60_000, unitBytes: overrideBudget.unitBytes ?? baseBudget.unitBytes ?? 160_000, metadataBytes: overrideBudget.metadataBytes ?? baseBudget.metadataBytes ?? 30_000 }, sourceRoots: override.sourceRoots ?? base.sourceRoots ?? [], specRoots: override.specRoots ?? base.specRoots ?? [] }; }
export function resolveDAutomation(projectDir: string): DAutomationConfig { const { project, local } = layers(projectDir), base = project.auto ?? {}, override = local.auto ?? {}; return { enabled: override.enabled ?? base.enabled ?? false, through: override.through?.trim() ?? base.through?.trim(), sessionOnly: override.sessionOnly ?? base.sessionOnly ?? true, ambiguityPolicy: override.ambiguityPolicy ?? base.ambiguityPolicy ?? "halt", assumptionLedger: override.assumptionLedger ?? base.assumptionLedger ?? true, maxRetries: override.maxRetries ?? base.maxRetries ?? 2, labelAllowlist: override.labelAllowlist ?? base.labelAllowlist ?? [] }; }
export function resolveDIssueAutopilot(projectDir: string): DIssueAutopilotConfig { const { project, local } = layers(projectDir), base = project.issueAutopilot ?? {}, override = local.issueAutopilot ?? {}; return { enabled: override.enabled ?? base.enabled ?? false, oneIssuePerRun: override.oneIssuePerRun ?? base.oneIssuePerRun ?? true }; }
export function resolveDConfig(projectDir: string): DResolvedConfig { return { features: resolveDFeatureFlags(projectDir), featureInputs: resolveDFeatureInputs(projectDir), auto: resolveDAutomation(projectDir), issueAutopilot: resolveDIssueAutopilot(projectDir) }; }
export function clefRunnerArgs(config: DClefConfig): string[] { return config.enabled ? ["--clef-url", config.url, ...(config.lowRiskUnits.length ? ["--clef-low-risk-units", config.lowRiskUnits.join(",")] : [])] : []; }
