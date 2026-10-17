#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { appendAuditEntries } from "./aidlc-audit.ts";
import { resolveProjectDir } from "./aidlc-lib.ts";

const SHA = /^[a-f0-9]{64}$/;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
const template = (body: string) => body.replace(/^(\s*\[Answer\]:)[^\r\n]*$/gm, "$1").replace(/^\s*\[(?:Answer Source|AI Decision ID)\]:[^\r\n]*(?:\r?\n)?/gm, "");
const answerValues = (body: string) => [...body.matchAll(/^\s*\[Answer\]:[ \t]*(.*?)[ \t]*$/gm)].map((match) => match[1].trim());
function questionSections(body: string) { const headings = [...body.matchAll(/^###\s+([^\r\n]+)\s*$/gm)]; return headings.map((heading, index) => ({ id: heading[1].trim(), body: body.slice(heading.index!, headings[index + 1]?.index ?? body.length) })); }
function inside(root: string, path: string) { const rel = relative(root, path); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); }
function readBound(root: string, input: unknown, expected: unknown, label: string): { path: string; bytes: Buffer } {
  if (typeof input !== "string" || !input || isAbsolute(input) || input.split(/[\\/]/).includes("..") || typeof expected !== "string" || !SHA.test(expected)) throw new Error(`invalid ${label} binding`);
  const candidate = resolve(root, input); if (!existsSync(candidate) || lstatSync(candidate).isSymbolicLink()) throw new Error(`${label} is missing or a symlink`);
  const actual = realpathSync(candidate), bytes = readFileSync(actual); if (!inside(root, actual) || hash(bytes) !== expected) throw new Error(`${label} hash or path changed`); return { path: input, bytes };
}
function activeIntent(root: string) { const spaceFile = join(root, "aidlc", "active-space"), space = existsSync(spaceFile) ? readFileSync(spaceFile, "utf8").trim() : "default", intents = join(root, "aidlc", "spaces", space, "intents"), intent = readFileSync(join(intents, "active-intent"), "utf8").trim(), dir = realpathSync(join(intents, intent)); if (!inside(root, dir)) throw new Error("active Intent escapes project"); return { space, intent, dir }; }
function stateValue(body: string, field: string) { return body.match(new RegExp(`^\\s*-\\s*\\*\\*${field}\\*\\*:\\s*(.+?)\\s*$`, "im"))?.[1]?.trim(); }

export function settleAiAnswers(projectDir: string, stage: string, decisionFile: string) {
  const root = realpathSync(resolveProjectDir(projectDir)), active = activeIntent(root); if (!stage) throw new Error("stage is required");
  const decisionBinding = resolve(root, decisionFile); if (!inside(active.dir, decisionBinding) || !existsSync(decisionBinding) || lstatSync(decisionBinding).isSymbolicLink()) throw new Error("AI decision file must be inside active Intent");
  const decision: any = JSON.parse(readFileSync(realpathSync(decisionBinding), "utf8"));
  if (decision.schemaVersion !== 1 || decision.kind !== "delegated-stage-question" || decision.actor !== "ai" || decision.outcome !== "answer" || decision.stage !== stage || !SHA.test(decision.decisionId) || !Array.isArray(decision.answers) || decision.answers.length === 0 || decision.riskFlags?.length || decision.uncertainties?.length) throw new Error("invalid AI question decision");
  const state = readBound(root, decision.state?.path, decision.state?.sha256, "state"); if (!inside(active.dir, resolve(root, state.path))) throw new Error("state binding is outside active Intent");
  const stateBody = state.bytes.toString("utf8"), phase = stateValue(stateBody, "Lifecycle Phase"), current = stateValue(stateBody, "Current Stage");
  if (current !== stage || !new RegExp(`^\\s*-\\s*\\[-\\]\\s+${stage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+—\\s+EXECUTE\\s*$`, "m").test(stateBody)) throw new Error("AI answer stage is not the current in-progress stage");
  const grant = readBound(root, decision.delegation?.path, decision.delegation?.sha256, "delegation"); const grantValue: any = JSON.parse(grant.bytes.toString("utf8"));
  const grantRequest = { messageId: grantValue.messageId, userMessage: grantValue.userMessage, userMessageSha256: grantValue.userMessageSha256, mode: grantValue.mode, scope: grantValue.scope, through: grantValue.through, allowedStages: grantValue.allowedStages, minConfidence: grantValue.minConfidence };
  const stateScope = state.bytes.toString("utf8").match(/^\s*-\s*\*\*Scope\*\*:\s*(.+?)\s*$/im)?.[1]?.trim();
  if (grantValue.schemaVersion !== 1 || grantValue.mode !== "stage-gates" || hash(String(grantValue.userMessage ?? "")) !== grantValue.userMessageSha256 || hash(canonical(grantRequest)) !== grantValue.requestSha256 || !grantValue.allowedStages?.includes(stage) || grantValue.scope !== stateScope || grantValue.messageId !== decision.delegation.messageId || grantValue.requestSha256 !== decision.delegation.requestSha256 || decision.confidence < Number(grantValue.minConfidence ?? 1)) throw new Error("delegation does not authorize this AI answer");
  const canonicalQuestions = phase ? relative(root, join(active.dir, phase, stage, `${stage}-questions.md`)).split(sep).join("/") : "";
  if (decision.questions?.path !== canonicalQuestions) throw new Error("questions file is not canonical for the current stage");
  const questionsPath = resolve(root, decision.questions?.path ?? ""); if (!inside(active.dir, questionsPath) || !existsSync(questionsPath) || lstatSync(questionsPath).isSymbolicLink()) throw new Error("questions binding is invalid"); const questions = readFileSync(realpathSync(questionsPath), "utf8");
  if (hash(template(questions)) !== decision.questions.templateSha256) throw new Error("questions changed outside answer slots"); const actualAnswers = answerValues(questions);
  if (actualAnswers.length !== decision.answers.length || actualAnswers.some((answer, index) => !answer || answer !== decision.answers[index].answer)) throw new Error("questions file answers do not match the AI decision");
  const sections = questionSections(questions);
  if (sections.length !== decision.answers.length || sections.some((section, index) => {
    const escapedAnswer = decision.answers[index].answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), escapedSource = decision.answers[index].source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), escapedId = decision.decisionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const auditDir = join(active.dir, "audit"), replayed = existsSync(auditDir) && readdirSync(auditDir).some((name) => readFileSync(join(auditDir, name), "utf8").includes(`**AI Decision ID**: ${decision.decisionId}`));
  if (replayed) return { emitted: "AI_QUESTION_ANSWERED", stage, count: decision.answers.length, decisionId: decision.decisionId, reused: true };
  appendAuditEntries(decision.answers.map((answer: any) => ({ eventType: "AI_QUESTION_ANSWERED", fields: { Stage: stage, Details: answer.answer, "Answer Source": answer.source, Reason: answer.reason, "AI Decision ID": decision.decisionId, "Questions File": decision.questions.path, "Questions Template SHA-256": decision.questions.templateSha256, "Delegation SHA-256": decision.delegation.sha256, Confidence: String(decision.confidence) } })), root, active.intent, active.space);
  return { emitted: "AI_QUESTION_ANSWERED", stage, count: decision.answers.length, decisionId: decision.decisionId };
}

if (import.meta.main) { try { const args = process.argv.slice(2), one = (flag: string) => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; }; const project = one("--project-dir"); if (!project || !isAbsolute(project)) throw new Error("--project-dir must be absolute"); process.stdout.write(`${JSON.stringify(settleAiAnswers(project, one("--stage") ?? "", one("--ai-decision-file") ?? ""))}\n`); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(2); } }
