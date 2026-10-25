import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentAnswerGrant, documentDelegationStages, DOCUMENT_DELEGATION_COMMAND } from "../ai-approval-controller.ts";
import { AI_QUESTION_ANSWER_LEDGER } from "../ai-question-answers.ts";
import { answerFromDocuments, citationRefusal, documentDigest, stageDocuments, loadKbDocuments, normalizeForQuote, parseProposals, type KbDocument } from "../document-answers.ts";
import { recordHumanTurn } from "./human-turn.ts";

const T = 60_000;
const KNOWLEDGE = join(import.meta.dir, "..", "..", "..", "core", "tools", "aidlc-knowledge.ts");
const STATE = `- **Scope**: ui-poc-document-driven
- **Lifecycle Phase**: IDEATION
- **Current Stage**: intent-capture

### INITIALIZATION PHASE
- [x] state-init — EXECUTE

### IDEATION PHASE
- [-] intent-capture — EXECUTE
- [ ] market-research — SKIP
- [ ] scope-definition — EXECUTE
- [ ] rough-mockups — EXECUTE

### INCEPTION PHASE
- [ ] practices-discovery — EXECUTE
- [ ] requirements-analysis — EXECUTE
- [ ] user-stories — EXECUTE
- [ ] refined-mockups — SKIP
- [ ] domain-design — EXECUTE
`;
const QUESTIONS = `# Intent Capture 質問

## Q1 — 対象ユーザー
誰のためのアプリですか？
A. 単身者
B. 共働き世帯
X. その他（具体的に記入）
[Answer]:

## Q2 — 表示通貨
A. 日本円のみ
B. 多通貨
[Answer]:

## Q3 — 公開時期
[Answer]:
`;
const DOCUMENT = "# 家計簿アプリ要件\n\n対象ユーザーは共働きの30代夫婦とする。\n表示通貨は日本円のみとする。\n";

function fixture(opts: { delegate?: boolean; words?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "aidlc-doc-answers-")), intent = join(root, "aidlc/spaces/default/intents/example");
  mkdirSync(join(intent, "ideation/intent-capture"), { recursive: true });
  writeFileSync(join(root, "aidlc/spaces/default/intents/active-intent"), "example\n");
  writeFileSync(join(intent, "aidlc-state.md"), STATE);
  writeFileSync(join(intent, "ideation/intent-capture/intent-capture-questions.md"), QUESTIONS);
  mkdirSync(join(root, "aidlc/spaces/default/knowledge/documents"), { recursive: true });
  writeFileSync(join(root, "aidlc/spaces/default/knowledge/documents/requirements.md"), DOCUMENT);
  const onboard = spawnSync(process.execPath, [KNOWLEDGE, "onboard"], { cwd: root, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
  if (onboard.status !== 0) throw new Error(onboard.stderr || onboard.stdout);
  if (opts.delegate !== false) {
    const words = opts.words ?? DOCUMENT_DELEGATION_COMMAND;
    writeFileSync(join(root, "words.txt"), words);
    recordHumanTurn(root, words);
    createDocumentAnswerGrant({ projectDir: root, userMessageFile: "words.txt", messageId: "msg-1" });
  }
  return { root, intent, questions: join(intent, "ideation/intent-capture/intent-capture-questions.md") };
}
// A POSIX-shell stand-in for the judgment model: prints a Claude `--output-format json` envelope.
function model(root: string, payload: object) { const path = join(root, `claude-${Math.random().toString(36).slice(2)}`); writeFileSync(path, `#!/bin/sh\ncat <<'AIDLC_EOF'\n${JSON.stringify({ result: JSON.stringify(payload) })}\nAIDLC_EOF\n`); chmodSync(path, 0o755); return path; }
const docId = (root: string) => loadKbDocuments(root, KNOWLEDGE)[0].id;
const run = (f: { root: string }, executable: string) => answerFromDocuments({ projectDir: f.root, stage: "intent-capture", claudeExecutable: executable, knowledgeTool: KNOWLEDGE });
const officialAudit = (intent: string) => existsSync(join(intent, "audit")) ? readdirSync(join(intent, "audit")).map((name) => readFileSync(join(intent, "audit", name), "utf8")).join("\n") : "";

describe("document-driven grant", () => {
  test("covers the open question stages up to user-stories, never skipped or initialization stages", () => {
    expect(documentDelegationStages(STATE)).toEqual(["intent-capture", "scope-definition", "rough-mockups", "practices-discovery", "requirements-analysis", "user-stories"]);
    expect(documentDelegationStages(STATE.replace("- [-] intent-capture", "- [x] intent-capture"))[0]).toBe("scope-definition");
  });
  test("needs the exact words as the person's own latest turn", () => {
    expect(() => fixture({ words: "資料から答えて" })).toThrow(/exactly AI-DLC delegate-document-answers/);
    const f = fixture({ delegate: false });
    writeFileSync(join(f.root, "words.txt"), DOCUMENT_DELEGATION_COMMAND);
    expect(() => createDocumentAnswerGrant({ projectDir: f.root, userMessageFile: "words.txt", messageId: "m" })).toThrow(/latest turn/);
    recordHumanTurn(f.root, DOCUMENT_DELEGATION_COMMAND);
    recordHumanTurn(f.root, "承認");
    expect(() => createDocumentAnswerGrant({ projectDir: f.root, userMessageFile: "words.txt", messageId: "m" })).toThrow(/latest turn/);
  }, T);
});

describe("citation check", () => {
  const documents = new Map<string, KbDocument>([["d1", { id: "d1", path: "documents/r.md", sha256: "x", sourceRevision: "x", content: "表示通貨は\n日本円のみとする。", contentSha256: "y" }]]);
  test("accepts a verbatim quote across width and whitespace differences", () => {
    expect(normalizeForQuote("ＡＢＣ  def")).toBe("abc def");
    expect(citationRefusal([{ documentId: "d1", quote: "表示通貨は 日本円のみとする" }], documents)).toBeNull();
  });
  test("refuses an invented, too short, or unknown-document quote", () => {
    expect(citationRefusal([{ documentId: "d1", quote: "表示通貨は米ドルとする" }], documents)).toMatch(/not in documents\/r.md/);
    expect(citationRefusal([{ documentId: "d1", quote: "日本円" }], documents)).toMatch(/too short/);
    expect(citationRefusal([{ documentId: "d9", quote: "表示通貨は日本円のみとする" }], documents)).toMatch(/unknown or stale/);
  });
  test("parses one entry per blank question in order and rejects shape errors", () => {
    const entry = { questionId: "Q1", outcome: "needs-person", answer: null, citations: [], reason: "記載なし" };
    expect(parseProposals(JSON.stringify({ result: JSON.stringify({ answers: [entry] }) }), ["Q1"])[0].outcome).toBe("needs-person");
    expect(() => parseProposals(JSON.stringify({ result: JSON.stringify({ answers: [entry] }) }), ["Q2"])).toThrow();
    expect(() => parseProposals(JSON.stringify({ result: JSON.stringify({ answers: [{ ...entry, outcome: "document-fact", answer: "A", citations: [] }] }) }), ["Q1"])).toThrow();
  });
});

describe("answerFromDocuments", () => {
  test("writes only verified answers, leaves the rest for the person, and records only the D ledger", async () => {
    const f = fixture(), id = docId(f.root), auditBefore = officialAudit(f.intent);
    const result = await run(f, model(f.root, { answers: [
      { questionId: "Q1", outcome: "document-fact", answer: "B. 共働き世帯", citations: [{ documentId: id, quote: "対象ユーザーは共働きの30代夫婦とする。" }], reason: "要件に記載" },
      { questionId: "Q2", outcome: "document-fact", answer: "B. 多通貨", citations: [{ documentId: id, quote: "表示通貨は多通貨とする。" }], reason: "捏造" },
      { questionId: "Q3", outcome: "needs-person", answer: null, citations: [], reason: "資料に公開時期の記載がない" },
    ] }));
    expect(result.status).toBe("answered");
    expect(result.answered).toEqual(["Q1"]);
    expect(result.residual.map((entry) => entry.questionId)).toEqual(["Q2", "Q3"]);
    const body = readFileSync(f.questions, "utf8");
    expect(body).toContain("[Answer]: B. 共働き世帯\n[Answer Source]: document-fact\n[AI Decision ID]: ");
    expect(body).toContain('[Citation]: documents/requirements.md — "対象ユーザーは共働きの30代夫婦とする。"');
    expect(body.match(/^\[Answer\]:\s*$/gm)?.length).toBe(2);
    const rows = readFileSync(join(f.intent, AI_QUESTION_ANSWER_LEDGER), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "d-document-grounded-answer", questionId: "Q1", answerSource: "document-fact", actor: "ai" });
    expect(officialAudit(f.intent)).toBe(auditBefore);
    expect(documentDigest(f.root, "intent-capture")).toMatchObject({
      fromDocuments: [{ questionId: "Q1", answer: "B. 共働き世帯", citations: [{ path: "documents/requirements.md", quote: "対象ユーザーは共働きの30代夫婦とする。" }] }],
      stillOpen: ["Q2", "Q3"],
      answeredByPerson: [],
    });
  }, T);
  test("a second run answers nothing new once no blank question is settled by the documents", async () => {
    const f = fixture(), id = docId(f.root);
    const first = { answers: [
      { questionId: "Q1", outcome: "document-fact", answer: "B. 共働き世帯", citations: [{ documentId: id, quote: "対象ユーザーは共働きの30代夫婦とする。" }], reason: "要件" },
      { questionId: "Q2", outcome: "document-fact", answer: "A. 日本円のみ", citations: [{ documentId: id, quote: "表示通貨は日本円のみとする。" }], reason: "要件" },
      { questionId: "Q3", outcome: "needs-person", answer: null, citations: [], reason: "記載なし" },
    ] };
    expect((await run(f, model(f.root, first))).answered).toEqual(["Q1", "Q2"]);
    const second = await run(f, model(f.root, { answers: [{ questionId: "Q3", outcome: "needs-person", answer: null, citations: [], reason: "記載なし" }] }));
    expect(second.answered).toEqual([]);
    expect(second.residual).toEqual([{ questionId: "Q3", reason: "記載なし" }]);
  }, T);
  test("blocks without the person's delegation, outside the granted stages, and on invalid model output", async () => {
    const none = fixture({ delegate: false });
    expect((await run(none, model(none.root, { answers: [] }))).reason).toMatch(/AI-DLC delegate-document-answers/);
    const f = fixture();
    expect((await answerFromDocuments({ projectDir: f.root, stage: "refined-mockups", claudeExecutable: model(f.root, { answers: [] }), knowledgeTool: KNOWLEDGE })).status).toBe("block");
    const bad = await run(f, model(f.root, { answers: [{ questionId: "Q1" }] }));
    expect(bad.status).toBe("block");
    expect(readFileSync(f.questions, "utf8")).toBe(QUESTIONS);
  }, T);
});

describe("stageDocuments", () => {
  test("copies a handed-over folder under documents/, indexes it, and refuses to overwrite a different original", () => {
    const f = fixture({ delegate: false }), from = join(f.root, "handover");
    mkdirSync(join(from, "sub"), { recursive: true });
    writeFileSync(join(from, "要件.md"), "画面はスマホ優先とする。\n");
    writeFileSync(join(from, "sub", "notes.txt"), "通知はメールのみ。\n");
    writeFileSync(join(from, ".env"), "SECRET=1\n");
    writeFileSync(join(from, "api-token.txt"), "x\n");
    writeFileSync(join(from, "image.png"), "png");
    const first = stageDocuments(f.root, "handover", KNOWLEDGE);
    expect(first.staged.map((entry) => entry.path).sort()).toEqual(["documents/handover/sub/notes.txt", "documents/handover/要件.md"]);
    expect(first.staged.every((entry) => entry.status === "fresh")).toBe(true);
    expect(first.extracted).toBe(3);
    expect(stageDocuments(f.root, "handover", KNOWLEDGE).staged.every((entry) => entry.status === "already")).toBe(true);
    writeFileSync(join(from, "要件.md"), "画面はPC優先とする。\n");
    expect(() => stageDocuments(f.root, "handover", KNOWLEDGE)).toThrow(/different document already exists/);
  }, T);
});
