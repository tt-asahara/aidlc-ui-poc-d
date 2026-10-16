import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export type GroundingLane = "source" | "spec";
export type GroundingStage = "domain-design" | "functional-design" | "code-generation";
export type GroundingFeatureConfig = { enabled?: boolean; roots?: string[] };
export type GroundingConfig = { sourceGrounding?: GroundingFeatureConfig; specGrounding?: GroundingFeatureConfig };
export type GroundingFinding = {
  code: "confirmed" | "refuted" | "grounding-unavailable";
  severity: "info" | "warn" | "error";
  claim: string;
  evidencePaths: string[];
  detail: string;
};
export type GroundingWorkerResult = { findings: GroundingFinding[]; uncertainty: string[]; approval?: unknown };
export type GroundingTask = {
  lane: GroundingLane;
  stage: GroundingStage;
  objective: string;
  artifactPaths: string[];
  evidenceRoots: string[];
  prompt: string;
  tools: readonly ["Read", "Grep", "Glob"];
  writesAllowed: false;
};
export type GroundingRunResult =
  | { action: "disabled"; lane: GroundingLane; workerCalls: 0; artifactsWritten: 0; reviewsRun: 0 }
  | { action: "not-applicable"; lane: GroundingLane; stage: GroundingStage; workerCalls: 0; artifactsWritten: 0; reviewsRun: 0 }
  | { action: "grounding-findings"; lane: GroundingLane; stage: GroundingStage; workerCalls: 1; artifactsWritten: 0; reviewsRun: 0; verdict: "READY" | "NOT-READY"; findings: GroundingFinding[]; uncertainty: string[]; approvalRecorded: false };

export type GroundingWorker = (task: GroundingTask) => Promise<GroundingWorkerResult>;

const SOURCE_STAGES = new Set<GroundingStage>(["domain-design"]);
const SPEC_STAGES = new Set<GroundingStage>(["domain-design", "functional-design", "code-generation"]);
const ALLOWED_CODES = new Set(["confirmed", "refuted", "grounding-unavailable"]);
const ALLOWED_SEVERITIES = new Set(["info", "warn", "error"]);

function boundedExistingPath(projectDir: string, candidate: string): string {
  const root = realpathSync(projectDir);
  const requested = isAbsolute(candidate) ? candidate : resolve(root, candidate);
  if (!existsSync(requested)) throw new Error(`grounding path does not exist: ${candidate}`);
  const canonical = realpathSync(requested);
  const rel = relative(root, canonical);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`grounding path escapes project: ${candidate}`);
  return canonical;
}

function feature(config: GroundingConfig, lane: GroundingLane): GroundingFeatureConfig {
  return lane === "source" ? config.sourceGrounding ?? {} : config.specGrounding ?? {};
}

function insideAnyRoot(path: string, roots: string[]): boolean {
  return roots.some((root) => {
    const rel = relative(root, path);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

function validateResult(value: GroundingWorkerResult, projectDir: string, evidenceRoots: string[]): GroundingWorkerResult {
  if (!value || !Array.isArray(value.findings) || !Array.isArray(value.uncertainty)) throw new Error("grounding worker returned an invalid result");
  if (value.approval !== undefined) throw new Error("grounding workers must not create or claim approval");
  const findings = value.findings.map((finding) => {
    if (!ALLOWED_CODES.has(finding.code) || !ALLOWED_SEVERITIES.has(finding.severity) || !finding.claim?.trim() || !finding.detail?.trim() || !Array.isArray(finding.evidencePaths)) {
      throw new Error("grounding worker returned an invalid finding");
    }
    const evidencePaths = finding.evidencePaths.map((path) => boundedExistingPath(projectDir, path));
    if (evidencePaths.some((path) => !insideAnyRoot(path, evidenceRoots))) throw new Error("grounding evidence path is outside configured roots");
    if ((finding.code === "confirmed" || finding.code === "refuted") && evidencePaths.length === 0) {
      throw new Error(`grounding ${finding.code} finding requires at least one evidence path`);
    }
    return { ...finding, evidencePaths };
  });
  return { findings, uncertainty: value.uncertainty.map((item) => String(item).trim()).filter(Boolean) };
}

export function planGrounding(input: {
  lane: GroundingLane;
  stage: GroundingStage;
  projectDir: string;
  artifactPaths: string[];
  config: GroundingConfig;
}): GroundingTask | { action: "disabled" | "not-applicable" } {
  const selected = feature(input.config, input.lane);
  if (selected.enabled !== true) return { action: "disabled" };
  const applicable = input.lane === "source" ? SOURCE_STAGES : SPEC_STAGES;
  if (!applicable.has(input.stage)) return { action: "not-applicable" };
  if (!input.artifactPaths.length) throw new Error("grounding requires at least one stage artifact");
  const artifactPaths = input.artifactPaths.map((path) => boundedExistingPath(input.projectDir, path));
  const roots = selected.roots ?? [];
  if (!roots.length) throw new Error(`${input.lane} grounding is enabled but no roots are configured`);
  const evidenceRoots = roots.map((path) => boundedExistingPath(input.projectDir, path));
  const subject = input.lane === "source" ? "実装ソース" : "既存仕様書";
  return {
    lane: input.lane,
    stage: input.stage,
    objective: `stage成果物の主張を${subject}と照合し、確認・反証・未確認を根拠付きで返す`,
    artifactPaths,
    evidenceRoots,
    prompt: [
      `Grounding lane: ${input.lane}; stage: ${input.stage}.`,
      `Artifacts: ${artifactPaths.join(", ")}`,
      `Bounded evidence roots: ${evidenceRoots.join(", ")}`,
      "Read only within the supplied paths. Return structured findings with exact evidence paths.",
      "Use grounding-unavailable for anything not verified. Never infer, create, or report human approval.",
      "Do not edit stage artifacts, workflow state, approval ledgers, or review receipts.",
    ].join("\n"),
    tools: ["Read", "Grep", "Glob"],
    writesAllowed: false,
  };
}

export async function runGrounding(input: {
  lane: GroundingLane;
  stage: GroundingStage;
  projectDir: string;
  artifactPaths: string[];
  config: GroundingConfig;
  worker: GroundingWorker;
}): Promise<GroundingRunResult> {
  const planned = planGrounding(input);
  if ("action" in planned) return { action: planned.action, lane: input.lane, stage: input.stage, workerCalls: 0, artifactsWritten: 0, reviewsRun: 0 } as GroundingRunResult;
  const result = validateResult(await input.worker(planned), input.projectDir, planned.evidenceRoots);
  return {
    action: "grounding-findings",
    lane: input.lane,
    stage: input.stage,
    workerCalls: 1,
    artifactsWritten: 0,
    reviewsRun: 0,
    verdict: result.findings.length === 0 || result.uncertainty.length > 0 || result.findings.some((finding) => finding.severity === "error" || finding.code === "refuted" || finding.code === "grounding-unavailable") ? "NOT-READY" : "READY",
    findings: result.findings,
    uncertainty: result.uncertainty,
    approvalRecorded: false,
  };
}
