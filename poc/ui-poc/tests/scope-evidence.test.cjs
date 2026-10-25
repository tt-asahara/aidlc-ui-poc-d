'use strict';
// Per-scope upstream approval and per-Unit inventory slices inside a real
// engine record layout (aidlc-state.md + intent/Unit stage directories).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {check, hash, scopePolicy} = require('../tools/ui-poc-evidence.cjs');
const render = c => '# Synthetic fixture, not workflow evidence\n\n## Artifact References\n\n## Screen State Acceptance Mapping\n\n## Approval Evidence\n\n## Testing Brief\n\n```ui-poc-contract\n' + JSON.stringify(c) + '\n```\n';
const HOME = 'SCREEN-HOME/STATE-EMPTY/AC-001', LIST = 'SCREEN-LIST/STATE-EMPTY/AC-002';
const mapping = key => { const [screen, state, ac] = key.split('/'); return {screen, state, ac, asset:'screen.html', check:'Shows ' + key}; };

function fixture(t, scope, unitMappings = [HOME]) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ui-poc-scope-')));
  const old = process.cwd(); process.chdir(project);
  t.after(() => { process.chdir(old); fs.rmSync(project, {recursive:true, force:true}); });
  const record = path.join(project, 'aidlc', 'intents', 'x');
  const refinedDir = path.join(record, 'inception', 'refined-mockups');
  const unitDir = path.join(record, 'construction', 'u1', 'code-generation');
  for (const dir of [refinedDir, unitDir]) { fs.mkdirSync(dir, {recursive:true}); fs.writeFileSync(path.join(dir, 'screen.html'), '<!doctype html><title>fixture</title>'); }
  fs.writeFileSync(path.join(record, 'aidlc-state.md'), '# State\n\n- **Scope**: ' + scope + '\n');
  // The engine audit records the person's official approval of refined-mockups.
  fs.mkdirSync(path.join(record, 'audit'));
  fs.writeFileSync(path.join(record, 'audit', 'shard.md'), '# Audit\n\n## Gate Approved\n**Timestamp**: 2026-10-19T00:00:00Z\n**Event**: GATE_APPROVED\n**Stage**: refined-mockups\n**User Input**: Approve\n');
  const asset = {path:'screen.html', sha256:hash(fs.readFileSync(path.join(refinedDir, 'screen.html')))};
  const refined = {schema:1, stage:'refined-mockups', arm:'C', assets:[asset], mappings:[HOME, LIST].map(mapping), requiredMappings:[HOME, LIST]};
  fs.writeFileSync(path.join(refinedDir, 'ui-poc-refined-contract.md'), render(refined));
  fs.copyFileSync(path.join(refinedDir, 'ui-poc-refined-contract.md'), path.join(unitDir, 'upstream-refined.md'));
  const upstreamSha = hash(fs.readFileSync(path.join(unitDir, 'upstream-refined.md')));
  const unit = {schema:1, stage:'code-generation', arm:'C', assets:[asset], mappings:unitMappings.map(mapping), requiredMappings:unitMappings, upstream:{path:'upstream-refined.md', stage:'refined-mockups', sha256:upstreamSha}};
  const outputPath = path.join(unitDir, 'ui-poc-implementation-contract.md');
  fs.writeFileSync(outputPath, render(unit));
  fs.writeFileSync(path.join(unitDir, 'code-generation-plan.md'), '# Plan\n');
  const ledger = path.join(project, 'ledger.json');
  const approveRefined = () => fs.writeFileSync(ledger, JSON.stringify({approvals:[{contractSha256:upstreamSha, stage:'refined-mockups', arm:'C', status:'approved', source:'synthetic-unit-fixture-only', reviewer:'synthetic-test-reviewer', requiredMappings:[HOME, LIST]}]}));
  const run = approvalLedger => check({stage:'code-generation', outputPath:path.join(unitDir, 'code-generation-plan.md'), approvalLedger, allowLegacySchema1:true});
  return {project, record, refinedDir, unitDir, ledger, approveRefined, run};
}

test('scope policy: application and requirements use the engine record, comparison and unlisted scopes keep the ledger', () => {
  assert.deepEqual(scopePolicy('ui-poc-application'), {sensor:'on', upstreamApproval:'engine-record'});
  assert.deepEqual(scopePolicy('ui-poc-requirements'), {sensor:'on', upstreamApproval:'engine-record'});
  assert.deepEqual(scopePolicy('ui-poc-document-driven'), {sensor:'on', upstreamApproval:'engine-record'});
  assert.deepEqual(scopePolicy('ui-poc-comparison'), {sensor:'on', upstreamApproval:'ledger'});
  assert.deepEqual(scopePolicy('some-other-scope'), {sensor:'on', upstreamApproval:'ledger'});
  assert.deepEqual(scopePolicy(null), {sensor:'on', upstreamApproval:'ledger'});
});

test('engine-record scope: a Unit slice of the approved refined contract passes without a ledger', t => {
  const f = fixture(t, 'ui-poc-application');
  assert.deepEqual(f.run(undefined).findings, []);
});

test('engine-record scope: byte equality without the official gate approval fails; a later reopen withdraws it', t => {
  const f = fixture(t, 'ui-poc-application');
  const shard = path.join(f.record, 'audit', 'shard.md');
  fs.appendFileSync(shard, '\n---\n\n## Stage Revising\n**Timestamp**: 2026-10-19T00:01:00Z\n**Event**: STAGE_REVISING\n**Stage**: refined-mockups\n');
  assert.match(f.run(undefined).findings.join('\n'), /no official gate approval of refined-mockups \(latest gate status: open\)/);
  fs.rmSync(path.join(f.record, 'audit'), {recursive:true});
  assert.match(f.run(undefined).findings.join('\n'), /no official gate approval of refined-mockups \(latest gate status: none\)/);
});

test('engine-record scope: an upstream copy that differs from the engine record artifact fails', t => {
  const f = fixture(t, 'ui-poc-application');
  fs.appendFileSync(path.join(f.refinedDir, 'ui-poc-refined-contract.md'), '\nedited after the copy\n');
  assert.match(f.run(undefined).findings.join('\n'), /differs from the engine record artifact inception\/refined-mockups\/ui-poc-refined-contract\.md/);
});

test('engine-record scope: a missing engine record artifact fails', t => {
  const f = fixture(t, 'ui-poc-application');
  fs.rmSync(f.refinedDir, {recursive:true});
  assert.match(f.run(undefined).findings.join('\n'), /Engine record holds no approved refined-mockups contract/);
});

test('a Unit slice may not map a screen/state/AC the upstream contract lacks', t => {
  const f = fixture(t, 'ui-poc-application', [HOME, 'SCREEN-EXTRA/STATE-EMPTY/AC-009']);
  assert.match(f.run(undefined).findings.join('\n'), /Unit u1 maps a screen\/state\/AC the upstream contract does not/);
});

test('ledger scope: a Unit slice is checked against the approval of the full upstream inventory', t => {
  const f = fixture(t, 'ui-poc-comparison');
  assert.match(f.run(undefined).findings.join('\n'), /Trusted approval ledger is not configured/);
  f.approveRefined();
  assert.deepEqual(f.run(f.ledger).findings, []);
});

test('outside a Construction Unit the handoff inventory must still match exactly', t => {
  const f = fixture(t, 'ui-poc-application');
  const intentDir = path.join(f.record, 'construction', 'code-generation');
  fs.cpSync(f.unitDir, intentDir, {recursive:true});
  const result = check({stage:'code-generation', outputPath:path.join(intentDir, 'code-generation-plan.md'), allowLegacySchema1:true});
  assert.match(result.findings.join('\n'), /Upstream contract inventory differs/);
});

test('sensor adapter resolves the scope from the engine record of the dispatched output', t => {
  const f = fixture(t, 'ui-poc-application');
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '../tools/aidlc-sensor-ui-poc-evidence.ts'), '--stage', 'code-generation', '--output-path', path.join(f.unitDir, 'code-generation-plan.md')], {cwd:f.project, encoding:'utf8', env:{...process.env, UI_POC_SCHEMA1_MIGRATION:'1', UI_POC_APPROVAL_LEDGER:''}});
  const verdict = JSON.parse(r.stdout);
  assert.doesNotMatch(verdict.findings.join('\n'), /ledger|inventory|not enabled by the routing config/);
});
