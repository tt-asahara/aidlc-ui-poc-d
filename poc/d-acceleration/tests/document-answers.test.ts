import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentAnswerGrant, documentDelegationStages, DOCUMENT_DELEGATION_COMMAND } from "../ai-approval-controller.ts";
import { AI_QUESTION_ANSWER_LEDGER, questionTemplate } from "../ai-question-answers.ts";
import { answerFromDocuments, bindDocuments, citationRefusal, DOCUMENT_ANSWER_LEDGER, DOCUMENT_HANDOVER, documentDigest, intentUuid, loadKbDocuments, normalizeForQuote, parseProposals, stageDocuments, takePathFile, type KbDocument } from "../document-answers.ts";
import { recordHumanTurn } from "./human-turn.ts";

const T = 60_000;
// The source dispatcher; `aidlc engine knowledge ...` is the route both install channels use.
const AIDLC = join(import.meta.dir, "..", "..", "..", "core", "tools", "aidlc.ts");
const UUID = "01a17000-0000-7000-8000-00000000d0c5";
const nowSecond = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const state = (scope = "ui-poc-document-driven", start = nowSecond()) => `- **Scope**: ${scope}
- **Start Date**: ${start}
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
const DOCUMENT = "# 家計簿アプリ要件\n\n対象ユーザーは共働きの30代夫婦とする。\n表示通貨は日本円のみとし、外貨は扱わない。\n";

/** A document-driven intent whose hand-over documents went through onboard + bind, as the SKILL entry runs them. */
function fixture(opts: { delegate?: boolean; words?: string; scope?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "aidlc-doc-answers-")), intents = join(root, "aidlc/spaces/default/intents"), intent = join(intents, "example");
  mkdirSync(join(intent, "ideation/intent-capture"), { recursive: true });
  writeFileSync(join(intents, "active-intent"), "example\n");
  writeFileSync(join(intents, "intents.json"), JSON.stringify([{ uuid: UUID, slug: "example", dirName: "example", scope: opts.scope ?? "ui-poc-document-driven", status: "in-flight", request: "00000000" }], null, 2));
  writeFileSync(join(intent, "ideation/intent-capture/intent-capture-questions.md"), QUESTIONS);
  mkdirSync(join(root, "handover"));
  writeFileSync(join(root, "handover/requirements.md"), DOCUMENT);
  stageDocuments(root, "handover", AIDLC);
  writeFileSync(join(intent, "aidlc-state.md"), state(opts.scope));
  if ((opts.scope ?? "ui-poc-document-driven") === "ui-poc-document-driven") bindDocuments(root, AIDLC);
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
const docId = (root: string) => loadKbDocuments(root, UUID, AIDLC)[0].id;
const run = (f: { root: string }, executable: string, stage = "intent-capture") => answerFromDocuments({ projectDir: f.root, stage, claudeExecutable: executable, aidlcTool: AIDLC });
const officialAudit = (intent: string) => existsSync(join(intent, "audit")) ? readdirSync(join(intent, "audit")).map((name) => readFileSync(join(intent, "audit", name), "utf8")).join("\n") : "";
const settle = (id: string) => ({ answers: [
  { questionId: "Q1", outcome: "document-fact", answer: "B. 共働き世帯", citations: [{ documentId: id, quote: "対象ユーザーは共働きの30代夫婦とする。" }], reason: "要件に記載" },
  { questionId: "Q2", outcome: "document-fact", answer: "B. 多通貨", citations: [{ documentId: id, quote: "表示通貨は多通貨とする。" }], reason: "捏造" },
  { questionId: "Q3", outcome: "needs-person", answer: null, citations: [], reason: "資料に公開時期の記載がない" },
] });

describe("document-driven grant", () => {
  test("covers the open question stages up to user-stories in state order, never completed or later stages", () => {
    expect(documentDelegationStages(state())).toEqual(["intent-capture", "scope-definition", "rough-mockups", "practices-discovery", "requirements-analysis", "user-stories"]);
    expect(documentDelegationStages(state().replace("- [-] intent-capture", "- [x] intent-capture"))[0]).toBe("scope-definition");
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
  test("bind refuses a leftover hand-over: another scope, another space, or an intent older than the hand-over", () => {
    const f = fixture({ delegate: false });
    mkdirSync(join(f.root, "later"));
    writeFileSync(join(f.root, "later/x.md"), "画面はスマートフォン優先とし、PCでも閲覧できればよい。\n");
    stageDocuments(f.root, "later", AIDLC);
    writeFileSync(join(f.intent, "aidlc-state.md"), state("ui-poc-document-driven", "2020-01-01T00:00:00Z"));
    expect(() => bindDocuments(f.root, AIDLC)).toThrow(/does not belong to the active example intent and was removed/);
    expect(existsSync(join(f.root, DOCUMENT_HANDOVER))).toBe(false);
  }, T);
  test("is refused outside the document-driven scope", () => {
    expect(() => fixture({ scope: "ui-poc-application" })).toThrow(/needs a ui-poc-document-driven intent/);
  }, T);
});

describe("citation check", () => {
  const documents = new Map<string, KbDocument>([["d1", { id: "d1", path: "documents/r.md", sha256: "x", sourceRevision: "x", content: "表示通貨は\n日本円のみとし、外貨は扱わない。", contentSha256: "y", normalized: normalizeForQuote("表示通貨は\n日本円のみとし、外貨は扱わない。"), original: null }]]);
  test("accepts a verbatim quote across width and whitespace differences", () => {
    expect(normalizeForQuote("ＡＢＣ  def")).toBe("abc def");
    expect(citationRefusal([{ documentId: "d1", quote: "表示通貨は 日本円のみとし、外貨は扱わない" }], documents)).toBeNull();
  });
  test("refuses an invented, too short, or unknown-document quote", () => {
    expect(citationRefusal([{ documentId: "d1", quote: "表示通貨は米ドルとし、円は扱わない" }], documents)).toMatch(/not in documents\/r.md/);
    expect(citationRefusal([{ documentId: "d1", quote: "日本円のみとし、外貨" }], documents)).toMatch(/too short/);
    expect(citationRefusal([{ documentId: "d9", quote: "表示通貨は日本円のみとし、外貨は扱わない" }], documents)).toMatch(/unknown or stale/);
  });
  test("parses one entry per blank question in order and rejects shape errors", () => {
    const entry = { questionId: "Q1", outcome: "needs-person", answer: null, citations: [], reason: "記載なし" };
    expect(parseProposals(JSON.stringify({ result: JSON.stringify({ answers: [entry] }) }), ["Q1"])[0].outcome).toBe("needs-person");
    expect(() => parseProposals(JSON.stringify({ result: JSON.stringify({ answers: [entry] }) }), ["Q2"])).toThrow();
    // One unusable entry goes to the person on its own; the others survive.
    const mixed = parseProposals(JSON.stringify({ result: JSON.stringify({ answers: [{ ...entry, outcome: "document-fact", answer: "A", citations: [] }, { questionId: "Q2", outcome: "document-fact", answer: "line\nbreak", citations: [{ documentId: "d1", quote: "表示通貨は日本円のみとし、外貨は扱わない" }], reason: "r" }, { questionId: "Q3", outcome: "document-fact", answer: "A. 日本円のみ", citations: [{ documentId: "d1", quote: "表示通貨は日本円のみとし、外貨は扱わない" }], reason: "r" }] }) }), ["Q1", "Q2", "Q3"]);
    expect(mixed.map((proposal) => proposal.outcome)).toEqual(["needs-person", "needs-person", "document-fact"]);
    expect(mixed[0].reason).toMatch(/unusable/);
  });
  test("citation lines stay outside the low-risk settler's question template", () => {
    expect(questionTemplate("## Q1\n[Answer]: A\n[Answer Source]: document-fact\n[AI Decision ID]: x\n[Citation]: documents/r.md — \"q\"\n")).toBe("## Q1\n[Answer]:\n");
  });
});

describe("hand-over documents", () => {
  test("onboard copies a folder under documents/, skips hidden and secret-looking names, and refuses to overwrite a different original", () => {
    const f = fixture({ delegate: false }), from = join(f.root, "more");
    mkdirSync(join(from, "sub"), { recursive: true });
    writeFileSync(join(from, "要件.md"), "画面はスマホ優先とする。\n");
    writeFileSync(join(from, "sub", "notes.txt"), "通知はメールのみ。\n");
    writeFileSync(join(from, ".env"), "SECRET=1\n");
    writeFileSync(join(from, "api-token.txt"), "x\n");
    writeFileSync(join(from, "image.png"), "png");
    const first = stageDocuments(f.root, "more", AIDLC);
    expect(first.staged.map((entry) => entry.path).sort()).toEqual(["documents/more/sub/notes.txt", "documents/more/要件.md"]);
    expect(first.staged.every((entry) => entry.status === "fresh" && entry.state === "extracted")).toBe(true);
    expect(existsSync(join(f.root, DOCUMENT_HANDOVER))).toBe(true);
    expect(stageDocuments(f.root, "more", AIDLC).staged.every((entry) => entry.status === "already")).toBe(true);
    writeFileSync(join(from, "要件.md"), "画面はPC優先とする。\n");
    expect(() => stageDocuments(f.root, "more", AIDLC)).toThrow(/different document already exists/);
  }, T);
  test("refuses to sweep AI-DLC's own trees, and takes the person's path from a file it then removes", () => {
    const f = fixture({ delegate: false });
    expect(() => stageDocuments(f.root, ".", AIDLC)).toThrow(/not one that is or contains aidlc/);
    expect(() => stageDocuments(f.root, "aidlc/spaces/default/knowledge/documents", AIDLC)).toThrow(/not one that is or contains aidlc/);
    mkdirSync(join(f.root, ".aidlc-engine"), { recursive: true });
    writeFileSync(join(f.root, ".aidlc-engine/d-docs-path-abc.txt"), "docs/Bob's spec $(rm -rf x)\n");
    expect(takePathFile(f.root, ".aidlc-engine/d-docs-path-abc.txt")).toBe("docs/Bob's spec $(rm -rf x)");
    expect(existsSync(join(f.root, ".aidlc-engine/d-docs-path-abc.txt"))).toBe(false);
    expect(() => takePathFile(f.root, "words.txt")).toThrow(/must be .aidlc-engine/);
  }, T);
  test("bind associates the hand-over with the active intent only, and an intent reads only its own documents", () => {
    const f = fixture({ delegate: false });
    expect(existsSync(join(f.root, DOCUMENT_HANDOVER))).toBe(false);
    expect(loadKbDocuments(f.root, UUID, AIDLC).map((document) => document.path)).toEqual(["documents/handover/requirements.md"]);
    // A document handed over but not yet bound to this intent is never read for it.
    mkdirSync(join(f.root, "other"));
    writeFileSync(join(f.root, "other/old.md"), "別案件: 表示通貨は米ドルとし、円は扱わない。\n");
    stageDocuments(f.root, "other", AIDLC);
    expect(loadKbDocuments(f.root, UUID, AIDLC).map((document) => document.path)).toEqual(["documents/handover/requirements.md"]);
    writeFileSync(join(f.intent, "aidlc-state.md"), state());
    bindDocuments(f.root, AIDLC);
    expect(loadKbDocuments(f.root, UUID, AIDLC)).toHaveLength(2);
    expect(() => bindDocuments(f.root, AIDLC)).toThrow(/run onboard first/);
    expect(intentUuid(f.intent)).toBe(UUID);
  }, T);
});

describe("answerFromDocuments", () => {
  test("writes only verified answers, leaves the rest for the person, and records only its own D ledger", async () => {
    const f = fixture(), id = docId(f.root), auditBefore = officialAudit(f.intent);
    const result = await run(f, model(f.root, settle(id)));
    expect(result.status).toBe("answered");
    expect(result.answered).toEqual(["Q1"]);
    expect(result.residual.map((entry) => entry.questionId)).toEqual(["Q2", "Q3"]);
    const body = readFileSync(f.questions, "utf8");
    expect(body).toContain("[Answer]: B. 共働き世帯\n[Answer Source]: document-fact\n[AI Decision ID]: ");
    expect(body).toContain('[Citation]: documents/handover/requirements.md — "対象ユーザーは共働きの30代夫婦とする。"');
    expect(body.match(/^\[Answer\]:\s*$/gm)?.length).toBe(2);
    const rows = readFileSync(join(f.intent, DOCUMENT_ANSWER_LEDGER), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "d-document-grounded-answer", questionId: "Q1", answerSource: "document-fact", actor: "ai" });
    // The delegated low-risk ledger, whose readers accept only their own rows, is untouched.
    expect(existsSync(join(f.intent, AI_QUESTION_ANSWER_LEDGER))).toBe(false);
    expect(officialAudit(f.intent)).toBe(auditBefore);
    expect(documentDigest(f.root, "intent-capture")).toEqual({
      stage: "intent-capture",
      questionsFile: "aidlc/spaces/default/intents/example/ideation/intent-capture/intent-capture-questions.md",
      fromDocuments: [{ questionId: "Q1", answer: "B. 共働き世帯", citations: [{ path: "documents/handover/requirements.md", quote: "対象ユーザーは共働きの30代夫婦とする。" }] }],
      answeredByPerson: [],
      stillOpen: ["Q2", "Q3"],
    });
  }, T);
  test("the model receives the whole prompt on stdin, not as one argv entry", async () => {
    const f = fixture(), id = docId(f.root), seen = join(f.root, "stdin.txt"), argv = join(f.root, "argv.txt");
    const path = join(f.root, "claude-stdin");
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argv}'\ncat > '${seen}'\ncat <<'AIDLC_EOF'\n${JSON.stringify({ result: JSON.stringify(settle(id)) })}\nAIDLC_EOF\n`);
    chmodSync(path, 0o755);
    expect((await run(f, path)).answered).toEqual(["Q1"]);
    expect(readFileSync(seen, "utf8")).toContain("対象ユーザーは共働きの30代夫婦とする。");
    expect(readFileSync(argv, "utf8")).not.toContain("対象ユーザーは共働き");
  }, T);
  test("the digest shows a slot the person rewrote as theirs, and an AI-looking slot without a ledger row as theirs", async () => {
    const f = fixture(), id = docId(f.root);
    await run(f, model(f.root, settle(id)));
    writeFileSync(f.questions, readFileSync(f.questions, "utf8").replace("[Answer]: B. 共働き世帯", "[Answer]: A. 単身者"));
    writeFileSync(f.questions, readFileSync(f.questions, "utf8").replace(/^\[Answer\]:\s*$/m, `[Answer]: A. 日本円のみ\n[Answer Source]: document-fact\n[AI Decision ID]: ${"0".repeat(64)}`));
    const digest = documentDigest(f.root, "intent-capture");
    expect(digest.fromDocuments).toEqual([]);
    expect(digest.answeredByPerson).toEqual(["Q1", "Q2"]);
    expect(digest.stillOpen).toEqual(["Q3"]);
  }, T);
  test("a second run answers nothing new once no blank question is settled by the documents", async () => {
    const f = fixture(), id = docId(f.root);
    const first = { answers: [
      { questionId: "Q1", outcome: "document-fact", answer: "B. 共働き世帯", citations: [{ documentId: id, quote: "対象ユーザーは共働きの30代夫婦とする。" }], reason: "要件" },
      { questionId: "Q2", outcome: "document-fact", answer: "A. 日本円のみ", citations: [{ documentId: id, quote: "表示通貨は日本円のみとし、外貨は扱わない。" }], reason: "要件" },
      { questionId: "Q3", outcome: "needs-person", answer: null, citations: [], reason: "記載なし" },
    ] };
    expect((await run(f, model(f.root, first))).answered).toEqual(["Q1", "Q2"]);
    const second = await run(f, model(f.root, { answers: [{ questionId: "Q3", outcome: "needs-person", answer: null, citations: [], reason: "記載なし" }] }));
    expect(second.answered).toEqual([]);
    expect(second.residual).toEqual([{ questionId: "Q3", reason: "記載なし" }]);
  }, T);
  test("stops without writing when a document is removed while the model runs", async () => {
    const f = fixture(), id = docId(f.root);
    const original = join(f.root, "aidlc/spaces/default/knowledge/documents/handover/requirements.md");
    // The stand-in model deletes the original and syncs DocumentKB before answering.
    const path = join(f.root, "claude-removes");
    writeFileSync(path, `#!/bin/sh\nrm '${original}'\n'${process.execPath}' '${AIDLC}' engine knowledge sync >/dev/null 2>&1\ncat <<'AIDLC_EOF'\n${JSON.stringify({ result: JSON.stringify(settle(id)) })}\nAIDLC_EOF\n`);
    chmodSync(path, 0o755);
    await expect(run(f, path)).rejects.toThrow(/changed or was removed during assessment/);
    expect(readFileSync(f.questions, "utf8")).toBe(QUESTIONS);
    expect(existsSync(join(f.intent, DOCUMENT_ANSWER_LEDGER))).toBe(false);
  }, T);
  test("blocks without the person's delegation, outside the granted stages, without associated documents, and on invalid model output", async () => {
    const none = fixture({ delegate: false });
    expect((await run(none, model(none.root, { answers: [] }))).reason).toMatch(/AI-DLC delegate-document-answers/);
    const f = fixture();
    expect((await run(f, model(f.root, { answers: [] }), "refined-mockups")).status).toBe("block");
    const bad = await run(f, model(f.root, { answers: [{ questionId: "Q1" }] }));
    expect(bad.status).toBe("block");
    expect(readFileSync(f.questions, "utf8")).toBe(QUESTIONS);
    unlinkSync(join(f.root, "aidlc/spaces/default/knowledge/documents/handover/requirements.md"));
    const synced = Bun.spawnSync([process.execPath, AIDLC, "engine", "knowledge", "sync"], { cwd: f.root, env: { ...process.env, CLAUDE_PROJECT_DIR: f.root } });
    expect(synced.exitCode).toBe(0);
    expect((await run(f, model(f.root, { answers: [] }))).reason).toMatch(/no extracted document is associated with this intent/);
  }, T);
});
