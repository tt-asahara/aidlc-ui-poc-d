#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { clefRunnerArgs, resolveDClef, resolveDConfig, resolveDModelContract, resolveDModels } from "./d-config.ts";
import { enforceParallelOff } from "./parallel-guard.ts";

const args = process.argv.slice(2); const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const projectDir = value("--project-dir"); if (!projectDir || !isAbsolute(projectDir)) throw new Error("--project-dir must be an absolute PRODUCT path");
const runtime = join(projectDir, ".claude"); const tools = join(runtime, "tools"); const orchestrate = join(tools, "aidlc-orchestrate.ts");
const required = [orchestrate, join(runtime, "sensors", "aidlc-ui-poc-evidence.md"), join(tools, "ui-poc", "c-stage-routing.json"), join(tools, "data", "plugin-contrib-ui-poc.json"), join(tools, "data", "plugin-files-ui-poc.json")];
const missing = required.filter((path) => !existsSync(path));
const clef = resolveDClef(projectDir);
const optional = resolveDConfig(projectDir);
const enabled = { uiBaseline: missing.length ? "missing" : "C-composed", acceleration: "D-automatic-for-supported-waves", supportedDesignWaves: ["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design"], supportedReadOnlyFanout: ["feasibility", "market-research", "performance-validation"], modelContract: resolveDModelContract(projectDir, process.env.AIDLC_PARENT_MODEL), constructionContract: { default: "unit-major/serial", safeParallel: "stage-major/swarm only after the official Unit DAG proves independent ready Units and disjoint writes, using the person's recorded request" }, optional, clef: { configured: clef.enabled, endpoint: clef.url, explicitLowRiskUnits: clef.lowRiskUnits }, unsupported: "all other stages return to official host", runtime: runtime, missing };
if (args.includes("--preflight")) { process.stdout.write(`${JSON.stringify(enabled, null, 2)}\n`); process.exit(missing.length ? 2 : 0); }
if (missing.length) { process.stderr.write(`D preflight failed; compose C first: ${missing.join(", ")}\n`); process.exit(2); }
const stageCheckInput = value("--stage-check-input");
if (stageCheckInput) {
  const directiveFile = value("--directive-file");
  if (!directiveFile) throw new Error("--stage-check-input requires --directive-file so the official stage boundary can be verified");
  const check = spawnSync(process.execPath, [join(import.meta.dir, "host-stage-boundary.ts"), "--project-dir", projectDir, "--directive-file", directiveFile, "--manifest", stageCheckInput, "--engine-dir", tools], { cwd: projectDir, encoding: "utf8" });
  process.stdout.write(check.stdout); process.stderr.write(check.stderr); process.exit(check.status ?? 1);
}
const officialNext = () => {
  const next = spawnSync(process.execPath, [orchestrate, "next", "--project-dir", projectDir], { cwd: projectDir, encoding: "utf8" });
  if (next.status !== 0) { process.stderr.write(next.stderr || next.stdout); process.exit(next.status ?? 2); }
  return JSON.parse(next.stdout);
};
let directive = officialNext();
// parallel.enabled=false: serialize an existing stage-major/swarm Intent through
// the official setter and never hand an official swarm back while D is off.
let parallelGuard = optional.parallel.enabled ? null : enforceParallelOff({ projectDir, engineDir: tools, directive, parallelEnabled: false });
if (parallelGuard?.action === "refresh") { directive = officialNext(); parallelGuard = enforceParallelOff({ projectDir, engineDir: tools, directive, parallelEnabled: false }); }
if (parallelGuard?.action === "stop") {
  process.stdout.write(`${JSON.stringify({ status: "parallel-off-action-required", reason: parallelGuard.reason, recovery: parallelGuard.recovery, directive, parallelGuard, enabled }, null, 2)}\n`);
  process.exit(2);
}
const readOnlyStages = new Set(enabled.supportedReadOnlyFanout);
const designStages = new Set(enabled.supportedDesignWaves);
if (directive.gate || directive.kind !== "run-stage" || (!readOnlyStages.has(directive.stage) && !designStages.has(directive.stage))) {
  process.stdout.write(`${JSON.stringify({ status: "official-host-action-required", reason: directive.gate ? "official-gate" : "unsupported-directive", directive, enabled, ...(parallelGuard ? { parallelGuard } : {}) }, null, 2)}\n`);
  process.exit(0);
}
if (directive.kind === "run-stage" && readOnlyStages.has(directive.stage)) {
  const input = value("--fanout-input");
  if (!input) { process.stdout.write(`${JSON.stringify({ status: "official-host-action-required", reason: "read-only-fanout-input-required", directive, enabled }, null, 2)}\n`); process.exit(2); }
  const command = [join(import.meta.dir, "read-only-fanout.ts"), "--input", input, "--project-dir", projectDir, "--framework-dir", runtime, "--engine-dir", tools];
  const models = resolveDModels(projectDir, { fast: value("--claude-fast"), balanced: value("--claude-balanced"), judgment: value("--claude-judgment") });
  command.push("--model-fast", models.models.fast, "--model-balanced", models.models.balanced, "--model-judgment", models.models.judgment);
  if (args.includes("--dry-run")) command.push("--dry-run");
  const result = spawnSync(process.execPath, command, { cwd: projectDir, encoding: "utf8" }); process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exit(result.status ?? 1);
}
const worker = value("--worker") ?? "claude";
const command = [join(import.meta.dir, "conductor.ts"), "--project-dir", projectDir, "--engine-dir", tools, "--worker", worker];
const resolvedModels = resolveDModels(projectDir, { fast: value("--claude-fast"), balanced: value("--claude-balanced"), judgment: value("--claude-judgment") });
for (const tier of ["fast", "balanced", "judgment"] as const) command.push(`--claude-${tier}`, resolvedModels.models[tier]);
command.push(...clefRunnerArgs(clef));
for (const flag of ["--claude-effort", "--clef-url", "--clef-low-risk-units", "--timeout-ms"]) { const v = value(flag); if (v) command.push(flag, v); }
if (args.includes("--disposable-test-mode")) command.push("--disposable-test-mode");
const result = spawnSync(process.execPath, command, { cwd: projectDir, encoding: "utf8" });
process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exit(result.status ?? 1);
