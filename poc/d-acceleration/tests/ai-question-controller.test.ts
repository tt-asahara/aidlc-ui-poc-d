import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateAiQuestions } from "../ai-question-controller.ts";
import { createAiApprovalGrant } from "../ai-approval-controller.ts";
import { settleAiAnswers } from "../../../core/tools/aidlc-ai-answers.ts";

function fixture(question = "## Sources\n- Product brief\n\n## Q1 — Display currency\nChoose a display currency.\n[AI-Autonomy]: low-risk-reversible\n[Answer]: ____\n") {
  const root = mkdtempSync(join(tmpdir(), "aidlc-ai-question-")), intent = join(root, "aidlc/spaces/default/intents/example");
  mkdirSync(join(root, ".claude"), { recursive: true }); mkdirSync(join(intent, "ideation/intent-capture"), { recursive: true });
  writeFileSync(join(root, "aidlc/spaces/default/intents/active-intent"), "example\n");
  const state = "- **Scope**: greenfield\n- **Lifecycle Phase**: ideation\n- **Current Stage**: intent-capture\n- [-] intent-capture — EXECUTE\n";
  writeFileSync(join(intent, "aidlc-state.md"), state); writeFileSync(join(intent, "ideation/intent-capture/intent-capture-questions.md"), question); writeFileSync(join(intent, "evidence.md"), "The product brief specifies JPY.\n");
  const message = "AI-DLC delegate-ai-approvals --scope greenfield --through construction --stages intent-capture";
  writeFileSync(join(root, ".claude/d-acceleration.jsonc"), JSON.stringify({ aiApproval: { mode: "stage-gates", minConfidence: 0.9 } }));
  writeFileSync(join(root, "delegation.txt"), message);
  const grant = createAiApprovalGrant({ projectDir: root, userMessageFile: "delegation.txt", messageId: "msg-1", scope: "greenfield", through: "construction", allowedStages: ["intent-capture"] }).path;
  return { root, intent, questions: "aidlc/spaces/default/intents/example/ideation/intent-capture/intent-capture-questions.md", grant, evidence: "aidlc/spaces/default/intents/example/evidence.md" };
}
function model(root: string, payload: object) { const path = join(root, "claude"); writeFileSync(path, `#!/usr/bin/env bun\nconsole.log(JSON.stringify({result:JSON.stringify(${JSON.stringify(payload)})}));\n`); chmodSync(path, 0o755); return path; }
function applyDecision(root: string, questions: string, result: any) { const path = join(root, questions); let body = readFileSync(path, "utf8"); for (const answer of result.decision.answers) body = body.replace("[Answer]: ____", `[Answer]: ${answer.answer}\n[Answer Source]: ${answer.source}\n[AI Decision ID]: ${result.decision.decisionId}`); writeFileSync(path, body); }

describe("delegated AI stage questions", () => {
  test("records provenance without a HUMAN_TURN and settles an exact low-risk answer", async () => {
    const f = fixture(), executable = model(f.root, { outcome: "answer", reason: "brief fixes the currency", confidence: 0.97, riskFlags: [], uncertainties: [], answers: [{ answer: "JPY", source: "researched-fact", reason: "explicit in brief", evidencePaths: [f.evidence] }] });
    const result = await evaluateAiQuestions({ projectDir: f.root, stage: "intent-capture", questionsFile: f.questions, delegationFile: f.grant, evidenceFiles: [f.evidence], claudeExecutable: executable });
    expect(result.status).toBe("answer");
    applyDecision(f.root, f.questions, result);
    expect(settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).toMatchObject({ emitted: "AI_QUESTION_ANSWERED", count: 1 });
    const audit = readdirSync(join(f.intent, "audit")).map((name) => readFileSync(join(f.intent, "audit", name), "utf8")).join("\n"); expect(audit).toContain("**Event**: AI_QUESTION_ANSWERED"); expect(audit).toContain("**Answer Source**: researched-fact"); expect(audit).not.toContain("**Event**: HUMAN_TURN");
  });

  test("stops without delegation, for human-only questions, and below confidence", async () => {
    const noGrant = fixture(), executable = model(noGrant.root, { outcome: "answer", reason: "guess", confidence: 0.99, riskFlags: [], uncertainties: [], answers: [{ answer: "JPY", source: "delegated-ai-assumption", reason: "safe", evidencePaths: [] }] });
    writeFileSync(join(noGrant.root, noGrant.grant), JSON.stringify({ schemaVersion: 1, mode: "human", allowedStages: [] }));
    expect((await evaluateAiQuestions({ projectDir: noGrant.root, stage: "intent-capture", questionsFile: noGrant.questions, delegationFile: noGrant.grant, evidenceFiles: [], claudeExecutable: executable })).status).toBe("block");
    const sensitive = fixture("## Q1\nMay I publish externally and change permissions?\n[AI-Autonomy]: low-risk-reversible\n[Answer]: ____\n");
    expect((await evaluateAiQuestions({ projectDir: sensitive.root, stage: "intent-capture", questionsFile: sensitive.questions, delegationFile: sensitive.grant, evidenceFiles: [], claudeExecutable: model(sensitive.root, {}) })).reason).toContain("human");
    const low = fixture(); const lowResult = await evaluateAiQuestions({ projectDir: low.root, stage: "intent-capture", questionsFile: low.questions, delegationFile: low.grant, evidenceFiles: [], claudeExecutable: model(low.root, { outcome: "answer", reason: "uncertain", confidence: 0.4, riskFlags: [], uncertainties: [], answers: [{ answer: "JPY", source: "delegated-ai-assumption", reason: "guess", evidencePaths: [] }] }) });
    expect(lowResult.status).toBe("block");
  });

  test("settlement rejects changed questions or answers", async () => {
    const f = fixture(), result = await evaluateAiQuestions({ projectDir: f.root, stage: "intent-capture", questionsFile: f.questions, delegationFile: f.grant, evidenceFiles: [], claudeExecutable: model(f.root, { outcome: "answer", reason: "safe default", confidence: 0.95, riskFlags: [], uncertainties: [], answers: [{ answer: "JPY", source: "delegated-ai-assumption", reason: "reversible display default", evidencePaths: [] }] }) });
    writeFileSync(join(f.root, f.questions), "## Q1\nChanged material question.\n[AI-Autonomy]: low-risk-reversible\n[Answer]: JPY\n");
    expect(() => settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).toThrow("questions changed");
  });

  test("fails closed for stage/path/material/partial-answer boundary violations", async () => {
    const stage = fixture(); writeFileSync(join(stage.intent, "aidlc-state.md"), "- **Scope**: greenfield\n- **Lifecycle Phase**: ideation\n- **Current Stage**: scope-definition\n- [-] scope-definition — EXECUTE\n");
    expect((await evaluateAiQuestions({ projectDir: stage.root, stage: "intent-capture", questionsFile: stage.questions, delegationFile: stage.grant, evidenceFiles: [], claudeExecutable: model(stage.root, {}) })).reason).toContain("current");
    const material = fixture("## Q1\n対象利用者と成功基準を決めてください。\n[AI-Autonomy]: low-risk-reversible\n[Answer]: ____\n");
    expect((await evaluateAiQuestions({ projectDir: material.root, stage: "intent-capture", questionsFile: material.questions, delegationFile: material.grant, evidenceFiles: [], claudeExecutable: model(material.root, {}) })).reason).toContain("human");
    const partial = fixture("## Q1\nDisplay currency?\n[AI-Autonomy]: low-risk-reversible\n[Answer]: USD\n## Q2\nDate style?\n[AI-Autonomy]: low-risk-reversible\n[Answer]: ____\n");
    expect((await evaluateAiQuestions({ projectDir: partial.root, stage: "intent-capture", questionsFile: partial.questions, delegationFile: partial.grant, evidenceFiles: [], claudeExecutable: model(partial.root, {}) })).reason).toContain("entirely blank");
    const path = fixture(); writeFileSync(join(path.intent, "ideation/intent-capture/other-questions.md"), readFileSync(join(path.root, path.questions)));
    expect((await evaluateAiQuestions({ projectDir: path.root, stage: "intent-capture", questionsFile: "aidlc/spaces/default/intents/example/ideation/intent-capture/other-questions.md", delegationFile: path.grant, evidenceFiles: [], claudeExecutable: model(path.root, {}) })).reason).toContain("canonical");
    const misplaced = fixture("## Q1\nSafe display?\n[AI-Autonomy]: low-risk-reversible\n[AI-Autonomy]: low-risk-reversible\n[Answer]: ____\n## Q2\nAnother display?\n[Answer]: ____\n");
    expect((await evaluateAiQuestions({ projectDir: misplaced.root, stage: "intent-capture", questionsFile: misplaced.questions, delegationFile: misplaced.grant, evidenceFiles: [], claudeExecutable: model(misplaced.root, {}) })).reason).toContain("exactly one");
  });

  test("binds the complete receipt and makes settlement idempotent", async () => {
    const f = fixture(), result = await evaluateAiQuestions({ projectDir: f.root, stage: "intent-capture", questionsFile: f.questions, delegationFile: f.grant, evidenceFiles: [], claudeExecutable: model(f.root, { outcome: "answer", reason: "safe default", confidence: 0.95, riskFlags: [], uncertainties: [], answers: [{ answer: "JPY", source: "delegated-ai-assumption", reason: "reversible", evidencePaths: [] }] }) });
    applyDecision(f.root, f.questions, result);
    expect(settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).not.toHaveProperty("reused");
    expect(settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).toHaveProperty("reused", true);
    const decisionPath = join(f.root, result.decisionFilePath!), decision = JSON.parse(readFileSync(decisionPath, "utf8")); decision.reason = "tampered"; writeFileSync(decisionPath, JSON.stringify(decision));
    expect(() => settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).toThrow("does not bind");
  });

  test("rejects configuration threshold drift", async () => {
    const f = fixture(), result = await evaluateAiQuestions({ projectDir: f.root, stage: "intent-capture", questionsFile: f.questions, delegationFile: f.grant, evidenceFiles: [], claudeExecutable: model(f.root, { outcome: "answer", reason: "safe", confidence: 0.95, riskFlags: [], uncertainties: [], answers: [{ answer: "JPY", source: "delegated-ai-assumption", reason: "reversible", evidencePaths: [] }] }) });
    applyDecision(f.root, f.questions, result); writeFileSync(join(f.root, ".claude/d-acceleration.jsonc"), JSON.stringify({ aiApproval: { mode: "stage-gates", minConfidence: 0.99 } }));
    expect(() => settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).toThrow("configuration hash or path changed");
    const added = fixture(), addedResult = await evaluateAiQuestions({ projectDir: added.root, stage: "intent-capture", questionsFile: added.questions, delegationFile: added.grant, evidenceFiles: [], claudeExecutable: model(added.root, { outcome: "answer", reason: "safe", confidence: 0.95, riskFlags: [], uncertainties: [], answers: [{ answer: "JPY", source: "delegated-ai-assumption", reason: "reversible", evidencePaths: [] }] }) });
    applyDecision(added.root, added.questions, addedResult); writeFileSync(join(added.root, ".claude/d-acceleration.local.jsonc"), JSON.stringify({ aiApproval: { mode: "human" } }));
    expect(() => settleAiAnswers(added.root, "intent-capture", addedResult.decisionFilePath!)).toThrow("file set changed");
  });
});
