#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2), value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const projectDir = value("--project-dir"), directiveFile = value("--directive-file"), manifestFile = value("--manifest");
if (!projectDir || !isAbsolute(projectDir) || !directiveFile || !manifestFile) throw new Error("absolute --project-dir, --directive-file, and --manifest are required");
const bounded = (path: string) => { const target = resolve(projectDir, path); const rel = relative(resolve(projectDir), target); if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`host boundary path escapes project: ${path}`); return target; };
const directive = JSON.parse(readFileSync(bounded(directiveFile), "utf8"));
const manifest = JSON.parse(readFileSync(bounded(manifestFile), "utf8"));
if (directive.kind !== "run-stage" || directive.gate || !directive.stage) throw new Error("host boundary requires an executed non-gate run-stage directive");
if (directive.stage !== manifest.stage) throw new Error(`host boundary stage mismatch: ${directive.stage} != ${manifest.stage}`);
const result = spawnSync(process.execPath, [resolve(import.meta.dir, "d-feature-checks.ts"), "--project-dir", projectDir, "--input", manifestFile], { cwd: projectDir, encoding: "utf8" });
process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exit(result.status ?? 1);
