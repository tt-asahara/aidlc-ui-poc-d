#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveDAutomation, resolveDIssueAutopilot } from "./d-config.ts";
import { runIssueAutopilot, issueAutopilotStatus, type EngineAdapter, type OfficialDirective } from "./issue-autopilot.ts";
import { createFileAssumptionLedger, createFileClaimStore, createGhIssueSource, issueAutopilotRuntimePaths } from "./issue-autopilot-runtime.ts";

type Json = Record<string, unknown>;
const argv = process.argv.slice(2);
const value = (flag: string) => { const at = argv.indexOf(flag); return at < 0 ? undefined : argv[at + 1]; };
const projectDir = value("--project-dir");
if (!projectDir || !isAbsolute(projectDir)) throw new Error("--project-dir must be an absolute PRODUCT path");
const positional = argv.filter((item, index) => !item.startsWith("--") && (index === 0 || !argv[index - 1]?.startsWith("--")));
const command = positional[0] ?? "status";
const runtime = join(projectDir, ".claude", "tools");
const orchestrate = join(runtime, "aidlc-orchestrate.ts");
const utility = join(runtime, "aidlc-utility.ts");

function runJson(executable: string, args: string[]): Json {
  const result = spawnSync(process.execPath, [executable, ...args, "--project-dir", projectDir], { cwd: projectDir, encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "official command failed").trim());
  try { return JSON.parse(result.stdout) as Json; } catch { return { kind: "print", message: result.stdout.trim() }; }
}

function issueAlreadyExists(issueNumber: number): boolean {
  const spaces = join(projectDir, "aidlc", "spaces");
  if (!existsSync(spaces)) return false;
  const pending = [spaces];
  let seen = 0;
  while (pending.length && seen++ < 4096) {
    const dir = pending.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.name === "project-description.json") {
        try { if (readFileSync(path, "utf8").includes(`GitHub issue #${issueNumber}`)) return true; } catch {}
      }
    }
  }
  return false;
}

class OfficialEngine implements EngineAdapter {
  private issueNumber = 0;
  async createIntent(args: readonly ["--new-intent", "--scope", string, "--label", string, string]): Promise<OfficialDirective> {
    const description = args[5];
    const match = /GitHub issue #(\d+)/.exec(description); this.issueNumber = Number(match?.[1] ?? 0);
    runJson(utility, ["intent-create", "--scope", args[2], "--label", args[4], "--arguments", description]);
    return runJson(orchestrate, ["next"]) as OfficialDirective;
  }
  async next() { return runJson(orchestrate, ["next"]) as OfficialDirective; }
  async execute(directive: Readonly<OfficialDirective>) { return { ...directive, kind: "official-host-action-required" }; }
  async reconcileIntent(issueNumber: number) { return issueAlreadyExists(issueNumber) ? this.next() : null; }
}

const auto = resolveDAutomation(projectDir), autopilot = resolveDIssueAutopilot(projectDir);
const config = { enabled: auto.enabled && autopilot.enabled, labelAllowlist: auto.labelAllowlist, uncertaintyPolicy: auto.assumptionLedger ? auto.ambiguityPolicy : "halt" as const, through: auto.through, sessionAuto: false, maxRetries: auto.maxRetries, maxSteps: auto.maxSteps, deadlineMs: auto.deadlineMs };
if (command === "status") { process.stdout.write(`${JSON.stringify(issueAutopilotStatus(config), null, 2)}\n`); process.exit(0); }
if (!config.enabled && command !== "stop") { process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "disabled" })}\n`); process.exit(0); }
const paths = issueAutopilotRuntimePaths(projectDir);
if (command === "stop") { writeFileSync(paths.stop, "stop\n", { mode: 0o600 }); process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "operator-stop", stopFile: paths.stop })}\n`); process.exit(0); }
if (existsSync(paths.stop)) { unlinkSync(paths.stop); process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "operator-stop" })}\n`); process.exit(0); }

const issueNumber = /^\d+$/.test(command) ? Number(command) : undefined;
const requiredLabel = issueNumber || command === "list" ? undefined : command;
const effective = requiredLabel ? { ...config, labelAllowlist: [...config.labelAllowlist, requiredLabel] } : config;
const issues = createGhIssueSource({ cwd: projectDir, repository: value("--repo"), executable: value("--gh-executable") });
if (command === "list") { process.stdout.write(`${JSON.stringify({ status: "selection-required", issues: await issues.list() }, null, 2)}\n`); process.exit(0); }
const result = await runIssueAutopilot({
  config: effective,
  selection: issueNumber ? { issueNumber } : { selectFromList: async (choices) => command === "list" ? null : choices.find((item) => item.labels.includes(requiredLabel!))?.number ?? null },
  owner: value("--owner") ?? `pid-${process.pid}`,
  scope: value("--scope") ?? "feature",
  deps: {
    issues,
    claims: createFileClaimStore({ directory: paths.claims, leaseMs: 60_000 }),
    assumptions: createFileAssumptionLedger(paths.assumptions),
    assessor: { async assess(issue, mode) { const unresolved = issue.title.trim() && issue.body.trim() ? [] : ["Issue title and body are required"]; return { unresolved, description: issue.body, assumptions: mode === "assume" && unresolved.length ? unresolved : [], researchedFacts: [] }; } },
    engine: new OfficialEngine(),
  },
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
