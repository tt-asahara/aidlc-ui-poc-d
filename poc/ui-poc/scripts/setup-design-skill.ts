#!/usr/bin/env bun
// Opt-in install of an optional refined-mockups design skill into an installed D PRODUCT.
//
//   bun poc/ui-poc/scripts/setup-design-skill.ts --product /abs/PRODUCT --skill <id> [--dry-run]
//
// Run from the D source checkout (SRC) after PRODUCT has this checkout's
// composed C UI tools (poc/d-acceleration/fresh-install.ts install|update).
// Steps, each failing closed with a one-line reason:
//   1. PRODUCT's installed routing tool, routing config, and design-skill lock
//      equal SRC's, so the sensor checks exactly the pins installed here.
//   2. The choice's repository is fetched at exactly its pinned commit into a
//      temporary checkout; symlinks and submodules in the skill are refused,
//      and the licence files must equal the pinned bytes.
//   3. The skill directory and licences are copied into PRODUCT/.agents/skills
//      without clobbering: identical files are kept, any differing or extra
//      file stops the setup. Every copied file is checked against its Git blob.
//   4. The routing tool's own install check (designSkillStatus) must pass.
// It never changes uiDesign.refinedMockupSkill: choosing the skill stays the
// person's decision in .claude/d-acceleration(.local).jsonc.
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export class SetupStop extends Error {}
const SRC_TOOLS = resolve(import.meta.dir, "..", "tools");
const ROUTING_FILES = ["ui-poc-c-routing.cjs", "ui-poc/c-stage-routing.json", "ui-poc/design-skill-lock.json"];

type Routing = {
  load(): { skills: Record<string, { repository: string; commit: string }> };
  designChoice(cfg: unknown, id: string): { id: string; skill: string; install: null | { sourceDir: string; installDir: string; licenses: Array<{ from: string; to: string }> } };
  lockedSource(skill: unknown): null | { license: string; licenseFiles?: Array<{ path: string; git_blob_sha: string; sha256: string }> };
  designSkillStatus(id: string, projectRoot: string): { ok: boolean; detail?: string };
  gitBlobHash(bytes: Buffer): string;
};
export type SetupOptions = { dryRun?: boolean; srcTools?: string; fetchUrl?: (repository: string) => string };

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function must(args: string[], cwd: string, label: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new SetupStop(`${label} failed: ${(result.stderr || result.stdout || "").trim().split("\n").slice(-3).join(" | ")}`);
  return result.stdout;
}
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => { for (const name of readdirSync(d).sort()) { const full = join(d, name); const stat = lstatSync(full); if (stat.isDirectory()) walk(full); else out.push(relative(dir, full).split(sep).join("/")); } };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** Place one pinned file without clobbering; returns whether it was added. */
function place(from: string, to: string, executable: boolean): boolean {
  if (existsSync(to)) {
    if (!lstatSync(to).isFile() || sha256(readFileSync(to)) !== sha256(readFileSync(from))) throw new SetupStop(`${to} exists and differs from the pinned file (never merged or overwritten); move it away and rerun`);
    return false;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  if (executable) chmodSync(to, 0o755);
  return true;
}

export function setupDesignSkill(product: string, id: string, options: SetupOptions = {}) {
  if (!isAbsolute(product) || !existsSync(product)) throw new SetupStop("--product must be an existing absolute PRODUCT path");
  if (!id) throw new SetupStop("--skill <id> is required");
  const P = realpathSync(product), installedTools = join(P, ".claude", "tools"), srcTools = options.srcTools ?? SRC_TOOLS;
  for (const rel of ROUTING_FILES) {
    const installed = join(installedTools, rel);
    if (!existsSync(installed)) throw new SetupStop(`PRODUCT has no composed C UI routing with design-skill selection (${rel}); install or update D first (poc/d-acceleration/fresh-install.ts)`);
    if (sha256(readFileSync(installed)) !== sha256(readFileSync(join(srcTools, rel)))) throw new SetupStop(`PRODUCT's installed ${rel} differs from this D checkout; update D first (poc/d-acceleration/fresh-install.ts update)`);
  }
  const routing = createRequire(import.meta.url)(join(installedTools, "ui-poc-c-routing.cjs")) as Routing;
  const cfg = routing.load();
  let choice: ReturnType<Routing["designChoice"]>;
  try { choice = routing.designChoice(cfg, id); } catch (error) { throw new SetupStop((error as Error).message); }
  const next = `uiDesign.refinedMockupSkill is unchanged; set it to "${choice.id}" in .claude/d-acceleration.local.jsonc or .claude/d-acceleration.jsonc to use it (ui-poc-comparison always keeps the Arm C default)`;
  if (!choice.install) {
    const status = routing.designSkillStatus(choice.id, P);
    return { mode: options.dryRun ? "dry-run" : "apply", skill: choice.id, ready: status.ok, ...(status.ok ? {} : { detail: status.detail }), note: "the default design skill is the Arm C payload placed by D setup; nothing to fetch" };
  }
  const skill = cfg.skills[choice.skill]!, source = routing.lockedSource(skill);
  if (!source) throw new SetupStop(`no pinned lock record for ${skill.repository}@${skill.commit}`);
  const install = choice.install;
  const plan = { product: P, skill: choice.id, repository: (options.fetchUrl ?? ((r: string) => `https://github.com/${r}.git`))(skill.repository), commit: skill.commit, license: source.license, from: install.sourceDir, to: install.installDir, licenses: install.licenses.map((l) => l.to) };
  if (options.dryRun) return { mode: "dry-run", ...plan, alreadyInstalled: routing.designSkillStatus(choice.id, P).ok, switch: next };

  const work = mkdtempSync(join(tmpdir(), "ui-poc-design-skill-"));
  try {
    must(["init", "-q", work], tmpdir(), "git init");
    must(["-C", work, "fetch", "-q", "--depth", "1", plan.repository, skill.commit], work, `fetch ${skill.repository}@${skill.commit}`);
    must(["-C", work, "-c", "advice.detachedHead=false", "checkout", "-q", "--detach", skill.commit], work, "checkout pinned commit");
    if (must(["-C", work, "rev-parse", "HEAD"], work, "rev-parse").trim() !== skill.commit) throw new SetupStop(`fetched checkout is not at the pin ${skill.commit}`);
    const tree = must(["-C", work, "ls-tree", "-r", "-z", skill.commit, "--", install.sourceDir], work, "ls-tree").split("\0").filter(Boolean).map((line) => {
      const [meta, path] = line.split("\t") as [string, string];
      const [mode, , blob] = meta.split(" ") as [string, string, string];
      return { mode, blob, path };
    });
    if (!tree.length) throw new SetupStop(`${install.sourceDir} is empty at ${skill.repository}@${skill.commit}`);
    const unsafe = tree.find((entry) => entry.mode !== "100644" && entry.mode !== "100755");
    if (unsafe) throw new SetupStop(`pinned skill contains a symlink or submodule (${unsafe.path}); refusing to install it`);
    for (const entry of tree) if (routing.gitBlobHash(readFileSync(join(work, entry.path))) !== entry.blob) throw new SetupStop(`checked-out ${entry.path} does not match its pinned Git blob`);
    const pinnedLicenses = source.licenseFiles ?? [];
    for (const license of install.licenses) {
      const pinned = pinnedLicenses.find((x) => x.path === license.from), file = join(work, license.from);
      if (!pinned || !existsSync(file) || sha256(readFileSync(file)) !== pinned.sha256) throw new SetupStop(`${license.from} at the pin is not the recorded ${source.license} licence`);
    }
    const target = join(P, install.installDir), expected = new Set(tree.map((entry) => entry.path.slice(install.sourceDir.length + 1)));
    const extra = filesUnder(target).filter((rel) => !expected.has(rel));
    if (extra.length) throw new SetupStop(`${install.installDir} has files that are not in the pinned skill (never merged or overwritten): ${extra.slice(0, 5).join(", ")}; move it away and rerun`);
    let added = 0, identical = 0;
    for (const entry of tree) place(join(work, entry.path), join(target, entry.path.slice(install.sourceDir.length + 1)), entry.mode === "100755") ? added++ : identical++;
    for (const license of install.licenses) place(join(work, license.from), join(P, license.to), false) ? added++ : identical++;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const status = routing.designSkillStatus(choice.id, P);
  if (!status.ok) throw new SetupStop(`design skill is not ready after setup: ${status.detail}`);
  return { mode: "apply", ...plan, files: filesUnder(join(P, install.installDir)).length, ready: true, switch: next };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag: string) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] ?? "" : ""; };
  try {
    process.stdout.write(`${JSON.stringify(setupDesignSkill(value("--product"), value("--skill"), { dryRun: args.includes("--dry-run") }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`design-skill setup stopped: ${(error as Error).message}\n`);
    process.exit(2);
  }
}
