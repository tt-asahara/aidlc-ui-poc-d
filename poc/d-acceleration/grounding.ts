import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export type GroundingLane = "source" | "spec";
export type GroundingStage = "domain-design" | "functional-design" | "code-generation";
/** Per-lane snapshot caps. Resolved by the caller (d-config.ts owns project/local precedence). */
export type GroundingLimits = { maxEvidenceFiles: number; maxInputBytes: number };
export type GroundingFeatureConfig = { enabled?: boolean; roots?: string[]; limits?: GroundingLimits };
export type GroundingConfig = { sourceGrounding?: GroundingFeatureConfig; specGrounding?: GroundingFeatureConfig };
export type GroundingFinding = {
  code: "confirmed" | "refuted" | "grounding-unavailable";
  severity: "info" | "warn" | "error";
  claim: string;
  evidencePaths: string[];
  detail: string;
};
export type GroundingWorkerResult = { findings: GroundingFinding[]; uncertainty: string[]; approval?: unknown };
/** One file read by the tool (never by the model): canonical path, content hash, and size at snapshot time. */
export type GroundingSnapshotEntry = { path: string; sha256: string; bytes: number };
/** Git provenance at citation time (null outside a git work tree). Advisory: the content hash is the staleness authority. */
export type GroundingGitProvenance = { head: string; uncommittedCitedPaths: string[] } | null;
export type GroundingTask = {
  lane: GroundingLane;
  stage: GroundingStage;
  objective: string;
  artifactPaths: string[];
  evidenceRoots: string[];
  /** Deterministic, bounded, symlink-free snapshot. The worker sees only these files. */
  artifactFiles: GroundingSnapshotEntry[];
  evidenceFiles: GroundingSnapshotEntry[];
  /** The effective caps this snapshot was bounded by. */
  limits: GroundingLimits;
  prompt: string;
  tools: readonly ["Read", "Grep", "Glob"];
  writesAllowed: false;
};
export type GroundingRejectedRoot = { root: string; reason: string };
export type GroundingRunResult =
  | { action: "disabled"; lane: GroundingLane; workerCalls: 0; artifactsWritten: 0; reviewsRun: 0 }
  | { action: "not-applicable"; lane: GroundingLane; stage: GroundingStage; workerCalls: 0; artifactsWritten: 0; reviewsRun: 0 }
  | { action: "off-no-valid-roots"; lane: GroundingLane; stage: GroundingStage; workerCalls: 0; artifactsWritten: 0; reviewsRun: 0; verdict: "NOT-READY"; compliance: "not-claimed"; rejectedRoots: GroundingRejectedRoot[]; detail: string; approvalRecorded: false }
  | { action: "grounding-findings"; lane: GroundingLane; stage: GroundingStage; workerCalls: 1; artifactsWritten: 0; reviewsRun: 0; verdict: "READY" | "NOT-READY"; compliance: "grounded" | "not-claimed"; findings: GroundingFinding[]; uncertainty: string[]; citedEvidence: GroundingSnapshotEntry[]; artifacts: GroundingSnapshotEntry[]; limits: GroundingLimits; git: GroundingGitProvenance; approvalRecorded: false };

export type GroundingWorker = (task: GroundingTask) => Promise<GroundingWorkerResult>;

/** Default snapshot limits per lane. Exceeding either fails closed before any model call. */
export const GROUNDING_MAX_EVIDENCE_FILES = 200;
export const GROUNDING_MAX_INPUT_BYTES = 1_000_000;
export const DEFAULT_GROUNDING_LIMITS: GroundingLimits = { maxEvidenceFiles: GROUNDING_MAX_EVIDENCE_FILES, maxInputBytes: GROUNDING_MAX_INPUT_BYTES };
/**
 * Hard ceilings for configured limits. The whole hashed snapshot is embedded in
 * one worker prompt, so bytes bound prompt size and cost: 4,000,000 bytes is
 * roughly the 1,000,000-token context window of the largest worker model at
 * ~4 bytes/token; a larger snapshot cannot fit one prompt and would only fail
 * after spending the call. 5,000 files bounds the deterministic walk/hash time
 * and per-file prompt headers well inside that byte budget.
 */
export const GROUNDING_LIMIT_CEILINGS: GroundingLimits = { maxEvidenceFiles: 5_000, maxInputBytes: 4_000_000 };
const LIMIT_KEY = "featureInputs.groundingLimits";

/**
 * The single validity rule for a grounding limit: a positive safe integer no
 * greater than its ceiling. Returns a one-line error naming the key and the
 * allowed range, or null. Values are never clamped.
 */
export function groundingLimitError(key: keyof GroundingLimits, value: unknown): string | null {
  const ceiling = GROUNDING_LIMIT_CEILINGS[key];
  if (Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= ceiling) return null;
  return `invalid ${LIMIT_KEY}.${key}: ${JSON.stringify(value) ?? String(value)} (allowed: integer 1..${ceiling})`;
}
export function assertGroundingLimits(limits: GroundingLimits): GroundingLimits {
  for (const key of ["maxEvidenceFiles", "maxInputBytes"] as const) { const error = groundingLimitError(key, limits?.[key]); if (error) throw new Error(error); }
  return { maxEvidenceFiles: limits.maxEvidenceFiles, maxInputBytes: limits.maxInputBytes };
}

const SOURCE_STAGES = new Set<GroundingStage>(["domain-design"]);
const SPEC_STAGES = new Set<GroundingStage>(["domain-design", "functional-design", "code-generation"]);
const ALLOWED_CODES = new Set(["confirmed", "refuted", "grounding-unavailable"]);
const ALLOWED_SEVERITIES = new Set(["info", "warn", "error"]);

export const sha256 = (content: Buffer | string) => createHash("sha256").update(content).digest("hex");

/**
 * The single path rule for grounding: the path must exist, stay inside the
 * canonical project root, and be reached without any symlink component (the
 * leaf or any ancestor below the project root). Returns the canonical path.
 */
function boundedNoSymlinkPath(projectDir: string, candidate: string): string {
  if (typeof candidate !== "string" || !candidate.trim() || candidate.includes("\0")) throw new Error(`grounding path is not a usable path: ${JSON.stringify(candidate)}`);
  const root = realpathSync(projectDir);
  const requested = resolve(root, candidate);
  const lexical = relative(root, requested);
  if (lexical.startsWith("..") || isAbsolute(lexical)) throw new Error(`grounding path escapes project: ${candidate}`);
  if (!existsSync(requested)) throw new Error(`grounding path does not exist: ${candidate}`);
  const canonical = realpathSync(requested);
  const rel = relative(root, canonical);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`grounding path escapes project: ${candidate}`);
  if (canonical !== requested) throw new Error(`grounding path traverses a symlink: ${candidate}`);
  return canonical;
}

function boundedEvidenceFile(projectDir: string, candidate: string): string {
  const bounded = boundedNoSymlinkPath(projectDir, candidate);
  if (!lstatSync(bounded).isFile()) throw new Error(`grounding evidence path is not a regular non-symlinked file: ${candidate}`);
  return bounded;
}

function feature(config: GroundingConfig, lane: GroundingLane): GroundingFeatureConfig {
  return lane === "source" ? config.sourceGrounding ?? {} : config.specGrounding ?? {};
}

/** Resolve configured roots. Any invalid root invalidates the lane: partial coverage is never claimed. */
export function resolveGroundingRoots(projectDir: string, roots: unknown): { roots: string[]; rejected: GroundingRejectedRoot[] } {
  if (!Array.isArray(roots) || roots.length === 0) return { roots: [], rejected: [{ root: "", reason: "no roots are configured" }] };
  const accepted: string[] = [], rejected: GroundingRejectedRoot[] = [];
  for (const root of roots) {
    try {
      const canonical = boundedNoSymlinkPath(projectDir, root as string);
      const stat = lstatSync(canonical);
      if (!stat.isDirectory() && !stat.isFile()) throw new Error(`grounding root is neither a directory nor a regular file: ${root}`);
      accepted.push(canonical);
    } catch (error) { rejected.push({ root: String(root), reason: (error as Error).message }); }
  }
  return rejected.length ? { roots: [], rejected } : { roots: [...new Set(accepted)], rejected };
}

function entry(path: string): GroundingSnapshotEntry {
  const content = readFileSync(path);
  return { path, sha256: sha256(content), bytes: content.byteLength };
}

/**
 * Deterministic bounded snapshot owned by the tool. Symlinks anywhere under a
 * root, special files, more than `limits.maxEvidenceFiles` files, or more than
 * `limits.maxInputBytes` declared bytes fail closed before anything is read.
 */
export function snapshotGroundingInputs(artifactPaths: string[], evidenceRoots: string[], limits: GroundingLimits = DEFAULT_GROUNDING_LIMITS): { artifactFiles: GroundingSnapshotEntry[]; evidenceFiles: GroundingSnapshotEntry[] } {
  const { maxEvidenceFiles, maxInputBytes } = assertGroundingLimits(limits);
  const evidence = new Set<string>();
  for (const evidenceRoot of evidenceRoots) {
    const pending = [evidenceRoot];
    while (pending.length) {
      const path = pending.pop()!; const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`grounding evidence contains a symlink: ${path}`);
      if (stat.isDirectory()) { for (const name of readdirSync(path)) pending.push(join(path, name)); continue; }
      if (!stat.isFile()) throw new Error(`grounding evidence contains a non-regular file: ${path}`);
      evidence.add(path);
      if (evidence.size > maxEvidenceFiles) throw new Error(`grounding evidence exceeds ${maxEvidenceFiles} files (${LIMIT_KEY}.maxEvidenceFiles; ceiling ${GROUNDING_LIMIT_CEILINGS.maxEvidenceFiles})`);
    }
  }
  const artifacts = [...new Set(artifactPaths)].sort(), evidenceFiles = [...evidence].sort();
  let declared = 0;
  for (const path of [...artifacts, ...evidenceFiles]) {
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new Error(`grounding input is not a regular file: ${path}`);
    declared += stat.size;
    if (declared > maxInputBytes) throw new Error(`grounding inputs exceed ${maxInputBytes} bytes before read (${LIMIT_KEY}.maxInputBytes; ceiling ${GROUNDING_LIMIT_CEILINGS.maxInputBytes})`);
  }
  const snapshot = { artifactFiles: artifacts.map(entry), evidenceFiles: evidenceFiles.map(entry) };
  const actual = [...snapshot.artifactFiles, ...snapshot.evidenceFiles].reduce((sum, item) => sum + item.bytes, 0);
  if (actual > maxInputBytes) throw new Error(`grounding inputs exceed ${maxInputBytes} bytes while reading (${LIMIT_KEY}.maxInputBytes; ceiling ${GROUNDING_LIMIT_CEILINGS.maxInputBytes})`);
  return snapshot;
}

export type GroundingStaleEntry = { path: string; reason: "missing" | "not-regular-file" | "hash-changed" };

/** Re-hash snapshot entries now. Any missing, replaced, symlinked, or changed file is stale. */
export function recheckGroundingEntries(entries: GroundingSnapshotEntry[]): { fresh: boolean; stale: GroundingStaleEntry[] } {
  const stale: GroundingStaleEntry[] = [];
  for (const item of entries) {
    let stat;
    try { stat = lstatSync(item.path); } catch { stale.push({ path: item.path, reason: "missing" }); continue; }
    if (stat.isSymbolicLink() || !stat.isFile()) { stale.push({ path: item.path, reason: "not-regular-file" }); continue; }
    if (sha256(readFileSync(item.path)) !== item.sha256) stale.push({ path: item.path, reason: "hash-changed" });
  }
  return { fresh: stale.length === 0, stale };
}

/** Read-only git provenance (borrowed from the reference KDDI grounding audit's pinned-commit idea). */
export function groundingGitProvenance(projectDir: string, paths: string[]): GroundingGitProvenance {
  const git = (args: string[]) => spawnSync("git", ["-C", projectDir, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  const head = git(["rev-parse", "--verify", "HEAD"]);
  if (head.status !== 0) return null;
  const top = git(["rev-parse", "--show-toplevel"]);
  const topLevel = top.status === 0 ? realpathSync(top.stdout.trim()) : realpathSync(projectDir);
  const status = paths.length ? git(["status", "--porcelain=v1", "--", ...paths.map((path) => relative(topLevel, path))]) : { status: 0, stdout: "" };
  const uncommitted = status.status === 0 ? status.stdout.split("\n").filter(Boolean).map((line) => resolve(topLevel, line.slice(3))) : paths;
  return { head: head.stdout.trim(), uncommittedCitedPaths: uncommitted.sort() };
}

/**
 * Recheck a persisted grounding result. Content hashes are the authority: any
 * cited evidence or stage artifact whose bytes changed since the citation is
 * stale, whether the change came from an edit, a deletion, a symlink swap, or a
 * later commit. A moved git HEAD is reported as provenance only.
 */
export function recheckGroundingResult(result: GroundingRunResult, projectDir?: string) {
  if (result.action !== "grounding-findings") return { fresh: false, stale: [] as GroundingStaleEntry[], headMoved: null as boolean | null, reason: `no grounding citation to recheck (${result.action})` };
  const checked = recheckGroundingEntries([...result.artifacts, ...result.citedEvidence]);
  const now = projectDir && result.git ? groundingGitProvenance(projectDir, []) : null;
  return { ...checked, headMoved: now && result.git ? now.head !== result.git.head : null, reason: "rechecked" };
}

function validateResult(value: GroundingWorkerResult, projectDir: string, task: GroundingTask): GroundingWorkerResult {
  if (!value || !Array.isArray(value.findings) || !Array.isArray(value.uncertainty)) throw new Error("grounding worker returned an invalid result");
  if (value.approval !== undefined) throw new Error("grounding workers must not create or claim approval");
  const snapshotted = new Set(task.evidenceFiles.map((item) => item.path));
  const findings = value.findings.map((finding) => {
    if (!finding || !ALLOWED_CODES.has(finding.code) || !ALLOWED_SEVERITIES.has(finding.severity) || typeof finding.claim !== "string" || !finding.claim.trim() || typeof finding.detail !== "string" || !finding.detail.trim() || !Array.isArray(finding.evidencePaths)) {
      throw new Error("grounding worker returned an invalid finding");
    }
    const evidencePaths = finding.evidencePaths.map((path) => boundedEvidenceFile(projectDir, path));
    if (evidencePaths.some((path) => !snapshotted.has(path))) throw new Error("grounding evidence path is outside configured roots or the grounding snapshot");
    if ((finding.code === "confirmed" || finding.code === "refuted") && evidencePaths.length === 0) {
      throw new Error(`grounding ${finding.code} finding requires at least one evidence path`);
    }
    return { ...finding, evidencePaths };
  });
  return { findings, uncertainty: value.uncertainty.map((item) => String(item).trim()).filter(Boolean) };
}

export type GroundingPlan =
  | GroundingTask
  | { action: "disabled" | "not-applicable" }
  | { action: "off-no-valid-roots"; rejectedRoots: GroundingRejectedRoot[] };

export function planGrounding(input: {
  lane: GroundingLane;
  stage: GroundingStage;
  projectDir: string;
  artifactPaths: string[];
  config: GroundingConfig;
}): GroundingPlan {
  const selected = feature(input.config, input.lane);
  if (selected.enabled !== true) return { action: "disabled" };
  const applicable = input.lane === "source" ? SOURCE_STAGES : SPEC_STAGES;
  if (!applicable.has(input.stage)) return { action: "not-applicable" };
  const resolvedRoots = resolveGroundingRoots(input.projectDir, selected.roots);
  if (!resolvedRoots.roots.length) return { action: "off-no-valid-roots", rejectedRoots: resolvedRoots.rejected };
  if (!input.artifactPaths.length) throw new Error("grounding requires at least one stage artifact");
  const artifactPaths = input.artifactPaths.map((path) => boundedEvidenceFile(input.projectDir, path));
  const evidenceRoots = resolvedRoots.roots;
  const limits = assertGroundingLimits(selected.limits ?? DEFAULT_GROUNDING_LIMITS);
  const snapshot = snapshotGroundingInputs(artifactPaths, evidenceRoots, limits);
  const subject = input.lane === "source" ? "実装ソース" : "既存仕様書";
  return {
    lane: input.lane,
    stage: input.stage,
    objective: `stage成果物の主張を${subject}と照合し、確認・反証・未確認を根拠付きで返す`,
    artifactPaths,
    evidenceRoots,
    ...snapshot,
    limits,
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
  const zero = { lane: input.lane, stage: input.stage, workerCalls: 0, artifactsWritten: 0, reviewsRun: 0 } as const;
  if ("action" in planned) {
    if (planned.action === "off-no-valid-roots") {
      return { action: "off-no-valid-roots", ...zero, verdict: "NOT-READY", compliance: "not-claimed", rejectedRoots: planned.rejectedRoots, detail: `${input.lane} grounding was requested but has no valid configured roots; it stays OFF and makes no compliance claim`, approvalRecorded: false };
    }
    return { action: planned.action, ...zero } as GroundingRunResult;
  }
  const result = validateResult(await input.worker(planned), input.projectDir, planned);
  const cited = new Set(result.findings.flatMap((finding) => finding.evidencePaths));
  const citedEvidence = planned.evidenceFiles.filter((item) => cited.has(item.path));
  // Evidence or artifacts that changed while the worker ran are stale: the
  // citation would describe bytes that no longer exist.
  const freshness = recheckGroundingEntries([...planned.artifactFiles, ...citedEvidence]);
  if (!freshness.fresh) throw new Error(`grounding evidence is stale: ${freshness.stale.map((item) => `${item.path} (${item.reason})`).join(", ")}`);
  const verdict = result.findings.length === 0 || result.uncertainty.length > 0 || result.findings.some((finding) => finding.severity === "error" || finding.code === "refuted" || finding.code === "grounding-unavailable") ? "NOT-READY" : "READY";
  return {
    action: "grounding-findings",
    lane: input.lane,
    stage: input.stage,
    workerCalls: 1,
    artifactsWritten: 0,
    reviewsRun: 0,
    verdict,
    compliance: verdict === "READY" ? "grounded" : "not-claimed",
    findings: result.findings,
    uncertainty: result.uncertainty,
    citedEvidence,
    artifacts: planned.artifactFiles,
    limits: planned.limits,
    git: groundingGitProvenance(input.projectDir, citedEvidence.map((item) => item.path)),
    approvalRecorded: false,
  };
}
