import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { OFFICIAL_PHASES, OFFICIAL_STAGES } from "./issue-autopilot.ts";
import { DEFAULT_GROUNDING_LIMITS, groundingLimitError, type GroundingLimits } from "./grounding.ts";

/** One owner for the fail-closed notice used by config, planner input, and runner flags. */
export const CLEF_REMOVED = "Clef routing support was removed from D (owner decision 2026-10-17)";
export const DECISION_RECORD_PATH_REMOVED = "aiApproval.decisionRecordPath was removed from D: the decision summary now reads the fixed D ledger decisions/ai-question-answers.jsonl";
export type DModelTier = "fast" | "balanced" | "judgment";
export type DModelCatalog = Record<DModelTier, string>;
export type DGitPersistenceConfig = { enabled: boolean; push: boolean; remote: string; branch?: string };
export type DFeatureFlags = { requirementIdValidation: boolean; functionalDesignDocumentDiscipline: boolean; sourceGrounding: boolean; specGrounding: boolean; mockupPngGeneration: boolean; visualRegression: boolean };
export type DAmbiguityPolicy = "halt" | "assume" | "research";
export type DAutomationConfig = { enabled: boolean; through?: string; sessionOnly: boolean; ambiguityPolicy: DAmbiguityPolicy; assumptionLedger: boolean; maxRetries: number; maxSteps: number; deadlineMs: number; labelAllowlist: string[] };
export type DIssueAutopilotConfig = { enabled: boolean; oneIssuePerRun: boolean };
export type DAiApprovalConfig = { mode: "human" | "stage-gates"; minConfidence: number };
export type DDecisionIssueSummaryConfig = { enabled: boolean; repository?: string; send: boolean; maxRetries: number };
export type DConstructionDefaults = { iteration: "official" | "stage-major"; execution: "official" | "swarm" };
export type DParallelConfig = { enabled: boolean };
export type DFeatureInputs = { requirementIdBridges: Array<{ uiAc: string; officialId: string }>; functionalDesignBudgets: { artifactBytes: number; unitBytes: number; metadataBytes: number }; sourceRoots: string[]; specRoots: string[]; groundingLimits: GroundingLimits };
export type DResolvedConfig = { features: DFeatureFlags; featureInputs: DFeatureInputs; auto: DAutomationConfig; issueAutopilot: DIssueAutopilotConfig; aiApproval: DAiApprovalConfig; decisionIssueSummary: DDecisionIssueSummaryConfig; parallel: DParallelConfig; constructionDefaults: DConstructionDefaults };
export const DEFAULT_D_MODEL = "opus";

type DFileConfig = { models: Partial<DModelCatalog>; gitPersistence?: Partial<DGitPersistenceConfig>; features?: Partial<DFeatureFlags>; featureInputs?: Partial<DFeatureInputs>; auto?: Partial<DAutomationConfig>; issueAutopilot?: Partial<DIssueAutopilotConfig>; aiApproval?: Partial<DAiApprovalConfig>; decisionIssueSummary?: Partial<DDecisionIssueSummaryConfig>; parallel?: Partial<DParallelConfig>; constructionDefaults?: Partial<DConstructionDefaults> };

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
  if (value.clef !== undefined) throw new Error(`${CLEF_REMOVED}; delete the "clef" key from ${path}`);
  const gitPersistence = object(value.gitPersistence, "Git persistence", path);
  if (gitPersistence) { for (const key of Object.keys(gitPersistence)) if (!["enabled", "push", "remote", "branch"].includes(key)) throw new Error(`unknown D Git persistence key ${key} in ${path}`); for (const key of ["enabled", "push"] as const) bool(gitPersistence[key], `Git persistence ${key}`, path); for (const key of ["remote", "branch"] as const) if (gitPersistence[key] !== undefined && (typeof gitPersistence[key] !== "string" || !gitPersistence[key].trim())) throw new Error(`invalid D Git persistence ${key} in ${path}`); }
  const features = object(value.features, "features", path);
  if (features) for (const key of ["requirementIdValidation", "functionalDesignDocumentDiscipline", "sourceGrounding", "specGrounding", "mockupPngGeneration", "visualRegression"] as const) bool(features[key], `feature ${key}`, path);
  const featureInputs = object(value.featureInputs, "feature inputs", path);
  if (featureInputs) {
    strings(featureInputs.sourceRoots, "feature sourceRoots", path); strings(featureInputs.specRoots, "feature specRoots", path);
    if (featureInputs.requirementIdBridges !== undefined && (!Array.isArray(featureInputs.requirementIdBridges) || !featureInputs.requirementIdBridges.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).uiAc === "string" && typeof (entry as Record<string, unknown>).officialId === "string"))) throw new Error(`invalid D requirementIdBridges in ${path}`);
    const budgets = object(featureInputs.functionalDesignBudgets, "functional design budgets", path);
    if (budgets) for (const key of ["artifactBytes", "unitBytes", "metadataBytes"] as const) if (budgets[key] !== undefined && (!Number.isSafeInteger(budgets[key]) || Number(budgets[key]) <= 0)) throw new Error(`invalid D functional design budget ${key} in ${path}`);
    // Grounding caps: one validity rule (grounding.ts), never clamped.
    const limits = object(featureInputs.groundingLimits, "grounding limits", path);
    if (limits) {
      for (const key of Object.keys(limits)) if (!["maxEvidenceFiles", "maxInputBytes"].includes(key)) throw new Error(`unknown D featureInputs.groundingLimits key ${key} in ${path} (allowed: maxEvidenceFiles, maxInputBytes)`);
      for (const key of ["maxEvidenceFiles", "maxInputBytes"] as const) { const error = limits[key] === undefined ? null : groundingLimitError(key, limits[key]); if (error) throw new Error(`${error} in ${path}`); }
    }
  }
  const auto = object(value.auto, "auto", path);
  if (auto) { for (const key of ["enabled", "sessionOnly", "assumptionLedger"] as const) bool(auto[key], `auto ${key}`, path); if (auto.through !== undefined && (typeof auto.through !== "string" || (!OFFICIAL_STAGES.has(auto.through) && !OFFICIAL_PHASES.has(auto.through)))) throw new Error(`invalid D auto through in ${path}`); if (auto.ambiguityPolicy !== undefined && !["halt", "assume", "research"].includes(String(auto.ambiguityPolicy))) throw new Error(`invalid D auto ambiguityPolicy in ${path}`); if (auto.maxRetries !== undefined && (!Number.isSafeInteger(auto.maxRetries) || Number(auto.maxRetries) < 0 || Number(auto.maxRetries) > 10)) throw new Error(`invalid D auto maxRetries in ${path}`); if (auto.maxSteps !== undefined && (!Number.isSafeInteger(auto.maxSteps) || Number(auto.maxSteps) < 1 || Number(auto.maxSteps) > 1000)) throw new Error(`invalid D auto maxSteps in ${path}`); if (auto.deadlineMs !== undefined && (!Number.isSafeInteger(auto.deadlineMs) || Number(auto.deadlineMs) < 1000 || Number(auto.deadlineMs) > 86_400_000)) throw new Error(`invalid D auto deadlineMs in ${path}`); strings(auto.labelAllowlist, "auto labelAllowlist", path); }
  const issueAutopilot = object(value.issueAutopilot, "issue autopilot", path);
  if (issueAutopilot) {
    for (const key of ["enabled", "oneIssuePerRun"] as const) bool(issueAutopilot[key], `issue autopilot ${key}`, path);
    // The one-Issue bound is a fixed safety contract, not a tunable: false used
    // to be accepted and silently ignored. Refuse it so the setting cannot lie.
    if (issueAutopilot.oneIssuePerRun === false) throw new Error(`issueAutopilot.oneIssuePerRun=false is not supported in ${path}: every run processes at most one Issue; repeat runs with /loop instead`);
  }
  const aiApproval = object(value.aiApproval, "AI approval", path);
  if (aiApproval) {
    if (aiApproval.mode !== undefined && !["human", "stage-gates"].includes(String(aiApproval.mode))) throw new Error(`invalid D AI approval mode in ${path}`);
    if (aiApproval.minConfidence !== undefined && (typeof aiApproval.minConfidence !== "number" || !Number.isFinite(aiApproval.minConfidence) || aiApproval.minConfidence < 0 || aiApproval.minConfidence > 1)) throw new Error(`invalid D AI approval minConfidence in ${path}`);
    if (aiApproval.decisionRecordPath !== undefined) throw new Error(`${DECISION_RECORD_PATH_REMOVED}; delete "aiApproval.decisionRecordPath" from ${path}`);
  }
  const decisionIssueSummary = object(value.decisionIssueSummary, "decision Issue summary", path);
  if (decisionIssueSummary) {
    for (const key of ["enabled", "send"] as const) bool(decisionIssueSummary[key], `decision Issue summary ${key}`, path);
    if (decisionIssueSummary.repository !== undefined && (typeof decisionIssueSummary.repository !== "string" || !/^(?:[A-Za-z0-9.-]+\.[A-Za-z0-9.-]+\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(decisionIssueSummary.repository))) throw new Error(`invalid D decision Issue summary repository in ${path}`);
    if (decisionIssueSummary.maxRetries !== undefined && (!Number.isSafeInteger(decisionIssueSummary.maxRetries) || Number(decisionIssueSummary.maxRetries) < 0 || Number(decisionIssueSummary.maxRetries) > 5)) throw new Error(`invalid D decision Issue summary maxRetries in ${path}`);
  }
  const constructionDefaults = object(value.constructionDefaults, "construction defaults", path);
  if (constructionDefaults) {
    for (const key of Object.keys(constructionDefaults)) if (!["iteration", "execution"].includes(key)) throw new Error(`unknown D construction default ${key} in ${path}`);
    if (constructionDefaults.iteration !== undefined && !["official", "stage-major"].includes(String(constructionDefaults.iteration))) throw new Error(`invalid D construction default iteration in ${path}`);
    if (constructionDefaults.execution !== undefined && !["official", "swarm"].includes(String(constructionDefaults.execution))) throw new Error(`invalid D construction default execution in ${path}`);
  }
  const parallel = object(value.parallel, "parallel", path);
  if (parallel) { for (const key of Object.keys(parallel)) if (key !== "enabled") throw new Error(`unknown D parallel key ${key} in ${path}`); bool(parallel.enabled, "parallel enabled", path); }
  return { models: result, gitPersistence: gitPersistence as Partial<DGitPersistenceConfig>, features: features as Partial<DFeatureFlags>, featureInputs: featureInputs as Partial<DFeatureInputs>, auto: auto as Partial<DAutomationConfig>, issueAutopilot: issueAutopilot as Partial<DIssueAutopilotConfig>, aiApproval: aiApproval as Partial<DAiApprovalConfig>, decisionIssueSummary: decisionIssueSummary as Partial<DDecisionIssueSummaryConfig>, parallel: parallel as Partial<DParallelConfig>, constructionDefaults: constructionDefaults as Partial<DConstructionDefaults> };
}
function configPath(projectDir: string, stem: "d-acceleration" | "d-acceleration.local"): string {
  const directory = join(projectDir, ".claude");
  const jsonc = join(directory, `${stem}.jsonc`);
  const legacyJson = join(directory, `${stem}.json`);
  if (existsSync(jsonc) && existsSync(legacyJson)) {
    throw new Error(`ambiguous D configuration: both ${jsonc} and ${legacyJson} exist; keep only one (prefer ${jsonc})`);
  }
  return existsSync(jsonc) ? jsonc : legacyJson;
}
function layers(projectDir: string) { return { project: readConfig(configPath(projectDir, "d-acceleration")), local: readConfig(configPath(projectDir, "d-acceleration.local")) }; }

export function resolveDGitPersistence(projectDir: string): DGitPersistenceConfig { const { project, local } = layers(projectDir), base = project.gitPersistence ?? {}, override = local.gitPersistence ?? {}; return { enabled: override.enabled ?? base.enabled ?? false, push: override.push ?? base.push ?? false, remote: (override.remote ?? base.remote ?? "origin").trim(), branch: override.branch?.trim() ?? base.branch?.trim() }; }
export function resolveDModels(projectDir: string, cli: Partial<DModelCatalog> = {}): { models: DModelCatalog; sources: Record<DModelTier, "cli" | "local" | "project" | "default"> } { const { project, local } = layers(projectDir), models = {} as DModelCatalog, sources = {} as Record<DModelTier, "cli" | "local" | "project" | "default">; for (const tier of ["fast", "balanced", "judgment"] as const) { const choices = [[cli[tier], "cli"], [local.models[tier], "local"], [project.models[tier], "project"], [DEFAULT_D_MODEL, "default"]] as const, selected = choices.find(([model]) => typeof model === "string" && model.trim())!; models[tier] = selected[0]!.trim(); sources[tier] = selected[1]; } return { models, sources }; }
export function resolveDFeatureFlags(projectDir: string): DFeatureFlags { const { project, local } = layers(projectDir), base = project.features ?? {}, override = local.features ?? {}; return { requirementIdValidation: override.requirementIdValidation ?? base.requirementIdValidation ?? false, functionalDesignDocumentDiscipline: override.functionalDesignDocumentDiscipline ?? base.functionalDesignDocumentDiscipline ?? false, sourceGrounding: override.sourceGrounding ?? base.sourceGrounding ?? false, specGrounding: override.specGrounding ?? base.specGrounding ?? false, mockupPngGeneration: override.mockupPngGeneration ?? base.mockupPngGeneration ?? false, visualRegression: override.visualRegression ?? base.visualRegression ?? false }; }
export function effectivePngGeneration(features: DFeatureFlags): boolean { return features.mockupPngGeneration || features.visualRegression; }
export function resolveDFeatureInputs(projectDir: string): DFeatureInputs { const { project, local } = layers(projectDir), base = project.featureInputs ?? {}, override = local.featureInputs ?? {}, baseBudget = base.functionalDesignBudgets ?? {}, overrideBudget = override.functionalDesignBudgets ?? {}; return { requirementIdBridges: override.requirementIdBridges ?? base.requirementIdBridges ?? [], functionalDesignBudgets: { artifactBytes: overrideBudget.artifactBytes ?? baseBudget.artifactBytes ?? 60_000, unitBytes: overrideBudget.unitBytes ?? baseBudget.unitBytes ?? 160_000, metadataBytes: overrideBudget.metadataBytes ?? baseBudget.metadataBytes ?? 30_000 }, sourceRoots: override.sourceRoots ?? base.sourceRoots ?? [], specRoots: override.specRoots ?? base.specRoots ?? [], groundingLimits: { maxEvidenceFiles: override.groundingLimits?.maxEvidenceFiles ?? base.groundingLimits?.maxEvidenceFiles ?? DEFAULT_GROUNDING_LIMITS.maxEvidenceFiles, maxInputBytes: override.groundingLimits?.maxInputBytes ?? base.groundingLimits?.maxInputBytes ?? DEFAULT_GROUNDING_LIMITS.maxInputBytes } }; }
export function resolveDAutomation(projectDir: string): DAutomationConfig { const { project, local } = layers(projectDir), base = project.auto ?? {}, override = local.auto ?? {}; return { enabled: override.enabled ?? base.enabled ?? false, through: override.through?.trim() ?? base.through?.trim(), sessionOnly: override.sessionOnly ?? base.sessionOnly ?? true, ambiguityPolicy: override.ambiguityPolicy ?? base.ambiguityPolicy ?? "halt", assumptionLedger: override.assumptionLedger ?? base.assumptionLedger ?? true, maxRetries: override.maxRetries ?? base.maxRetries ?? 2, maxSteps: override.maxSteps ?? base.maxSteps ?? 64, deadlineMs: override.deadlineMs ?? base.deadlineMs ?? 900_000, labelAllowlist: override.labelAllowlist ?? base.labelAllowlist ?? [] }; }
export function resolveDIssueAutopilot(projectDir: string): DIssueAutopilotConfig { const { project, local } = layers(projectDir), base = project.issueAutopilot ?? {}, override = local.issueAutopilot ?? {}; return { enabled: override.enabled ?? base.enabled ?? false, oneIssuePerRun: override.oneIssuePerRun ?? base.oneIssuePerRun ?? true }; }
export function resolveDAiApproval(projectDir: string): DAiApprovalConfig { const { project, local } = layers(projectDir), base = project.aiApproval ?? {}, override = local.aiApproval ?? {}; return { mode: override.mode ?? base.mode ?? "human", minConfidence: override.minConfidence ?? base.minConfidence ?? 0.9 }; }
export function resolveDDecisionIssueSummary(projectDir: string): DDecisionIssueSummaryConfig { const { project, local } = layers(projectDir), base = project.decisionIssueSummary ?? {}, override = local.decisionIssueSummary ?? {}; return { enabled: override.enabled ?? base.enabled ?? false, repository: override.repository?.trim() ?? base.repository?.trim(), send: override.send ?? base.send ?? false, maxRetries: override.maxRetries ?? base.maxRetries ?? 2 }; }
export function resolveDParallel(projectDir: string): DParallelConfig { const { project, local } = layers(projectDir); return { enabled: local.parallel?.enabled ?? project.parallel?.enabled ?? true }; }
export function resolveDConstructionDefaults(projectDir: string): DConstructionDefaults { const { project, local } = layers(projectDir), base = project.constructionDefaults ?? {}, override = local.constructionDefaults ?? {}; const resolved: DConstructionDefaults = { iteration: override.iteration ?? base.iteration ?? "official", execution: override.execution ?? base.execution ?? "official" }; if (resolved.execution === "swarm" && resolved.iteration !== "stage-major") throw new Error("D constructionDefaults.execution=swarm requires constructionDefaults.iteration=stage-major"); return resolveDParallel(projectDir).enabled ? resolved : { iteration: "official", execution: "official" }; }
export function resolveDConfig(projectDir: string): DResolvedConfig { return { features: resolveDFeatureFlags(projectDir), featureInputs: resolveDFeatureInputs(projectDir), auto: resolveDAutomation(projectDir), issueAutopilot: resolveDIssueAutopilot(projectDir), aiApproval: resolveDAiApproval(projectDir), decisionIssueSummary: resolveDDecisionIssueSummary(projectDir), parallel: resolveDParallel(projectDir), constructionDefaults: resolveDConstructionDefaults(projectDir) }; }

export type DPrerequisite = { setting: string; requires: string; satisfied: boolean };
/**
 * Deterministic prerequisites of every enabled D switch, from configuration
 * and project facts only (no network, no model). Disabled switches add no
 * rows, so an all-OFF configuration reports nothing to satisfy. Preflight
 * prints every row so the person sees exactly which ON switch is not ready.
 */
export function checkDPrerequisites(projectDir: string, env: Record<string, string | undefined> = process.env): DPrerequisite[] {
  const config = resolveDConfig(projectDir), git = resolveDGitPersistence(projectDir);
  const rows: DPrerequisite[] = [];
  const need = (setting: string, requires: string, satisfied: boolean) => rows.push({ setting, requires, satisfied });
  if (config.features.sourceGrounding) need("features.sourceGrounding", "featureInputs.sourceRoots is non-empty", config.featureInputs.sourceRoots.length > 0);
  if (config.features.specGrounding) need("features.specGrounding", "featureInputs.specRoots is non-empty", config.featureInputs.specRoots.length > 0);
  if (config.features.requirementIdValidation || config.features.mockupPngGeneration || config.features.visualRegression) {
    const contract = join(projectDir, ".claude", "tools", "ui-poc", "c-stage-routing.json");
    for (const name of ["requirementIdValidation", "mockupPngGeneration", "visualRegression"] as const) {
      if (config.features[name]) need(`features.${name}`, "composed C UI contract (.claude/tools/ui-poc/c-stage-routing.json)", existsSync(contract));
    }
  }
  if (config.issueAutopilot.enabled) {
    need("issueAutopilot.enabled", "auto.enabled is true", config.auto.enabled);
    need("issueAutopilot.enabled", "auto.labelAllowlist is non-empty", config.auto.labelAllowlist.length > 0);
  }
  if (git.push) need("gitPersistence.push", "gitPersistence.enabled is true", git.enabled);
  if (git.enabled) need("gitPersistence.enabled", "PRODUCT is a Git repository", existsSync(join(projectDir, ".git")));
  if (git.enabled && git.push) {
    const remote = spawnSync("git", ["-C", projectDir, "remote", "get-url", git.remote], { encoding: "utf8" });
    need("gitPersistence.push", `Git remote "${git.remote}" exists`, remote.status === 0 && Boolean(remote.stdout.trim()));
  }
  if (config.decisionIssueSummary.enabled) need("decisionIssueSummary.enabled", "decisionIssueSummary.repository is owner/name", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.decisionIssueSummary.repository ?? ""));
  if (config.decisionIssueSummary.send) {
    need("decisionIssueSummary.send", "decisionIssueSummary.enabled is true", config.decisionIssueSummary.enabled);
    need("decisionIssueSummary.send", "host env AIDLC_GH_EXECUTABLE_PATH and AIDLC_GH_EXECUTABLE_SHA256 are set", Boolean(env.AIDLC_GH_EXECUTABLE_PATH && env.AIDLC_GH_EXECUTABLE_SHA256));
  }
  return rows;
}



if (import.meta.main) {
  const [command, projectDir] = process.argv.slice(2);
  if (command !== "print-ai-approval" || !projectDir || !isAbsolute(projectDir)) {
    process.stderr.write("usage: d-config.ts print-ai-approval ABS_PROJECT_DIR\n");
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(resolveDAiApproval(projectDir))}\n`);
}

/**
 * Parent-session vs D-worker model contract reported by `run.ts --preflight`.
 * The parent session's model is not observable from a child process: the CLI
 * offers no query for it, and D cannot switch it. A caller may report it with
 * AIDLC_PARENT_MODEL; that report stays labelled unverified. D workers always
 * pass an explicit `--model`, so a parent default (ANTHROPIC_MODEL,
 * CLAUDE_CODE_SUBAGENT_MODEL) never selects a worker's model; each worker
 * result carries its own runtime-reported identity.
 */
export function resolveDModelContract(projectDir: string, parentReport: string | undefined, cli: Partial<DModelCatalog> = {}) {
  const requested = resolveDModels(projectDir, cli);
  const observedParentModel = parentReport?.trim() || null;
  const parentMatches = observedParentModel?.toLowerCase().includes("opus") === true;
  const requiredAction = "Select Opus in the parent Claude session when Opus-first execution is required.";
  const parentSession = observedParentModel
    ? { status: parentMatches ? "caller-reported-match" : "caller-reported-mismatch", source: "unverified-caller-report", model: observedParentModel, ...(parentMatches ? {} : { requiredAction }) }
    : { status: "not-observable", source: "none", model: null, requiredAction };
  return {
    parentSession,
    dWorkers: {
      requested: requested.models,
      sources: requested.sources,
      effortByTier: { fast: "low", balanced: "medium", judgment: "high" },
      selection: "explicit --model per worker launch; independent of the parent session model",
      runtimeIdentity: "reported-per-worker-result",
      identityStatuses: ["verified-match", "alias-resolved", "mismatch", "unverified"],
    },
    separation: "D can request a worker model but cannot switch or prove the already-running parent session model.",
  };
}
