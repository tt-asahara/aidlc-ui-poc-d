#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { validateDirective } from "../../core/tools/aidlc-directive.ts";

const args = process.argv.slice(2), value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const projectDir = value("--project-dir"), directiveFile = value("--directive-file"), manifestFile = value("--manifest"), engineDir = value("--engine-dir") ?? resolve(import.meta.dir, "..");
if (!projectDir || !isAbsolute(projectDir) || !directiveFile || !manifestFile) throw new Error("absolute --project-dir, --directive-file, and --manifest are required");
const bounded = (path: string) => { const target = resolve(projectDir, path); const rel = relative(resolve(projectDir), target); if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`host boundary path escapes project: ${path}`); return target; };
const directive = JSON.parse(readFileSync(bounded(directiveFile), "utf8"));
const manifest = JSON.parse(readFileSync(bounded(manifestFile), "utf8"));
const validation = validateDirective(directive);
if (!validation.valid) throw new Error(`host boundary requires a valid official directive: ${validation.errors.join("; ")}`);
// Both gate:false and gate:true are executable run-stage directives. gate:true
// means the official stage ritual includes its approval boundary; it is not an
// `ask` directive and must still receive the optional checks before review/report.
if (directive.kind !== "run-stage") throw new Error("host boundary requires an active run-stage directive whose body just executed");
if (typeof directive.gate !== "boolean") throw new Error("host boundary requires a resolved boolean run-stage gate");
if (directive.stage !== manifest.stage) throw new Error(`host boundary stage mismatch: ${directive.stage} != ${manifest.stage}`);
if ((directive.unit ?? null) !== (manifest.unit ?? null)) throw new Error(`host boundary unit mismatch: ${directive.unit ?? "<stage>"} != ${manifest.unit ?? "<stage>"}`);
const orchestrate = (argv: string[]) => {
  const run = spawnSync(process.execPath, [resolve(engineDir, "aidlc-orchestrate.ts"), ...argv, "--project-dir", projectDir], { cwd: projectDir, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`host boundary could not obtain a fresh official directive: ${(run.stderr || run.stdout).trim()}`);
  let parsed: any;
  try { parsed = JSON.parse(run.stdout); } catch { throw new Error("host boundary fresh official directive was not JSON"); }
  const value = parsed?.directive ?? parsed;
  const check = validateDirective(value);
  if (!check.valid) throw new Error(`host boundary fresh official directive is invalid: ${check.errors.join("; ")}`);
  return value;
};
// A fresh `next` restarts the stage's rule delivery at part one. When the
// active memory no longer fits beside the run-stage (for example after
// practices-promote filled team.md/project.md), the engine sends it as
// load-steering parts first. Follow the official continuation receipts exactly
// as the conductor does until the run-stage comes back; this also leaves the
// engine's active-directive marker on the run-stage the host is executing,
// instead of on steering part one.
const MAX_STEERING_PARTS = 32;
let freshDirective = orchestrate(["next"]);
for (let followed = 0; freshDirective?.kind === "load-steering"; followed++) {
  if (followed >= MAX_STEERING_PARTS) throw new Error(`host boundary followed ${MAX_STEERING_PARTS} steering parts without reaching the run-stage`);
  if (freshDirective.stage !== directive.stage) throw new Error(`host boundary steering belongs to another stage: ${freshDirective.stage} != ${directive.stage}`);
  if (typeof freshDirective.receipt !== "string" || !freshDirective.receipt) throw new Error("host boundary steering part has no continuation receipt");
  freshDirective = orchestrate(["continue", freshDirective.receipt]);
}
// Exact equality binds the active stage's gate, Unit/wave, attempt/review state,
// ceremony, paths, and engine-resolved execution surface. A stale saved copy or
// a hand-built {kind, stage} object cannot authorize an optional check.
if (JSON.stringify(freshDirective) !== JSON.stringify(directive)) throw new Error("host boundary directive is stale or does not match the fresh official next directive");

function declaredArtifactPaths(value: any): string[] {
  const result: string[] = [];
  const add = (entry: any) => {
    if (typeof entry === "string") result.push(entry);
    else if (entry && typeof entry === "object") {
      for (const key of ["path", "resolved_path", "output_path", "artifact_path"]) if (typeof entry[key] === "string") result.push(entry[key]);
    }
  };
  for (const entry of value.consumes ?? []) add(entry);
  for (const entry of value.produces ?? []) add(entry);
  for (const waveEntry of value.wave?.entries ?? []) {
    for (const entry of waveEntry.consumes ?? []) add(entry);
    for (const entry of waveEntry.produces ?? []) add(entry);
    for (const entry of waveEntry.required_produces ?? []) add(entry);
  }
  return result;
}
const normalized = (path: string) => relative(resolve(projectDir), resolve(projectDir, path));
const declared = new Set(declaredArtifactPaths(freshDirective).map(normalized));
const manifestArtifacts = [
  manifest.traceabilityPath,
  manifest.uiContractPath,
  ...(manifest.artifactPaths ?? []),
  ...Object.values(manifest.functionalArtifacts ?? {}),
].filter((path): path is string => typeof path === "string" && path.length > 0);
for (const artifact of manifestArtifacts) {
  const rel = normalized(artifact);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`host boundary manifest artifact escapes project: ${artifact}`);
  if (!declared.has(rel)) throw new Error(`host boundary manifest artifact is not declared by the fresh directive: ${artifact}`);
}
const result = spawnSync(process.execPath, [resolve(import.meta.dir, "d-feature-checks.ts"), "--project-dir", projectDir, "--input", manifestFile], { cwd: projectDir, encoding: "utf8" });
process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exit(result.status ?? 1);
