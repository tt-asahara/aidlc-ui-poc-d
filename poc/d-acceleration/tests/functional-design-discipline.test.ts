import { describe, expect, test } from "bun:test";
import { runFunctionalDesignDiscipline, validateFunctionalDesignDiscipline } from "../functional-design-discipline.ts";

const good = {
  stage: "functional-design",
  artifacts: {
    "functional-spec.md": "# Functional spec\n\n## Sources\n\nrequirements.md\n\n## Traceability\n\nAC1.1.1 -> BR1.1\n",
    "entities.md": "# Entities\n\nMetadata: see functional-spec.md.\n",
    "rules.md": "# Rules\n\nBR1.1 applies.\n",
  },
  traceability: { upstream_ids: ["AC1.1.1"], coverage: [{ id: "AC1.1.1", status: "OK", target: "BR1.1" }] },
} as const;

describe("feature 22 functional-design discipline", () => {
  test("keeps metadata canonical in functional-spec and preserves traceability input", () => {
    const before = JSON.stringify(good.traceability);
    const result = validateFunctionalDesignDiscipline(good);
    expect(result.pass).toBe(true);
    expect(JSON.stringify(good.traceability)).toBe(before);
  });

  test("finds duplicate sibling metadata and configured byte overruns", () => {
    const result = validateFunctionalDesignDiscipline({
      ...good,
      artifacts: { ...good.artifacts, "rules.md": "## Sources\n\nRepeated source prose" },
      budgets: { artifactBytes: 20, unitBytes: 40, metadataBytes: 5 },
    });
    expect(result.findings.some((finding) => finding.code === "DUPLICATE_METADATA" && finding.artifact === "rules.md")).toBe(true);
    expect(result.findings.some((finding) => finding.code === "METADATA_BUDGET")).toBe(true);
  });

  test("rejects an empty artifact set and a missing functional-spec without expanding document policy", () => {
    const empty = validateFunctionalDesignDiscipline({ ...good, artifacts: {} });
    expect(empty.findings.some((finding) => finding.code === "EMPTY_ARTIFACTS")).toBe(true);
    expect(empty.findings.some((finding) => finding.code === "MISSING_FUNCTIONAL_SPEC")).toBe(true);
    const missing = validateFunctionalDesignDiscipline({ ...good, artifacts: { "rules.md": "# Rules\n" } });
    expect(missing.findings.some((finding) => finding.code === "MISSING_FUNCTIONAL_SPEC")).toBe(true);
    expect(missing.findings.some((finding) => finding.code === "EMPTY_ARTIFACTS")).toBe(false);
  });

  test("OFF is a no-op and does not load documents", () => {
    let loads = 0;
    const result = runFunctionalDesignDiscipline(false, () => {
      loads++;
      return good;
    });
    expect(loads).toBe(0);
    expect(result).toEqual({ enabled: false, pass: true, artifactBytes: {}, unitBytes: 0, metadataBytes: 0, findings: [] });
  });
});

