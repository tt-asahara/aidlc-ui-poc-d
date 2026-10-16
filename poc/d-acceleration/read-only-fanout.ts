#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";
import policy from "./stage-policy.json";
import { runWorker, type WorkerLaunch } from "./worker-adapters.ts";

export type ResearchTask = { id: string; agent: string; objective: string; evidencePaths: string[] };
export type FanoutInput = { directive: any; tasks: ResearchTask[]; model: string; effort?: "low" | "medium" | "high"; maxParallel?: number };
export type FanoutOptions = { projectDir: string; frameworkDir: string; claudeExecutable?: string; timeoutMs?: number };

const OFFICIAL_TOPOLOGIES = new Set(["mob", "subagent", "pipeline"]);
const SAFE_TOOLS = "Read,Grep,Glob";
const REQUIRED_CLAUDE_FLAGS = ["--tools", "--allowedTools", "--disallowedTools", "--restricted", "--strict-mcp-config", "--permission-mode", "--permission-prompts", "--no-session-persistence", "--agents", "--agent"];

export function validateClaudeReadOnlyCapabilities(help: string): void {
  const missing = REQUIRED_CLAUDE_FLAGS.filter((flag) => !help.includes(flag));
  if (missing.length) throw new Error(`Claude CLI cannot enforce read-only fanout; missing: ${missing.join(", ")}`);
}

function inside(root: string, path: string): string {
  const absolute = resolve(root, path); const rel = relative(root, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`evidence path escapes project: ${path}`);
  return absolute;
}

function persona(frameworkDir: string, agent: string): string {
  if (!/^aidlc-[a-z-]+-agent$/.test(agent)) throw new Error(`invalid official agent: ${agent}`);
  const path = join(frameworkDir, "agents", `${agent}.md`);
  if (!existsSync(path)) throw new Error(`official agent projection is missing: ${agent}`);
  return readFileSync(path, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

export function planReadOnlyFanout(input: FanoutInput, options: FanoutOptions) {
  if (!isAbsolute(options.projectDir) || !existsSync(options.projectDir)) throw new Error("projectDir must be an existing absolute path");
  const directive = input.directive?.directive ?? input.directive;
  if (directive?.kind !== "run-stage" || directive.gate === true) return { action: "official-host-action-required", reason: "not-an-active-run-stage", directive, launches: [] };
  if (OFFICIAL_TOPOLOGIES.has(directive.mode) || directive.kind === "invoke-swarm") return { action: "official-host-action-required", reason: `official-${directive.mode ?? directive.kind}-contract`, directive, launches: [] };
  const stage = policy.stages.find((entry) => entry.stage === directive.stage);
  if (!stage || stage.status !== "implemented-read-only-fanout" || stage.parallelism !== "read-only-fanout") return { action: "official-host-action-required", reason: "stage-policy-does-not-enable-read-only-fanout", directive, launches: [] };
  if (!Array.isArray(input.tasks) || input.tasks.length < 2) throw new Error("read-only fanout requires at least two independent tasks");
  if (!input.model?.trim()) throw new Error("a runtime-confirmed model ID is required");
  const ids = new Set<string>();
  const launches = input.tasks.map((task) => {
    if (!task.id || ids.has(task.id) || !task.objective.trim() || !task.evidencePaths.length) throw new Error(`invalid or duplicate research task: ${task.id}`); ids.add(task.id);
    const paths = task.evidencePaths.map((path) => inside(options.projectDir, path));
    const agents = JSON.stringify({ [task.agent]: { description: `Official AI-DLC read-only specialist for ${directive.stage}`, prompt: persona(options.frameworkDir, task.agent), tools: ["Read", "Grep", "Glob"] } });
    const prompt = [`Active official stage: ${directive.stage}.`, `Read-only subtask: ${task.objective}`, `Evidence paths: ${paths.join(", ")}`, "Return findings, evidence paths, uncertainty, and recommendations in your response. Do not create or edit files. The lead alone decides what to adopt and writes official artifacts."].join("\n");
    const launch: WorkerLaunch = { kind: "claude", executable: options.claudeExecutable ?? "claude", requestedModel: input.model, requestedEffort: input.effort ?? "medium", args: ["--print", "--output-format", "json", "--no-session-persistence", "--restricted", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands", "--permission-mode", "dontAsk", "--permission-prompts", "none", "--tools", SAFE_TOOLS, "--allowed-tools", SAFE_TOOLS, "--disallowed-tools", "Bash,Edit,Write,NotebookEdit,Agent,Task,WebFetch,WebSearch", "--agents", agents, "--agent", task.agent, "--model", input.model, "--effort", input.effort ?? "medium", prompt] };
    return { id: task.id, agent: task.agent, evidencePaths: paths, launch };
  });
  return { action: "execute-read-only-fanout", stage: directive.stage, directive, maxParallel: Math.min(input.maxParallel ?? 3, launches.length), launches };
}

export async function runReadOnlyFanout(input: FanoutInput, options: FanoutOptions) {
  const planned = planReadOnlyFanout(input, options);
  if (planned.action !== "execute-read-only-fanout") return planned;
  const executable = options.claudeExecutable ?? "claude";
  const help = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 5_000 });
  if (help.status !== 0) throw new Error(`Claude CLI capability preflight failed: ${help.stderr || help.stdout}`);
  validateClaudeReadOnlyCapabilities(help.stdout);
  const results: any[] = [];
  for (let offset = 0; offset < planned.launches.length; offset += planned.maxParallel) {
    const batch = planned.launches.slice(offset, offset + planned.maxParallel);
    const settled = await Promise.allSettled(batch.map(async (item) => ({ id: item.id, agent: item.agent, result: await runWorker(item.launch, { projectDir: options.projectDir, timeoutMs: options.timeoutMs ?? 120_000, maxStdoutBytes: 256_000, maxStderrBytes: 64_000 }) })));
    results.push(...settled.map((item, index) => item.status === "fulfilled" ? item.value : { id: batch[index]!.id, agent: batch[index]!.agent, result: { ok: false, failure: "process-error", stderr: String(item.reason) } }));
  }
  return { action: "lead-integration-required", stage: planned.stage, directive: planned.directive, results, policy: { workerWrites: false, leadIsOnlyArtifactWriter: true, officialStageTransition: false } };
}

if (import.meta.main) {
  const args = process.argv.slice(2); const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const inputPath = value("--input"); const projectDir = value("--project-dir"); const frameworkDir = value("--framework-dir");
  if (!inputPath || !projectDir || !frameworkDir) throw new Error("--input, --project-dir, and --framework-dir are required");
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const result = args.includes("--dry-run") ? planReadOnlyFanout(input, { projectDir, frameworkDir }) : await runReadOnlyFanout(input, { projectDir, frameworkDir });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.action === "official-host-action-required") process.exitCode = 2;
}
