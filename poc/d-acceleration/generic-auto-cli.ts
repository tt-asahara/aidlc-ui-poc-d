#!/usr/bin/env bun
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveDAutomation } from "./d-config.ts";

type Json = Record<string, unknown>;
const argv = process.argv.slice(2);
const value = (flag: string) => { const at = argv.indexOf(flag); return at < 0 ? undefined : argv[at + 1]; };
const command = argv[0];
const projectDir = value("--project-dir");
if (!projectDir || !isAbsolute(projectDir)) throw new Error("--project-dir must be an absolute PRODUCT path");
const product = realpathSync(projectDir);
const sessionFile = value("--session-file") ?? ".aidlc-engine/d-autopilot-session.json";
const runtime = join(product, ".claude", "tools");
const hostCli = join(import.meta.dir, "host-session-cli.ts");

function runJson(executable: string, args: string[]): Json {
  const result = spawnSync(process.execPath, [executable, ...args, "--project-dir", product], { cwd: product, encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || result.error?.message || "command failed").trim());
  try { return JSON.parse(result.stdout) as Json; }
  catch { throw new Error("command did not return a JSON directive"); }
}

function confinedRegularFile(input: string): string {
  const requested = resolve(product, input);
  if (relative(product, requested).startsWith("..") || !existsSync(requested)) throw new Error("description file must exist inside PRODUCT");
  const metadata = lstatSync(requested);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("description file must be a regular non-symlink file");
  const actual = realpathSync(requested);
  if (relative(product, actual).startsWith("..")) throw new Error("description file resolves outside PRODUCT");
  if (metadata.size > 262_144) throw new Error("description file exceeds 262144 bytes");
  return actual;
}

const auto = resolveDAutomation(product);
if (command === "start") {
  if (!auto.enabled) { process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "disabled" })}\n`); process.exit(0); }
  if (auto.sessionOnly) { process.stdout.write(`${JSON.stringify({ status: "stopped", reason: "session-only" })}\n`); process.exit(0); }
  const descriptionFile = value("--description-file");
  if (!descriptionFile) throw new Error("start requires --description-file");
  const path = confinedRegularFile(descriptionFile);
  const description = readFileSync(path, "utf8");
  if (!description.trim()) throw new Error("description must not be empty");
  // The user's text is one argv value, never shell source. The official router
  // owns scope selection and intent creation; --auto is deliberately absent.
  const directive = runJson(join(runtime, "aidlc-orchestrate.ts"), ["next", description]);
  process.stdout.write(`${JSON.stringify({
    status: "routed", reason: directive.kind === "ask" ? "human-gate" : "official-routing",
    directive,
    hostControl: { through: auto.through ?? null, maxSteps: auto.maxSteps, deadlineMs: auto.deadlineMs },
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === "init") {
  if (!auto.enabled) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "disabled" })}\n`); process.exit(0); }
  if (auto.sessionOnly) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "session-only" })}\n`); process.exit(0); }
  const activeStages = value("--active-stages");
  if (!activeStages) throw new Error("init requires --active-stages from the official active scope graph");
  const result = runJson(hostCli, ["init", "--session-file", sessionFile, "--active-stages", activeStages, ...(auto.through ? ["--through", auto.through] : []), "--deadline-ms", String(auto.deadlineMs), "--max-steps", String(auto.maxSteps)]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

if (["status", "stop", "checkpoint", "action-start", "action-finish"].includes(command)) {
  const forwarded: string[] = [command, "--session-file", sessionFile];
  for (const flag of ["--directive-file", "--action-token"]) { const supplied = value(flag); if (supplied) forwarded.push(flag, supplied); }
  process.stdout.write(`${JSON.stringify(runJson(hostCli, forwarded), null, 2)}\n`);
  process.exit(0);
}

throw new Error("mode must be start, init, status, stop, checkpoint, action-start, or action-finish");
