import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { clefRunnerArgs, resolveDClef, resolveDModels } from "../d-config.ts";

const repo = join(import.meta.dir, "..", "..", "..");
beforeAll(() => {
  const result = spawnSync(process.execPath, [join(repo, "scripts", "package.ts"), "claude"], {
    cwd: repo,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}, 30_000);

describe("ordinary /aidlc D integration", () => {
  test("Claude projection carries the self-contained acceleration runtime", () => {
    const root = join(repo, "dist", "claude", ".claude", "tools", "d-acceleration");
    for (const file of [
      "aidlc-acceleration-plan.ts",
      "conductor.ts",
      "d-config.ts",
      "official-next-adapter.ts",
      "read-only-fanout.ts",
      "run.ts",
      "scheduler.ts",
      "stage-policy.json",
      "worker-adapters.ts",
    ]) expect(existsSync(join(root, file))).toBe(true);
    expect(readFileSync(join(root, "read-only-fanout.ts"), "utf8")).toContain('from "../aidlc-directive.ts"');
  });

  test("the ordinary skill invokes D automatically and preserves official fallback", () => {
    const skill = readFileSync(join(repo, "dist", "claude", ".claude", "skills", "aidlc", "SKILL.md"), "utf8");
    expect(skill).toContain(".claude/tools/d-acceleration/run.ts --project-dir \"$PWD\" --worker claude");
    expect(skill).not.toContain("--claude-fast opus --claude-balanced opus --claude-judgment opus");
    expect(skill).toContain(".claude/d-acceleration.local.json");
    expect(skill).toContain("If it returns `official-host-action-required`, continue below with the returned directive.");
    expect(skill).toContain("never mark a Unit complete from worker exit alone");
  });

  test("setup requires full installed runtime parity rather than partial updates", () => {
    const setup = readFileSync(join(repo, ".claude", "skills", "aidlc-setup", "SKILL.md"), "utf8");
    expect(setup).toContain("one indivisible directory, never as a selected-file patch");
    expect(setup).toContain("diff -qr");
    expect(setup).toContain("any missing, extra, or changed file");
  });

  test("ordinary routing honors explicit D project/local settings before Opus defaults", () => {
    const project = mkdtempSync(join(tmpdir(), "aidlc-d-models-"));
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude", "d-acceleration.json"), JSON.stringify({ models: { fast: "project-fast", balanced: "project-balanced" } }));
    writeFileSync(join(project, ".claude", "d-acceleration.local.json"), JSON.stringify({ models: { balanced: "local-balanced" } }));
    expect(resolveDModels(project)).toEqual({
      models: { fast: "project-fast", balanced: "local-balanced", judgment: "opus" },
      sources: { fast: "project", balanced: "local", judgment: "default" },
    });
    expect(resolveDModels(project, { fast: "cli-fast" }).models).toEqual({ fast: "cli-fast", balanced: "local-balanced", judgment: "opus" });
  });

  test("ordinary routing forwards only explicitly enabled loopback Clef and named low-risk Units", () => {
    const project = mkdtempSync(join(tmpdir(), "aidlc-d-clef-"));
    mkdirSync(join(project, ".claude"), { recursive: true });
    expect(clefRunnerArgs(resolveDClef(project))).toEqual([]);
    writeFileSync(join(project, ".claude", "d-acceleration.json"), JSON.stringify({ clef: { enabled: true, url: "http://127.0.0.1:18742", lowRiskUnits: ["web", "api"] } }));
    expect(clefRunnerArgs(resolveDClef(project))).toEqual(["--clef-url", "http://127.0.0.1:18742", "--clef-low-risk-units", "web,api"]);
    writeFileSync(join(project, ".claude", "d-acceleration.local.json"), JSON.stringify({ clef: { enabled: false } }));
    expect(clefRunnerArgs(resolveDClef(project))).toEqual([]);
    writeFileSync(join(project, ".claude", "d-acceleration.local.json"), JSON.stringify({ clef: { enabled: true, url: "http://example.com:18742" } }));
    expect(() => resolveDClef(project)).toThrow("loopback");
  });
});
