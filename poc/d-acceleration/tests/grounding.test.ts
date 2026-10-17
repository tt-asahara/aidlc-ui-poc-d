import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planGrounding, runGrounding, type GroundingTask } from "../grounding.ts";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "d-grounding-")); roots.push(root);
  mkdirSync(join(root, "record"), { recursive: true }); mkdirSync(join(root, "src")); mkdirSync(join(root, "spec"));
  writeFileSync(join(root, "record", "decisions.md"), "uses /v1/orders\n");
  writeFileSync(join(root, "src", "orders.ts"), "export const route = '/v1/orders';\n");
  writeFileSync(join(root, "spec", "api.md"), "GET /v1/orders\n");
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("D source/spec grounding", () => {
  test("both lanes default OFF without invoking a worker or creating output", async () => {
    const projectDir = fixture(); let calls = 0;
    for (const lane of ["source", "spec"] as const) {
      const result = await runGrounding({ lane, stage: "domain-design", projectDir, artifactPaths: ["record/decisions.md"], config: {}, worker: async () => { calls++; return { findings: [], uncertainty: [] }; } });
      expect(result).toMatchObject({ action: "disabled", workerCalls: 0, artifactsWritten: 0, reviewsRun: 0 });
    }
    expect(calls).toBe(0);
  });

  test("source grounding is limited to domain-design and bounded project paths", () => {
    const projectDir = fixture();
    expect(planGrounding({ lane: "source", stage: "functional-design", projectDir, artifactPaths: ["record/decisions.md"], config: { sourceGrounding: { enabled: true, roots: ["src"] } } })).toEqual({ action: "not-applicable" });
    expect(planGrounding({ lane: "source", stage: "domain-design", projectDir, artifactPaths: ["record/decisions.md"], config: { sourceGrounding: { enabled: true, roots: ["../"] } } })).toMatchObject({ action: "off-no-valid-roots", rejectedRoots: [{ root: "../", reason: expect.stringContaining("escapes project") }] });
  });

  test("spec grounding applies to domain, functional, and code stages", () => {
    const projectDir = fixture();
    for (const stage of ["domain-design", "functional-design", "code-generation"] as const) {
      const task = planGrounding({ lane: "spec", stage, projectDir, artifactPaths: ["record/decisions.md"], config: { specGrounding: { enabled: true, roots: ["spec"] } } }) as GroundingTask;
      expect(task).toMatchObject({ lane: "spec", stage, tools: ["Read", "Grep", "Glob"], writesAllowed: false });
      expect(task.prompt).toContain("Never infer, create, or report human approval");
    }
  });

  test("returns structured findings and exact canonical evidence paths", async () => {
    const projectDir = fixture();
    const result = await runGrounding({
      lane: "source", stage: "domain-design", projectDir, artifactPaths: ["record/decisions.md"],
      config: { sourceGrounding: { enabled: true, roots: ["src"] } },
      worker: async () => ({ findings: [{ code: "confirmed", severity: "info", claim: "orders route exists", evidencePaths: ["src/orders.ts"], detail: "literal route matches" }], uncertainty: ["runtime middleware was not executed"] }),
    });
    expect(result).toMatchObject({ action: "grounding-findings", verdict: "NOT-READY", workerCalls: 1, artifactsWritten: 0, reviewsRun: 0, approvalRecorded: false });
    if (result.action === "grounding-findings") expect(result.findings[0]?.evidencePaths[0]).toBe(realpathSync(join(projectDir, "src", "orders.ts")));
  });

  test("fails closed for an empty result and rejects evidence-free assertions", async () => {
    const projectDir = fixture();
    const base = { lane: "spec" as const, stage: "domain-design" as const, projectDir, artifactPaths: ["record/decisions.md"], config: { specGrounding: { enabled: true, roots: ["spec"] } } };
    const empty = await runGrounding({ ...base, worker: async () => ({ findings: [], uncertainty: [] }) });
    expect(empty).toMatchObject({ action: "grounding-findings", verdict: "NOT-READY", findings: [] });
    await expect(runGrounding({ ...base, worker: async () => ({ findings: [{ code: "confirmed", severity: "info", claim: "route exists", evidencePaths: [], detail: "asserted without a source" }], uncertainty: [] }) })).rejects.toThrow("requires at least one evidence path");
    await expect(runGrounding({ ...base, worker: async () => ({ findings: [{ code: "refuted", severity: "warn", claim: "route absent", evidencePaths: [], detail: "asserted without a source" }], uncertainty: [] }) })).rejects.toThrow("requires at least one evidence path");
  });

  test("accepts a fully evidenced finding as READY", async () => {
    const projectDir = fixture();
    const result = await runGrounding({ lane: "spec", stage: "domain-design", projectDir, artifactPaths: ["record/decisions.md"], config: { specGrounding: { enabled: true, roots: ["spec"] } }, worker: async () => ({ findings: [{ code: "confirmed", severity: "info", claim: "orders endpoint is specified", evidencePaths: ["spec/api.md"], detail: "the endpoint is present literally" }], uncertainty: [] }) });
    expect(result).toMatchObject({ action: "grounding-findings", verdict: "READY" });
  });

  test("an evidenced refutation is NOT-READY regardless of advisory severity", async () => {
    const projectDir = fixture();
    for (const severity of ["info", "warn"] as const) {
      const result = await runGrounding({ lane: "spec", stage: "domain-design", projectDir, artifactPaths: ["record/decisions.md"], config: { specGrounding: { enabled: true, roots: ["spec"] } }, worker: async () => ({ findings: [{ code: "refuted", severity, claim: "artifact claims POST", evidencePaths: ["spec/api.md"], detail: "the specification only defines GET" }], uncertainty: [] }) });
      expect(result).toMatchObject({ action: "grounding-findings", verdict: "NOT-READY" });
    }
  });

  test("rejects fabricated approval and evidence outside configured project", async () => {
    const projectDir = fixture();
    await expect(runGrounding({ lane: "spec", stage: "domain-design", projectDir, artifactPaths: ["record/decisions.md"], config: { specGrounding: { enabled: true, roots: ["spec"] } }, worker: async () => ({ findings: [], uncertainty: [], approval: "approved" }) })).rejects.toThrow("must not create or claim approval");
    await expect(runGrounding({ lane: "spec", stage: "domain-design", projectDir, artifactPaths: ["record/decisions.md"], config: { specGrounding: { enabled: true, roots: ["spec"] } }, worker: async () => ({ findings: [{ code: "refuted", severity: "error", claim: "x", evidencePaths: ["../"], detail: "x" }], uncertainty: [] }) })).rejects.toThrow("escapes project");
    await expect(runGrounding({ lane: "spec", stage: "domain-design", projectDir, artifactPaths: ["record/decisions.md"], config: { specGrounding: { enabled: true, roots: ["spec"] } }, worker: async () => ({ findings: [{ code: "refuted", severity: "error", claim: "x", evidencePaths: ["src/orders.ts"], detail: "x" }], uncertainty: [] }) })).rejects.toThrow("outside configured roots or the grounding snapshot");
  });

  test("rejects directories and symlinks as confirmed/refuted evidence", async () => {
    const projectDir = fixture();
    symlinkSync(join(projectDir, "spec", "api.md"), join(projectDir, "spec", "api-link.md"));
    const base = { lane: "spec" as const, stage: "domain-design" as const, projectDir, artifactPaths: ["record/decisions.md"], config: { specGrounding: { enabled: true, roots: ["spec"] } } };
    for (const evidencePath of ["spec", "spec/api-link.md"]) {
      await expect(runGrounding({ ...base, worker: async () => ({ findings: [{ code: "confirmed", severity: "info", claim: "orders endpoint exists", evidencePaths: [evidencePath], detail: "claimed evidence" }], uncertainty: [] }) })).rejects.toThrow(/not a regular non-symlinked file|traverses a symlink|contains a symlink/);
    }
  });
});
