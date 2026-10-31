import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repo = join(import.meta.dir, "..", "..", "..");
const lib = join(repo, "core", "tools", "aidlc-lib.ts");

// Upstream AI-DLC v2.11.2 removed the engine's keyword classifier
// (`inferScopeFromText`): the agent reads the person's words and proposes one
// of the install's plans, and the person confirms it. What the agent reads is
// each plan's description and author hints from the scope metadata, so the UI
// scopes must reach that list with theirs.
function planMetadata() {
  const root = mkdtempSync(join(tmpdir(), "aidlc-ui-scope-"));
  const scopes = join(root, "scopes");
  cpSync(join(repo, "core", "scopes"), scopes, { recursive: true });
  cpSync(join(repo, "poc", "ui-poc", "scopes", "ui-poc-application.md"), join(scopes, "ui-poc-application.md"));
  cpSync(join(repo, "poc", "ui-poc", "scopes", "ui-poc-comparison.md"), join(scopes, "ui-poc-comparison.md"));
  cpSync(join(repo, "poc", "ui-poc", "scopes", "ui-poc-requirements.md"), join(scopes, "ui-poc-requirements.md"));
  const grid = join(root, "scope-grid.json"); writeFileSync(grid, "{}\n");
  const env = { ...process.env, AIDLC_SCOPES_DIR: scopes, AIDLC_SCOPE_GRID: grid };
  delete env.AIDLC_SCOPE_MAPPING;
  const result = spawnSync(process.execPath, ["-e", `import { loadScopeMetadata, validScopes } from ${JSON.stringify(lib)}; const m = loadScopeMetadata(); process.stdout.write(JSON.stringify({ scopes: [...validScopes()], meta: m }))`], {
    cwd: repo, encoding: "utf8", env,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout) as { scopes: string[]; meta: Record<string, { description?: string; keywords?: string[] }> };
}

function detectExplicitScope(scope: string, input: string) {
  const root = mkdtempSync(join(tmpdir(), "aidlc-ui-explicit-scope-"));
  const scopes = join(root, "scopes");
  cpSync(join(repo, "core", "scopes"), scopes, { recursive: true });
  cpSync(join(repo, "poc", "ui-poc", "scopes", "ui-poc-application.md"), join(scopes, "ui-poc-application.md"));
  cpSync(join(repo, "poc", "ui-poc", "scopes", "ui-poc-comparison.md"), join(scopes, "ui-poc-comparison.md"));
  cpSync(join(repo, "poc", "ui-poc", "scopes", "ui-poc-requirements.md"), join(scopes, "ui-poc-requirements.md"));
  const grid = join(root, "scope-grid.json"); writeFileSync(grid, "{}\n");
  const result = spawnSync(process.execPath, [
    join(repo, "dist", "claude", ".claude", "tools", "aidlc-utility.ts"),
    "detect-scope", "--project-dir", root, "--scope", scope, "--source", "cli", "--input", input,
  ], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, AIDLC_SCOPES_DIR: scopes, AIDLC_SCOPE_GRID: grid },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

describe("ordinary UI application scope resolver", () => {
  // Routing is the upstream core's (core/ is byte-identical to AI-DLC v2.11.2):
  // the agent proposes a plan from the install's plan list, and the person
  // confirms it or names another. No D or C code classifies the request.
  test("the UI scopes reach the plan list the agent proposes from, with their hints", () => {
    const { scopes, meta } = planMetadata();
    for (const scope of ["ui-poc-application", "ui-poc-comparison", "ui-poc-requirements"]) {
      expect(scopes).toContain(scope);
      expect(meta[scope]?.description ?? "").not.toBe("");
    }
    expect(meta["ui-poc-application"]?.keywords).toEqual(expect.arrayContaining(["web app", "dashboard"]));
  });
  test("stock plans stay on the list beside the UI scopes", () => {
    const { scopes } = planMetadata();
    for (const scope of ["classic", "feature", "poc", "bugfix"]) expect(scopes).toContain(scope);
  });
  test("explicit scope remains authoritative instead of consulting inference", () => {
    expect(detectExplicitScope("mvp", "Build a budget web app")).toEqual({
      emitted: "SCOPE_DETECTED",
      scope: "mvp",
      source: "cli",
      matches: [],
    });
  });
});
