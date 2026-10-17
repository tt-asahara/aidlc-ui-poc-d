import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { AIDLC_SRC, cleanupTestProject, createTestProject, runOrchestrateNext, seedAidlcMemory, seedBoltDag, seededStateFile } from "../../../tests/harness/fixtures.ts";
import { NATIVE_FIXTURE_SETUP_TIMEOUT_MS } from "../../../tests/harness/test-budget.ts";
import type { Input } from "../aidlc-acceleration-plan.ts";
import { createWorkerGate, enforceParallelOff, isSwarmHandOff } from "../parallel-guard.ts";
import { runReadOnlyFanout } from "../read-only-fanout.ts";
import { execute } from "../scheduler.ts";

// parallel.enabled=false must hold the D worker count at one everywhere D
// dispatches, and must keep an existing stage-major/swarm Intent from handing
// work to the official parallel swarm. Every overlap assertion is computed
// from the wall-clock start/end of real child processes.
const repo = join(import.meta.dir, "..", "..", "..");
const D = join(import.meta.dir, "..");
const roots: string[] = []; const projects: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  while (projects.length) cleanupTestProject(projects.pop());
});

/** Child environment without the calling Claude session's markers. */
function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith("CLAUDE") && !key.startsWith("AIDLC_") && key !== "AWS_AIDLC_DEFAULT_SCOPE") env[key] = value;
  return { ...env, AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD: "1", ...extra };
}
function root(parallel?: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "d-parallel-off-")); roots.push(dir);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  if (parallel !== undefined) setParallel(dir, parallel);
  return dir;
}
function setParallel(dir: string, enabled: boolean): void { mkdirSync(join(dir, ".claude"), { recursive: true }); writeFileSync(join(dir, ".claude", "d-acceleration.jsonc"), JSON.stringify({ parallel: { enabled } })); }

/** Maximum number of intervals open at the same instant. */
function maxOverlap(intervals: Array<{ startedAt: number; endedAt: number }>): number {
  const points = intervals.flatMap((item) => [{ at: item.startedAt, delta: 1 }, { at: item.endedAt, delta: -1 }]).sort((a, b) => a.at - b.at || a.delta - b.delta);
  let open = 0, max = 0; for (const point of points) { open += point.delta; max = Math.max(max, open); } return max;
}

function designWave(units: string[], durationMs = 150): Input {
  const tasks = units.map((unit) => ({ id: `functional-design:${unit}`, stage: "functional-design", unit, dependsOn: [], estimatedMs: durationMs, taskType: "design" as const, difficulty: "medium" as const, risk: "medium" as const, execution: "official-wave" as const, writeSet: [`out/${unit}.md`] }));
  return { tasks, directives: [{ kind: "wave", stage: "functional-design", entries: tasks.map((task) => task.id) }], modelCatalog: { balanced: "fixture-balanced", judgment: "fixture-judgment" } };
}

describe("parallel.enabled=false: D worker gate", () => {
  test("the counting gate never admits a second worker while the limit is one", async () => {
    const gate = createWorkerGate(() => 1); let open = 0, max = 0;
    await Promise.all(Array.from({ length: 6 }, async () => { await gate.acquire(); open += 1; max = Math.max(max, open); await Bun.sleep(5); open -= 1; gate.release(); }));
    expect(max).toBe(1); expect(gate.maxActive).toBe(1);
  });

  test("an already-issued design wave runs one worker at a time (control: ON overlaps)", async () => {
    const on = await execute(designWave(["a", "b", "c"]), { projectDir: root(true) });
    expect(on.status).toBe("completed"); expect(maxOverlap(on.records)).toBeGreaterThan(1);
    const off = await execute(designWave(["a", "b", "c"]), { projectDir: root(false) });
    expect(off.status).toBe("completed"); expect(off.records).toHaveLength(3);
    expect(off.parallel).toEqual({ enabledAtStart: false, maxConcurrentWorkers: 1 });
    expect(maxOverlap(off.records)).toBe(1);
  });

  test("retries and tier escalations stay serialized", async () => {
    const result = await execute(designWave(["a", "b", "c"], 80), { projectDir: root(false), failOnce: ["functional-design:a", "functional-design:b", "functional-design:c"] });
    expect(result.status).toBe("completed"); expect(result.records).toHaveLength(6);
    expect(result.records.filter((record) => record.retryOrdinal === 1)).toHaveLength(3);
    expect(result.parallel.maxConcurrentWorkers).toBe(1); expect(maxOverlap(result.records)).toBe(1);
  });

  test("OFF written during a wave serializes every later launch of that wave", async () => {
    const dir = root(true);
    const switched = Bun.sleep(100).then(() => { setParallel(dir, false); return Date.now(); });
    const result = await execute(designWave(["a", "b", "c"], 300), { projectDir: dir, failOnce: ["functional-design:a", "functional-design:b", "functional-design:c"] });
    const at = await switched;
    expect(result.status).toBe("completed");
    const first = result.records.filter((record) => record.retryOrdinal === 0), later = result.records.filter((record) => record.startedAt >= at);
    expect(maxOverlap(first)).toBe(3);
    expect(later).toHaveLength(3); expect(maxOverlap(later)).toBe(1);
  });

  test("ON never widens a run that began under OFF", async () => {
    const result = await execute(designWave(["a", "b", "c"], 80), { projectDir: root(true), parallelEnabled: false });
    expect(result.parallel).toEqual({ enabledAtStart: false, maxConcurrentWorkers: 1 }); expect(maxOverlap(result.records)).toBe(1);
  });

  test("an unreadable configuration fails toward one worker", async () => {
    const dir = root(); writeFileSync(join(dir, ".claude", "d-acceleration.jsonc"), "{ parallel: ");
    const result = await execute(designWave(["a", "b"], 80), { projectDir: dir });
    expect(result.parallel.maxConcurrentWorkers).toBe(1); expect(maxOverlap(result.records)).toBe(1);
  });
});

function stubEngine(dir: string, directives: unknown[], state: { execution: string; setExit: number }): string {
  const engine = join(dir, "engine"); mkdirSync(engine, { recursive: true });
  writeFileSync(join(engine, "directives.json"), JSON.stringify(directives));
  // Returns directives in order and repeats the last one; counts calls.
  writeFileSync(join(engine, "aidlc-orchestrate.ts"), `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const dir = ${JSON.stringify(engine)}; const all = JSON.parse(readFileSync(dir + "/directives.json", "utf8"));
const counter = dir + "/count"; const n = existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0; writeFileSync(counter, String(n + 1));
process.stdout.write(JSON.stringify(all[Math.min(n, all.length - 1)]) + "\\n");\n`);
  writeFileSync(join(engine, "execution"), state.execution);
  writeFileSync(join(engine, "aidlc-state.ts"), `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const dir = ${JSON.stringify(engine)}; const args = process.argv.slice(2); appendFileSync(dir + "/state-calls", args.slice(0, args.indexOf("--project-dir")).join(" ") + "\\n");
if (args[0] === "get") { process.stdout.write(readFileSync(dir + "/execution", "utf8") + "\\n"); process.exit(0); }
if (args[0] === "set-construction-execution") { if (${state.setExit} !== 0) { process.stderr.write(JSON.stringify({ error: "An unattended run does not change Construction Execution" })); process.exit(${state.setExit}); } writeFileSync(dir + "/execution", args[1]); process.stdout.write("{}\\n"); process.exit(0); }
process.exit(0);\n`);
  return engine;
}
function wave(units: string[]) {
  return { kind: "run-stage", stage: "functional-design", gate: false, rules_in_context: [], construction_policy: { iteration: "stage-major", execution: "swarm" }, wave: { batch_index: 0, entries: units.map((unit) => ({ unit, unit_kind: "service", build_required: true, produces: [`out/${unit}.md`], required_produces: [`out/${unit}.md`], consumes: ["ui-poc-refined-contract"], consumes_absent: [] })) } };
}
function conduct(dir: string, engine: string, env: Record<string, string> = {}) {
  const run = spawnSync(process.execPath, [join(D, "conductor.ts"), "--project-dir", dir, "--engine-dir", engine, "--worker", "fake", "--disposable-test-mode"], { cwd: dir, env: cleanEnv(env), encoding: "utf8", timeout: NATIVE_FIXTURE_SETUP_TIMEOUT_MS });
  return { status: run.status, result: JSON.parse(run.stdout), stderr: run.stderr };
}
const swarmDirective = { kind: "invoke-swarm", stage: "code-generation", units: ["alpha", "beta"], batch: 0 };

describe("parallel.enabled=false: conductor, restarts, and the official swarm hand-off", () => {
  test("an existing stage-major/swarm Intent: the official setter moves it to serial and the issued wave runs one worker at a time", () => {
    const dir = root(false); const engine = stubEngine(dir, [wave(["a", "b", "c"]), { kind: "run-stage", stage: "functional-design", gate: true }], { execution: "swarm", setExit: 0 });
    const { status, result } = conduct(dir, engine);
    expect(status).toBe(0); expect(result.status).toBe("official-host-action-required");
    expect(readFileSync(join(engine, "state-calls"), "utf8")).toContain("set-construction-execution serial\n");
    expect(readFileSync(join(engine, "execution"), "utf8")).toBe("serial");
    expect(result.parallelGuards[0]).toMatchObject({ action: "continue", construction: { executionBefore: "swarm", serialization: "set-serial" } });
    const run = result.workerRuns[0].result; expect(run.records).toHaveLength(3);
    expect(run.parallel.maxConcurrentWorkers).toBe(1); expect(maxOverlap(run.records)).toBe(1);
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

  test("a restart re-reads OFF and the re-issued wave is serialized again", () => {
    const dir = root(false); const engine = stubEngine(dir, [wave(["a", "b", "c"])], { execution: "serial", setExit: 0 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { status, result } = conduct(dir, engine);
      expect(status).toBe(2); expect(result.reason).toBe("no-progress-repeated-official-build-wave");
      const run = result.workerRuns[0].result; expect(run.records).toHaveLength(3);
      expect(run.parallel.maxConcurrentWorkers).toBe(1); expect(maxOverlap(run.records)).toBe(1);
    }
    expect(readFileSync(join(engine, "state-calls"), "utf8")).not.toContain("set-construction-execution");
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

  test("an official swarm hand-off is refused when the official setter refuses serial", () => {
    const dir = root(false); const engine = stubEngine(dir, [swarmDirective], { execution: "swarm", setExit: 1 });
    const { status, result } = conduct(dir, engine, { AIDLC_USE_SWARM: "1" });
    expect(status).toBe(2);
    expect(result).toMatchObject({ status: "parallel-off-action-required", reason: "parallel-off-swarm-not-serialized", workerRuns: [] });
    expect(result.recovery).toContain("set-construction-execution serial");
    expect(readFileSync(join(engine, "execution"), "utf8")).toBe("swarm");
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

  test("an official swarm hand-off becomes a fresh serial directive once the setter accepts", () => {
    const dir = root(false); const engine = stubEngine(dir, [swarmDirective, wave(["a", "b"]), { kind: "run-stage", stage: "functional-design", gate: true }], { execution: "swarm", setExit: 0 });
    const { status, result } = conduct(dir, engine);
    expect(status).toBe(0); expect(result.parallelGuards[0]).toMatchObject({ action: "refresh", swarmHandOff: true });
    expect(result.workerRuns[0].result.parallel.maxConcurrentWorkers).toBe(1);
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

  test("ON leaves the swarm hand-off and existing Intent untouched", () => {
    const dir = root(true); const engine = stubEngine(dir, [swarmDirective], { execution: "swarm", setExit: 0 });
    expect(enforceParallelOff({ projectDir: dir, engineDir: engine, directive: swarmDirective })).toMatchObject({ action: "continue", reason: "parallel-enabled" });
    expect(existsSync(join(engine, "state-calls"))).toBeFalse();
    expect(isSwarmHandOff({ directive: swarmDirective })).toBeTrue(); expect(isSwarmHandOff(wave(["a"]))).toBeFalse();
  });
});

describe("parallel.enabled=false: host checkpoints and generic auto", () => {
  const hostCli = join(D, "host-session-cli.ts");
  const host = (dir: string, args: string[], env: Record<string, string> = {}) => {
    const run = spawnSync(process.execPath, [hostCli, ...args, "--project-dir", dir, "--session-file", ".aidlc-engine/session.json"], { cwd: dir, env: cleanEnv(env), encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0); return JSON.parse(run.stdout);
  };
  test("an auto checkpoint never hands off an official swarm, whatever AIDLC_USE_SWARM or flags.swarm say", () => {
    const dir = root(false); mkdirSync(join(dir, ".aidlc-engine"));
    writeFileSync(join(dir, "aidlc.settings.json"), JSON.stringify({ flags: { swarm: true } }));
    stubEngine(dir, [], { execution: "swarm", setExit: 1 }); mkdirSync(join(dir, ".claude", "tools"), { recursive: true });
    writeFileSync(join(dir, ".claude", "tools", "aidlc-state.ts"), readFileSync(join(dir, "engine", "aidlc-state.ts")));
    expect(host(dir, ["init", "--active-stages", "functional-design,code-generation", "--deadline-ms", "60000", "--max-steps", "8"]).action).toBe("continue");
    writeFileSync(join(dir, "d.json"), JSON.stringify(swarmDirective));
    const stopped = host(dir, ["checkpoint", "--directive-file", "d.json"], { AIDLC_USE_SWARM: "1", AIDLC_UNATTENDED: "1" });
    expect(stopped).toMatchObject({ action: "stop", reason: "parallel-off-swarm-not-serialized", state: { terminalReason: "parallel-off-swarm-not-serialized", steps: 0 } });
    expect(stopped.recovery).toContain("parallel.enabled");
  });
  test("an auto checkpoint refreshes after the official setter serializes, without consuming a step", () => {
    const dir = root(false); mkdirSync(join(dir, ".aidlc-engine")); mkdirSync(join(dir, ".claude", "tools"), { recursive: true });
    const engine = stubEngine(dir, [], { execution: "swarm", setExit: 0 });
    writeFileSync(join(dir, ".claude", "tools", "aidlc-state.ts"), readFileSync(join(engine, "aidlc-state.ts")));
    host(dir, ["init", "--active-stages", "functional-design,code-generation", "--deadline-ms", "60000", "--max-steps", "8"]);
    writeFileSync(join(dir, "d.json"), JSON.stringify(swarmDirective));
    expect(host(dir, ["checkpoint", "--directive-file", "d.json"])).toMatchObject({ action: "refresh", reason: "construction-execution-set-serial", state: { steps: 0 } });
    writeFileSync(join(dir, "d.json"), JSON.stringify(wave(["a"])));
    expect(host(dir, ["checkpoint", "--directive-file", "d.json"])).toMatchObject({ action: "continue", parallelGuard: { construction: { serialization: "already-serial" } }, state: { steps: 1 } });
  });
  test("generic-auto bootstrap under OFF applies no swarm default to a new Intent and journals the snapshot", () => {
    const dir = root(); mkdirSync(join(dir, ".aidlc-engine")); mkdirSync(join(dir, ".claude", "tools"), { recursive: true });
    writeFileSync(join(dir, ".claude", "d-acceleration.jsonc"), JSON.stringify({ parallel: { enabled: false }, auto: { enabled: true, sessionOnly: false, through: "inception", maxSteps: 4, deadlineMs: 60000 }, constructionDefaults: { iteration: "stage-major", execution: "swarm" } }));
    writeFileSync(join(dir, ".claude", "tools", "aidlc.ts"), `import { mkdirSync, writeFileSync } from "node:fs"; import { join } from "node:path";
const args = process.argv.slice(2), root = args[args.indexOf("--project-dir") + 1], intents = join(root, "aidlc", "spaces", "default", "intents");
mkdirSync(join(intents, "i1"), { recursive: true }); writeFileSync(join(intents, "active-intent"), "i1\\n");
writeFileSync(join(intents, "i1", "aidlc-state.md"), "- [ ] intent-capture — EXECUTE\\n- [ ] units-generation — EXECUTE\\n- [ ] code-generation — EXECUTE\\n");
mkdirSync(join(intents, "i1", "audit"), { recursive: true }); writeFileSync(join(intents, "i1", "audit", "host-clone.md"), "## Workflow Started\\n**Timestamp**: " + new Date().toISOString() + "\\n**Event**: WORKFLOW_STARTED\\n");\n`);
    writeFileSync(join(dir, ".claude", "tools", "aidlc-orchestrate.ts"), `process.stdout.write(JSON.stringify({ kind: "run-stage", stage: "intent-capture", receipt: "first" }));\n`);
    writeFileSync(join(dir, ".claude", "tools", "aidlc-state.ts"), `import { appendFileSync } from "node:fs"; const args = process.argv.slice(2); appendFileSync(args[args.indexOf("--project-dir") + 1] + "/policy-calls", args.join(" ") + "\\n"); process.stdout.write("serial\\n");\n`);
    writeFileSync(join(dir, "request.txt"), "Build a feature");
    const started = spawnSync(process.execPath, [join(D, "generic-auto-cli.ts"), "start", "--description-file", "request.txt", "--project-dir", dir], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
    expect(started.status, started.stderr).toBe(0);
    // The host runs the official print's intent-create itself (simulated by the fake dispatcher).
    const created = spawnSync(process.execPath, [join(dir, ".claude", "tools", "aidlc.ts"), "engine", "intent", "create", "--scope", "feature", "--request", "abcd1234", "--project-dir", dir], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
    expect(created.status, created.stderr).toBe(0);
    const run = spawnSync(process.execPath, [join(D, "generic-auto-cli.ts"), "bootstrap", "--project-dir", dir], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ action: "continue", initialized: true });
    const calls = existsSync(join(dir, "policy-calls")) ? readFileSync(join(dir, "policy-calls"), "utf8") : "";
    expect(calls).not.toContain("set-construction-iteration"); expect(calls).not.toMatch(/set-construction-execution swarm/);
    expect(JSON.parse(readFileSync(join(dir, ".aidlc-engine", "d-auto-bootstrap.json"), "utf8"))).toMatchObject({ parallel: { enabled: false }, constructionPolicy: { iteration: "official", execution: "official" } });
  });
});

describe("parallel.enabled=false: read-only fanout", () => {
  const help = "--print --output-format --no-session-persistence --restricted --strict-mcp-config --mcp-config --disable-slash-commands --permission-mode --permission-prompts --tools --allowed-tools --disallowed-tools --agents --agent --model --effort";
  const directive = { kind: "run-stage", stage: "market-research", phase: "ideation", mode: "inline", gate: false, lead_agent: "aidlc-product-agent", support_agents: [], inline_context_paths: [], memory_path: "aidlc/spaces/default/intents/example/ideation/market-research/memory.md", consumes: [], produces: ["aidlc/spaces/default/intents/example/ideation/market-research/research.md"], rules_in_context: [], sensors_applicable: [], ceremony: { sensors: "on", learnings: "on", summary_confirmation: "on", plan_approval: "on", collaborators: "off" }, stage_file: "core/aidlc-common/stages/ideation/market-research.md" };
  function fanoutFixture(enabled: boolean, flipOff = false) {
    const dir = root(enabled); writeFileSync(join(dir, "README.md"), "fixture\n");
    const engine = join(dir, "engine"); mkdirSync(engine);
    writeFileSync(join(engine, "aidlc-orchestrate.ts"), `process.stdout.write(${JSON.stringify(`${JSON.stringify(directive)}\n`)});\n`);
    const log = join(dir, "workers.log"); const claude = join(dir, "fake-claude");
    writeFileSync(claude, `#!${process.execPath}
import { appendFileSync, writeFileSync } from "node:fs";
if (process.argv[2] === "--help") { process.stdout.write(${JSON.stringify(help)}); process.exit(0); }
const startedAt = Date.now(); ${flipOff ? `writeFileSync(${JSON.stringify(join(dir, ".claude", "d-acceleration.jsonc"))}, JSON.stringify({ parallel: { enabled: false } }));` : ""}
await Bun.sleep(150); appendFileSync(${JSON.stringify(log)}, JSON.stringify({ startedAt, endedAt: Date.now() }) + "\\n"); process.stdout.write(JSON.stringify({ result: "findings" }));\n`);
    chmodSync(claude, 0o755);
    return { dir, engine, claude, log };
  }
  const tasks = ["a", "b", "c", "d"].map((id) => ({ id, agent: "aidlc-architect-agent", objective: `Read-only check ${id}`, evidencePaths: ["README.md"] }));
  const intervals = (log: string) => readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));

  test("OFF runs every read-only worker alone (control: ON overlaps)", async () => {
    for (const enabled of [true, false]) {
      const fixture = fanoutFixture(enabled);
      const result: any = await runReadOnlyFanout({ directive, tasks, modelCatalog: { balanced: "m", judgment: "m", fast: "m" }, maxParallel: 4 }, { projectDir: fixture.dir, frameworkDir: join(repo, "core"), engineDir: fixture.engine, claudeExecutable: fixture.claude });
      expect(result.action).toBe("lead-integration-required"); expect(result.results).toHaveLength(4);
      const overlap = maxOverlap(intervals(fixture.log));
      if (enabled) expect(overlap).toBeGreaterThan(1); else { expect(overlap).toBe(1); expect(result.parallel).toEqual({ plannedMaxParallel: 1, maxConcurrentWorkers: 1 }); }
    }
  });
  test("OFF written during a fanout serializes every later batch", async () => {
    const fixture = fanoutFixture(true, true);
    const result: any = await runReadOnlyFanout({ directive, tasks, modelCatalog: { balanced: "m", judgment: "m", fast: "m" }, maxParallel: 2 }, { projectDir: fixture.dir, frameworkDir: join(repo, "core"), engineDir: fixture.engine, claudeExecutable: fixture.claude });
    expect(result.results).toHaveLength(4);
    const all = intervals(fixture.log).sort((a, b) => a.startedAt - b.startedAt);
    expect(maxOverlap(all.slice(2))).toBe(1); expect(result.parallel.maxConcurrentWorkers).toBe(2);
  });
});

// The real official engine and state setter, on an Intent that already began
// with official stage-major/swarm Construction.
function swarmIntent(lifecycle: "CONSTRUCTION" | "INCEPTION"): string {
  const project = createTestProject(); projects.push(project); seedAidlcMemory(project);
  const construction = lifecycle === "CONSTRUCTION";
  const state = `# AI-DLC State Tracking

## Project Information
- **Project**: D parallel off
- **Project Type**: Greenfield
- **Scope**: feature
- **State Version**: 8
- **Skeleton Stance**: off

## Runtime State
- **Construction Checkpoints**: enabled
- **Construction Iteration**: stage-major
- **Construction Execution**: swarm
- **Construction Autonomy Mode**: gated
- **Unit Ownership**: solo
- **Review Override**: none
- **Change Control**: strict

## Scope Configuration
- **Stages to Execute**: all
- **Stages to Skip**: none
- **Test Strategy**: Standard

## Stage Progress
### INCEPTION PHASE
- [x] domain-design — EXECUTE
- [${construction ? "x" : "-"}] units-generation — EXECUTE

### CONSTRUCTION PHASE
- [${construction ? "-" : " "}] functional-design — EXECUTE
- [ ] nfr-requirements — EXECUTE
- [ ] nfr-design — EXECUTE
- [ ] infrastructure-design — EXECUTE
- [ ] code-generation — EXECUTE
- [ ] build-and-test — EXECUTE

## Current Status
- **Lifecycle Phase**: ${lifecycle}
- **Current Stage**: ${construction ? "functional-design" : "units-generation"}
- **Status**: Running
`;
  const stateFile = seededStateFile(project); mkdirSync(dirname(stateFile), { recursive: true }); writeFileSync(stateFile, state);
  writeFileSync(join(dirname(dirname(stateFile)), "active-intent"), `${basename(dirname(stateFile))}\n`);
  seedBoltDag(project, [{ name: "alpha", kind: "service" }, { name: "beta", kind: "service" }], [["alpha", "beta"]]);
  setParallel(project, false);
  return project;
}
const ENGINE = join(AIDLC_SRC, "tools");
const execution = (project: string) => readFileSync(seededStateFile(project), "utf8").match(/\*\*Construction Execution\*\*: (\w+)/)?.[1];
const officialNext = (project: string) => { const result = runOrchestrateNext(join(ENGINE, "aidlc-orchestrate.ts"), project, [], { env: cleanEnv() }); expect(result.status, result.stderr).toBe(0); return result.directive as any; };

describe("parallel.enabled=false: existing official stage-major/swarm Intent", () => {
  test("before Construction an unattended run serializes it through the official setter", () => {
    const project = swarmIntent("INCEPTION");
    const guard = enforceParallelOff({ projectDir: project, engineDir: ENGINE, env: cleanEnv({ AIDLC_UNATTENDED: "1" }) });
    expect(guard).toMatchObject({ action: "continue", construction: { executionBefore: "swarm", serialization: "set-serial" } });
    expect(execution(project)).toBe("serial");
    const audit = spawnSync("grep", ["-rl", "CONSTRUCTION_POLICY_SET", join(dirname(seededStateFile(project)))], { encoding: "utf8" });
    expect(audit.stdout.trim()).not.toBe("");
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

  test("in Construction the official guard keeps the decision with the person; D reports it and refuses the swarm hand-off", () => {
    const project = swarmIntent("CONSTRUCTION");
    const issued = officialNext(project);
    expect(issued).toMatchObject({ kind: "run-stage", stage: "functional-design", construction_policy: { iteration: "stage-major", execution: "swarm" } });
    expect(issued.wave.entries.map((entry: any) => entry.unit)).toEqual(["alpha", "beta"]);
    const env = cleanEnv({ AIDLC_UNATTENDED: "1" });
    expect(enforceParallelOff({ projectDir: project, engineDir: ENGINE, directive: issued, env })).toMatchObject({ action: "continue", reason: "parallel-off-serial-official-swarm-pending", construction: { serialization: "refused" } });
    const handOff = enforceParallelOff({ projectDir: project, engineDir: ENGINE, directive: swarmDirective, env: cleanEnv({ AIDLC_UNATTENDED: "1", AIDLC_USE_SWARM: "1" }) });
    expect(handOff).toMatchObject({ action: "stop", reason: "parallel-off-swarm-not-serialized", construction: { serialization: "refused" } });
    expect(handOff.construction.detail).toContain("unattended run does not change Construction Execution");
    expect(execution(project)).toBe("swarm");
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

  test("in Construction, once the person asks, the official setter serializes and the engine stops offering swarm", () => {
    const project = swarmIntent("CONSTRUCTION");
    const env = cleanEnv({ AIDLC_PROJECT_DIR: project, CLAUDE_PROJECT_DIR: project });
    const turn = spawnSync(process.execPath, [join(ENGINE, "aidlc.ts"), "engine", "hook", "record-human-turn"], { cwd: project, env, encoding: "utf8", input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "parallel-off", prompt: "Build the Units one after another, no parallel swarm." }) });
    expect(turn.status, `${turn.stdout}${turn.stderr}`).toBe(0);
    const guard = enforceParallelOff({ projectDir: project, engineDir: ENGINE, directive: swarmDirective, env });
    expect(guard).toMatchObject({ action: "refresh", construction: { executionBefore: "swarm", serialization: "set-serial" } });
    expect(execution(project)).toBe("serial");
    const fresh = officialNext(project);
    expect(fresh.kind).not.toBe("invoke-swarm"); expect(fresh.construction_policy?.execution).toBe("serial");
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);
});

