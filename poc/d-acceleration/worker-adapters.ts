import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

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
  startedAt: number;
  endedAt: number;
};

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
  return {
    kind: "fake",
    executable: request.executable ?? process.execPath,
    args: [request.script, "--task", request.task, "--stage", request.stage, "--unit", request.unit ?? "", "--tier", request.tier, "--model", request.model ?? "", "--duration-ms", String(request.durationMs), "--retry-ordinal", String(request.retryOrdinal), "--fail", String(request.fail ?? false), "--produce-json", JSON.stringify(request.produces ?? [])],
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

function reportedModel(kind: WorkerKind, stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout);
    if (kind === "fake") return typeof parsed.runtimeReportedModel === "string" ? parsed.runtimeReportedModel : null;
    const model = parsed?.model ?? parsed?.model_id ?? parsed?.result?.model;
    return typeof model === "string" ? model : null;
  } catch { return null; }
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
  try { child = Bun.spawn([launch.executable, ...launch.args], { cwd: limits.projectDir, stdout: "pipe", stderr: "pipe" }); }
  catch (error) {
    return { ok: false, kind: launch.kind, argv: [launch.executable, ...launch.args], exitCode: null, signalCode: null, failure: launch.kind === "claude" ? "unavailable" : "spawn-error", stdout: "", stderr: String(error), stdoutTruncated: false, stderrTruncated: false, requestedModel: launch.requestedModel, requestedEffort: launch.requestedEffort, runtimeReportedModel: null, startedAt, endedAt: Date.now() };
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
  const failure = termination ?? (exitCode === 0 ? null : launch.kind === "claude" ? classifyClaude(stderrResult.text) : "process-error");
  return { ok: failure === null, kind: launch.kind, argv: [launch.executable, ...launch.args], exitCode, signalCode: child.signalCode, failure, stdout: stdoutResult.text, stderr: stderrResult.text, stdoutTruncated: stdoutResult.truncated, stderrTruncated: stderrResult.truncated, requestedModel: launch.requestedModel, requestedEffort: launch.requestedEffort, runtimeReportedModel: reportedModel(launch.kind, stdoutResult.text), startedAt, endedAt: Date.now() };
}
