#!/usr/bin/env bun
// Build and Test entry of the optional pr-lens-review plugin. The composed
// fragment runs this before anything PR Lens related. It reads the D switch
// `features.prLensReview` (default OFF; one owner: d-config.ts) and the pinned
// install check (one owner: pr-lens-pin.ts), and records the outcome only in
// D's own evidence. It never runs PR Lens, never writes stage artifacts,
// never touches review, sensor, approval, or gate state.
//
//   OFF                      -> {"status":"skipped-by-config"}, exit 0
//   ON + not installed/pinned -> one-line next step on stderr, exit 2 (fail closed)
//   ON + plugin not composed  -> one-line next step on stderr, exit 2 (fail closed)
//   ON + ready                -> {"status":"ready"}, exit 0
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { resolveDFeatureFlags } from "./d-config.ts";
import { checkPrLensInstall, checkPrLensPluginComposed, PR_LENS_PIN, PR_LENS_SETUP_HINT } from "./pr-lens-pin.ts";

export const PR_LENS_GATE_EVIDENCE = join("aidlc", ".aidlc-engine", "d-evidence", "build-and-test-pr-lens-review.json");

export type PrLensGateStatus = "skipped-by-config" | "ready" | "not-ready";
export type PrLensGate = {
  schema: 1; stage: "build-and-test"; feature: "features.prLensReview"; enabled: boolean; status: PrLensGateStatus;
  reason?: string; detail?: string; next?: string; pin: string;
  prLensRun: false; gateDecision: "none"; approvalRecorded: false;
};

/** Pure decision from configuration and installed files; no writes. */
export function prLensGate(projectDir: string): PrLensGate {
  const base = { schema: 1, stage: "build-and-test", feature: "features.prLensReview", pin: PR_LENS_PIN, prLensRun: false, gateDecision: "none", approvalRecorded: false } as const;
  if (!resolveDFeatureFlags(projectDir).prLensReview) return { ...base, enabled: false, status: "skipped-by-config" };
  const install = checkPrLensInstall(projectDir);
  if (!install.ok) return { ...base, enabled: true, status: "not-ready", reason: install.reason, detail: install.detail, next: PR_LENS_SETUP_HINT };
  const composed = checkPrLensPluginComposed(projectDir);
  if (!composed.ok) return { ...base, enabled: true, status: "not-ready", reason: "plugin-not-composed", detail: composed.detail, next: PR_LENS_SETUP_HINT };
  return { ...base, enabled: true, status: "ready" };
}

/** D's own evidence (never an official stage artifact, review receipt, or approval). */
export function recordPrLensGate(projectDir: string, gate: PrLensGate): string {
  const path = join(projectDir, PR_LENS_GATE_EVIDENCE);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ ...gate, recordedAt: new Date().toISOString() }, null, 2)}\n`);
  renameSync(temp, path);
  return path;
}

export function prLensGateLine(gate: PrLensGate): string {
  return `PR Lens review is ON but not ready (${gate.reason}: ${gate.detail}); next: ${gate.next}`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--project-dir");
  // Installed at PRODUCT/.claude/tools/d-acceleration/: the default is that PRODUCT.
  const projectDir = at >= 0 ? args[at + 1] : resolve(import.meta.dir, "..", "..", "..");
  if (!projectDir || !isAbsolute(projectDir)) { process.stderr.write("usage: pr-lens-gate.ts [--project-dir ABS_PRODUCT] [--no-record]\n"); process.exit(2); }
  let gate: PrLensGate;
  try { gate = prLensGate(projectDir); } catch (error) { process.stderr.write(`D configuration invalid: ${(error as Error).message}\n`); process.exit(2); }
  const evidencePath = args.includes("--no-record") ? null : recordPrLensGate(projectDir, gate);
  process.stdout.write(`${JSON.stringify({ ...gate, ...(evidencePath ? { evidencePath } : {}) })}\n`);
  if (gate.status === "not-ready") { process.stderr.write(`${prLensGateLine(gate)}\n`); process.exit(2); }
}
