#!/usr/bin/env bun
// D's parallel.enabled=false enforcement. One owner for "is D allowed to run
// more than one worker at a time" and for "may an official swarm hand-off
// proceed while D parallel is off".
//
// Semantics (documented in README.md and configuration.md):
// - OFF wins immediately: every D dispatch boundary (conductor step, scheduler
//   worker launch, read-only fanout batch, host checkpoint, invoke-swarm
//   hand-off) re-reads the configuration, so switching to OFF takes effect
//   before the next worker launch even inside a wave already in progress.
// - ON never widens work already in progress: a wave or fanout that began
//   under OFF stays at one worker; ON applies from the next D invocation.
// - An existing Intent whose official Construction Execution is `swarm` is
//   moved to `serial` only through the official `aidlc-state.ts
//   set-construction-execution serial` setter. Its guards stay authoritative:
//   when it refuses (for example an unattended run already in Construction),
//   D does not hand off any swarm and returns the one-line recovery instead.
// - AIDLC_USE_SWARM / flags.swarm only select the driver for an
//   `invoke-swarm` the engine already decided to issue; they never enable a
//   swarm by themselves. While D parallel is off no swarm hand-off proceeds,
//   whatever env/machine/project/local swarm flag is set.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { resolveDParallel } from "./d-config.ts";

export type ParallelGuardAction = "continue" | "refresh" | "stop";
export type ParallelSerialization = "parallel-enabled" | "already-serial" | "set-serial" | "refused" | "unavailable";
export type ParallelGuardResult = {
  action: ParallelGuardAction;
  reason: string;
  parallel: { enabled: boolean; maxConcurrentWorkers: number | null };
  construction: { executionBefore: string | null; serialization: ParallelSerialization; detail?: string };
  swarmHandOff: boolean;
  recovery?: string;
};

export const PARALLEL_OFF_RECOVERY =
  "D parallel.enabled is false in .claude/d-acceleration(.local).jsonc, but this Intent's official Construction Execution is still swarm. " +
  "Ask to switch it to serial (aidlc-state.ts set-construction-execution serial), or set parallel.enabled to true; D hands off no swarm until then.";

/** Current D master switch at this boundary. An unreadable configuration fails toward one worker. */
export function currentDParallelEnabled(projectDir: string): boolean {
  try { return resolveDParallel(projectDir).enabled; } catch { return false; }
}

/** A directive that would fan out parallel official workers (the official swarm hand-off). */
export function isSwarmHandOff(value: unknown): boolean {
  const directive = (value as any)?.directive ?? value;
  return directive?.kind === "invoke-swarm";
}

function officialExecution(stateTool: string, projectDir: string, env: NodeJS.ProcessEnv): string | null {
  const result = spawnSync(process.execPath, [stateTool, "get", "Construction Execution", "--project-dir", projectDir], { cwd: projectDir, env, encoding: "utf8", timeout: 30_000 });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

export function enforceParallelOff(options: { projectDir: string; engineDir?: string; directive?: unknown; env?: NodeJS.ProcessEnv; parallelEnabled?: boolean }): ParallelGuardResult {
  const env = options.env ?? process.env;
  const enabled = options.parallelEnabled ?? currentDParallelEnabled(options.projectDir);
  const swarmHandOff = options.directive !== undefined && isSwarmHandOff(options.directive);
  if (enabled) return { action: "continue", reason: "parallel-enabled", parallel: { enabled: true, maxConcurrentWorkers: null }, construction: { executionBefore: null, serialization: "parallel-enabled" }, swarmHandOff };
  const stateTool = join(options.engineDir ?? join(options.projectDir, ".claude", "tools"), "aidlc-state.ts");
  let executionBefore: string | null = null; let serialization: ParallelSerialization = "unavailable"; let detail: string | undefined;
  if (existsSync(stateTool)) {
    executionBefore = officialExecution(stateTool, options.projectDir, env);
    if (executionBefore !== "swarm") serialization = "already-serial";
    else {
      const set = spawnSync(process.execPath, [stateTool, "set-construction-execution", "serial", "--project-dir", options.projectDir], { cwd: options.projectDir, env, encoding: "utf8", timeout: 30_000 });
      if (set.status === 0) serialization = "set-serial";
      else { serialization = "refused"; detail = (set.stderr || set.stdout || "").trim().slice(0, 2000); }
    }
  }
  const parallel = { enabled: false, maxConcurrentWorkers: 1 };
  const construction = { executionBefore, serialization, ...(detail ? { detail } : {}) };
  if (swarmHandOff && serialization === "set-serial") return { action: "refresh", reason: "construction-execution-set-serial", parallel, construction, swarmHandOff };
  if (swarmHandOff) return { action: "stop", reason: "parallel-off-swarm-not-serialized", parallel, construction, swarmHandOff, recovery: PARALLEL_OFF_RECOVERY };
  // D's own work below this point is one worker at a time. A refused setter
  // does not block it; the recovery line travels with the result so the person
  // hears it now, and the later official swarm hand-off is still refused.
  if (serialization === "refused") return { action: "continue", reason: "parallel-off-serial-official-swarm-pending", parallel, construction, swarmHandOff, recovery: PARALLEL_OFF_RECOVERY };
  return { action: "continue", reason: serialization === "set-serial" ? "construction-execution-set-serial" : "parallel-off-serial", parallel, construction, swarmHandOff };
}

/** Counting gate for worker launches. The limit is re-read before every launch. */
export function createWorkerGate(limit: () => number) {
  let active = 0, maxActive = 0; const waiters: Array<() => void> = [];
  return {
    async acquire(): Promise<void> {
      while (active >= Math.max(1, limit())) await new Promise<void>((resolveWait) => waiters.push(resolveWait));
      active += 1; maxActive = Math.max(maxActive, active);
    },
    release(): void { active -= 1; for (const wake of waiters.splice(0)) wake(); },
    get maxActive(): number { return maxActive; },
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2); const value = (flag: string) => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; };
  const projectDir = value("--project-dir"); const directiveFile = value("--directive-file");
  if (!projectDir || !isAbsolute(projectDir)) throw new Error("--project-dir must be an absolute PRODUCT path");
  let directive: unknown;
  if (directiveFile) {
    const path = resolve(projectDir, directiveFile);
    if (relative(resolve(projectDir), path).startsWith("..")) throw new Error("directive file escapes project");
    directive = JSON.parse(readFileSync(path, "utf8"));
  }
  const result = enforceParallelOff({ projectDir, engineDir: value("--engine-dir"), directive });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.action === "stop") process.exitCode = 2;
}
