import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClaudeGroundingWorker, persistGroundingEvidence } from "../grounding-runtime.ts";
import { snapshotGroundingInputs } from "../grounding.ts";

describe("grounding production worker adapter", () => {
  test("uses fixed argv with read-only tools and persists reviewer evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "d-ground-runtime-"));
    const evidence = join(root, "src"); mkdirSync(evidence); writeFileSync(join(evidence, "a.ts"), "export const a = 1;");
    const artifact = join(root, "design.md"); writeFileSync(artifact, "# Design claim");
    let observed: readonly string[] = [];
    const worker = createClaudeGroundingWorker({ cwd: root, runner: async (_exe, argv) => { observed = argv; return { status: 0, stderr: "", stdout: JSON.stringify({ findings: [{ code: "confirmed", severity: "info", claim: "x", evidencePaths: [], detail: "ok" }], uncertainty: [] }) }; } });
    const result = await worker({ lane: "source", stage: "domain-design", objective: "x", artifactPaths: [artifact], evidenceRoots: [evidence], ...snapshotGroundingInputs([artifact], [evidence]), prompt: "inspect", tools: ["Read", "Grep", "Glob"], writesAllowed: false });
    expect(observed[observed.indexOf("--allowedTools") + 1]).toBe("");
    expect(observed.join(" ")).toContain("export const a = 1");
    expect(observed.join(" ")).toContain("# Design claim");
    expect(observed.join(" ")).not.toContain("Bash");
    expect(result.findings[0]?.code).toBe("confirmed");
    const path = join(root, "evidence", "result.json");
    persistGroundingEvidence(path, result);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(result);
  });
});
