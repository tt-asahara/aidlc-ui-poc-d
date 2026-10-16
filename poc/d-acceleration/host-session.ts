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
  return matches.at(-1)!.stage;
}

export function directiveProgressFingerprint(directive: Readonly<OfficialDirective>): string {
  const wave = directive.wave as Record<string, unknown> | undefined;
  const unit = directive.unit as Record<string, unknown> | string | undefined;
  return JSON.stringify({
    kind: directive.kind, stage: directive.stage ?? null, gate: directive.gate ?? null,
    unit: typeof unit === "string" ? unit : unit?.slug ?? unit?.name ?? null,
    waveBatch: wave?.batch_index ?? wave?.batchIndex ?? null,
    waveUnits: Array.isArray(wave?.entries) ? (wave!.entries as Array<Record<string, unknown>>).map((entry) => entry.unit ?? entry.slug) : [],
    attempt: directive.attempt ?? directive.attempt_id ?? null,
    reviewIteration: directive.review_iteration ?? directive.reviewIteration ?? null,
    reviewState: directive.review_state ?? null,
  });
}

export type HostSessionState = { startedAt: number; deadlineMs: number; maxSteps: number; steps: number; through: string | null; lastFingerprint?: string; lastStage?: string };
export function checkpointHostSession(state: HostSessionState, directive: Readonly<OfficialDirective>, now = Date.now()): { action: "continue" | "stop"; reason?: string; state: HostSessionState } {
  if (state.through && state.lastStage === state.through && directive.stage !== state.through) return { action: "stop", reason: "boundary-reached", state };
  if (now - state.startedAt >= state.deadlineMs) return { action: "stop", reason: "deadline-exceeded", state };
  if (state.steps >= state.maxSteps) return { action: "stop", reason: "max-steps-exceeded", state };
  const fingerprint = directiveProgressFingerprint(directive);
  if (fingerprint === state.lastFingerprint) return { action: "stop", reason: "no-progress", state };
  const next = { ...state, steps: state.steps + 1, lastFingerprint: fingerprint, lastStage: directive.stage ?? state.lastStage };
  // run-stage gate:true means execute the stage and then enter its approval
  // protocol. Only an actual ask is already waiting on the human.
  if (directive.kind === "ask") return { action: "stop", reason: "human-gate", state: next };
  if (directive.dangerous) return { action: "stop", reason: "dangerous-operation", state: next };
  return { action: "continue", state: next };
}
