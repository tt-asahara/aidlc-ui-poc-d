#!/usr/bin/env node
'use strict';
// Deterministic element-level matrices derived from the approved semantic
// snapshot. Tools own the denominator (every approved element, or in a
// Construction Unit every element of the Unit's contract slice, and every field
// the snapshot fixed); the Functional Design agent supplies knowledge (which rule
// or spec ID implements an element, or why it is not implemented); the person
// supplies judgement through the detached approval receipts that a deviation
// or omission requires. Nothing here generates an expected snapshot from code.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const fidelity = require('./ui-poc-fidelity.cjs');
const { canonical, hashJson, snapshotElements, elementDifferences, elementDeltaSha256, elementResults, dispositionReceipt, validateSnapshot } = fidelity;

const RULE_MATRIX_KIND = 'ui-element-rule-matrix';
const TEST_MATRIX_KIND = 'ui-element-test-matrix';
const RULE_ID = /^[A-Za-z][A-Za-z0-9._-]*[A-Za-z0-9]$/;
const DISPOSITION_STATUSES = ['upstream-revised', 'approved-deviation', 'intentionally-omitted'];
const norm = value => String(value || '').replace(/\s+/g, ' ').trim();

function obligations(element) {
  const result = [];
  if (element.exactCopy === true) result.push('exact-copy');
  if (element.action) result.push('action');
  if (element.truncation?.mode) result.push(`truncation-${element.truncation.mode}`);
  if (element.kind === 'business-value') result.push('business-value');
  if (element.kind === 'control' || element.kind === 'field') result.push('interactive');
  if (element.important === true) result.push('important');
  return result.sort();
}

/** The generated (tool-owned) half of a row. An agent edit to any of these fields is drift. */
function generatedRow(elementKey, element) {
  const row = { elementKey, kind: element.kind, obligations: obligations(element) };
  row.requiresRule = row.obligations.length > 0;
  if (element.role) row.role = element.role;
  if (element.exactCopy === true || element.important === true) row.text = element.text ?? null;
  if (element.action) row.action = { id: element.action.id, expectedState: element.action.expectedState, ...(element.action.target ? { target: element.action.target } : {}) };
  if (element.truncation) row.truncation = { mode: element.truncation.mode };
  return row;
}

/** Generated rows for the whole snapshot, or only for the screen/state pairs of a Unit slice. */
function generatedRows(snapshot, slice) {
  const states = slice ? new Set(slice.states) : null;
  return [...snapshotElements(snapshot)].filter(([, { capture }]) => !states || states.has(`${capture.screen}/${capture.state}`)).map(([key, { element }]) => generatedRow(key, element)).sort((a, b) => a.elementKey.localeCompare(b.elementKey));
}

const CONTRACT_BLOCK = /^```ui-poc-contract\r?\n([\s\S]*?)^```\s*$/gm;
/** The one parser of a contract's single ui-poc-contract JSON block. */
function contractBlock(text, label = 'Expected exactly one ui-poc-contract JSON block') {
  const blocks = [...String(text).matchAll(CONTRACT_BLOCK)];
  if (blocks.length !== 1) throw new Error(label);
  return JSON.parse(blocks[0][1]);
}

const UNIT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/**
 * The one owner of "which screen/state pairs a Unit contract owns": the
 * screen/state prefixes of its requiredMappings (SCREEN/STATE/AC), the same
 * inventory slice the evidence sensor validates against the refined contract.
 */
function sliceStates(requiredMappings) {
  if (!Array.isArray(requiredMappings) || !requiredMappings.length) throw new Error('Unit slice has no required screen/state/AC mappings');
  return [...new Set(requiredMappings.map(key => {
    const parts = typeof key === 'string' ? key.split('/') : [];
    if (parts.length !== 3 || parts.some(part => !part)) throw new Error(`Invalid screen/state/AC mapping key ${JSON.stringify(key)}`);
    return `${parts[0]}/${parts[1]}`;
  }))].sort();
}
/** The auditable slice record a Unit-scoped matrix carries. A different unit or state set is a different hash. */
function unitSlice(unit, requiredMappings) { return sliceRecord(unit, sliceStates(requiredMappings)); }
function sliceRecord(unit, states) {
  if (typeof unit !== 'string' || !UNIT_ID.test(unit)) throw new Error(`Invalid Unit id ${JSON.stringify(unit)}`);
  return { unit, states, sha256: hashJson({ unit, states }) };
}
/** A recorded slice is well formed when it equals the record its own unit and sorted, de-duplicated states produce. */
function validSlice(slice) {
  if (!slice || !Array.isArray(slice.states) || !slice.states.length || slice.states.some(state => typeof state !== 'string')) return false;
  try { return canonical(slice) === canonical(sliceRecord(slice.unit, [...new Set(slice.states)].sort())); } catch { return false; }
}
/** Slice states the approved snapshot never captured: a slice must be a subset of the approved snapshot. */
function unknownSliceStates(snapshot, slice) {
  const captured = new Set((snapshot?.captures || []).map(capture => `${capture.screen}/${capture.state}`));
  return slice.states.filter(state => !captured.has(state));
}

/**
 * Generate the element -> rule / unimplemented-reason matrix. When a previous
 * matrix is supplied (an upstream artifact revision), knowledge fields are
 * carried only for rows whose generated half is byte-identical; a changed
 * element is reset so it must be re-mapped rather than silently inherited.
 */
function generateRuleMatrix(snapshot, previous, slice) {
  const findings = validateSnapshot(snapshot);
  if (findings.length) throw new Error(`Invalid approved semantic snapshot: ${findings.join('; ')}`);
  if (slice) {
    const unknown = unknownSliceStates(snapshot, slice);
    if (unknown.length) throw new Error(`SLICE_STATE_UNKNOWN: Unit ${slice.unit} slice names screen/state pairs the approved snapshot never captured: ${unknown.join(', ')}`);
  }
  const carried = new Map((previous?.rows || []).map(row => [row.elementKey, row]));
  const rows = generatedRows(snapshot, slice).map(row => {
    const old = carried.get(row.elementKey);
    const unchanged = old && canonical(pickGenerated(old)) === canonical(row);
    return { ...row, ruleIds: unchanged && Array.isArray(old.ruleIds) ? [...old.ruleIds] : [], unimplementedReason: unchanged && typeof old.unimplementedReason === 'string' ? old.unimplementedReason : null };
  });
  return { schema: 1, kind: RULE_MATRIX_KIND, snapshotSha256: hashJson(snapshot), ...(slice ? { slice } : {}), rows };
}

function pickGenerated(row) {
  const out = {};
  for (const key of ['elementKey', 'kind', 'obligations', 'requiresRule', 'role', 'text', 'action', 'truncation']) if (row && Object.hasOwn(row, key)) out[key] = row[key];
  return out;
}

const tokenPattern = id => new RegExp(`(^|[^A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`);

/**
 * Functional Design consumption check. Bidirectional: every approved element
 * has exactly one row and every row names an approved element; generated
 * fields must equal the snapshot; each required element names rule IDs that
 * exist in the Functional Design text, or an unimplemented reason backed by an
 * approved intentionally-omitted disposition; exact copy must appear verbatim
 * in Functional Design unless an approved deviation/revision covers it.
 */
function checkRuleMatrix({ matrix, approved, fdTexts = {}, dispositions = [], ledger = {}, slice }) {
  const findings = [];
  const add = (code, elementKey, detail) => findings.push({ code, ...(elementKey ? { elementKey } : {}), detail });
  const snapshotFindings = validateSnapshot(approved);
  if (snapshotFindings.length) { add('APPROVED_SNAPSHOT_INVALID', null, snapshotFindings.join('; ')); return result(); }
  if (!matrix || matrix.schema !== 1 || matrix.kind !== RULE_MATRIX_KIND || !Array.isArray(matrix.rows)) { add('MATRIX_INVALID', null, 'not a schema 1 ui-element-rule-matrix'); return result(); }
  const approvedHash = hashJson(approved);
  if (matrix.snapshotSha256 !== approvedHash) add('MATRIX_SNAPSHOT_STALE', null, `matrix was generated for ${matrix.snapshotSha256}, approved snapshot is ${approvedHash}; regenerate after an approved artifact revision`);
  // A per-Unit stage's denominator is exactly its slice; elements of other
  // states are out of scope here and are covered at the intent-level union.
  if (slice) for (const state of unknownSliceStates(approved, slice)) add('SLICE_STATE_UNKNOWN', state, `Unit ${slice.unit} slice names a screen/state the approved snapshot never captured`);
  if (canonical(matrix.slice ?? null) !== canonical(slice ?? null)) add('MATRIX_SLICE_STALE', null, slice ? `matrix was generated for slice ${matrix.slice ? `${matrix.slice.unit} ${matrix.slice.sha256}` : '(whole snapshot)'}, this Unit contract's slice is ${slice.unit} ${slice.sha256}; regenerate with --unit ${slice.unit} --contract <this contract>` : 'matrix is Unit-scoped but this stage is not a Construction Unit; regenerate without --unit');
  const expected = new Map(generatedRows(approved, slice).map(row => [row.elementKey, row]));
  if (!expected.size) add('EMPTY_DENOMINATOR', null, slice ? 'the Unit slice has no approved elements' : 'approved snapshot has no elements');
  const seen = new Set();
  const fdCorpus = Object.keys(fdTexts).sort().map(name => fdTexts[name]).join('\n');
  const fdNormalized = norm(fdCorpus);
  if (!fdNormalized) add('FUNCTIONAL_DESIGN_EMPTY', null, 'no Functional Design text was supplied');
  const byElement = new Map();
  for (const disposition of Array.isArray(dispositions) ? dispositions : []) {
    if (byElement.has(disposition?.elementKey)) add('DISPOSITION_DUPLICATE', disposition.elementKey, 'more than one disposition for one element');
    byElement.set(disposition?.elementKey, disposition);
    if (!expected.has(disposition?.elementKey)) add('DISPOSITION_UNKNOWN_ELEMENT', disposition?.elementKey, slice ? 'disposition names no element of this Unit slice; claim the state through the slice first' : 'disposition names no approved element');
    else if (!dispositionReceipt(disposition, ledger, approvedHash)) add('DISPOSITION_WITHOUT_RECEIPT', disposition?.elementKey, 'no matching detached Functional Design approval receipt');
  }
  let mapped = 0, unimplemented = 0;
  for (const row of matrix.rows) {
    const key = row?.elementKey;
    if (seen.has(key)) { add('MATRIX_ROW_DUPLICATE', key, 'duplicate row'); continue; }
    seen.add(key);
    const want = expected.get(key);
    if (!want) { add('MATRIX_ROW_EXTRA', key, slice ? 'row names an element outside this Unit slice or absent from the approved snapshot' : 'row names an element absent from the approved snapshot'); continue; }
    if (canonical(pickGenerated(row)) !== canonical(want)) add('MATRIX_ROW_ALTERED', key, 'generated fields (copy, kind, role, action, truncation, obligations) differ from the approved snapshot');
    const ruleIds = Array.isArray(row.ruleIds) ? row.ruleIds : [];
    const reason = typeof row.unimplementedReason === 'string' ? row.unimplementedReason.trim() : '';
    if (ruleIds.length && reason) add('RULE_AND_UNIMPLEMENTED', key, 'a row is either implemented by rules or unimplemented, not both');
    const disposition = byElement.get(key);
    if (reason) {
      unimplemented += 1;
      if (!disposition || disposition.status !== 'intentionally-omitted') add('UNIMPLEMENTED_WITHOUT_DISPOSITION', key, 'unimplemented reason requires an intentionally-omitted disposition with an approval receipt');
      else if (disposition.deltaSha256 !== elementDeltaSha256(key, ['missing'])) add('UNIMPLEMENTED_DELTA_MISMATCH', key, 'omission receipt must bind the "missing" delta');
      continue;
    }
    if (disposition?.status === 'intentionally-omitted') add('OMISSION_NOT_DECLARED_IN_MATRIX', key, 'an approved omission must carry its unimplemented reason in the matrix');
    if (want.requiresRule && !ruleIds.length) { add('ELEMENT_UNMAPPED', key, `required element (${want.obligations.join(', ')}) has no rule/spec ID and no unimplemented reason`); continue; }
    for (const id of ruleIds) {
      if (typeof id !== 'string' || !RULE_ID.test(id)) add('RULE_ID_INVALID', key, `invalid rule ID ${JSON.stringify(id)}`);
      else if (!tokenPattern(id).test(fdCorpus)) add('RULE_ID_UNKNOWN', key, `rule ID ${id} does not appear in the Functional Design artifacts`);
    }
    if (ruleIds.length) mapped += 1;
    const deviated = disposition && ['approved-deviation', 'upstream-revised'].includes(disposition.status);
    if (want.obligations.includes('exact-copy') && !deviated && !fdNormalized.includes(norm(want.text))) add('EXACT_COPY_NOT_PROPAGATED', key, `approved exact copy ${JSON.stringify(want.text)} does not appear verbatim in Functional Design`);
  }
  for (const key of expected.keys()) if (!seen.has(key)) add('MATRIX_ROW_MISSING', key, 'approved element has no matrix row');
  return result();
  function result() {
    findings.sort((a, b) => a.code.localeCompare(b.code) || String(a.elementKey || '').localeCompare(String(b.elementKey || '')));
    return { pass: findings.length === 0, findings_count: findings.length, findings, rows: expected?.size || 0, mapped, unimplemented };
  }
}

/**
 * Intent-level coverage for Build and Test (runs once per Intent): the union of
 * every Unit's approved, Unit-scoped Functional Design matrix. Each approved
 * element that requires a rule needs an owner (a Unit row with rule IDs) or,
 * when no Unit implements it, a receipted intentionally-omitted row. An
 * element owned by two Units is allowed only when both carry the same rule IDs
 * and the same disposition (status and exact delta); anything else is an owner
 * conflict, never a silent pick. A Unit-local omission does not excuse an
 * element another Unit owns: the owner's disposition (if any) is the one that
 * reaches the Build and Test comparison. Returns the merged matrix (bound to
 * the approved snapshot and to each Unit matrix hash and slice) and merged
 * dispositions; both are deterministic, so the gate recomputes and compares.
 */
function unionRuleMatrix({ approved, units }) {
  const findings = [];
  const add = (code, elementKey, detail) => findings.push({ code, ...(elementKey ? { elementKey } : {}), detail });
  const snapshotFindings = validateSnapshot(approved);
  if (snapshotFindings.length) { add('APPROVED_SNAPSHOT_INVALID', null, snapshotFindings.join('; ')); return done(null, []); }
  const approvedHash = hashJson(approved);
  if (!Array.isArray(units) || !units.length) { add('NO_UNIT_MATRICES', null, 'no Unit rule matrix was supplied'); return done(null, []); }
  const seenUnits = new Set(), byUnit = [];
  for (const entry of units) {
    const slice = entry?.matrix?.slice, unit = slice?.unit;
    if (!entry?.matrix || entry.matrix.kind !== RULE_MATRIX_KIND || !Array.isArray(entry.matrix.rows)) { add('UNIT_MATRIX_INVALID', null, `${unit || '?'}: not a ui-element-rule-matrix`); continue; }
    if (!validSlice(slice)) { add('UNIT_MATRIX_NOT_SCOPED', null, `${unit || '?'}: matrix carries no valid Unit slice; regenerate it with --unit/--contract`); continue; }
    if (seenUnits.has(unit)) { add('UNIT_DUPLICATE', null, `${unit}: more than one matrix for one Unit`); continue; }
    seenUnits.add(unit);
    if (entry.matrix.snapshotSha256 !== approvedHash) add('UNIT_MATRIX_STALE', null, `${unit}: matrix is bound to ${entry.matrix.snapshotSha256}, approved snapshot is ${approvedHash}`);
    for (const state of unknownSliceStates(approved, slice)) add('SLICE_STATE_UNKNOWN', state, `${unit}: slice names a screen/state the approved snapshot never captured`);
    const dispositions = new Map((Array.isArray(entry.dispositions) ? entry.dispositions : []).map(value => [value?.elementKey, value]));
    byUnit.push({ unit, matrix: entry.matrix, rows: new Map(entry.matrix.rows.map(row => [row.elementKey, row])), dispositions });
  }
  if (findings.length) return done(null, []);
  byUnit.sort((a, b) => a.unit.localeCompare(b.unit));
  const decision = (u, key) => { const d = u.dispositions.get(key); return d ? { status: d.status, deltaSha256: d.deltaSha256 } : null; };
  const rows = [], mergedDispositions = [];
  for (const generated of generatedRows(approved)) {
    const key = generated.elementKey;
    const present = byUnit.filter(u => u.rows.has(key));
    const owners = present.filter(u => Array.isArray(u.rows.get(key).ruleIds) && u.rows.get(key).ruleIds.length);
    const omitters = present.filter(u => !owners.includes(u) && typeof u.rows.get(key).unimplementedReason === 'string' && u.rows.get(key).unimplementedReason.trim());
    if (owners.length > 1) {
      const first = owners[0], ids = u => canonical([...u.rows.get(key).ruleIds].sort());
      const differing = owners.filter(u => ids(u) !== ids(first) || canonical(decision(u, key)) !== canonical(decision(first, key)));
      if (differing.length) add('ELEMENT_OWNER_CONFLICT', key, `Units ${owners.map(u => u.unit).join(', ')} all implement this element with different rule IDs or dispositions; map it with the same rule IDs and disposition in every claiming Unit, or omit it (with a receipt) in all but one`);
    }
    if (generated.requiresRule && !owners.length && !omitters.length) add('ELEMENT_NO_OWNER', key, present.length ? `no Unit implements or omits this element (in the slice of ${present.map(u => u.unit).join(', ')})` : 'no Unit slice includes this screen/state');
    const deciding = owners.length ? owners : omitters.length ? omitters : present;
    const lead = deciding[0];
    const leadRow = lead?.rows.get(key);
    rows.push({ ...generated, ruleIds: owners.length ? [...leadRow.ruleIds] : [], unimplementedReason: !owners.length && omitters.length ? leadRow.unimplementedReason : null, units: deciding.map(u => u.unit) });
    const leadDisposition = deciding.map(u => u.dispositions.get(key)).find(Boolean);
    if (leadDisposition) mergedDispositions.push(leadDisposition);
  }
  mergedDispositions.sort((a, b) => a.elementKey.localeCompare(b.elementKey));
  return done({ schema: 1, kind: RULE_MATRIX_KIND, snapshotSha256: approvedHash, units: byUnit.map(u => ({ unit: u.unit, ruleMatrixSha256: hashJson(u.matrix), slice: u.matrix.slice })), rows }, mergedDispositions);
  function done(matrix, dispositions) {
    findings.sort((a, b) => a.code.localeCompare(b.code) || String(a.elementKey || '').localeCompare(String(b.elementKey || '')));
    return { pass: findings.length === 0, findings_count: findings.length, findings, matrix, dispositions };
  }
}

function checksFor(element) {
  const checks = ['presence', 'role'];
  if (element.exactCopy === true) checks.push('exact-copy');
  if (element.truncation?.mode) checks.push(`truncation-${element.truncation.mode}`);
  if (element.action) checks.push('action');
  return checks;
}

/**
 * Build and Test element matrix: one row per approved element (the
 * denominator never comes from the implementation), plus a row for every
 * important explicit-ID element the implementation added without approval.
 */
function generateTestMatrix({ approved, actual, ruleMatrix, dispositions = [], ledger = {} }) {
  for (const [label, snapshot] of [['approved', approved], ['actual', actual]]) {
    const findings = validateSnapshot(snapshot);
    if (findings.length) throw new Error(`Invalid ${label} semantic snapshot: ${findings.join('; ')}`);
  }
  const approvedHash = hashJson(approved);
  if (!ruleMatrix || ruleMatrix.snapshotSha256 !== approvedHash) throw new Error('Rule matrix is missing or not bound to the approved snapshot');
  const rules = new Map(ruleMatrix.rows.map(row => [row.elementKey, row]));
  const rows = elementResults(approved, actual, dispositions, ledger).map(row => {
    const rule = rules.get(row.elementKey);
    return { elementKey: row.elementKey, ruleIds: rule?.ruleIds || [], unimplementedReason: rule?.unimplementedReason || null, checks: row.addition ? ['absence'] : checksFor(row.element), differences: row.differences, result: row.result };
  });
  const summary = { total: rows.length, pass: 0, fail: 0, deviated: 0 };
  for (const row of rows) { if (row.result === 'pass') summary.pass += 1; else if (row.result === 'fail') summary.fail += 1; else summary.deviated += 1; }
  return { schema: 1, kind: TEST_MATRIX_KIND, approvedSnapshotSha256: approvedHash, actualSnapshotSha256: hashJson(actual), ruleMatrixSha256: hashJson(ruleMatrix), rows, summary };
}

/** The recorded matrix must equal a fresh recomputation and contain no failed or empty denominator. */
function checkTestMatrix({ matrix, approved, actual, ruleMatrix, dispositions = [], ledger = {} }) {
  const findings = [];
  let expected;
  try { expected = generateTestMatrix({ approved, actual, ruleMatrix, dispositions, ledger }); }
  catch (error) { return { pass: false, findings_count: 1, findings: [{ code: 'TEST_MATRIX_INPUT_INVALID', detail: error.message }] }; }
  if (!matrix || canonical(matrix) !== canonical(expected)) findings.push({ code: 'TEST_MATRIX_MISMATCH', detail: 'recorded element test matrix differs from the deterministic recomputation' });
  if (!expected.summary.total) findings.push({ code: 'EMPTY_DENOMINATOR', detail: 'no approved elements were checked' });
  for (const row of expected.rows) if (row.result === 'fail') findings.push({ code: 'ELEMENT_FAILED', elementKey: row.elementKey, detail: row.differences.join(', ') });
  return { pass: findings.length === 0, findings_count: findings.length, findings, summary: expected.summary };
}

/**
 * Approved-upstream change control between two APPROVED design snapshots (an
 * artifact revision). Returns the exact element delta; the revised contract
 * declares it and the person's ordinary approval of that contract confirms it.
 */
function upstreamDelta(previous, current) {
  const before = snapshotElements(previous), after = snapshotElements(current);
  const changes = [];
  for (const [key, { element }] of before) {
    const differences = elementDifferences(element, after.get(key)?.element, { observedIsApproved: true });
    if (differences.length) changes.push({ elementKey: key, differences });
  }
  for (const [key, { element }] of after) if (!before.has(key) && (element.important || element.exactCopy)) changes.push({ elementKey: key, differences: ['added'] });
  changes.sort((a, b) => a.elementKey.localeCompare(b.elementKey));
  return { changes, changedElements: changes.map(change => change.elementKey), deltaSha256: hashJson(changes) };
}

function checkRevision({ revision, previous, current }) {
  const findings = [];
  const delta = upstreamDelta(previous, current);
  if (!delta.changes.length) findings.push('Revision declares an upstream change, but no element changed');
  if (canonical(revision?.changedElements || null) !== canonical(delta.changedElements)) findings.push(`Revision changedElements do not match the computed delta: ${delta.changedElements.join(', ') || '(none)'}`);
  if (revision?.deltaSha256 !== delta.deltaSha256) findings.push('Revision deltaSha256 does not match the computed element delta');
  return { pass: findings.length === 0, findings, ...delta };
}

function parse(argv) { const result = { _: [] }; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) result._.push(argv[i]); else { const key = argv[i].slice(2); if (!argv[i + 1] || argv[i + 1].startsWith('--')) result[key] = true; else result[key] = argv[++i]; } } return result; }
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
/** --unit and --contract together select a Unit slice from that contract's requiredMappings; either alone is an error. */
function sliceArg(args) {
  if (!args.unit && !args.contract) return undefined;
  if (!args.unit || !args.contract || args.unit === true || args.contract === true) throw new Error('A Unit-scoped matrix needs both --unit UNIT and --contract UNIT_CONTRACT');
  return unitSlice(args.unit, contractBlock(fs.readFileSync(args.contract, 'utf8')).requiredMappings);
}
/** One Unit's approved contract (functional-design or code-generation copy) -> its rule matrix and dispositions. */
function unitEntryFromContract(file) {
  const contract = contractBlock(fs.readFileSync(file, 'utf8'));
  const ref = contract.fidelity?.elementRuleMatrix;
  if (!ref || typeof ref.path !== 'string' || path.isAbsolute(ref.path) || ref.path.split('/').includes('..')) throw new Error(`${file}: contract has no safe fidelity.elementRuleMatrix path`);
  const bytes = fs.readFileSync(path.join(path.dirname(file), ref.path));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new Error(`${file}: element rule matrix hash differs from the contract`);
  return { matrix: JSON.parse(bytes.toString('utf8')), dispositions: contract.fidelity.dispositions || [] };
}
function main(argv) {
  try {
    const args = parse(argv), [group, verb] = args._;
    const dispositions = args.dispositions ? readJson(args.dispositions) : [];
    const ledger = args['approval-ledger'] ? readJson(args['approval-ledger']) : {};
    if (group === 'rule-matrix' && verb === 'generate') {
      if (!args.approved || !args.out) throw new Error('USAGE: rule-matrix generate --approved SNAPSHOT --out MATRIX [--previous MATRIX] [--unit UNIT --contract UNIT_CONTRACT]');
      const slice = sliceArg(args);
      const matrix = generateRuleMatrix(readJson(args.approved), args.previous ? readJson(args.previous) : undefined, slice);
      write(args.out, matrix); console.log(JSON.stringify({ pass: true, rows: matrix.rows.length, requiresRule: matrix.rows.filter(row => row.requiresRule).length, snapshotSha256: matrix.snapshotSha256, ...(slice ? { slice } : {}) })); return;
    }
    if (group === 'rule-matrix' && verb === 'check') {
      if (!args.approved || !args.matrix || !args.fd) throw new Error('USAGE: rule-matrix check --approved SNAPSHOT --matrix MATRIX --fd FILE[,FILE] [--unit UNIT --contract UNIT_CONTRACT] [--dispositions FILE] [--approval-ledger FILE]');
      const fdTexts = Object.fromEntries(String(args.fd).split(',').map(file => [file.trim(), fs.readFileSync(file.trim(), 'utf8')]));
      const result = checkRuleMatrix({ matrix: readJson(args.matrix), approved: readJson(args.approved), fdTexts, dispositions, ledger, slice: sliceArg(args) });
      console.log(JSON.stringify(result)); process.exitCode = result.pass ? 0 : 1; return;
    }
    if (group === 'rule-matrix' && verb === 'union') {
      if (!args.approved || !args['unit-contracts'] || !args.out) throw new Error('USAGE: rule-matrix union --approved SNAPSHOT --unit-contracts CONTRACT[,CONTRACT] --out MATRIX [--dispositions-out FILE]');
      const units = String(args['unit-contracts']).split(',').map(file => unitEntryFromContract(file.trim()));
      const result = unionRuleMatrix({ approved: readJson(args.approved), units });
      if (result.pass) { write(args.out, result.matrix); if (args['dispositions-out']) write(args['dispositions-out'], result.dispositions); }
      console.log(JSON.stringify({ pass: result.pass, findings_count: result.findings_count, findings: result.findings, units: result.matrix?.units.map(u => u.unit) || [], rows: result.matrix?.rows.length || 0, dispositions: result.dispositions.length }));
      process.exitCode = result.pass ? 0 : 1; return;
    }
    if (group === 'test-matrix' && (verb === 'generate' || verb === 'check')) {
      if (!args.approved || !args.actual || !args['rule-matrix'] || (verb === 'generate' ? !args.out : !args.matrix)) throw new Error(`USAGE: test-matrix ${verb} --approved SNAPSHOT --actual SNAPSHOT --rule-matrix MATRIX ${verb === 'generate' ? '--out FILE' : '--matrix FILE'} [--dispositions FILE] [--approval-ledger FILE]`);
      const input = { approved: readJson(args.approved), actual: readJson(args.actual), ruleMatrix: readJson(args['rule-matrix']), dispositions, ledger };
      if (verb === 'generate') { const matrix = generateTestMatrix(input); write(args.out, matrix); console.log(JSON.stringify({ pass: matrix.summary.fail === 0 && matrix.summary.total > 0, summary: matrix.summary })); process.exitCode = matrix.summary.fail === 0 && matrix.summary.total > 0 ? 0 : 1; return; }
      const result = checkTestMatrix({ ...input, matrix: readJson(args.matrix) }); console.log(JSON.stringify(result)); process.exitCode = result.pass ? 0 : 1; return;
    }
    if (group === 'revision') {
      if (!args.previous || !args.current) throw new Error('USAGE: revision --previous SNAPSHOT --current SNAPSHOT');
      const delta = upstreamDelta(readJson(args.previous), readJson(args.current)); console.log(JSON.stringify({ pass: true, ...delta })); return;
    }
    throw new Error('USAGE: ui-poc-element-matrix.cjs rule-matrix generate|check|union | test-matrix generate|check | revision');
  } catch (error) { console.log(JSON.stringify({ pass: false, findings_count: 1, findings: [error.message] })); process.exitCode = 1; }
}
if (require.main === module) main(process.argv.slice(2));
module.exports = { RULE_MATRIX_KIND, TEST_MATRIX_KIND, DISPOSITION_STATUSES, obligations, generatedRows, contractBlock, sliceStates, unitSlice, validSlice, generateRuleMatrix, checkRuleMatrix, unionRuleMatrix, generateTestMatrix, checkTestMatrix, upstreamDelta, checkRevision, main };
