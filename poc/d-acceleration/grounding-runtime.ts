import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { spawn } from "node:child_process";
import { sha256, type GroundingSnapshotEntry, type GroundingTask, type GroundingWorker, type GroundingWorkerResult } from "./grounding.ts";

/** `stdin` carries the prompt: a snapshot of up to the configured byte cap would overflow argv (macOS ARG_MAX is 1 MiB, Linux limits one argument to 128 KiB). */
export type GroundingCommandRunner = (executable: string, argv: readonly string[], cwd: string, stdin: string) => Promise<{ status: number; stdout: string; stderr: string }>;
export const groundingSpawnRunner: GroundingCommandRunner = (executable, argv, cwd, stdin) => new Promise((resolve, reject) => {
  const child = spawn(executable, [...argv], { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => { /* surfaced through the exit status */ });
  child.stdin.end(stdin);
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => stdout += chunk);
  child.stderr.setEncoding("utf8").on("data", (chunk) => stderr += chunk);
  child.once("error", reject); child.once("close", (code) => resolve({ status: code ?? 1, stdout, stderr }));
});

/**
 * Production worker. It renders only the tool-owned snapshot in `task` (the
 * bounded walk, symlink refusal, and size limits live in grounding.ts) and
 * refuses to render a file whose bytes no longer match the snapshot hash.
 */
export function createClaudeGroundingWorker(options: { cwd: string; executable?: string; runner?: GroundingCommandRunner }): GroundingWorker {
  const runner = options.runner ?? groundingSpawnRunner;
  return async (task: GroundingTask): Promise<GroundingWorkerResult> => {
    const cwd = realpathSync(options.cwd);
    const render = (entries: GroundingSnapshotEntry[], label: string) => entries.map((item) => {
      const content = readFileSync(item.path);
      if (sha256(content) !== item.sha256) throw new Error(`grounding evidence is stale: ${item.path} changed after the snapshot`);
      return `--- ${label}: ${relative(cwd, item.path)} ---\n${content.toString("utf8")}`;
    }).join("\n");
    const artifactSnapshot = render(task.artifactFiles, "STAGE ARTIFACT");
    const evidenceSnapshot = render(task.evidenceFiles, "EVIDENCE");
    const schema = '{"findings":[{"code":"confirmed|refuted|grounding-unavailable","severity":"info|warn|error","claim":"...","evidencePaths":["..."],"detail":"..."}],"uncertainty":["..."]}';
    const prompt = `${task.prompt}\nBounded stage artifact snapshot:\n${artifactSnapshot}\nBounded evidence snapshot:\n${evidenceSnapshot}\nReturn JSON only matching ${schema}`;
    // Fixed argv; the prompt (the whole bounded snapshot) goes through stdin.
    const result = await runner(options.executable ?? "claude", ["-p", "--allowedTools", "", "--permission-mode", "dontAsk"], options.cwd, prompt);
    if (result.status !== 0) throw new Error(`grounding worker failed (${result.status}): ${result.stderr.trim()}`);
    try { return JSON.parse(result.stdout) as GroundingWorkerResult; } catch { throw new Error("grounding worker returned non-JSON output"); }
  };
}

export function persistGroundingEvidence(path: string, value: unknown): string {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
  return path;
}
