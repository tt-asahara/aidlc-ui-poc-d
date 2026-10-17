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
      "d-persistence-hook.ts",
      "d-persistence.ts",
      "d-feature-checks.ts",
      "grounding-runtime.ts",
      "generic-auto-cli.ts",
      "issue-ambiguity-assessor.ts",
      "issue-autopilot-cli.ts",
      "host-session.ts",
      "host-session-cli.ts",
      "host-stage-boundary.ts",
      "official-next-adapter.ts",
      "read-only-fanout.ts",
      "run.ts",
      "scheduler.ts",
      "stage-policy.json",
      "worker-adapters.ts",
    ]) expect(existsSync(join(root, file))).toBe(true);
    expect(readFileSync(join(root, "read-only-fanout.ts"), "utf8")).toContain('from "../aidlc-directive.ts"');
    expect(readFileSync(join(root, "host-stage-boundary.ts"), "utf8")).toContain('from "../aidlc-directive.ts"');
    const publicRunner = readFileSync(join(root, "run.ts"), "utf8");
    expect(publicRunner).toContain('join(import.meta.dir, "host-stage-boundary.ts")');
    expect(publicRunner).toContain('requires --directive-file');
    expect(publicRunner).toContain('"--model-fast", models.models.fast');
    expect(readFileSync(join(root, "d-acceleration.example.jsonc"), "utf8")).toBe(readFileSync(join(repo, "poc", "d-acceleration", "d-acceleration.example.jsonc"), "utf8"));
  });

  test("Claude runs D persistence after the official Bash graph rebuild", () => {
    const settings = JSON.parse(readFileSync(join(repo, "dist", "claude", ".claude", "settings.json"), "utf8"));
    const bash = settings.hooks.PostToolUse.find((group: { matcher: string }) => group.matcher === "Bash");
    expect(bash).toBeDefined();
    const commands = bash.hooks.map((hook: { command: string }) => hook.command);
    const rebuild = commands.findIndex((command: string) => command.includes("engine hook rebuild-stage-graph"));
    const persistence = commands.findIndex((command: string) => command.includes("tools/d-acceleration/d-persistence-hook.ts"));
    expect(rebuild).toBeGreaterThanOrEqual(0);
    expect(persistence).toBe(rebuild + 1);
  });

  test("the ordinary skill invokes D automatically and preserves official fallback", () => {
    const skill = readFileSync(join(repo, "dist", "claude", ".claude", "skills", "aidlc", "SKILL.md"), "utf8");
    expect(skill).toContain(".claude/tools/d-acceleration/run.ts --project-dir \"$PWD\" --worker claude");
    expect(skill).toContain("generic-auto-cli.ts start --project-dir \"$PWD\" --description-file");
    expect(skill).toContain("d-auto-request-<random>.txt");
    expect(skill).toContain("generic-auto-cli.ts init --project-dir \"$PWD\" --active-stages");
    expect(skill).toContain("generic-auto-cli.ts checkpoint --project-dir \"$PWD\" --directive-file");
    expect(skill).toContain("generic-auto-cli.ts action-start --project-dir \"$PWD\"");
    expect(skill).toContain("generic-auto-cli.ts action-finish --project-dir \"$PWD\" --action-token");
    expect(skill).toContain("Never pass the literal `--auto` to official `orchestrate next`");
    expect(skill).toContain("**Read-only research fanout (optional).**");
    expect(skill).toContain("--fanout-input <fanout-json>");
    expect(skill).toContain("the lead performs synthesis, writes every official artifact");
    expect(skill).not.toContain("--claude-fast opus --claude-balanced opus --claude-judgment opus");
    expect(skill).toContain(".claude/d-acceleration.local.jsonc");
    expect(skill).toContain("If it returns `official-host-action-required`, continue below with the returned directive.");
    expect(skill).toContain("never mark a Unit complete from worker exit alone");
    expect(skill).toContain("Optional D checks (default off)");
    expect(skill).toContain('it rejects `gate: "unresolved"`, asks, and invented or stale directives');
    expect(skill).toContain("never replace, waive, or reorder the C HTML evidence sensor");
  });

  test("Claude packages Issue autopilot without overriding standard /loop", () => {
    const skill = readFileSync(join(repo, "dist", "claude", ".claude", "skills", "aidlc-issue-autopilot", "SKILL.md"), "utf8");
    expect(skill).toContain("issue-autopilot-cli.ts");
    expect(skill).toContain("/loop 15m /aidlc-issue-autopilot");
    expect(existsSync(join(repo, "dist", "claude", ".claude", "skills", "loop", "SKILL.md"))).toBe(false);
  });

  test("setup requires full installed runtime parity rather than partial updates", () => {
    const setup = readFileSync(join(repo, ".claude", "skills", "aidlc-setup", "SKILL.md"), "utf8");
    expect(setup).toContain("one indivisible directory, never as a selected-file patch");
    expect(setup).toContain("diff -qr");
    expect(setup).toContain("any missing, extra, or changed file");
    expect(setup).toContain("skills/aidlc-issue-autopilot/SKILL.md");
  });

  test("setup composes the C payload inside the project without a shared marketplace", () => {
    const setup = readFileSync(join(repo, ".claude", "skills", "aidlc-setup", "SKILL.md"), "utf8");
    expect(setup).toContain('AIDLC_PROJECT_DIR="$PRODUCT"');
    expect(setup).toContain('AIDLC_PLUGIN_ROOT="$SRC/poc/ui-poc/dist/claude"');
    expect(setup).toContain('bun "$SRC/poc/ui-poc/dist/claude/hooks/compose.ts"');
    expect(setup).toContain("Run it twice");
    expect(setup).toContain("identical stage-graph and sidecar hashes");
    expect(setup).toContain("Do not add, remove, or repoint a Claude marketplace");
    expect(setup).not.toContain("/plugin marketplace add");
    expect(setup).not.toContain("/plugin install aidlc-ui-poc");
  });

  test("ordinary routing honors explicit D project/local settings before Opus defaults", () => {
    const project = mkdtempSync(join(tmpdir(), "aidlc-d-models-"));
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude", "d-acceleration.jsonc"), JSON.stringify({ models: { fast: "project-fast", balanced: "project-balanced" } }));
    writeFileSync(join(project, ".claude", "d-acceleration.local.jsonc"), JSON.stringify({ models: { balanced: "local-balanced" } }));
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
    writeFileSync(join(project, ".claude", "d-acceleration.jsonc"), JSON.stringify({ clef: { enabled: true, url: "http://127.0.0.1:18742", lowRiskUnits: ["web", "api"] } }));
    expect(clefRunnerArgs(resolveDClef(project))).toEqual(["--clef-url", "http://127.0.0.1:18742", "--clef-low-risk-units", "web,api"]);
    writeFileSync(join(project, ".claude", "d-acceleration.local.jsonc"), JSON.stringify({ clef: { enabled: false } }));
    expect(clefRunnerArgs(resolveDClef(project))).toEqual([]);
    writeFileSync(join(project, ".claude", "d-acceleration.local.jsonc"), JSON.stringify({ clef: { enabled: true, url: "http://example.com:18742" } }));
    expect(() => resolveDClef(project)).toThrow("loopback");
  });
});
