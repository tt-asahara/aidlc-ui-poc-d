import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planReadOnlyFanout, runReadOnlyFanout, validateClaudeReadOnlyCapabilities, verifyFreshDirective } from "../read-only-fanout.ts";
import policy from "../stage-policy.json";

const repo = join(import.meta.dir, "..", "..", "..");
const options = { projectDir: repo, frameworkDir: join(repo, "core") };
const directive = { kind: "run-stage", stage: "market-research", phase: "ideation", mode: "inline", gate: false, lead_agent: "aidlc-product-agent", support_agents: [], inline_context_paths: ["core/agents/aidlc-product-agent.md"], memory_path: "aidlc/spaces/default/intents/example/ideation/market-research/memory.md", consumes: [], produces: ["aidlc/spaces/default/intents/example/ideation/market-research/research.md"], rules_in_context: [], sensors_applicable: [], ceremony: { sensors: "on", learnings: "on", summary_confirmation: "on", plan_approval: "on", collaborators: "off" }, stage_file: "core/aidlc-common/stages/ideation/market-research.md" };
const tasks = [
  { id: "constraints", agent: "aidlc-architect-agent", objective: "Extract technical constraints", evidencePaths: ["README.md", "core"] },
  { id: "quality", agent: "aidlc-quality-agent", objective: "Find existing quality evidence", evidencePaths: ["tests"] },
];
const catalog = { balanced: "runtime-confirmed-balanced", judgment: "runtime-confirmed-judgment" };
const fullHelp = "--print --output-format --no-session-persistence --restricted --strict-mcp-config --mcp-config --disable-slash-commands --permission-mode --permission-prompts --tools --allowed-tools --disallowed-tools --agents --agent --model --effort";

describe("read-only within-stage fanout", () => {
  test("is enabled only through the all-stage policy and projects official agents", () => {
    expect(policy.stages.find((entry) => entry.stage === "market-research")).toMatchObject({ status: "implemented-read-only-fanout", parallelism: "read-only-fanout" });
    const result = planReadOnlyFanout({ directive, tasks, modelCatalog: catalog }, options);
    expect(result.action).toBe("unverified-read-only-fanout-plan");
    expect(result.verifiedAgainstFreshNext).toBeFalse();
    expect(result.routing).toEqual({ tier: "balanced", effort: "medium", requestedModel: "runtime-confirmed-balanced", source: "stage-policy" });
    expect(result.launches).toHaveLength(2);
    const launch = result.launches[0]!.launch;
    expect(launch.args).toContain("--agent"); expect(launch.args).toContain("aidlc-architect-agent");
    expect(launch.args).toContain("--agents");
    const projection = JSON.parse(launch.args[launch.args.indexOf("--agents") + 1]!);
    expect(projection["aidlc-architect-agent"].tools).toEqual(["Read", "Grep", "Glob"]);
  });
  test("validates maxParallel as a bounded positive finite integer", () => {
    for (const maxParallel of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 5]) expect(() => planReadOnlyFanout({ directive, tasks, modelCatalog: catalog, maxParallel }, options)).toThrow("maxParallel");
    for (const maxParallel of [1, 4]) expect(planReadOnlyFanout({ directive, tasks, modelCatalog: catalog, maxParallel }, options).maxParallel).toBe(Math.min(maxParallel, tasks.length));
  });
  test("enforces a CLI tool allowlist, denies permission prompts, MCP, sessions, writes, shell, and web", () => {
    const launch = planReadOnlyFanout({ directive, tasks, modelCatalog: catalog }, options).launches[0]!.launch;
    const args = launch.args.join(" ");
    for (const required of ["--restricted", "--strict-mcp-config", "--no-session-persistence", "--permission-mode dontAsk", "--permission-prompts none", "--tools Read,Grep,Glob", "--allowed-tools Read,Grep,Glob", "--disallowed-tools Bash,Edit,Write,NotebookEdit,Agent,Task,WebFetch,WebSearch"]) expect(args).toContain(required);
    expect(launch.executable).toBe("claude");
  });
  test("fails closed when the installed CLI lacks an enforcement capability", () => {
    expect(() => validateClaudeReadOnlyCapabilities("--tools --restricted")).toThrow("cannot enforce read-only fanout");
    expect(() => validateClaudeReadOnlyCapabilities(fullHelp)).not.toThrow();
    expect(() => validateClaudeReadOnlyCapabilities(fullHelp.replace("--mcp-config", ""))).toThrow("--mcp-config");
    expect(() => validateClaudeReadOnlyCapabilities(fullHelp.replace("--disable-slash-commands", ""))).toThrow("--disable-slash-commands");
  });
  test("hands official ensemble topologies back without launching workers", () => {
    for (const [stage, mode] of [["user-stories", "mob"], ["practices-discovery", "subagent"], ["reverse-engineering", "pipeline"]] as const) {
      const result = planReadOnlyFanout({ directive: { ...directive, stage, mode }, tasks, modelCatalog: catalog }, options);
      expect(result).toMatchObject({ action: "official-host-action-required", reason: `official-${mode}-contract`, launches: [] });
    }
  });
  test("requires a fresh matching active inline stage and record", () => {
    expect(verifyFreshDirective(directive, structuredClone(directive))).toMatchObject({ valid: true });
    expect(verifyFreshDirective(directive, { ...directive, gate: true })).toMatchObject({ valid: false, reason: "fresh-next-is-not-active-inline-stage" });
    expect(verifyFreshDirective(directive, { ...directive, kind: "ask" })).toMatchObject({ valid: false });
    expect(verifyFreshDirective(directive, { ...directive, stage: "feasibility" })).toMatchObject({ valid: false, reason: "fresh-next-does-not-match-caller-stage-record" });
    expect(verifyFreshDirective(directive, { ...directive, memory_path: "aidlc/spaces/default/intents/other/ideation/market-research/memory.md" })).toMatchObject({ valid: false, reason: "fresh-next-does-not-match-caller-stage-record" });
  });
  test("calls fresh next and refuses a gate before any worker launch", async () => {
    const root = mkdtempSync(join(tmpdir(), "aidlc-d-fresh-next-")); const engine = join(root, "tools"); mkdirSync(engine);
    writeFileSync(join(engine, "aidlc-orchestrate.ts"), `process.stdout.write(${JSON.stringify(`${JSON.stringify({ ...directive, gate: true })}\n`)});\n`);
    try {
      const result = await runReadOnlyFanout({ directive, tasks, modelCatalog: catalog }, { ...options, engineDir: engine, claudeExecutable: "/must-not-launch" });
      expect(result).toMatchObject({ action: "official-host-action-required", reason: "fresh-next-is-not-active-inline-stage", launches: [] });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("rejects stages not enabled by policy and evidence paths outside the project", () => {
    expect(planReadOnlyFanout({ directive: { ...directive, stage: "scope-definition" }, tasks, modelCatalog: catalog }, options).action).toBe("official-host-action-required");
    const outside = mkdtempSync(join(tmpdir(), "aidlc-d-outside-")); const link = join(repo, ".aidlc-d-outside-link"); symlinkSync(outside, link);
    try { expect(() => planReadOnlyFanout({ directive, tasks: [{ ...tasks[0]!, evidencePaths: [link] }, tasks[1]!], modelCatalog: catalog }, options)).toThrow("escapes project"); }
    finally { rmSync(link); rmSync(outside, { recursive: true, force: true }); }
  });
});
