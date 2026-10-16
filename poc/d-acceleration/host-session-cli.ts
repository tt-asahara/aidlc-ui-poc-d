#!/usr/bin/env bun
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { checkpointHostSession, resolveThroughBoundary, type HostSessionClaim, type HostSessionState } from "./host-session.ts";
import { createFileClaimStore, issueAutopilotRuntimePaths } from "./issue-autopilot-runtime.ts";

const args = process.argv.slice(2), value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const projectDir = value("--project-dir"), sessionFile = value("--session-file"), mode = args[0];
if (!projectDir || !isAbsolute(projectDir) || !sessionFile) throw new Error("mode, absolute --project-dir, and --session-file are required");
const path = resolve(projectDir, sessionFile); if (relative(resolve(projectDir), path).startsWith("..")) throw new Error("session file escapes project");
const save = (state: HostSessionState) => { mkdirSync(dirname(path), { recursive: true }); const tmp = `${path}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" }); renameSync(tmp, path); };
if (mode === "init") {
  const active = (value("--active-stages") ?? "").split(",").filter(Boolean), through = resolveThroughBoundary(value("--through"), active);
  const issueNumber = Number(value("--issue-number") ?? 0), owner = value("--owner"), leaseMs = Number(value("--claim-lease-ms") ?? value("--deadline-ms") ?? 900000);
  const claim: HostSessionClaim | undefined = issueNumber > 0 && owner ? { issueNumber, owner, leaseMs } : undefined;
  if ((issueNumber > 0) !== Boolean(owner)) throw new Error("init requires both --issue-number and --owner for a claimed session");
  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, "utf8")) as HostSessionState;
    const sameClaim = JSON.stringify(existing.claim ?? null) === JSON.stringify(claim ?? null);
    if (!existing.endedAt) {
      if (existing.through !== through || !sameClaim) throw new Error("active host session does not match requested boundary/claim");
      process.stdout.write(`${JSON.stringify({ action: "continue", resumed: true, state: existing })}\n`); process.exit(0);
    }
  }
  const state = { startedAt: Date.now(), deadlineMs: Number(value("--deadline-ms") ?? 900000), maxSteps: Number(value("--max-steps") ?? 64), steps: 0, through, ...(claim ? { claim } : {}) };
  save(state); process.stdout.write(`${JSON.stringify({ action: "continue", state })}\n`); process.exit(0);
}
if (mode !== "checkpoint") throw new Error("mode must be init or checkpoint");
const stop = issueAutopilotRuntimePaths(projectDir).stop;
const directiveFile = value("--directive-file"); if (!directiveFile) throw new Error("checkpoint requires --directive-file");
const directivePath = resolve(projectDir, directiveFile); if (relative(resolve(projectDir), directivePath).startsWith("..")) throw new Error("directive file escapes project");
const state = JSON.parse(readFileSync(path, "utf8")) as HostSessionState, directive = JSON.parse(readFileSync(directivePath, "utf8"));
const claimStore = state.claim ? createFileClaimStore({ directory: issueAutopilotRuntimePaths(projectDir).claims, leaseMs: state.claim.leaseMs }) : null;
const lock = `${path}.lock`;
let lockFd: number;
try { lockFd = openSync(lock, "wx", 0o600); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  // A crashed host cannot strand the session forever. Never reap a lock that
  // could still belong to a live checkpoint within the bounded deadline.
  if (Date.now() - statSync(lock).mtimeMs <= state.deadlineMs) {
    process.stdout.write(`${JSON.stringify({ action: "stop", reason: "session-busy", state })}\n`); process.exit(0);
  }
  unlinkSync(lock); lockFd = openSync(lock, "wx", 0o600);
}
const finish = async (current: HostSessionState, reason: string) => {
  const ended = { ...current, endedAt: Date.now(), terminalReason: reason }; save(ended);
  if (state.claim) await claimStore?.release(state.claim.issueNumber, state.claim.owner);
  return ended;
};
if (existsSync(stop)) {
  unlinkSync(stop); const ended = await finish(state, "operator-stop"); closeSync(lockFd); unlinkSync(lock);
  process.stdout.write(`${JSON.stringify({ action: "stop", reason: "operator-stop", state: ended })}\n`); process.exit(0);
}
if (state.claim) {
  const renewed = claimStore?.renew ? await claimStore.renew(state.claim.issueNumber, state.claim.owner) : "lost";
  if (renewed !== "renewed") {
    const ended = await finish(state, "claim-lost"); closeSync(lockFd); unlinkSync(lock);
    process.stdout.write(`${JSON.stringify({ action: "stop", reason: "claim-lost", state: ended })}\n`); process.exit(0);
  }
}
const result = checkpointHostSession(state, directive);
// Human approval is a pause inside this durable session.  All other stops end
// the host session and release only its own lease, allowing a later poll.
let finalState: HostSessionState;
if (result.action === "stop" && result.reason !== "human-gate") finalState = await finish(result.state, result.reason ?? "terminal-stop");
else { save(result.state); finalState = result.state; }
closeSync(lockFd); unlinkSync(lock);
process.stdout.write(`${JSON.stringify({ ...result, state: finalState })}\n`);
