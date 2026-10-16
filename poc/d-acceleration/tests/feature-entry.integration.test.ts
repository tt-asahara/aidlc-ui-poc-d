import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const cli = join(import.meta.dir, "..", "d-feature-checks.ts");
const boundary = join(import.meta.dir, "..", "host-stage-boundary.ts");
function project(config: unknown) { const root = mkdtempSync(join(tmpdir(), "d-feature-entry-")); mkdirSync(join(root, ".claude")); writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify(config)); return root; }
function run(root: string) { return spawnSync(process.execPath, [cli, "--project-dir", root, "--input", "input.json"], { cwd: root, encoding: "utf8" }); }
function officialDirective(stage = "functional-design", unit?: string) {
  return { kind: "run-stage", stage, phase: "construction", lead_agent: "aidlc-developer-agent", support_agents: [], mode: "inline", inline_context_paths: ["core/agents/aidlc-developer-agent.md"], gate: false, memory_path: `aidlc/spaces/default/intents/example/construction/${stage}/memory.md`, consumes: [], produces: ["artifact.md"], rules_in_context: [], sensors_applicable: [], ceremony: { sensors: "on", learnings: "on", summary_confirmation: "on", plan_approval: "on", collaborators: "off" }, stage_file: `core/aidlc-common/stages/construction/${stage}.md`, ...(unit ? { unit } : {}) };
}
function installFreshEngine(root: string, directive: unknown) {
  const engine = join(root, "engine"); mkdirSync(engine, { recursive: true });
  writeFileSync(join(engine, "aidlc-orchestrate.ts"), `process.stdout.write(${JSON.stringify(`${JSON.stringify({ directive })}\n`)});\n`);
  return engine;
}

describe("installed D feature-check entry", () => {
  test("all OFF exits before input artifacts or workers and writes no evidence", () => {
    const root = project({}); writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", traceabilityPath: "missing.json", uiContractPath: "missing.json" }));
    const result = run(root); expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ reads: 0, workerCalls: 0, artifactsWritten: 0 });
    expect(existsSync(join(root, "aidlc"))).toBe(false);
  });
  test("ON deterministic checks run from the entry and persist NOT-READY reviewer evidence", () => {
    const root = project({ features: { requirementIdValidation: true, functionalDesignDocumentDiscipline: true } });
    writeFileSync(join(root, "trace.json"), JSON.stringify({ upstream_ids: ["AC1"], coverage: [] }));
    writeFileSync(join(root, "ui.json"), JSON.stringify({ schema: 1, mappings: [{ screen: "s", state: "x", ac: "UNKNOWN" }], requiredMappings: ["s/x/UNKNOWN"] }));
    writeFileSync(join(root, "functional.md"), "# Functional\n");
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", traceabilityPath: "trace.json", uiContractPath: "ui.json", functionalArtifacts: { "functional-spec.md": "functional.md" } }));
    const directive = officialDirective(); writeFileSync(join(root, "directive.json"), JSON.stringify(directive));
    const result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installFreshEngine(root, directive)], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(2); const output = JSON.parse(result.stdout); expect(output.verdict).toBe("NOT-READY"); expect(output.notReady).toContain("requirementIdValidation"); expect(existsSync(output.evidencePath)).toBe(true);
  });
  test("runs requirement ID validation at the official refined-mockups handoff", () => {
    const root = project({ features: { requirementIdValidation: true } });
    writeFileSync(join(root, "trace.json"), JSON.stringify({ upstream_ids: ["AC1"], coverage: [] }));
    writeFileSync(join(root, "ui.json"), JSON.stringify({ schema: 1, mappings: [{ screen: "s", state: "x", ac: "UNKNOWN" }], requiredMappings: ["s/x/UNKNOWN"] }));
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "refined-mockups", traceabilityPath: "trace.json", uiContractPath: "ui.json" }));
    const result = run(root); expect(result.status).toBe(2); expect(JSON.parse(result.stdout).notReady).toContain("requirementIdValidation");
  });
  test("requires a valid, fresh, exact official non-gate directive including Unit state", () => {
    const root = project({}); writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", unit: "alpha" }));
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "run-stage", stage: "functional-design" }));
    let result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installFreshEngine(root, officialDirective("functional-design", "alpha"))], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("valid official directive");
    const saved = officialDirective("functional-design", "alpha"); writeFileSync(join(root, "directive.json"), JSON.stringify(saved));
    result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installFreshEngine(root, { ...saved, unit: "beta" })], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("stale or does not match");
    const gated = { ...saved, gate: true }; writeFileSync(join(root, "directive.json"), JSON.stringify(gated));
    result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installFreshEngine(root, gated)], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("active non-gate");
  });
  test("rejects input and output paths outside the product", () => {
    const root = project({ features: { requirementIdValidation: true } });
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", traceabilityPath: "../outside.json", uiContractPath: "../outside.json" }));
    expect(run(root).status).not.toBe(0);
    writeFileSync(join(root, "trace.json"), JSON.stringify({ upstream_ids: [], coverage: [] })); writeFileSync(join(root, "ui.json"), JSON.stringify({ schema: 1, mappings: [], requiredMappings: [] }));
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", traceabilityPath: "trace.json", uiContractPath: "ui.json", groundingOutputPath: "../escape.json" }));
    expect(run(root).status).not.toBe(0);
  });
});
