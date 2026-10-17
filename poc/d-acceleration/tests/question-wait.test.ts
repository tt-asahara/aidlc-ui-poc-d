import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateAiQuestions } from "../ai-question-controller.ts";
import { createAiApprovalGrant } from "../ai-approval-controller.ts";
import { recordHumanTurn } from "./human-turn.ts";
import { pendingHumanQuestion } from "../question-wait.ts";
import type { HostSessionState } from "../host-session.ts";

// F12: the bounded-run deadline measures D's working time. An in-stage
// questions file that only the person can answer pauses the clock; a set the
// delegated AI path may answer does not. Timing is controlled by editing the
// recorded journal timestamps, never by sleeping.
const STATE = "- **Scope**: greenfield\n- **Lifecycle Phase**: IDEATION\n- **Current Stage**: intent-capture\n- [-] intent-capture — EXECUTE\n";
const QUESTIONS_REL = "aidlc/spaces/default/intents/example/ideation/intent-capture/intent-capture-questions.md";
const MARKED = "## Q1 — Display currency\nChoose a display currency.\n[AI-Autonomy]: low-risk-reversible\n[Answer]:\n";
const UNMARKED = "## Q1 — Target audience\nWho is the product for?\n[Answer]:\n";

function project(opts: { delegate?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "d-question-wait-")), intent = join(root, "aidlc/spaces/default/intents/example");
  mkdirSync(join(root, ".claude"), { recursive: true }); mkdirSync(join(root, ".aidlc-engine"), { recursive: true });
  mkdirSync(dirname(join(root, QUESTIONS_REL)), { recursive: true });
  writeFileSync(join(root, "aidlc/spaces/default/intents/active-intent"), "example\n");
  writeFileSync(join(intent, "aidlc-state.md"), STATE);
  if (opts.delegate) {
    writeFileSync(join(root, ".claude/d-acceleration.jsonc"), JSON.stringify({ aiApproval: { mode: "stage-gates", minConfidence: 0.9 } }));
    writeFileSync(join(root, "delegation.txt"), "AI-DLC delegate-ai-approvals --scope greenfield --through construction --stages intent-capture");
    recordHumanTurn(root, "AI-DLC delegate-ai-approvals --scope greenfield --through construction --stages intent-capture");
    createAiApprovalGrant({ projectDir: root, userMessageFile: "delegation.txt", messageId: "msg-1", scope: "greenfield", through: "construction", allowedStages: ["intent-capture"] });
  }
  return { root, intent, grant: "aidlc/spaces/default/intents/example/decisions/ai-approval-delegation.json" };
}
const writeQuestions = (root: string, body: string) => writeFileSync(join(root, QUESTIONS_REL), body);
function blockingModel(root: string) {
  const path = join(root, "claude-block");
  const payload = { outcome: "block", reason: "depends on a product preference", confidence: 0.4, riskFlags: [], uncertainties: [], answers: [] };
  writeFileSync(path, `#!/bin/sh\ncat <<'AIDLC_EOF'\n${JSON.stringify({ result: JSON.stringify(payload) })}\nAIDLC_EOF\n`); chmodSync(path, 0o755);
  return path;
}

describe("pendingHumanQuestion reads recorded files only", () => {
  test("a blank set without delegation waits for the person; an answered set does not", () => {
    const { root } = project();
    expect(pendingHumanQuestion(root, "intent-capture")).toBeNull();
    writeQuestions(root, UNMARKED);
    expect(pendingHumanQuestion(root, "intent-capture")).toMatchObject({ path: QUESTIONS_REL, blankSlots: 1, reason: "no-delegation" });
    writeQuestions(root, UNMARKED.replace("[Answer]:", "[Answer]: Small teams"));
    expect(pendingHumanQuestion(root, "intent-capture")).toBeNull();
    // A stage that is not the current in-progress stage has no canonical target.
    writeQuestions(root, UNMARKED);
    expect(pendingHumanQuestion(root, "requirements-analysis")).toBeNull();
  });

  test("a delegable set is D work until the delegated path records a block on those exact bytes", async () => {
    const { root, intent, grant } = project({ delegate: true });
    writeQuestions(root, MARKED);
    expect(pendingHumanQuestion(root, "intent-capture")).toBeNull();
    const result = await evaluateAiQuestions({ projectDir: root, stage: "intent-capture", unit: null, questionsFile: QUESTIONS_REL, delegationFile: grant, evidenceFiles: [], claudeExecutable: blockingModel(root) });
    expect(result.status).toBe("block");
    const ledger = readFileSync(join(intent, "decisions", "ai-question-blocks.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ kind: "delegated-stage-question-block", stage: "intent-capture", questions: { path: QUESTIONS_REL } });
    expect(pendingHumanQuestion(root, "intent-capture")).toMatchObject({ reason: "delegated-path-blocked", sha256: ledger[0].questions.sha256 });
    // A new questions set (different bytes) is not covered by the old block.
    writeQuestions(root, MARKED.replace("display currency", "date format"));
    expect(pendingHumanQuestion(root, "intent-capture")).toBeNull();
    // An unmarked set can never take the delegated path.
    writeQuestions(root, UNMARKED);
    expect(pendingHumanQuestion(root, "intent-capture")).toMatchObject({ reason: "not-delegable" });
  });
});

const cli = join(import.meta.dir, "..", "host-session-cli.ts");
const SESSION = ".aidlc-engine/session.json";
const run = (root: string, args: string[]) => {
  const result = spawnSync(process.execPath, [cli, ...args, "--project-dir", root, "--session-file", SESSION], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
};
const readSession = (root: string) => JSON.parse(readFileSync(join(root, SESSION), "utf8")) as HostSessionState;
const writeSession = (root: string, state: HostSessionState) => writeFileSync(join(root, SESSION), `${JSON.stringify(state, null, 2)}\n`);
const checkpoint = (root: string, directive: object) => { writeFileSync(join(root, "directive.json"), JSON.stringify(directive)); return run(root, ["checkpoint", "--directive-file", "directive.json"]); };
const DEADLINE = 60_000;
function startedSession(root: string) {
  expect(run(root, ["init", "--active-stages", "intent-capture,requirements-analysis", "--deadline-ms", String(DEADLINE), "--max-steps", "16"]).action).toBe("continue");
  expect(checkpoint(root, { kind: "run-stage", stage: "intent-capture", receipt: "r1" }).action).toBe("continue");
}
const action = (root: string, body: () => void) => {
  const started = run(root, ["action-start"]);
  expect(started.action).toBe("continue");
  body();
  return run(root, ["action-finish", "--action-token", started.token]);
};

describe("host-session-cli records stage-question waits in the session journal", () => {
  test("a human question wait longer than the deadline, with a crash mid-wait, does not stop the run", () => {
    const { root } = project();
    startedSession(root);
    const finished = action(root, () => writeQuestions(root, UNMARKED));
    expect(finished).toMatchObject({ action: "continue", humanWait: "stage-question", state: { awaitingHuman: true, waitKind: "stage-question" } });
    const journal = readSession(root);
    expect(journal.humanWaits).toHaveLength(1);
    expect(journal.humanWaits![0]).toMatchObject({ kind: "stage-question", evidence: { path: QUESTIONS_REL, reason: "no-delegation", stage: "intent-capture" } });
    // Shift the recorded timeline: the session started and the wait began
    // ten deadlines ago (the host crashed while the person was thinking).
    const shift = DEADLINE * 10;
    writeSession(root, { ...journal, startedAt: journal.startedAt - shift, waitingSince: journal.waitingSince! - shift, humanWaits: journal.humanWaits!.map((wait) => ({ ...wait, startedAt: wait.startedAt - shift })) });
    // Re-entry after the crash: status and init both keep the session alive.
    expect(run(root, ["status"])).toMatchObject({ active: true, recoveredReason: null });
    expect(run(root, ["init", "--active-stages", "intent-capture,requirements-analysis", "--deadline-ms", String(DEADLINE), "--max-steps", "16"])).toMatchObject({ action: "continue", resumed: true });
    writeQuestions(root, UNMARKED.replace("[Answer]:", "[Answer]: Small teams"));
    const resumed = checkpoint(root, { kind: "run-stage", stage: "intent-capture", receipt: "r2" });
    expect(resumed.action).toBe("continue");
    const after = readSession(root);
    expect(after.waitingSince).toBeUndefined();
    expect(after.pausedMs!).toBeGreaterThanOrEqual(shift);
    expect(after.humanWaits![0].creditedMs).toBe(after.pausedMs);
    // A further resume (action-start) credits nothing more.
    action(root, () => {});
    expect(readSession(root).pausedMs).toBe(after.pausedMs);
  }, 30_000);

  test("active work beyond the deadline still stops", () => {
    const { root } = project();
    startedSession(root);
    action(root, () => {});
    const journal = readSession(root);
    expect(journal.waitingSince).toBeUndefined();
    writeSession(root, { ...journal, startedAt: journal.startedAt - DEADLINE - 1 });
    expect(checkpoint(root, { kind: "run-stage", stage: "requirements-analysis", receipt: "r3" })).toMatchObject({ action: "stop", reason: "deadline-exceeded", state: { terminalReason: "deadline-exceeded" } });
  }, 30_000);

  test("a delegated (AI-answerable) question set does not pause the clock", () => {
    const { root } = project({ delegate: true });
    startedSession(root);
    const finished = action(root, () => writeQuestions(root, MARKED));
    expect(finished).toMatchObject({ action: "continue", humanWait: null });
    const journal = readSession(root);
    expect(journal.waitingSince).toBeUndefined();
    expect(journal.humanWaits ?? []).toHaveLength(0);
    expect(existsSync(join(root, SESSION))).toBeTrue();
  }, 30_000);
});
