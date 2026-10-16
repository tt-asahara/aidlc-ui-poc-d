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
    const result = JSON.parse(run.stdout); expect(result.status).toBe("worker-action-required"); expect(result.reason).toBe("no-progress-missing-required-outputs"); expect(result.history).toHaveLength(1);
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

  test("product conductor stops when an unchanged build wave is reissued despite existing outputs", () => {
    const project = createWaveProject(); const engine = join(project, "stub-engine"); mkdirSync(engine);
    const repeated = { kind: "run-stage", stage: "functional-design", gate: false, wave: { batch_index: 0, entries: [{ unit: "alpha", unit_kind: "service", build_required: true, produces: ["already.md"], required_produces: ["already.md"], consumes: [], consumes_absent: [] }] } };
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
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const result = JSON.parse(run.stdout);
    expect(result.status).toBe("official-host-action-required");
    expect(result.directive).toMatchObject({ kind: "run-stage", stage: "functional-design", gate: true });
    expect(result.directive.wave).toBeUndefined();
    expect(result.workerRuns).toHaveLength(1);
    expect(result.workerRuns[0].result.records.map((record: { task: string }) => record.task).sort()).toEqual(["functional-design:alpha", "functional-design:beta"]);
  }, NATIVE_FIXTURE_SETUP_TIMEOUT_MS);

  test(
    "runs a real emitted wave, records official completion, and resumes only unfinished units",
    async () => {
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
      const adapted = adaptOfficialNext({ directive: result.directive });
      expect(adapted.tasks.map((task) => task.id)).toEqual([
        "functional-design:alpha",
        "functional-design:beta",
      ]);
      expect(adapted.directives).toEqual([
        {
          kind: "wave",
          stage: "functional-design",
          entries: [
            "functional-design:alpha",
            "functional-design:beta",
          ],
        },
      ]);
      // The adapter must retain every parent field (agents, mode, gate,
      // ceremony, protocol modules, memory and reviewer settings), not merely
      // the wave projection it schedules.
      expect(adapted.sourceDirective).toEqual(result.directive);
      expect(adapted.sourceDirective).not.toBe(result.directive);

      const scheduled = await execute(adapted, {
        workerKind: "fake",
        projectDir: project,
        disposableTestMode: true,
      });
      expect(scheduled.status, JSON.stringify(scheduled, null, 2)).toBe(
        "completed",
      );
      expect(scheduled.records.map((record) => record.task).sort()).toEqual([
        "functional-design:alpha",
        "functional-design:beta",
      ]);
      const originalEntries = (
        result.directive as {
          wave: {
            entries: Array<{
              unit: string;
              required_produces: string[];
            }>;
          };
        }
      ).wave.entries;
      for (const entry of originalEntries) {
        for (const relativePath of entry.required_produces) {
          expect(existsSync(join(project, relativePath))).toBeTrue();
        }
      }

      // State mutation remains single-writer and uses the official command.
      // Completing only alpha must not erase or replay its unfinished sibling.
      completeWaveUnit(project, "alpha");
      const resumed = next(project);
      expect(resumed.directive).toMatchObject({
        kind: "run-stage",
        stage: "functional-design",
        gate: false,
        wave: {
          batch_index: 0,
          entries: [
            {
              unit: "beta",
              build_required: false,
              completion_required: true,
              review_state: "not-required",
            },
          ],
        },
      });
      expect(
        (resumed.directive as { wave: { entries: Array<{ unit: string }> } })
          .wave.entries.map((entry) => entry.unit),
      ).toEqual(["beta"]);

      completeWaveUnit(project, "beta");
      const settled = next(project);
      expect(settled.directive).toMatchObject({
        kind: "run-stage",
        stage: "functional-design",
        gate: true,
      });
      expect(
        (settled.directive as { wave?: unknown }).wave,
      ).toBeUndefined();
    },
    NATIVE_FIXTURE_SETUP_TIMEOUT_MS,
  );
});
