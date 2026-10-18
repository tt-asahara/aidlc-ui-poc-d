import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OFFICIAL_AC_ID, parseOfficialAcceptanceCriteria } from "../official-acceptance-criteria.ts";
import { parseUiContract, runRequirementUiCrossValidation, validateRequirementUiCrossReferences, type UiContract } from "../requirement-ui-cross-validation.ts";

const FIXTURES = join(import.meta.dir, "..", "fixtures", "official-ac");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const STORIES = `# User Stories

## Story group 1

### US1.1 Sign in

- **Acceptance Criteria**
  - **AC1.1.1** Given a user When they sign in Then the home opens
  - **AC1.1.2** Given a wrong password When they sign in Then an error shows
`;
const contract = (...acs: string[]): UiContract => ({
  schema: 2,
  mappings: acs.map((ac, i) => ({ screen: "SCREEN-HOME", state: `STATE-S${i}`, ac })),
  requiredMappings: acs.map((ac, i) => `SCREEN-HOME/STATE-S${i}/${ac}`),
});
const official = (markdown = STORIES) => { const parsed = parseOfficialAcceptanceCriteria(markdown); return { storiesIds: parsed.ids, storiesFindings: parsed.findings }; };

describe("official acceptance-criteria parser (one owner)", () => {
  test("accepts exactly the core AC{group}.{seq}.{criterion} grammar", () => {
    for (const id of ["AC1.1.1", "AC12.3.45"]) expect(OFFICIAL_AC_ID.test(id)).toBe(true);
    for (const id of ["AC-1-1-1", "AC1.1", "AC1.1.1.1", "ac1.1.1", "ＡＣ１.１.１", "AC1．1．1", "AC１.1.1", " AC1.1.1"]) expect(OFFICIAL_AC_ID.test(id)).toBe(false);
  });

  test("reads definitions from list items, headings, and first table cells only", () => {
    const parsed = parseOfficialAcceptanceCriteria([
      "# Stories", "", "### AC2.1.1 heading definition", "",
      "- **AC1.1.1** Given x", "  continued text mentions AC9.9.9", "- `AC1.1.2` code-span wrapped", "1. AC1.1.3. ordered, sentence period",
      "> - AC1.1.4 quoted list", "", "| ID | 内容 |", "|---|---|", "| AC3.1.1 | table row |", "",
      "Prose that mentions AC9.9.8 is a reference.", "", "```", "- AC9.9.7 in fenced code", "```", "", "<!-- - AC9.9.6 in a comment -->", "",
    ].join("\n"));
    expect(parsed).toEqual({ ids: ["AC2.1.1", "AC1.1.1", "AC1.1.2", "AC1.1.3", "AC1.1.4", "AC3.1.1"], findings: [] });
  });

  test("Japanese headings and labels parse the same as English; references are not duplicates", () => {
    const parsed = parseOfficialAcceptanceCriteria([
      "> ID（`US{群}.{番号}`、`AC{群}.{番号}.{連番}`）は固定の ID。", "", "## 群 1: 共通の土台（FR1）", "", "### US1.1 ロールを切り替える", "",
      "- **受入条件**", "  - **AC1.1.1** Given アプリ When 選ぶ Then 表示される", "  - **AC1.1.2**：Given 再読み込み Then 保持される", "",
      "文章での説明: US6.2 の AC1.1.2 は US5.2 の完了に依存する。", "- **対応**: AC1.1.1 を参照",
    ].join("\n"));
    expect(parsed).toEqual({ ids: ["AC1.1.1", "AC1.1.2"], findings: [] });
  });

  test("full-width, lower-case, legacy, and wrong-length lookalikes are findings, never IDs", () => {
    const parsed = parseOfficialAcceptanceCriteria(["- ＡＣ１.１.１ full-width", "- AC1．2．1 full-width dots", "- ac1.2.2 lower", "- AC-1-2-3 legacy", "- AC1.2 short", "- AC1.2.3.4 long", "- ACME is a company", "- AC1.3.1 ok"].join("\n"));
    expect(parsed.ids).toEqual(["AC1.3.1"]);
    expect(parsed.findings.map((f) => [f.code, f.value])).toEqual([
      ["MALFORMED_OFFICIAL_AC", "ＡＣ１.１.１"], ["MALFORMED_OFFICIAL_AC", "AC1．2．1"], ["MALFORMED_OFFICIAL_AC", "ac1.2.2"],
      ["MALFORMED_OFFICIAL_AC", "AC-1-2-3"], ["MALFORMED_OFFICIAL_AC", "AC1.2"], ["MALFORMED_OFFICIAL_AC", "AC1.2.3.4"],
    ]);
  });

  test("a second definition of the same ID is a duplicate with its line", () => {
    const parsed = parseOfficialAcceptanceCriteria("- AC1.1.1 first\n- AC1.1.2 second\n- **AC1.1.1** again\n");
    expect(parsed.ids).toEqual(["AC1.1.1", "AC1.1.2"]);
    expect(parsed.findings).toEqual([{ code: "DUPLICATE_OFFICIAL_AC", value: "AC1.1.1", line: 3 }]);
  });

  test("real dogfood stories shape: every defined AC and nothing else", () => {
    const text = read("stories.md");
    const parsed = parseOfficialAcceptanceCriteria(text);
    expect(parsed.findings).toEqual([]);
    // Independent oracle for this fixture: every bold list-item definition line.
    const oracle = [...text.matchAll(/^\s*- \*\*(AC\d+\.\d+\.\d+)\*\*/gm)].map((m) => m[1]);
    expect(parsed.ids).toEqual(oracle);
    expect(parsed.ids.length).toBe(oracle.length);
    // The template line and the prose cross-reference (AC6.2.6) are not definitions.
    expect(text).toContain("`AC{群}.{番号}.{連番}`");
    expect(text).toContain("US6.2 の AC6.2.6 は");
  });
});

describe("feature 21 requirement/UI cross-validation on official IDs", () => {
  test("official IDs in the contract are accepted verbatim with no bridge", () => {
    const result = validateRequirementUiCrossReferences(official(), contract("AC1.1.1", "AC1.1.2"));
    expect(result).toEqual({ enabled: true, pass: true, checkedMappings: 2, officialAcCount: 2, findings: [] });
  });

  test("an unknown official-form AC is reported verbatim", () => {
    const result = validateRequirementUiCrossReferences(official(), contract("AC1.1.1", "AC9.9.9"));
    expect(result.pass).toBe(false);
    expect(result.findings).toEqual([{ code: "UNKNOWN_AC", value: "AC9.9.9" }]);
  });

  test("missing input, missing file, zero ACs, and duplicate ACs fail closed", () => {
    expect(validateRequirementUiCrossReferences({ storiesIds: null, storiesUnavailable: { code: "MISSING_STORIES_INPUT", value: "x" } }, contract("AC1.1.1")).findings.map((f) => f.code)).toEqual(["MISSING_STORIES_INPUT", "UNKNOWN_AC"]);
    expect(validateRequirementUiCrossReferences({ storiesIds: null, storiesUnavailable: { code: "STORIES_NOT_FOUND", value: "stories.md" } }, contract("AC1.1.1")).findings.map((f) => f.code)).toEqual(["STORIES_NOT_FOUND", "UNKNOWN_AC"]);
    expect(validateRequirementUiCrossReferences(official("# Stories\n\nNo criteria yet.\n"), contract("AC1.1.1")).findings.map((f) => f.code)).toEqual(["NO_OFFICIAL_AC", "UNKNOWN_AC"]);
    const duplicate = validateRequirementUiCrossReferences(official(`${STORIES}  - **AC1.1.2** again\n`), contract("AC1.1.1"));
    expect(duplicate.pass).toBe(false);
    expect(duplicate.findings).toContainEqual({ code: "DUPLICATE_OFFICIAL_AC", value: "AC1.1.2 (stories line 10)" });
  });

  test("traceability.json is an optional union source; only AC-grammar IDs count", () => {
    const traceability = { upstream_ids: ["FR1", "AC4.1.1"], coverage: [{ id: "AC4.1.2", status: "OK" }, { id: "US1.1", status: "OK" }] };
    expect(validateRequirementUiCrossReferences({ ...official(), traceability }, contract("AC1.1.1", "AC4.1.1", "AC4.1.2")).pass).toBe(true);
    expect(validateRequirementUiCrossReferences({ ...official(), traceability }, contract("FR1")).findings).toContainEqual({ code: "UNKNOWN_AC", value: "FR1" });
    // traceability alone never replaces the official stories artifact
    expect(validateRequirementUiCrossReferences({ storiesIds: null, storiesUnavailable: { code: "MISSING_STORIES_INPUT", value: "x" }, traceability }, contract("AC4.1.1")).pass).toBe(false);
  });

  test("legacy AC- IDs need an explicit bridge; official IDs are never bridged", () => {
    expect(validateRequirementUiCrossReferences(official(), contract("AC-001")).findings).toEqual([{ code: "UNKNOWN_AC", value: "AC-001" }]);
    expect(validateRequirementUiCrossReferences(official(), contract("AC-001", "AC1.1.2"), [{ uiAc: "AC-001", officialId: "AC1.1.1" }]).pass).toBe(true);
    expect(validateRequirementUiCrossReferences(official(), contract("AC-001"), [{ uiAc: "AC-001", officialId: "AC9.9.9" }]).findings).toContainEqual({ code: "INVALID_BRIDGE", value: "AC-001->AC9.9.9" });
    expect(validateRequirementUiCrossReferences(official(), contract("AC1.1.1"), [{ uiAc: "AC1.1.1", officialId: "AC1.1.2" }]).findings).toEqual([{ code: "INVALID_BRIDGE", value: "AC1.1.1->AC1.1.2" }]);
    expect(validateRequirementUiCrossReferences(official(), contract("AC-001"), [{ uiAc: "AC-001", officialId: "AC1.1.1" }, { uiAc: "AC-001", officialId: "AC1.1.2" }]).findings).toEqual([{ code: "DUPLICATE_BRIDGE", value: "AC-001" }]);
  });

  test("mapping inventory mismatches are still reported", () => {
    const c = contract("AC1.1.1");
    c.mappings.push({ ...c.mappings[0] });
    c.requiredMappings.push("SCREEN-HOME/STATE-X/AC1.1.2");
    expect(validateRequirementUiCrossReferences(official(), c).findings.map((f) => f.code)).toEqual(["DUPLICATE_MAPPING", "MISSING_REQUIRED_MAPPING"]);
  });

  test("OFF is a no-op and does not load artifacts", () => {
    let loads = 0;
    const result = runRequirementUiCrossValidation(false, () => { loads++; return { official: official(), contract: contract("AC1.1.1") }; });
    expect(loads).toBe(0);
    expect(result).toEqual({ enabled: false, pass: true, checkedMappings: 0, officialAcCount: 0, findings: [] });
  });

  test("real dogfood shape: official-ID contract against stories.md passes; legacy contract passes only with bridges", () => {
    const stories = official(read("stories.md"));
    const officialContract = parseUiContract(read("ui-poc-refined-contract.md"), "ui-poc-refined-contract.md");
    expect(officialContract.mappings.length).toBe(31);
    expect(validateRequirementUiCrossReferences(stories, officialContract)).toMatchObject({ pass: true, checkedMappings: 31, findings: [] });
    const legacy = parseUiContract(read("ui-poc-refined-contract.legacy.md"), "ui-poc-refined-contract.legacy.md");
    const withoutBridges = validateRequirementUiCrossReferences(stories, legacy);
    expect(withoutBridges.pass).toBe(false);
    expect(withoutBridges.findings.every((f) => f.code === "UNKNOWN_AC")).toBe(true);
    expect(validateRequirementUiCrossReferences(stories, legacy, JSON.parse(read("legacy-bridges.json"))).pass).toBe(true);
  });

  test("a Markdown contract must hold exactly one ui-poc-contract block", () => {
    expect(() => parseUiContract("# none\n", "x.md")).toThrow("exactly one ui-poc-contract block");
  });
});
