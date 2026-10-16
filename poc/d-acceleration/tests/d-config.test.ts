import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDJsonc, resolveDAutomation, resolveDClef, resolveDFeatureFlags, resolveDFeatureInputs, resolveDIssueAutopilot, resolveDModels } from "../d-config.ts";

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
  test("defaults optional execution paths off", () => {
    const root = project();
    expect(resolveDFeatureFlags(root)).toEqual({ requirementIdValidation: false, functionalDesignDocumentDiscipline: false, sourceGrounding: false, specGrounding: false });
    expect(resolveDFeatureInputs(root)).toEqual({ requirementIdBridges: [], functionalDesignBudgets: { artifactBytes: 60000, unitBytes: 160000, metadataBytes: 30000 }, sourceRoots: [], specRoots: [] });
    expect(resolveDIssueAutopilot(root)).toEqual({ enabled: false, oneIssuePerRun: true });
    expect(resolveDAutomation(root)).toEqual({ enabled: false, through: undefined, sessionOnly: true, ambiguityPolicy: "halt", assumptionLedger: true, maxRetries: 2, maxSteps: 64, deadlineMs: 900000, labelAllowlist: [] });
  });
  test("merges by field and preserves explicit local false", () => {
    const root = project();
    write(root, "d-acceleration.json", `{ "features": { "requirementIdValidation": true, "sourceGrounding": true }, "auto": { "enabled": true, "through": "code-generation", "ambiguityPolicy": "research", "maxRetries": 4, "labelAllowlist": ["aidlc"] }, "issueAutopilot": { "enabled": true }, "clef": { "enabled": true, "lowRiskUnits": ["web"] }, }`);
    write(root, "d-acceleration.local.json", `{ "features": { "sourceGrounding": false, "specGrounding": true }, "auto": { "enabled": false, "ambiguityPolicy": "halt", "maxRetries": 1 }, "issueAutopilot": { "enabled": false }, "clef": { "enabled": false }, }`);
    expect(resolveDFeatureFlags(root)).toEqual({ requirementIdValidation: true, functionalDesignDocumentDiscipline: false, sourceGrounding: false, specGrounding: true });
    expect(resolveDAutomation(root)).toEqual({ enabled: false, through: "code-generation", sessionOnly: true, ambiguityPolicy: "halt", assumptionLedger: true, maxRetries: 1, maxSteps: 64, deadlineMs: 900000, labelAllowlist: ["aidlc"] });
    expect(resolveDIssueAutopilot(root)).toEqual({ enabled: false, oneIssuePerRun: true });
    expect(resolveDClef(root).enabled).toBe(false);
  });
  test("merges feature inputs without inventing grounding roots or ID bridges", () => {
    const root = project();
    write(root, "d-acceleration.json", `{ "featureInputs": { "requirementIdBridges": [{"uiAc":"AC-1","officialId":"AC1.1.1"}], "functionalDesignBudgets": {"artifactBytes": 70000}, "sourceRoots": ["src"] } }`);
    write(root, "d-acceleration.local.json", `{ "featureInputs": { "functionalDesignBudgets": {"metadataBytes": 10000}, "specRoots": ["docs/spec"] } }`);
    expect(resolveDFeatureInputs(root)).toEqual({ requirementIdBridges: [{ uiAc: "AC-1", officialId: "AC1.1.1" }], functionalDesignBudgets: { artifactBytes: 70000, unitBytes: 160000, metadataBytes: 10000 }, sourceRoots: ["src"], specRoots: ["docs/spec"] });
  });
  test("rejects mistyped safety policy", () => {
    const root = project(); write(root, "d-acceleration.json", '{ "auto": { "ambiguityPolicy": "guess" } }'); expect(() => resolveDAutomation(root)).toThrow("ambiguityPolicy");
    write(root, "d-acceleration.json", '{ "auto": { "through": "made-up-stage" } }'); expect(() => resolveDAutomation(root)).toThrow("through");
    write(root, "d-acceleration.json", '{ "features": { "sourceGrounding": "yes" } }'); expect(() => resolveDFeatureFlags(root)).toThrow("sourceGrounding");
  });
  test("documents every boolean switch in Japanese with timing and ON/OFF/default behavior", () => {
    const lines = readFileSync(join(import.meta.dir, "..", "d-acceleration.example.jsonc"), "utf8").split("\n");
    const switches = lines.flatMap((line, index) => /"([^"]+)"\s*:\s*(true|false)/.test(line) ? [{ index }] : []);
    expect(switches.length).toBe(12);
    for (const entry of switches) {
      const comment = lines.slice(Math.max(0, entry.index - 2), entry.index).join(" ");
      expect(comment).toMatch(/[ぁ-んァ-ヶ一-龠]/);
      expect(comment).toContain("対象:");
      expect(comment).toContain("ON時:");
      expect(comment).toMatch(/OFF時:|OFFは/);
      expect(comment).toContain("既定値:");
      expect(comment).toContain("利用場面:");
    }
  });
});
