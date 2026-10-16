import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AIDLC_SRC,
  cleanupTestProject,
  createTestProject,
  runOrchestrateNext,
  seedAidlcMemory,
  seedBoltDag,
  seededStateFile,
} from "../../../tests/harness/fixtures.ts";
import { NATIVE_FIXTURE_SETUP_TIMEOUT_MS } from "../../../tests/harness/test-budget.ts";
import { adaptOfficialNext } from "../official-next-adapter.ts";
import { execute } from "../scheduler.ts";

const ORCHESTRATE = join(AIDLC_SRC, "tools", "aidlc-orchestrate.ts");
const STATE = join(AIDLC_SRC, "tools", "aidlc-state.ts");
const CONDUCTOR = join(import.meta.dir, "..", "conductor.ts");
const SEPARATOR = "\u2014";
const projects: string[] = [];

function stageRow(marker: " " | "-" | "x", stage: string): string {
  return `- [${marker}] ${stage} ${SEPARATOR} EXECUTE`;
}

function functionalDesignState(): string {
  return `# AI-DLC State Tracking

## Project Information
- **Project**: D official next adapter integration
- **Project Type**: Greenfield
- **Scope**: feature
- **State Version**: 8
- **Skeleton Stance**: on
- **Construction Iteration**: stage-major
- **Review Override**: none

## Scope Configuration
- **Stages to Execute**: all
- **Stages to Skip**: none
- **Depth**: Standard
- **Test Strategy**: Standard
- **Change Control**: strict (from scope feature)

## Stage Progress

### INCEPTION PHASE
${stageRow("x", "domain-design")}
${stageRow("x", "units-generation")}

### CONSTRUCTION PHASE
${stageRow("-", "functional-design")}
${stageRow(" ", "nfr-requirements")}
${stageRow(" ", "nfr-design")}
${stageRow(" ", "infrastructure-design")}
${stageRow(" ", "code-generation")}
${stageRow(" ", "build-and-test")}

## Current Status
- **Lifecycle Phase**: CONSTRUCTION
- **Current Stage**: functional-design
- **Status**: Running
`;
}

function createWaveProject(): string {
  const project = createTestProject();
  projects.push(project);
  seedAidlcMemory(project);
  writeFileSync(seededStateFile(project), functionalDesignState());
  seedBoltDag(
    project,
    [
      { name: "alpha", kind: "service" },
      { name: "beta", kind: "service" },
    ],
    [["alpha", "beta"]],
  );
  return project;
}

function next(project: string) {
  const env = { ...process.env };
  delete env.AWS_AIDLC_DEFAULT_SCOPE;
  env.AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD = "1";
  const result = runOrchestrateNext(ORCHESTRATE, project, [], { env });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.directive).not.toBeNull();
  return result;
}

function completeWaveUnit(project: string, unit: string): void {
  const result = spawnSync(
    process.execPath,
    [
      STATE,
      "unit",
      "complete",
      "--wave",
      "--stage",
      "functional-design",
      "--unit",
      unit,
      "--project-dir",
      project,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD: "1",
      },
      timeout: NATIVE_FIXTURE_SETUP_TIMEOUT_MS,
    },
  );
  expect(
    result.status,
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  ).toBe(0);
}

afterEach(() => {
  while (projects.length > 0) cleanupTestProject(projects.pop());
});

describe("official next adapter integration", () => {
  test("product conductor stops after one non-progressing worker wave", () => {
    const project = createWaveProject(); const env = { ...process.env, AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD: "1" }; delete env.AWS_AIDLC_DEFAULT_SCOPE;
    const run = spawnSync(process.execPath, [CONDUCTOR, "--project-dir", project, "--engine-dir", join(AIDLC_SRC, "tools"), "--worker", "fake"], { cwd: project, env, encoding: "utf8", timeout: NATIVE_FIXTURE_SETUP_TIMEOUT_MS });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(2);
    const result = JSON.parse(run.stdout); expect(result.status).toBe("official-host-action-required"); expect(result.reason).toBe("c-ui-baseline-not-composed"); expect(result.history).toHaveLength(1);
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

  test("product conductor stops when an unchanged build wave is reissued despite existing outputs", () => {
    const project = createWaveProject(); const engine = join(project, "stub-engine"); mkdirSync(engine);
    const repeated = { kind: "run-stage", stage: "functional-design", gate: false, wave: { batch_index: 0, entries: [{ unit: "alpha", unit_kind: "service", build_required: true, produces: ["already.md"], required_produces: ["already.md"], consumes: ["ui-poc-refined-contract"], consumes_absent: [] }] } };
    writeFileSync(join(engine, "aidlc-orchestrate.ts"), `process.stdout.write(${JSON.stringify(`${JSON.stringify(repeated)}\n`)});\n`);
    writeFileSync(join(engine, "aidlc-state.ts"), "process.exit(99);\n");
    writeFileSync(join(project, "already.md"), "pre-existing fixture output\n");
    const env = { ...process.env, AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD: "1" }; delete env.AWS_AIDLC_DEFAULT_SCOPE;
    const run = spawnSync(process.execPath, [CONDUCTOR, "--project-dir", project, "--engine-dir", engine, "--worker", "fake"], { cwd: project, env, encoding: "utf8", timeout: NATIVE_FIXTURE_SETUP_TIMEOUT_MS });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(2);
    const result = JSON.parse(run.stdout);
    expect(result.reason).toBe("no-progress-repeated-official-build-wave");
    expect(result.history).toHaveLength(2);
    expect(result.workerRuns).toHaveLength(1);
    expect(result.workerRuns[0].result.records).toHaveLength(1);
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

  test("product conductor CLI settles a disposable wave through the official gate", () => {
    const project = createWaveProject();
    const env = { ...process.env, AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD: "1" };
    delete env.AWS_AIDLC_DEFAULT_SCOPE;
    const run = spawnSync(process.execPath, [CONDUCTOR, "--project-dir", project, "--engine-dir", join(AIDLC_SRC, "tools"), "--worker", "fake", "--disposable-test-mode"], { cwd: project, env, encoding: "utf8", timeout: NATIVE_FIXTURE_SETUP_TIMEOUT_MS });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(2);
    const result = JSON.parse(run.stdout);
    expect(result.status).toBe("official-host-action-required");
    expect(result.reason).toBe("c-ui-baseline-not-composed");
    expect(result.workerRuns).toHaveLength(0);
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

  test(
    "refuses a real official wave when the C plugin was not composed",
    () => {
      const project = createWaveProject();
      const result = next(project);
      expect(result.directive).toMatchObject({
        kind: "run-stage",
        stage: "functional-design",
        wave: {
          batch_index: 0,
          entries: [
            { unit: "alpha", build_required: true },
            { unit: "beta", build_required: true },
          ],
        },
      });

      // Pass the parsed JSON returned by the real `aidlc-orchestrate next`
      // directly to the product adapter. No hand-authored directive surrogate
      // participates in this assertion.
      expect(() => adaptOfficialNext({ directive: result.directive })).toThrow("missing composed Arm C UI consumes");
    },
    NATIVE_FIXTURE_SETUP_TIMEOUT_MS,
  );
});
