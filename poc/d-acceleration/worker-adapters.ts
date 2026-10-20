import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { externalEnvironment, scriptLaunch } from "./execution.ts";

export type WorkerKind = "fake" | "claude";
export type WorkerFailure =
  | "spawn-error"
  | "timeout"
  | "cancelled"
  | "output-limit"
  | "authentication"
  | "unavailable"
  | "process-error";

export type WorkerLaunch = {
  kind: WorkerKind;
  executable: string;
  args: string[];
  requestedModel: string | null;
  requestedEffort: string | null;
  environment?: Record<string, string | undefined>;
};

export type WorkerResult = {
  ok: boolean;
  kind: WorkerKind;
  argv: string[];
  exitCode: number | null;
  signalCode: string | null;
  failure: WorkerFailure | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  requestedModel: string | null;
  requestedEffort: string | null;
  runtimeReportedModel: string | null;
  modelIdentity: ModelIdentity;
  usage: WorkerUsage | null;
  startedAt: number;
  endedAt: number;
};

/**
 * Requested-vs-runtime model identity. `verified-match` needs the runtime to
 * report exactly the requested ID; `alias-resolved` means a family alias such
 * as `opus` was requested and the runtime reported one model of that family.
 * Any absent or unparsable identity is `unverified`; it is never inferred from
 * the request.
 */
export type ModelIdentityStatus = "verified-match" | "alias-resolved" | "mismatch" | "unverified";
export type ModelIdentity = {
  requested: string | null;
  runtimeReported: string | null;
  runtimeReportedModels: string[];
  status: ModelIdentityStatus;
  source: "claude-modelUsage" | "claude-model-field" | "fake-worker-report" | "none";
};
export type WorkerUsage = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number | null; costBasis: string | null; durationMs: number | null; durationApiMs: number | null };

export type WorkerLimits = {
  projectDir: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  signal?: AbortSignal;
};

export type FakeWorkerRequest = {
  script: string;
  task: string;
  stage: string;
  unit?: string;
  tier: string;
  model?: string;
  durationMs: number;
  retryOrdinal: number;
  fail?: boolean;
  executable?: string;
  produces?: string[];
};

export function fakeWorkerLaunch(request: FakeWorkerRequest): WorkerLaunch {
  const launch = scriptLaunch(request.script, ["--task", request.task, "--stage", request.stage, "--unit", request.unit ?? "", "--tier", request.tier, "--model", request.model ?? "", "--duration-ms", String(request.durationMs), "--retry-ordinal", String(request.retryOrdinal), "--fail", String(request.fail ?? false), "--produce-json", JSON.stringify(request.produces ?? [])]);
  return {
    kind: "fake",
    executable: request.executable ?? launch.argv[0]!,
    args: launch.argv.slice(1),
    environment: launch.env,
    requestedModel: request.model || null,
    requestedEffort: null,
  };
}

export function claudeWorkerLaunch(request: { model: string; effort: string; prompt: string; executable?: string }): WorkerLaunch {
  if (!request.model.trim()) throw new Error("a runtime-discovered Claude model ID is required");
  if (!request.prompt.trim()) throw new Error("a Claude prompt is required");
  if (!["low", "medium", "high", "xhigh", "max"].includes(request.effort)) throw new Error("unsupported Claude effort");
  return {
    kind: "claude",
    executable: request.executable ?? "claude",
    args: ["--print", "--output-format", "json", "--permission-prompts", "none", "--model", request.model, "--effort", request.effort, request.prompt],
    requestedModel: request.model,
    requestedEffort: request.effort,
  };
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number, onOverflow: () => void) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0; let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const available = Math.max(0, limit - size);
    if (available > 0) {
      const kept = value.subarray(0, available);
      chunks.push(kept); size += kept.byteLength;
    }
    if (value.byteLength > available) {
      truncated = true; onOverflow();
    }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { text: new TextDecoder().decode(bytes), truncated };
}

const MODEL_FAMILIES = ["opus", "sonnet", "haiku", "fable"];
function bareModel(value: string): string { return value.trim().toLowerCase().replace(/\[[^\]]*\]$/, ""); }

/** Pure: classify a requested model against what the runtime reported. */
export function classifyModelIdentity(requested: string | null, reported: string[], source: ModelIdentity["source"]): ModelIdentity {
  const runtimeReportedModels = [...new Set(reported.filter((value) => typeof value === "string" && value.trim()))];
  if (!runtimeReportedModels.length || !requested?.trim()) return { requested, runtimeReported: runtimeReportedModels[0] ?? null, runtimeReportedModels, status: "unverified", source: runtimeReportedModels.length ? source : "none" };
  const want = bareModel(requested);
  const exact = runtimeReportedModels.find((model) => bareModel(model) === want);
  if (exact) return { requested, runtimeReported: exact, runtimeReportedModels, status: "verified-match", source };
  if (MODEL_FAMILIES.includes(want)) {
    const family = runtimeReportedModels.filter((model) => bareModel(model).includes(`-${want}-`) || bareModel(model).startsWith(`${want}-`));
    if (family.length === 1) return { requested, runtimeReported: family[0]!, runtimeReportedModels, status: "alias-resolved", source };
  }
  return { requested, runtimeReported: runtimeReportedModels[0]!, runtimeReportedModels, status: "mismatch", source };
}

function num(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }

/**
 * Claude Code `--output-format json` (observed on CLI 2.1.302) has no
 * top-level `model`; the served model IDs are the keys of `modelUsage`
 * (each with `canonicalModel`, tokens, and `costUSD`). Older or other shapes
 * with a top-level `model` string are still accepted.
 */
export function parseWorkerOutput(kind: WorkerKind, stdout: string, requested: string | null): { identity: ModelIdentity; usage: WorkerUsage | null } {
  let parsed: any;
  try { parsed = JSON.parse(stdout); } catch { return { identity: classifyModelIdentity(requested, [], "none"), usage: null }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { identity: classifyModelIdentity(requested, [], "none"), usage: null };
  if (kind === "fake") return { identity: classifyModelIdentity(requested, typeof parsed.runtimeReportedModel === "string" ? [parsed.runtimeReportedModel] : [], "fake-worker-report"), usage: null };
  const modelUsage = parsed.modelUsage && typeof parsed.modelUsage === "object" && !Array.isArray(parsed.modelUsage) ? parsed.modelUsage as Record<string, any> : null;
  let identity: ModelIdentity;
  if (modelUsage && Object.keys(modelUsage).length) identity = classifyModelIdentity(requested, Object.entries(modelUsage).map(([key, value]) => typeof value?.canonicalModel === "string" && value.canonicalModel.trim() ? value.canonicalModel : key), "claude-modelUsage");
  else {
    const direct = parsed.model ?? parsed.model_id ?? parsed.result?.model;
    identity = classifyModelIdentity(requested, typeof direct === "string" ? [direct] : [], "claude-model-field");
  }
  let usage: WorkerUsage | null = null;
  if (modelUsage && Object.keys(modelUsage).length) {
    const rows = Object.values(modelUsage);
    const costs = rows.map((row: any) => row?.costUSD).filter((value) => typeof value === "number" && Number.isFinite(value));
    const total = typeof parsed.total_cost_usd === "number" && Number.isFinite(parsed.total_cost_usd) ? parsed.total_cost_usd : costs.length ? costs.reduce((a, b) => a + b, 0) : null;
    const bases = [...new Set(rows.map((row: any) => row?.costBasis).filter((value) => typeof value === "string"))];
    usage = { inputTokens: rows.reduce((sum, row: any) => sum + num(row?.inputTokens), 0), outputTokens: rows.reduce((sum, row: any) => sum + num(row?.outputTokens), 0), cacheReadInputTokens: rows.reduce((sum, row: any) => sum + num(row?.cacheReadInputTokens), 0), cacheCreationInputTokens: rows.reduce((sum, row: any) => sum + num(row?.cacheCreationInputTokens), 0), costUSD: total, costBasis: bases.length ? bases.join(",") : null, durationMs: typeof parsed.duration_ms === "number" ? parsed.duration_ms : null, durationApiMs: typeof parsed.duration_api_ms === "number" ? parsed.duration_api_ms : null };
  }
  return { identity, usage };
}

function classifyClaude(stderr: string): WorkerFailure {
  if (/not logged in|login required|authentication|unauthorized|invalid api key/i.test(stderr)) return "authentication";
  if (/model.+(not found|unavailable|not available|unsupported)|command not found/i.test(stderr)) return "unavailable";
  return "process-error";
}

/** Runs one worker attempt and always resolves, so callers can safely use Promise.allSettled. */
export async function runWorker(launch: WorkerLaunch, limits: WorkerLimits): Promise<WorkerResult> {
  if (!isAbsolute(limits.projectDir) || !existsSync(limits.projectDir)) throw new Error("projectDir must be an existing absolute path");
  if (!Number.isFinite(limits.timeoutMs) || limits.timeoutMs <= 0) throw new Error("timeoutMs must be positive");
  if (!Number.isInteger(limits.maxStdoutBytes) || limits.maxStdoutBytes < 0 || !Number.isInteger(limits.maxStderrBytes) || limits.maxStderrBytes < 0) throw new Error("output limits must be non-negative integers");
  const startedAt = Date.now(); let child: ReturnType<typeof Bun.spawn>;
  try { child = Bun.spawn([launch.executable, ...launch.args], { cwd: limits.projectDir, stdout: "pipe", stderr: "pipe", env: launch.kind === "claude" ? externalEnvironment(launch.environment) : launch.environment }); }
  catch (error) {
    return { ok: false, kind: launch.kind, argv: [launch.executable, ...launch.args], exitCode: null, signalCode: null, failure: launch.kind === "claude" ? "unavailable" : "spawn-error", stdout: "", stderr: String(error), stdoutTruncated: false, stderrTruncated: false, requestedModel: launch.requestedModel, requestedEffort: launch.requestedEffort, runtimeReportedModel: null, modelIdentity: classifyModelIdentity(launch.requestedModel, [], "none"), usage: null, startedAt, endedAt: Date.now() };
  }
  let termination: WorkerFailure | null = null;
  let hardKill: ReturnType<typeof setTimeout> | undefined;
  const terminate = (reason: WorkerFailure) => { if (!termination) { termination = reason; try { child.kill("SIGTERM"); } catch {} hardKill = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 200); } };
  const timer = setTimeout(() => terminate("timeout"), limits.timeoutMs);
  const abort = () => terminate("cancelled");
  if (limits.signal?.aborted) abort(); else limits.signal?.addEventListener("abort", abort, { once: true });
  const [stdoutResult, stderrResult, exitCode] = await Promise.all([
    readBounded(child.stdout as ReadableStream<Uint8Array>, limits.maxStdoutBytes, () => terminate("output-limit")),
    readBounded(child.stderr as ReadableStream<Uint8Array>, limits.maxStderrBytes, () => terminate("output-limit")),
    child.exited,
  ]);
  clearTimeout(timer); if (hardKill) clearTimeout(hardKill); limits.signal?.removeEventListener("abort", abort);
  const output = parseWorkerOutput(launch.kind, stdoutResult.text, launch.requestedModel);
  const failure = termination ?? (exitCode === 0 ? null : launch.kind === "claude" ? classifyClaude(stderrResult.text) : "process-error");
  return { ok: failure === null, kind: launch.kind, argv: [launch.executable, ...launch.args], exitCode, signalCode: child.signalCode, failure, stdout: stdoutResult.text, stderr: stderrResult.text, stdoutTruncated: stdoutResult.truncated, stderrTruncated: stderrResult.truncated, requestedModel: launch.requestedModel, requestedEffort: launch.requestedEffort, runtimeReportedModel: output.identity.runtimeReported, modelIdentity: output.identity, usage: output.usage, startedAt, endedAt: Date.now() };
}
