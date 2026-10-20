import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { externalEnvironment } from "../execution.ts";
import { D_NATIVE_TOOLS, D_PROMPTED_TOOLS, nativeDAllow, nativeDInvocations } from "../native-commands.ts";

const repo = resolve(import.meta.dir, "../../..");
let root = "", artifact = "", project = "";
function run(args: string[], extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(artifact, args, { cwd: project, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, PATH: "", NO_COLOR: "1", AIDLC_PROJECT_DIR: project, CLAUDE_PROJECT_DIR: project, ...extra } });
}
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "aidlc-native-d-")));
  artifact = join(root, process.platform === "win32" ? "aidlc.exe" : "aidlc");
  project = join(root, "project with spaces"); mkdirSync(project);
  const source = join(repo, "dist-release/claude");
  cpSync(source, join(root, "runtime/claude"), { recursive: true });
  const built = spawnSync(process.execPath, ["build", join(source, ".claude/tools/d-acceleration/native-entry.ts"), "--compile", "--no-compile-autoload-bunfig", "--no-compile-autoload-dotenv", "--outfile", artifact], { encoding: "utf8", timeout: 120_000 });
  expect(built.status, built.stdout + built.stderr).toBe(0);
  const configured = run(["config", "--harness", "claude", "--project-dir", project, "--mcp", "none", "--quiet"]);
  expect(configured.status, configured.stdout + configured.stderr).toBe(0);
}, 150_000);
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

test("native D tools run with empty PATH and reenter the core without interpreting project scripts", () => {
  const status = run(["d", "generic-auto-cli", "status", "--project-dir", project]);
  expect(status.status, status.stdout + status.stderr).toBe(0);
  expect(JSON.parse(status.stdout).active).toBe(false);
  const module = join(project, ".claude/tools/d-acceleration/generic-auto-cli.ts");
  writeFileSync(module, 'throw new Error("project D module must not run");\n');
  // Neither project Bun config nor .env may preload code into the embedded runtime.
  const marker = join(root, "preload-ran");
  writeFileSync(join(project, "preload.ts"), `await Bun.write(${JSON.stringify(marker)}, "bad");\n`);
  writeFileSync(join(project, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
  writeFileSync(join(project, ".env"), 'BUN_OPTIONS="--preload ./preload.ts"\n');
  const again = run(["d", "generic-auto-cli", "status", "--project-dir", project]);
  expect(again.status, again.stdout + again.stderr).toBe(0);
  expect(existsSync(marker)).toBe(false);
  const request = join(project, ".aidlc-engine/d-auto-request-native.txt");
  mkdirSync(join(project, ".aidlc-engine"), { recursive: true });
  writeFileSync(join(project, ".claude/d-acceleration.local.jsonc"), JSON.stringify({ auto: { enabled: true, sessionOnly: false } }));
  writeFileSync(request, "Fix the order parser");
  const started = run(["d", "generic-auto-cli", "start", "--project-dir", project, "--description-file", request]);
  expect(started.status, started.stdout + started.stderr).toBe(0);
  expect(existsSync(request)).toBe(false);
  expect(JSON.parse(started.stdout).directive.kind).toBeDefined();
  const unknown = run(["d", "../../project/preload"]);
  expect(unknown.status).toBe(1);
  expect(unknown.stderr).toContain("unknown D tool");
  expect(existsSync(marker)).toBe(false);
});

test("native D commands have bounded permissions and GitHub tools remain individually prompted", () => {
  const settings = JSON.parse(readFileSync(join(repo, "dist-release/claude/.claude/settings.json"), "utf8"));
  const allow: string[] = settings.permissions.allow;
  expect(allow).toContain("Bash(aidlc engine *)");
  expect(allow).not.toContain("Bash(aidlc *)");
  expect(allow).not.toContain("Bash(aidlc d *)");
  for (const name of D_PROMPTED_TOOLS) {
    expect(allow.some(rule => rule.startsWith(`Bash(aidlc d ${name}`))).toBe(false);
    expect(nativeDAllow(`Bash(aidlc d ${name} *)`)).toBeNull();
  }
  for (const name of Object.keys(D_NATIVE_TOOLS).filter(name => !D_PROMPTED_TOOLS.has(name)))
    expect(allow).toContain(`Bash(aidlc d ${name} *)`);
  expect(nativeDInvocations("bun .claude/tools/d-acceleration/run.ts --preflight", ".claude")).toBe("aidlc d run --preflight");
  expect(nativeDInvocations("bun Xclaude/tools/d-acceleration/run.ts", ".claude")).toBe("bun Xclaude/tools/d-acceleration/run.ts");
  for (const dir of [".claude", ".foo"]) expect(nativeDInvocations(`bun ${dir}/tools/d-acceleration/design-document.ts doc-manifest`, ".foo")).toBe("aidlc d design-document doc-manifest");
  expect(externalEnvironment({ BUN_BE_BUN: "1", KEEP: "yes" })).toEqual({ KEEP: "yes" });
});
