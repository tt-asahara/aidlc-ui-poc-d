'use strict';
// Deterministic (no browser) proof that element semantics survive
// Refined Mockups -> Functional Design -> implementation -> Build and Test.
// The approved and actual snapshots are real renderer captures recorded from
// fixtures/fidelity-e2e (see fidelity-e2e-browser.test.cjs for re-capture).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashJson, elementDeltaSha256, compareSnapshots } = require('../tools/ui-poc-fidelity.cjs');
const M = require('../tools/ui-poc-element-matrix.cjs');
const { check, hash } = require('../tools/ui-poc-evidence.cjs');
const { FIXTURE, STATES, REQUIRED_SEMANTICS } = require('./fidelity-e2e-helpers.cjs');

const read = rel => fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
const json = rel => JSON.parse(read(rel));
const clone = value => JSON.parse(JSON.stringify(value));
const approved = () => json('approved/ui-semantic-snapshot.json');
const actual = () => json('implementation/ui-semantic-snapshot.actual.json');
const ruleMatrix = () => json('functional-design/ui-poc-element-rule-matrix.json');
const fdTexts = () => ({ 'functional-spec.md': read('functional-design/functional-spec.md'), 'frontend-components.md': read('functional-design/frontend-components.md') });
const element = (snapshot, key) => { const [screen, state, id] = key.split('/'); return snapshot.captures.find(c => c.screen === screen && c.state === state)?.elements.find(e => e.key === id); };
const codes = result => result.findings.map(f => `${f.code}${f.elementKey ? ' ' + f.elementKey : ''}`);
const ALL_KEYS = Object.values(REQUIRED_SEMANTICS).flat();
function receipt(snapshot, key, status, reason, differences) {
  const deltaSha256 = elementDeltaSha256(key, differences);
  return {
    disposition: { elementKey: key, status, reason, approvalReceipt: `decision-${key}`, deltaSha256 },
    approval: { decisionId: `decision-${key}`, stage: 'functional-design', status: 'approved', snapshotSha256: hashJson(snapshot), dispositionSha256: hashJson({ elementKey: key, status, reason }), deltaSha256, elementKeys: [key], source: 'synthetic-test-only', reviewer: 'synthetic-reviewer' },
  };
}

// ---------- (3) the fixture itself carries every reported semantic ----------
test('fixture declares the full approved state denominator', () => {
  assert.deepEqual(approved().captures.map(c => c.state), STATES.map(s => s.state));
  assert.equal(approved().captures.every(c => c.rendered === true), true);
});
test('fixture carries each reported semantic as a renderer-observed contract', () => {
  const snapshot = approved();
  for (const [semantic, keys] of Object.entries(REQUIRED_SEMANTICS)) for (const key of keys) assert.ok(element(snapshot, key), `${semantic}: ${key} missing from approved snapshot`);
  assert.match(element(snapshot, 'SCREEN-NOTES/STATE-CONFIRM-DELETE/DELETE-CONFIRM-DETAIL').text, /「買い物リスト」.*取り消せません/);
  assert.equal(element(snapshot, 'SCREEN-NOTES/STATE-SAVED/SAVE-COMPLETE').text, '✓ 保存しました');
  assert.equal(element(snapshot, 'SCREEN-NOTES/STATE-DELETED/DELETE-COMPLETE').text, 'メモを削除しました');
  const memo = element(snapshot, 'SCREEN-NOTES/STATE-LIST/MEMO-BODY');
  assert.equal(memo.truncation?.mode, 'required'); assert.equal(memo.truncated, true);
  assert.deepEqual(element(snapshot, 'SCREEN-NOTES/STATE-LIST/EXPAND-MEMO').action, { id: 'EXPAND', expectedState: 'STATE-EXPANDED', target: 'MEMO-BODY' });
  assert.match(element(snapshot, 'SCREEN-NOTES/STATE-PRIVATE-MODE/PRIVATE-MODE-GUIDANCE').text, /プライベートモード/);
  assert.match(element(snapshot, 'SCREEN-NOTES/STATE-STORAGE-ERROR/STORAGE-READ-ERROR').text, /読み込めませんでした/);
  for (const key of ALL_KEYS) { const e = element(snapshot, key); assert.ok(e.exactCopy || e.truncation, `${key} must be exact copy or a truncation contract`); }
});

// ---------- (1) element -> rule matrix generated deterministically and consumed at FD ----------
test('rule matrix generation is deterministic and the fixture matrix keeps the generated half intact', () => {
  const first = M.generateRuleMatrix(approved()), second = M.generateRuleMatrix(approved());
  assert.deepEqual(first, second);
  assert.equal(first.snapshotSha256, hashJson(approved()));
  const strip = matrix => matrix.rows.map(({ ruleIds, unimplementedReason, ...generated }) => generated);
  assert.deepEqual(strip(ruleMatrix()), strip(first));
  assert.ok(first.rows.length > 20);
  for (const key of ALL_KEYS) assert.equal(first.rows.find(r => r.elementKey === key).requiresRule, true, key);
});
test('Functional Design consumes the matrix: fixture passes', () => {
  const result = M.checkRuleMatrix({ matrix: ruleMatrix(), approved: approved(), fdTexts: fdTexts() });
  assert.deepEqual(codes(result), []); assert.equal(result.rows, ruleMatrix().rows.length);
});
for (const [semantic, keys] of Object.entries(REQUIRED_SEMANTICS)) {
  test(`FD fails if ${semantic} is dropped from the matrix mapping`, () => {
    const matrix = ruleMatrix(); for (const row of matrix.rows) if (keys.includes(row.elementKey)) row.ruleIds = [];
    const result = M.checkRuleMatrix({ matrix, approved: approved(), fdTexts: fdTexts() });
    for (const key of keys) assert.ok(codes(result).includes(`ELEMENT_UNMAPPED ${key}`), `${key}: ${codes(result)}`);
  });
  const copyKeys = keys.filter(key => element(approved(), key).exactCopy);
  if (copyKeys.length) test(`FD fails if ${semantic} wording does not propagate verbatim into Functional Design`, () => {
    const texts = fdTexts(); const wording = element(approved(), copyKeys[0]).text;
    for (const name of Object.keys(texts)) texts[name] = texts[name].split(wording).join('（文言は実装時に調整）');
    const result = M.checkRuleMatrix({ matrix: ruleMatrix(), approved: approved(), fdTexts: texts });
    assert.ok(codes(result).includes(`EXACT_COPY_NOT_PROPAGATED ${copyKeys[0]}`), codes(result).join(', '));
  });
}
test('FD fails when a referenced rule ID is not defined in Functional Design', () => {
  const texts = fdTexts(); for (const name of Object.keys(texts)) texts[name] = texts[name].split('BR-PRIVATE-MODE').join('BR-OTHER');
  assert.ok(codes(M.checkRuleMatrix({ matrix: ruleMatrix(), approved: approved(), fdTexts: texts })).includes('RULE_ID_UNKNOWN SCREEN-NOTES/STATE-PRIVATE-MODE/PRIVATE-MODE-GUIDANCE'));
});
test('FD matrix is bidirectional: missing, extra, duplicate and altered rows fail', () => {
  const base = ruleMatrix();
  const missing = clone(base); missing.rows = missing.rows.filter(r => r.elementKey !== ALL_KEYS[0]);
  assert.ok(codes(M.checkRuleMatrix({ matrix: missing, approved: approved(), fdTexts: fdTexts() })).includes(`MATRIX_ROW_MISSING ${ALL_KEYS[0]}`));
  const extra = clone(base); extra.rows.push({ ...extra.rows[0], elementKey: 'SCREEN-NOTES/STATE-LIST/INVENTED' });
  assert.ok(codes(M.checkRuleMatrix({ matrix: extra, approved: approved(), fdTexts: fdTexts() })).includes('MATRIX_ROW_EXTRA SCREEN-NOTES/STATE-LIST/INVENTED'));
  const altered = clone(base); altered.rows.find(r => r.elementKey === 'SCREEN-NOTES/STATE-SAVED/SAVE-COMPLETE').text = '保存しました';
  assert.ok(codes(M.checkRuleMatrix({ matrix: altered, approved: approved(), fdTexts: fdTexts() })).includes('MATRIX_ROW_ALTERED SCREEN-NOTES/STATE-SAVED/SAVE-COMPLETE'));
  const empty = clone(base); empty.rows = [];
  assert.equal(M.checkRuleMatrix({ matrix: empty, approved: approved(), fdTexts: fdTexts() }).pass, false);
});
test('unimplemented reason requires an approved intentionally-omitted receipt; then Build and Test records the omission', () => {
  const key = 'SCREEN-NOTES/STATE-STORAGE-ERROR/RETRY-LOAD';
  const matrix = ruleMatrix(); const row = matrix.rows.find(r => r.elementKey === key); row.ruleIds = []; row.unimplementedReason = '再読み込みはブラウザ操作で代替する';
  assert.ok(codes(M.checkRuleMatrix({ matrix, approved: approved(), fdTexts: fdTexts() })).includes(`UNIMPLEMENTED_WITHOUT_DISPOSITION ${key}`));
  const { disposition, approval } = receipt(approved(), key, 'intentionally-omitted', row.unimplementedReason, ['missing']);
  assert.ok(codes(M.checkRuleMatrix({ matrix, approved: approved(), fdTexts: fdTexts(), dispositions: [disposition], ledger: {} })).includes(`DISPOSITION_WITHOUT_RECEIPT ${key}`));
  assert.deepEqual(codes(M.checkRuleMatrix({ matrix, approved: approved(), fdTexts: fdTexts(), dispositions: [disposition], ledger: { approvals: [approval] } })), []);
  const omitted = actual(); for (const c of omitted.captures) c.elements = c.elements.filter(e => !(c.state === 'STATE-STORAGE-ERROR' && e.key === 'RETRY-LOAD'));
  const tm = M.generateTestMatrix({ approved: approved(), actual: omitted, ruleMatrix: matrix, dispositions: [disposition], ledger: { approvals: [approval] } });
  assert.equal(tm.rows.find(r => r.elementKey === key).result, 'intentionally-omitted'); assert.equal(tm.summary.fail, 0);
});

// ---------- (1) element-level Build and Test matrix ----------
test('Build and Test matrix over the recorded implementation capture passes every approved element', () => {
  const tm = M.generateTestMatrix({ approved: approved(), actual: actual(), ruleMatrix: ruleMatrix() });
  assert.equal(tm.summary.total, ruleMatrix().rows.length); assert.equal(tm.summary.fail, 0);
  for (const key of ALL_KEYS) assert.ok(tm.rows.find(r => r.elementKey === key).ruleIds.length, key);
  assert.equal(M.checkTestMatrix({ matrix: tm, approved: approved(), actual: actual(), ruleMatrix: ruleMatrix() }).pass, true);
});
const IMPLEMENTATION_DROPS = {
  'deletion-confirmation-details': snap => { element(snap, 'SCREEN-NOTES/STATE-CONFIRM-DELETE/DELETE-CONFIRM-DETAIL').text = '削除します。'; },
  'completion-wording': snap => { element(snap, 'SCREEN-NOTES/STATE-SAVED/SAVE-COMPLETE').text = '保存完了'; },
  'long-note-truncation-expansion': snap => { const memo = element(snap, 'SCREEN-NOTES/STATE-LIST/MEMO-BODY'); memo.truncated = false; element(snap, 'SCREEN-NOTES/STATE-LIST/EXPAND-MEMO').actionVerified = false; },
  'private-mode-guidance': snap => { const c = snap.captures.find(x => x.state === 'STATE-PRIVATE-MODE'); c.elements = c.elements.filter(e => e.key !== 'PRIVATE-MODE-GUIDANCE'); },
  'storage-read-failure-text': snap => { element(snap, 'SCREEN-NOTES/STATE-STORAGE-ERROR/STORAGE-READ-ERROR').text = 'エラーが発生しました'; },
};
test('every reported semantic has an implementation-drop mutation', () => assert.deepEqual(Object.keys(IMPLEMENTATION_DROPS).sort(), Object.keys(REQUIRED_SEMANTICS).sort()));
for (const [semantic, mutate] of Object.entries(IMPLEMENTATION_DROPS)) {
  test(`Build and Test fails if the implementation drops ${semantic}`, () => {
    const regressed = actual(); mutate(regressed);
    const tm = M.generateTestMatrix({ approved: approved(), actual: regressed, ruleMatrix: ruleMatrix() });
    const failed = tm.rows.filter(r => r.result === 'fail').map(r => r.elementKey);
    assert.ok(failed.some(key => REQUIRED_SEMANTICS[semantic].includes(key)), `${semantic}: ${failed}`);
    assert.equal(compareSnapshots(approved(), regressed).pass, false);
    assert.equal(M.checkTestMatrix({ matrix: tm, approved: approved(), actual: regressed, ruleMatrix: ruleMatrix() }).pass, false);
  });
}
test('a hand-edited Build and Test matrix (fail rewritten as pass) is rejected', () => {
  const regressed = actual(); IMPLEMENTATION_DROPS['completion-wording'](regressed);
  const tm = M.generateTestMatrix({ approved: approved(), actual: regressed, ruleMatrix: ruleMatrix() });
  for (const row of tm.rows) { row.result = 'pass'; row.differences = []; } tm.summary = { total: tm.rows.length, pass: tm.rows.length, fail: 0, deviated: 0 };
  assert.ok(codes(M.checkTestMatrix({ matrix: tm, approved: approved(), actual: regressed, ruleMatrix: ruleMatrix() })).includes('TEST_MATRIX_MISMATCH'));
});
test('an unapproved important element added by the implementation fails Build and Test', () => {
  const added = actual(); added.captures[0].elements.push({ key: 'UPSELL-BANNER', explicitId: true, kind: 'text', text: 'プレミアムに登録', important: true });
  const tm = M.generateTestMatrix({ approved: approved(), actual: added, ruleMatrix: ruleMatrix() });
  assert.equal(tm.rows.find(r => r.elementKey === 'SCREEN-NOTES/STATE-LIST/UPSELL-BANNER').result, 'fail');
  assert.match(compareSnapshots(approved(), added).findings.join('\n'), /Unapproved UI addition/);
});

// ---------- (2) approved-upstream change control ----------
test('silent wording change in Functional Design fails; a user-confirmed deviation receipt passes and binds the implementation delta', () => {
  const key = 'SCREEN-NOTES/STATE-SAVED/SAVE-COMPLETE';
  const texts = fdTexts(); for (const name of Object.keys(texts)) texts[name] = texts[name].split('✓ 保存しました').join('保存しました。');
  assert.ok(codes(M.checkRuleMatrix({ matrix: ruleMatrix(), approved: approved(), fdTexts: texts })).includes(`EXACT_COPY_NOT_PROPAGATED ${key}`));
  const { disposition, approval } = receipt(approved(), key, 'approved-deviation', '利用者が句点付き文言を承認', ['copy "✓ 保存しました" != "保存しました。"']);
  const ledger = { approvals: [approval] };
  assert.deepEqual(codes(M.checkRuleMatrix({ matrix: ruleMatrix(), approved: approved(), fdTexts: texts, dispositions: [disposition], ledger })), []);
  const changed = actual(); element(changed, key).text = '保存しました。';
  assert.equal(M.generateTestMatrix({ approved: approved(), actual: changed, ruleMatrix: ruleMatrix(), dispositions: [disposition], ledger }).rows.find(r => r.elementKey === key).result, 'approved-deviation');
  element(changed, key).text = '保存しました！';
  assert.equal(M.generateTestMatrix({ approved: approved(), actual: changed, ruleMatrix: ruleMatrix(), dispositions: [disposition], ledger }).rows.find(r => r.elementKey === key).result, 'fail');
});
test('artifact revision: the declared element delta must equal the computed delta; FD matrix goes stale and changed rows reset', () => {
  const previous = approved(), revised = approved();
  element(revised, 'SCREEN-NOTES/STATE-SAVED/SAVE-COMPLETE').text = '✓ メモを保存しました';
  const delta = M.upstreamDelta(previous, revised);
  assert.deepEqual(delta.changedElements, ['SCREEN-NOTES/STATE-SAVED/SAVE-COMPLETE']);
  assert.equal(M.checkRevision({ revision: { changedElements: delta.changedElements, deltaSha256: delta.deltaSha256 }, previous, current: revised }).pass, true);
  assert.equal(M.checkRevision({ revision: { changedElements: [], deltaSha256: hashJson([]) }, previous, current: revised }).pass, false);
  const sneaky = clone(revised); element(sneaky, 'SCREEN-NOTES/STATE-STORAGE-ERROR/STORAGE-READ-ERROR').text = 'エラー';
  assert.equal(M.checkRevision({ revision: { changedElements: delta.changedElements, deltaSha256: delta.deltaSha256 }, previous, current: sneaky }).pass, false, 'an undeclared second change is detected');
  assert.equal(M.checkRevision({ revision: { changedElements: [], deltaSha256: hashJson([]) }, previous, current: clone(previous) }).pass, false, 'an empty revision is not a revision');
  assert.ok(codes(M.checkRuleMatrix({ matrix: ruleMatrix(), approved: revised, fdTexts: fdTexts() })).includes('MATRIX_SNAPSHOT_STALE'));
  const regenerated = M.generateRuleMatrix(revised, ruleMatrix());
  assert.deepEqual(regenerated.rows.find(r => r.elementKey === 'SCREEN-NOTES/STATE-SAVED/SAVE-COMPLETE').ruleIds, []);
  assert.deepEqual(regenerated.rows.find(r => r.elementKey === 'SCREEN-NOTES/STATE-LIST/MEMO-BODY').ruleIds, ['BR-NOTE-TRUNCATE']);
  assert.ok(codes(M.checkRuleMatrix({ matrix: regenerated, approved: revised, fdTexts: fdTexts() })).includes('ELEMENT_UNMAPPED SCREEN-NOTES/STATE-SAVED/SAVE-COMPLETE'));
});

// ---------- (4) handoff consumes the approved contract + baseline; (5) flag matrix ----------
function render(c) { return '# Synthetic fixture, not workflow evidence\n\n## Artifact References\n\n## Screen State Acceptance Mapping\n\n## Approval Evidence\n\n## Testing Brief\n\n```ui-poc-contract\n' + JSON.stringify(c, null, 1) + '\n```\n'; }
function chain(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-fidelity-chain-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'evidence'); fs.mkdirSync(root);
  const ledgerPath = path.join(temp, 'operator-ledger.json');
  const copy = (rel, name) => fs.copyFileSync(path.join(FIXTURE, rel), path.join(root, name));
  copy('approved/notes.html', 'notes.html'); copy('approved/ui-semantic-snapshot.json', 'ui-semantic-snapshot.json'); copy('implementation/ui-semantic-snapshot.actual.json', 'actual-snapshot.json');
  copy('functional-design/ui-poc-element-rule-matrix.json', 'ui-poc-element-rule-matrix.json'); copy('functional-design/functional-spec.md', 'functional-spec.md'); copy('functional-design/frontend-components.md', 'frontend-components.md');
  const ref = name => ({ path: name, sha256: hash(fs.readFileSync(path.join(root, name))) });
  const mappings = STATES.map((s, i) => ({ screen: 'SCREEN-NOTES', state: s.state, ac: `AC-NOTE-00${i + 1}`, asset: 'notes.html', check: `renderer capture of ${s.state}` }));
  const requiredMappings = mappings.map(m => `${m.screen}/${m.state}/${m.ac}`);
  const ledger = { approvals: [] };
  const f = { root, ledgerPath, ledger, ref, contracts: {}, dispositions: [] };
  f.write = (stage, name, c) => { f.contracts[stage] = c; fs.writeFileSync(path.join(root, name), render(c)); return ref(name); };
  f.approve = (stage, name) => { f.ledger.approvals = f.ledger.approvals.filter(a => a.stage !== stage || a.decisionId); f.ledger.approvals.push({ contractSha256: ref(name).sha256, stage, arm: 'C', status: 'approved', source: 'synthetic-test-only', reviewer: 'synthetic-reviewer', requiredMappings }); fs.writeFileSync(ledgerPath, JSON.stringify(f.ledger)); };
  f.build = (mutate = {}) => {
    const base = { arm: 'C', schema: 2, mappings, requiredMappings };
    const refined = { ...base, stage: 'refined-mockups', assets: [ref('notes.html'), ref('ui-semantic-snapshot.json')], fidelity: { approvedSnapshot: ref('ui-semantic-snapshot.json'), dispositions: f.dispositions } };
    (mutate.refined || (() => {}))(refined); f.write('refined-mockups', 'ui-poc-refined-contract.md', refined); f.approve('refined-mockups', 'ui-poc-refined-contract.md');
    const fd = { ...base, stage: 'functional-design', assets: [ref('notes.html'), ref('ui-semantic-snapshot.json'), ref('ui-poc-element-rule-matrix.json'), ref('functional-spec.md'), ref('frontend-components.md')], upstream: { ...ref('ui-poc-refined-contract.md'), stage: 'refined-mockups' }, fidelity: { approvedSnapshot: ref('ui-semantic-snapshot.json'), dispositions: f.dispositions, elementRuleMatrix: ref('ui-poc-element-rule-matrix.json'), functionalDesign: [ref('functional-spec.md'), ref('frontend-components.md')] } };
    (mutate.fd || (() => {}))(fd); f.write('functional-design', 'ui-poc-functional-contract.md', fd); f.approve('functional-design', 'ui-poc-functional-contract.md');
    const impl = { ...base, stage: 'code-generation', assets: [ref('notes.html'), ref('ui-semantic-snapshot.json'), ref('ui-poc-element-rule-matrix.json'), ref('ui-poc-functional-contract.md')], upstream: { ...ref('ui-poc-refined-contract.md'), stage: 'refined-mockups' }, fidelity: { approvedSnapshot: ref('ui-semantic-snapshot.json'), dispositions: f.dispositions, elementRuleMatrix: ref('ui-poc-element-rule-matrix.json'), functionalDesignContract: ref('ui-poc-functional-contract.md') } };
    (mutate.impl || (() => {}))(impl); f.write('code-generation', 'ui-poc-implementation-contract.md', impl); f.approve('code-generation', 'ui-poc-implementation-contract.md');
    const tm = M.generateTestMatrix({ approved: json('approved/ui-semantic-snapshot.json'), actual: JSON.parse(fs.readFileSync(path.join(root, 'actual-snapshot.json'))), ruleMatrix: JSON.parse(fs.readFileSync(path.join(root, 'ui-poc-element-rule-matrix.json'))), dispositions: f.dispositions, ledger: f.ledger });
    fs.writeFileSync(path.join(root, 'ui-poc-element-test-matrix.json'), JSON.stringify(tm, null, 2));
    const bt = { ...base, stage: 'build-and-test', assets: [ref('notes.html'), ref('ui-semantic-snapshot.json'), ref('ui-poc-element-rule-matrix.json'), ref('actual-snapshot.json'), ref('ui-poc-element-test-matrix.json')], upstream: { ...ref('ui-poc-implementation-contract.md'), stage: 'code-generation' }, fidelity: { approvedSnapshot: ref('ui-semantic-snapshot.json'), dispositions: f.dispositions, elementRuleMatrix: ref('ui-poc-element-rule-matrix.json'), actualSnapshot: ref('actual-snapshot.json'), elementTestMatrix: ref('ui-poc-element-test-matrix.json') } };
    (mutate.bt || (() => {}))(bt); f.write('build-and-test', 'ui-poc-test-contract.md', bt);
    return f;
  };
  f.run = (stage, imageFeatures = {}) => check({ stage, outputPath: path.join(root, { 'refined-mockups': 'ui-poc-refined-contract.md', 'functional-design': 'ui-poc-functional-contract.md', 'code-generation': 'ui-poc-implementation-contract.md', 'build-and-test': 'ui-poc-test-contract.md' }[stage]), approvalLedger: ledgerPath, imageFeatures });
  return f;
}
test('complete schema 2 chain passes at every stage gate', t => {
  const f = chain(t).build();
  for (const stage of ['refined-mockups', 'functional-design', 'code-generation', 'build-and-test']) assert.deepEqual(f.run(stage).findings, [], stage);
});
const HANDOFF_REFUSALS = {
  'no approved refined contract (upstream)': { impl: c => { delete c.upstream; } },
  'no approved semantic snapshot baseline': { impl: c => { delete c.fidelity.approvedSnapshot; } },
  'no approved Functional Design contract': { impl: c => { delete c.fidelity.functionalDesignContract; } },
  'no element rule matrix': { impl: c => { delete c.fidelity.elementRuleMatrix; } },
  'a different approved snapshot than Functional Design': { impl: c => { c.fidelity.approvedSnapshot = { path: 'actual-snapshot.json', sha256: c.assets.find(a => a.path === 'ui-semantic-snapshot.json').sha256 }; } },
  'dispositions silently added after FD approval': { impl: c => { c.fidelity.dispositions = [{ elementKey: 'SCREEN-NOTES/STATE-SAVED/SAVE-COMPLETE', status: 'approved-deviation', reason: 'x', approvalReceipt: 'none', deltaSha256: 'a'.repeat(64) }]; } },
};
for (const [name, mutate] of Object.entries(HANDOFF_REFUSALS)) test(`implementation handoff is refused with ${name}`, t => {
  const f = chain(t).build(mutate);
  assert.equal(f.run('code-generation').pass, false, name);
  assert.equal(f.run('build-and-test').pass, false, `${name} must also poison Build and Test`);
});
test('implementation handoff is refused when Functional Design was never approved', t => {
  const f = chain(t).build(); f.ledger.approvals = f.ledger.approvals.filter(a => a.stage !== 'functional-design'); fs.writeFileSync(f.ledgerPath, JSON.stringify(f.ledger));
  assert.match(f.run('code-generation').findings.join('\n'), /Functional Design contract has no matching explicit approval receipt/);
});
test('Functional Design gate refuses a matrix that dropped a reported semantic', t => {
  const f = chain(t);
  const matrix = ruleMatrix(); matrix.rows.find(r => r.elementKey === 'SCREEN-NOTES/STATE-PRIVATE-MODE/PRIVATE-MODE-GUIDANCE').ruleIds = [];
  fs.writeFileSync(path.join(f.root, 'ui-poc-element-rule-matrix.json'), JSON.stringify(matrix)); f.build();
  assert.match(f.run('functional-design').findings.join('\n'), /ELEMENT_UNMAPPED SCREEN-NOTES\/STATE-PRIVATE-MODE\/PRIVATE-MODE-GUIDANCE/);
  assert.equal(f.run('code-generation').pass, false);
});
test('Build and Test gate refuses a missing or tampered element test matrix', t => {
  const missing = chain(t).build({ bt: c => { delete c.fidelity.elementTestMatrix; } });
  assert.match(missing.run('build-and-test').findings.join('\n'), /element-level Build and Test matrix/);
  const tampered = chain(t).build();
  const tm = JSON.parse(fs.readFileSync(path.join(tampered.root, 'ui-poc-element-test-matrix.json'))); tm.rows.pop();
  fs.writeFileSync(path.join(tampered.root, 'ui-poc-element-test-matrix.json'), JSON.stringify(tm));
  const bt = tampered.contracts['build-and-test'];
  bt.assets = bt.assets.map(a => a.path === 'ui-poc-element-test-matrix.json' ? tampered.ref(a.path) : a); bt.fidelity.elementTestMatrix = tampered.ref('ui-poc-element-test-matrix.json');
  tampered.write('build-and-test', 'ui-poc-test-contract.md', bt);
  assert.match(tampered.run('build-and-test').findings.join('\n'), /TEST_MATRIX_MISMATCH/);
});
test('Build and Test gate refuses a regressed implementation capture', t => {
  const f = chain(t);
  const regressed = actual(); IMPLEMENTATION_DROPS['storage-read-failure-text'](regressed);
  fs.writeFileSync(path.join(f.root, 'actual-snapshot.json'), JSON.stringify(regressed)); f.build();
  assert.match(f.run('build-and-test').findings.join('\n'), /STORAGE-READ-ERROR/);
});
test('refined revision block is verified against the computed delta', t => {
  const f = chain(t);
  const previous = approved(); element(previous, 'SCREEN-NOTES/STATE-SAVED/SAVE-COMPLETE').text = '保存しました';
  fs.writeFileSync(path.join(f.root, 'previous-snapshot.json'), JSON.stringify(previous));
  const delta = M.upstreamDelta(previous, approved());
  f.build({ refined: c => { c.assets.push(f.ref('previous-snapshot.json')); c.fidelity.revision = { previousSnapshot: f.ref('previous-snapshot.json'), changedElements: delta.changedElements, deltaSha256: delta.deltaSha256 }; } });
  assert.deepEqual(f.run('refined-mockups').findings, []);
  f.build({ refined: c => { c.assets.push(f.ref('previous-snapshot.json')); c.fidelity.revision = { previousSnapshot: f.ref('previous-snapshot.json'), changedElements: [], deltaSha256: hashJson([]) }; } });
  assert.match(f.run('refined-mockups').findings.join('\n'), /Artifact revision does not match/);
});

// (5) PNG / visual flags: every combination; the semantic fidelity chain has no off switch.
for (const mockupPngGeneration of [false, true]) for (const visualRegression of [false, true]) {
  const flags = { mockupPngGeneration, visualRegression };
  test(`image flags ${JSON.stringify(flags)}: fail closed without a baseline PNG, semantic checks always on`, t => {
    const f = chain(t).build();
    const wantsPng = mockupPngGeneration || visualRegression;
    for (const stage of ['refined-mockups', 'functional-design', 'code-generation', 'build-and-test']) {
      const result = f.run(stage, flags);
      assert.equal(result.pass, !wantsPng, `${stage}: ${result.findings}`);
      if (wantsPng) assert.match(result.findings.join('\n'), /PNG evidence is missing/);
    }
    const regressed = actual(); IMPLEMENTATION_DROPS['completion-wording'](regressed);
    fs.writeFileSync(path.join(f.root, 'actual-snapshot.json'), JSON.stringify(regressed)); f.build();
    assert.equal(f.run('build-and-test', flags).pass, false, 'no flag combination disables semantic fidelity');
  });
}

test('Functional Design gate: a UI unit without its UI contract fails; a non-UI unit has no obligation', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-fd-unit-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'functional-spec.md'), '# spec\n');
  const nonUi = check({ stage: 'functional-design', outputPath: path.join(dir, 'functional-spec.md') });
  assert.equal(nonUi.pass, true); assert.equal(nonUi.notApplicable, 'non-UI functional-design unit');
  fs.writeFileSync(path.join(dir, 'frontend-components.md'), '# components\n');
  const ui = check({ stage: 'functional-design', outputPath: path.join(dir, 'functional-spec.md') });
  assert.equal(ui.pass, false);
});
