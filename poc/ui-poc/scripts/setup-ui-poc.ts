#!/usr/bin/env bun
// Install the AI-DLC runtime plus the composed ui-poc plugin (the Arm C UI
// baseline) into a PRODUCT for a harness that has no D acceleration yet.
//
//   bun poc/ui-poc/scripts/setup-ui-poc.ts --harness kiro|kiro-ide|codex --src /abs/SRC --product /abs/PRODUCT [--dry-run]
//
// Claude products use poc/d-acceleration/fresh-install.ts, which adds D on top
// of these same steps. Each step fails closed with a one-line reason:
//   1. Official `aidlc config` from SRC/dist/<harness> (dry-run first; any
//      conflict stops before a write).
//   2. The pinned C payload under .agents, without clobbering (the same
//      placement fresh-install uses).
//   3. The ui-poc plugin built for the harness. Kiro and Kiro IDE take it as
//      AI-DLC's folder drop (.kiro/aidlc-plugins/ui-poc/), so their own plugin
//      sync and session-start compose find it; Codex composes from SRC's build,
//      as Claude does.
//   4. Project-local compose run twice; the second run must change nothing.
// It never selects a design skill or writes D configuration.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { placeCPayload, treeHash } from "../../d-acceleration/fresh-install.ts";

export class SetupStop extends Error {}

export const UI_POC_HARNESSES = {
  kiro: { dir: ".kiro", folderDrop: true },
  "kiro-ide": { dir: ".kiro", folderDrop: true },
  codex: { dir: ".codex", folderDrop: false },
} as const;
export type UiPocHarness = keyof typeof UI_POC_HARNESSES;

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); };

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status ?? -1, out: `${result.stderr ?? ""}${result.stdout ?? ""}`.trim() };
}
function must(cmd: string, args: string[], cwd: string, what: string, env: Record<string, string> = {}): void {
  const result = run(cmd, args, cwd, env);
  if (result.status !== 0) throw new SetupStop(`${what} failed (${result.status}): ${result.out.slice(-2000)}`);
}
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => { for (const name of readdirSync(d).sort()) { const full = join(d, name); if (lstatSync(full).isDirectory()) walk(full); else out.push(relative(dir, full).split(sep).join("/")); } };
  walk(dir);
  return out;
}

export function uiPocPaths(harness: string, src: string, product: string) {
  if (!(harness in UI_POC_HARNESSES)) throw new SetupStop(`--harness must be one of ${Object.keys(UI_POC_HARNESSES).join(", ")} (Claude uses poc/d-acceleration/fresh-install.ts)`);
  if (!isAbsolute(src) || !isAbsolute(product) || !existsSync(src) || !existsSync(product)) throw new SetupStop("--src and --product must be existing absolute paths");
  const S = realpathSync(src), P = realpathSync(product), h = UI_POC_HARNESSES[harness as UiPocHarness];
  if (inside(S, P) || inside(P, S)) throw new SetupStop("PRODUCT must be separate from the SRC checkout");
  const dist = join(S, "dist", harness), dispatcher = join(dist, h.dir, "tools", "aidlc.ts");
  const built = join(S, "poc", "ui-poc", "dist", harness);
  const builtPlugin = h.folderDrop ? join(built, h.dir, "aidlc-plugins", "ui-poc") : built;
  for (const required of [dispatcher, join(builtPlugin, "hooks", "compose.ts")]) {
    if (!existsSync(required)) throw new SetupStop(`missing build output ${relative(S, required)}; run bun scripts/package.ts ${harness} and bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/ui-poc ${harness} first`);
  }
  const pluginRoot = h.folderDrop ? join(P, h.dir, "aidlc-plugins", "ui-poc") : builtPlugin;
  return { harness: harness as UiPocHarness, dir: h.dir, folderDrop: h.folderDrop, S, P, dist, dispatcher, builtPlugin, pluginRoot };
}
type Paths = ReturnType<typeof uiPocPaths>;

function config(p: Paths, dryRun: boolean): void {
  const result = run(process.execPath, [p.dispatcher, "config", "--from", p.dist, "--harness", p.harness, "--project-dir", p.P, "--mcp", "none", ...(dryRun ? ["--dry-run"] : [])], p.P);
  if (result.status !== 0) throw new SetupStop(`official config${dryRun ? " dry-run" : ""} stopped: ${result.out.slice(-2000)}`);
}

/** Copy the built plugin folder into PRODUCT; identical files stay, a differing file stops. */
function dropPlugin(p: Paths): number {
  const files = filesUnder(p.builtPlugin);
  const differing = files.filter((rel) => existsSync(join(p.pluginRoot, rel)) && sha256(join(p.pluginRoot, rel)) !== sha256(join(p.builtPlugin, rel)));
  if (differing.length) throw new SetupStop(`${relative(p.P, p.pluginRoot)} differs from this build (never merged or overwritten): ${differing.join(", ")}`);
  let added = 0;
  for (const rel of files) {
    const target = join(p.pluginRoot, rel);
    if (existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(p.builtPlugin, rel), target);
    added++;
  }
  return added;
}

function compose(p: Paths): string {
  must(process.execPath, [join(p.pluginRoot, "hooks", "compose.ts")], p.P, "project-local compose", {
    AIDLC_PROJECT_DIR: p.P, AIDLC_PLUGIN_ROOT: p.pluginRoot, AIDLC_HARNESS_DIR: p.dir, AIDLC_HARNESS_NAME: p.harness,
  });
  return treeHash(join(p.P, p.dir)).sha256;
}

export function setupUiPoc(harness: string, src: string, product: string, dryRun = false) {
  const p = uiPocPaths(harness, src, product);
  if (!existsSync(join(p.P, ".git"))) throw new SetupStop("PRODUCT must be a Git repository so existing work can be proven untouched");
  const dirty = run("git", ["-C", p.P, "status", "--porcelain"], p.P).out;
  if (dirty) throw new SetupStop(`PRODUCT has uncommitted changes; commit or move them first:\n${dirty}`);
  config(p, true);
  const plan = { harness: p.harness, product: p.P, runtime: relative(p.S, p.dist), plugin: p.folderDrop ? relative(p.P, p.pluginRoot) : relative(p.S, p.builtPlugin), cPayload: ".agents" };
  if (dryRun) return { mode: "dry-run", ...plan };
  config(p, false);
  const payload = placeCPayload(p.S, p.P);
  const pluginFiles = p.folderDrop ? dropPlugin(p) : 0;
  const first = compose(p), second = compose(p);
  if (first !== second) throw new SetupStop("second compose changed the installed tree; compose is not idempotent");
  return { mode: "apply", ...plan, cPayload: payload, pluginFilesAdded: pluginFiles, composedTreeSha256: second, next: `open the project in ${p.harness === "codex" ? "Codex" : p.harness === "kiro" ? "Kiro CLI (kiro-cli chat)" : "Kiro IDE"} and run /aidlc --doctor` };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => { const at = argv.indexOf(name); return at < 0 ? "" : argv[at + 1] ?? ""; };
  try {
    process.stdout.write(`${JSON.stringify(setupUiPoc(flag("--harness"), flag("--src"), flag("--product"), argv.includes("--dry-run")), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`ui-poc setup stopped: ${(error as Error).message}\n`);
    process.exit(2);
  }
}
