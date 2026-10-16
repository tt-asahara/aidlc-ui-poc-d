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
if (directive.kind !== "run-stage" || directive.gate !== false) throw new Error("host boundary requires the active non-gate run-stage directive whose body just executed");
if (directive.stage !== manifest.stage) throw new Error(`host boundary stage mismatch: ${directive.stage} != ${manifest.stage}`);
if ((directive.unit ?? null) !== (manifest.unit ?? null)) throw new Error(`host boundary unit mismatch: ${directive.unit ?? "<stage>"} != ${manifest.unit ?? "<stage>"}`);
const fresh = spawnSync(process.execPath, [resolve(engineDir, "aidlc-orchestrate.ts"), "next", "--project-dir", projectDir], { cwd: projectDir, encoding: "utf8" });
if (fresh.status !== 0) throw new Error(`host boundary could not obtain a fresh official directive: ${(fresh.stderr || fresh.stdout).trim()}`);
let freshValue: any;
try { freshValue = JSON.parse(fresh.stdout); } catch { throw new Error("host boundary fresh official directive was not JSON"); }
const freshDirective = freshValue?.directive ?? freshValue;
const freshValidation = validateDirective(freshDirective);
if (!freshValidation.valid) throw new Error(`host boundary fresh official directive is invalid: ${freshValidation.errors.join("; ")}`);
// Exact equality binds the active stage's gate, Unit/wave, attempt/review state,
// ceremony, paths, and engine-resolved execution surface. A stale saved copy or
// a hand-built {kind, stage} object cannot authorize an optional check.
if (JSON.stringify(freshDirective) !== JSON.stringify(directive)) throw new Error("host boundary directive is stale or does not match the fresh official next directive");
const result = spawnSync(process.execPath, [resolve(import.meta.dir, "d-feature-checks.ts"), "--project-dir", projectDir, "--input", manifestFile], { cwd: projectDir, encoding: "utf8" });
process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exit(result.status ?? 1);
