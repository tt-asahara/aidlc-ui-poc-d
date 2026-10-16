import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const cli = join(import.meta.dir, "..", "d-feature-checks.ts");
const boundary = join(import.meta.dir, "..", "host-stage-boundary.ts");
function project(config: unknown) { const root = mkdtempSync(join(tmpdir(), "d-feature-entry-")); mkdirSync(join(root, ".claude")); writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify(config)); return root; }
function run(root: string) { return spawnSync(process.execPath, [cli, "--project-dir", root, "--input", "input.json"], { cwd: root, encoding: "utf8" }); }

describe("installed D feature-check entry", () => {
  test("all OFF exits before input artifacts or workers and writes no evidence", () => {
    const root = project({}); writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", traceabilityPath: "missing.json", uiContractPath: "missing.json" }));
    const result = run(root); expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ reads: 0, workerCalls: 0, artifactsWritten: 0 });
    expect(existsSync(join(root, "aidlc"))).toBe(false);
  });
  test("ON deterministic checks run from the entry and persist NOT-READY reviewer evidence", () => {
    const root = project({ features: { requirementIdValidation: true, functionalDesignDocumentDiscipline: true } });
    writeFileSync(join(root, "trace.json"), JSON.stringify({ upstream_ids: ["AC1"], coverage: [] }));
    writeFileSync(join(root, "ui.json"), JSON.stringify({ schema: 1, mappings: [{ screen: "s", state: "x", ac: "UNKNOWN" }], requiredMappings: ["s/x/UNKNOWN"] }));
    writeFileSync(join(root, "functional.md"), "# Functional\n");
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", traceabilityPath: "trace.json", uiContractPath: "ui.json", functionalArtifacts: { "functional-spec.md": "functional.md" } }));
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "run-stage", stage: "functional-design", gate: false, unit: "budget" }));
    const result = spawnSync(process.execPath, [boundary, "--project-dir", root, "--directive-file", "directive.json", "--manifest", "input.json"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(2); const output = JSON.parse(result.stdout); expect(output.verdict).toBe("NOT-READY"); expect(output.notReady).toContain("requirementIdValidation"); expect(existsSync(output.evidencePath)).toBe(true);
  });
  test("rejects input and output paths outside the product", () => {
    const root = project({ features: { requirementIdValidation: true } });
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", traceabilityPath: "../outside.json", uiContractPath: "../outside.json" }));
    expect(run(root).status).not.toBe(0);
    writeFileSync(join(root, "trace.json"), JSON.stringify({ upstream_ids: [], coverage: [] })); writeFileSync(join(root, "ui.json"), JSON.stringify({ schema: 1, mappings: [], requiredMappings: [] }));
    writeFileSync(join(root, "input.json"), JSON.stringify({ stage: "functional-design", traceabilityPath: "trace.json", uiContractPath: "ui.json", groundingOutputPath: "../escape.json" }));
    expect(run(root).status).not.toBe(0);
  });
});
