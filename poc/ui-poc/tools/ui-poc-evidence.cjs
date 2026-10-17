#!/usr/bin/env node
'use strict';
// Dependency-free checker. Upstream sensor CLI adapter is main(); check() is local unit logic.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fidelity = require('./ui-poc-fidelity.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const contracts = {
  'rough-mockups': 'ui-poc-rough-contract.md',
  'refined-mockups': 'ui-poc-refined-contract.md',
  'code-generation': 'ui-poc-implementation-contract.md',
  'build-and-test': 'ui-poc-test-contract.md'
};
function boundedFile(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\\') || rel.split('/').includes('..')) throw Error('Unsafe evidence path');
  const rootReal = fs.realpathSync(root), resolved = fs.realpathSync(path.join(root, rel));
  if (!resolved.startsWith(rootReal + path.sep) || !fs.statSync(resolved).isFile()) throw Error('Evidence escapes contract directory or is not a file');
  return fs.readFileSync(resolved);
}
function check({stage, outputPath, approvalLedger, imageFeatures = {}, allowLegacySchema1 = false}, seen = new Set(), contractName = contracts[stage], depth = 0) {
  const findings = [];
  try {
    if (!Object.hasOwn(contracts, stage)) throw Error('Unsupported stage');
    if (!outputPath || !fs.statSync(outputPath).isFile()) throw Error('Declared deliverable is missing');
    const root = path.dirname(path.resolve(outputPath));
    if (depth > 2) throw Error('Upstream chain exceeds maximum depth');
    const bytes = boundedFile(root, contractName);
    const identity = fs.realpathSync(path.join(root, contractName));
    if (seen.has(identity)) throw Error('Cyclic upstream contract reference');
    seen.add(identity);
    const text = bytes.toString('utf8');
    for (const title of ['Artifact References','Screen State Acceptance Mapping','Approval Evidence','Testing Brief']) {
      if (!text.split(/\r?\n/).includes('## ' + title)) throw Error('Missing heading: ' + title);
    }
    const blocks = [...text.matchAll(/^```ui-poc-contract\r?\n([\s\S]*?)^```\s*$/gm)];
    if (blocks.length !== 1) throw Error('Expected exactly one ui-poc-contract JSON block');
    const c = JSON.parse(blocks[0][1]);
    if (![1,2].includes(c.schema) || c.stage !== stage || !['A','B','C'].includes(c.arm)) throw Error('Invalid schema, stage, or arm');
    if (c.schema === 1 && allowLegacySchema1 !== true) throw Error('Schema 1 is legacy migration input only; new/default UI evidence requires schema 2');
    if (!Array.isArray(c.assets) || !c.assets.length || !Array.isArray(c.mappings) || !c.mappings.length) throw Error('Empty assets or mappings');
    const assets = new Map();
    for (const a of c.assets) {
      if (!a || assets.has(a.path) || !/^[a-f0-9]{64}$/.test(a.sha256)) throw Error('Duplicate or invalid asset');
      if (!/\.(html|css|js|json|png|jpg|jpeg|svg|webp|woff2)$/.test(a.path)) throw Error('Unsupported evidence asset type');
      const asset = boundedFile(root, a.path);
      if (hash(asset) !== a.sha256) throw Error('Asset hash mismatch: ' + a.path);
      assets.set(a.path, a);
    }
    const ids = new Set();
    for (const m of c.mappings) {
      if (!/^SCREEN-[A-Z0-9-]+$/.test(m.screen) || !/^STATE-[A-Z0-9-]+$/.test(m.state) || !/^AC-[A-Z0-9-]+$/.test(m.ac) || !assets.has(m.asset) || !m.asset.endsWith('.html') || typeof m.check !== 'string' || !m.check.trim()) throw Error('Invalid screen/state/AC mapping');
      const key = [m.screen,m.state,m.ac].join('/');
      if (ids.has(key)) throw Error('Duplicate screen/state/AC mapping');
      ids.add(key);
    }
    if (!Array.isArray(c.requiredMappings) || !c.requiredMappings.length || c.requiredMappings.some(x => !ids.has(x)) || new Set(c.requiredMappings).size !== c.requiredMappings.length || c.requiredMappings.length !== ids.size) throw Error('Required mapping coverage mismatch');
    if (c.schema === 2) {
      if (!c.fidelity || !c.fidelity.approvedSnapshot || !assets.has(c.fidelity.approvedSnapshot.path) || c.fidelity.approvedSnapshot.sha256 !== assets.get(c.fidelity.approvedSnapshot.path).sha256) throw Error('Missing approved semantic snapshot');
      const approved = JSON.parse(boundedFile(root, c.fidelity.approvedSnapshot.path).toString('utf8'));
      const snapshotFindings = fidelity.validateSnapshot(approved);
      if (snapshotFindings.length) throw Error('Invalid approved semantic snapshot: ' + snapshotFindings.join('; '));
      const htmlAsset = assets.get(approved.source.path);
      if (!htmlAsset || htmlAsset.sha256 !== approved.source.sha256) throw Error('Semantic snapshot is not bound to its approved HTML asset');
      const wantsPng = imageFeatures.mockupPngGeneration === true || imageFeatures.visualRegression === true;
      if (wantsPng && (!approved.png || !assets.has(approved.png.path) || assets.get(approved.png.path).sha256 !== approved.png.sha256)) throw Error('Enabled PNG evidence is missing or not bound to the approved snapshot');
      const requiredStates = new Set(c.mappings.map(mapping => `${mapping.screen}/${mapping.state}`));
      const capturedStates = new Set(approved.captures.map(capture => `${capture.screen}/${capture.state}`));
      if (requiredStates.size !== capturedStates.size || [...requiredStates].some(key => !capturedStates.has(key))) throw Error('Semantic snapshot screen/state coverage differs from the approved mapping denominator');
      const dispositions = c.fidelity.dispositions || [];
      if (!Array.isArray(dispositions)) throw Error('Fidelity dispositions must be an array');
      if (stage === 'code-generation') {
        let ledger = {};
        if (dispositions.length) {
          if (!approvalLedger) throw Error('Trusted approval ledger is not configured for UI deviations');
          ledger = JSON.parse(fs.readFileSync(fs.realpathSync(approvalLedger), 'utf8'));
        }
        for (const disposition of dispositions) if (!fidelity.dispositionReceipt(disposition, ledger, fidelity.hashJson(approved))) throw Error(`UI disposition has no matching detached approval receipt: ${disposition?.elementKey || '?'}`);
      }
      if (stage === 'build-and-test') {
        if (!c.fidelity.actualSnapshot || !assets.has(c.fidelity.actualSnapshot.path) || c.fidelity.actualSnapshot.sha256 !== assets.get(c.fidelity.actualSnapshot.path).sha256) throw Error('Missing measured implementation semantic snapshot');
        const actual = JSON.parse(boundedFile(root, c.fidelity.actualSnapshot.path).toString('utf8'));
        const ledger = approvalLedger ? JSON.parse(fs.readFileSync(fs.realpathSync(approvalLedger), 'utf8')) : {};
        const comparison = fidelity.compareSnapshots(approved, actual, dispositions, ledger);
        if (!comparison.pass) throw Error('Implementation fidelity failed: ' + comparison.findings.join('; '));
        if (imageFeatures.visualRegression === true) {
          if (!actual.png || !assets.has(actual.png.path) || assets.get(actual.png.path).sha256 !== actual.png.sha256) throw Error('Enabled visual regression has no measured implementation PNG');
          const visual = fidelity.compareImages(path.join(root, approved.png.path), path.join(root, actual.png.path), approved, actual);
          if (!visual.pass) throw Error('Visual regression failed: ' + visual.findings.join('; '));
        }
      }
    }
    // Producer gates do not fabricate a pre-existing approval for their new draft.
    // Consumers require an independently captured approval of the upstream contract.
    const prior = {'code-generation':'refined-mockups','build-and-test':'code-generation'}[stage];
    if (prior) {
      if (!c.upstream || c.upstream.stage !== prior || !/^[a-f0-9]{64}$/.test(c.upstream.sha256)) throw Error('Missing approved upstream contract reference');
      const upstreamBytes = boundedFile(root, c.upstream.path);
      if (hash(upstreamBytes) !== c.upstream.sha256) throw Error('Upstream contract hash mismatch');
      const upstreamBlocks = [...upstreamBytes.toString('utf8').matchAll(/^```ui-poc-contract\r?\n([\s\S]*?)^```\s*$/gm)];
      if (upstreamBlocks.length !== 1) throw Error('Invalid upstream contract block');
      const parent = JSON.parse(upstreamBlocks[0][1]);
      if (![1,2].includes(parent.schema) || parent.schema !== c.schema || parent.stage !== prior || parent.arm !== c.arm || JSON.stringify(parent.requiredMappings) !== JSON.stringify(c.requiredMappings)) throw Error('Upstream contract identity or inventory differs');
      if (c.schema === 2) {
        if (parent.fidelity?.approvedSnapshot?.sha256 !== c.fidelity?.approvedSnapshot?.sha256) throw Error('Approved semantic snapshot changed across the handoff');
        if (stage === 'build-and-test' && fidelity.canonical(parent.fidelity?.dispositions || []) !== fidelity.canonical(c.fidelity?.dispositions || [])) throw Error('Approved UI dispositions changed after code-generation approval');
      }
      const upstreamPath = fs.realpathSync(path.join(root, c.upstream.path));
      const inherited = check({stage:prior,outputPath:upstreamPath,approvalLedger,imageFeatures,allowLegacySchema1}, seen, path.basename(upstreamPath), depth + 1);
      if (!inherited.pass) throw Error('Invalid upstream evidence: ' + inherited.findings.join('; '));
      if (!approvalLedger) throw Error('Trusted approval ledger is not configured');
      const ledgerReal = fs.realpathSync(approvalLedger), rootReal = fs.realpathSync(root);
      if (ledgerReal === rootReal || ledgerReal.startsWith(rootReal + path.sep)) throw Error('Approval ledger must be detached from evidence directory');
      const ledger = JSON.parse(fs.readFileSync(ledgerReal, 'utf8'));
      const approved = ledger.approvals?.find(a => a.contractSha256 === c.upstream.sha256 && a.stage === prior && a.arm === c.arm && a.status === 'approved' && typeof a.source === 'string' && a.source.trim() && typeof a.reviewer === 'string' && a.reviewer.trim());
      if (!approved) throw Error('Upstream contract has no matching explicit approval receipt');
      if (JSON.stringify(approved.requiredMappings) !== JSON.stringify(c.requiredMappings)) throw Error('Approved mapping inventory differs');
    }
  } catch (e) { findings.push(e.message); }
  return {pass: findings.length === 0, findings_count: findings.length, findings};
}
function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--stage','--output-path'].includes(argv[i]) || !argv[i+1] || args[argv[i]]) {
      console.log(JSON.stringify({pass:false,findings_count:1,findings:['Invalid arguments']})); return;
    }
    args[argv[i]] = argv[i+1];
  }
  console.log(JSON.stringify(check({stage:args['--stage'],outputPath:args['--output-path'],approvalLedger:process.env.UI_POC_APPROVAL_LEDGER,allowLegacySchema1:process.env.UI_POC_SCHEMA1_MIGRATION === '1'})));
}
if (require.main === module) main(process.argv.slice(2));
module.exports = {check, hash, contracts, main};
