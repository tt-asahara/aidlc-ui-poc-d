import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { effectivePngGeneration, parseDJsonc, resolveDAiApproval, resolveDAutomation, resolveDDecisionIssueSummary, resolveDFeatureFlags, resolveDFeatureInputs, resolveDIssueAutopilot, resolveDModels } from "../d-config.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function project() { const root = mkdtempSync(join(tmpdir(), "d-config-")); roots.push(root); mkdirSync(join(root, ".claude")); return root; }
function write(root: string, name: string, value: string) { writeFileSync(join(root, ".claude", name), value); }

describe("D JSONC configuration", () => {
  test("preserves URL and comment markers inside strings", () => {
    expect(parseDJsonc('{ /* doc */ "url": "http://127.0.0.1/x//y", "mark": "/*literal*/,}", // line\n "items": [1,2,], }')).toEqual({ url: "http://127.0.0.1/x//y", mark: "/*literal*/,}", items: [1, 2] });
  });
  test("keeps strict JSON and legacy root model maps compatible", () => {
    const root = project(); write(root, "d-acceleration.json", JSON.stringify({ fast: "legacy-fast", balanced: "legacy-balanced" }));
    expect(resolveDModels(root).models).toEqual({ fast: "legacy-fast", balanced: "legacy-balanced", judgment: "opus" });
  });
  test("uses formal JSONC project and local layers, with CLI model overrides highest", () => {
    const root = project();
    write(root, "d-acceleration.jsonc", `{ // project\n "models": { "fast": "project-fast", "balanced": "project-balanced" }, }`);
    write(root, "d-acceleration.local.jsonc", `{ // personal\n "models": { "balanced": "local-balanced" }, }`);
    expect(resolveDModels(root, { fast: "cli-fast" })).toEqual({
      models: { fast: "cli-fast", balanced: "local-balanced", judgment: "opus" },
      sources: { fast: "cli", balanced: "local", judgment: "default" },
    });
  });
  test("rejects ambiguous project or local filename pairs", () => {
    const projectPair = project();
    write(projectPair, "d-acceleration.jsonc", "{}");
    write(projectPair, "d-acceleration.json", "{}");
    expect(() => resolveDModels(projectPair)).toThrow(/ambiguous D configuration.*d-acceleration\.jsonc.*d-acceleration\.json/);
    const localPair = project();
    write(localPair, "d-acceleration.local.jsonc", "{}");
    write(localPair, "d-acceleration.local.json", "{}");
    expect(() => resolveDModels(localPair)).toThrow(/ambiguous D configuration.*d-acceleration\.local\.jsonc.*d-acceleration\.local\.json/);
  });
  test("defaults optional execution paths off", () => {
    const root = project();
    expect(resolveDFeatureFlags(root)).toEqual({ requirementIdValidation: false, functionalDesignDocumentDiscipline: false, sourceGrounding: false, specGrounding: false, mockupPngGeneration: false, visualRegression: false });
    expect(resolveDFeatureInputs(root)).toEqual({ requirementIdBridges: [], functionalDesignBudgets: { artifactBytes: 60000, unitBytes: 160000, metadataBytes: 30000 }, sourceRoots: [], specRoots: [], groundingLimits: { maxEvidenceFiles: 200, maxInputBytes: 1000000 } });
    expect(resolveDIssueAutopilot(root)).toEqual({ enabled: false, oneIssuePerRun: true });
    expect(resolveDAutomation(root)).toEqual({ enabled: false, through: undefined, sessionOnly: true, ambiguityPolicy: "halt", assumptionLedger: true, maxRetries: 2, maxSteps: 64, deadlineMs: 900000, labelAllowlist: [] });
    expect(resolveDAiApproval(root)).toEqual({ mode: "human", minConfidence: 0.9, decisionRecordPath: "decisions/ai-approval-decisions.jsonl" });
    expect(resolveDDecisionIssueSummary(root)).toEqual({ enabled: false, repository: undefined, send: false, maxRetries: 2 });
  });
  test("refuses issueAutopilot.oneIssuePerRun=false instead of silently ignoring it", () => {
    const root = project();
    write(root, "d-acceleration.json", '{ "issueAutopilot": { "enabled": true, "oneIssuePerRun": false } }');
    expect(() => resolveDIssueAutopilot(root)).toThrow("oneIssuePerRun=false is not supported");
    write(root, "d-acceleration.json", '{ "issueAutopilot": { "enabled": true, "oneIssuePerRun": true } }');
    expect(resolveDIssueAutopilot(root)).toEqual({ enabled: true, oneIssuePerRun: true });
  });
  test("merges by field and preserves explicit local false", () => {
    const root = project();
    write(root, "d-acceleration.jsonc", `{ "features": { "requirementIdValidation": true, "sourceGrounding": true }, "auto": { "enabled": true, "through": "code-generation", "ambiguityPolicy": "research", "maxRetries": 4, "labelAllowlist": ["aidlc"] }, "issueAutopilot": { "enabled": true }, }`);
    write(root, "d-acceleration.local.jsonc", `{ "features": { "sourceGrounding": false, "specGrounding": true }, "auto": { "enabled": false, "ambiguityPolicy": "halt", "maxRetries": 1 }, "issueAutopilot": { "enabled": false }, }`);
    expect(resolveDFeatureFlags(root)).toEqual({ requirementIdValidation: true, functionalDesignDocumentDiscipline: false, sourceGrounding: false, specGrounding: true, mockupPngGeneration: false, visualRegression: false });
    expect(resolveDAutomation(root)).toEqual({ enabled: false, through: "code-generation", sessionOnly: true, ambiguityPolicy: "halt", assumptionLedger: true, maxRetries: 1, maxSteps: 64, deadlineMs: 900000, labelAllowlist: ["aidlc"] });
    expect(resolveDIssueAutopilot(root)).toEqual({ enabled: false, oneIssuePerRun: true });
  });

  test("a leftover clef key fails closed with a one-line removal notice", () => {
    for (const layer of ["d-acceleration.jsonc", "d-acceleration.local.jsonc"]) {
      const root = project();
      write(root, layer, `{ "clef": { "enabled": false } }`);
      expect(() => resolveDModels(root)).toThrow(/^Clef routing support was removed from D \(owner decision 2026-10-17\); delete the "clef" key from .*$/);
    }
  });
  test("visual regression implies effective PNG generation without rewriting the explicit switch", () => {
    const root = project(); write(root, "d-acceleration.json", '{ "features": { "visualRegression": true, "mockupPngGeneration": false } }');
    const features = resolveDFeatureFlags(root);
    expect(features.mockupPngGeneration).toBe(false);
    expect(effectivePngGeneration(features)).toBe(true);
  });
  test("merges feature inputs without inventing grounding roots or ID bridges", () => {
    const root = project();
    write(root, "d-acceleration.json", `{ "featureInputs": { "requirementIdBridges": [{"uiAc":"AC-1","officialId":"AC1.1.1"}], "functionalDesignBudgets": {"artifactBytes": 70000}, "sourceRoots": ["src"] } }`);
    write(root, "d-acceleration.local.json", `{ "featureInputs": { "functionalDesignBudgets": {"metadataBytes": 10000}, "specRoots": ["docs/spec"] } }`);
    expect(resolveDFeatureInputs(root)).toEqual({ requirementIdBridges: [{ uiAc: "AC-1", officialId: "AC1.1.1" }], functionalDesignBudgets: { artifactBytes: 70000, unitBytes: 160000, metadataBytes: 10000 }, sourceRoots: ["src"], specRoots: ["docs/spec"], groundingLimits: { maxEvidenceFiles: 200, maxInputBytes: 1000000 } });
  });
  test("grounding caps default to 200 files / 1,000,000 bytes and merge local over project by field", () => {
    const root = project();
    write(root, "d-acceleration.jsonc", `{ "featureInputs": { "groundingLimits": { "maxEvidenceFiles": 800, "maxInputBytes": 2000000 } } }`);
    expect(resolveDFeatureInputs(root).groundingLimits).toEqual({ maxEvidenceFiles: 800, maxInputBytes: 2000000 });
    write(root, "d-acceleration.local.jsonc", `{ "featureInputs": { "groundingLimits": { "maxInputBytes": 4000000 } } }`);
    expect(resolveDFeatureInputs(root).groundingLimits).toEqual({ maxEvidenceFiles: 800, maxInputBytes: 4000000 });
    write(root, "d-acceleration.local.jsonc", `{ "featureInputs": { "groundingLimits": { "maxEvidenceFiles": 5000 } } }`);
    expect(resolveDFeatureInputs(root).groundingLimits).toEqual({ maxEvidenceFiles: 5000, maxInputBytes: 2000000 });
  });
  test("rejects non-integer, non-positive, above-ceiling, or unknown grounding caps with one line naming the key and range", () => {
    const cases: Array<[string, RegExp]> = [
      ['{ "maxEvidenceFiles": 5001 }', /^invalid featureInputs\.groundingLimits\.maxEvidenceFiles: 5001 \(allowed: integer 1\.\.5000\) in .*d-acceleration\.(local\.)?jsonc$/],
      ['{ "maxInputBytes": 4000001 }', /^invalid featureInputs\.groundingLimits\.maxInputBytes: 4000001 \(allowed: integer 1\.\.4000000\) in .*$/],
      ['{ "maxInputBytes": 0 }', /maxInputBytes: 0 \(allowed: integer 1\.\.4000000\)/],
      ['{ "maxEvidenceFiles": -1 }', /maxEvidenceFiles: -1 \(allowed: integer 1\.\.5000\)/],
      ['{ "maxEvidenceFiles": 250.5 }', /maxEvidenceFiles: 250\.5 \(allowed: integer 1\.\.5000\)/],
      ['{ "maxInputBytes": "2000000" }', /maxInputBytes: "2000000" \(allowed: integer 1\.\.4000000\)/],
      ['{ "maxFiles": 300 }', /^unknown D featureInputs\.groundingLimits key maxFiles in .* \(allowed: maxEvidenceFiles, maxInputBytes\)$/],
    ];
    for (const layer of ["d-acceleration.jsonc", "d-acceleration.local.jsonc"]) for (const [limits, message] of cases) {
      const root = project(); write(root, layer, `{ "featureInputs": { "groundingLimits": ${limits} } }`);
      expect(() => resolveDFeatureInputs(root)).toThrow(message);
      try { resolveDFeatureInputs(root); } catch (error) { expect((error as Error).message).not.toContain("\n"); }
    }
    const root = project(); write(root, "d-acceleration.jsonc", `{ "featureInputs": { "groundingLimits": 300 } }`);
    expect(() => resolveDFeatureInputs(root)).toThrow("invalid D grounding limits config");
  });
  test("rejects mistyped safety policy", () => {
    const root = project(); write(root, "d-acceleration.json", '{ "auto": { "ambiguityPolicy": "guess" } }'); expect(() => resolveDAutomation(root)).toThrow("ambiguityPolicy");
    write(root, "d-acceleration.json", '{ "auto": { "through": "made-up-stage" } }'); expect(() => resolveDAutomation(root)).toThrow("through");
    write(root, "d-acceleration.json", '{ "features": { "sourceGrounding": "yes" } }'); expect(() => resolveDFeatureFlags(root)).toThrow("sourceGrounding");
  });
  test("documents every boolean switch in Japanese with timing and ON/OFF/default behavior", () => {
    const lines = readFileSync(join(import.meta.dir, "..", "d-acceleration.example.jsonc"), "utf8").split("\n");
    const switches = lines.flatMap((line, index) => /"([^"]+)"\s*:\s*(true|false)/.test(line) ? [{ index }] : []);
    expect(switches.length).toBe(16);
    for (const entry of switches) {
      const comment = lines.slice(Math.max(0, entry.index - 2), entry.index).join(" ");
      expect(comment).toMatch(/[ぁ-んァ-ヶ一-龠]/);
      expect(comment).toContain("対象:");
      expect(comment).toContain("ON時:");
      expect(comment).toMatch(/OFF時:|OFFは/);
      expect(comment).toContain("既定値:");
      expect(comment).toContain("利用場面:");
    }
    const featureComments = lines.slice(lines.findIndex((line) => line.includes('"features"')), lines.findIndex((line) => line.includes('"featureInputs"'))).join("\n");
    for (const id of ["機能21", "機能22", "機能27", "機能28"]) expect(featureComments).toContain(id);
    expect(featureComments.match(/既定値: OFF/g)).toHaveLength(6);
    expect(featureComments.match(/依存関係:/g)).toHaveLength(6);
    expect(featureComments).toContain("sourceRoots必須。空・不在・project外・symlink経由のrootが1つでもあればOFF扱いでNOT-READYを記録し準拠主張はしない");
    const limitsIndex = lines.findIndex((line) => line.includes('"groundingLimits"'));
    const limitsComment = lines[limitsIndex - 1]!;
    for (const label of ["機能27/28", "対象:", "役割:", "ON時", "OFF時", "既定値: 200 file・1,000,000 byte", "maxEvidenceFiles 1〜5000", "maxInputBytes 1〜4000000", "丸めずに設定エラーで停止", "上限根拠:", "依存関係:", "利用場面:"]) expect(limitsComment).toContain(label);
    // The template's caps are exactly the runtime defaults and pass the runtime validator.
    const root = project(); writeFileSync(join(root, ".claude", "d-acceleration.jsonc"), readFileSync(join(import.meta.dir, "..", "d-acceleration.example.jsonc"), "utf8"));
    expect(resolveDFeatureInputs(root).groundingLimits).toEqual({ maxEvidenceFiles: 200, maxInputBytes: 1000000 });
    expect(featureComments).toContain("specRoots必須。空・不在・project外・symlink経由のrootが1つでもあればOFF扱いでNOT-READYを記録し準拠主張はしない");
  });
});
