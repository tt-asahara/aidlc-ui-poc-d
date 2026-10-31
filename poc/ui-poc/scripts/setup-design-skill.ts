#!/usr/bin/env bun
// Opt-in install of an optional refined-mockups design skill into an installed D PRODUCT.
//
//   bun poc/ui-poc/scripts/setup-design-skill.ts --product /abs/PRODUCT --skill <id> [--source /abs/folder] [--harness-dir .claude|.kiro|.codex] [--dry-run]
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
// A choice whose install origin is "local-folder" is not published anywhere
// this repository may redistribute, so step 2 reads the person's own copy
// (--source) instead of fetching: symlinks are refused, Finder .DS_Store files
// are ignored, every other file must be exactly one pinned file, and the folder
// must hash to the pinned Git tree. Steps 1, 3, and 4 are the same.
// It never changes uiDesign.refinedMockupSkill: choosing the skill stays the
// person's decision in <harness dir>/d-acceleration(.local).jsonc. The harness
// directory is the one PRODUCT's composed C UI tools are installed in; when
// several are, --harness-dir names it.
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
  designChoice(cfg: unknown, id: string): { id: string; skill: string; install: null | { origin?: "local-folder"; sourceDir: string; installDir: string; licenses: Array<{ from: string; to: string }> } };
  lockedSource(skill: unknown): null | { license: string; licenseFiles?: Array<{ path: string; git_blob_sha: string; sha256: string }>; files: Array<{ path: string; git_blob_sha: string; bytes: number }> };
  designSkillStatus(id: string, projectRoot: string): { ok: boolean; detail?: string };
  gitBlobHash(bytes: Buffer): string;
};
export type SetupOptions = { dryRun?: boolean; srcTools?: string; fetchUrl?: (repository: string) => string; source?: string; harnessDir?: string };
export const HARNESS_DIRS = [".claude", ".kiro", ".codex"] as const;

/** The harness directory holding PRODUCT's composed C UI routing tool. */
export function productHarnessDir(P: string, requested?: string): string {
  if (requested) {
    if (!(HARNESS_DIRS as readonly string[]).includes(requested)) throw new SetupStop(`--harness-dir must be one of ${HARNESS_DIRS.join(", ")}`);
    return requested;
  }
  const found = HARNESS_DIRS.filter((dir) => existsSync(join(P, dir, "tools", "ui-poc-c-routing.cjs")));
  if (found.length > 1) throw new SetupStop(`PRODUCT has composed C UI tools in ${found.join(" and ")}; name one with --harness-dir`);
  return found[0] ?? ".claude";
}
type PinnedEntry = { from: string; rel: string; executable: boolean };

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

/** The person's local copy of a local-folder choice, checked file by file and as one Git tree against the pin. */
function localEntries(sourceArg: string | undefined, id: string, commit: string, pinned: Array<{ path: string; git_blob_sha: string; bytes: number }>, gitBlobHash: Routing["gitBlobHash"]): { source: string; entries: PinnedEntry[] } {
  if (!sourceArg) throw new SetupStop(`${id} is installed from your own copy, not fetched; pass --source <absolute folder that contains its SKILL.md>`);
  if (!isAbsolute(sourceArg) || !existsSync(join(sourceArg, "SKILL.md"))) throw new SetupStop("--source must be an absolute folder that contains SKILL.md");
  const source = realpathSync(sourceArg), found: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name), stat = lstatSync(full), rel = relative(source, full).split(sep).join("/");
      if (stat.isSymbolicLink()) throw new SetupStop(`--source contains a symlink (${rel}); refusing to install it`);
      if (stat.isDirectory()) walk(full); else if (name !== ".DS_Store") found.push(rel);
    }
  };
  walk(source);
  const byPath = new Map(pinned.map((file) => [file.path, file])), extra = found.filter((rel) => !byPath.has(rel)), missing = pinned.filter((file) => !found.includes(file.path)).map((file) => file.path);
  if (extra.length || missing.length) throw new SetupStop(`--source is not the pinned ${id} (${[...extra.slice(0, 3).map((rel) => `extra ${rel}`), ...missing.slice(0, 3).map((rel) => `missing ${rel}`)].join(", ")})`);
  for (const rel of found) {
    const bytes = readFileSync(join(source, rel)), file = byPath.get(rel)!;
    if (bytes.length !== file.bytes || gitBlobHash(bytes) !== file.git_blob_sha) throw new SetupStop(`--source ${rel} differs from the pinned ${id}`);
  }
  const work = mkdtempSync(join(tmpdir(), "ui-poc-design-skill-tree-"));
  try {
    must(["init", "-q", work], tmpdir(), "git init");
    for (const rel of found) { mkdirSync(dirname(join(work, rel)), { recursive: true }); copyFileSync(join(source, rel), join(work, rel)); chmodSync(join(work, rel), 0o644); }
    must(["-C", work, "add", "-A"], work, "git add");
    if (must(["-C", work, "write-tree"], work, "write-tree").trim() !== commit) throw new SetupStop(`--source does not hash to the pinned ${id} tree ${commit}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { source, entries: found.map((rel) => ({ from: join(source, rel), rel, executable: false })) };
}

/** Copy the pinned entries and licences into PRODUCT without clobbering. */
function installEntries(P: string, installDir: string, entries: PinnedEntry[], licenses: Array<{ from: string; to: string }>, licenseRoot: string): void {
  const target = join(P, installDir), expected = new Set(entries.map((entry) => entry.rel));
  const extra = filesUnder(target).filter((rel) => !expected.has(rel));
  if (extra.length) throw new SetupStop(`${installDir} has files that are not in the pinned skill (never merged or overwritten): ${extra.slice(0, 5).join(", ")}; move it away and rerun`);
  for (const entry of entries) place(entry.from, join(target, entry.rel), entry.executable);
  for (const license of licenses) place(join(licenseRoot, license.from), join(P, license.to), false);
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
  const P = realpathSync(product), harnessDir = productHarnessDir(P, options.harnessDir), installedTools = join(P, harnessDir, "tools"), srcTools = options.srcTools ?? SRC_TOOLS;
  for (const rel of ROUTING_FILES) {
    const installed = join(installedTools, rel);
    if (!existsSync(installed)) throw new SetupStop(`PRODUCT has no composed C UI routing with design-skill selection (${rel}); install or update D first (poc/d-acceleration/fresh-install.ts)`);
    if (sha256(readFileSync(installed)) !== sha256(readFileSync(join(srcTools, rel)))) throw new SetupStop(`PRODUCT's installed ${rel} differs from this D checkout; update D first (poc/d-acceleration/fresh-install.ts update)`);
  }
  const routing = createRequire(import.meta.url)(join(installedTools, "ui-poc-c-routing.cjs")) as Routing;
  const cfg = routing.load();
  let choice: ReturnType<Routing["designChoice"]>;
  try { choice = routing.designChoice(cfg, id); } catch (error) { throw new SetupStop((error as Error).message); }
  const next = `uiDesign.refinedMockupSkill is unchanged; set it to "${choice.id}" in ${harnessDir}/d-acceleration.local.jsonc or ${harnessDir}/d-acceleration.jsonc to use it (ui-poc-comparison always keeps the Arm C default)`;
  if (!choice.install) {
    const status = routing.designSkillStatus(choice.id, P);
    return { mode: options.dryRun ? "dry-run" : "apply", skill: choice.id, ready: status.ok, ...(status.ok ? {} : { detail: status.detail }), note: "the default design skill is the Arm C payload placed by D setup; nothing to fetch" };
  }
  const skill = cfg.skills[choice.skill]!, source = routing.lockedSource(skill);
  if (!source) throw new SetupStop(`no pinned lock record for ${skill.repository}@${skill.commit}`);
  const install = choice.install;
  if (install.origin === "local-folder") {
    const { source: folder, entries } = localEntries(options.source, choice.id, skill.commit, source.files, routing.gitBlobHash);
    const plan = { product: P, skill: choice.id, repository: skill.repository, commit: skill.commit, license: source.license, from: folder, to: install.installDir, licenses: [] as string[] };
    if (options.dryRun) return { mode: "dry-run", ...plan, alreadyInstalled: routing.designSkillStatus(choice.id, P).ok, switch: next };
    installEntries(P, install.installDir, entries, [], P);
    const status = routing.designSkillStatus(choice.id, P);
    if (!status.ok) throw new SetupStop(`design skill is not ready after setup: ${status.detail}`);
    return { mode: "apply", ...plan, files: filesUnder(join(P, install.installDir)).length, ready: true, switch: next };
  }
  if (options.source) throw new SetupStop(`--source applies only to a choice installed from your own copy; ${choice.id} is fetched from ${skill.repository}`);
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
    installEntries(P, install.installDir, tree.map((entry) => ({ from: join(work, entry.path), rel: entry.path.slice(install.sourceDir.length + 1), executable: entry.mode === "100755" })), install.licenses, work);
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
    process.stdout.write(`${JSON.stringify(setupDesignSkill(value("--product"), value("--skill"), { dryRun: args.includes("--dry-run"), ...(args.includes("--source") ? { source: value("--source") } : {}), ...(args.includes("--harness-dir") ? { harnessDir: value("--harness-dir") } : {}) }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`design-skill setup stopped: ${(error as Error).message}\n`);
    process.exit(2);
  }
}
