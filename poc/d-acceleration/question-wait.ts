import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { resolveDAiApproval } from "./d-config.ts";
import { AI_QUESTION_BLOCKS, delegatedQuestionPrecheck, type AiQuestionBlockRecord } from "./ai-question-controller.ts";
import { answerValues, PER_UNIT_QUESTION_STAGES, resolveAiQuestionTarget, stateValue } from "./ai-question-answers.ts";

/** The recorded fact a stage-question wait is bound to. */
export type QuestionWaitEvidence = { path: string; sha256: string; blankSlots: number; reason: "no-delegation" | "not-delegable" | "delegated-path-blocked" };

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); };
const blank = (answer: string) => !answer || /^_+$/.test(answer);

function activeIntentDir(root: string): string | null {
  const spaceFile = join(root, "aidlc", "active-space");
  const space = existsSync(spaceFile) ? readFileSync(spaceFile, "utf8").trim() : "default";
  const pointer = join(root, "aidlc", "spaces", space, "intents", "active-intent");
  if (!/^[A-Za-z0-9._-]+$/.test(space) || !existsSync(pointer)) return null;
  const intent = readFileSync(pointer, "utf8").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(intent)) return null;
  const dir = join(root, "aidlc", "spaces", space, "intents", intent);
  if (!existsSync(dir)) return null;
  const real = realpathSync(dir);
  return inside(root, real) ? real : null;
}

/**
 * Is the in-progress stage waiting for the person's answers? Decided only from
 * recorded files, never from prose:
 *
 * - the canonical `<stage>-questions.md` of the current stage (or of the
 *   active Unit on a per-Unit Construction design stage), located by the one
 *   owner `resolveAiQuestionTarget`, exists and has at least one blank
 *   `[Answer]:` slot; and
 * - the delegated AI path cannot answer that exact file: there is no
 *   `stage-gates` delegation grant for the stage, its deterministic precheck
 *   refuses the set, or the Intent's `ai-question-blocks.jsonl` records a stop
 *   on these exact bytes.
 *
 * A set the delegated path may still answer is D work, so it returns null and
 * the clock keeps running. Anything unreadable also returns null: failing to
 * detect a wait only keeps the bounded run conservative.
 */
export function pendingHumanQuestion(projectDir: string, stage: string | undefined): QuestionWaitEvidence | null {
  try {
    if (!stage) return null;
    const root = realpathSync(projectDir), intentDir = activeIntentDir(root);
    if (!intentDir) return null;
    const stateBody = readFileSync(join(intentDir, "aidlc-state.md"), "utf8");
    const activeUnit = stateValue(stateBody, "Active Unit") ?? null;
    const unit = PER_UNIT_QUESTION_STAGES.has(stage) && activeUnit && stateValue(stateBody, "Unit Stage") === stage ? activeUnit : null;
    const target = resolveAiQuestionTarget(root, intentDir, stateBody, stage, unit);
    if (!target.ok) return null;
    const absolute = join(root, target.canonicalPath);
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isFile()) return null;
    const bytes = readFileSync(absolute), body = bytes.toString("utf8");
    const blankSlots = answerValues(body).filter(blank).length;
    if (!blankSlots) return null;
    const evidence = { path: target.canonicalPath, sha256: hash(bytes), blankSlots };
    const grantPath = join(intentDir, "decisions", "ai-approval-delegation.json");
    if (resolveDAiApproval(root).mode !== "stage-gates" || !existsSync(grantPath)) return { ...evidence, reason: "no-delegation" };
    let grant: unknown = null;
    try { grant = JSON.parse(readFileSync(grantPath, "utf8")); } catch { return { ...evidence, reason: "no-delegation" }; }
    const precheck = delegatedQuestionPrecheck({ root, intentDir, stateBody, stage, unit, grant, questionsPath: target.canonicalPath, questionsBody: body });
    if (!precheck.ok) return { ...evidence, reason: precheck.reason === "delegation does not authorize this stage" ? "no-delegation" : "not-delegable" };
    const ledger = join(intentDir, AI_QUESTION_BLOCKS);
    if (existsSync(ledger)) {
      const blocked = readFileSync(ledger, "utf8").split(/\r?\n/).some((line) => {
        if (!line.trim()) return false;
        try { const record = JSON.parse(line) as AiQuestionBlockRecord; return record.questions?.path === evidence.path && record.questions?.sha256 === evidence.sha256; }
        catch { return false; }
      });
      if (blocked) return { ...evidence, reason: "delegated-path-blocked" };
    }
    return null;
  } catch {
    return null;
  }
}
