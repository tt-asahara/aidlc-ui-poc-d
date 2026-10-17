import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { classifyTask, consumeSpeculativeDrafts, maxConcurrency, merkleRoot, prepareTask, readOfficialSnapshot, runSerialFallback, runSpeculation, speculationDir, speculativeClaudeLaunch, type Interval, type SpeculativeTask, type TaskRunner } from "../cross-stage-speculation.ts";

const repo = join(import.meta.dir, "..", "..", "..");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const INTENT = "aidlc/spaces/default/intents/i1";
const presentGate = { kind: "present-gate", stage: "market-research", phase: "ideation", memory_path: `${INTENT}/ideation/market-research/memory.md` };
const runFeasibility = { kind: "run-stage", stage: "feasibility", phase: "ideation", mode: "inline", gate: false, lead_agent: "aidlc-architect-agent", support_agents: [], inline_context_paths: [], memory_path: `${INTENT}/ideation/feasibility/memory.md`, consumes: [], produces: [`${INTENT}/ideation/feasibility/feasibility-assessment.md`], rules_in_context: [], sensors_applicable: [], ceremony: { sensors: "on", learnings: "on", summary_confirmation: "on", plan_approval: "on", collaborators: "off" }, stage_file: "core/aidlc-common/stages/ideation/feasibility.md" };
const stateAt = (marketResearch: string) => `# State\n\n## Stage Progress\n- [x] intent-capture — EXECUTE\n- [${marketResearch}] market-research — EXECUTE\n- [ ] feasibility — EXECUTE\n- [ ] scope-definition — EXECUTE\n`;

// Independent: settled intent-capture output + repository evidence. Dependent: reads the gated stage's draft output.
const tasks: SpeculativeTask[] = [
  { id: "integration-constraints", targetStage: "feasibility", agent: "aidlc-architect-agent", objective: "List integration constraints implied by the intent", inputs: [`${INTENT}/ideation/intent-capture/intent-statement.md`, "docs/architecture.md"] },
  { id: "regulatory-scan", targetStage: "feasibility", agent: "aidlc-compliance-agent", objective: "Flag regulatory questions implied by the intent", inputs: [`${INTENT}/ideation/intent-capture/intent-statement.md`] },
  { id: "build-vs-buy-risk", targetStage: "feasibility", agent: "aidlc-architect-agent", objective: "Assess technical risk of the market build-vs-buy options", inputs: [`${INTENT}/ideation/market-research/build-vs-buy.md`] },
];

function fixture(parallel: boolean | undefined = undefined) {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "aidlc-d-spec-")));
  const framework = realpathSync(mkdtempSync(join(tmpdir(), "aidlc-d-spec-fw-")));
  roots.push(project, framework);
  const write = (path: string, body: string) => { mkdirSync(dirname(join(project, path)), { recursive: true }); writeFileSync(join(project, path), body); };
  write("aidlc/spaces/default/intents/active-intent", "i1\n");
  write(`${INTENT}/aidlc-state.md`, stateAt("?"));
  write(`${INTENT}/ideation/intent-capture/intent-statement.md`, "# Intent\nA synthetic notes app with offline sync.\n");
  write(`${INTENT}/ideation/market-research/build-vs-buy.md`, "# Build vs buy\nDraft awaiting human approval.\n");
  write("aidlc/spaces/default/memory/org.md", "# Org\nPrefer managed services.\n");
  write("docs/architecture.md", "# Architecture\nSingle Bun service.\n");
  write("next.json", JSON.stringify(presentGate));
  if (parallel !== undefined) write(".claude/d-acceleration.jsonc", JSON.stringify({ parallel: { enabled: parallel } }));
  for (const path of ["aidlc-common/stages/ideation/feasibility.md", "aidlc-common/stages/ideation/market-research.md", "agents/aidlc-architect-agent.md", "agents/aidlc-compliance-agent.md"]) { mkdirSync(dirname(join(framework, path)), { recursive: true }); cpSync(join(repo, "core", path), join(framework, path)); }
  const engine = join(framework, "tools"); mkdirSync(engine);
  // Fake official engine: logs every argv and prints the directive the test controls.
  writeFileSync(join(engine, "aidlc-orchestrate.ts"), `import { appendFileSync, readFileSync } from "node:fs";\nconst dir = process.argv[process.argv.indexOf("--project-dir") + 1];\nappendFileSync(dir + "/engine-calls.log", JSON.stringify(process.argv.slice(2)) + "\\n");\nprocess.stdout.write(readFileSync(dir + "/next.json", "utf8"));\n`);
  const approveGate = () => { write(`${INTENT}/aidlc-state.md`, stateAt("x")); write("next.json", JSON.stringify(runFeasibility)); };
  return { project, framework, engine, write, approveGate, options: { projectDir: project, frameworkDir: framework, engineDir: engine } };
}
const catalog = { judgment: "caller-judgment-request" };
const sleeper = (ms: number, calls: string[] = []): TaskRunner => async (prepared) => { calls.push(prepared.task.id); await Bun.sleep(ms); return { ok: true, output: `notes for ${prepared.task.id}`, requestedModel: prepared.requestedModel, runtimeReportedModel: null }; };
function treeHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (path: string) => { for (const name of readdirSync(path).sort()) { const child = join(path, name); if (statSync(child).isDirectory()) walk(child); else hash.update(`${relative(dir, child)}\0`).update(readFileSync(child)); } };
  walk(dir); return hash.digest("hex");
}
const overlaps = (a: Interval, b: Interval) => a.startedAt < b.endedAt && b.startedAt < a.endedAt;

describe("Merkle input binding", () => {
  test("root is order-independent, domain-separated, and changes with any leaf", () => {
    const leaves = [{ role: "input" as const, path: "a", sha256: "1" }, { role: "memory" as const, path: "b", sha256: "2" }, { role: "task" as const, path: "c", sha256: "3" }];
    expect(merkleRoot(leaves)).toBe(merkleRoot([...leaves].reverse()));
    expect(merkleRoot(leaves)).not.toBe(merkleRoot([{ ...leaves[0]!, sha256: "9" }, leaves[1]!, leaves[2]!]));
    expect(merkleRoot(leaves)).not.toBe(merkleRoot([{ ...leaves[0]!, role: "memory" }, leaves[1]!, leaves[2]!]));
    expect(() => merkleRoot([leaves[0]!, leaves[0]!])).toThrow("duplicate");
  });
  test("covers upstream inputs, target stage file, agent persona, and memory", () => {
    const f = fixture();
    const snapshot = readOfficialSnapshot(f.options);
    const base = prepareTask(tasks[0]!, snapshot, f.options, catalog);
    expect(base.leaves.map((leaf) => leaf.role).sort()).toEqual(["agent", "input", "input", "memory", "stage-file", "task"]);
    for (const mutate of [
      () => f.write(`${INTENT}/ideation/intent-capture/intent-statement.md`, "# Intent\nchanged\n"),
      () => writeFileSync(join(f.framework, "aidlc-common/stages/ideation/feasibility.md"), "---\nslug: feasibility\n---\nchanged\n"),
      () => f.write("aidlc/spaces/default/memory/team.md", "# Team\nnew practice\n"),
      () => writeFileSync(join(f.framework, "agents/aidlc-architect-agent.md"), "changed persona"),
    ]) {
      const before = prepareTask(tasks[0]!, snapshot, f.options, catalog).merkleRoot;
      mutate();
      expect(prepareTask(tasks[0]!, snapshot, f.options, catalog).merkleRoot).not.toBe(before);
    }
    expect(prepareTask({ ...tasks[0]!, objective: "different" }, snapshot, f.options, catalog).merkleRoot).not.toBe(prepareTask(tasks[0]!, snapshot, f.options, catalog).merkleRoot);
  });
});

describe("admission", () => {
  test("only independent tasks for a pending policy-eligible stage run while the gate is open", () => {
    const f = fixture();
    const snapshot = readOfficialSnapshot(f.options);
    expect(classifyTask(tasks[0]!, snapshot, f.options)).toEqual({ taskId: "integration-constraints", eligible: true });
    expect(classifyTask(tasks[2]!, snapshot, f.options)).toMatchObject({ eligible: false, reason: "dependent-on-gated-stage" });
    expect(classifyTask({ ...tasks[0]!, targetStage: "scope-definition" }, snapshot, f.options)).toMatchObject({ eligible: false, reason: "target-stage-not-speculation-eligible" });
    expect(classifyTask({ ...tasks[0]!, inputs: [`${INTENT}/aidlc-state.md`] }, snapshot, f.options)).toMatchObject({ eligible: false, reason: "input-not-in-settled-stage-record" });
    expect(classifyTask({ ...tasks[0]!, inputs: ["../outside.md"] }, snapshot, f.options)).toMatchObject({ eligible: false, reason: "input-unreadable" });
  });
  test("no open gate, a disagreeing state, or an unsettled other upstream means no speculation", async () => {
    const f = fixture();
    f.write("next.json", JSON.stringify(runFeasibility));
    const calls: string[] = [];
    expect(await runSpeculation({ tasks, modelCatalog: catalog }, { ...f.options, runTask: sleeper(1, calls) })).toMatchObject({ action: "no-speculation", reason: "no-open-human-gate" });
    f.write("next.json", JSON.stringify(presentGate)); f.write(`${INTENT}/aidlc-state.md`, stateAt("-"));
    expect(classifyTask(tasks[0]!, readOfficialSnapshot(f.options), f.options)).toMatchObject({ reason: "gate-state-disagrees-with-directive" });
    f.write(`${INTENT}/aidlc-state.md`, stateAt("?").replace("- [x] intent-capture", "- [-] intent-capture"));
    expect(classifyTask(tasks[0]!, readOfficialSnapshot(f.options), f.options)).toMatchObject({ reason: "upstream-not-settled", detail: "intent-capture" });
    expect(calls).toEqual([]);
  });
});

describe("speculate, revalidate, consume", () => {
  test("speculation is read-only toward official state and never bypasses the gate", async () => {
    const f = fixture();
    const intentBefore = treeHash(join(f.project, INTENT));
    const result = await runSpeculation({ tasks, modelCatalog: catalog }, { ...f.options, runTask: sleeper(5) });
    expect(result).toMatchObject({ action: "speculation-recorded", gateStage: "market-research", launched: ["integration-constraints", "regulatory-scan"] });
    expect(treeHash(join(f.project, INTENT))).toBe(intentBefore);
    expect(existsSync(join(f.project, INTENT, "ideation/feasibility"))).toBeFalse();
    const calls = readFileSync(join(f.project, "engine-calls.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line)[0]);
    expect(new Set(calls)).toEqual(new Set(["next"]));
    const dir = speculationDir(f.project, readOfficialSnapshot(f.options), "feasibility");
    expect(relative(f.project, dir)).toBe("aidlc/.aidlc-engine/d-speculation/default/i1/feasibility");
    const draft = JSON.parse(readFileSync(join(dir, "integration-constraints.draft.json"), "utf8"));
    expect(draft).toMatchObject({ kind: "d-speculative-draft", gateStageAtLaunch: "market-research", targetStage: "feasibility" });
    expect(draft.authority).toContain("not an artifact, approval, or decision");
  });
  test("drafts are consumable only after a fresh official run-stage and settled upstream", async () => {
    const f = fixture();
    await runSpeculation({ tasks, modelCatalog: catalog }, { ...f.options, runTask: sleeper(1) });
    expect(consumeSpeculativeDrafts({ tasks, targetStage: "feasibility", modelCatalog: catalog }, f.options)).toMatchObject({ action: "not-consumable", reason: "no-fresh-official-run-stage-for-target" });
    f.write("next.json", JSON.stringify(runFeasibility));
    expect(consumeSpeculativeDrafts({ tasks, targetStage: "feasibility", modelCatalog: catalog }, f.options)).toMatchObject({ action: "not-consumable", reason: "upstream-not-settled", unsettled: ["market-research"] });
    f.approveGate();
    const consumed = consumeSpeculativeDrafts({ tasks, targetStage: "feasibility", modelCatalog: catalog }, f.options);
    expect(consumed).toMatchObject({ action: "lead-integration-required", serialFallback: ["build-vs-buy-risk"], discarded: [], policy: { draftIsEvidenceInputOnly: true, officialStageWritesItsOwnArtifact: true, officialArtifactWritten: false } });
    expect(consumed.drafts.map((draft: any) => draft.taskId).sort()).toEqual(["integration-constraints", "regulatory-scan"]);
  });
  test("any input change invalidates and discards the draft; the task falls back to serial", async () => {
    const f = fixture();
    await runSpeculation({ tasks, modelCatalog: catalog }, { ...f.options, runTask: sleeper(1) });
    f.approveGate();
    f.write("aidlc/spaces/default/memory/org.md", "# Org\nPolicy changed during the gate.\n");
    const consumed = consumeSpeculativeDrafts({ tasks, targetStage: "feasibility", modelCatalog: catalog }, f.options);
    expect(consumed.drafts).toEqual([]);
    expect(consumed.discarded).toEqual([{ taskId: "integration-constraints", reason: "input-merkle-mismatch" }, { taskId: "regulatory-scan", reason: "input-merkle-mismatch" }]);
    expect(consumed.serialFallback).toEqual(["integration-constraints", "regulatory-scan", "build-vs-buy-risk"]);
    const dir = speculationDir(f.project, readOfficialSnapshot(f.options), "feasibility");
    expect(readdirSync(dir)).toEqual([]);
  });
  test("an input change while a worker runs is caught at pre-land revalidation", async () => {
    const f = fixture();
    const mutating: TaskRunner = async (prepared) => { if (prepared.task.id === "regulatory-scan") f.write(`${INTENT}/ideation/intent-capture/intent-statement.md`, "# Intent\nedited mid-run\n"); return { ok: true, output: "x", requestedModel: null, runtimeReportedModel: null }; };
    const result: any = await runSpeculation({ tasks, modelCatalog: catalog, maxParallel: 1 }, { ...f.options, runTask: mutating });
    expect(result.discarded.map((item: any) => item.reason)).toContain("input-merkle-mismatch-at-land");
    expect(result.completed.map((item: any) => item.taskId)).toEqual(["integration-constraints"]);
  });
  test("crash-safe resume reuses only durably recorded drafts and discards orphans", async () => {
    const f = fixture();
    const crashing: TaskRunner = async (prepared) => { if (prepared.task.id === "regulatory-scan") throw new Error("worker crashed"); return { ok: true, output: "ok", requestedModel: null, runtimeReportedModel: null }; };
    const first: any = await runSpeculation({ tasks, modelCatalog: catalog }, { ...f.options, runTask: crashing });
    expect(first.completed.map((item: any) => item.taskId)).toEqual(["integration-constraints"]);
    expect(first.failed).toEqual([{ taskId: "regulatory-scan", failure: "worker crashed" }]);
    const dir = speculationDir(f.project, readOfficialSnapshot(f.options), "feasibility");
    writeFileSync(join(dir, "regulatory-scan.draft.json"), "{\"partial\":true}"); // crash between draft rename and ledger write
    const calls: string[] = [];
    const second: any = await runSpeculation({ tasks, modelCatalog: catalog }, { ...f.options, runTask: sleeper(1, calls) });
    expect(calls).toEqual(["regulatory-scan"]);
    expect(second.reused).toEqual([{ taskId: "integration-constraints", merkleRoot: expect.any(String) }]);
    expect(second.discarded).toEqual([{ taskId: "regulatory-scan", reason: "orphan-draft-without-ledger" }]);
    writeFileSync(join(dir, "integration-constraints.draft.json"), "{\"tampered\":true}\n");
    const third: any = await runSpeculation({ tasks, modelCatalog: catalog }, { ...f.options, runTask: sleeper(1) });
    expect(third.discarded).toEqual([{ taskId: "integration-constraints", reason: "draft-hash-mismatch" }]);
  });
  test("the no-tool Claude launch exposes no file, shell, web, or MCP capability", () => {
    const f = fixture();
    const launch = speculativeClaudeLaunch(prepareTask(tasks[0]!, readOfficialSnapshot(f.options), f.options, catalog));
    const args = launch.args.join(" ");
    for (const required of ["--restricted", "--strict-mcp-config", "--no-session-persistence", "--permission-mode dontAsk", "--permission-prompts none", "--tools  --allowed-tools ", "Bash,Edit,Write,NotebookEdit,Agent,Task,WebFetch,WebSearch,Read,Grep,Glob", "--model caller-judgment-request", "--effort high"]) expect(args).toContain(required);
    expect(() => speculativeClaudeLaunch(prepareTask(tasks[0]!, readOfficialSnapshot(f.options), f.options, {}))).toThrow("judgment model request");
  });
});

describe("timing evidence", () => {
  const TASK_MS = 150;
  async function timeline(parallel: boolean) {
    const f = fixture(parallel);
    const calls: string[] = [];
    const gateOpenedAt = performance.now();
    const speculation: any = await runSpeculation({ tasks, modelCatalog: catalog }, { ...f.options, runTask: sleeper(TASK_MS, calls), now: () => performance.now() });
    await Bun.sleep(TASK_MS / 3); // the human is still deciding
    const gateApprovedAt = performance.now();
    f.approveGate();
    const consumed: any = consumeSpeculativeDrafts({ tasks, targetStage: "feasibility", modelCatalog: catalog }, f.options);
    const fallback: any = await runSerialFallback({ tasks, targetStage: "feasibility", modelCatalog: catalog, taskIds: consumed.serialFallback }, { ...f.options, runTask: sleeper(TASK_MS, calls), now: () => performance.now() });
    const intervals: Interval[] = [...speculation.intervals, ...fallback.intervals];
    return { parallel, speculationAction: speculation.action, gateOpenedAt, gateApprovedAt, intervals, consumedDrafts: consumed.drafts.map((d: any) => d.taskId), serialFallback: consumed.serialFallback, calls, maxConcurrency: maxConcurrency(intervals), duringGate: intervals.filter((i) => i.startedAt < gateApprovedAt).map((i) => i.taskId) };
  }
  function evidence(name: string, value: unknown) {
    const dir = process.env.D_SPECULATION_EVIDENCE_DIR;
    if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`); }
  }
  test("ON: independent tasks overlap each other and the open gate; the dependent task runs alone after approval", async () => {
    const run = await timeline(true);
    evidence("timing-parallel-on.json", run);
    const [a, b] = ["integration-constraints", "regulatory-scan"].map((id) => run.intervals.find((i) => i.taskId === id && i.mode === "speculative")!);
    const dependent = run.intervals.find((i) => i.taskId === "build-vs-buy-risk")!;
    expect(overlaps(a!, b!)).toBeTrue();
    expect(run.duringGate.sort()).toEqual(["integration-constraints", "regulatory-scan"]);
    expect(dependent.mode).toBe("serial-fallback");
    expect(dependent.startedAt).toBeGreaterThanOrEqual(run.gateApprovedAt);
    for (const other of [a!, b!]) expect(overlaps(dependent, other)).toBeFalse();
    expect(run.maxConcurrency).toBe(2);
    expect(run.consumedDrafts.sort()).toEqual(["integration-constraints", "regulatory-scan"]);
  });
  test("OFF: zero speculative work, nothing runs during the gate, and maximum concurrency is 1", async () => {
    const run = await timeline(false);
    evidence("timing-parallel-off.json", run);
    expect(run.speculationAction).toBe("speculation-disabled");
    expect(run.duringGate).toEqual([]);
    expect(run.intervals.every((i) => i.mode === "serial-fallback" && i.startedAt >= run.gateApprovedAt)).toBeTrue();
    expect(run.maxConcurrency).toBe(1);
    expect(run.serialFallback).toEqual(tasks.map((task) => task.id));
    expect(run.calls).toEqual(tasks.map((task) => task.id));
  });
  test("OFF performs no engine call and leaves no D-private state", async () => {
    const f = fixture(false);
    await runSpeculation({ tasks, modelCatalog: catalog }, { ...f.options, runTask: sleeper(1) });
    expect(existsSync(join(f.project, "engine-calls.log"))).toBeFalse();
    expect(existsSync(join(f.project, "aidlc/.aidlc-engine"))).toBeFalse();
  });
});
