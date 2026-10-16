#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { checkpointHostSession, resolveThroughBoundary, type HostSessionClaim, type HostSessionState } from "./host-session.ts";
import { createFileClaimStore, issueAutopilotRuntimePaths } from "./issue-autopilot-runtime.ts";

const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const projectDir = value("--project-dir"), sessionFile = value("--session-file"), mode = args[0];
if (!projectDir || !isAbsolute(projectDir) || !sessionFile) throw new Error("mode, absolute --project-dir, and --session-file are required");
const path = resolve(projectDir, sessionFile);
if (relative(resolve(projectDir), path).startsWith("..")) throw new Error("session file escapes project");
const heartbeat = `${path}.heartbeat.json`, heartbeatStop = `${path}.heartbeat-stop`, heartbeatFailed = `${path}.heartbeat-failed`;
const remove = (target: string) => { try { unlinkSync(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } };
const save = (state: HostSessionState) => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(tmp, path);
};
const readState = () => JSON.parse(readFileSync(path, "utf8")) as HostSessionState;
const storeFor = (state: HostSessionState) => state.claim ? createFileClaimStore({ directory: issueAutopilotRuntimePaths(projectDir).claims, leaseMs: state.claim.leaseMs }) : null;
const heartbeatInterval = (state: HostSessionState) => Math.max(10, Math.min(1000, Math.floor((state.claim?.leaseMs ?? 30_000) / 3)));
const renew = async (state: HostSessionState) => {
  const store = storeFor(state);
  return state.claim && store?.renew ? store.renew(state.claim.issueNumber, state.claim.owner) : "renewed" as const;
};

if (mode === "init") {
  const active = (value("--active-stages") ?? "").split(",").filter(Boolean), through = resolveThroughBoundary(value("--through"), active);
  const issueNumber = Number(value("--issue-number") ?? 0), owner = value("--owner"), leaseMs = Number(value("--claim-lease-ms") ?? value("--deadline-ms") ?? 900000);
  const claim: HostSessionClaim | undefined = issueNumber > 0 && owner ? { issueNumber, owner, leaseMs } : undefined;
  if ((issueNumber > 0) !== Boolean(owner)) throw new Error("init requires both --issue-number and --owner for a claimed session");
  if (existsSync(path)) {
    const existing = readState();
    const sameClaim = JSON.stringify(existing.claim ?? null) === JSON.stringify(claim ?? null);
    if (!existing.endedAt) {
      if (existing.through !== through || !sameClaim) throw new Error("active host session does not match requested boundary/claim");
      if (existing.hostAction || existsSync(heartbeat)) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "host-action-busy", state: existing })}\n`); process.exit(0); }
      process.stdout.write(`${JSON.stringify({ action: "continue", resumed: true, state: existing })}\n`); process.exit(0);
    }
  }
  const state = { startedAt: Date.now(), deadlineMs: Number(value("--deadline-ms") ?? 900000), maxSteps: Number(value("--max-steps") ?? 64), steps: 0, through, ...(claim ? { claim } : {}) };
  save(state); process.stdout.write(`${JSON.stringify({ action: "continue", state })}\n`); process.exit(0);
}

if (mode === "status") {
  const state = existsSync(path) ? readState() : null;
  process.stdout.write(`${JSON.stringify({ active: Boolean(state && !state.endedAt), actionActive: existsSync(heartbeat), heartbeatFailed: existsSync(heartbeatFailed), state })}\n`);
  process.exit(0);
}

if (mode === "heartbeat-worker") {
  const token = value("--action-token");
  if (!token) throw new Error("heartbeat-worker requires --action-token");
  while (existsSync(heartbeat)) {
    const record = JSON.parse(readFileSync(heartbeat, "utf8")) as { token: string };
    if (record.token !== token || existsSync(heartbeatStop)) break;
    const state = readState();
    const reason = existsSync(issueAutopilotRuntimePaths(projectDir).stop) ? "operator-stop"
      : Date.now() - state.startedAt >= state.deadlineMs ? "deadline-exceeded"
      : await renew(state) !== "renewed" ? "claim-lost" : null;
    if (reason) { writeFileSync(heartbeatFailed, `${JSON.stringify({ token, reason, at: Date.now() })}\n`, { mode: 0o600 }); break; }
    await Bun.sleep(heartbeatInterval(state));
  }
  process.exit(0);
}

if (!existsSync(path)) throw new Error("host session does not exist");
const state = readState();
if (mode === "action-start") {
  if (state.endedAt) throw new Error("host session already ended");
  if (existsSync(heartbeat)) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "host-action-busy", state })}\n`); process.exit(0); }
  if (await renew(state) !== "renewed") { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "claim-lost", state })}\n`); process.exit(0); }
  remove(heartbeatStop); remove(heartbeatFailed);
  const token = randomUUID();
  writeFileSync(heartbeat, `${JSON.stringify({ token, startedAt: Date.now() })}\n`, { mode: 0o600, flag: "wx" });
  save({ ...state, hostAction: { token, startedAt: Date.now() }, awaitingHuman: false });
  const child = spawn(process.execPath, [import.meta.filename, "heartbeat-worker", "--project-dir", projectDir, "--session-file", sessionFile, "--action-token", token], { cwd: projectDir, detached: true, stdio: "ignore" });
  child.unref();
  process.stdout.write(`${JSON.stringify({ action: "continue", token, heartbeatEveryMs: heartbeatInterval(state) })}\n`); process.exit(0);
}

if (mode === "action-finish") {
  const token = value("--action-token");
  const record = existsSync(heartbeat) ? JSON.parse(readFileSync(heartbeat, "utf8")) as { token: string } : null;
  if (!token || !record || record.token !== token) throw new Error("action-finish token does not own the active heartbeat");
  writeFileSync(heartbeatStop, "stop\n", { mode: 0o600 });
  await Bun.sleep(Math.min(100, Math.max(20, Math.floor((state.claim?.leaseMs ?? 300) / 3))));
  remove(heartbeat); remove(heartbeatStop);
  const failure = existsSync(heartbeatFailed) ? JSON.parse(readFileSync(heartbeatFailed, "utf8")) as { reason: string } : null;
  remove(heartbeatFailed);
  const reason = failure?.reason ?? (await renew(state) !== "renewed" ? "claim-lost" : null);
  const finishedState: HostSessionState = { ...readState(), hostAction: undefined, ...(reason ? { endedAt: Date.now(), terminalReason: reason } : {}) };
  save(finishedState);
  if (reason && state.claim) await storeFor(state)?.release(state.claim.issueNumber, state.claim.owner);
  process.stdout.write(`${JSON.stringify(reason ? { action: "stop", reason, state: finishedState } : { action: "continue", state: finishedState })}\n`); process.exit(0);
}

if (mode !== "checkpoint") throw new Error("mode must be init, status, checkpoint, action-start, or action-finish");
const directiveFile = value("--directive-file");
if (!directiveFile) throw new Error("checkpoint requires --directive-file");
const directivePath = resolve(projectDir, directiveFile);
if (relative(resolve(projectDir), directivePath).startsWith("..")) throw new Error("directive file escapes project");
const directive = JSON.parse(readFileSync(directivePath, "utf8"));
if (state.hostAction || existsSync(heartbeat)) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "host-action-busy", state })}\n`); process.exit(0); }
const lock = `${path}.lock`;
let lockFd: number | undefined;
try {
  try { lockFd = openSync(lock, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (Date.now() - statSync(lock).mtimeMs <= state.deadlineMs) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "session-busy", state })}\n`); process.exit(0); }
    unlinkSync(lock); lockFd = openSync(lock, "wx", 0o600);
  }
  const store = storeFor(state);
  const finish = async (current: HostSessionState, reason: string) => {
    const ended = { ...current, endedAt: Date.now(), terminalReason: reason }; save(ended);
    if (state.claim) await store?.release(state.claim.issueNumber, state.claim.owner);
    return ended;
  };
  if (existsSync(issueAutopilotRuntimePaths(projectDir).stop)) {
    remove(issueAutopilotRuntimePaths(projectDir).stop);
    const ended = await finish(state, "operator-stop");
    process.stdout.write(`${JSON.stringify({ action: "stop", reason: "operator-stop", state: ended })}\n`);
  } else if (await renew(state) !== "renewed") {
    const ended = await finish(state, "claim-lost");
    process.stdout.write(`${JSON.stringify({ action: "stop", reason: "claim-lost", state: ended })}\n`);
  } else {
    const result = checkpointHostSession(state, directive);
    let finalState: HostSessionState;
    if (result.action === "stop" && result.reason !== "human-gate") finalState = await finish(result.state, result.reason ?? "terminal-stop");
    else { finalState = { ...result.state, awaitingHuman: result.reason === "human-gate" }; save(finalState); }
    process.stdout.write(`${JSON.stringify({ ...result, state: finalState })}\n`);
  }
} finally {
  if (lockFd !== undefined) closeSync(lockFd);
  remove(lock);
}
