#!/usr/bin/env bun
// Installed-flow E2E driver for delegated low-risk questions.
//
//   bun scripts/package.ts claude
//   bun poc/d-acceleration/evidence/delegated-questions/run-e2e.ts --work-dir <scratch> --out <evidence dir> [--model claude-opus-5-5]
//
// It copies the generated Claude package into a brand-new synthetic project
// and drives ONLY installed tools: generic-auto start, the official print's
// `intent create` command run exactly as printed (only `--label` filled), then
// generic-auto bootstrap, official `orchestrate`, the record-human-turn hook
// for the person's exact delegation words (the latest turn, as `grant`
// requires), `ai-approval-controller.ts grant`, `ai-question-controller.ts`
// (real judgment model through the authenticated native `claude` on PATH),
// the D settler `d-acceleration/ai-question-answers.ts` (D ledger
// `decisions/ai-question-answers.jsonl`, no audit event), the person's own
// gate approval (AI stage-gate approval was dropped), and official `next` to
// the following stage. The recorded files under e2e-installed/ predate the
// core restore (typed intent-create, core settler) and are historical. The driver plays two roles explicitly, and the
// evidence says so: the person (their exact typed delegation and ceremony
// choice) and the conductor (writing the canonical questions file, copying
// receipt answers into slots, writing the stage artifacts).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2), flag = (name: string, fallback?: string) => { const at = argv.indexOf(name); return at < 0 ? fallback : argv[at + 1]; };
const repo = join(import.meta.dir, "..", "..", "..", "..");
const workDir = flag("--work-dir") ?? "", out = flag("--out") ?? "", judgment = flag("--model", "claude-opus-5-5")!;
if (!workDir || !out) throw new Error("--work-dir and --out are required");
mkdirSync(out, { recursive: true });
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const steps: Array<Record<string, unknown>> = [];
const log = (step: string, data: Record<string, unknown>) => { steps.push({ step, at: new Date().toISOString(), ...data }); console.error(`[e2e] ${step}`); };

const root = mkdtempSync(join(workDir, "dq-e2e-"));
cpSync(join(repo, "dist", "claude", ".claude"), join(root, ".claude"), { recursive: true });
writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({ disableAllHooks: false }));
const health = join(root, "aidlc", "spaces", "default", "intents", ".aidlc-engine", "hooks-health");
mkdirSync(health, { recursive: true }); writeFileSync(join(health, "human-turn.last"), `${new Date().toISOString()}\n`);
writeFileSync(join(root, ".claude", "d-acceleration.jsonc"), JSON.stringify({ models: { judgment }, aiApproval: { mode: "stage-gates", minConfidence: 0.85 }, auto: { enabled: true, sessionOnly: false, through: "ideation", maxSteps: 12, deadlineMs: 600000 } }, null, 2));
mkdirSync(join(root, ".aidlc-engine"), { recursive: true });
writeFileSync(join(root, ".aidlc-engine", "request.txt"), "合成データだけで動く、ローカル専用の小さなTypeScriptメモアプリを作る。外部送信・ログイン・課金はしない。");
const tools = join(root, ".claude", "tools");
const env = { ...process.env, AIDLC_UNATTENDED: "1" };
function run(label: string, file: string, args: string[], options: { input?: string; allowFail?: boolean; env?: Record<string, string | undefined> } = {}) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: root, encoding: "utf8", env: options.env ?? env, input: options.input, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
  let json: any = null; try { json = JSON.parse(result.stdout); } catch { /* not JSON */ }
  if (result.status !== 0 && !options.allowFail) { log(`${label}:failed`, { status: result.status, stdout: result.stdout.slice(0, 4000), stderr: result.stderr.slice(0, 4000) }); finish("failed"); }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}
const engine = (label: string, args: string[], opts: { allowFail?: boolean } = {}) => run(label, join(tools, "aidlc.ts"), ["engine", ...args, "--project-dir", root], opts);
const brief = (directive: any) => directive && { kind: directive.kind, stage: directive.stage, ask_type: directive.ask_type, gate: directive.gate, next: directive.next, receipt: directive.receipt };
function finish(status: string): never {
  const intents = join(root, "aidlc", "spaces", "default", "intents");
  writeFileSync(join(out, "e2e-steps.json"), `${JSON.stringify({ status, project: root, judgmentModel: judgment, steps }, null, 2)}\n`);
  console.log(JSON.stringify({ status, project: root, out }));
  process.exit(status === "passed" ? 0 : 1);
}

// 1. Official scope confirmation, typed intent creation and bootstrap.
const auto = join(tools, "d-acceleration", "generic-auto-cli.ts");
const started = run("auto-start", auto, ["start", "--description-file", ".aidlc-engine/request.txt", "--project-dir", root]);
const ask = started.json.directive, selected = ask.ask_type === "scope-confirm" ? ask.confirm_command : ask.scope_commands.find((entry: any) => entry.scope === "poc")?.command;
const scope = /--scope ([A-Za-z0-9._-]+)/.exec(selected)![1], request = /--request ([A-Fa-f0-9]{8})/.exec(selected)![1];
log("scope-confirm", { ask_type: ask.ask_type, scope });
// The person's scope choice returns an official print naming `intent create`;
// run that exact command (fill only the `--label` the message leaves open).
const creation = engine("scope-choice", ["orchestrate", "next", "--scope", scope, "--request", request]);
writeFileSync(join(root, ".aidlc-engine", "creation.json"), creation.stdout);
const printed = /Run `([^`]+)`/.exec(String(creation.json?.message ?? ""))?.[1];
if (creation.json?.kind !== "print" || !printed) { log("no-intent-create-print", { directive: creation.json }); finish("failed"); }
const tokens = [...printed.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
const at = tokens.indexOf("intent");
if (at < 1 || tokens[at - 1] !== "engine" || tokens[at + 1] !== "create") { log("unexpected-intent-create", { printed }); finish("failed"); }
const createArgs = tokens.slice(at - 1).map((token, index, all) => all[index - 1] === "--label" ? "memo app" : token);
const created = run("intent-create", join(tools, "aidlc.ts"), [...createArgs, "--project-dir", root]);
log("intent-create", { printed, ran: createArgs, stdout: created.stdout.slice(0, 1000) });
const boot = run("bootstrap", auto, ["bootstrap", "--project-dir", root]);
let directive = boot.json.directive; log("bootstrap", { directive: brief(directive) });
while (directive.kind === "load-steering") { directive = engine("continue", ["orchestrate", "continue", directive.receipt]).json; log("continue", { directive: brief(directive) }); }
if (directive.kind !== "run-stage" || directive.stage !== "intent-capture") { log("unexpected-directive", { directive: brief(directive) }); finish("failed"); }
const intentName = readFileSync(join(root, "aidlc/spaces/default/intents/active-intent"), "utf8").trim();
const intent = join(root, "aidlc/spaces/default/intents", intentName), rel = (path: string) => relative(root, path).split("\\").join("/");
const stageDir = join(intent, "ideation", "intent-capture");
log("run-stage", { stage: directive.stage, produces: directive.produces, ceremony: directive.ceremony });

// 2. The person's ceremony choice and exact delegation words, recorded by the host hook.
const interactive = { ...process.env, CLAUDE_PROJECT_DIR: root, AIDLC_UNATTENDED: undefined };
const personSays = (label: string, prompt: string) => run(label, join(tools, "aidlc.ts"), ["engine", "hook", "record-human-turn", "--project-dir", root], { input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "01995000-dead-7000-8000-00000000d0e2", prompt }), env: interactive });
// The synthetic person's own ceremony choices for this disposable PoC; each is
// their recorded turn followed by the official setter, never an agent default.
for (const [key, value, words] of [
  ["summary-confirmation", "off", "この作業では要約確認（summary confirmation）をオフにしてください。"],
  ["review", "none", "このPoCではレビュー担当エージェントによるレビューは不要です（review none）。"],
  ["learnings", "off", "この作業では学び（learnings）の記録はオフにしてください。"],
]) {
  personSays(`human-turn-${key}`, words);
  const set = run(`config-set-${key}`, join(tools, "aidlc.ts"), ["engine", "config", "set", key, value, "--project-dir", root], { env: interactive });
  log("person-ceremony-choice", { key, value, words, result: set.json ?? set.stdout.slice(0, 500) });
}
const words = `AI-DLC delegate-ai-approvals --scope ${scope} --through intent-capture --stages intent-capture`;
const hook = personSays("human-turn-delegation", words);
mkdirSync(join(root, ".aidlc-engine", "tmp"), { recursive: true }); writeFileSync(join(root, ".aidlc-engine/tmp/delegation.txt"), words);
const grant = run("grant", join(tools, "d-acceleration", "ai-approval-controller.ts"), ["grant", "--project-dir", root, "--user-message-file", ".aidlc-engine/tmp/delegation.txt", "--message-id", "human-turn-01995000-d0e2", "--scope", scope, "--through", "intent-capture", "--allowed-stages", "intent-capture"]);
log("delegation-grant", { words, hookStatus: hook.status, grant: grant.json });

// 3. The conductor writes the canonical blank questions file (Japanese, five low-risk questions).
const questionsPath = join(stageDir, "intent-capture-questions.md");
mkdirSync(stageDir, { recursive: true });
const questions = `# Intent Capture 質問（合成データ）

## 前提・出典
- プロジェクト説明: 合成データだけで動く、ローカル専用の小さなTypeScriptメモアプリ。

## Q1 — 作業名の表示ラベル
このIntentを画面や記録でどう呼びますか？
A. メモアプリPoC
B. ローカルメモ
X. その他（具体的に記入）
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q2：メモ一覧の日付表示形式
A. YYYY-MM-DD
B. YYYY/MM/DD
X. その他（具体的に記入）
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q3 メモ一覧の既定の並び順
A. 更新日時の新しい順
B. 作成日時の新しい順
X. その他（具体的に記入）
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q4 サンプルとして同梱する合成メモの件数
A. 3件
B. 10件
X. その他（具体的に記入）
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q5 空状態メッセージの語調
A. です・ます調
B. 常体
X. その他（具体的に記入）
[AI-Autonomy]: low-risk-reversible
[Answer]:
`;
writeFileSync(questionsPath, questions);
const evidencePath = join(stageDir, "description-evidence.md");
writeFileSync(evidencePath, `# 出典\n\n${readFileSync(join(root, ".aidlc-engine", "request.txt"), "utf8")}\n`);
// A synthetic team UI convention the person already keeps in the record; it lets
// the model ground answers as researched facts instead of guessing preferences.
const conventionsPath = join(intent, "ui-conventions.md");
if (!argv.includes("--no-conventions")) writeFileSync(conventionsPath, "# チームUI規約（合成）\n\n- 作業名の表示ラベルは「ローカルメモ」とする。\n- 日付は YYYY-MM-DD で表示する。\n- 一覧は更新日時の新しい順に並べる。\n- 同梱する合成サンプルデータは3件とする。\n- 画面文言は です・ます調 とする。\n");
log("questions-written", { path: rel(questionsPath), sha256: sha(questions) });

// 4. Real judgment model decides; receipt bound to Intent, stage, grant, config, evidence.
const controller = run("ai-question-controller", join(tools, "d-acceleration", "ai-question-controller.ts"), ["--project-dir", root, "--stage", "intent-capture", "--questions-file", rel(questionsPath), "--delegation-file", grant.json.path, "--evidence", rel(evidencePath), ...(existsSync(conventionsPath) ? ["--evidence", rel(conventionsPath)] : []), "--timeout-ms", "240000"], { allowFail: true });
writeFileSync(join(out, "question-controller-result.json"), `${JSON.stringify(controller.json, null, 2)}\n`);
log("ai-question-decision", { status: controller.json?.status, reason: controller.json?.reason, telemetry: controller.json?.telemetry });
if (controller.json?.status !== "answer") finish("blocked-at-question-controller");
const decision = controller.json.decision;
writeFileSync(join(out, "question-decision-receipt.json"), readFileSync(join(root, controller.json.decisionFilePath)));

// 5. Inline provenance, exactly as SKILL.md describes, then the D settlement.
let body = readFileSync(questionsPath, "utf8");
for (const answer of decision.answers) body = body.replace(/^\[Answer\]:[ \t]*$/m, `[Answer]: ${answer.answer}\n[Answer Source]: ${answer.source}\n[AI Decision ID]: ${decision.decisionId}`);
writeFileSync(questionsPath, body); writeFileSync(join(out, "intent-capture-questions.answered.md"), body);
const settler = join(tools, "d-acceleration", "ai-question-answers.ts");
const settled = run("ai-answers", settler, ["--project-dir", root, "--stage", "intent-capture", "--ai-decision-file", controller.json.decisionFilePath]);
const replay = run("ai-answers-replay", settler, ["--project-dir", root, "--stage", "intent-capture", "--ai-decision-file", controller.json.decisionFilePath]);
log("settlement", { first: settled.json, replay: replay.json });

// 6. The conductor writes the stage artifacts from the answers and opens the gate.
const answersText = decision.answers.map((answer: any) => `- ${answer.questionId}: ${answer.answer}（${answer.source}）`).join("\n");
writeFileSync(join(stageDir, "intent-statement.md"), `# Intent Statement\n\n## Problem\nローカル専用で個人のメモを扱う小さなアプリが必要。\n\n## Goal\n合成データだけで動くTypeScriptメモアプリのPoCを作る。\n\n## Scope\n- 一覧・作成・編集\n- 外部送信・ログイン・課金はしない\n\n## Decisions from questions\n${answersText}\n\n## Source\n- intent-capture-questions.md (AI delegated answers, see [AI Decision ID])\n`);
writeFileSync(join(stageDir, "stakeholder-map.md"), `# Stakeholder Map\n\n## Stakeholders\n| Stakeholder | Interest |\n|---|---|\n| PoC owner | ローカルで動く最小のメモアプリ |\n\n## Source\n- プロジェクト説明\n`);
const awaiting = engine("report-awaiting", ["orchestrate", "report", "--stage", "intent-capture", "--result", "awaiting-approval"], { allowFail: true });
log("report-awaiting-approval", { status: awaiting.status, directive: brief(awaiting.json), detail: awaiting.json?.kind === "ask" ? JSON.stringify(awaiting.json).slice(0, 3000) : undefined, stderr: awaiting.stderr.slice(0, 2000), stdout: awaiting.json ? undefined : awaiting.stdout.slice(0, 2000) });
// Delegated AI stage-gate approval was dropped with the core restore: the
// gate stays the person's judgement. They approve through the host hook and
// the official report, exactly as the stage protocol describes.
if (awaiting.json?.kind !== "print") finish("stopped-before-gate");
let approvedVia = "person";
personSays("human-turn-approve", "Approve");
const approved = run("report-approved", join(tools, "aidlc.ts"), ["engine", "orchestrate", "report", "--stage", "intent-capture", "--result", "approved", "--user-input", "Approve", "--project-dir", root], { env: interactive, allowFail: true });
log("gate-approved", { via: approvedVia, status: approved.status, directive: brief(approved.json), stdout: approved.json ? undefined : approved.stdout.slice(0, 1500), stderr: approved.stderr.slice(0, 1500) });
if (approved.status !== 0) finish("blocked-at-gate-approval");
let after = engine("next-after-approve", ["orchestrate", "next"]).json;
while (after?.kind === "load-steering") after = engine("continue", ["orchestrate", "continue", after.receipt]).json;
log("next-official-stage", { directive: brief(after) });

// 8. Audit and D-ledger facts.
const audit = readdirSync(join(intent, "audit")).map((name) => readFileSync(join(intent, "audit", name), "utf8")).join("\n");
const count = (event: string) => (audit.match(new RegExp(`\\*\\*Event\\*\\*: ${event}\\n`, "g")) ?? []).length;
const blocks = audit.split(/\n(?=## )/).filter((block) => /\*\*Event\*\*: (GATE_APPROVED|HUMAN_TURN|QUESTION_ANSWERED)\n/.test(block));
writeFileSync(join(out, "audit-excerpt.md"), `${blocks.join("\n")}\n`);
const ledgerPath = join(intent, "decisions", "ai-question-answers.jsonl");
const ledgerRows = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean) : [];
writeFileSync(join(out, "ai-question-answers.jsonl"), ledgerRows.map((line) => `${line}\n`).join(""));
log("audit", { dLedgerRows: ledgerRows.length, QUESTION_ANSWERED: count("QUESTION_ANSWERED"), HUMAN_TURN: count("HUMAN_TURN"), GATE_APPROVED: count("GATE_APPROVED") });
finish(after?.stage === "requirements-analysis" ? "passed" : "stopped-after-approve");
