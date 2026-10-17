#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { checkpointHostSession, resolveThroughBoundary, type HostSessionClaim, type HostSessionState } from "./host-session.ts";
import { createFileClaimStore, issueAutopilotRuntimePaths } from "./issue-autopilot-runtime.ts";
import type { ParallelGuardResult } from "./parallel-guard.ts";

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
const renewResilient = async (state: HostSessionState) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await renew(state) === "renewed") return "renewed" as const;
    if (!state.claim) return "lost" as const;
    try {
      const claim = JSON.parse(readFileSync(`${issueAutopilotRuntimePaths(projectDir).claims}/issue-${state.claim.issueNumber}.json`, "utf8")) as { owner?: string; expiresAt?: number };
      if (claim.owner !== state.claim.owner || typeof claim.expiresAt !== "number" || claim.expiresAt <= Date.now()) return "lost" as const;
    } catch { return "lost" as const; }
    await Bun.sleep(20);
  }
  return "lost" as const;
};
type HeartbeatRecord = { token: string; pid: number | null; startedAt: number; lastRenewedAt: number; expiresAt: number; status: "starting" | "running" | "stopping" | "failed" };
const lifecycleLock = `${path}.lifecycle.lock`;
const writeHeartbeat = (record: HeartbeatRecord) => {
  const temporary = `${heartbeat}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, heartbeat);
};
const readHeartbeat = (): HeartbeatRecord | null => {
  try { return JSON.parse(readFileSync(heartbeat, "utf8")) as HeartbeatRecord; } catch { return null; }
};
const pidAlive = (pid: number | null) => {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const withLifecycleLock = async <T>(operation: () => Promise<T>): Promise<T | null> => {
  const acquire = () => {
    const fd = openSync(lifecycleLock, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`, "utf8");
    return fd;
  };
  let fd: number;
  try { fd = acquire(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let owner: { pid?: number } | null = null;
    try { owner = JSON.parse(readFileSync(lifecycleLock, "utf8")) as { pid?: number }; } catch {}
    if ((owner?.pid && pidAlive(owner.pid)) || (!owner?.pid && Date.now() - statSync(lifecycleLock).mtimeMs < 5000)) return null;
    try { unlinkSync(lifecycleLock); } catch { return null; }
    try { fd = acquire(); } catch { return null; }
  }
  try { return await operation(); }
  finally { closeSync(fd); remove(lifecycleLock); }
};
const terminalize = async (state: HostSessionState, reason: string): Promise<HostSessionState> => {
  const ended = { ...state, hostAction: undefined, endedAt: Date.now(), terminalReason: reason };
  save(ended);
  if (state.claim) await storeFor(state)?.release(state.claim.issueNumber, state.claim.owner);
  remove(heartbeat); remove(heartbeatStop); remove(heartbeatFailed);
  remove(issueAutopilotRuntimePaths(projectDir).stop);
  return ended;
};
const claimIsOwned = (state: HostSessionState) => {
  if (!state.claim) return true;
  try {
    const claim = JSON.parse(readFileSync(`${issueAutopilotRuntimePaths(projectDir).claims}/issue-${state.claim.issueNumber}.json`, "utf8")) as { owner?: string; expiresAt?: number };
    return claim.owner === state.claim.owner && typeof claim.expiresAt === "number" && claim.expiresAt > Date.now();
  } catch { return false; }
};
const recoverLifecycle = async (): Promise<{ state: HostSessionState | null; recoveredReason?: string; busy?: boolean }> => {
  if (!existsSync(path)) return { state: null };
  const recovered = await withLifecycleLock(async () => {
    let state = readState();
    if (state.endedAt) { remove(heartbeat); remove(heartbeatStop); remove(heartbeatFailed); return { state }; }
    if (existsSync(issueAutopilotRuntimePaths(projectDir).stop)) {
      state = await terminalize(state, "operator-stop"); return { state, recoveredReason: "operator-stop" };
    }
    const record = readHeartbeat();
    const failure = existsSync(heartbeatFailed) ? JSON.parse(readFileSync(heartbeatFailed, "utf8")) as { token?: string; reason?: string } : null;
    const expectedToken = state.hostAction?.token ?? state.waitingToken;
    if (!expectedToken && !record) {
      if (!claimIsOwned(state)) { state = await terminalize(state, "claim-lost"); return { state, recoveredReason: "claim-lost" }; }
      return { state };
    }
    if (!expectedToken && record?.status === "stopping") { remove(heartbeat); remove(heartbeatStop); remove(heartbeatFailed); return { state }; }
    let reason: string | null = null;
    if (!expectedToken || !record || expectedToken !== record.token) reason = "host-action-orphaned";
    else if (failure?.token === record.token) reason = failure.reason ?? "heartbeat-failed";
    else if (existsSync(issueAutopilotRuntimePaths(projectDir).stop)) reason = "operator-stop";
    else if (Date.now() - state.startedAt >= state.deadlineMs) reason = "deadline-exceeded";
    else if (record.status === "failed") reason = "heartbeat-failed";
    else if (!pidAlive(record.pid) || record.expiresAt <= Date.now()) reason = "heartbeat-stale";
    if (!reason && !claimIsOwned(state)) reason = "claim-lost";
    if (reason) { state = await terminalize(state, reason); return { state, recoveredReason: reason }; }
    return { state };
  });
  return recovered ?? { state: readState(), busy: true };
};
const resumeWaitingHuman = async (state: HostSessionState): Promise<HostSessionState> => {
  if (!state.awaitingHuman || !state.waitingToken) return state;
  const resumed = await withLifecycleLock(async () => {
    const current = readState(), record = readHeartbeat();
    if (!record || record.token !== current.waitingToken) return terminalize(current, "host-action-orphaned");
    writeHeartbeat({ ...record, status: "stopping" });
    writeFileSync(heartbeatStop, "stop\n", { mode: 0o600 });
    const joinDeadline = Date.now() + heartbeatInterval(current) * 2 + 500;
    while (pidAlive(record.pid) && Date.now() < joinDeadline) await Bun.sleep(20);
    const failure = existsSync(heartbeatFailed) ? JSON.parse(readFileSync(heartbeatFailed, "utf8")) as { reason: string } : null;
    if (failure?.reason || pidAlive(record.pid)) return terminalize(current, failure?.reason ?? "heartbeat-worker-stuck");
    if (await renewResilient(current) !== "renewed") return terminalize(current, "claim-lost");
    const next = { ...current, awaitingHuman: false, waitingToken: undefined };
    save(next); remove(heartbeat); remove(heartbeatStop); remove(heartbeatFailed);
    return next;
  });
  return resumed ?? state;
};

if (mode === "init") {
  const active = (value("--active-stages") ?? "").split(",").filter(Boolean), through = resolveThroughBoundary(value("--through"), active);
  const issueNumber = Number(value("--issue-number") ?? 0), owner = value("--owner"), leaseMs = Number(value("--claim-lease-ms") ?? value("--deadline-ms") ?? 900000);
  const claim: HostSessionClaim | undefined = issueNumber > 0 && owner ? { issueNumber, owner, leaseMs } : undefined;
  if ((issueNumber > 0) !== Boolean(owner)) throw new Error("init requires both --issue-number and --owner for a claimed session");
  if (existsSync(path)) {
    let existing = (await recoverLifecycle()).state ?? readState();
    if (!existing.endedAt && existing.awaitingHuman) existing = await resumeWaitingHuman(existing);
    const sameClaim = JSON.stringify(existing.claim ?? null) === JSON.stringify(claim ?? null);
    if (!existing.endedAt) {
      if (existing.through !== through || JSON.stringify(existing.activeStages ?? []) !== JSON.stringify(active) || !sameClaim) throw new Error("active host session does not match requested scope/boundary/claim");
      if (existing.hostAction || existsSync(heartbeat)) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "host-action-busy", state: existing })}\n`); process.exit(0); }
      process.stdout.write(`${JSON.stringify({ action: "continue", resumed: true, state: existing })}\n`); process.exit(0);
    }
  }
  const state = { startedAt: Date.now(), deadlineMs: Number(value("--deadline-ms") ?? 900000), maxSteps: Number(value("--max-steps") ?? 64), steps: 0, through, activeStages: active, ...(claim ? { claim } : {}) };
  if (claim && !claimIsOwned(state)) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "claim-lost", state })}\n`); process.exit(0); }
  save(state); process.stdout.write(`${JSON.stringify({ action: "continue", state })}\n`); process.exit(0);
}

if (mode === "status") {
  const recovery = await recoverLifecycle(), state = recovery.state;
  process.stdout.write(`${JSON.stringify({ active: Boolean(state && !state.endedAt), actionActive: Boolean(state?.hostAction), heartbeatFailed: existsSync(heartbeatFailed), recoveredReason: recovery.recoveredReason ?? null, lifecycleBusy: recovery.busy ?? false, state })}\n`);
  process.exit(0);
}

if (mode === "stop") {
  if (!existsSync(path)) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "no-session", state: null })}\n`); process.exit(0); }
  mkdirSync(dirname(issueAutopilotRuntimePaths(projectDir).stop), { recursive: true });
  writeFileSync(issueAutopilotRuntimePaths(projectDir).stop, "stop\n", { mode: 0o600 });
  const recovery = await recoverLifecycle();
  process.stdout.write(`${JSON.stringify({ action: "stop", reason: recovery.state?.terminalReason ?? recovery.recoveredReason ?? "operator-stop", state: recovery.state })}\n`);
  process.exit(0);
}

if (mode === "heartbeat-worker") {
  const token = value("--action-token");
  if (!token) throw new Error("heartbeat-worker requires --action-token");
  while (existsSync(heartbeat)) {
    const record = readHeartbeat();
    if (!record) break;
    if (record.token !== token || existsSync(heartbeatStop)) break;
    const state = readState();
    const reason = existsSync(issueAutopilotRuntimePaths(projectDir).stop) ? "operator-stop"
      : Date.now() - state.startedAt >= state.deadlineMs ? "deadline-exceeded"
      : await renewResilient(state) !== "renewed" ? "claim-lost" : null;
    if (reason) {
      writeHeartbeat({ ...record, pid: process.pid, status: "failed", lastRenewedAt: Date.now(), expiresAt: Date.now() });
      writeFileSync(heartbeatFailed, `${JSON.stringify({ token, reason, at: Date.now() })}\n`, { mode: 0o600 }); break;
    }
    const renewedAt = Date.now();
    writeHeartbeat({ ...record, pid: process.pid, status: "running", lastRenewedAt: renewedAt, expiresAt: renewedAt + (state.claim?.leaseMs ?? 30_000) });
    await Bun.sleep(heartbeatInterval(state));
  }
  process.exit(0);
}

if (!existsSync(path)) throw new Error("host session does not exist");
const state = readState();
if (mode === "action-start") {
  const started = await withLifecycleLock(async () => {
    const current = readState();
    if (current.endedAt) return { action: "stop", reason: "session-ended", state: current };
    if (current.hostAction || existsSync(heartbeat)) return { action: "stop", reason: "host-action-busy", state: current };
    if (await renew(current) !== "renewed") return { action: "stop", reason: "claim-lost", state: await terminalize(current, "claim-lost") };
    remove(heartbeatStop); remove(heartbeatFailed);
    const token = randomUUID(), startedAt = Date.now();
    save({ ...current, hostAction: { token, startedAt }, awaitingHuman: false });
    writeHeartbeat({ token, pid: null, startedAt, lastRenewedAt: startedAt, expiresAt: startedAt + (current.claim?.leaseMs ?? 30_000), status: "starting" });
    try {
      const child = spawn(process.execPath, [import.meta.filename, "heartbeat-worker", "--project-dir", projectDir, "--session-file", sessionFile, "--action-token", token], { cwd: projectDir, detached: true, stdio: "ignore" });
      if (!child.pid) throw new Error("heartbeat worker did not start");
      writeHeartbeat({ token, pid: child.pid, startedAt, lastRenewedAt: startedAt, expiresAt: startedAt + (current.claim?.leaseMs ?? 30_000), status: "running" });
      child.unref();
      return { action: "continue", token, heartbeatEveryMs: heartbeatInterval(current) };
    } catch {
      return { action: "stop", reason: "heartbeat-start-failed", state: await terminalize(current, "heartbeat-start-failed") };
    }
  });
  process.stdout.write(`${JSON.stringify(started ?? { action: "stop", reason: "lifecycle-busy", state })}\n`); process.exit(0);
}

if (mode === "action-finish") {
  const token = value("--action-token");
  const finished = await withLifecycleLock(async () => {
    const current = readState(), record = readHeartbeat();
    if (!token || !record || record.token !== token || current.hostAction?.token !== token) throw new Error("action-finish token does not own the active heartbeat");
    writeHeartbeat({ ...record, status: "stopping" });
    writeFileSync(heartbeatStop, "stop\n", { mode: 0o600 });
    const joinDeadline = Date.now() + heartbeatInterval(current) * 2 + 500;
    while (pidAlive(record.pid) && Date.now() < joinDeadline) await Bun.sleep(20);
    const failure = existsSync(heartbeatFailed) ? JSON.parse(readFileSync(heartbeatFailed, "utf8")) as { reason: string } : null;
    let reason = failure?.reason ?? (pidAlive(record.pid) ? "heartbeat-worker-stuck" : null);
    if (!reason) {
      if (await renewResilient(current) !== "renewed") reason = "claim-lost";
    }
    if (reason) return { action: "stop", reason, state: await terminalize(current, reason) };
    // Persist the completed transition before deleting the stopping record. If
    // cleanup crashes, recovery recognizes status=stopping as harmless debris.
    const finishedState: HostSessionState = { ...current, hostAction: undefined };
    save(finishedState);
    remove(heartbeat); remove(heartbeatStop); remove(heartbeatFailed);
    return { action: "continue", state: finishedState };
  });
  process.stdout.write(`${JSON.stringify(finished ?? { action: "stop", reason: "lifecycle-busy", state })}\n`); process.exit(0);
}

if (mode !== "checkpoint") throw new Error("mode must be init, status, stop, checkpoint, action-start, or action-finish");
const directiveFile = value("--directive-file");
if (!directiveFile) throw new Error("checkpoint requires --directive-file");
const directivePath = resolve(projectDir, directiveFile);
if (relative(resolve(projectDir), directivePath).startsWith("..")) throw new Error("directive file escapes project");
const directive = JSON.parse(readFileSync(directivePath, "utf8"));
if (state.hostAction || existsSync(heartbeat)) { process.stdout.write(`${JSON.stringify({ action: "stop", reason: "host-action-busy", state })}\n`); process.exit(0); }
const lock = `${path}.lock`;
// Loaded only for checkpoints so the other modes keep their start-up cost.
const { currentDParallelEnabled, enforceParallelOff } = await import("./parallel-guard.ts");
let parallelGuard: ParallelGuardResult | null = null;
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
  } else if ((parallelGuard = currentDParallelEnabled(projectDir) ? null : enforceParallelOff({ projectDir, directive, parallelEnabled: false }))?.action === "refresh") {
    // The official setter moved this Intent to serial; the swarm directive is
    // stale. Not a step: the host obtains a fresh official next and checkpoints it.
    process.stdout.write(`${JSON.stringify({ action: "refresh", reason: parallelGuard!.reason, parallelGuard, state })}\n`);
  } else if (parallelGuard?.action === "stop") {
    const ended = await finish(state, parallelGuard.reason);
    process.stdout.write(`${JSON.stringify({ action: "stop", reason: parallelGuard.reason, recovery: parallelGuard.recovery, parallelGuard, state: ended })}\n`);
  } else {
    const result = checkpointHostSession(state, directive);
    let finalState: HostSessionState;
    if (result.action === "stop" && result.reason !== "human-gate") finalState = await finish(result.state, result.reason ?? "terminal-stop");
    else if (result.reason === "human-gate" && result.state.claim) {
      const leaseMs = result.state.claim.leaseMs;
      const guarded = await withLifecycleLock(async () => {
        const token = randomUUID(), startedAt = Date.now();
        const waiting = { ...result.state, awaitingHuman: true, waitingToken: token };
        save(waiting);
        writeHeartbeat({ token, pid: null, startedAt, lastRenewedAt: startedAt, expiresAt: startedAt + leaseMs, status: "starting" });
        try {
          const child = spawn(process.execPath, [import.meta.filename, "heartbeat-worker", "--project-dir", projectDir, "--session-file", sessionFile, "--action-token", token], { cwd: projectDir, detached: true, stdio: "ignore" });
          if (!child.pid) throw new Error("waiting heartbeat worker did not start");
          writeHeartbeat({ token, pid: child.pid, startedAt, lastRenewedAt: startedAt, expiresAt: startedAt + leaseMs, status: "running" });
          child.unref(); return waiting;
        } catch { return terminalize(waiting, "heartbeat-start-failed"); }
      });
      finalState = guarded ?? await finish(result.state, "lifecycle-busy");
    } else { finalState = { ...result.state, awaitingHuman: result.reason === "human-gate" }; save(finalState); }
    process.stdout.write(`${JSON.stringify({ ...result, ...(parallelGuard ? { parallelGuard } : {}), state: finalState })}\n`);
  }
} finally {
  if (lockFd !== undefined) closeSync(lockFd);
  remove(lock);
}
