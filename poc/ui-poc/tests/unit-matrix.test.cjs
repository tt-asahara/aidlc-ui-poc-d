'use strict';
// Unit-scoped element rule matrices (per-Unit Functional Design / Code
// Generation) and the intent-level union coverage at Build and Test. The
// synthetic fixture mirrors the dogfood-3 shapes: six Units of one PWA, an app
// shell (role switch + tab bar) in every state, and offline / loading /
// storage-unavailable / load-failed banners approved only on SCREEN-HOME.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fidelity = require('../tools/ui-poc-fidelity.cjs');
const { hashJson, elementDeltaSha256 } = fidelity;
const M = require('../tools/ui-poc-element-matrix.cjs');
const { check, hash } = require('../tools/ui-poc-evidence.cjs');

const MATRIX_CLI = path.resolve(__dirname, '../tools/ui-poc-element-matrix.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const codes = result => result.findings.map(f => `${f.code}${f.elementKey ? ' ' + f.elementKey : ''}`);
const HTML = '<!doctype html><title>Synthetic six-Unit fixture</title>';
const BANNERS = {
  'STATE-OFFLINE': ['MSG-OFFLINE', '電波がありません。記録は端末に保存され、すべての機能を使えます。'],
  'STATE-LOADING': ['MSG-LOADING', '読み込んでいます…'],
  'STATE-STORAGE-UNAVAILABLE': ['MSG-STORAGE-UNAVAILABLE', 'この端末には保存できません。閲覧のみできます。'],
  'STATE-LOAD-FAILED': ['MSG-LOAD-FAILED', '記録を読み込めませんでした。'],
};
// Unit -> its screen/state/AC slice (the requiredMappings of its contract).
const UNITS = {
  'u1-foundation-equipment': ['SCREEN-EQUIPMENT-LIST/STATE-DEFAULT/AC2.1.1', 'SCREEN-EQUIPMENT-LIST/STATE-READ-ONLY/AC1.3.2', 'SCREEN-EQUIPMENT-DETAIL/STATE-UNINSPECTED/AC2.3.1'],
  'u2-inspection': ['SCREEN-INSPECTION/STATE-INPUT/AC3.1.1'],
  'u3-anomaly': ['SCREEN-ANOMALY-FORM/STATE-FROM-NG/AC4.1.1'],
  'u4-work-order': ['SCREEN-WORK-ORDER/STATE-NOT-STARTED/AC5.1.3'],
  'u5-history': ['SCREEN-HISTORY/STATE-LEADER/AC6.1.1'],
  'u6-home': ['SCREEN-HOME/STATE-OPERATOR/AC7.1.1', 'SCREEN-HOME/STATE-OFFLINE/AC1.2.1', 'SCREEN-HOME/STATE-LOADING/AC1.2.3', 'SCREEN-HOME/STATE-STORAGE-UNAVAILABLE/AC1.3.1', 'SCREEN-HOME/STATE-LOAD-FAILED/AC1.4.1'],
};
const ALL_MAPPINGS = Object.values(UNITS).flat();
const U1 = 'u1-foundation-equipment', U6 = 'u6-home';
const OFFLINE_CLAIM = 'SCREEN-HOME/STATE-OFFLINE/AC1.2.1';

function snapshot() {
  const captures = [];
  for (const key of ALL_MAPPINGS) {
    const [screen, state] = key.split('/');
    if (captures.some(c => c.screen === screen && c.state === state)) continue;
    const elements = [
      { key: 'AUTO-31c40a69', explicitId: false, kind: 'region', text: '操作するロール', role: 'group', exactCopy: false, important: false },
      { key: 'ROLE-OPERATOR', explicitId: true, kind: 'control', text: 'オペレーター', role: 'button', exactCopy: false, important: false },
      { key: 'TAB-EQUIPMENT', explicitId: true, kind: 'control', text: '設備', role: 'button', exactCopy: false, important: false },
      { key: `${screen.slice(7)}-TITLE`, explicitId: true, kind: 'text', text: `${screen} ${state} の見出し`, exactCopy: true, important: true },
    ];
    // EQUIPMENT-DETAIL carries a bottom action a later Unit (U2) implements through U1's slot;
    // EQUIPMENT-LIST shows a status that only later-Unit data (an open anomaly, U3) triggers.
    if (screen === 'SCREEN-EQUIPMENT-DETAIL') elements.push({ key: 'BTN-START-INSPECTION', explicitId: true, kind: 'control', text: '点検を始める', role: 'button', exactCopy: false, important: false });
    if (screen === 'SCREEN-EQUIPMENT-LIST' && state === 'STATE-DEFAULT') elements.push({ key: 'EQ-102-STATUS', explicitId: true, kind: 'text', text: '異常あり', exactCopy: false, important: false });
    if (screen === 'SCREEN-HOME') elements.push({ key: 'HOME-VALUE-UNINSPECTED', explicitId: true, kind: 'business-value', text: '3', exactCopy: false, important: true });
    if (screen === 'SCREEN-HOME' && BANNERS[state]) elements.push({ key: BANNERS[state][0], explicitId: true, kind: 'text', text: BANNERS[state][1], exactCopy: true, important: true });
    captures.push({ rendered: true, screen, state, elements });
  }
  return { schema: 1, kind: 'ui-semantic-snapshot', source: { path: 'app.html', sha256: hash(Buffer.from(HTML)) }, captures };
}
const APPROVED = snapshot();
const LOOPBACK = 'http://127.0.0.1:53003/app';
const ACTUAL = { ...clone(APPROVED), source: { path: LOOPBACK, sha256: 'b'.repeat(64) }, observation: { mode: 'loopback-url', target: LOOPBACK, targetSha256: 'b'.repeat(64) } };

// Shell controls share U1's shell rule IDs in every Unit; everything else gets a Unit rule.
const ruleFor = (unit, row) => /\/(ROLE-OPERATOR|TAB-EQUIPMENT)$/.test(row.elementKey) ? [row.elementKey.endsWith('ROLE-OPERATOR') ? 'SHELL-ROLE-SWITCH' : 'SHELL-TABBAR'] : [`BR-${unit.split('-')[0].toUpperCase()}-${row.elementKey.split('/').slice(1).join('-')}`];
function fill(unit, matrix, overrides = {}) {
  for (const row of matrix.rows) {
    if (Object.hasOwn(overrides, row.elementKey)) Object.assign(row, overrides[row.elementKey]);
    else if (row.requiresRule) row.ruleIds = ruleFor(unit, row);
  }
  return matrix;
}
function fdText(matrix) {
  const ids = new Set(matrix.rows.flatMap(row => row.ruleIds));
  const copy = matrix.rows.filter(row => row.obligations.includes('exact-copy')).map(row => `- ${row.elementKey}: 「${row.text}」`);
  return `# Functional spec (synthetic)\n\n${[...ids].sort().map(id => `- ${id}`).join('\n')}\n\n## Approved copy\n\n${copy.join('\n')}\n`;
}
function unitMatrix(unit, mappings = UNITS[unit], overrides) { return fill(unit, M.generateRuleMatrix(APPROVED, undefined, M.unitSlice(unit, mappings)), overrides); }
function receipt(key, status, reason, differences) {
  const deltaSha256 = elementDeltaSha256(key, differences);
  return {
    disposition: { elementKey: key, status, reason, approvalReceipt: `decision-${key}`, deltaSha256 },
    approval: { decisionId: `decision-${key}`, stage: 'functional-design', status: 'approved', snapshotSha256: hashJson(APPROVED), dispositionSha256: hashJson({ elementKey: key, status, reason }), deltaSha256, elementKeys: [key], source: 'synthetic-test-only', reviewer: 'synthetic-reviewer' },
  };
}
/** U1 claims the shared offline home state: same shell/banner rules as U6, receipted omissions for U6's dashboard. */
function u1OfflineClaim({ withReceipts = true, bannerRule } = {}) {
  const omitted = ['SCREEN-HOME/STATE-OFFLINE/HOME-TITLE', 'SCREEN-HOME/STATE-OFFLINE/HOME-VALUE-UNINSPECTED'];
  const overrides = Object.fromEntries(omitted.map(key => [key, { ruleIds: [], unimplementedReason: 'ホームのダッシュボードは U6 が実装する' }]));
  if (bannerRule) overrides['SCREEN-HOME/STATE-OFFLINE/MSG-OFFLINE'] = { ruleIds: [bannerRule] };
  else overrides['SCREEN-HOME/STATE-OFFLINE/MSG-OFFLINE'] = { ruleIds: ruleFor(U6, { elementKey: 'SCREEN-HOME/STATE-OFFLINE/MSG-OFFLINE' }) };
  const matrix = unitMatrix(U1, [...UNITS[U1], OFFLINE_CLAIM], overrides);
  const receipts = withReceipts ? omitted.map(key => receipt(key, 'intentionally-omitted', 'ホームのダッシュボードは U6 が実装する', ['missing'])) : [];
  const text = fdText(matrix) + '\n(U6 rule references) ' + ruleFor(U6, { elementKey: 'SCREEN-HOME/STATE-OFFLINE/MSG-OFFLINE' })[0] + '\n';
  return { matrix, dispositions: receipts.map(r => r.disposition), ledger: { approvals: receipts.map(r => r.approval) }, fdTexts: { 'functional-spec.md': text } };
}

// ---------- matrix level ----------
test('without a Unit (single-Unit / intent-level) the matrix keeps the whole-snapshot denominator', () => {
  const matrix = M.generateRuleMatrix(APPROVED);
  assert.equal(matrix.slice, undefined);
  assert.equal(matrix.rows.length, M.generatedRows(APPROVED).length);
  fill('u0-all', matrix);
  assert.deepEqual(codes(M.checkRuleMatrix({ matrix, approved: APPROVED, fdTexts: { 'spec.md': fdText(matrix) } })), []);
  const scoped = unitMatrix(U1);
  assert.ok(codes(M.checkRuleMatrix({ matrix: scoped, approved: APPROVED, fdTexts: { 'spec.md': fdText(scoped) } })).includes('MATRIX_SLICE_STALE'), 'a Unit-scoped matrix is refused at an intent-level stage');
});

test('U1 slice: the denominator is exactly its own screen/state pairs and passes without other Units\' elements or copy', () => {
  const matrix = unitMatrix(U1);
  assert.deepEqual(matrix.slice, { unit: U1, states: ['SCREEN-EQUIPMENT-DETAIL/STATE-UNINSPECTED', 'SCREEN-EQUIPMENT-LIST/STATE-DEFAULT', 'SCREEN-EQUIPMENT-LIST/STATE-READ-ONLY'], sha256: hashJson({ unit: U1, states: matrix.slice.states }) });
  assert.ok(matrix.rows.every(row => /^SCREEN-EQUIPMENT-(LIST|DETAIL)\//.test(row.elementKey)), 'no other Unit element is in the denominator');
  const result = M.checkRuleMatrix({ matrix, approved: APPROVED, fdTexts: { 'functional-spec.md': fdText(matrix) }, slice: M.unitSlice(U1, UNITS[U1]) });
  assert.deepEqual(codes(result), []);
  assert.equal(result.rows, matrix.rows.length);
  const full = fill(U1, M.generateRuleMatrix(APPROVED));
  const old = M.checkRuleMatrix({ matrix: full, approved: APPROVED, fdTexts: { 'functional-spec.md': fdText(matrix) }, slice: M.unitSlice(U1, UNITS[U1]) });
  assert.ok(codes(old).includes('MATRIX_SLICE_STALE'), 'a whole-snapshot matrix is stale for a Unit');
  assert.ok(codes(old).some(code => code.startsWith('MATRIX_ROW_EXTRA SCREEN-HOME/')), 'other Units\' rows are extra, never demanded');
  assert.ok(!codes(old).some(code => code.startsWith('EXACT_COPY_NOT_PROPAGATED')), 'exact copy outside the slice is never demanded');
});

test('exact copy is demanded only inside the slice', () => {
  const u6 = unitMatrix(U6);
  const banner = 'SCREEN-HOME/STATE-OFFLINE/MSG-OFFLINE';
  const text = fdText(u6).split(BANNERS['STATE-OFFLINE'][1]).join('オフラインです');
  assert.ok(codes(M.checkRuleMatrix({ matrix: u6, approved: APPROVED, fdTexts: { 'spec.md': text }, slice: M.unitSlice(U6, UNITS[U6]) })).includes(`EXACT_COPY_NOT_PROPAGATED ${banner}`));
  const u1 = unitMatrix(U1);
  assert.ok(!fdText(u1).includes(BANNERS['STATE-OFFLINE'][1]));
  assert.equal(M.checkRuleMatrix({ matrix: u1, approved: APPROVED, fdTexts: { 'spec.md': fdText(u1) }, slice: M.unitSlice(U1, UNITS[U1]) }).pass, true);
});

test('a slice naming a screen/state the approved snapshot never captured fails closed', () => {
  const bad = [...UNITS[U1], 'SCREEN-SETTINGS/STATE-DEFAULT/AC9.9.9'];
  assert.throws(() => M.generateRuleMatrix(APPROVED, undefined, M.unitSlice(U1, bad)), /SLICE_STATE_UNKNOWN.*SCREEN-SETTINGS\/STATE-DEFAULT/);
  const matrix = unitMatrix(U1);
  assert.ok(codes(M.checkRuleMatrix({ matrix, approved: APPROVED, fdTexts: { 'spec.md': fdText(matrix) }, slice: M.unitSlice(U1, bad) })).includes('SLICE_STATE_UNKNOWN SCREEN-SETTINGS/STATE-DEFAULT'));
  assert.throws(() => M.unitSlice(U1, []), /no required/);
  assert.throws(() => M.unitSlice('../u1', UNITS[U1]), /Invalid Unit id/);
});

test('a slice change makes the recorded matrix stale; regeneration with --previous keeps only unchanged rows', () => {
  const matrix = unitMatrix(U1);
  const grown = [...UNITS[U1], OFFLINE_CLAIM];
  const stale = codes(M.checkRuleMatrix({ matrix, approved: APPROVED, fdTexts: { 'spec.md': fdText(matrix) }, slice: M.unitSlice(U1, grown) }));
  assert.ok(stale.includes('MATRIX_SLICE_STALE'));
  assert.ok(stale.includes('MATRIX_ROW_MISSING SCREEN-HOME/STATE-OFFLINE/MSG-OFFLINE'));
  assert.notEqual(M.unitSlice(U1, grown).sha256, matrix.slice.sha256);
  assert.notEqual(M.unitSlice('u2-inspection', UNITS[U1]).sha256, matrix.slice.sha256, 'the Unit id is part of the slice identity');
  const regenerated = M.generateRuleMatrix(APPROVED, matrix, M.unitSlice(U1, grown));
  assert.deepEqual(regenerated.rows.find(r => r.elementKey === 'SCREEN-EQUIPMENT-LIST/STATE-DEFAULT/ROLE-OPERATOR').ruleIds, ['SHELL-ROLE-SWITCH']);
  assert.deepEqual(regenerated.rows.find(r => r.elementKey === 'SCREEN-HOME/STATE-OFFLINE/MSG-OFFLINE').ruleIds, []);
});

test('shared state: another Unit\'s element is not auto-allowed; a Unit claims it through its slice plus receipts', () => {
  const banner = 'SCREEN-HOME/STATE-OFFLINE/MSG-OFFLINE';
  // Without the claim, U1 cannot map or deviate the home banner.
  const u1 = unitMatrix(U1);
  const withRow = clone(u1); withRow.rows.push({ ...unitMatrix(U6).rows.find(r => r.elementKey === banner), ruleIds: ['SHELL-BANNER-OFFLINE'] });
  const { disposition, approval } = receipt(banner, 'approved-deviation', 'アプリの骨組みに出す', ['copy']);
  const outside = codes(M.checkRuleMatrix({ matrix: withRow, approved: APPROVED, fdTexts: { 'spec.md': fdText(withRow) }, dispositions: [disposition], ledger: { approvals: [approval] }, slice: M.unitSlice(U1, UNITS[U1]) }));
  assert.ok(outside.includes(`MATRIX_ROW_EXTRA ${banner}`), outside.join(', '));
  assert.ok(outside.includes(`DISPOSITION_UNKNOWN_ELEMENT ${banner}`), outside.join(', '));
  // With the claim, the whole claimed state joins the denominator: the dashboard elements U1 does not implement need receipts.
  const slice = M.unitSlice(U1, [...UNITS[U1], OFFLINE_CLAIM]);
  const bare = u1OfflineClaim({ withReceipts: false });
  const missing = codes(M.checkRuleMatrix({ ...bare, approved: APPROVED, slice }));
  assert.ok(missing.includes('UNIMPLEMENTED_WITHOUT_DISPOSITION SCREEN-HOME/STATE-OFFLINE/HOME-VALUE-UNINSPECTED'), missing.join(', '));
  const claimed = u1OfflineClaim();
  assert.deepEqual(codes(M.checkRuleMatrix({ ...claimed, approved: APPROVED, slice })), []);
  // Intent level: U1 and U6 both own the banner with the same rule ID; U1's local omissions never excuse U6's elements.
  const units = Object.keys(UNITS).filter(u => u !== U1).map(u => ({ matrix: unitMatrix(u), dispositions: [] }));
  const union = M.unionRuleMatrix({ approved: APPROVED, units: [...units, { matrix: claimed.matrix, dispositions: claimed.dispositions }] });
  assert.deepEqual(codes(union), []);
  assert.deepEqual(union.matrix.rows.find(r => r.elementKey === banner).units, [U1, U6]);
  assert.deepEqual(union.matrix.rows.find(r => r.elementKey === 'SCREEN-HOME/STATE-OFFLINE/HOME-VALUE-UNINSPECTED').units, [U6]);
  assert.deepEqual(union.dispositions, [], 'U1 omissions of elements U6 owns do not reach Build and Test');
  // Inconsistent overlap: U1 maps the banner to its own rule.
  const conflicting = u1OfflineClaim({ bannerRule: 'SHELL-BANNER-OFFLINE' });
  const conflict = M.unionRuleMatrix({ approved: APPROVED, units: [...units, { matrix: conflicting.matrix, dispositions: conflicting.dispositions }] });
  assert.deepEqual(codes(conflict), [`ELEMENT_OWNER_CONFLICT ${banner}`]);
  assert.equal(conflict.pass, false);
});

// ---------- intent-level union coverage ----------
const allUnits = (except = []) => Object.keys(UNITS).filter(u => !except.includes(u)).map(u => ({ matrix: unitMatrix(u), dispositions: [] }));
test('six-Unit union covers every approved element that requires a rule exactly once', () => {
  const union = M.unionRuleMatrix({ approved: APPROVED, units: allUnits() });
  assert.deepEqual(codes(union), []);
  assert.equal(union.matrix.rows.length, M.generatedRows(APPROVED).length);
  assert.deepEqual(union.matrix.units.map(u => u.unit), Object.keys(UNITS).sort());
  assert.equal(union.matrix.snapshotSha256, hashJson(APPROVED));
  assert.ok(union.matrix.rows.filter(r => r.requiresRule).every(r => r.ruleIds.length && r.units.length === 1));
  assert.deepEqual(union.matrix, M.unionRuleMatrix({ approved: APPROVED, units: allUnits().reverse() }).matrix, 'order independent');
  const tm = M.generateTestMatrix({ approved: APPROVED, actual: clone(APPROVED), ruleMatrix: union.matrix });
  assert.equal(tm.summary.fail, 0); assert.equal(tm.summary.total, union.matrix.rows.length);
});
test('union: a missing owner is NOT-READY and names the elements', () => {
  const result = M.unionRuleMatrix({ approved: APPROVED, units: allUnits(['u5-history']) });
  assert.equal(result.pass, false);
  assert.deepEqual(codes(result).filter(c => c.startsWith('ELEMENT_NO_OWNER')).sort(), ['ROLE-OPERATOR', 'HISTORY-TITLE', 'TAB-EQUIPMENT'].map(k => `ELEMENT_NO_OWNER SCREEN-HISTORY/STATE-LEADER/${k}`).sort());
  const unmapped = allUnits(); const row = unmapped[0].matrix.rows.find(r => r.requiresRule); row.ruleIds = [];
  assert.deepEqual(codes(M.unionRuleMatrix({ approved: APPROVED, units: unmapped })), [`ELEMENT_NO_OWNER ${row.elementKey}`]);
});
test('union: an element only omitted (with receipts) is covered and its omission reaches Build and Test', () => {
  const key = 'SCREEN-HISTORY/STATE-LEADER/HISTORY-TITLE';
  const { disposition } = receipt(key, 'intentionally-omitted', '見出しは出さない', ['missing']);
  const units = allUnits(); const u5 = units.find(u => u.matrix.slice.unit === 'u5-history');
  Object.assign(u5.matrix.rows.find(r => r.elementKey === key), { ruleIds: [], unimplementedReason: '見出しは出さない' }); u5.dispositions = [disposition];
  const union = M.unionRuleMatrix({ approved: APPROVED, units });
  assert.deepEqual(codes(union), []);
  assert.equal(union.matrix.rows.find(r => r.elementKey === key).unimplementedReason, '見出しは出さない');
  assert.deepEqual(union.dispositions, [disposition]);
});
test('union: overlapping owners with different dispositions conflict; stale, unscoped and duplicate Unit matrices are refused', () => {
  const claimed = u1OfflineClaim();
  const banner = 'SCREEN-HOME/STATE-OFFLINE/MSG-OFFLINE';
  const { disposition } = receipt(banner, 'approved-deviation', '句点を付ける', ['copy']);
  const units = allUnits([U1]); units.find(u => u.matrix.slice.unit === U6).dispositions = [disposition];
  assert.ok(codes(M.unionRuleMatrix({ approved: APPROVED, units: [...units, { matrix: claimed.matrix, dispositions: claimed.dispositions }] })).includes(`ELEMENT_OWNER_CONFLICT ${banner}`));
  const unscoped = allUnits(); delete unscoped[0].matrix.slice;
  assert.deepEqual(codes(M.unionRuleMatrix({ approved: APPROVED, units: unscoped })), ['UNIT_MATRIX_NOT_SCOPED']);
  const forged = allUnits(); forged[0].matrix.slice.states.push('SCREEN-HOME/STATE-OPERATOR');
  assert.deepEqual(codes(M.unionRuleMatrix({ approved: APPROVED, units: forged })), ['UNIT_MATRIX_NOT_SCOPED']);
  const stale = allUnits(); stale[1].matrix.snapshotSha256 = 'f'.repeat(64);
  assert.ok(codes(M.unionRuleMatrix({ approved: APPROVED, units: stale })).includes('UNIT_MATRIX_STALE'));
  assert.ok(codes(M.unionRuleMatrix({ approved: APPROVED, units: [...allUnits(), allUnits()[0]] })).includes('UNIT_DUPLICATE'));
});

// ---------- evidence gates (Unit FD / code-generation / multi-Unit Build and Test) ----------
function render(c) { return '# Synthetic fixture, not workflow evidence\n\n## Artifact References\n\n## Screen State Acceptance Mapping\n\n## Approval Evidence\n\n## Testing Brief\n\n```ui-poc-contract\n' + JSON.stringify(c, null, 1) + '\n```\n'; }
const mappingOf = key => { const [screen, state, ac] = key.split('/'); return { screen, state, ac, asset: 'app.html', check: `renderer capture of ${screen}/${state}` }; };
const ledgerEngine = unit => ({ recordRoot: null, unit, scope: null, policy: { sensor: 'on', upstreamApproval: 'ledger' } });

/** Build a refined -> per-Unit FD -> per-Unit code-generation -> intent Build and Test chain in a temp tree. */
function chain(t, { units = Object.keys(UNITS), override = {} } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-unit-matrix-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const ledgerPath = path.join(temp, 'operator-ledger.json');
  const ledger = { approvals: [] };
  const approve = (file, stage, requiredMappings) => { ledger.approvals.push({ contractSha256: hash(fs.readFileSync(file)), stage, arm: 'C', status: 'approved', source: 'synthetic-test-only', reviewer: 'synthetic-reviewer', requiredMappings }); fs.writeFileSync(ledgerPath, JSON.stringify(ledger)); };
  const put = (dir, name, bytes) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), bytes); return { path: name, sha256: hash(Buffer.from(bytes)) }; };
  const refinedDir = path.join(temp, 'refined');
  const base = { arm: 'C', schema: 2 };
  const html = put(refinedDir, 'app.html', HTML), snap = put(refinedDir, 'snapshot.json', JSON.stringify(APPROVED));
  const refined = { ...base, stage: 'refined-mockups', assets: [html, snap], mappings: ALL_MAPPINGS.map(mappingOf), requiredMappings: ALL_MAPPINGS, fidelity: { approvedSnapshot: snap, dispositions: [] } };
  const refinedBytes = render(refined); put(refinedDir, 'ui-poc-refined-contract.md', refinedBytes);
  approve(path.join(refinedDir, 'ui-poc-refined-contract.md'), 'refined-mockups', ALL_MAPPINGS);
  const unitDirs = {};
  for (const unit of units) {
    const dir = path.join(temp, 'units', unit); unitDirs[unit] = dir;
    const custom = override[unit] || {};
    const requiredMappings = custom.mappings || UNITS[unit];
    const m = custom.matrix || unitMatrix(unit, requiredMappings);
    const dispositions = custom.dispositions || [];
    for (const approval of custom.approvals || []) ledger.approvals.push(approval);
    const assets = [put(dir, 'app.html', HTML), put(dir, 'snapshot.json', JSON.stringify(APPROVED))];
    const matrixRef = put(dir, 'ui-poc-element-rule-matrix.json', JSON.stringify(m, null, 2));
    const specRef = put(dir, 'functional-spec.md', custom.fdText || fdText(m));
    const upstream = { ...put(dir, 'upstream-refined.md', refinedBytes), stage: 'refined-mockups' };
    const shared = { ...base, mappings: requiredMappings.map(mappingOf), requiredMappings, upstream };
    const fd = { ...shared, stage: 'functional-design', assets: [...assets, matrixRef, specRef], fidelity: { approvedSnapshot: assets[1], dispositions, elementRuleMatrix: matrixRef, functionalDesign: [specRef] } };
    const fdRef = put(dir, 'ui-poc-functional-contract.md', render(fd));
    approve(path.join(dir, 'ui-poc-functional-contract.md'), 'functional-design', requiredMappings);
    const impl = { ...shared, stage: 'code-generation', assets: [...assets, matrixRef, fdRef], fidelity: { approvedSnapshot: assets[1], dispositions, elementRuleMatrix: matrixRef, functionalDesignContract: fdRef } };
    put(dir, 'ui-poc-implementation-contract.md', render(impl));
    approve(path.join(dir, 'ui-poc-implementation-contract.md'), 'code-generation', requiredMappings);
  }
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  const btDir = path.join(temp, 'build-and-test');
  const unitRefs = units.map(unit => { fs.cpSync(unitDirs[unit], path.join(btDir, 'units', unit), { recursive: true }); const rel = `units/${unit}/ui-poc-implementation-contract.md`; return { path: rel, sha256: hash(fs.readFileSync(path.join(btDir, rel))) }; });
  const union = override.union || M.unionRuleMatrix({ approved: APPROVED, units: units.map(unit => ({ matrix: JSON.parse(fs.readFileSync(path.join(unitDirs[unit], 'ui-poc-element-rule-matrix.json'))), dispositions: (override[unit]?.dispositions) || [] })) });
  const btAssets = [put(btDir, 'app.html', HTML), put(btDir, 'snapshot.json', JSON.stringify(APPROVED)), put(btDir, 'actual-snapshot.json', JSON.stringify(ACTUAL))];
  const unionRef = put(btDir, 'ui-poc-element-rule-matrix.json', JSON.stringify(union.matrix || { kind: 'missing' }, null, 2));
  const tm = union.matrix ? M.generateTestMatrix({ approved: APPROVED, actual: ACTUAL, ruleMatrix: union.matrix, dispositions: union.dispositions, ledger }) : { kind: 'missing' };
  const tmRef = put(btDir, 'ui-poc-element-test-matrix.json', JSON.stringify(tm, null, 2));
  const bt = { ...base, stage: 'build-and-test', assets: [...btAssets, unionRef, tmRef, ...unitRefs], mappings: ALL_MAPPINGS.map(mappingOf), requiredMappings: ALL_MAPPINGS, fidelity: { approvedSnapshot: btAssets[1], dispositions: union.dispositions, elementRuleMatrix: unionRef, actualSnapshot: btAssets[2], elementTestMatrix: tmRef, unitContracts: unitRefs } };
  (override.bt || (() => {}))(bt);
  put(btDir, 'ui-poc-test-contract.md', render(bt));
  return {
    temp, ledgerPath, unitDirs, btDir, union,
    run: (stage, unit) => check({ stage, outputPath: stage === 'build-and-test' ? path.join(btDir, 'ui-poc-test-contract.md') : path.join(unitDirs[unit], stage === 'functional-design' ? 'ui-poc-functional-contract.md' : 'ui-poc-implementation-contract.md'), approvalLedger: ledgerPath, engine: ledgerEngine(stage === 'build-and-test' ? null : unit) }),
  };
}

test('evidence: every Unit FD and code-generation gate passes on its own slice, and multi-Unit Build and Test passes', t => {
  const f = chain(t);
  for (const unit of Object.keys(UNITS)) {
    assert.deepEqual(f.run('functional-design', unit).findings, [], `${unit} FD`);
    assert.deepEqual(f.run('code-generation', unit).findings, [], `${unit} CG`);
  }
  assert.deepEqual(f.run('build-and-test').findings, []);
});
test('evidence: a Unit FD whose matrix slice differs from its contract slice is stale', t => {
  const f = chain(t, { units: [U1], override: { [U1]: { mappings: [...UNITS[U1], OFFLINE_CLAIM], matrix: unitMatrix(U1) } } });
  const findings = f.run('functional-design', U1).findings.join('\n');
  assert.match(findings, /MATRIX_SLICE_STALE/); assert.match(findings, /MATRIX_ROW_MISSING SCREEN-HOME\/STATE-OFFLINE/);
  assert.match(f.run('code-generation', U1).findings.join('\n'), /MATRIX_SLICE_STALE/);
  assert.match(chain(t, { units: [U1], override: { [U1]: { matrix: unitMatrix('u2-inspection', UNITS[U1]) } } }).run('functional-design', U1).findings.join('\n'), /MATRIX_SLICE_STALE/, 'a matrix generated for another Unit id is stale');
});
test('evidence: a Unit slice with an unknown screen/state fails closed', t => {
  const f = chain(t, { units: [U1], override: { [U1]: { mappings: [...UNITS[U1], 'SCREEN-SETTINGS/STATE-DEFAULT/AC9.9.9'], matrix: unitMatrix(U1) } } });
  assert.match(f.run('functional-design', U1).findings.join('\n'), /coverage differs|SLICE_STATE_UNKNOWN|upstream contract does not/);
});
test('evidence: Build and Test with a Unit missing is NOT-READY naming the unowned elements', t => {
  const f = chain(t, { units: Object.keys(UNITS).filter(u => u !== 'u5-history'), override: { union: { matrix: null, dispositions: [] } } });
  const findings = f.run('build-and-test').findings.join('\n');
  assert.match(findings, /Intent-level element coverage failed: .*ELEMENT_NO_OWNER SCREEN-HISTORY\/STATE-LEADER\/HISTORY-TITLE/);
});
test('evidence: shared offline state claimed by U1 with receipts passes; an inconsistent overlap is NOT-READY', t => {
  const claim = u1OfflineClaim();
  const u1 = { mappings: [...UNITS[U1], OFFLINE_CLAIM], matrix: claim.matrix, dispositions: claim.dispositions, approvals: claim.ledger.approvals, fdText: claim.fdTexts['functional-spec.md'] };
  const ok = chain(t, { override: { [U1]: u1 } });
  assert.deepEqual(ok.run('functional-design', U1).findings, []);
  assert.deepEqual(ok.run('build-and-test').findings, []);
  const bad = u1OfflineClaim({ bannerRule: 'SHELL-BANNER-OFFLINE' });
  const conflict = chain(t, { override: { [U1]: { ...u1, matrix: bad.matrix, fdText: bad.fdTexts['functional-spec.md'] }, union: { matrix: null, dispositions: [] } } });
  assert.deepEqual(conflict.run('functional-design', U1).findings, [], 'the Unit itself is consistent');
  assert.match(conflict.run('build-and-test').findings.join('\n'), /ELEMENT_OWNER_CONFLICT SCREEN-HOME\/STATE-OFFLINE\/MSG-OFFLINE/);
});
test('evidence: Build and Test refuses a hand-edited union, mismatched dispositions, or both upstream and unitContracts', t => {
  const edited = chain(t, { override: { bt: c => { c.fidelity.dispositions = [{ elementKey: 'SCREEN-HOME/STATE-OPERATOR/HOME-TITLE', status: 'intentionally-omitted', reason: 'x', approvalReceipt: 'y', deltaSha256: 'a'.repeat(64) }]; } } });
  assert.match(edited.run('build-and-test').findings.join('\n'), /dispositions differ from the union/);
  const both = chain(t, { override: { bt: c => { c.upstream = { path: 'units/u6-home/ui-poc-implementation-contract.md', sha256: c.fidelity.unitContracts[5].sha256, stage: 'code-generation' }; } } });
  assert.match(both.run('build-and-test').findings.join('\n'), /not both/);
  const tampered = chain(t);
  const union = JSON.parse(fs.readFileSync(path.join(tampered.btDir, 'ui-poc-element-rule-matrix.json')));
  union.rows[0].ruleIds = ['BR-INVENTED'];
  const forged = chain(t, { override: { union: { matrix: union, dispositions: [] } } });
  assert.match(forged.run('build-and-test').findings.join('\n'), /not the union of the approved Unit matrices/);
  const unapproved = chain(t);
  const ledger = JSON.parse(fs.readFileSync(unapproved.ledgerPath)); ledger.approvals = ledger.approvals.filter(a => !(a.stage === 'code-generation' && a.requiredMappings[0] === UNITS['u3-anomaly'][0])); fs.writeFileSync(unapproved.ledgerPath, JSON.stringify(ledger));
  assert.match(unapproved.run('build-and-test').findings.join('\n'), /no matching explicit approval receipt/);
});

/**
 * Mirror a chain into a real engine record (state + audit + stage directories).
 * `rows` are engine audit rows [event, stage, unit, extraFields]; refined-mockups
 * is always gate-approved first.
 */
function engineRecordOf(t, f, { checkpoints = false } = {}) {
  const project = fs.realpathSync(f.temp), record = path.join(project, 'aidlc', 'intents', 'x');
  fs.mkdirSync(record, { recursive: true });
  fs.writeFileSync(path.join(record, 'aidlc-state.md'), `# State\n\n- **Scope**: ui-poc-application\n${checkpoints ? '- **Construction Checkpoints**: enabled\n' : ''}`);
  fs.cpSync(path.join(project, 'refined'), path.join(record, 'inception', 'refined-mockups'), { recursive: true });
  for (const unit of Object.keys(f.unitDirs)) for (const stage of ['functional-design', 'code-generation']) fs.cpSync(f.unitDirs[unit], path.join(record, 'construction', unit, stage), { recursive: true });
  fs.cpSync(f.btDir, path.join(record, 'construction', 'build-and-test'), { recursive: true });
  const old = process.cwd(); process.chdir(project); t.after(() => process.chdir(old));
  const at = (...parts) => path.join(record, 'construction', ...parts);
  const audit = rows => {
    fs.mkdirSync(path.join(record, 'audit'), { recursive: true });
    const all = [['GATE_APPROVED', 'refined-mockups'], ...rows];
    const blocks = all.map(([event, stage, unit, extra = {}], i) => [`## ${event}`, `**Timestamp**: 2026-10-19T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`, `**Event**: ${event}`, ...(stage ? [`**Stage**: ${stage}`] : []), ...(unit ? [`**Unit**: ${unit}`] : []), ...Object.entries(extra).map(([k, v]) => `**${k}**: ${v}`)].join('\n'));
    fs.writeFileSync(path.join(record, 'audit', 'synthetic-shard.md'), `# Audit\n\n${blocks.join('\n\n---\n\n')}\n`);
  };
  audit([]);
  const run = (stage, unit) => check({ stage, outputPath: stage === 'build-and-test' ? at('build-and-test', 'ui-poc-test-contract.md') : at(unit, stage, stage === 'functional-design' ? 'ui-poc-functional-contract.md' : 'ui-poc-implementation-contract.md') });
  return { record, at, audit, run };
}
const perStageApprovals = units => units.flatMap(unit => [['GATE_APPROVED', 'functional-design', unit], ['GATE_APPROVED', 'code-generation', unit]]);

test('engine-record scope: Unit FD/code-generation and intent-level Build and Test resolve approvals from the record without a ledger', t => {
  const f = chain(t);
  const { at, audit } = engineRecordOf(t, f);
  assert.match(check({ stage: 'build-and-test', outputPath: at('build-and-test', 'ui-poc-test-contract.md') }).findings.join('\n'), /no official gate approval of functional-design for Unit u1-foundation-equipment/, 'byte equality alone is not the person\'s approval');
  audit(perStageApprovals(Object.keys(UNITS)));
  assert.deepEqual(check({ stage: 'functional-design', outputPath: at(U1, 'functional-design', 'ui-poc-functional-contract.md') }).findings, []);
  assert.deepEqual(check({ stage: 'code-generation', outputPath: at(U1, 'code-generation', 'ui-poc-implementation-contract.md') }).findings, []);
  assert.deepEqual(check({ stage: 'build-and-test', outputPath: at('build-and-test', 'ui-poc-test-contract.md') }).findings, []);
  fs.appendFileSync(at('u4-work-order', 'code-generation', 'ui-poc-implementation-contract.md'), '\nedited after the Build and Test copy\n');
  assert.match(check({ stage: 'build-and-test', outputPath: at('build-and-test', 'ui-poc-test-contract.md') }).findings.join('\n'), /differs from the engine record artifact construction\/u4-work-order\/code-generation/);
});

// ---------- engine-record dispositions (dogfood-3 U1 shapes) ----------
const { engineRecordTrust } = require('../tools/ui-poc-fidelity.cjs');
const U2 = 'u2-inspection';
const DETAIL_CLAIM = 'SCREEN-EQUIPMENT-DETAIL/STATE-UNINSPECTED/AC2.3.1';
const BANNER = 'SCREEN-HOME/STATE-OFFLINE/MSG-OFFLINE';
const BTN = 'SCREEN-EQUIPMENT-DETAIL/STATE-UNINSPECTED/BTN-START-INSPECTION';
const STATUS = 'SCREEN-EQUIPMENT-LIST/STATE-DEFAULT/EQ-102-STATUS';
const Q6 = '6. 承認済みの見た目からの違い（Q6）', LATER = '7. 後の Unit が実装する要素';
const PLACEMENT = ['placement: the shell banner area below the header on every screen, not only on SCREEN-HOME'];
/** An engine-record disposition: no approvalReceipt, a cited Functional Design section, a described difference. */
function decision(key, status, reason, { heading, deferredTo, differences } = {}) {
  const diff = status === 'intentionally-omitted' ? ['missing'] : differences;
  return { elementKey: key, status, reason, deltaSha256: elementDeltaSha256(key, diff), ...(status === 'intentionally-omitted' ? {} : { differences: diff }), source: { path: 'functional-spec.md', heading: heading || (status === 'intentionally-omitted' ? LATER : Q6) }, ...(deferredTo ? { deferredTo } : {}) };
}
const section = (heading, keys) => `\n## ${heading}\n\n${keys.map(key => `- ${key}`).join('\n')}\n`;
/** U1 claims the shared offline home state (Q1/Q6) and renders EQUIPMENT-DETAIL whose bottom action U2 registers in slot S-08. */
function u1Engine() {
  const omittedHome = ['SCREEN-HOME/STATE-OFFLINE/HOME-TITLE', 'SCREEN-HOME/STATE-OFFLINE/HOME-VALUE-UNINSPECTED'];
  const overrides = { [BANNER]: { ruleIds: ['SHELL-BANNER'] }, [BTN]: { ruleIds: [], unimplementedReason: 'S-08 の差し込み口に U2 が登録する' }, [STATUS]: { ruleIds: ['BR6.1'] } };
  for (const key of omittedHome) overrides[key] = { ruleIds: [], unimplementedReason: 'ホームの件数は U6 が実装する' };
  const matrix = unitMatrix(U1, [...UNITS[U1], OFFLINE_CLAIM], overrides);
  const dispositions = [
    decision(BANNER, 'approved-deviation', 'Q1/Q6: 状態の案内は骨組みの共通の場所に出す', { differences: PLACEMENT }),
    ...omittedHome.map(key => decision(key, 'intentionally-omitted', 'ホームの件数は U6 が実装する', { deferredTo: U6 })),
    decision(BTN, 'intentionally-omitted', 'S-08 の差し込み口に U2 が登録する', { deferredTo: U2 }),
  ].sort((a, b) => a.elementKey.localeCompare(b.elementKey));
  const text = fdText(matrix) + section(Q6, [BANNER]) + section(LATER, [...omittedHome, BTN]);
  return { mappings: [...UNITS[U1], OFFLINE_CLAIM], matrix, dispositions, fdText: text };
}
/** U2 adds the DETAIL state to its slice and implements the action; U1 keeps the DETAIL title. */
function u2Engine({ implementsButton = true } = {}) {
  const title = 'SCREEN-EQUIPMENT-DETAIL/STATE-UNINSPECTED/EQUIPMENT-DETAIL-TITLE';
  const mappings = implementsButton ? [...UNITS[U2], DETAIL_CLAIM] : UNITS[U2];
  const overrides = implementsButton ? { [title]: { ruleIds: [], unimplementedReason: '設備詳細の見出しは U1 が実装する' }, [BTN]: { ruleIds: ['BR-U2-START-INSPECTION'] } } : {};
  const matrix = unitMatrix(U2, mappings, overrides);
  const dispositions = implementsButton ? [decision(title, 'intentionally-omitted', '設備詳細の見出しは U1 が実装する', { deferredTo: U1 })] : [];
  return { mappings, matrix, dispositions, fdText: fdText(matrix) + section(LATER, implementsButton ? [title] : []) };
}
/** U6 implements the banner with U1's shell rule and carries the same Q6 decision. */
function u6Engine() {
  const matrix = unitMatrix(U6, UNITS[U6], { [BANNER]: { ruleIds: ['SHELL-BANNER'] } });
  const dispositions = [decision(BANNER, 'approved-deviation', 'Q1/Q6: 状態の案内は骨組みの共通の場所に出す（U1 の機能設計 §6）', { differences: PLACEMENT })];
  return { mappings: UNITS[U6], matrix, dispositions, fdText: fdText(matrix) + section(Q6, [BANNER]) };
}
const engineOverrides = (extra = {}) => ({ [U1]: u1Engine(), [U2]: u2Engine(), [U6]: u6Engine(), ...extra });

test('engine-record dispositions: structure only, no receipt; a source section must name the element', () => {
  const u1 = u1Engine();
  const slice = M.unitSlice(U1, u1.mappings), fdTexts = { 'functional-spec.md': u1.fdText };
  const pending = engineRecordTrust('pending');
  assert.deepEqual(codes(M.checkRuleMatrix({ matrix: u1.matrix, approved: APPROVED, fdTexts, dispositions: u1.dispositions, ledger: pending, slice })), []);
  assert.ok(codes(M.checkRuleMatrix({ matrix: u1.matrix, approved: APPROVED, fdTexts, dispositions: u1.dispositions, slice })).includes(`DISPOSITION_WITHOUT_RECEIPT ${BANNER}`), 'without the engine record the ledger is still the source');
  const variant = mutate => { const d = clone(u1.dispositions); mutate(d.find(x => x.elementKey === BANNER)); return codes(M.checkRuleMatrix({ matrix: u1.matrix, approved: APPROVED, fdTexts, dispositions: d, ledger: pending, slice })); };
  assert.ok(variant(d => { d.approvalReceipt = 'agent-written'; }).includes(`DISPOSITION_INVALID ${BANNER}`), 'an AI-written receipt is refused');
  assert.ok(variant(d => { delete d.differences; }).includes(`DISPOSITION_INVALID ${BANNER}`), 'a deviation describes its difference');
  assert.ok(variant(d => { d.differences = ['copy']; }).includes(`DISPOSITION_INVALID ${BANNER}`), 'the delta binds the declared differences');
  assert.ok(variant(d => { d.reason = ' '; }).includes(`DISPOSITION_INVALID ${BANNER}`));
  assert.ok(variant(d => { d.status = 'waived'; }).includes(`DISPOSITION_INVALID ${BANNER}`));
  assert.ok(variant(d => { d.source.heading = '8. 受入条件の受け持ち'; }).includes(`DISPOSITION_SOURCE_MISSING ${BANNER}`));
  assert.ok(variant(d => { d.deferredTo = U6; }).includes(`DISPOSITION_DEFERRAL_INVALID ${BANNER}`), 'only an omission defers to another Unit');
  const unnamed = codes(M.checkRuleMatrix({ matrix: u1.matrix, approved: APPROVED, fdTexts: { 'functional-spec.md': u1.fdText.replace(section(Q6, [BANNER]), `\n## ${Q6}\n\n案内の場所を変える。\n`) }, dispositions: u1.dispositions, ledger: pending, slice }));
  assert.ok(unnamed.includes(`DISPOSITION_SOURCE_MISSING ${BANNER}`), unnamed.join(', '));
  // The agent runs the same check from the CLI with --engine-record (no ledger, no receipt).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-engine-cli-'));
  try {
    const put = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return file; };
    const contract = put('ui-poc-functional-contract.md', render({ requiredMappings: u1.mappings }));
    const args = ['rule-matrix', 'check', '--approved', put('snapshot.json', APPROVED), '--matrix', put('matrix.json', u1.matrix), '--fd', put('functional-spec.md', u1.fdText), '--unit', U1, '--contract', contract, '--dispositions', put('dispositions.json', u1.dispositions)];
    const cli = extra => spawnSync(process.execPath, [MATRIX_CLI, ...args, ...extra], { encoding: 'utf8' });
    assert.equal(cli(['--engine-record']).status, 0, cli(['--engine-record']).stdout);
    assert.match(cli([]).stdout, /DISPOSITION_WITHOUT_RECEIPT/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('engine-record FD gate: pending dispositions pass the sensor without a ledger', t => {
  const f = chain(t, { override: engineOverrides() });
  const e = engineRecordOf(t, f);
  for (const unit of [U1, U2, U6]) assert.deepEqual(e.run('functional-design', unit).findings, [], `${unit} FD`);
});

test('engine-record per-stage gates: code-generation accepts dispositions only after the FD gate approval and with unchanged bytes', t => {
  const f = chain(t, { override: engineOverrides() });
  const e = engineRecordOf(t, f);
  assert.match(e.run('code-generation', U1).findings.join('\n'), /no official gate approval of functional-design for Unit u1-foundation-equipment/);
  e.audit([['GATE_APPROVED', 'functional-design', 'u2-inspection']]);
  assert.match(e.run('code-generation', U1).findings.join('\n'), /no official gate approval of functional-design for Unit u1-foundation-equipment/, 'another Unit\'s approval is not this Unit\'s');
  e.audit([['UNIT_STARTED', 'functional-design', U1], ['GATE_APPROVED', 'functional-design']]);
  assert.deepEqual(e.run('code-generation', U1).findings, [], 'an unattributed gate row belongs to the Unit the walk started');
  e.audit([['GATE_APPROVED', 'functional-design', U1], ['STAGE_REVISING', 'functional-design', U1]]);
  assert.match(e.run('code-generation', U1).findings.join('\n'), /latest gate status: open/, 'a reopen withdraws the approval');
  e.audit([['GATE_APPROVED', 'functional-design', U1]]);
  assert.deepEqual(e.run('code-generation', U1).findings, []);
  // Tampering after approval: the approved contract or the prose that states the decision.
  const fdContract = e.at(U1, 'functional-design', 'ui-poc-functional-contract.md');
  const original = fs.readFileSync(fdContract);
  fs.writeFileSync(fdContract, original.toString('utf8').replace('Q1/Q6: 状態の案内は骨組みの共通の場所に出す"', 'Q1/Q6: 承認後に書き換えた理由"'));
  assert.match(e.run('code-generation', U1).findings.join('\n'), /functional-design contract copy differs from the engine record artifact/);
  fs.writeFileSync(fdContract, original);
  fs.appendFileSync(e.at(U1, 'functional-design', 'functional-spec.md'), '\n承認後に足した違い\n');
  assert.match(e.run('code-generation', U1).findings.join('\n'), /Functional Design copy functional-spec\.md differs from the engine record artifact construction\/u1-foundation-equipment\/functional-design\/functional-spec\.md approved at its gate/);
});

test('engine-record Unit-end checkpoints: code-generation sees pending dispositions; Build and Test needs every Unit approval by the person', t => {
  const f = chain(t, { override: engineOverrides() });
  const e = engineRecordOf(t, f, { checkpoints: true });
  assert.deepEqual(e.run('code-generation', U1).findings, [], 'FD and code-generation share the Unit-end gate');
  assert.match(e.run('build-and-test').findings.join('\n'), /no official gate approval of functional-design/);
  const checkpoint = (unit, extra = {}) => ['GATE_APPROVED', 'code-generation', unit, { 'Gate Stages': 'functional-design, code-generation', 'Gate Scope': 'unit-end', 'User Input': 'Approve', ...extra }];
  e.audit(Object.keys(UNITS).map(unit => checkpoint(unit)));
  assert.deepEqual(e.run('build-and-test').findings, []);
  e.audit(Object.keys(UNITS).map(unit => checkpoint(unit, unit === U1 ? { Autonomous: 'true' } : {})));
  assert.match(e.run('build-and-test').findings.join('\n'), /UI dispositions of functional-design for Unit u1-foundation-equipment need the person's own gate approval/);
  e.audit(Object.keys(UNITS).map(unit => checkpoint(unit, unit === 'u5-history' ? { Autonomous: 'true' } : {})));
  assert.deepEqual(e.run('build-and-test').findings, [], 'an autonomous approval of a Unit without dispositions is the engine\'s approval');
});

test('ledger-scoped runs keep requiring the detached ledger for the same dispositions', t => {
  const f = chain(t, { override: engineOverrides() });
  const at = stage => path.join(f.unitDirs[U1], stage === 'functional-design' ? 'ui-poc-functional-contract.md' : 'ui-poc-implementation-contract.md');
  assert.match(check({ stage: 'functional-design', outputPath: at('functional-design'), engine: ledgerEngine(U1) }).findings.join('\n'), /Trusted approval ledger is not configured for UI deviations/);
  assert.match(check({ stage: 'functional-design', outputPath: at('functional-design'), approvalLedger: f.ledgerPath, engine: ledgerEngine(U1) }).findings.join('\n'), /no matching detached approval receipt/);
  assert.match(check({ stage: 'code-generation', outputPath: at('code-generation'), approvalLedger: f.ledgerPath, engine: ledgerEngine(U1) }).findings.join('\n'), /no matching detached approval receipt/);
});

test('union: omitted by U1 for U2 and implemented by U2 is covered; a deferral nobody implements is NOT-READY', () => {
  const entry = u => ({ matrix: u.matrix, dispositions: u.dispositions });
  const others = Object.keys(UNITS).filter(u => ![U1, U2, U6].includes(u)).map(u => ({ matrix: unitMatrix(u), dispositions: [] }));
  const union = M.unionRuleMatrix({ approved: APPROVED, units: [...others, entry(u1Engine()), entry(u2Engine()), entry(u6Engine())] });
  assert.deepEqual(codes(union), []);
  assert.deepEqual(union.matrix.rows.find(r => r.elementKey === BTN), { ...union.matrix.rows.find(r => r.elementKey === BTN), ruleIds: ['BR-U2-START-INSPECTION'], unimplementedReason: null, units: [U2] });
  assert.deepEqual(union.matrix.rows.find(r => r.elementKey === BANNER).units, [U1, U6]);
  assert.deepEqual(union.dispositions.map(d => [d.elementKey, d.status]), [[BANNER, 'approved-deviation']], 'only the shared Q6 decision reaches Build and Test');
  assert.deepEqual(union.matrix.rows.find(r => r.elementKey === STATUS).ruleIds, ['BR6.1'], 'a data-dependent status is mapped by the Unit that renders it');
  const missing = M.unionRuleMatrix({ approved: APPROVED, units: [...others, entry(u1Engine()), entry(u2Engine({ implementsButton: false })), entry(u6Engine())] });
  assert.deepEqual(codes(missing), [`ELEMENT_DEFERRED_NOT_IMPLEMENTED ${BTN}`]);
  const u6Plain = { matrix: unitMatrix(U6, UNITS[U6], { [BANNER]: { ruleIds: ['SHELL-BANNER'] } }), dispositions: [] };
  assert.deepEqual(codes(M.unionRuleMatrix({ approved: APPROVED, units: [...others, entry(u1Engine()), entry(u2Engine()), u6Plain] })), [`ELEMENT_OWNER_CONFLICT ${BANNER}`], 'every Unit that implements the banner carries the same Q6 decision');
  // The Q6 placement is not an observed snapshot field: the implementation passes; data the approved state shows must be reproduced at capture.
  assert.equal(fidelity.compareSnapshots(APPROVED, ACTUAL, union.dispositions, engineRecordTrust('approved')).pass, true);
  const noData = clone(ACTUAL); noData.captures.find(c => c.screen === 'SCREEN-EQUIPMENT-LIST' && c.state === 'STATE-DEFAULT').elements = noData.captures.find(c => c.screen === 'SCREEN-EQUIPMENT-LIST' && c.state === 'STATE-DEFAULT').elements.filter(el => el.key !== 'EQ-102-STATUS');
  assert.match(fidelity.compareSnapshots(APPROVED, noData, union.dispositions, engineRecordTrust('approved')).findings.join('\n'), /Unapproved UI difference SCREEN-EQUIPMENT-LIST\/STATE-DEFAULT\/EQ-102-STATUS: missing/);
});

test('rule IDs resolve against rules.md as a Functional Design artifact, as whole tokens', () => {
  const matrix = unitMatrix(U1, UNITS[U1], { [STATUS]: { ruleIds: ['BR6.2'] } });
  const slice = M.unitSlice(U1, UNITS[U1]);
  const spec = fdText(matrix).replace('- BR6.2\n', '');
  assert.ok(codes(M.checkRuleMatrix({ matrix, approved: APPROVED, fdTexts: { 'functional-spec.md': spec }, slice })).includes(`RULE_ID_UNKNOWN ${STATUS}`));
  assert.deepEqual(codes(M.checkRuleMatrix({ matrix, approved: APPROVED, fdTexts: { 'functional-spec.md': spec, 'rules.md': '# Rules\n\n## BR6.2 下部の操作\n' }, slice })), []);
  assert.ok(codes(M.checkRuleMatrix({ matrix, approved: APPROVED, fdTexts: { 'functional-spec.md': spec, 'rules.md': '# Rules\n\n## BR6.2.1 別の規則\n' }, slice })).includes(`RULE_ID_UNKNOWN ${STATUS}`), 'BR6.2.1 does not define BR6.2');
});

test('engine-record Build and Test passes the dogfood shape end to end with the Q6 deviation', t => {
  const f = chain(t, { override: engineOverrides() });
  const e = engineRecordOf(t, f);
  e.audit(perStageApprovals(Object.keys(UNITS)));
  for (const unit of [U1, U2, U6]) assert.deepEqual(e.run('code-generation', unit).findings, [], `${unit} CG`);
  assert.deepEqual(e.run('build-and-test').findings, []);
});

// ---------- CLI ----------
test('CLI: rule-matrix generate/check with --unit/--contract and rule-matrix union', t => {
  const f = chain(t);
  const run = args => { const r = spawnSync(process.execPath, [MATRIX_CLI, ...args], { encoding: 'utf8' }); return { status: r.status, out: JSON.parse(r.stdout) }; };
  const dir = f.unitDirs[U1], out = path.join(f.temp, 'u1-matrix.json');
  const gen = run(['rule-matrix', 'generate', '--approved', path.join(dir, 'snapshot.json'), '--unit', U1, '--contract', path.join(dir, 'ui-poc-functional-contract.md'), '--out', out]);
  assert.equal(gen.status, 0); assert.deepEqual(gen.out.slice, M.unitSlice(U1, UNITS[U1]));
  assert.equal(run(['rule-matrix', 'generate', '--approved', path.join(dir, 'snapshot.json'), '--unit', U1, '--out', out]).status, 1, '--unit without --contract is refused');
  const chk = run(['rule-matrix', 'check', '--approved', path.join(dir, 'snapshot.json'), '--matrix', path.join(dir, 'ui-poc-element-rule-matrix.json'), '--fd', path.join(dir, 'functional-spec.md'), '--unit', U1, '--contract', path.join(dir, 'ui-poc-functional-contract.md')]);
  assert.equal(chk.status, 0, JSON.stringify(chk.out));
  const contracts = Object.keys(UNITS).map(u => path.join(f.unitDirs[u], 'ui-poc-implementation-contract.md'));
  const unionOut = path.join(f.temp, 'union.json'), dispOut = path.join(f.temp, 'union-dispositions.json');
  const union = run(['rule-matrix', 'union', '--approved', path.join(dir, 'snapshot.json'), '--unit-contracts', contracts.join(','), '--out', unionOut, '--dispositions-out', dispOut]);
  assert.equal(union.status, 0, JSON.stringify(union.out));
  assert.deepEqual(JSON.parse(fs.readFileSync(unionOut)), JSON.parse(fs.readFileSync(path.join(f.btDir, 'ui-poc-element-rule-matrix.json'))));
  assert.deepEqual(JSON.parse(fs.readFileSync(dispOut)), []);
  const short = run(['rule-matrix', 'union', '--approved', path.join(dir, 'snapshot.json'), '--unit-contracts', contracts.slice(1).join(','), '--out', unionOut]);
  assert.equal(short.status, 1); assert.ok(short.out.findings.some(x => x.code === 'ELEMENT_NO_OWNER'));
});
