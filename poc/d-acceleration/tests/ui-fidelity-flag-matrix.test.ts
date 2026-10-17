import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// Feature flags ON/OFF matrix for the UI fidelity lane. Each flag governs only
// its own check (no hidden coupling), an enabled check with missing input fails
// closed, and the schema 2 semantic fidelity chain has no flag that disables it
// (that half is proven in poc/ui-poc/tests/fidelity-e2e.test.cjs).
const D = join(import.meta.dir, "..");
const UI = join(D, "..", "ui-poc");
const cli = join(D, "d-feature-checks.ts");
type Flags = { requirementIdValidation: boolean; functionalDesignDocumentDiscipline: boolean; mockupPngGeneration: boolean; visualRegression: boolean };
const combos: Flags[] = [];
for (let mask = 0; mask < 16; mask++) combos.push({ requirementIdValidation: Boolean(mask & 1), functionalDesignDocumentDiscipline: Boolean(mask & 2), mockupPngGeneration: Boolean(mask & 4), visualRegression: Boolean(mask & 8) });
const label = (flags: Flags) => Object.entries(flags).map(([k, v]) => `${k}=${v ? "ON" : "OFF"}`).join(" ");

function project(features: Flags, valid: boolean) {
  const root = mkdtempSync(join(tmpdir(), "d-ui-flags-"));
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify({ features }));
  writeFileSync(join(root, "trace.json"), JSON.stringify({ upstream_ids: ["AC-NOTE-001"], coverage: [] }));
  writeFileSync(join(root, "ui.json"), JSON.stringify({ schema: 2, mappings: [{ screen: "SCREEN-NOTES", state: "STATE-LIST", ac: valid ? "AC-NOTE-001" : "AC-UNKNOWN" }], requiredMappings: [valid ? "SCREEN-NOTES/STATE-LIST/AC-NOTE-001" : "SCREEN-NOTES/STATE-LIST/AC-UNKNOWN"] }));
  writeFileSync(join(root, "functional-spec.md"), "# Functional\n\n## Sources\n\nrefined mockup\n");
  writeFileSync(join(root, "frontend-components.md"), valid ? "# Components\n\nSee functional-spec.md.\n" : "# Components\n\n## Sources\n\nduplicated metadata\n");
  writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", traceabilityPath: "trace.json", uiContractPath: "ui.json", functionalArtifacts: { "functional-spec.md": "functional-spec.md", "frontend-components.md": "frontend-components.md" } }));
  return root;
}
const run = (root: string) => spawnSync(process.execPath, [cli, "--project-dir", root, "--input", "input.json"], { cwd: root, encoding: "utf8" });

describe("D feature flags ON/OFF at Functional Design", () => {
  for (const flags of combos) {
    test(`invalid inputs: ${label(flags)}`, () => {
      const result = run(project(flags, false));
      const expected = (["requirementIdValidation", "functionalDesignDocumentDiscipline"] as const).filter((key) => flags[key]);
      if (!expected.length) {
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ status: "disabled-or-not-applicable", reads: 0, workerCalls: 0 });
        return;
      }
      expect(result.status).toBe(2);
      const output = JSON.parse(result.stdout);
      expect(output.verdict).toBe("NOT-READY");
      // Exactly the enabled checks report; image flags never leak into this lane.
      expect([...output.notReady].sort()).toEqual([...expected].sort());
      expect(Object.keys(output.results).sort()).toEqual([...expected].sort());
    });
    test(`valid inputs: ${label(flags)}`, () => {
      const result = run(project(flags, true));
      expect(result.status).toBe(0);
      if (flags.requirementIdValidation || flags.functionalDesignDocumentDiscipline) expect(JSON.parse(result.stdout).verdict).toBe("READY");
    });
  }
  test("an enabled check with missing input fails closed instead of passing", () => {
    for (const flags of combos.filter((f) => f.requirementIdValidation || f.functionalDesignDocumentDiscipline)) {
      const root = project(flags, true);
      writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design" }));
      const result = run(root);
      expect(result.status).not.toBe(0);
    }
  });
});

describe("UI evidence sensor resolves image flags or fails closed", () => {
  const sha = (path: string) => createHash("sha256").update(require("node:fs").readFileSync(path)).digest("hex");
  function install(withResolver: boolean, features: Partial<Flags>) {
    const root = mkdtempSync(join(tmpdir(), "d-ui-sensor-"));
    const tools = join(root, ".claude", "tools"); mkdirSync(tools, { recursive: true });
    for (const name of ["aidlc-sensor-ui-poc-evidence.ts", "ui-poc-evidence.cjs", "ui-poc-fidelity.cjs", "ui-poc-element-matrix.cjs", "ui-poc-c-routing.cjs"]) copyFileSync(join(UI, "tools", name), join(tools, name));
    cpSync(join(UI, "tools", "ui-poc"), join(tools, "ui-poc"), { recursive: true });
    if (withResolver) symlinkSync(D, join(tools, "d-acceleration"));
    writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify({ features }));
    const stage = join(root, "evidence"); mkdirSync(stage);
    copyFileSync(join(UI, "fixtures", "fidelity-e2e", "approved", "notes.html"), join(stage, "notes.html"));
    copyFileSync(join(UI, "fixtures", "fidelity-e2e", "approved", "ui-semantic-snapshot.json"), join(stage, "ui-semantic-snapshot.json"));
    const states = ["STATE-LIST", "STATE-CONFIRM-DELETE", "STATE-DELETED", "STATE-SAVED", "STATE-STORAGE-ERROR", "STATE-PRIVATE-MODE"];
    const mappings = states.map((state, i) => ({ screen: "SCREEN-NOTES", state, ac: `AC-NOTE-00${i + 1}`, asset: "notes.html", check: state }));
    const snapshot = { path: "ui-semantic-snapshot.json", sha256: sha(join(stage, "ui-semantic-snapshot.json")) };
    const contract = { schema: 2, stage: "refined-mockups", arm: "C", assets: [{ path: "notes.html", sha256: sha(join(stage, "notes.html")) }, snapshot], mappings, requiredMappings: mappings.map((m) => `${m.screen}/${m.state}/${m.ac}`), fidelity: { approvedSnapshot: snapshot, dispositions: [] } };
    writeFileSync(join(stage, "ui-poc-refined-contract.md"), `# Fixture\n\n## Artifact References\n\n## Screen State Acceptance Mapping\n\n## Approval Evidence\n\n## Testing Brief\n\n\`\`\`ui-poc-contract\n${JSON.stringify(contract)}\n\`\`\`\n`);
    const result = spawnSync(process.execPath, [join(tools, "aidlc-sensor-ui-poc-evidence.ts"), "--stage", "refined-mockups", "--output-path", join(stage, "ui-poc-refined-contract.md")], { cwd: root, encoding: "utf8" });
    return JSON.parse(result.stdout) as { pass: boolean; findings: string[] };
  }
  test("D config present but resolver not installed: fail closed, never silently image-OFF", () => {
    const output = install(false, { visualRegression: true });
    expect(output.pass).toBe(false);
    expect(output.findings.join("\n")).toContain("D config resolver is not installed");
  });
  for (const features of [{ mockupPngGeneration: true }, { visualRegression: true }, { mockupPngGeneration: true, visualRegression: true }]) {
    test(`resolver installed, ${JSON.stringify(features)}: missing baseline PNG fails`, () => {
      const output = install(true, features);
      expect(output.pass).toBe(false);
      expect(output.findings.join("\n")).toContain("Enabled PNG evidence is missing");
    });
  }
  test("resolver installed, both image flags OFF: no PNG obligation and no resolver finding", () => {
    const output = install(true, { mockupPngGeneration: false, visualRegression: false });
    expect(output.findings.join("\n")).not.toContain("PNG");
    expect(output.findings.join("\n")).not.toContain("resolver");
  });
});
