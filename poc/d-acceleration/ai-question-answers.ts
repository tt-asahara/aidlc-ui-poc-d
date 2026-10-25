#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { grantHumanTurnRefusal } from "./ai-approval-controller.ts";

// D-owned delegated-question grammar, target resolver, and settler.
//
// core/ is byte-identical to upstream AI-DLC v2.11.0, so this file lives in
// the D layer and never writes the official audit or engine state. A settled
// AI answer is recorded only in the Intent's D-owned ledger
// `decisions/ai-question-answers.jsonl` (see AI_QUESTION_ANSWER_LEDGER) and in
// the questions file's own `[Answer Source]` / `[AI Decision ID]` provenance
// lines. It is never a HUMAN_TURN or QUESTION_ANSWERED row.

const SHA = /^[a-f0-9]{64}$/;
const UNIT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The one owner of the delegated-question file grammar. The controller,
// question-wait, and this settler all import it, so the eligibility parser and the settlement
// parser can never drift apart.
//
// Accepted grammar, deliberately ASCII and exact (no `\b`, whose ASCII word
// boundary misreads Japanese text): a question heading is `## Q<ASCII digits>`
// followed by end of line or any character that is not a letter/number/`_`
// (so `## Q1 — 表示通貨` and `## Q1：表示通貨` are Q1, while `## Q1a`, `## Q１`
// with a full-width digit, `## Ｑ1`, `## Q1回答` and `### Q1` are not headings).
// Answer slots are `[Answer]:` with an ASCII colon; a full-width `[Answer]：`
// is not a slot. Anything outside this grammar is never guessed at: it changes
// the heading/slot counts, and the count checks then fail closed.
export const QUESTION_HEADING = /^##[ \t]+([Qq][0-9]+)(?![\p{L}\p{N}_])[^\r\n]*$/gmu;
export const LOW_RISK_MARKER_LINE = /^[ \t]*\[AI-Autonomy\]:[ \t]*low-risk-reversible[ \t]*$/;
export const questionTemplate = (body: string): string => body.replace(/^(\s*\[Answer\]:)[^\r\n]*$/gm, "$1").replace(/^\s*\[(?:Answer Source|AI Decision ID)\]:[^\r\n]*(?:\r?\n)?/gm, "");
export const answerValues = (body: string): string[] => [...body.matchAll(/^\s*\[Answer\]:[ \t]*(.*?)[ \t]*$/gm)].map((match) => match[1].trim());
export function questionSections(body: string): Array<{ id: string; body: string }> {
  const headings = [...body.matchAll(QUESTION_HEADING)], ids = headings.map((heading) => heading[1].toUpperCase());
  if (new Set(ids).size !== ids.length) return [];
  return headings.map((heading, index) => ({ id: ids[index], body: body.slice(heading.index!, headings[index + 1]?.index ?? body.length) }));
}
/**
 * A section is eligible only when it holds exactly one `[Answer]:` slot and
 * exactly one exact `[AI-Autonomy]: low-risk-reversible` line placed before
 * that slot. Any other `[AI-Autonomy]` line (another value, a full-width
 * colon, a duplicate, a marker after the slot) makes it malformed.
 */
export function sectionEligibility(section: string): "eligible" | "unmarked" | "malformed" {
  const lines = section.split(/\r?\n/), answers = lines.flatMap((line, index) => /^\s*\[Answer\]:/.test(line) ? [index] : []);
  const markers = lines.flatMap((line, index) => /^[ \t]*\[AI-Autonomy\]/.test(line) ? [index] : []);
  if (answers.length !== 1) return "malformed";
  if (markers.length === 0) return "unmarked";
  if (markers.length !== 1 || !LOW_RISK_MARKER_LINE.test(lines[markers[0]]) || markers[0] > answers[0]) return "malformed";
  return "eligible";
}

/** Per-Unit Construction stages whose stage file writes `<record>/construction/{unit-name}/<stage>/<stage>-questions.md`. */
export const PER_UNIT_QUESTION_STAGES: ReadonlySet<string> = new Set(["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design"]);
// The engine writes this questions file itself (Plan Approval); no agent may.
const ENGINE_OWNED_QUESTION_STAGES: ReadonlySet<string> = new Set(["code-generation"]);

export function stateValue(body: string, field: string): string | undefined { return body.match(new RegExp(`^\\s*-\\s*\\*\\*${escape(field)}\\*\\*:\\s*(.+?)\\s*$`, "im"))?.[1]?.trim(); }

/**
 * The single owner of "which questions file may an AI answer right now".
 * Stage-level (unit === null): the stage is Current Stage, marked
 * `[-] <stage> — EXECUTE`, and the file is
 * `<intent>/<phase>/<stage>/<stage>-questions.md`.
 * Per-Unit (Construction design stages, unit !== null): the runtime Unit
 * mirror names this Unit in progress on this stage, the stage is still open,
 * the Construction Iteration is a solo stage-major or unit-major walk, and the
 * file is `<intent>/construction/<unit>/<stage>/<stage>-questions.md`.
 * Everything else (team ownership, code-generation, a per-Unit stage while a
 * Unit is active but no Unit named, an unknown iteration) fails closed.
 */
export function resolveAiQuestionTarget(root: string, intentDir: string, stateBody: string, stage: string, unit: string | null): { ok: true; canonicalPath: string } | { ok: false; reason: string } {
  const rel = (path: string) => relative(root, path).split(sep).join("/");
  // The engine writes the phase upper-case (`IDEATION`) while record directories are lower-case.
  const phase = stateValue(stateBody, "Lifecycle Phase")?.toLowerCase(), current = stateValue(stateBody, "Current Stage");
  const stageLine = (marks: string) => new RegExp(`^\\s*-\\s*\\[${marks}\\]\\s+${escape(stage)}\\s+—\\s+EXECUTE\\s*$`, "m").test(stateBody);
  if (!phase) return { ok: false, reason: "state has no Lifecycle Phase" };
  if (ENGINE_OWNED_QUESTION_STAGES.has(stage)) return { ok: false, reason: "the engine owns this stage's questions file; it is never AI-answered" };
  const activeUnit = stateValue(stateBody, "Active Unit") ?? null, unitStage = stateValue(stateBody, "Unit Stage") ?? null, unitState = stateValue(stateBody, "Unit State") ?? null;
  if (unit === null) {
    if (phase === "construction" && PER_UNIT_QUESTION_STAGES.has(stage) && activeUnit !== null) return { ok: false, reason: "a Unit is active on a per-Unit Construction stage; name it with --unit" };
    if (current !== stage || !stageLine("-")) return { ok: false, reason: "question stage is not the current in-progress stage" };
    return { ok: true, canonicalPath: rel(join(intentDir, phase, stage, `${stage}-questions.md`)) };
  }
  if (!UNIT_NAME.test(unit)) return { ok: false, reason: "invalid Unit name" };
  if (phase !== "construction" || !PER_UNIT_QUESTION_STAGES.has(stage)) return { ok: false, reason: "per-Unit questions are supported only for per-Unit Construction design stages" };
  if ((stateValue(stateBody, "Unit Ownership") ?? "solo") !== "solo") return { ok: false, reason: "team-owned Unit gates are not supported for AI question answers" };
  if (activeUnit !== unit || unitStage !== stage || unitState !== "in-progress") return { ok: false, reason: "the named Unit is not in progress on this stage" };
  const iteration = stateValue(stateBody, "Construction Iteration");
  if (iteration === "stage-major") { if (current !== stage || !stageLine("-")) return { ok: false, reason: "question stage is not the current in-progress stage" }; }
  else if (iteration === "unit-major") { if (!stageLine("[- ]") || !current || !PER_UNIT_QUESTION_STAGES.has(current)) return { ok: false, reason: "the Unit's stage is not open in the unit-major walk" }; }
  else return { ok: false, reason: "unsupported Construction Iteration for per-Unit AI questions" };
  return { ok: true, canonicalPath: rel(join(intentDir, "construction", unit, stage, `${stage}-questions.md`)) };
}

function inside(root: string, path: string) { const rel = relative(root, path); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); }
function readBound(root: string, input: unknown, expected: unknown, label: string): { path: string; bytes: Buffer } {
  if (typeof input !== "string" || !input || isAbsolute(input) || input.split(/[\\/]/).includes("..") || typeof expected !== "string" || !SHA.test(expected)) throw new Error(`invalid ${label} binding`);
  const candidate = resolve(root, input); if (!existsSync(candidate) || lstatSync(candidate).isSymbolicLink()) throw new Error(`${label} is missing or a symlink`);
  const actual = realpathSync(candidate), bytes = readFileSync(actual); if (!inside(root, actual) || hash(bytes) !== expected) throw new Error(`${label} hash or path changed`); return { path: input, bytes };
}
function activeIntent(root: string) { const spaceFile = join(root, "aidlc", "active-space"), space = existsSync(spaceFile) ? readFileSync(spaceFile, "utf8").trim() : "default", intents = join(root, "aidlc", "spaces", space, "intents"), intent = readFileSync(join(intents, "active-intent"), "utf8").trim(), dir = realpathSync(join(intents, intent)); if (!inside(root, dir)) throw new Error("active Intent escapes project"); return { space, intent, dir }; }

/** Intent-relative D ledger of settled delegated AI answers. Not the official AI-DLC audit. */
export const AI_QUESTION_ANSWER_LEDGER = join("decisions", "ai-question-answers.jsonl");
export type AiQuestionAnswerLedgerRow = { schemaVersion: 1; kind: "d-delegated-question-answer"; ledger: "d-acceleration (not the official AI-DLC audit)"; actor: "ai"; decisionId: string; stage: string; unit: string | null; questionId: string; answer: string; answerSource: string; reason: string; questionsFile: string; questionsTemplateSha256: string; delegationSha256: string; confidence: number; requestedModel: string; runtimeReportedModel: string; settledAt: string };

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function lockHolderAlive(lockPath: string): boolean {
  try {
    const { pid } = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
    if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS || typeof pid !== "number") return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists under another user; anything else (ESRCH, an
    // unreadable or half-written lock past its grace period) is stale.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    if (code === "ESRCH") return false;
    try { return Date.now() - statSync(lockPath).mtimeMs < 1_000; } catch { return true; }
  }
}

/**
 * Runs `body` holding an exclusive `<path>.lock` (O_CREAT|O_EXCL). A lock whose
 * holder process is gone, or that is older than LOCK_STALE_MS, is removed and
 * retaken; a live holder is waited for up to LOCK_WAIT_MS, then this refuses.
 */
export function withLedgerLock<T>(path: string, body: () => T): T {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`, deadline = Date.now() + LOCK_WAIT_MS;
  let fd: number | undefined;
  while (fd === undefined) {
    try { fd = openSync(lockPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!lockHolderAlive(lockPath)) { try { unlinkSync(lockPath); } catch { /* another waiter removed it */ } continue; }
      if (Date.now() > deadline) throw new Error(`D ledger is busy (${lockPath}); rerun the same command`);
      sleep(5 + Math.floor(Math.random() * 20));
    }
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    return body();
  } finally {
    closeSync(fd);
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  }
}

/** Appends JSONL rows with one O_APPEND write plus fsync. Callers hold the ledger lock. */
export function appendJsonl(path: string, rows: readonly unknown[]): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`D ledger must not be a symlink: ${path}`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "a", 0o600);
  try { writeSync(fd, rows.map((row) => `${JSON.stringify(row)}\n`).join("")); fsyncSync(fd); } finally { closeSync(fd); }
}

const ledgerHas = (path: string, decisionId: string) => existsSync(path) && readFileSync(path, "utf8").split(/\r?\n/).some((line) => { if (!line.trim()) return false; try { return JSON.parse(line).decisionId === decisionId; } catch { return false; } });

/**
 * Settles one decision's rows exactly once: the replay check and the append
 * run under the same exclusive ledger lock, so concurrent settlers neither
 * lose rows nor duplicate a decisionId. Returns false when already recorded.
 */
export function appendLedgerOnce<Row = AiQuestionAnswerLedgerRow>(path: string, decisionId: string, rows: () => Row[]): boolean {
  return withLedgerLock(path, () => {
    if (ledgerHas(path, decisionId)) return false;
    appendJsonl(path, rows());
    return true;
  });
}

export function settleAiAnswers(projectDir: string, stage: string, decisionFile: string, unit: string | null = null) {
  if (!isAbsolute(projectDir)) throw new Error("--project-dir must be absolute");
  const root = realpathSync(projectDir), active = activeIntent(root); if (!stage) throw new Error("stage is required");
  const decisionBinding = resolve(root, decisionFile); if (!inside(active.dir, decisionBinding) || !existsSync(decisionBinding) || lstatSync(decisionBinding).isSymbolicLink()) throw new Error("AI decision file must be inside active Intent");
  const decision: any = JSON.parse(readFileSync(realpathSync(decisionBinding), "utf8"));
  if (decision.schemaVersion !== 1 || decision.kind !== "delegated-stage-question" || decision.actor !== "ai" || decision.outcome !== "answer" || decision.stage !== stage || !SHA.test(decision.decisionId) || !Array.isArray(decision.answers) || decision.answers.length === 0 || decision.riskFlags?.length || decision.uncertainties?.length) throw new Error("invalid AI question decision");
  if (!("unit" in decision) || decision.unit !== unit) throw new Error("AI decision Unit does not match the requested Unit");
  const state = readBound(root, decision.state?.path, decision.state?.sha256, "state"); if (!inside(active.dir, resolve(root, state.path))) throw new Error("state binding is outside active Intent");
  const stateBody = state.bytes.toString("utf8");
  const target = resolveAiQuestionTarget(root, active.dir, stateBody, stage, unit); if (!target.ok) throw new Error(`AI answer target refused: ${target.reason}`);
  const grant = readBound(root, decision.delegation?.path, decision.delegation?.sha256, "delegation"); const grantValue: any = JSON.parse(grant.bytes.toString("utf8"));
  const unbound = grantHumanTurnRefusal(active.dir, grantValue); if (unbound) throw new Error(`delegation does not authorize this AI answer: ${unbound}`);
  const stateScope = stateValue(stateBody, "Scope");
  if (grantValue.mode !== "stage-gates" || !grantValue.allowedStages?.includes(stage) || grantValue.scope !== stateScope || grantValue.messageId !== decision.delegation.messageId || grantValue.requestSha256 !== decision.delegation.requestSha256 || decision.confidence < Number(grantValue.minConfidence ?? 1)) throw new Error("delegation does not authorize this AI answer");
  if (decision.questions?.path !== target.canonicalPath) throw new Error("questions file is not canonical for the current stage");
  const questionsPath = resolve(root, decision.questions?.path ?? ""); if (!inside(active.dir, questionsPath) || !existsSync(questionsPath) || lstatSync(questionsPath).isSymbolicLink()) throw new Error("questions binding is invalid"); const questions = readFileSync(realpathSync(questionsPath), "utf8");
  if (hash(questionTemplate(questions)) !== decision.questions.templateSha256) throw new Error("questions changed outside answer slots"); const actualAnswers = answerValues(questions);
  if (actualAnswers.length !== decision.answers.length || actualAnswers.some((answer, index) => !answer || answer !== decision.answers[index].answer)) throw new Error("questions file answers do not match the AI decision");
  const sections = questionSections(questions);
  if (sections.length !== decision.answers.length || sections.some((section, index) => {
    const escapedAnswer = escape(decision.answers[index].answer), escapedSource = escape(decision.answers[index].source), escapedId = escape(decision.decisionId);
    return section.id !== decision.answers[index].questionId || !new RegExp(`^\\s*\\[Answer\\]:\\s*${escapedAnswer}\\s*\\r?\\n\\s*\\[Answer Source\\]:\\s*${escapedSource}\\s*\\r?\\n\\s*\\[AI Decision ID\\]:\\s*${escapedId}\\s*$`, "m").test(section.body);
  })) throw new Error("questions file lacks exact per-question AI answer provenance");
  for (const [index, answer] of decision.answers.entries()) {
    if (answer.index !== index || !["delegated-ai-assumption", "researched-fact"].includes(answer.source) || typeof answer.reason !== "string" || !answer.reason.trim() || !Array.isArray(answer.evidence)) throw new Error("invalid AI answer provenance");
    for (const evidence of answer.evidence) { const bound = readBound(root, evidence.path, evidence.sha256, "evidence"); if (!inside(active.dir, resolve(root, bound.path))) throw new Error("evidence binding is outside active Intent"); }
  }
  if (!Array.isArray(decision.config)) throw new Error("invalid configuration binding");
  const configCandidates = [".claude/d-acceleration.jsonc", ".claude/d-acceleration.json", ".claude/d-acceleration.local.jsonc", ".claude/d-acceleration.local.json"], currentConfigPaths = configCandidates.filter((path) => existsSync(join(root, path))).sort(), boundConfigPaths = decision.config.map((item: any) => item.path).sort();
  if (canonical(currentConfigPaths) !== canonical(boundConfigPaths)) throw new Error("configuration file set changed");
  for (const item of decision.config) readBound(root, item.path, item.sha256, "configuration");
  if (typeof decision.requiredConfidence !== "number" || decision.confidence < decision.requiredConfidence || typeof decision.reason !== "string" || !decision.reason.trim() || typeof decision.model?.requested !== "string") throw new Error("invalid confidence or model binding");
  const { decisionId: _id, createdAt: _created, ...payload } = decision;
  if (hash(canonical(payload)) !== decision.decisionId) throw new Error("AI decision ID does not bind its inputs");
  const ledgerPath = join(active.dir, AI_QUESTION_ANSWER_LEDGER);
  const result = { recorded: "d-ai-question-ledger", ledger: relative(root, ledgerPath).split(sep).join("/"), stage, ...(unit === null ? {} : { unit }), count: decision.answers.length, decisionId: decision.decisionId };
  const settledAt = new Date().toISOString();
  const appended = appendLedgerOnce(ledgerPath, decision.decisionId, () => decision.answers.map((answer: any) => ({ schemaVersion: 1, kind: "d-delegated-question-answer", ledger: "d-acceleration (not the official AI-DLC audit)", actor: "ai", decisionId: decision.decisionId, stage, unit, questionId: answer.questionId, answer: answer.answer, answerSource: answer.source, reason: answer.reason, questionsFile: decision.questions.path, questionsTemplateSha256: decision.questions.templateSha256, delegationSha256: decision.delegation.sha256, confidence: decision.confidence, requestedModel: decision.model.requested, runtimeReportedModel: decision.model.runtimeReported ?? "unreported", settledAt })));
  return appended ? result : { ...result, reused: true };
}

if (import.meta.main) { try { const args = process.argv.slice(2), one = (flag: string) => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; }; const project = one("--project-dir"); if (!project || !isAbsolute(project)) throw new Error("--project-dir must be absolute"); process.stdout.write(`${JSON.stringify(settleAiAnswers(project, one("--stage") ?? "", one("--ai-decision-file") ?? "", one("--unit") ?? null))}\n`); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(2); } }
