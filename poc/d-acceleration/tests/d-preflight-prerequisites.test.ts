import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkDPrerequisites, resolveDConfig, resolveDGitPersistence } from "../d-config.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

// A product with the files preflight requires from the composed C baseline.
function product(): string {
  const root = mkdtempSync(join(tmpdir(), "d-preflight-")); roots.push(root);
  for (const rel of [".claude/tools/aidlc-orchestrate.ts", ".claude/sensors/aidlc-ui-poc-evidence.md", ".claude/tools/ui-poc/c-stage-routing.json", ".claude/tools/data/plugin-contrib-ui-poc.json", ".claude/tools/data/plugin-files-ui-poc.json"]) {
    mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), "{}\n");
  }
  return root;
}

const ALL_ON = (extra: { roots?: boolean; labels?: boolean; repository?: boolean } = {}) => JSON.stringify({
  parallel: { enabled: true },
  constructionDefaults: { iteration: "stage-major", execution: "swarm" },
  gitPersistence: { enabled: true, push: true, remote: "origin", branch: "main" },
  features: { requirementIdValidation: true, functionalDesignDocumentDiscipline: true, sourceGrounding: true, specGrounding: true, mockupPngGeneration: true, visualRegression: true },
  featureInputs: { sourceRoots: extra.roots ? ["src"] : [], specRoots: extra.roots ? ["spec"] : [] },
  auto: { enabled: true, through: "requirements-analysis", sessionOnly: false, labelAllowlist: extra.labels ? ["aidlc-auto"] : [] },
  issueAutopilot: { enabled: true, oneIssuePerRun: true },
  aiApproval: { mode: "stage-gates", minConfidence: 0.9 },
  decisionIssueSummary: { enabled: true, ...(extra.repository ? { repository: "owner/repo" } : {}), send: true },
});

const preflight = (root: string, env: Record<string, string> = {}) => {
  const result = spawnSync(process.execPath, [join(import.meta.dir, "..", "run.ts"), "--project-dir", root, "--preflight"], { cwd: root, encoding: "utf8", env: { ...process.env, AIDLC_GH_EXECUTABLE_PATH: "", AIDLC_GH_EXECUTABLE_SHA256: "", ...env } });
  return { status: result.status, json: JSON.parse(result.stdout) as Record<string, any> };
};

describe("D preflight prerequisites and effective values", () => {
  test("all-OFF defaults have nothing to satisfy and display the runtime-resolved values", () => {
    const root = product();
    expect(checkDPrerequisites(root, {})).toEqual([]);
    const { status, json } = preflight(root);
    expect(status).toBe(0);
    expect(json.optional).toEqual({ ...resolveDConfig(root), gitPersistence: resolveDGitPersistence(root) });
    expect(json.optional.featureInputs.groundingLimits).toEqual({ maxEvidenceFiles: 200, maxInputBytes: 1_000_000 });
    expect(json.prerequisites).toEqual({ checked: [], unmet: [] });
  });

  test("preflight shows the effective grounding caps after local-over-project layering", () => {
    const root = product();
    writeFileSync(join(root, ".claude", "d-acceleration.jsonc"), JSON.stringify({ featureInputs: { groundingLimits: { maxEvidenceFiles: 1000, maxInputBytes: 2_000_000 } } }));
    writeFileSync(join(root, ".claude", "d-acceleration.local.jsonc"), JSON.stringify({ featureInputs: { groundingLimits: { maxInputBytes: 3_000_000 } } }));
    const { status, json } = preflight(root);
    expect(status).toBe(0);
    expect(json.optional.featureInputs.groundingLimits).toEqual({ maxEvidenceFiles: 1000, maxInputBytes: 3_000_000 });
    writeFileSync(join(root, ".claude", "d-acceleration.local.jsonc"), JSON.stringify({ featureInputs: { groundingLimits: { maxInputBytes: 20_000_000 } } }));
    const invalid = spawnSync(process.execPath, [join(import.meta.dir, "..", "run.ts"), "--project-dir", root, "--preflight"], { cwd: root, encoding: "utf8" });
    expect(invalid.status).toBe(2);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toMatch(/^D configuration invalid: invalid featureInputs\.groundingLimits\.maxInputBytes: 20000000 \(allowed: integer 1\.\.4000000\) in \S+d-acceleration\.local\.jsonc\n$/);
  });

  test("all-ON with missing prerequisites names each unmet requirement and exits 3", () => {
    const root = product();
    writeFileSync(join(root, ".claude", "d-acceleration.jsonc"), ALL_ON());
    const { status, json } = preflight(root);
    expect(status).toBe(3);
    expect(json.optional).toEqual({ ...resolveDConfig(root), gitPersistence: resolveDGitPersistence(root) });
    expect(json.prerequisites.unmet.map((row: { setting: string; requires: string }) => `${row.setting}: ${row.requires}`).sort()).toEqual([
      "decisionIssueSummary.enabled: decisionIssueSummary.repository is owner/name",
      "decisionIssueSummary.send: host env AIDLC_GH_EXECUTABLE_PATH and AIDLC_GH_EXECUTABLE_SHA256 are set",
      "features.sourceGrounding: featureInputs.sourceRoots is non-empty",
      "features.specGrounding: featureInputs.specRoots is non-empty",
      "gitPersistence.enabled: PRODUCT is a Git repository",
      "gitPersistence.push: Git remote \"origin\" exists",
      "issueAutopilot.enabled: auto.labelAllowlist is non-empty",
    ]);
  });

  test("a non-default uiDesign.refinedMockupSkill requires the composed routing tool and the pinned install", () => {
    const root = product();
    writeFileSync(join(root, ".claude", "d-acceleration.jsonc"), JSON.stringify({ uiDesign: { refinedMockupSkill: "impeccable" } }));
    const row = () => checkDPrerequisites(root, {}).filter((r) => r.setting === "uiDesign.refinedMockupSkill");
    expect(row()).toEqual([{ setting: "uiDesign.refinedMockupSkill", requires: expect.stringContaining("composed C UI contract (.claude/tools/ui-poc-c-routing.cjs) is missing"), satisfied: false }]);
    const tools = join(import.meta.dir, "..", "..", "ui-poc", "tools");
    cpSync(join(tools, "ui-poc-c-routing.cjs"), join(root, ".claude/tools/ui-poc-c-routing.cjs"));
    cpSync(join(tools, "ui-poc"), join(root, ".claude/tools/ui-poc"), { recursive: true });
    expect(row()[0]!.satisfied).toBe(false);
    expect(row()[0]!.requires).toContain("Installed entrypoint is missing: .agents/skills/impeccable/SKILL.md; run: bun <D checkout>/poc/ui-poc/scripts/setup-design-skill.ts --product <PRODUCT> --skill impeccable");
    writeFileSync(join(root, ".claude", "d-acceleration.jsonc"), JSON.stringify({ uiDesign: { refinedMockupSkill: "taste-skill" } }));
    expect(row()[0]!.requires).toContain("Unknown uiDesign.refinedMockupSkill: taste-skill (choices: impeccable-historical, impeccable, ui-ux-pro-max, ponta-pass-design)");
    const { status, json } = preflight(root);
    expect(status).toBe(3);
    expect(json.optional.uiDesign).toEqual({ refinedMockupSkill: "taste-skill" });
  });

  test("all-ON with every prerequisite satisfied passes and reports each checked row", () => {
    const root = product();
    const remote = mkdtempSync(join(tmpdir(), "d-preflight-remote-")); roots.push(remote);
    expect(spawnSync("git", ["init", "-q", "--bare", remote]).status).toBe(0);
    expect(spawnSync("git", ["init", "-q", root]).status).toBe(0);
    expect(spawnSync("git", ["-C", root, "remote", "add", "origin", remote]).status).toBe(0);
    writeFileSync(join(root, ".claude", "d-acceleration.jsonc"), ALL_ON({ roots: true, labels: true, repository: true }));
    const { status, json } = preflight(root, { AIDLC_GH_EXECUTABLE_PATH: "/usr/bin/false", AIDLC_GH_EXECUTABLE_SHA256: "0".repeat(64) });
    expect(json.prerequisites.unmet).toEqual([]);
    expect(status).toBe(0);
    expect(json.prerequisites.checked.length).toBeGreaterThanOrEqual(13);
    expect(json.optional.constructionDefaults).toEqual({ iteration: "stage-major", execution: "swarm" });
    expect(json.optional.gitPersistence).toEqual({ enabled: true, push: true, remote: "origin", branch: "main" });
  });

  test("a missing composed C contract is reported for the UI switches that need it", () => {
    const root = product();
    rmSync(join(root, ".claude", "tools", "ui-poc"), { recursive: true });
    writeFileSync(join(root, ".claude", "d-acceleration.jsonc"), JSON.stringify({ features: { requirementIdValidation: true } }));
    expect(checkDPrerequisites(root, {})).toEqual([{ setting: "features.requirementIdValidation", requires: "composed C UI contract (.claude/tools/ui-poc/c-stage-routing.json)", satisfied: false }]);
    expect(preflight(root).status).toBe(2);
  });
});
