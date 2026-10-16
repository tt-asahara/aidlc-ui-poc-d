import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
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

const ORCHESTRATE = join(AIDLC_SRC, "tools", "aidlc-orchestrate.ts");
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

afterEach(() => {
  while (projects.length > 0) cleanupTestProject(projects.pop());
});

describe("official next adapter integration", () => {
  test(
    "adapts the real engine-emitted functional-design wave without reshaping it first",
    () => {
      const project = createWaveProject();
      const env = { ...process.env };
      delete env.AWS_AIDLC_DEFAULT_SCOPE;
      env.AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD = "1";

      const result = runOrchestrateNext(ORCHESTRATE, project, [], { env });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.directive).not.toBeNull();
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
    },
    NATIVE_FIXTURE_SETUP_TIMEOUT_MS,
  );
});
