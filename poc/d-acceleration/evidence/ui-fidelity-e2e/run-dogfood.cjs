#!/usr/bin/env node
'use strict';
// Bounded, scripted dogfood: Refined Mockups -> Functional Design -> Code
// Generation -> Build and Test on a disposable temp project, with a REAL model
// (local authenticated `claude` CLI) authoring Functional Design and the
// implementation, and the real renderer + gates checking them.
//
// What this is NOT: an official `/aidlc` session. The official engine,
// directives, reviewer agents, and human gates are not exercised; approvals in
// the ledger are SYNTHETIC operator entries written by this script (labelled as
// such) solely so the deterministic gate chain can run. See README.md here for
// the remaining official procedure.
//
// usage: node run-dogfood.cjs [--model sonnet] [--out <evidence-dir>]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const UI = path.resolve(__dirname, '..', '..', '..', 'ui-poc');
const fidelity = require(path.join(UI, 'tools', 'ui-poc-fidelity.cjs'));
const M = require(path.join(UI, 'tools', 'ui-poc-element-matrix.cjs'));
const { check, hash } = require(path.join(UI, 'tools', 'ui-poc-evidence.cjs'));
const h = require(path.join(UI, 'tests', 'fidelity-e2e-helpers.cjs'));

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
const model = args.model || 'sonnet';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(args.out || path.join(__dirname, 'runs', runId));
fs.mkdirSync(outDir, { recursive: true });
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-fidelity-dogfood-'));
const evidence = path.join(project, 'evidence'); fs.mkdirSync(evidence);
const ledgerPath = path.join(project, 'operator-ledger.json');
const record = { schema: 1, runId, project, requestedModel: model, synthetic: { approvals: 'SYNTHETIC operator ledger entries written by this script; no human approved anything', engine: 'official /aidlc engine not exercised' }, steps: [] };
const save = () => fs.writeFileSync(path.join(outDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
const write = (name, text) => { fs.writeFileSync(path.join(evidence, name), text); fs.writeFileSync(path.join(outDir, name), text); };
const ref = name => ({ path: name, sha256: hash(fs.readFileSync(path.join(evidence, name))) });
const ledger = { approvals: [] };
const STATES = h.STATES;
const mappings = STATES.map((s, i) => ({ screen: 'SCREEN-NOTES', state: s.state, ac: `AC-NOTE-00${i + 1}`, asset: 'notes.html', check: `renderer capture of ${s.state}` }));
const requiredMappings = mappings.map(m => `${m.screen}/${m.state}/${m.ac}`);
const render = c => `# Dogfood UI contract (${c.stage})\n\n## Artifact References\n\n## Screen State Acceptance Mapping\n\n## Approval Evidence\n\nSYNTHETIC operator approval for a scripted dogfood; not a human gate.\n\n## Testing Brief\n\n\`\`\`ui-poc-contract\n${JSON.stringify(c, null, 1)}\n\`\`\`\n`;
function approve(stage, name) { ledger.approvals.push({ contractSha256: ref(name).sha256, stage, arm: 'C', status: 'approved', source: 'synthetic-dogfood-operator', reviewer: 'synthetic-dogfood-operator (not a human)', requiredMappings }); fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2)); }
const gate = (stage, name) => check({ stage, outputPath: path.join(evidence, name), approvalLedger: ledgerPath, imageFeatures: {} });
const fragment = rel => fs.readFileSync(path.join(UI, 'contributions', 'construction', rel), 'utf8').split('## fragment:')[1];

function claude(prompt, label) {
  const started = Date.now();
  const r = spawnSync('claude', ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--no-session-persistence'], { input: prompt, cwd: project, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900000 });
  const ms = Date.now() - started;
  let out; try { out = JSON.parse(r.stdout); } catch { out = { parseError: true, stdout: String(r.stdout).slice(0, 2000), stderr: String(r.stderr).slice(0, 2000) }; }
  const step = { step: label, kind: 'model', requestedModel: model, runtimeModels: out.modelUsage ? Object.keys(out.modelUsage) : null, usage: out.usage || null, totalCostUsd: out.total_cost_usd ?? null, durationMs: ms, exitStatus: r.status, isError: out.is_error ?? null };
  record.steps.push(step); save();
  if (r.status !== 0 || !out.result) throw new Error(`${label}: claude failed (${r.status}) ${String(r.stderr).slice(0, 500)}`);
  const text = out.result.trim(); const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  fs.writeFileSync(path.join(outDir, `${label}.raw.txt`), out.result);
  return JSON.parse(json);
}

(async () => {
  // 1. Refined Mockups output: approved HTML captured by the real renderer before approval.
  fs.copyFileSync(path.join(h.FIXTURE, 'approved', 'notes.html'), path.join(evidence, 'notes.html'));
  const approved = await h.captureStates({ html: path.join(evidence, 'notes.html') });
  write('ui-semantic-snapshot.json', `${JSON.stringify(approved, null, 2)}\n`);
  const base = { arm: 'C', schema: 2, mappings, requiredMappings };
  const refined = { ...base, stage: 'refined-mockups', assets: [ref('notes.html'), ref('ui-semantic-snapshot.json')], fidelity: { approvedSnapshot: ref('ui-semantic-snapshot.json'), dispositions: [] } };
  write('ui-poc-refined-contract.md', render(refined));
  record.steps.push({ step: 'refined-mockups-gate', result: gate('refined-mockups', 'ui-poc-refined-contract.md') }); approve('refined-mockups', 'ui-poc-refined-contract.md'); save();

  // 2. Functional Design: tool generates the matrix skeleton; the model supplies knowledge.
  const skeleton = M.generateRuleMatrix(approved);
  const rows = skeleton.rows.map(({ ruleIds, unimplementedReason, ...generated }) => generated);
  let fdResult, matrix, fd, attempt = 0, feedback = '';
  while (attempt < 2) {
    attempt += 1;
    fd = claude(`あなたは AI-DLC の Functional Design ステージの担当者です。次のステージ指示に従ってください。\n\n${fragment('functional-design.md')}\n\n承認済み意味スナップショットから生成された要素行（generated fields は変更禁止）:\n${JSON.stringify(rows, null, 1)}\n\n承認済みモックアップ HTML:\n${fs.readFileSync(path.join(evidence, 'notes.html'), 'utf8')}\n${feedback}\n出力: 次の形の JSON オブジェクトだけを返してください（前後に説明文を付けない）。\n{"functionalSpec":"functional-spec.md の全文 (日本語)","frontendComponents":"frontend-components.md の全文","ruleIds":{"<elementKey>":["<ID>",...]},"unimplemented":{"<elementKey>":"<理由>"}}\nrequiresRule が true の全要素に ruleIds を割り当て、使う ID は全て Markdown 内で定義すること。exactCopy の文言は Markdown に逐語で含めること。`, `functional-design-attempt-${attempt}`);
    write('functional-spec.md', fd.functionalSpec); write('frontend-components.md', fd.frontendComponents);
    matrix = M.generateRuleMatrix(approved);
    for (const row of matrix.rows) { if (fd.ruleIds?.[row.elementKey]) row.ruleIds = fd.ruleIds[row.elementKey]; if (fd.unimplemented?.[row.elementKey]) row.unimplementedReason = fd.unimplemented[row.elementKey]; }
    write('ui-poc-element-rule-matrix.json', `${JSON.stringify(matrix, null, 2)}\n`);
    fdResult = M.checkRuleMatrix({ matrix, approved, fdTexts: { 'functional-spec.md': fd.functionalSpec, 'frontend-components.md': fd.frontendComponents } });
    record.steps.push({ step: `functional-design-matrix-check-${attempt}`, result: fdResult }); save();
    if (fdResult.pass) break;
    feedback = `\n前回の出力は Functional Design ゲートで NOT-READY でした。指摘を全て解消してください（generated fields は変更せず、文言は逐語）:\n${JSON.stringify(fdResult.findings, null, 1)}\n`;
  }
  const fdContract = { ...base, stage: 'functional-design', assets: [ref('notes.html'), ref('ui-semantic-snapshot.json'), ref('ui-poc-element-rule-matrix.json'), ref('functional-spec.md'), ref('frontend-components.md')], upstream: { ...ref('ui-poc-refined-contract.md'), stage: 'refined-mockups' }, fidelity: { approvedSnapshot: ref('ui-semantic-snapshot.json'), dispositions: [], elementRuleMatrix: ref('ui-poc-element-rule-matrix.json'), functionalDesign: [ref('functional-spec.md'), ref('frontend-components.md')] } };
  write('ui-poc-functional-contract.md', render(fdContract));
  const fdGate = gate('functional-design', 'ui-poc-functional-contract.md');
  record.steps.push({ step: 'functional-design-gate', result: fdGate }); save();
  if (!fdGate.pass) throw new Error('Functional Design gate NOT-READY after repair round; stopping (no approval fabricated for a failing gate)');
  approve('functional-design', 'ui-poc-functional-contract.md');

  // 3. Code Generation: the model receives the approved FD contract + matrix, not the mockup alone.
  const impl = claude(`あなたは AI-DLC の Code Generation ステージの担当者です。次のステージ指示に従ってください。\n\n${fragment('code-generation.md')}\n\n承認済み functional-spec.md:\n${fd.functionalSpec}\n\n承認済み frontend-components.md:\n${fd.frontendComponents}\n\n承認済み要素→ルール対応表:\n${JSON.stringify(matrix.rows, null, 1)}\n\n参照用の承認済みモックアップ HTML（画面の正本。見た目は自由だが要素の意味・文言・data-ui-* 属性・状態遷移は一致させる）:\n${fs.readFileSync(path.join(evidence, 'notes.html'), 'utf8')}\n\n実装要件: 依存なしの単一 HTML ファイル (インライン CSS/JS)。ルート要素に data-ui-screen="SCREEN-NOTES" と data-ui-state。?scenario=storage-error では保存データ読み込み失敗として STATE-STORAGE-ERROR、?scenario=private ではプライベートモードとして STATE-PRIVATE-MODE を初期表示。localStorage を使用。承認済みモックアップを丸写しせず、データモデルから描画する独立実装にすること。\n出力: {"html":"<!doctype html>..."} の JSON オブジェクトだけを返してください。`, 'code-generation');
  write('implementation.html', impl.html);
  const implContract = { ...base, stage: 'code-generation', assets: [ref('notes.html'), ref('ui-semantic-snapshot.json'), ref('ui-poc-element-rule-matrix.json'), ref('ui-poc-functional-contract.md'), ref('implementation.html')], upstream: { ...ref('ui-poc-refined-contract.md'), stage: 'refined-mockups' }, fidelity: { approvedSnapshot: ref('ui-semantic-snapshot.json'), dispositions: [], elementRuleMatrix: ref('ui-poc-element-rule-matrix.json'), functionalDesignContract: ref('ui-poc-functional-contract.md') } };
  write('ui-poc-implementation-contract.md', render(implContract));
  const cgGate = gate('code-generation', 'ui-poc-implementation-contract.md');
  record.steps.push({ step: 'code-generation-gate', result: cgGate }); save();
  if (!cgGate.pass) throw new Error('Code Generation gate NOT-READY');
  approve('code-generation', 'ui-poc-implementation-contract.md');

  // 4. Build and Test: run the implementation on loopback and capture every approved state.
  const server = await h.serve(impl.html);
  let actual; const captureErrors = [];
  try {
    const snaps = [];
    for (const spec of STATES) { try { snaps.push(await h.captureState({ url: server.url }, spec)); } catch (error) { captureErrors.push({ state: spec.state, error: error.message }); } }
    if (captureErrors.length) record.steps.push({ step: 'build-and-test-capture-errors', captureErrors });
    if (!snaps.length) throw new Error('no implementation state could be captured');
    actual = fidelity.mergeSnapshots(snaps);
  } finally { await server.close(); }
  write('actual-snapshot.json', `${JSON.stringify(actual, null, 2)}\n`);
  const testMatrix = M.generateTestMatrix({ approved, actual, ruleMatrix: matrix, dispositions: [], ledger });
  write('ui-poc-element-test-matrix.json', `${JSON.stringify(testMatrix, null, 2)}\n`);
  const bt = { ...base, stage: 'build-and-test', assets: [ref('notes.html'), ref('ui-semantic-snapshot.json'), ref('ui-poc-element-rule-matrix.json'), ref('actual-snapshot.json'), ref('ui-poc-element-test-matrix.json')], upstream: { ...ref('ui-poc-implementation-contract.md'), stage: 'code-generation' }, fidelity: { approvedSnapshot: ref('ui-semantic-snapshot.json'), dispositions: [], elementRuleMatrix: ref('ui-poc-element-rule-matrix.json'), actualSnapshot: ref('actual-snapshot.json'), elementTestMatrix: ref('ui-poc-element-test-matrix.json') } };
  write('ui-poc-test-contract.md', render(bt));
  const btGate = gate('build-and-test', 'ui-poc-test-contract.md');
  const semantics = Object.fromEntries(Object.entries(h.REQUIRED_SEMANTICS).map(([name, keys]) => [name, keys.map(key => ({ key, result: testMatrix.rows.find(r => r.elementKey === key)?.result ?? 'not-captured' }))]));
  record.steps.push({ step: 'build-and-test-gate', summary: testMatrix.summary, semantics, failedRows: testMatrix.rows.filter(r => r.result === 'fail'), result: btGate });
  record.verdict = btGate.pass && !captureErrors.length ? 'READY' : 'NOT-READY';
  save();
  console.log(JSON.stringify({ verdict: record.verdict, outDir, summary: testMatrix.summary }));
})().catch(error => { record.verdict = 'STOPPED'; record.error = error.message; save(); console.error(error.message); process.exitCode = 1; });
