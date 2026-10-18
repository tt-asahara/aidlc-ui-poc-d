import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const cli = join(import.meta.dir, "..", "d-feature-checks.ts");
const boundary = join(import.meta.dir, "..", "host-stage-boundary.ts");
const publicCli = join(import.meta.dir, "..", "run.ts");
function project(config: unknown) { const root = mkdtempSync(join(tmpdir(), "d-feature-entry-")); mkdirSync(join(root, ".claude")); writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify(config)); return root; }
function run(root: string) { return spawnSync(process.execPath, [cli, "--project-dir", root, "--input", "input.json"], { cwd: root, encoding: "utf8" }); }
const STORIES = "# Stories\n\n### US1.1 Example\n\n- **受入条件**\n  - **AC1.1.1** Given x When y Then z\n";
function officialDirective(stage = "functional-design", unit?: string) {
  return { kind: "run-stage", stage, phase: "construction", lead_agent: "aidlc-developer-agent", support_agents: [], mode: "inline", inline_context_paths: ["core/agents/aidlc-developer-agent.md"], gate: false, memory_path: `aidlc/spaces/default/intents/example/construction/${stage}/memory.md`, consumes: [], produces: ["artifact.md"], rules_in_context: [], sensors_applicable: [], ceremony: { sensors: "on", learnings: "on", summary_confirmation: "on", plan_approval: "on", collaborators: "off" }, stage_file: `core/aidlc-common/stages/construction/${stage}.md`, ...(unit ? { unit } : {}) };
}
function installFreshEngine(root: string, directive: unknown) {
  const engine = join(root, "engine"); mkdirSync(engine, { recursive: true });
  writeFileSync(join(engine, "aidlc-orchestrate.ts"), `process.stdout.write(${JSON.stringify(`${JSON.stringify({ directive })}\n`)});\n`);
  return engine;
}

// Multi-part rule delivery: `next` restarts at steering part one, each
// `continue <receipt>` returns the following part, and the last continuation
// returns the run-stage (as the official engine does once team memory no
// longer fits beside the run-stage). Records every call it receives.
function installSteeringEngine(root: string, directive: Record<string, unknown>, parts = 2) {
  const engine = join(root, "steering-engine"); mkdirSync(engine, { recursive: true });
  const steering = (part: number) => ({ kind: "load-steering", stage: directive.stage, bundle: `sha256:${"0".repeat(64)}`, part, parts, receipt: `rcpt000${part}`, next: `bun aidlc-orchestrate.ts continue rcpt000${part}`, rules_content: [{ path: "memory/team.md", text: `rules part ${part}` }] });
  const script = `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2).filter((a, i, all) => a !== "--project-dir" && all[i - 1] !== "--project-dir");
appendFileSync(${JSON.stringify(join(root, "engine-calls.log"))}, JSON.stringify(args) + "\\n");
const steering = ${JSON.stringify(Array.from({ length: parts }, (_, i) => steering(i + 1)))};
const runStage = ${JSON.stringify(directive)};
let out;
if (args[0] === "next") out = steering[0];
else if (args[0] === "continue") { const i = steering.findIndex((s) => s.receipt === args[1]); out = i < 0 ? null : (steering[i + 1] ?? runStage); }
if (!out) { process.stderr.write("bad call " + JSON.stringify(args)); process.exit(1); }
process.stdout.write(JSON.stringify({ directive: out }) + "\\n");
`;
  writeFileSync(join(engine, "aidlc-orchestrate.ts"), script);
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
    writeFileSync(join(root, "stories.md"), STORIES); writeFileSync(join(root, "trace.json"), JSON.stringify({ upstream_ids: ["AC1.1.1"], coverage: [] }));
    writeFileSync(join(root, "ui.json"), JSON.stringify({ schema: 1, mappings: [{ screen: "s", state: "x", ac: "UNKNOWN" }], requiredMappings: ["s/x/UNKNOWN"] }));
    writeFileSync(join(root, "functional.md"), "# Functional\n");
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", storiesPath: "stories.md", traceabilityPath: "trace.json", uiContractPath: "ui.json", functionalArtifacts: { "functional-spec.md": "functional.md" } }));
    const directive = { ...officialDirective(), consumes: ["stories.md", "ui.json"], produces: ["functional.md", "trace.json"] }; writeFileSync(join(root, "directive.json"), JSON.stringify(directive));
    const result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installFreshEngine(root, directive)], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(2); const output = JSON.parse(result.stdout); expect(output.verdict).toBe("NOT-READY"); expect(output.notReady).toContain("requirementIdValidation"); expect(existsSync(output.evidencePath)).toBe(true);
  });
  test("follows multi-part load-steering to the run-stage before binding the boundary", () => {
    const root = project({ features: { requirementIdValidation: true } });
    writeFileSync(join(root, "stories.md"), STORIES);
    writeFileSync(join(root, "ui.json"), JSON.stringify({ schema: 1, mappings: [{ screen: "s", state: "x", ac: "AC1.1.1" }], requiredMappings: ["s/x/AC1.1.1"] }));
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", storiesPath: "stories.md", uiContractPath: "ui.json" }));
    const directive = { ...officialDirective(), gate: true, consumes: ["stories.md", "ui.json"] }; writeFileSync(join(root, "directive.json"), JSON.stringify(directive));
    const result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installSteeringEngine(root, directive, 3)], { cwd: root, encoding: "utf8" });
    expect(result.stderr).not.toContain("host boundary");
    expect(result.status).toBe(0);
    const calls = readFileSync(join(root, "engine-calls.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    // The engine's active marker ends on the run-stage the host is executing.
    expect(calls).toEqual([["next"], ["continue", "rcpt0001"], ["continue", "rcpt0002"], ["continue", "rcpt0003"]]);
  });

  test("refuses steering for another stage and a run-stage that differs from the executed one", () => {
    const root = project({ features: { requirementIdValidation: true } });
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design" }));
    const directive = { ...officialDirective(), gate: true }; writeFileSync(join(root, "directive.json"), JSON.stringify(directive));
    let result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installSteeringEngine(root, { ...directive, stage: "code-generation" })], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("steering belongs to another stage");
    result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installSteeringEngine(join(root, "b"), { ...directive, unit: "beta" })], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("stale or does not match");
  });

  test("runs requirement ID validation at the official refined-mockups handoff", () => {
    const root = project({ features: { requirementIdValidation: true } });
    writeFileSync(join(root, "stories.md"), STORIES);
    writeFileSync(join(root, "ui.json"), JSON.stringify({ schema: 1, mappings: [{ screen: "s", state: "x", ac: "UNKNOWN" }], requiredMappings: ["s/x/UNKNOWN"] }));
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "refined-mockups", storiesPath: "stories.md", uiContractPath: "ui.json" }));
    const result = run(root); expect(result.status).toBe(2); expect(JSON.parse(result.stdout).notReady).toContain("requirementIdValidation");
  });
  test("requires a valid, fresh, exact official run-stage directive including Unit state", () => {
    const root = project({}); writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", unit: "alpha" }));
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "run-stage", stage: "functional-design" }));
    let result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installFreshEngine(root, officialDirective("functional-design", "alpha"))], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("valid official directive");
    const saved = officialDirective("functional-design", "alpha"); writeFileSync(join(root, "directive.json"), JSON.stringify(saved));
    result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installFreshEngine(root, { ...saved, unit: "beta" })], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("stale or does not match");
    const gated = { ...saved, gate: true }; writeFileSync(join(root, "directive.json"), JSON.stringify(gated));
    result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installFreshEngine(root, gated)], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ status: "disabled-or-not-applicable" });
    const ask = { kind: "ask", ask_type: "scope-confirm", response_route: "next", question: "Continue?", proposed_scope: "feature", confirm_command: "aidlc engine orchestrate next --scope feature", compose_command: "aidlc engine orchestrate next compose", scope_commands: [], choices: [{ label: "Continue", command: "aidlc engine orchestrate next --scope feature" }, { label: "Tailor", command: "aidlc engine orchestrate next compose" }] };
    writeFileSync(join(root, "directive.json"), JSON.stringify(ask));
    result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installFreshEngine(root, ask)], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("active run-stage directive");
    const unresolved = { ...saved, gate: "unresolved" }; writeFileSync(join(root, "directive.json"), JSON.stringify(unresolved));
    result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installFreshEngine(root, unresolved)], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("resolved boolean run-stage gate");
  });
  test("binds every feature manifest input to the fresh directive artifact surface", () => {
    const root = project({ features: { requirementIdValidation: true } });
    writeFileSync(join(root, "stories.md"), STORIES);
    writeFileSync(join(root, "ui.json"), JSON.stringify({ schema: 1, mappings: [{ screen: "s", state: "x", ac: "AC1.1.1" }], requiredMappings: ["s/x/AC1.1.1"] }));
    writeFileSync(join(root, "other.json"), JSON.stringify({ schema: 1, mappings: [], requiredMappings: [] }));
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", storiesPath: "stories.md", uiContractPath: "other.json" }));
    const directive = { ...officialDirective(), consumes: ["stories.md", "ui.json"] };
    writeFileSync(join(root, "directive.json"), JSON.stringify(directive));
    const result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", installFreshEngine(root, directive)], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not declared by the fresh directive");
  });
  test("public CLI cannot bypass the verified host boundary", () => {
    const root = project({});
    const tools = join(root, ".claude", "tools"); mkdirSync(join(root, ".claude", "sensors"), { recursive: true }); mkdirSync(join(tools, "ui-poc"), { recursive: true }); mkdirSync(join(tools, "data"), { recursive: true });
    for (const path of [join(root, ".claude", "sensors", "aidlc-ui-poc-evidence.md"), join(tools, "ui-poc", "c-stage-routing.json"), join(tools, "data", "plugin-contrib-ui-poc.json"), join(tools, "data", "plugin-files-ui-poc.json")]) writeFileSync(path, "{}");
    writeFileSync(join(tools, "aidlc-orchestrate.ts"), "process.exit(99);\n");
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design" }));
    let result = spawnSync(process.execPath, [publicCli, "--project-dir", root, "--stage-check-input", "input.json"], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("requires --directive-file");
    const directive = { ...officialDirective(), gate: true }; writeFileSync(join(root, "directive.json"), JSON.stringify(directive));
    writeFileSync(join(tools, "aidlc-orchestrate.ts"), `process.stdout.write(${JSON.stringify(`${JSON.stringify({ directive })}\n`)});\n`);
    result = spawnSync(process.execPath, [publicCli, "--project-dir", root, "--stage-check-input", "input.json", "--directive-file", "directive.json"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ status: "disabled-or-not-applicable", stage: "functional-design" });
    writeFileSync(join(root, "directive.json"), JSON.stringify({ ...directive, stage: "code-generation" }));
    result = spawnSync(process.execPath, [publicCli, "--project-dir", root, "--stage-check-input", "input.json", "--directive-file", "directive.json"], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("stage mismatch");
    const unresolved = { ...directive, gate: "unresolved" }; writeFileSync(join(root, "directive.json"), JSON.stringify(unresolved)); writeFileSync(join(tools, "aidlc-orchestrate.ts"), `process.stdout.write(${JSON.stringify(`${JSON.stringify({ directive: unresolved })}\n`)});\n`);
    result = spawnSync(process.execPath, [publicCli, "--project-dir", root, "--stage-check-input", "input.json", "--directive-file", "directive.json"], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("resolved boolean run-stage gate");
  });
  test("rejects input and output paths outside the product", () => {
    const root = project({ features: { requirementIdValidation: true } });
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", traceabilityPath: "../outside.json", uiContractPath: "../outside.json" }));
    expect(run(root).status).not.toBe(0);
    writeFileSync(join(root, "ui.json"), JSON.stringify({ schema: 1, mappings: [], requiredMappings: [] }));
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", storiesPath: "../outside.md", uiContractPath: "ui.json" }));
    const escaped = run(root); expect(escaped.status).not.toBe(0); expect(escaped.stderr).toContain("escapes project");
    writeFileSync(join(root, "stories.md"), STORIES); writeFileSync(join(root, "ui.json"), JSON.stringify({ schema: 1, mappings: [], requiredMappings: [] }));
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", storiesPath: "stories.md", uiContractPath: "ui.json", groundingOutputPath: "../escape.json" }));
    expect(run(root).status).not.toBe(0);
  });
});

describe("feature 21 on official acceptance-criteria IDs (real-shape paths)", () => {
  const FIX = join(import.meta.dir, "..", "fixtures", "official-ac");
  const INTENT = "aidlc/spaces/default/intents/261018-example";
  const STORIES_PATH = `${INTENT}/inception/user-stories/stories.md`;
  const TRACE_PATH = `${INTENT}/inception/user-stories/traceability.json`;
  const REFINED = `${INTENT}/inception/refined-mockups`;
  const CONTRACT_PATH = `${REFINED}/ui-poc-refined-contract.md`;
  function realShape(config: unknown = { features: { requirementIdValidation: true } }, contractFixture = "ui-poc-refined-contract.md") {
    const root = project(config);
    for (const dir of [`${INTENT}/inception/user-stories`, REFINED]) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, STORIES_PATH), readFileSync(join(FIX, "stories.md")));
    writeFileSync(join(root, TRACE_PATH), JSON.stringify({ stage: "user-stories", upstream_ids: ["FR1", "NFR1"], coverage: [{ id: "FR1", status: "OK", target: "US1.1" }] }));
    writeFileSync(join(root, CONTRACT_PATH), readFileSync(join(FIX, contractFixture)));
    writeFileSync(join(root, `${REFINED}/mockups.md`), "# Mockups\n");
    return root;
  }
  // The refined-mockups run-stage as the composed engine emits it: core consumes
  // (stories among them) plus the C plugin's ui-poc-refined-contract produce.
  const refinedDirective = () => ({ ...officialDirective("refined-mockups"), phase: "inception", stage_file: "core/aidlc-common/stages/inception/refined-mockups.md", memory_path: `${REFINED}/memory.md`, gate: true,
    consumes: [`${INTENT}/ideation/rough-mockups/wireframes.md`, STORIES_PATH, `${INTENT}/inception/requirements-analysis/requirements.md`],
    produces: [`${REFINED}/mockups.md`, `${REFINED}/interaction-spec.md`, CONTRACT_PATH] });
  const boundaryRun = (root: string, directive: Record<string, unknown>, steering = true) => {
    writeFileSync(join(root, "directive.json"), JSON.stringify(directive));
    return spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json", "--engine-dir", steering ? installSteeringEngine(root, directive, 2) : installFreshEngine(root, directive)], { cwd: root, encoding: "utf8" });
  };

  test("refined-mockups: stories.md + the Markdown C contract with official IDs pass the boundary", () => {
    const root = realShape();
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "refined-mockups", unit: null, storiesPath: STORIES_PATH, uiContractPath: CONTRACT_PATH, artifactPaths: [`${REFINED}/mockups.md`, STORIES_PATH] }));
    const result = boundaryRun(root, refinedDirective());
    expect(result.stderr).toBe(""); expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.verdict).toBe("READY");
    expect(output.results.requirementIdValidation).toMatchObject({ pass: true, checkedMappings: 31, findings: [] });
    expect(output.results.requirementIdValidation.officialAcCount).toBeGreaterThan(31);
  });

  test("refined-mockups: the user-stories traceability.json is not declared there and is refused", () => {
    const root = realShape();
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "refined-mockups", storiesPath: STORIES_PATH, traceabilityPath: TRACE_PATH, uiContractPath: CONTRACT_PATH }));
    const result = boundaryRun(root, refinedDirective(), false);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`not declared by the fresh directive: ${TRACE_PATH}`);
  });

  test("functional-design: the composed directive declares stories, the refined contract, and the Unit traceability (union)", () => {
    const root = realShape();
    const fd = `${INTENT}/construction/u1-example/functional-design`; mkdirSync(join(root, fd), { recursive: true });
    writeFileSync(join(root, `${fd}/traceability.json`), JSON.stringify({ stage: "functional-design", upstream_ids: ["AC1.1.1"], coverage: [{ id: "AC1.1.1", status: "OK", target: "BR1.1" }] }));
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", unit: "u1-example", storiesPath: STORIES_PATH, traceabilityPath: `${fd}/traceability.json`, uiContractPath: CONTRACT_PATH }));
    const directive = { ...officialDirective("functional-design", "u1-example"), consumes: [`${INTENT}/inception/units-generation/unit-of-work.md`, CONTRACT_PATH, STORIES_PATH], produces: [`${fd}/functional-spec.md`, `${fd}/traceability.json`] };
    const result = boundaryRun(root, directive, false);
    expect(result.stderr).toBe(""); expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).results.requirementIdValidation).toMatchObject({ pass: true, findings: [] });
    // Without the composed stories consume the boundary refuses instead of guessing.
    const bare = { ...directive, consumes: [`${INTENT}/inception/units-generation/unit-of-work.md`, CONTRACT_PATH] };
    const refused = boundaryRun(root, bare, false);
    expect(refused.status).not.toBe(0); expect(refused.stderr).toContain(`not declared by the fresh directive: ${STORIES_PATH}`);
  });

  test("missing stories input, missing file, unknown and duplicate ACs are recorded NOT-READY with exact findings", () => {
    const root = realShape();
    const findings = (manifest: Record<string, unknown>) => { writeFileSync(join(root, "input.json"), JSON.stringify(manifest)); const result = run(root); expect(result.status).toBe(2); const output = JSON.parse(result.stdout); expect(output.verdict).toBe("NOT-READY"); expect(existsSync(output.evidencePath)).toBe(true); return output.results.requirementIdValidation.findings.map((f: { code: string }) => f.code); };
    expect(findings({ stage: "refined-mockups", uiContractPath: CONTRACT_PATH })).toContain("MISSING_STORIES_INPUT");
    expect(findings({ stage: "refined-mockups", storiesPath: `${INTENT}/inception/user-stories/missing.md`, uiContractPath: CONTRACT_PATH })).toContain("STORIES_NOT_FOUND");
    writeFileSync(join(root, "dup.md"), `${readFileSync(join(FIX, "stories.md"), "utf8")}\n- **AC1.1.1** duplicated definition\n`);
    expect(findings({ stage: "refined-mockups", storiesPath: "dup.md", uiContractPath: CONTRACT_PATH })).toEqual(["DUPLICATE_OFFICIAL_AC"]);
    writeFileSync(join(root, "few.md"), "- AC1.1.1 only one\n");
    expect(new Set(findings({ stage: "refined-mockups", storiesPath: "few.md", uiContractPath: CONTRACT_PATH }))).toEqual(new Set(["UNKNOWN_AC"]));
  });

  test("a legacy AC- contract still validates only with explicit bridges", () => {
    const bridges = JSON.parse(readFileSync(join(FIX, "legacy-bridges.json"), "utf8"));
    let root = realShape({ features: { requirementIdValidation: true } }, "ui-poc-refined-contract.legacy.md");
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "refined-mockups", storiesPath: STORIES_PATH, uiContractPath: CONTRACT_PATH }));
    expect(run(root).status).toBe(2);
    root = realShape({ features: { requirementIdValidation: true }, featureInputs: { requirementIdBridges: bridges } }, "ui-poc-refined-contract.legacy.md");
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "refined-mockups", storiesPath: STORIES_PATH, uiContractPath: CONTRACT_PATH }));
    const result = run(root); expect(result.status).toBe(0); expect(JSON.parse(result.stdout).verdict).toBe("READY");
  });
});
