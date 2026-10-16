import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { planReadOnlyFanout, validateClaudeReadOnlyCapabilities } from "../read-only-fanout.ts";
import policy from "../stage-policy.json";

const repo = join(import.meta.dir, "..", "..", "..");
const options = { projectDir: repo, frameworkDir: join(repo, "core") };
const directive = { kind: "run-stage", stage: "market-research", mode: "inline", gate: false, lead_agent: "aidlc-product-agent", support_agents: [] };
const tasks = [
  { id: "constraints", agent: "aidlc-architect-agent", objective: "Extract technical constraints", evidencePaths: ["README.md", "core"] },
  { id: "quality", agent: "aidlc-quality-agent", objective: "Find existing quality evidence", evidencePaths: ["tests"] },
];

describe("read-only within-stage fanout", () => {
  test("is enabled only through the all-stage policy and projects official agents", () => {
    expect(policy.stages.find((entry) => entry.stage === "market-research")).toMatchObject({ status: "implemented-read-only-fanout", parallelism: "read-only-fanout" });
    const result = planReadOnlyFanout({ directive, tasks, model: "runtime-confirmed-model" }, options);
    expect(result.action).toBe("execute-read-only-fanout");
    expect(result.launches).toHaveLength(2);
    const launch = result.launches[0]!.launch;
    expect(launch.args).toContain("--agent"); expect(launch.args).toContain("aidlc-architect-agent");
    expect(launch.args).toContain("--agents");
    const projection = JSON.parse(launch.args[launch.args.indexOf("--agents") + 1]!);
    expect(projection["aidlc-architect-agent"].tools).toEqual(["Read", "Grep", "Glob"]);
  });
  test("enforces a CLI tool allowlist, denies permission prompts, MCP, sessions, writes, shell, and web", () => {
    const launch = planReadOnlyFanout({ directive, tasks, model: "runtime-confirmed-model" }, options).launches[0]!.launch;
    const args = launch.args.join(" ");
    for (const required of ["--restricted", "--strict-mcp-config", "--no-session-persistence", "--permission-mode dontAsk", "--permission-prompts none", "--tools Read,Grep,Glob", "--allowed-tools Read,Grep,Glob", "--disallowed-tools Bash,Edit,Write,NotebookEdit,Agent,Task,WebFetch,WebSearch"]) expect(args).toContain(required);
    expect(launch.executable).toBe("claude");
  });
  test("fails closed when the installed CLI lacks an enforcement capability", () => {
    expect(() => validateClaudeReadOnlyCapabilities("--tools --restricted")).toThrow("cannot enforce read-only fanout");
    expect(() => validateClaudeReadOnlyCapabilities("--tools --allowedTools --disallowedTools --restricted --strict-mcp-config --permission-mode --permission-prompts --no-session-persistence --agents --agent")).not.toThrow();
  });
  test("hands official ensemble topologies back without launching workers", () => {
    for (const [stage, mode] of [["user-stories", "mob"], ["practices-discovery", "subagent"], ["reverse-engineering", "pipeline"]] as const) {
      const result = planReadOnlyFanout({ directive: { ...directive, stage, mode }, tasks, model: "runtime-confirmed-model" }, options);
      expect(result).toMatchObject({ action: "official-host-action-required", reason: `official-${mode}-contract`, launches: [] });
    }
  });
  test("rejects stages not enabled by policy and evidence paths outside the project", () => {
    expect(planReadOnlyFanout({ directive: { ...directive, stage: "scope-definition" }, tasks, model: "runtime-confirmed-model" }, options).action).toBe("official-host-action-required");
    expect(() => planReadOnlyFanout({ directive, tasks: [{ ...tasks[0]!, evidencePaths: ["../secret"] }, tasks[1]!], model: "runtime-confirmed-model" }, options)).toThrow("escapes project");
  });
});
