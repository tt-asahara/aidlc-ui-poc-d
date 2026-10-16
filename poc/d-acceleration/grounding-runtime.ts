import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { spawn } from "node:child_process";
import type { GroundingTask, GroundingWorker, GroundingWorkerResult } from "./grounding.ts";

export type GroundingCommandRunner = (executable: string, argv: readonly string[], cwd: string) => Promise<{ status: number; stdout: string; stderr: string }>;
export const groundingSpawnRunner: GroundingCommandRunner = (executable, argv, cwd) => new Promise((resolve, reject) => {
  const child = spawn(executable, [...argv], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => stdout += chunk);
  child.stderr.setEncoding("utf8").on("data", (chunk) => stderr += chunk);
  child.once("error", reject); child.once("close", (code) => resolve({ status: code ?? 1, stdout, stderr }));
});

export function createClaudeGroundingWorker(options: { cwd: string; executable?: string; runner?: GroundingCommandRunner }): GroundingWorker {
  const runner = options.runner ?? groundingSpawnRunner;
  return async (task: GroundingTask): Promise<GroundingWorkerResult> => {
    const files: string[] = [];
    for (const evidenceRoot of task.evidenceRoots) {
      const pending = [evidenceRoot];
      while (pending.length) {
        const path = pending.pop()!; const stat = lstatSync(path);
        if (stat.isSymbolicLink()) throw new Error(`grounding evidence contains a symlink: ${path}`);
        if (stat.isDirectory()) { for (const name of readdirSync(path)) pending.push(`${path}/${name}`); continue; }
        if (stat.isFile()) files.push(path);
        if (files.length > 200) throw new Error("grounding evidence exceeds 200 files");
      }
    }
    let bytes = 0;
    const snapshot = files.sort().map((path) => { const content = readFileSync(path, "utf8"); bytes += Buffer.byteLength(content); if (bytes > 1_000_000) throw new Error("grounding evidence exceeds 1000000 bytes"); return `--- ${relative(options.cwd, path)} ---\n${content}`; }).join("\n");
    const schema = '{"findings":[{"code":"confirmed|refuted|grounding-unavailable","severity":"info|warn|error","claim":"...","evidencePaths":["..."],"detail":"..."}],"uncertainty":["..."]}';
    const result = await runner(options.executable ?? "claude", ["-p", `${task.prompt}\nBounded evidence snapshot:\n${snapshot}\nReturn JSON only matching ${schema}`, "--allowedTools", "", "--permission-mode", "dontAsk"], options.cwd);
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
