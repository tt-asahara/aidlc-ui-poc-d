import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OfficialDirective } from "./issue-autopilot.ts";

type Policy = { stages: Array<{ phase: string; stage: string }> };
export function resolveThroughBoundary(value: string | undefined, activeStages: readonly string[], policyPath = join(import.meta.dir, "stage-policy.json")): string | null {
  if (!value) return null;
  const policy = JSON.parse(readFileSync(policyPath, "utf8")) as Policy;
  const active = new Set(activeStages);
  if (policy.stages.some((entry) => entry.stage === value)) {
    if (!active.has(value)) throw new Error(`through stage is not active in this scope: ${value}`);
    return value;
  }
  const matches = policy.stages.filter((entry) => entry.phase === value && active.has(entry.stage));
  if (!matches.length) throw new Error(`through phase has no active stage in this scope: ${value}`);
  return matches[matches.length - 1].stage;
}

export function directiveProgressFingerprint(directive: Readonly<OfficialDirective>): string {
  const wave = directive.wave as Record<string, unknown> | undefined;
  const unit = directive.unit as Record<string, unknown> | string | undefined;
  return JSON.stringify({
    kind: directive.kind, stage: directive.stage ?? null, gate: directive.gate ?? null,
    unit: typeof unit === "string" ? unit : unit?.slug ?? unit?.name ?? null,
    waveBatch: wave?.batch_index ?? wave?.batchIndex ?? null,
    waveUnits: Array.isArray(wave?.entries) ? (wave.entries as Array<Record<string, unknown>>).map((entry) => entry.unit ?? entry.slug) : [],
    attempt: directive.attempt ?? directive.attempt_id ?? null,
    reviewIteration: directive.review_iteration ?? directive.reviewIteration ?? null,
    reviewState: directive.review_state ?? null,
    // Steering can be streamed in several otherwise-identical parts.  These
    // official continuation tokens are progress; omitting them makes part 2
    // look like a replay of part 1 and stops before the stage body is loaded.
    part: directive.part ?? null,
    parts: directive.parts ?? directive.total_parts ?? null,
    receipt: directive.receipt ?? null,
    progressToken: directive.progress_token ?? directive.progressToken ?? directive.cursor ?? null,
  });
}

export type HostSessionClaim = { issueNumber: number; owner: string; leaseMs: number };
export type HostSessionState = { startedAt: number; deadlineMs: number; maxSteps: number; steps: number; through: string | null; activeStages?: string[]; lastFingerprint?: string; lastStage?: string; claim?: HostSessionClaim; hostAction?: { token: string; startedAt: number }; awaitingHuman?: boolean; waitingToken?: string; waitingSince?: number; pausedMs?: number; endedAt?: number; terminalReason?: string };

// The deadline bounds unattended continuation, not the person's think time.
// For an unclaimed generic-auto session, time spent waiting at an official
// human gate (`ask`) is credited back. A claimed Issue session keeps wall-clock
// semantics because its lease heartbeat must not outlive the deadline.
export function activeElapsedMs(state: HostSessionState, now = Date.now()): number {
  const waiting = !state.claim && state.awaitingHuman && state.waitingSince !== undefined ? Math.max(0, now - state.waitingSince) : 0;
  return now - state.startedAt - (state.pausedMs ?? 0) - waiting;
}
export function leaveHumanWait(state: HostSessionState, now = Date.now()): HostSessionState {
  if (state.waitingSince === undefined) return state;
  const credited = !state.claim && state.awaitingHuman ? Math.max(0, now - state.waitingSince) : 0;
  const { waitingSince: _ignored, ...rest } = state;
  return { ...rest, pausedMs: (state.pausedMs ?? 0) + credited };
}
export function checkpointHostSession(state: HostSessionState, directive: Readonly<OfficialDirective>, now = Date.now()): { action: "continue" | "stop"; reason?: string; state: HostSessionState } {
  state = leaveHumanWait(state, now);
  if (state.endedAt) return { action: "stop", reason: "session-ended", state };
  // Report the ordinary crossing as boundary-reached; already-passed is only
  // for a session that never observed the boundary stage (e.g. a resume).
  if (state.through && state.lastStage === state.through && directive.stage !== state.through) return { action: "stop", reason: "boundary-reached", state };
  if (state.through && state.activeStages?.length && directive.stage) {
    const boundary = state.activeStages.indexOf(state.through), current = state.activeStages.indexOf(directive.stage);
    if (boundary >= 0 && current > boundary) return { action: "stop", reason: "boundary-already-passed", state };
  }
  if (activeElapsedMs(state, now) >= state.deadlineMs) return { action: "stop", reason: "deadline-exceeded", state };
  if (state.steps >= state.maxSteps) return { action: "stop", reason: "max-steps-exceeded", state };
  const fingerprint = directiveProgressFingerprint(directive);
  if (fingerprint === state.lastFingerprint) return { action: "stop", reason: "no-progress", state };
  const next = { ...state, steps: state.steps + 1, lastFingerprint: fingerprint, lastStage: directive.stage ?? state.lastStage };
  if (directive.completed || directive.kind === "complete") return { action: "stop", reason: "complete", state: next };
  // run-stage gate:true means execute the stage and then enter its approval
  // protocol. Only an actual ask is already waiting on the human.
  if (directive.kind === "ask") return { action: "stop", reason: "human-gate", state: { ...next, waitingSince: now } };
  return { action: "continue", state: next };
}
