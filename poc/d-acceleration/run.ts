#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { clefRunnerArgs, resolveDClef, resolveDModels } from "./d-config.ts";

const args = process.argv.slice(2); const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const projectDir = value("--project-dir"); if (!projectDir || !isAbsolute(projectDir)) throw new Error("--project-dir must be an absolute PRODUCT path");
const runtime = join(projectDir, ".claude"); const tools = join(runtime, "tools"); const orchestrate = join(tools, "aidlc-orchestrate.ts");
const required = [orchestrate, join(runtime, "sensors", "aidlc-ui-poc-evidence.md"), join(tools, "ui-poc", "c-stage-routing.json"), join(tools, "data", "plugin-contrib-ui-poc.json"), join(tools, "data", "plugin-files-ui-poc.json")];
const missing = required.filter((path) => !existsSync(path));
const clef = resolveDClef(projectDir);
const enabled = { uiBaseline: missing.length ? "missing" : "C-composed", acceleration: "D-automatic-for-supported-waves", supportedDesignWaves: ["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design"], supportedReadOnlyFanout: ["feasibility", "market-research", "performance-validation"], clef: { configured: clef.enabled, endpoint: clef.url, explicitLowRiskUnits: clef.lowRiskUnits }, unsupported: "all other stages return to official host", runtime: runtime, missing };
if (args.includes("--preflight")) { process.stdout.write(`${JSON.stringify(enabled, null, 2)}\n`); process.exit(missing.length ? 2 : 0); }
if (missing.length) { process.stderr.write(`D preflight failed; compose C first: ${missing.join(", ")}\n`); process.exit(2); }
const next = spawnSync(process.execPath, [orchestrate, "next", "--project-dir", projectDir], { cwd: projectDir, encoding: "utf8" });
if (next.status !== 0) { process.stderr.write(next.stderr || next.stdout); process.exit(next.status ?? 2); }
const directive = JSON.parse(next.stdout);
const readOnlyStages = new Set(enabled.supportedReadOnlyFanout);
const designStages = new Set(enabled.supportedDesignWaves);
if (directive.gate || directive.kind !== "run-stage" || (!readOnlyStages.has(directive.stage) && !designStages.has(directive.stage))) {
  process.stdout.write(`${JSON.stringify({ status: "official-host-action-required", reason: directive.gate ? "official-gate" : "unsupported-directive", directive, enabled }, null, 2)}\n`);
  process.exit(0);
}
if (directive.kind === "run-stage" && readOnlyStages.has(directive.stage)) {
  const input = value("--fanout-input");
  if (!input) { process.stdout.write(`${JSON.stringify({ status: "official-host-action-required", reason: "read-only-fanout-input-required", directive, enabled }, null, 2)}\n`); process.exit(2); }
  const command = [join(import.meta.dir, "read-only-fanout.ts"), "--input", input, "--project-dir", projectDir, "--framework-dir", runtime, "--engine-dir", tools];
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
