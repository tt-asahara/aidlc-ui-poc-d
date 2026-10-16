import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adaptOfficialNext } from "../official-next-adapter.ts";

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
