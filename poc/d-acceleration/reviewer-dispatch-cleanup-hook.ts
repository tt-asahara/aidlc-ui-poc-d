#!/usr/bin/env bun
// Clears a leftover reviewer read-scope record from outside the framework.
// The official protocol leaves `.aidlc-engine/reviewer-dispatch.json` for the
// conductor to delete at step 3; when that step is missed, the reviewer-scope
// hook keeps refusing the next Unit's reviewer for up to six hours. Arm D
// closes the window deterministically from PostToolUse on the conductor's own
// review commands, without changing the official engine:
//   - a recorded verdict (`log review ... --verdict`, answered with
//     `reviewRecord`) removes the record naming that same stage and Unit;
//   - a new review request removes a record naming a different stage or Unit,
//     because the protocol allows one per-unit review window at a time.
// A record naming the same review as a new request is a NOT-READY re-invoke
// and is left for the conductor's fresh write.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { reviewerDispatchPath } from "../../core/tools/aidlc-lib.ts";

type HookInput = { cwd?: string; tool_name?: string; tool_input?: { command?: string }; tool_response?: unknown };
type DispatchRecord = { stage?: unknown; unit?: unknown };
export type ReviewCommand = { stage: string; unit: string | null; verdict: boolean };

const REVIEW_COMMAND = /(?:\bengine\s+log|\baidlc-log(?:\.ts)?)\s+review\b/g;

function flag(segment: string, name: string): string | null {
  const match = segment.match(new RegExp(`--${name}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|([^\\s;&|]+))`));
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

// One review invocation per command line; anything more is left alone rather
// than guessed at.
export function parseReviewCommand(command: string): ReviewCommand | null {
  const starts = [...command.matchAll(REVIEW_COMMAND)];
  if (starts.length !== 1) return null;
  const segment = command.slice(starts[0].index ?? 0).split(/\s*(?:&&|\|\||;|\n)\s*/)[0] ?? "";
  const stage = flag(segment, "stage");
  if (!stage) return null;
  return { stage, unit: flag(segment, "unit"), verdict: /--verdict(?:=|\s+)["']?(?:READY|NOT-READY)\b/.test(segment) };
}

function responseText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return [record.stdout, record.output, record.result].filter((part): part is string => typeof part === "string").join("\n");
}
function responseFailed(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.is_error === true || record.isError === true || record.success === false || record.interrupted === true ||
    (typeof record.exit_code === "number" && record.exit_code !== 0);
}

export function staleRecord(review: ReviewCommand, record: DispatchRecord, response: unknown): boolean {
  const sameReview = record.stage === review.stage && (record.unit ?? null) === review.unit;
  if (review.verdict) return sameReview && responseText(response).includes("\"reviewRecord\"");
  return !sameReview;
}

export function run(text: string): number {
  let input: HookInput = {};
  try { input = JSON.parse(text); } catch { return 0; }
  // The same precedence as the official reviewer-scope hook, so both resolve
  // one record path.
  const explicit = process.env.AIDLC_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR;
  const projectDir = explicit ? (isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit)) : input.cwd;
  const review = parseReviewCommand(input.tool_input?.command ?? "");
  if (!projectDir || input.tool_name !== "Bash" || !review || responseFailed(input.tool_response)) return 0;
  try {
    const path = reviewerDispatchPath(projectDir);
    if (!existsSync(path)) return 0;
    const record = JSON.parse(readFileSync(path, "utf8")) as DispatchRecord;
    if (staleRecord(review, record, input.tool_response)) rmSync(path, { force: true });
  } catch {
    // Cleanup is advisory: the official hook's six-hour orphan window remains.
  }
  return 0;
}
if (import.meta.main) process.exitCode = run(await Bun.stdin.text());
