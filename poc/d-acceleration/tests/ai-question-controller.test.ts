import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { classifyQuestions, evaluateAiQuestions, modelResult } from "../ai-question-controller.ts";
import { createAiApprovalGrant } from "../ai-approval-controller.ts";
import { recordHumanTurn } from "./human-turn.ts";
import { AI_QUESTION_ANSWER_LEDGER, questionSections, settleAiAnswers } from "../ai-question-answers.ts";

const T = 30_000;
const IDEATION_STATE = "- **Scope**: greenfield\n- **Lifecycle Phase**: IDEATION\n- **Current Stage**: intent-capture\n- [-] intent-capture — EXECUTE\n";
type Fixture = { root: string; intent: string; questions: string; grant: string; evidence: string };
function fixture(question = "## Sources\n- Product brief\n\n## Q1 — Display currency\nChoose a display currency.\n[AI-Autonomy]: low-risk-reversible\n[Answer]: ____\n", opts: { stage?: string; state?: string; questionsPath?: string } = {}): Fixture {
  const stage = opts.stage ?? "intent-capture", state = opts.state ?? IDEATION_STATE, questionsRel = opts.questionsPath ?? `ideation/${stage}/${stage}-questions.md`;
  const root = mkdtempSync(join(tmpdir(), "aidlc-ai-question-")), intent = join(root, "aidlc/spaces/default/intents/example");
  mkdirSync(join(root, ".claude"), { recursive: true }); mkdirSync(dirname(join(intent, questionsRel)), { recursive: true });
  writeFileSync(join(root, "aidlc/spaces/default/intents/active-intent"), "example\n");
  writeFileSync(join(intent, "aidlc-state.md"), state); writeFileSync(join(intent, questionsRel), question); writeFileSync(join(intent, "evidence.md"), "The product brief specifies JPY.\n");
  const message = `AI-DLC delegate-ai-approvals --scope greenfield --through construction --stages ${stage}`;
  writeFileSync(join(root, ".claude/d-acceleration.jsonc"), JSON.stringify({ aiApproval: { mode: "stage-gates", minConfidence: 0.9 } }));
  writeFileSync(join(root, "delegation.txt"), message);
  recordHumanTurn(root, message);
  const grant = createAiApprovalGrant({ projectDir: root, userMessageFile: "delegation.txt", messageId: "msg-1", scope: "greenfield", through: "construction", allowedStages: [stage] }).path;
  return { root, intent, questions: `aidlc/spaces/default/intents/example/${questionsRel}`, grant, evidence: "aidlc/spaces/default/intents/example/evidence.md" };
}
// A POSIX-shell stand-in for the judgment model: prints a Claude `--output-format json` envelope.
function model(root: string, payload: object, envelope: Record<string, unknown> = {}) { const path = join(root, `claude-${Math.random().toString(36).slice(2)}`); writeFileSync(path, `#!/bin/sh\ncat <<'AIDLC_EOF'\n${JSON.stringify({ ...envelope, result: JSON.stringify(payload) })}\nAIDLC_EOF\n`); chmodSync(path, 0o755); return path; }
function applyDecision(root: string, questions: string, result: any) { const path = join(root, questions); let body = readFileSync(path, "utf8"); for (const answer of result.decision.answers) body = body.replace(/^\[Answer\]:[ \t]*_*[ \t]*$/m, `[Answer]: ${answer.answer}\n[Answer Source]: ${answer.source}\n[AI Decision ID]: ${result.decision.decisionId}`); writeFileSync(path, body); }
const answers = (n: number, prefix = "A") => Array.from({ length: n }, (_, i) => ({ answer: `${prefix}. option ${i + 1}`, source: "delegated-ai-assumption", reason: "可逆な表示上の既定値", evidencePaths: [] }));
const ok = (n: number, extra: object = {}) => ({ outcome: "answer", reason: "全問とも可逆な表示上の詳細", confidence: 0.95, riskFlags: [], uncertainties: [], answers: answers(n), ...extra });
// Settled AI answers land only in the D-owned ledger, never in the official audit.
const ledgerRows = (intent: string) => readFileSync(join(intent, AI_QUESTION_ANSWER_LEDGER), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const officialAudit = (intent: string) => existsSync(join(intent, "audit")) ? readdirSync(join(intent, "audit")).map((name) => readFileSync(join(intent, "audit", name), "utf8")).join("\n") : "";
// Only the person's own delegation turn; settling an AI answer never adds one.
const humanTurns = (audit: string) => (audit.match(/\*\*Event\*\*: HUMAN_TURN/g) ?? []).length;
const evaluate = (f: Fixture, executable: string, extra: { stage?: string; unit?: string | null; questionsFile?: string; evidenceFiles?: string[] } = {}) => evaluateAiQuestions({ projectDir: f.root, stage: extra.stage ?? "intent-capture", unit: extra.unit ?? null, questionsFile: extra.questionsFile ?? f.questions, delegationFile: f.grant, evidenceFiles: extra.evidenceFiles ?? [], claudeExecutable: executable });

// Realistic Japanese question file: six official `## Q<n>` sections with A-E + X
// options, a sources preamble, mixed ASCII/full-width punctuation after the ID.
const JA_SIX = `# 要件分析 質問（合成データ）

## 前提・出典
- product-brief.md（合成データのみ）
- 既存のドメイン用語集

## Q1 — 一覧画面の日付表示形式
メモ一覧で作成日をどの形式で表示しますか？（後から設定で変更可能）
A. YYYY-MM-DD
B. YYYY/MM/DD
C. M月D日
X. その他（具体的に記入）
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q2：一覧の既定の並び順
メモ一覧の初期表示の並び順を選んでください。
A. 更新日時の新しい順
B. 作成日時の新しい順
C. タイトルの五十音順
X. その他（具体的に記入）
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q3 1ページあたりの表示件数
A. 20件
B. 50件
C. 100件
X. その他（具体的に記入）
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q4. 空状態メッセージの語調
メモが1件もない時の案内文の語調はどれにしますか？
A. です・ます調
B. 常体
X. その他（具体的に記入）
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q5 （補足）長いタイトルの省略表示
A. 1行で末尾を「…」で省略
B. 2行まで折り返し、それ以降を省略
X. その他（具体的に記入）
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q6 エクスポートCSVの文字コード
A. UTF-8（BOMなし）
B. UTF-8（BOMあり）
C. Shift_JIS
X. その他（具体的に記入）
[AI-Autonomy]: low-risk-reversible
[Answer]:
`;

// Seven questions mixing eligible, unmarked, protected and malformed markers.
const JA_MIXED = `# 要件分析 質問

## Q1 — 日付表示形式
A. YYYY-MM-DD
B. YYYY/MM/DD
X. その他
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q2 並び順
A. 更新日時順
B. 作成日時順
X. その他
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q3 主な対象ユーザー層
A. 個人
B. 小規模チーム
X. その他
[Answer]:

## Q4 表示件数
A. 20件
B. 50件
X. その他
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q5 本番環境への初回リリース時期
A. 今月
B. 来月
X. その他
[AI-Autonomy]: low-risk-reversible
[Answer]:

## Q6 空状態の語調
A. です・ます調
B. 常体
[AI-Autonomy]：low-risk-reversible
[Answer]:

## Q7 CSV文字コード
A. UTF-8
B. Shift_JIS
[Answer]:
[AI-Autonomy]: low-risk-reversible
`;

describe("delegated AI stage questions", () => {
  test("records provenance without a HUMAN_TURN and settles an exact low-risk answer", async () => {
    const f = fixture(), executable = model(f.root, { outcome: "answer", reason: "brief fixes the currency", confidence: 0.97, riskFlags: [], uncertainties: [], answers: [{ answer: "JPY", source: "researched-fact", reason: "explicit in brief", evidencePaths: [f.evidence] }] });
    const result = await evaluate(f, executable, { evidenceFiles: [f.evidence] });
    expect(result.status).toBe("answer");
    expect(result.decision!.unit).toBeNull();
    applyDecision(f.root, f.questions, result);
    expect(settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).toMatchObject({ recorded: "d-ai-question-ledger", count: 1 });
    const rows = ledgerRows(f.intent); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ kind: "d-delegated-question-answer", ledger: "d-acceleration (not the official AI-DLC audit)", actor: "ai", questionId: "Q1", answerSource: "researched-fact" });
    const audit = officialAudit(f.intent); expect(humanTurns(audit)).toBe(1); expect(audit).not.toContain("QUESTION_ANSWERED");
  }, T);

  test("only a grant minted from the person's recorded turn reaches the model or settles", async () => {
    // A hand-written grant in the old shape (no human-turn binding) never reaches the model.
    const forged = fixture(), grantPath = join(forged.root, forged.grant), minted = JSON.parse(readFileSync(grantPath, "utf8"));
    const { humanTurn: _turn, ...legacy } = minted; writeFileSync(grantPath, JSON.stringify({ ...legacy, schemaVersion: 1 }));
    const legacyResult = await evaluate(forged, model(forged.root, ok(1)));
    expect(legacyResult).toMatchObject({ status: "block" }); expect(legacyResult.reason).toContain("predates the human-turn binding");
    // A schema-2 grant naming a turn that is not in the official audit is refused too.
    const { schemaVersion: _v, requestSha256: _r, ...request } = { ...minted, humanTurn: { ...minted.humanTurn, at: "2020-01-01T00:00:00Z" } };
    const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted((value as any)[key])])) : value;
    writeFileSync(grantPath, JSON.stringify({ schemaVersion: 2, ...request, requestSha256: createHash("sha256").update(JSON.stringify(sorted(request))).digest("hex") }));
    expect((await evaluate(forged, model(forged.root, ok(1)))).reason).toContain("human turn is not in the official audit");
    // The settler re-checks the same binding: a valid decision whose human turn left the audit no longer settles.
    const f = fixture(), result = await evaluate(f, model(f.root, ok(1)));
    expect(result.status).toBe("answer"); applyDecision(f.root, f.questions, result);
    rmSync(join(f.intent, "audit"), { recursive: true, force: true });
    expect(() => settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).toThrow("human turn is not in the official audit");
    expect(existsSync(join(f.intent, AI_QUESTION_ANSWER_LEDGER))).toBeFalse();
  }, T);

  test("records requested vs runtime-reported model from the Claude JSON envelope", async () => {
    const f = fixture(); writeFileSync(join(f.root, ".claude/d-acceleration.local.jsonc"), JSON.stringify({ models: { judgment: "claude-opus-5-5" } }));
    const one = await evaluate(f, model(f.root, ok(1), { modelUsage: { "claude-opus-5-5": { outputTokens: 10 } } }));
    expect(one.decision!.model).toEqual({ requested: "claude-opus-5-5", runtimeReported: "claude-opus-5-5", identityStatus: "verified-match" });
    expect(one.telemetry!.modelIdentity.source).toBe("claude-modelUsage");
    const g = fixture(), other = await evaluate(g, model(g.root, ok(1), { modelUsage: { "claude-haiku-4-5": {} } }));
    expect(other.decision!.model).toMatchObject({ runtimeReported: "claude-haiku-4-5", identityStatus: "mismatch" });
  }, T);

  test("stops without delegation, for human-only questions, and below confidence", async () => {
    const noGrant = fixture(), executable = model(noGrant.root, ok(1));
    writeFileSync(join(noGrant.root, noGrant.grant), JSON.stringify({ schemaVersion: 1, mode: "human", allowedStages: [] }));
    expect((await evaluate(noGrant, executable)).status).toBe("block");
    const sensitive = fixture("## Q1\nMay I publish externally and change permissions?\n[AI-Autonomy]: low-risk-reversible\n[Answer]: ____\n");
    expect((await evaluate(sensitive, model(sensitive.root, {}))).reason).toContain("human");
    const low = fixture(); const lowResult = await evaluate(low, model(low.root, ok(1, { confidence: 0.4 })));
    expect(lowResult.status).toBe("block");
  }, T);

  test("settlement rejects changed questions or answers", async () => {
    const f = fixture(), result = await evaluate(f, model(f.root, ok(1)));
    writeFileSync(join(f.root, f.questions), "## Q1\nChanged material question.\n[AI-Autonomy]: low-risk-reversible\n[Answer]: JPY\n");
    expect(() => settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).toThrow("questions changed");
  }, T);

  test("fails closed for stage/path/material/partial-answer boundary violations", async () => {
    const stage = fixture(); writeFileSync(join(stage.intent, "aidlc-state.md"), "- **Scope**: greenfield\n- **Lifecycle Phase**: ideation\n- **Current Stage**: scope-definition\n- [-] scope-definition — EXECUTE\n");
    expect((await evaluate(stage, model(stage.root, {}))).reason).toContain("current");
    const material = fixture("## Q1\n対象利用者と成功基準を決めてください。\n[AI-Autonomy]: low-risk-reversible\n[Answer]: ____\n");
    expect((await evaluate(material, model(material.root, {}))).reason).toContain("human");
    const partial = fixture("## Q1\nDisplay currency?\n[AI-Autonomy]: low-risk-reversible\n[Answer]: USD\n## Q2\nDate style?\n[AI-Autonomy]: low-risk-reversible\n[Answer]: ____\n");
    expect((await evaluate(partial, model(partial.root, {}))).reason).toContain("entirely blank");
    const path = fixture(); writeFileSync(join(path.intent, "ideation/intent-capture/other-questions.md"), readFileSync(join(path.root, path.questions)));
    expect((await evaluate(path, model(path.root, {}), { questionsFile: "aidlc/spaces/default/intents/example/ideation/intent-capture/other-questions.md" })).reason).toContain("canonical");
    const misplaced = fixture("## Q1\nSafe display?\n[AI-Autonomy]: low-risk-reversible\n[AI-Autonomy]: low-risk-reversible\n[Answer]: ____\n## Q2\nAnother display?\n[Answer]: ____\n");
    expect((await evaluate(misplaced, model(misplaced.root, {}))).reason).toContain("exactly one");
  }, T);

  test("binds the complete receipt and makes settlement idempotent", async () => {
    const f = fixture(), result = await evaluate(f, model(f.root, ok(1)));
    applyDecision(f.root, f.questions, result);
    expect(settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).not.toHaveProperty("reused");
    expect(settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).toHaveProperty("reused", true);
    const decisionPath = join(f.root, result.decisionFilePath!), decision = JSON.parse(readFileSync(decisionPath, "utf8")); decision.reason = "tampered"; writeFileSync(decisionPath, JSON.stringify(decision));
    expect(() => settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).toThrow("does not bind");
  }, T);

  test("rejects configuration threshold drift", async () => {
    const f = fixture(), result = await evaluate(f, model(f.root, ok(1)));
    applyDecision(f.root, f.questions, result); writeFileSync(join(f.root, ".claude/d-acceleration.jsonc"), JSON.stringify({ aiApproval: { mode: "stage-gates", minConfidence: 0.99 } }));
    expect(() => settleAiAnswers(f.root, "intent-capture", result.decisionFilePath!)).toThrow("configuration hash or path changed");
    const added = fixture(), addedResult = await evaluate(added, model(added.root, ok(1)));
    applyDecision(added.root, added.questions, addedResult); writeFileSync(join(added.root, ".claude/d-acceleration.local.jsonc"), JSON.stringify({ aiApproval: { mode: "human" } }));
    expect(() => settleAiAnswers(added.root, "intent-capture", addedResult.decisionFilePath!)).toThrow("file set changed");
  }, T);
});

describe("Japanese and realistic multi-question files", () => {
  const RA_STATE = "- **Scope**: greenfield\n- **Lifecycle Phase**: inception\n- **Current Stage**: requirements-analysis\n- [-] requirements-analysis — EXECUTE\n";
  const ra = (body: string) => fixture(body, { stage: "requirements-analysis", state: RA_STATE, questionsPath: "inception/requirements-analysis/requirements-analysis-questions.md" });

  test("six Japanese questions settle in order with per-question provenance", async () => {
    const f = ra(JA_SIX), payload = { outcome: "answer", reason: "いずれも後から変更できる表示上の既定値", confidence: 0.93, riskFlags: [], uncertainties: [], answers: [
      { answer: "A. YYYY-MM-DD", source: "delegated-ai-assumption", reason: "ISO形式は曖昧さが少ない", evidencePaths: [] },
      { answer: "A. 更新日時の新しい順", source: "delegated-ai-assumption", reason: "直近の編集を探しやすい", evidencePaths: [] },
      { answer: "B. 50件", source: "delegated-ai-assumption", reason: "中庸", evidencePaths: [] },
      { answer: "A. です・ます調", source: "delegated-ai-assumption", reason: "既存UIと整合", evidencePaths: [] },
      { answer: "A. 1行で末尾を「…」で省略", source: "delegated-ai-assumption", reason: "一覧の密度を保つ", evidencePaths: [] },
      { answer: "A. UTF-8（BOMなし）", source: "researched-fact", reason: "ブリーフに記載", evidencePaths: [f.evidence] },
    ] };
    const result = await evaluate(f, model(f.root, payload), { stage: "requirements-analysis", evidenceFiles: [f.evidence] });
    expect(result.status, result.reason).toBe("answer");
    expect(result.classification!.map((entry) => `${entry.questionId}:${entry.eligibility}`)).toEqual(["Q1:eligible", "Q2:eligible", "Q3:eligible", "Q4:eligible", "Q5:eligible", "Q6:eligible"]);
    expect(result.decision!.answers.map((answer) => answer.questionId)).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]);
    applyDecision(f.root, f.questions, result);
    expect(settleAiAnswers(f.root, "requirements-analysis", result.decisionFilePath!)).toMatchObject({ recorded: "d-ai-question-ledger", count: 6 });
    const rows = ledgerRows(f.intent);
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.answer)).toContain("A. 1行で末尾を「…」で省略");
    expect(humanTurns(officialAudit(f.intent))).toBe(1);
    // Reordering answers between slots is refused even though the set is unchanged.
    const body = readFileSync(join(f.root, f.questions), "utf8").replace("[Answer]: A. YYYY-MM-DD", "[Answer]: TMP").replace("[Answer]: B. 50件", "[Answer]: A. YYYY-MM-DD").replace("[Answer]: TMP", "[Answer]: B. 50件");
    writeFileSync(join(f.root, f.questions), body);
    expect(() => settleAiAnswers(f.root, "requirements-analysis", result.decisionFilePath!)).toThrow("do not match");
  }, T);

  test("a mixed seven-question set stops for the person and names every ineligible question", async () => {
    const f = ra(JA_MIXED), result = await evaluate(f, model(f.root, ok(7)), { stage: "requirements-analysis" });
    expect(result.status).toBe("block");
    expect(result.reason).toContain("human");
    expect(result.classification!.map((entry) => `${entry.questionId}:${entry.eligibility}`)).toEqual(["Q1:eligible", "Q2:eligible", "Q3:protected", "Q4:eligible", "Q5:protected", "Q6:malformed", "Q7:malformed"]);
    expect(readdirSync(join(f.intent, "decisions"))).not.toContain("ai-question-decisions");
    // Without the protected questions the remaining unmarked/malformed ones still stop the whole set.
    const unprotected = JA_MIXED.replace("主な対象ユーザー層", "メモの色分け").replace("本番環境への初回リリース時期", "初期のカラーテーマ");
    const g = ra(unprotected), second = await evaluate(g, model(g.root, ok(7)), { stage: "requirements-analysis" });
    expect(second.status).toBe("block");
    expect(second.reason).toContain("exactly one");
    expect(second.classification!.map((entry) => entry.eligibility)).toEqual(["eligible", "eligible", "unmarked", "eligible", "eligible", "malformed", "malformed"]);
  }, T);

  test("full-width and lookalike headings, colons and digits are never guessed at", async () => {
    expect(questionSections("## Q1 — a\n## Q2：b\n## Q3. c\n## Q4\n").map((section) => section.id)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(questionSections("## Q１ a\n## Ｑ2 b\n## Q3a c\n## Q4回答\n### Q5 d\n#Q6\n")).toEqual([]);
    for (const body of [
      "## Q１ 全角数字\n[AI-Autonomy]: low-risk-reversible\n[Answer]:\n",
      "## Ｑ1 全角Q\n[AI-Autonomy]: low-risk-reversible\n[Answer]:\n",
      "### Q1 見出しレベル違い\n[AI-Autonomy]: low-risk-reversible\n[Answer]:\n",
      "## Q1 正常\n[AI-Autonomy]: low-risk-reversible\n[Answer]:\n## Q1 重複\n[AI-Autonomy]: low-risk-reversible\n[Answer]:\n",
      "## Q1 全角コロンの印\n[AI-Autonomy]：low-risk-reversible\n[Answer]:\n",
      "## Q1 別の値\n[AI-Autonomy]: low-risk\n[Answer]:\n",
    ]) {
      const f = ra(body), result = await evaluate(f, model(f.root, ok(1)), { stage: "requirements-analysis" });
      expect(result.status, body).toBe("block");
    }
    // A full-width `[Answer]：` is not a slot at all, so the set has no blank answer to fill.
    const noSlot = ra("## Q1 全角の回答欄\n[AI-Autonomy]: low-risk-reversible\n[Answer]：\n");
    expect((await evaluate(noSlot, model(noSlot.root, ok(1)), { stage: "requirements-analysis" })).reason).toContain("entirely blank");
    // The lexical guard over-blocks by design: a harmless "no personal data" note in the preamble still stops the set.
    const overBlocked = ra(JA_SIX.replace("（合成データのみ）", "（合成、個人情報なし）"));
    expect((await evaluate(overBlocked, model(overBlocked.root, ok(6)), { stage: "requirements-analysis" })).reason).toContain("human");
    expect(classifyQuestions("## Q1 x\n[AI-Autonomy]: low-risk-reversible\n[Answer]:\n").classification).toEqual([{ questionId: "Q1", eligibility: "eligible" }]);
  }, T);

  test("model output: one code fence is unwrapped; multi-line or short answer sets are refused", () => {
    const fenced = JSON.stringify({ result: "```json\n" + JSON.stringify(ok(1)) + "\n```" });
    expect(modelResult(fenced, 1).answers).toHaveLength(1);
    expect(() => modelResult(JSON.stringify({ result: JSON.stringify(ok(1, { answers: [{ answer: "A.\nB.", source: "delegated-ai-assumption", reason: "x", evidencePaths: [] }] })) }), 1)).toThrow();
    expect(() => modelResult(JSON.stringify({ result: JSON.stringify(ok(5)) }), 6)).toThrow("every");
    expect(() => modelResult(JSON.stringify({ result: "前置き ```json\n{}\n```" }), 1)).toThrow();
  });
});

describe("per-Unit Construction questions", () => {
  const unitState = (opts: { iteration?: string; current?: string; unitStage?: string; unit?: string; unitState?: string; ownership?: string } = {}) => [
    "- **Scope**: greenfield", "- **Lifecycle Phase**: CONSTRUCTION", `- **Current Stage**: ${opts.current ?? "functional-design"}`,
    ...(opts.iteration === "" ? [] : [`- **Construction Iteration**: ${opts.iteration ?? "unit-major"}`]), ...(opts.ownership ? [`- **Unit Ownership**: ${opts.ownership}`] : []),
    `- [-] functional-design — EXECUTE`, `- [ ] nfr-requirements — EXECUTE`, `- [ ] code-generation — EXECUTE`, "", "## Runtime State",
    `- **Active Unit**: ${opts.unit ?? "notes-core"}`, `- **Unit Stage**: ${opts.unitStage ?? "nfr-requirements"}`, `- **Unit State**: ${opts.unitState ?? "in-progress"}`, "",
  ].join("\n");
  const Q = "## Q1 — 一覧取得の目標応答時間\n合成データ100件で一覧を表示する時の目標です。\nA. 200ms以内\nB. 500ms以内\nX. その他（具体的に記入）\n[AI-Autonomy]: low-risk-reversible\n[Answer]:\n\n## Q2 ログの保持件数（ローカル）\nA. 直近1,000件\nB. 直近10,000件\nX. その他（具体的に記入）\n[AI-Autonomy]: low-risk-reversible\n[Answer]:\n";
  const unitFixture = (stage = "nfr-requirements", state = unitState(), unit = "notes-core") => fixture(Q, { stage, state, questionsPath: `construction/${unit}/${stage}/${stage}-questions.md` });

  test("unit-major: binds the decision to the Unit and settles with a Unit-scoped receipt", async () => {
    const f = unitFixture(), result = await evaluate(f, model(f.root, ok(2)), { stage: "nfr-requirements", unit: "notes-core" });
    expect(result.status, result.reason).toBe("answer");
    expect(result.decision!.unit).toBe("notes-core");
    expect(result.decision!.questions.path).toBe("aidlc/spaces/default/intents/example/construction/notes-core/nfr-requirements/nfr-requirements-questions.md");
    expect(result.generatedCommandArgs).toEqual(["--stage", "nfr-requirements", "--unit", "notes-core", "--ai-decision-file", result.decisionFilePath!]);
    applyDecision(f.root, f.questions, result);
    expect(() => settleAiAnswers(f.root, "nfr-requirements", result.decisionFilePath!)).toThrow("Unit does not match");
    expect(() => settleAiAnswers(f.root, "nfr-requirements", result.decisionFilePath!, "notes-ui")).toThrow("Unit does not match");
    expect(settleAiAnswers(f.root, "nfr-requirements", result.decisionFilePath!, "notes-core")).toMatchObject({ recorded: "d-ai-question-ledger", unit: "notes-core", count: 2 });
    const rows = ledgerRows(f.intent); expect(rows.filter((row) => row.unit === "notes-core")).toHaveLength(2); expect(humanTurns(officialAudit(f.intent))).toBe(1);
  }, T);

  test("stage-major: the Unit must be active on the current stage", async () => {
    const state = unitState({ iteration: "stage-major", current: "functional-design", unitStage: "functional-design" });
    const f = unitFixture("functional-design", state), result = await evaluate(f, model(f.root, ok(2)), { stage: "functional-design", unit: "notes-core" });
    expect(result.status, result.reason).toBe("answer");
    const wrongStage = unitFixture("nfr-requirements", unitState({ iteration: "stage-major", current: "functional-design", unitStage: "nfr-requirements" }));
    expect((await evaluate(wrongStage, model(wrongStage.root, ok(2)), { stage: "nfr-requirements", unit: "notes-core" })).reason).toContain("current in-progress");
  }, T);

  test("fails closed for every unsupported per-Unit layout", async () => {
    const cases: Array<[string, Fixture, { stage: string; unit: string | null; questionsFile?: string }, string]> = [];
    const other = unitFixture(); cases.push(["another Unit", other, { stage: "nfr-requirements", unit: "notes-ui" }, "not in progress"]);
    const paused = unitFixture("nfr-requirements", unitState({ unitState: "paused" })); cases.push(["paused Unit", paused, { stage: "nfr-requirements", unit: "notes-core" }, "not in progress"]);
    const team = unitFixture("nfr-requirements", unitState({ ownership: "team" })); cases.push(["team ownership", team, { stage: "nfr-requirements", unit: "notes-core" }, "team-owned"]);
    const noIteration = unitFixture("nfr-requirements", unitState({ iteration: "" })); cases.push(["no iteration", noIteration, { stage: "nfr-requirements", unit: "notes-core" }, "unsupported Construction Iteration"]);
    const codegen = unitFixture("code-generation", unitState({ unitStage: "code-generation" })); cases.push(["engine-owned code-generation", codegen, { stage: "code-generation", unit: "notes-core" }, "engine owns"]);
    const unnamed = unitFixture(); cases.push(["active Unit but no --unit", unnamed, { stage: "nfr-requirements", unit: null }, "name it with --unit"]);
    const stageLevel = unitFixture(); writeFileSync(join(stageLevel.intent, "construction/nfr-requirements-questions.md"), Q);
    cases.push(["stage-level path for a Unit", stageLevel, { stage: "nfr-requirements", unit: "notes-core", questionsFile: "aidlc/spaces/default/intents/example/construction/nfr-requirements-questions.md" }, "canonical"]);
    const traversal = unitFixture(); cases.push(["invalid Unit name", traversal, { stage: "nfr-requirements", unit: "../x" }, "invalid Unit"]);
    const ideation = fixture(); cases.push(["Unit outside Construction", ideation, { stage: "intent-capture", unit: "notes-core" }, "per-Unit Construction design stages"]);
    for (const [label, f, extra, reason] of cases) {
      const result = await evaluate(f, model(f.root, ok(2)), extra);
      expect(result.status, label).toBe("block");
      expect(result.reason, label).toContain(reason);
    }
  }, T);

  test("a Unit receipt goes stale when the Unit moves on", async () => {
    const f = unitFixture(), result = await evaluate(f, model(f.root, ok(2)), { stage: "nfr-requirements", unit: "notes-core" });
    applyDecision(f.root, f.questions, result);
    writeFileSync(join(f.intent, "aidlc-state.md"), unitState({ unitStage: "nfr-design" }));
    expect(() => settleAiAnswers(f.root, "nfr-requirements", result.decisionFilePath!, "notes-core")).toThrow("state hash or path changed");
  }, T);
});
