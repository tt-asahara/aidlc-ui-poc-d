import { describe, expect, test } from "bun:test";
import fixture from "../fixtures/requirement-ui-cross-validation.json";
import { runRequirementUiCrossValidation, validateRequirementUiCrossReferences } from "../requirement-ui-cross-validation.ts";

describe("feature 21 requirement/UI cross-validation", () => {
  test("accepts existing official AC IDs without renumbering them", () => {
    const result = validateRequirementUiCrossReferences(fixture.traceability, fixture.contract, fixture.bridges);
    expect(result.pass).toBe(true);
    expect(result.checkedMappings).toBe(2);
  });

  test("reports an unknown contract AC verbatim", () => {
    const input = structuredClone(fixture);
    input.contract.mappings[1].ac = "AC9.9.9";
    input.contract.requiredMappings[1] = "SCREEN-BUDGET/STATE-SAVED/AC9.9.9";
    const result = validateRequirementUiCrossReferences(input.traceability, input.contract, input.bridges);
    expect(result.findings).toContainEqual({ code: "UNKNOWN_AC", value: "AC9.9.9" });
  });

  test("OFF is a no-op and does not load artifacts", () => {
    let loads = 0;
    const result = runRequirementUiCrossValidation(false, () => {
      loads++;
      return { traceability: fixture.traceability, contract: fixture.contract, bridges: fixture.bridges };
    });
    expect(loads).toBe(0);
    expect(result).toEqual({ enabled: false, pass: true, checkedMappings: 0, findings: [] });
  });

  test("requires an explicit bridge for a differently-shaped C AC", () => {
    const result = validateRequirementUiCrossReferences(fixture.traceability, fixture.contract);
    expect(result.findings).toContainEqual({ code: "UNKNOWN_AC", value: "AC-001" });
  });

  test("rejects a bridge to an ID absent from official traceability", () => {
    const result = validateRequirementUiCrossReferences(fixture.traceability, fixture.contract, [
      { uiAc: "AC-001", officialId: "AC9.9.9" },
    ]);
    expect(result.findings).toContainEqual({ code: "INVALID_BRIDGE", value: "AC-001->AC9.9.9" });
  });
});

