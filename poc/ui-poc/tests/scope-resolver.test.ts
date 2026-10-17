import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repo = join(import.meta.dir, "..", "..", "..");
const utility = join(repo, "core", "tools", "aidlc-utility.ts");

function resolver() {
  const root = mkdtempSync(join(tmpdir(), "aidlc-ui-scope-"));
  const scopes = join(root, "scopes");
  cpSync(join(repo, "core", "scopes"), scopes, { recursive: true });
  cpSync(join(repo, "poc", "ui-poc", "scopes", "ui-poc-application.md"), join(scopes, "ui-poc-application.md"));
  cpSync(join(repo, "poc", "ui-poc", "scopes", "ui-poc-comparison.md"), join(scopes, "ui-poc-comparison.md"));
  cpSync(join(repo, "poc", "ui-poc", "scopes", "ui-poc-requirements.md"), join(scopes, "ui-poc-requirements.md"));
  const grid = join(root, "scope-grid.json"); writeFileSync(grid, "{}\n");
  return (input: string) => {
    const env = { ...process.env, INPUT: input, AIDLC_SCOPES_DIR: scopes, AIDLC_SCOPE_GRID: grid };
    delete env.AIDLC_SCOPE_MAPPING;
    const result = spawnSync(process.execPath, ["-e", `import { inferScopeFromText } from ${JSON.stringify(utility)}; process.stdout.write(inferScopeFromText(process.env.INPUT).scope)`], {
      cwd: repo, encoding: "utf8", env,
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return result.stdout;
  };
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
  // Routing uses only the upstream core resolver (core/ is byte-identical to
  // AI-DLC v2.11.0): plugin scope keywords route short ASCII requests. Long
  // prose and Japanese text fall back to the stock default, and the person
  // picks the UI scope at the official scope confirmation or names it.
  test("routes a short English UI request through the plugin keywords", () => {
    const infer = resolver();
    expect(infer("Build a budget web app")).toBe("ui-poc-application");
    expect(infer("budget dashboard")).toBe("ui-poc-application");
    expect(infer("requirements-loop for budget planner")).toBe("ui-poc-requirements");
  });
  test("long or Japanese UI prose stays on the stock default (no core change for plugin specificity or CJK keywords)", () => {
    const infer = resolver();
    expect(infer("Build a household budget web app with monthly planning transaction tracking category summaries and a responsive interface")).toBe("classic");
    expect(infer("家計管理のWebアプリを作りたい")).toBe("classic");
    expect(infer("家計管理アプリの要件定義ループを回したい")).toBe("classic");
  });
  test("leaves non-UI and negated UI requests on the stock default", () => {
    const infer = resolver();
    expect(infer("Build a command line parser for monthly ledger imports")).toBe("classic");
    expect(infer("Build a command line tool, not a web app, for monthly ledger imports")).toBe("classic");
    expect(infer("WebアプリではなくCLIツールを作りたい")).toBe("classic");
    expect(infer("requirements only, no code")).toBe("classic");
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
