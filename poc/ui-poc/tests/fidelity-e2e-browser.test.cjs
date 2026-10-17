'use strict';
// Real-renderer leg of the Mockups -> implementation fidelity proof. Requires a
// local Chrome/Edge. Without one the tests are reported as SKIPPED (never as
// passed); set UI_POC_REQUIRE_BROWSER=1 to turn an unavailable renderer into a
// failure (CI / evidence runs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { canonical, compareSnapshots } = require('../tools/ui-poc-fidelity.cjs');
const M = require('../tools/ui-poc-element-matrix.cjs');
const h = require('./fidelity-e2e-helpers.cjs');

const golden = rel => JSON.parse(h.readFixture(rel));
const available = h.browserAvailable();
const required = process.env.UI_POC_REQUIRE_BROWSER === '1';
const opts = { timeout: 600000, skip: !available && !required ? 'BROWSER_TOOL_UNAVAILABLE: no local Chrome/Edge (not a pass)' : false };

test('renderer is available when required', { skip: !required }, () => assert.equal(available, true, 'BROWSER_TOOL_UNAVAILABLE'));

test('approved mockup re-capture reproduces the recorded approved snapshot', opts, async () => {
  const fresh = await h.captureStates({ html: path.join(h.FIXTURE, 'approved', 'notes.html') });
  const recorded = golden('approved/ui-semantic-snapshot.json');
  assert.equal(canonical(fresh.source), canonical(recorded.source));
  assert.equal(canonical(fresh.captures), canonical(recorded.captures));
});

test('independent implementation passes, and dropping any reported semantic fails at Build and Test', opts, async () => {
  const approved = golden('approved/ui-semantic-snapshot.json');
  const ruleMatrix = golden('functional-design/ui-poc-element-rule-matrix.json');
  const good = await h.serve(h.readFixture('implementation/index.html'));
  let actual;
  try { actual = await h.captureStates({ url: good.url }); } finally { await good.close(); }
  assert.deepEqual(compareSnapshots(approved, actual).findings, []);
  const tm = M.generateTestMatrix({ approved, actual, ruleMatrix });
  assert.equal(tm.summary.fail, 0); assert.equal(tm.summary.total, ruleMatrix.rows.length);
  for (const [semantic, mutate] of Object.entries(h.REGRESSIONS)) {
    const source = h.readFixture('implementation/index.html'), mutated = mutate(source);
    assert.notEqual(mutated, source, `${semantic} mutation must apply`);
    const server = await h.serve(mutated);
    let regressed;
    try { regressed = await h.captureState({ url: server.url }, h.STATES.find(s => s.state === h.SEMANTIC_STATE[semantic])); } finally { await server.close(); }
    const spliced = JSON.parse(JSON.stringify(actual));
    spliced.captures = spliced.captures.map(c => c.state === regressed.captures[0].state ? regressed.captures[0] : c);
    const failed = M.generateTestMatrix({ approved, actual: spliced, ruleMatrix }).rows.filter(r => r.result === 'fail').map(r => r.elementKey);
    assert.ok(failed.some(key => h.REQUIRED_SEMANTICS[semantic].includes(key)), `${semantic}: real capture did not fail (${failed})`);
  }
});

test('action verification does not leak persisted side effects into the next reload (real-model dogfood regression)', opts, async () => {
  // A confirmed delete that persists to localStorage previously left the next
  // reload without the DELETE-NOTE control, a false NOT-READY.
  const source = h.readFixture('implementation/index.html');
  const persisting = source
    .replace("confirm.onclick = () => go('STATE-DELETED');", "confirm.onclick = () => { localStorage.setItem('deleted', '1'); go('STATE-DELETED'); };")
    .replace("render();\n</script>", "if (localStorage.getItem('deleted')) state = 'STATE-DELETED';\nrender();\n</script>");
  assert.notEqual(persisting, source);
  const server = await h.serve(persisting);
  try {
    const snapshot = await h.captureState({ url: server.url }, h.STATES.find(s => s.state === 'STATE-CONFIRM-DELETE'));
    const actions = snapshot.captures[0].elements.filter(e => e.action);
    assert.equal(actions.length, 2);
    assert.equal(actions.every(e => e.actionVerified === true), true);
  } finally { await server.close(); }
});
