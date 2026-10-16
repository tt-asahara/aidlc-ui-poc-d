#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveDGitPersistence } from "./d-config.ts";
import { captureAuditBoundary, discoverCrossing, persistCrossing, type AuditBoundary } from "./d-persistence.ts";

type HookInput = { cwd?: string; session_id?: string; tool_use_id?: string; tool_input?: { command?: string }; tool_response?: unknown; tool_name?: string; agent_id?: string; agent_type?: string };
let input: HookInput = {};
try { input = JSON.parse(await Bun.stdin.text()); } catch { process.exit(0); }
const projectDir = input.cwd ?? process.env.CLAUDE_PROJECT_DIR;
const command = input.tool_input?.command ?? "";
const phase = process.argv[2] === "pre" ? "pre" : "post";
const isReport = /(?:aidlc-orchestrate(?:\.ts)?|aidlc(?:\.ts)?[^\n]*\bengine\s+orchestrate)[^\n]*\breport\b/.test(command);
if (!projectDir || input.agent_id || input.agent_type || !isReport) process.exit(0);

function markerPath(root: string): string | null {
  const gitDir = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: root, encoding: "utf8" });
  if (gitDir.status !== 0) return null;
  const identity = `${input.session_id ?? "session-unknown"}\0${input.tool_use_id ?? command}`;
  const key = createHash("sha256").update(identity).digest("hex");
  return resolve(root, gitDir.stdout.trim(), "aidlc-d-persistence", "report-markers", `${key}.json`);
}
function atomic(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}
function responseFailed(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.is_error === true || record.isError === true || record.success === false || (typeof record.exit_code === "number" && record.exit_code !== 0);
}

const marker = markerPath(projectDir);
if (!marker) process.exit(0);
if (phase === "pre") {
  try { atomic(marker, { version: 1, commandHash: createHash("sha256").update(command).digest("hex"), boundary: captureAuditBoundary(projectDir) }); } catch {}
  process.exit(0);
}
// PostToolUse ordering is authoritative only when it consumes the marker made
// for this exact report call and the tool itself succeeded.
if (!existsSync(marker) || responseFailed(input.tool_response)) { rmSync(marker, { force: true }); process.exit(0); }
try {
  const saved = JSON.parse(readFileSync(marker, "utf8")) as { version?: number; commandHash?: string; boundary?: AuditBoundary };
  rmSync(marker, { force: true });
  if (saved.version !== 1 || saved.commandHash !== createHash("sha256").update(command).digest("hex") || !saved.boundary) process.exit(0);
  const config = resolveDGitPersistence(projectDir);
  const crossing = discoverCrossing(projectDir, saved.boundary);
  const result = crossing ? persistCrossing(projectDir, config, crossing) : { status: "deferred", reason: "no completed/skipped/workflow crossing in report audit tail" };
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  // Workflow settlement is authoritative and is never rolled back by persistence.
  process.stderr.write(`D Git persistence deferred: ${error instanceof Error ? error.message : String(error)}\n`);
}
