// One owner for the pinned PR Lens dependency of the optional pr-lens-review
// plugin (poc/pr-lens-review). The pin, the expected MIT licence bytes, the
// install receipt, and the install check live here so the setup script, the
// D preflight prerequisites, the Build and Test gate, and the plugin tool all
// apply exactly the same rule. Built-in modules only: this file is projected
// into PRODUCT/<harness dir>/tools/d-acceleration/ and must resolve there.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { runtimeHarnessDir } from "../../core/tools/aidlc-runtime-paths.ts";

export const PR_LENS_REPOSITORY = "https://github.com/coldteadotai/pr-lens.git";
export const PR_LENS_PIN = "7a9115c8202da4db030be5954ada8862e6135dce";
/** sha256 of LICENSE at the pin (MIT, Copyright (c) 2026 Coldtea AI). */
export const PR_LENS_LICENSE_SHA256 = "f95e90af396c71c9a94648bd58e4f5bb2dcab4f6ac3ab7d3d2ca3f4e4f4a1ae7";
export const PR_LENS_VENDOR_DIR = ".vendor/pr-lens";
export const PR_LENS_RECEIPT = ".vendor/pr-lens.receipt.json";
export const PR_LENS_CLI = "packages/cli/dist/bin.js";
export const PR_LENS_PLUGIN = "pr-lens-review";
export const PR_LENS_SETUP_HINT = "run the D pr-lens setup (bun <D checkout>/poc/pr-lens-review/scripts/setup-pr-lens.ts --product <PRODUCT>) or set features.prLensReview=false";

export type PrLensInstallReason = "not-installed" | "not-a-pinned-checkout" | "pin-mismatch" | "license-mismatch" | "not-built" | "receipt-missing" | "receipt-mismatch";
export type PrLensInstall = { ok: true; vendorDir: string; commit: string; buildSha256: string } | { ok: false; reason: PrLensInstallReason; detail: string };
export type PrLensReceipt = { schema: 1; repository: string; commit: string; licenseSha256: string; cli: string; buildSha256: string };

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (stat.isFile()) yield full;
  }
}

/**
 * Hash of every built output (`packages/<pkg>/dist/**`) in the vendored
 * checkout. A rebuild from changed sources or a hand edit changes it, so the
 * receipt proves the renderer is the one the setup built from the pin.
 */
export function prLensBuildSha256(vendorDir: string): string | null {
  const packages = join(vendorDir, "packages");
  if (!existsSync(packages)) return null;
  const hash = createHash("sha256");
  let files = 0;
  for (const name of readdirSync(packages).sort()) {
    const dist = join(packages, name, "dist");
    if (!existsSync(dist) || !lstatSync(dist).isDirectory()) continue;
    for (const file of walk(dist)) {
      const rel = relative(vendorDir, file).split(sep).join("/");
      hash.update(`${rel}\0${sha256(readFileSync(file))}\n`);
      files++;
    }
  }
  return files ? hash.digest("hex") : null;
}

function vendorHead(vendorDir: string): { toplevel: boolean; head: string | null } {
  const top = spawnSync("git", ["-C", vendorDir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const toplevel = top.status === 0 && realpathSync(top.stdout.trim()) === realpathSync(vendorDir);
  if (!toplevel) return { toplevel, head: null };
  const head = spawnSync("git", ["-C", vendorDir, "rev-parse", "HEAD"], { encoding: "utf8" });
  return { toplevel, head: head.status === 0 ? head.stdout.trim() : null };
}

/** Deterministic install check: pinned checkout, MIT licence bytes, built CLI, matching receipt. */
export function checkPrLensInstall(projectDir: string): PrLensInstall {
  const vendorDir = join(projectDir, PR_LENS_VENDOR_DIR);
  if (!existsSync(vendorDir)) return { ok: false, reason: "not-installed", detail: `${PR_LENS_VENDOR_DIR} is missing` };
  const { toplevel, head } = vendorHead(vendorDir);
  if (!toplevel) return { ok: false, reason: "not-a-pinned-checkout", detail: `${PR_LENS_VENDOR_DIR} is not its own Git checkout` };
  if (head !== PR_LENS_PIN) return { ok: false, reason: "pin-mismatch", detail: `${PR_LENS_VENDOR_DIR} is at ${head ?? "no commit"}, not the pin ${PR_LENS_PIN}` };
  const license = join(vendorDir, "LICENSE");
  if (!existsSync(license) || sha256(readFileSync(license)) !== PR_LENS_LICENSE_SHA256) return { ok: false, reason: "license-mismatch", detail: `${PR_LENS_VENDOR_DIR}/LICENSE is missing or is not the pinned MIT licence` };
  const buildSha256 = existsSync(join(vendorDir, PR_LENS_CLI)) ? prLensBuildSha256(vendorDir) : null;
  if (!buildSha256) return { ok: false, reason: "not-built", detail: `${PR_LENS_VENDOR_DIR}/${PR_LENS_CLI} is not built` };
  const receiptPath = join(projectDir, PR_LENS_RECEIPT);
  if (!existsSync(receiptPath)) return { ok: false, reason: "receipt-missing", detail: `${PR_LENS_RECEIPT} is missing (the setup did not finish)` };
  let receipt: Partial<PrLensReceipt>;
  try { receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Partial<PrLensReceipt>; } catch { return { ok: false, reason: "receipt-mismatch", detail: `${PR_LENS_RECEIPT} is not valid JSON` }; }
  if (receipt.schema !== 1 || receipt.commit !== PR_LENS_PIN || receipt.licenseSha256 !== PR_LENS_LICENSE_SHA256 || receipt.cli !== PR_LENS_CLI || receipt.buildSha256 !== buildSha256) {
    return { ok: false, reason: "receipt-mismatch", detail: `${PR_LENS_RECEIPT} does not match the pinned commit or the current build output` };
  }
  return { ok: true, vendorDir, commit: PR_LENS_PIN, buildSha256 };
}

/** Written only by the setup, after it verified the checkout and built it. */
export function writePrLensReceipt(projectDir: string): PrLensReceipt {
  const vendorDir = join(projectDir, PR_LENS_VENDOR_DIR);
  const { head } = vendorHead(vendorDir);
  if (head !== PR_LENS_PIN) throw new Error(`refusing to write the PR Lens receipt: ${PR_LENS_VENDOR_DIR} is at ${head ?? "no commit"}, not ${PR_LENS_PIN}`);
  const buildSha256 = prLensBuildSha256(vendorDir);
  if (!buildSha256 || !existsSync(join(vendorDir, PR_LENS_CLI))) throw new Error(`refusing to write the PR Lens receipt: ${PR_LENS_CLI} is not built`);
  const receipt: PrLensReceipt = { schema: 1, repository: PR_LENS_REPOSITORY, commit: PR_LENS_PIN, licenseSha256: PR_LENS_LICENSE_SHA256, cli: PR_LENS_CLI, buildSha256 };
  writeFileSync(join(projectDir, PR_LENS_RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

/** The plugin is composed: its tool is installed and its Build and Test fragment is present. */
export function checkPrLensPluginComposed(projectDir: string): { ok: boolean; detail: string } {
  const dir = runtimeHarnessDir(projectDir);
  const tool = join(projectDir, dir, "tools", "pr-lens-review.ts");
  const sidecar = join(projectDir, dir, "tools", "data", `plugin-contrib-${PR_LENS_PLUGIN}.json`);
  const stage = join(projectDir, dir, "aidlc-common", "stages", "construction", "build-and-test.md");
  if (!existsSync(tool)) return { ok: false, detail: `${dir}/tools/pr-lens-review.ts is missing` };
  if (!existsSync(sidecar)) return { ok: false, detail: `${dir}/tools/data/plugin-contrib-${PR_LENS_PLUGIN}.json is missing` };
  if (!existsSync(stage) || !readFileSync(stage, "utf8").includes(`<!-- plugin:${PR_LENS_PLUGIN}:`)) return { ok: false, detail: "the Build and Test stage has no pr-lens-review fragment" };
  return { ok: true, detail: "composed" };
}
