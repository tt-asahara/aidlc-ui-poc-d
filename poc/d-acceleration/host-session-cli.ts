#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { checkpointHostSession, resolveThroughBoundary, type HostSessionState } from "./host-session.ts";
import { issueAutopilotRuntimePaths } from "./issue-autopilot-runtime.ts";

const args = process.argv.slice(2), value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const projectDir = value("--project-dir"), sessionFile = value("--session-file"), mode = args[0];
if (!projectDir || !isAbsolute(projectDir) || !sessionFile) throw new Error("mode, absolute --project-dir, and --session-file are required");
const path = resolve(projectDir, sessionFile); if (relative(resolve(projectDir), path).startsWith("..")) throw new Error("session file escapes project");
const save = (state: HostSessionState) => { mkdirSync(dirname(path), { recursive: true }); const tmp = `${path}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" }); renameSync(tmp, path); };
if (mode === "init") {
  const active = (value("--active-stages") ?? "").split(",").filter(Boolean), through = resolveThroughBoundary(value("--through"), active);
  const state = { startedAt: Date.now(), deadlineMs: Number(value("--deadline-ms") ?? 900000), maxSteps: Number(value("--max-steps") ?? 64), steps: 0, through };
  save(state); process.stdout.write(`${JSON.stringify({ action: "continue", state })}\n`); process.exit(0);
}
if (mode !== "checkpoint") throw new Error("mode must be init or checkpoint");
const stop = issueAutopilotRuntimePaths(projectDir).stop;
if (existsSync(stop)) { unlinkSync(stop); process.stdout.write(`${JSON.stringify({ action: "stop", reason: "operator-stop" })}\n`); process.exit(0); }
const directiveFile = value("--directive-file"); if (!directiveFile) throw new Error("checkpoint requires --directive-file");
const directivePath = resolve(projectDir, directiveFile); if (relative(resolve(projectDir), directivePath).startsWith("..")) throw new Error("directive file escapes project");
const state = JSON.parse(readFileSync(path, "utf8")) as HostSessionState, directive = JSON.parse(readFileSync(directivePath, "utf8"));
const result = checkpointHostSession(state, directive); save(result.state); process.stdout.write(`${JSON.stringify(result)}\n`);
