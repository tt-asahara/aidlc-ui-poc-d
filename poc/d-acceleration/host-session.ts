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
export type HumanWaitKind = "official-ask" | "stage-question";
/**
 * One entry per pause, appended when the wait starts and closed when D resumes
 * (the next checkpoint or action-start). `creditedMs` is what the deadline
 * gave back; a claimed session records its waits with `creditedMs: 0`.
 */
export type HumanWaitRecord = { kind: HumanWaitKind; startedAt: number; endedAt?: number; creditedMs?: number; evidence?: Record<string, unknown> };
export type ScopeChangeRecord = { at: number; from: { through: string | null; activeStages: string[] }; to: { through: string | null; activeStages: string[] } };
export type HostSessionState = { startedAt: number; deadlineMs: number; maxSteps: number; steps: number; through: string | null; activeStages?: string[]; lastFingerprint?: string; lastStage?: string; claim?: HostSessionClaim; hostAction?: { token: string; startedAt: number }; awaitingHuman?: boolean; waitingToken?: string; waitingSince?: number; waitKind?: HumanWaitKind; humanWaits?: HumanWaitRecord[]; pausedMs?: number; endedAt?: number; terminalReason?: string; actionsSinceCheckpoint?: number; identicalRepeats?: number; scopeChanges?: ScopeChangeRecord[] };

// A gated run-stage legitimately comes back unchanged across turns while one
// stage attempt runs (questions, summary, artifacts, review, learnings) until
// the stage reports awaiting-approval. Repeating the same directive is
// therefore progress when D finished a host action since the last checkpoint,
// or the person replied to a wait. Without either it is a true replay. A cap
// on consecutive identical directives still bounds a loop that keeps acting
// without the engine ever moving.
export const MAX_IDENTICAL_REPEATS = 8;

/** Records that a host action finished; the next identical directive is then not a replay. */
export function recordHostActionFinished(state: HostSessionState): HostSessionState {
  return { ...state, actionsSinceCheckpoint: (state.actionsSinceCheckpoint ?? 0) + 1 };
}

/**
 * Re-binds an active session to the stage list and boundary of a scope the
 * person changed mid-run. The boundary is re-resolved against the new list
 * (a phase name maps to that phase's last active stage). Steps, deadline,
 * claim and waits are kept; the change is appended to `scopeChanges`.
 */
export function rescopeHostSession(state: HostSessionState, activeStages: readonly string[], throughValue: string | undefined, now = Date.now(), policyPath?: string): HostSessionState {
  if (state.endedAt) throw new Error("rescope needs an active host session; this one has ended");
  if (!activeStages.length) throw new Error("rescope requires --active-stages");
  const through = resolveThroughBoundary(throughValue, activeStages, policyPath);
  const change: ScopeChangeRecord = { at: now, from: { through: state.through, activeStages: [...(state.activeStages ?? [])] }, to: { through, activeStages: [...activeStages] } };
  return { ...state, through, activeStages: [...activeStages], scopeChanges: [...(state.scopeChanges ?? []), change] };
}

// The single owner of deadline accounting. The deadline bounds D's unattended
// working time, not the person's think time. For an unclaimed generic-auto
// session, time spent waiting for the person is credited back, whether the wait
// is an official human gate (`ask`) or an in-stage questions file the person
// must answer (`stage-question`, detected from recorded files by
// `question-wait.ts`). The open wait is persisted as `waitingSince` in the
// session journal, so a crash or restart mid-wait neither loses the pause nor
// counts it twice: `leaveHumanWait` folds it into `pausedMs` and closes the
// `humanWaits` entry in the same atomic save. A claimed Issue session keeps
// wall-clock semantics because its lease heartbeat must not outlive the
// deadline. There is no separate wall-clock ceiling for unclaimed sessions;
// active time, `maxSteps`, the `through` boundary and no-progress still bound
// runaway work.
export function activeElapsedMs(state: HostSessionState, now = Date.now()): number {
  const waiting = !state.claim && state.awaitingHuman && state.waitingSince !== undefined ? Math.max(0, now - state.waitingSince) : 0;
  return now - state.startedAt - (state.pausedMs ?? 0) - waiting;
}
export function enterHumanWait(state: HostSessionState, kind: HumanWaitKind, now = Date.now(), evidence?: Record<string, unknown>): HostSessionState {
  // A wait already open keeps its original start; restarting it would lose time.
  if (state.waitingSince !== undefined) return state;
  return { ...state, awaitingHuman: true, waitingSince: now, waitKind: kind, humanWaits: [...(state.humanWaits ?? []), { kind, startedAt: now, ...(evidence ? { evidence } : {}) }] };
}
export function leaveHumanWait(state: HostSessionState, now = Date.now()): HostSessionState {
  if (state.waitingSince === undefined) return state;
  const credited = !state.claim && state.awaitingHuman ? Math.max(0, now - state.waitingSince) : 0;
  const { waitingSince: _ignored, waitKind: _kind, ...rest } = state;
  const waits = [...(state.humanWaits ?? [])];
  const open = waits.length - 1;
  if (open >= 0 && waits[open].endedAt === undefined && waits[open].startedAt === state.waitingSince) waits[open] = { ...waits[open], endedAt: now, creditedMs: credited };
  return { ...rest, pausedMs: (state.pausedMs ?? 0) + credited, ...(state.humanWaits ? { humanWaits: waits } : {}) };
}
export function checkpointHostSession(state: HostSessionState, directive: Readonly<OfficialDirective>, now = Date.now()): { action: "continue" | "stop"; reason?: string; state: HostSessionState } {
  const repliedSinceCheckpoint = state.waitingSince !== undefined;
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
  let identicalRepeats = 0;
  if (fingerprint === state.lastFingerprint) {
    const worked = (state.actionsSinceCheckpoint ?? 0) > 0 || repliedSinceCheckpoint;
    if (!worked) return { action: "stop", reason: "no-progress", state };
    identicalRepeats = (state.identicalRepeats ?? 0) + 1;
    if (identicalRepeats >= MAX_IDENTICAL_REPEATS) return { action: "stop", reason: "no-progress", state: { ...state, identicalRepeats } };
  }
  const next = { ...state, steps: state.steps + 1, lastFingerprint: fingerprint, lastStage: directive.stage ?? state.lastStage, actionsSinceCheckpoint: 0, identicalRepeats };
  if (directive.completed || directive.kind === "complete") return { action: "stop", reason: "complete", state: next };
  // run-stage gate:true means execute the stage and then enter its approval
  // protocol. Only an actual ask is already waiting on the human.
  if (directive.kind === "ask") return { action: "stop", reason: "human-gate", state: enterHumanWait(next, "official-ask", now, { stage: directive.stage ?? null, gate: directive.gate ?? null }) };
  return { action: "continue", state: next };
}
