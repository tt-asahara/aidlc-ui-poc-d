import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adaptOfficialNext } from "../official-next-adapter.ts";
import { buildClaudeBuilderPrompt } from "../scheduler.ts";

const ROOT = join(import.meta.dir, "..", "..");

function functionalDirective(consumes: string[]) {
  return {
    kind: "run-stage",
    stage: "functional-design",
    gate: false,
    wave: {
      batch_index: 0,
      entries: [{ unit: "web", build_required: true, produces: ["functional-spec.md"], required_produces: ["functional-spec.md"], consumes, consumes_absent: [] }],
    },
  };
}

describe("D retains the composed Arm C UI baseline", () => {
  test("integration metadata pins C and keeps acceleration opt-in", () => {
    const metadata = JSON.parse(readFileSync(join(ROOT, "d-integration.json"), "utf8"));
    expect(metadata.arm).toBe("D");
    expect(metadata.uiBaseline).toMatchObject({ arm: "C", commit: "c738518615c91bb5968f2fea4e1c670f4eefdac8", requiredWhenAccelerationDisabled: true });
    expect(metadata.acceleration).toMatchObject({ optIn: true, officialHostSingleWriter: true, missingComposedUiBehavior: "fail-closed-to-official-host" });
  });

  test("functional-design acceleration retains the C refined HTML contract input", () => {
    const resolvedContract = "aidlc/spaces/default/intents/example/inception/refined-mockups/ui-poc-refined-contract.md";
    const adapted = adaptOfficialNext(functionalDirective([resolvedContract]));
    expect(adapted.tasks[0]?.inputSet).toContain(resolvedContract);
    expect(adapted.sourceDirective).toEqual(functionalDirective([resolvedContract]));
  });

  test("builder prompt carries the complete official wave brief and composed stage text", () => {
    const repo = join(ROOT, "..");
    const directive = functionalDirective(["evidence/ui-poc-refined-contract.md"]) as any;
    directive.ceremony = { summary_confirmation: "on" };
    directive.protocol_modules = ["construction", "reviewer"];
    directive.stage_file = "poc/ui-poc/contributions/construction/functional-design.md";
    directive.inline_context_paths = ["poc/ui-poc/docs/contract.md"];
    directive.context_warnings = ["fixture-warning"];
    directive.steering = { instruction: "preserve-C-context" };
    directive.wave.entries[0].unit_memory_path = "poc/ui-poc/docs/c-stage-skill-matrix.md";
    const input = adaptOfficialNext(directive); const task = input.tasks[0]!;
    const prompt = JSON.parse(buildClaudeBuilderPrompt(input, task, repo));
    expect(prompt.officialBuilderBrief.ceremony).toEqual(directive.ceremony);
    expect(prompt.officialBuilderBrief.protocol_modules).toEqual(directive.protocol_modules);
    expect(prompt.officialBuilderBrief.stage_file.text).toContain("Refined UI evidence as functional design input");
    expect(prompt.officialBuilderBrief.inline_context[0].text).toContain("UI evidence contract");
    expect(prompt.officialBuilderBrief.context_warnings).toEqual(["fixture-warning"]);
    expect(prompt.officialBuilderBrief.steering).toEqual(directive.steering);
    expect(prompt.officialBuilderBrief.unit_memory.text).toContain("Arm C stage-to-skill contract");
    expect(prompt.officialBuilderBrief.entry.unit_memory_path).toBe(directive.wave.entries[0].unit_memory_path);
  });

  test("missing C compose evidence fails closed before worker dispatch", () => {
    expect(() => adaptOfficialNext(functionalDirective([]))).toThrow("missing composed Arm C UI consumes");
  });

  test("C blocking sensor and HTML contract remain present", () => {
    const sensor = readFileSync(join(ROOT, "ui-poc", "sensors", "aidlc-ui-poc-evidence.md"), "utf8");
    const contract = readFileSync(join(ROOT, "ui-poc", "docs", "contract.md"), "utf8");
    expect(sensor).toContain("default_severity: blocking");
    expect(sensor).toContain("declared stage deliverables trigger contract checks");
    expect(contract).toContain("rough-mockups: ui-poc-rough-contract.md");
    expect(contract).toContain("refined-mockups: ui-poc-refined-contract.md");
  });
});
