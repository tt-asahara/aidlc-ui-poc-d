// The ui-poc plugin on harnesses other than Claude (Kiro CLI, Kiro IDE, Codex):
// installed tools find their harness directory from their own location, the
// D configuration resolver ships with them, and the setup scripts pick or
// refuse a harness deterministically.
import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { D_CONFIG_HARNESSES, D_CONFIG_RUNTIME, dProjectionPath } from "../../d-acceleration/d-projection.ts";
import { productHarnessDir, SetupStop as DesignStop } from "../scripts/setup-design-skill.ts";
import { SetupStop, uiPocPaths } from "../scripts/setup-ui-poc.ts";

const repo = resolve(import.meta.dir, "..", "..", "..");
const accel = join(repo, "poc", "d-acceleration");
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = realpathSync(mkdtempSync(join(tmpdir(), "ui-poc-harness-"))); temps.push(dir); return dir; };
const routing = createRequire(import.meta.url)(join(repo, "poc", "ui-poc", "tools", "ui-poc-c-routing.cjs"));

/** The relative imports of d-config.ts, followed transitively. */
function importClosure(entry: string): string[] {
  const seen = new Set<string>(), todo = [entry];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(join(accel, file), "utf8");
    for (const m of text.matchAll(/(?:from\s+|import\(\s*)"\.\/([^"]+)"/g)) todo.push(m[1]!);
  }
  return [...seen].sort();
}

describe("harness directory from the installed location", () => {
  test("the routing tool names .kiro, .codex or .claude from <project>/<dir>/tools, and Claude from the source checkout", () => {
    expect(routing.harnessDirOf("/p/.kiro/tools")).toBe(".kiro");
    expect(routing.harnessDirOf("/p/.codex/tools")).toBe(".codex");
    expect(routing.harnessDirOf("/p/.claude/tools")).toBe(".claude");
    expect(routing.harnessDirOf(join(repo, "poc", "ui-poc", "tools"))).toBe(".claude");
  });

  test("the D resolver reads its configuration from the harness directory it is installed in", async () => {
    const project = temp();
    const installed = join(project, ".kiro", "tools", "d-acceleration");
    mkdirSync(installed, { recursive: true });
    for (const file of D_CONFIG_RUNTIME) cpSync(join(accel, file), join(installed, file));
    // The projected copy resolves the engine as a sibling; this unit test only needs the resolver itself.
    writeFileSync(join(installed, "native-runtime.ts"), readFileSync(join(accel, "native-runtime.ts"), "utf8").replace('"../../core/tools/aidlc-runtime-paths.ts"', `"${join(repo, "core", "tools", "aidlc-runtime-paths.ts")}"`));
    writeFileSync(join(project, ".kiro", "d-acceleration.jsonc"), '{ "uiDesign": { "refinedMockupSkill": "ponta-pass-design" } }\n');
    const mod = await import(pathToFileURL(join(installed, "d-config.ts")).href);
    expect(mod.dHarnessDir()).toBe(".kiro");
    expect(mod.resolveDUiDesign(project)).toEqual({ refinedMockupSkill: "ponta-pass-design" });
    const cli = spawnSync(process.execPath, [join(installed, "d-config.ts"), "print-ui-design", project], { encoding: "utf8" });
    expect(cli.status).toBe(0);
    expect(JSON.parse(cli.stdout)).toEqual({ refinedMockupSkill: "ponta-pass-design" });
  });

  test("the source resolver still serves Claude", async () => {
    const mod = await import(pathToFileURL(join(accel, "d-config.ts")).href);
    expect(mod.dHarnessDir()).toBe(".claude");
    expect(mod.dHarnessDir(pathToFileURL("/p/.codex/tools/d-acceleration/d-config.ts").href)).toBe(".codex");
  });
});

describe("D configuration resolver projection", () => {
  test("D_CONFIG_RUNTIME is exactly the import closure of d-config.ts", () => {
    expect([...D_CONFIG_RUNTIME].sort()).toEqual(importClosure("d-config.ts"));
  });

  for (const harness of D_CONFIG_HARNESSES) {
    const tree = join(repo, "dist", harness, harness === "codex" ? ".codex" : ".kiro");
    test.skipIf(!existsSync(tree))(`the built ${harness} tree carries the resolver and no other D runtime`, () => {
      for (const file of D_CONFIG_RUNTIME) expect(existsSync(join(tree, dProjectionPath(file)))).toBe(true);
      expect(existsSync(join(tree, "tools", "d-acceleration", "run.ts"))).toBe(false);
    });
  }
});

describe("setup harness selection", () => {
  test("design-skill setup uses the one harness directory that holds composed C UI tools, and asks when there are several", () => {
    const P = temp();
    expect(productHarnessDir(P)).toBe(".claude");
    mkdirSync(join(P, ".kiro", "tools"), { recursive: true });
    writeFileSync(join(P, ".kiro", "tools", "ui-poc-c-routing.cjs"), "");
    expect(productHarnessDir(P)).toBe(".kiro");
    mkdirSync(join(P, ".codex", "tools"), { recursive: true });
    writeFileSync(join(P, ".codex", "tools", "ui-poc-c-routing.cjs"), "");
    expect(() => productHarnessDir(P)).toThrow(/composed C UI tools in \.kiro and \.codex; name one with --harness-dir/);
    expect(productHarnessDir(P, ".codex")).toBe(".codex");
    expect(() => productHarnessDir(P, ".cursor")).toThrow(DesignStop);
  });

  test("ui-poc setup refuses Claude and unknown harnesses with the next step", () => {
    const P = temp();
    expect(() => uiPocPaths("claude", repo, P)).toThrow(/Claude uses poc\/d-acceleration\/fresh-install\.ts/);
    expect(() => uiPocPaths("cursor", repo, P)).toThrow(SetupStop);
    expect(() => uiPocPaths("kiro", "relative", P)).toThrow(/absolute paths/);
  });

  test("Kiro takes the plugin as a folder drop inside the product; Codex composes from the build", () => {
    const P = temp();
    for (const harness of ["kiro", "kiro-ide", "codex"]) {
      const built = join(repo, "dist", harness), plugin = join(repo, "poc", "ui-poc", "dist", harness);
      if (!existsSync(built) || !existsSync(plugin)) continue;
      const p = uiPocPaths(harness, repo, P);
      expect(p.pluginRoot).toBe(harness === "codex" ? p.builtPlugin : join(P, ".kiro", "aidlc-plugins", "ui-poc"));
      expect(dirname(p.dispatcher)).toBe(join(built, harness === "codex" ? ".codex" : ".kiro", "tools"));
    }
  });
});
