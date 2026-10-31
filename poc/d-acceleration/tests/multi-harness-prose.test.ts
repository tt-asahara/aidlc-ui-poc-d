// D's orchestrator module and host permissions on every harness that carries
// the D runtime: each orchestrator skill points at the one shared module, the
// module is projected with that harness's own paths, and the host allows
// exactly D's unprompted tools (the same set Claude's settings allow).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { D_ALLOWED_PLUGIN_TOOLS, D_HOST_ALLOWED_TOOLS, dAllowedCommands } from "../d-permissions.ts";
import { D_HARNESSES } from "../d-projection.ts";

const repo = join(import.meta.dir, "..", "..", "..");
const dirOf = (harness: string) => harness === "claude" ? ".claude" : harness === "codex" ? ".codex" : ".kiro";
const skillOf = (root: string, harness: string) => join(repo, root, harness, harness === "codex" ? ".agents" : dirOf(harness), "skills", "aidlc", "SKILL.md");

describe("orchestrator skill and shared D module", () => {
  for (const harness of ["claude", ...D_HARNESSES]) {
    const skill = skillOf("dist", harness), module = join(repo, "dist", harness, dirOf(harness), "tools", "d-acceleration", "orchestrator-d.md");
    test.skipIf(!existsSync(skill))(`${harness}: the skill points at the module, which carries this harness's paths`, () => {
      const text = readFileSync(skill, "utf8");
      expect(text).toContain(`${dirOf(harness)}/tools/d-acceleration/orchestrator-d.md\` exists, read it once now`);
      expect(text).toContain("first apply `orchestrator-d.md`'s `invoke-swarm` guard");
      const body = readFileSync(module, "utf8");
      expect(body).toContain(`bun ${dirOf(harness)}/tools/d-acceleration/generic-auto-cli.ts start --project-dir <PRODUCT>`);
      expect(body).not.toContain("{{");
      expect(body).not.toContain("--worker claude");
      for (const other of [".claude/", ".kiro/", ".codex/"].filter((dir) => dir !== `${dirOf(harness)}/`)) expect(body).not.toContain(`bun ${other}tools`);
    });
  }
});

describe("host permissions for D's tools", () => {
  test("the unprompted set is every native D tool except the ones that publish", () => {
    expect(D_HOST_ALLOWED_TOOLS).toContain("run");
    expect(D_HOST_ALLOWED_TOOLS).not.toContain("issue-autopilot-cli");
    expect(D_HOST_ALLOWED_TOOLS).not.toContain("decision-issue-summary");
  });

  test("Claude's authored settings allow exactly the generated set", () => {
    const allow = (JSON.parse(readFileSync(join(repo, "harness", "claude", "settings.json"), "utf8")).permissions.allow as string[])
      .filter((rule) => /d-acceleration\/|pr-lens-review\.ts|ui-poc-[a-z-]+\.cjs/.test(rule));
    expect(allow.sort()).toEqual(dAllowedCommands(".claude", false).map((words) => `Bash(${words.join(" ")} *)`).sort());
  });

  for (const root of ["dist", "dist-release"]) {
    const native = root === "dist-release";
    test.skipIf(!existsSync(join(repo, root, "kiro")))(`${root}: Kiro CLI, Kiro IDE, and Codex allow D's commands in their own format`, () => {
      const kiro = JSON.parse(readFileSync(join(repo, root, "kiro", ".kiro", "agents", "aidlc.json"), "utf8")).toolsSettings.execute_bash.allowedCommands as string[];
      const ide = readFileSync(join(repo, root, "kiro-ide", ".kiro", "agents", "aidlc-aidlc.md"), "utf8");
      const codex = readFileSync(join(repo, root, "codex", ".codex", "rules", "default.rules"), "utf8");
      for (const name of D_HOST_ALLOWED_TOOLS) {
        const words = native ? `aidlc d ${name}` : `bun .kiro/tools/d-acceleration/${name}.ts`;
        expect(kiro.some((pattern) => new RegExp(`^${pattern}$`).test(`${words} --project-dir /p`))).toBe(true);
        expect(ide).toContain(`- "${words} *"`);
        expect(codex).toContain(native ? JSON.stringify(name) : JSON.stringify(`.codex/tools/d-acceleration/${name}.ts`));
      }
      expect(kiro.some((pattern) => new RegExp(`^${pattern}$`).test("bun .kiro/tools/d-acceleration/issue-autopilot-cli.ts --project-dir /p"))).toBe(false);
      if (!native) for (const file of D_ALLOWED_PLUGIN_TOOLS) expect(ide).toContain(`- "bun .kiro/tools/${file} *"`);
      expect(ide.match(/BEGIN AI-DLC D permissions/g)?.length).toBe(1);
      expect(codex.match(/BEGIN AI-DLC D permissions/g)?.length).toBe(1);
    });
  }
});
