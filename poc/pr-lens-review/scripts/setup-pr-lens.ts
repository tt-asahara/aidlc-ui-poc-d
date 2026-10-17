#!/usr/bin/env bun
// Opt-in setup of the optional pr-lens-review plugin into an installed D PRODUCT.
//
//   bun poc/pr-lens-review/scripts/setup-pr-lens.ts --product /abs/PRODUCT [--offline] [--verify] [--dry-run]
//
// Run from the D source checkout (SRC) after `bun scripts/package.ts claude`
// and `bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/pr-lens-review claude`.
// Steps, each failing closed with a one-line reason:
//   1. PRODUCT has the installed D runtime whose pin module equals SRC's.
//   2. PRODUCT/.vendor/pr-lens is fetched from the pinned public repository at
//      exactly PR_LENS_PIN (or an existing checkout is verified, never moved),
//      and its LICENSE equals the pinned MIT licence bytes.
//   3. corepack pnpm install --frozen-lockfile (+ --offline) and build (+ the
//      upstream typecheck/test with --verify), then the install receipt.
//   4. The plugin is composed project-locally, twice, and must be idempotent.
// It never changes features.prLensReview: switching the review ON stays the
// person's decision in .claude/d-acceleration(.local).jsonc.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import * as sourcePin from "../../d-acceleration/pr-lens-pin.ts";

export class SetupStop extends Error {}
const SRC = resolve(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(SRC, "poc", "pr-lens-review", "dist", "claude");

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024 });
}
function must(cmd: string, args: string[], cwd: string, label: string, env: Record<string, string> = {}) {
  const result = run(cmd, args, cwd, env);
  if (result.status !== 0) throw new SetupStop(`${label} failed: ${(result.stderr || result.stdout || "").trim().split("\n").slice(-3).join(" | ")}`);
  return result.stdout;
}
function treeSha(dir: string): string {
  const hash = createHash("sha256");
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name); const stat = lstatSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) hash.update(`${relative(dir, full).split(sep).join("/")}\0${createHash("sha256").update(readFileSync(full)).digest("hex")}\n`);
    }
  };
  walk(dir);
  return hash.digest("hex");
}

/** Verify a checkout is exactly the pin; never move or overwrite it. */
export function verifyCheckout(vendorDir: string): void {
  const top = run("git", ["-C", vendorDir, "rev-parse", "--show-toplevel"], vendorDir);
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== realpathSync(vendorDir)) throw new SetupStop(`${vendorDir} exists but is not its own Git checkout; move it away and rerun`);
  const head = run("git", ["-C", vendorDir, "rev-parse", "HEAD"], vendorDir).stdout.trim();
  if (head !== sourcePin.PR_LENS_PIN) throw new SetupStop(`${vendorDir} is at ${head || "no commit"}, not the pin ${sourcePin.PR_LENS_PIN}; move it away and rerun (the setup never re-points an existing checkout)`);
  if (run("git", ["-C", vendorDir, "cat-file", "-e", `${sourcePin.PR_LENS_PIN}^{commit}`], vendorDir).status !== 0) throw new SetupStop(`${vendorDir} does not contain the pinned commit object`);
  const dirty = run("git", ["-C", vendorDir, "status", "--porcelain", "--untracked-files=no"], vendorDir).stdout.trim();
  if (dirty) throw new SetupStop(`${vendorDir} has modified tracked files; restore them or move the checkout away and rerun`);
  const license = join(vendorDir, "LICENSE");
  if (!existsSync(license) || createHash("sha256").update(readFileSync(license)).digest("hex") !== sourcePin.PR_LENS_LICENSE_SHA256) throw new SetupStop(`${vendorDir}/LICENSE is not the pinned MIT licence`);
}

function fetchPinned(vendorDir: string): void {
  mkdirSync(vendorDir, { recursive: true });
  try { fetchInto(vendorDir); } catch (error) { rmSync(vendorDir, { recursive: true, force: true }); throw error; }
}
function fetchInto(vendorDir: string): void {
  must("git", ["init", "-q", vendorDir], dirname(vendorDir), "git init");
  must("git", ["-C", vendorDir, "remote", "add", "origin", sourcePin.PR_LENS_REPOSITORY], vendorDir, "git remote add");
  must("git", ["-C", vendorDir, "fetch", "-q", "--depth", "1", "origin", sourcePin.PR_LENS_PIN], vendorDir, `fetch ${sourcePin.PR_LENS_REPOSITORY}@${sourcePin.PR_LENS_PIN}`);
  must("git", ["-C", vendorDir, "-c", "advice.detachedHead=false", "checkout", "-q", "--detach", sourcePin.PR_LENS_PIN], vendorDir, "checkout pinned commit");
}

/** Keep the vendored checkout, its receipt, and PR Lens previews out of PRODUCT commits (local, untracked exclude). */
function excludeLocally(P: string): string[] {
  const gitPath = run("git", ["-C", P, "rev-parse", "--git-path", "info/exclude"], P);
  if (gitPath.status !== 0) return [];
  const file = resolve(P, gitPath.stdout.trim());
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const wanted = [`/${sourcePin.PR_LENS_VENDOR_DIR}/`, `/${sourcePin.PR_LENS_RECEIPT}`, "/.pr-lens/"].filter((line) => !current.split("\n").includes(line));
  if (wanted.length) { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}${wanted.join("\n")}\n`); }
  return wanted;
}

function compose(P: string): void {
  must(process.execPath, [join(PLUGIN_ROOT, "hooks", "compose.ts")], P, "project-local compose", { AIDLC_PROJECT_DIR: P, AIDLC_PLUGIN_ROOT: PLUGIN_ROOT, AIDLC_HARNESS_DIR: ".claude", AIDLC_HARNESS_NAME: "claude" });
}

export async function setup(product: string, options: { offline?: boolean; verify?: boolean; dryRun?: boolean } = {}) {
  if (!isAbsolute(product) || !existsSync(product)) throw new SetupStop("--product must be an existing absolute PRODUCT path");
  const P = realpathSync(product);
  const installedPin = join(P, ".claude", "tools", "d-acceleration", "pr-lens-pin.ts");
  if (!existsSync(installedPin)) throw new SetupStop("PRODUCT has no installed D runtime with pr-lens support; install or update D first (poc/d-acceleration/fresh-install.ts)");
  const pin = await import(installedPin) as typeof sourcePin;
  if (pin.PR_LENS_PIN !== sourcePin.PR_LENS_PIN || pin.PR_LENS_LICENSE_SHA256 !== sourcePin.PR_LENS_LICENSE_SHA256) throw new SetupStop("PRODUCT's installed D pin differs from this D checkout; update D first (fresh-install.ts update)");
  if (!existsSync(join(PLUGIN_ROOT, "hooks", "compose.ts"))) throw new SetupStop("missing plugin build; run: bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/pr-lens-review claude");
  const vendorDir = join(P, sourcePin.PR_LENS_VENDOR_DIR);
  const plan = { product: P, vendorDir, repository: sourcePin.PR_LENS_REPOSITORY, pin: sourcePin.PR_LENS_PIN, fetch: !existsSync(vendorDir), build: options.verify ? "install+build+typecheck+test" : "install+build", compose: PLUGIN_ROOT };
  if (options.dryRun) return { mode: "dry-run", ...plan };
  if (existsSync(join(P, ".git"))) {
    // Only the surfaces compose writes must be clean; personal config files may be untracked.
    const dirty = run("git", ["-C", P, "status", "--porcelain", "--", ".claude/aidlc-common", ".claude/tools", ".claude/skills"], P).stdout.trim();
    if (dirty) throw new SetupStop(`PRODUCT compose surfaces have uncommitted changes; commit or move them first: ${dirty.split("\n").join(", ")}`);
  }
  if (plan.fetch) fetchPinned(vendorDir);
  verifyCheckout(vendorDir);
  const pnpm = ["pnpm", "--dir", vendorDir];
  must("corepack", [...pnpm, "install", "--frozen-lockfile", ...(options.offline ? ["--offline"] : [])], vendorDir, "pnpm install --frozen-lockfile");
  must("corepack", [...pnpm, "run", "build"], vendorDir, "pnpm run build");
  if (options.verify) { must("corepack", [...pnpm, "run", "typecheck"], vendorDir, "pnpm run typecheck"); must("corepack", [...pnpm, "run", "test"], vendorDir, "pnpm run test"); }
  verifyCheckout(vendorDir); // the build must not have touched tracked sources
  const receipt = pin.writePrLensReceipt(P);
  const excluded = excludeLocally(P);
  compose(P);
  const first = treeSha(join(P, ".claude"));
  compose(P);
  if (treeSha(join(P, ".claude")) !== first) throw new SetupStop("second compose changed the installed tree; compose is not idempotent");
  const install = pin.checkPrLensInstall(P), composed = pin.checkPrLensPluginComposed(P);
  if (!install.ok) throw new SetupStop(`pinned PR Lens is not ready after setup: ${install.detail}`);
  if (!composed.ok) throw new SetupStop(`pr-lens-review is not composed after setup: ${composed.detail}`);
  return { mode: "apply", ...plan, receipt, gitInfoExcludeAdded: excluded, composedTreeSha256: first, ready: true, switch: "features.prLensReview is unchanged (default OFF); set it to true in .claude/d-acceleration.local.jsonc or .claude/d-acceleration.jsonc to opt in" };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--product");
  try {
    const result = await setup(at >= 0 ? args[at + 1] ?? "" : "", { offline: args.includes("--offline"), verify: args.includes("--verify"), dryRun: args.includes("--dry-run") });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`pr-lens setup stopped: ${(error as Error).message}\n`);
    process.exit(2);
  }
}
