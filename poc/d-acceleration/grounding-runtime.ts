import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { spawn } from "node:child_process";
import { sha256, type GroundingSnapshotEntry, type GroundingTask, type GroundingWorker, type GroundingWorkerResult } from "./grounding.ts";

export type GroundingCommandRunner = (executable: string, argv: readonly string[], cwd: string) => Promise<{ status: number; stdout: string; stderr: string }>;
export const groundingSpawnRunner: GroundingCommandRunner = (executable, argv, cwd) => new Promise((resolve, reject) => {
  const child = spawn(executable, [...argv], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
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
    const result = await runner(options.executable ?? "claude", ["-p", `${task.prompt}\nBounded stage artifact snapshot:\n${artifactSnapshot}\nBounded evidence snapshot:\n${evidenceSnapshot}\nReturn JSON only matching ${schema}`, "--allowedTools", "", "--permission-mode", "dontAsk"], options.cwd);
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
