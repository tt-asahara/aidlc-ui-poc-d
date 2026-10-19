#!/usr/bin/env node
'use strict';
// Dependency-free checker. Upstream sensor CLI adapter is main(); check() is local unit logic.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fidelity = require('./ui-poc-fidelity.cjs');
const matrix = require('./ui-poc-element-matrix.cjs');
const {engineRecord} = require('./ui-poc-c-routing.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const contracts = {
  'rough-mockups': 'ui-poc-rough-contract.md',
  'refined-mockups': 'ui-poc-refined-contract.md',
  'functional-design': 'ui-poc-functional-contract.md',
  'code-generation': 'ui-poc-implementation-contract.md',
  'build-and-test': 'ui-poc-test-contract.md'
};
// Acceptance-criterion IDs. The official form is the core user-stories
// grammar `AC{story-group}.{story-seq}.{criterion-seq}` (for example AC1.1.1),
// carried verbatim. The legacy `AC-…` form stays valid so provisional
// rough-mockups IDs (written before user stories exist) and existing contracts
// keep validating; mapping a legacy ID onto an official one is the optional D
// requirement-ID check's explicit bridge, never an inference here.
const OFFICIAL_AC_ID = /^AC[0-9]+\.[0-9]+\.[0-9]+$/;
const LEGACY_AC_ID = /^AC-[A-Z0-9-]+$/;
const isAcId = value => typeof value === 'string' && (OFFICIAL_AC_ID.test(value) || LEGACY_AC_ID.test(value));
function boundedFile(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\\') || rel.split('/').includes('..')) throw Error('Unsafe evidence path');
  const rootReal = fs.realpathSync(root), resolved = fs.realpathSync(path.join(root, rel));
  if (!resolved.startsWith(rootReal + path.sep) || !fs.statSync(resolved).isFile()) throw Error('Evidence escapes contract directory or is not a file');
  return fs.readFileSync(resolved);
}
const policyPath = path.join(__dirname, 'ui-poc', 'scope-evidence.json');
const POLICY_VALUES = {sensor:['on','off'], upstreamApproval:['ledger','engine-record']};
/** The configured evidence policy for an engine scope; an unlisted scope gets the strict default. */
function scopePolicy(scope) {
  const strict = {sensor:'on', upstreamApproval:'ledger'};
  if (!fs.existsSync(policyPath)) return strict;
  const cfg = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const policy = scope && Object.hasOwn(cfg.scopes || {}, scope) ? cfg.scopes[scope] : cfg.default;
  if (cfg.schema !== 1 || !policy || Object.entries(POLICY_VALUES).some(([key, values]) => !values.includes(policy[key]))) throw Error('Invalid UI evidence scope policy: ' + policyPath);
  return {sensor:policy.sensor, upstreamApproval:policy.upstreamApproval};
}
/** Record facts for the dispatched output; outside an engine record the strict default applies. */
function engineFor(outputPath, stage) {
  let record = {recordRoot:null, unit:null, scope:null};
  try { record = engineRecord(outputPath, stage); } catch {}
  return {recordRoot:record.recordRoot, unit:record.unit, scope:record.scope, policy:scopePolicy(record.scope)};
}
function check({stage, outputPath, approvalLedger, imageFeatures = {}, allowLegacySchema1 = false, engine}, seen = new Set(), contractName = contracts[stage], depth = 0) {
  const findings = [];
  try {
    if (!Object.hasOwn(contracts, stage)) throw Error('Unsupported stage');
    if (!outputPath || !fs.statSync(outputPath).isFile()) throw Error('Declared deliverable is missing');
    const root = path.dirname(path.resolve(outputPath));
    engine ??= engineFor(outputPath, stage);
    if (engine.policy.sensor === 'off') return {pass:true, findings_count:0, findings:[], notApplicable:`UI evidence is off for scope ${engine.scope}`};
    // A Construction Unit carries the slice of the intent-level refined
    // inventory that its unit owns; everything else stays an exact handoff.
    const unitSlice = engine.unit !== null && ['functional-design','code-generation'].includes(stage);
    // Functional Design is per unit and the core marks frontend-components as
    // the UI-kind artifact. A unit with neither that artifact nor a UI contract
    // is a non-UI unit; any UI unit (or any contract) is fully checked, and
    // code-generation still refuses a UI handoff without an approved FD contract.
    if (stage === 'functional-design' && depth === 0 && !fs.existsSync(path.join(root, contractName)) && !fs.existsSync(path.join(root, 'frontend-components.md'))) return {pass:true, findings_count:0, findings:[], notApplicable:'non-UI functional-design unit'};
    if (depth > 3) throw Error('Upstream chain exceeds maximum depth');
    const bytes = boundedFile(root, contractName);
    const identity = fs.realpathSync(path.join(root, contractName));
    if (seen.has(identity)) throw Error('Cyclic upstream contract reference');
    seen.add(identity);
    const text = bytes.toString('utf8');
    for (const title of ['Artifact References','Screen State Acceptance Mapping','Approval Evidence','Testing Brief']) {
      if (!text.split(/\r?\n/).includes('## ' + title)) throw Error('Missing heading: ' + title);
    }
    const c = matrix.contractBlock(text);
    if (![1,2].includes(c.schema) || c.stage !== stage || !['A','B','C'].includes(c.arm)) throw Error('Invalid schema, stage, or arm');
    if (c.schema === 1 && allowLegacySchema1 !== true) throw Error('Schema 1 is legacy migration input only; new/default UI evidence requires schema 2');
    if (c.schema === 1 && stage === 'functional-design') throw Error('Functional Design UI evidence exists only in schema 2');
    // Multi-Unit Build and Test (once per Intent) reads every Unit's approved
    // implementation contract instead of one upstream contract.
    const multiUnit = stage === 'build-and-test' && c.schema === 2 && c.fidelity?.unitContracts !== undefined;
    if (!Array.isArray(c.assets) || !c.assets.length || !Array.isArray(c.mappings) || !c.mappings.length) throw Error('Empty assets or mappings');
    const assets = new Map();
    for (const a of c.assets) {
      if (!a || assets.has(a.path) || !/^[a-f0-9]{64}$/.test(a.sha256)) throw Error('Duplicate or invalid asset');
      if (!/\.(html|css|js|json|png|jpg|jpeg|svg|webp|woff2|md)$/.test(a.path)) throw Error('Unsupported evidence asset type');
      const asset = boundedFile(root, a.path);
      if (hash(asset) !== a.sha256) throw Error('Asset hash mismatch: ' + a.path);
      assets.set(a.path, a);
    }
    const ids = new Set();
    for (const m of c.mappings) {
      if (!/^SCREEN-[A-Z0-9-]+$/.test(m.screen) || !/^STATE-[A-Z0-9-]+$/.test(m.state) || !isAcId(m.ac) || !assets.has(m.asset) || !m.asset.endsWith('.html') || typeof m.check !== 'string' || !m.check.trim()) throw Error('Invalid screen/state/AC mapping');
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
      const requiredStates = new Set(matrix.sliceStates(c.requiredMappings));
      const capturedStates = new Set(approved.captures.map(capture => `${capture.screen}/${capture.state}`));
      if ((!unitSlice && requiredStates.size !== capturedStates.size) || [...requiredStates].some(key => !capturedStates.has(key))) throw Error('Semantic snapshot screen/state coverage differs from the approved mapping denominator');
      const dispositions = c.fidelity.dispositions || [];
      if (!Array.isArray(dispositions)) throw Error('Fidelity dispositions must be an array');
      const readAsset = ref => JSON.parse(boundedFile(root, ref.path).toString('utf8'));
      const boundAsset = (ref, label) => { if (!ref || typeof ref.path !== 'string' || !assets.has(ref.path) || ref.sha256 !== assets.get(ref.path).sha256) throw Error(`Missing or unbound ${label}`); return ref; };
      if (stage === 'refined-mockups' && c.fidelity.revision !== undefined) {
        // Approved-upstream change control: a revised mockup declares the exact
        // element delta from the previously approved snapshot; the ordinary
        // approval of this revised contract is the person's confirmation.
        const previous = readAsset(boundAsset(c.fidelity.revision?.previousSnapshot, 'previous approved snapshot for the revision'));
        const revision = matrix.checkRevision({ revision: c.fidelity.revision, previous, current: approved });
        if (!revision.pass) throw Error('Artifact revision does not match the approved snapshot delta: ' + revision.findings.join('; '));
      }
      if (['functional-design','code-generation'].includes(stage)) {
        let ledger = {};
        if (dispositions.length) {
          if (!approvalLedger) throw Error('Trusted approval ledger is not configured for UI deviations');
          ledger = JSON.parse(fs.readFileSync(fs.realpathSync(approvalLedger), 'utf8'));
        }
        for (const disposition of dispositions) if (!fidelity.dispositionReceipt(disposition, ledger, fidelity.hashJson(approved))) throw Error(`UI disposition has no matching detached approval receipt: ${disposition?.elementKey || '?'}`);
      }
      if (['functional-design','code-generation','build-and-test'].includes(stage)) {
        const ruleMatrix = readAsset(boundAsset(c.fidelity.elementRuleMatrix, 'element rule matrix (fidelity.elementRuleMatrix)'));
        if (stage === 'functional-design') {
          if (!Array.isArray(c.fidelity.functionalDesign) || !c.fidelity.functionalDesign.length) throw Error('Missing Functional Design artifact copies (fidelity.functionalDesign)');
          const fdTexts = {};
          for (const ref of c.fidelity.functionalDesign) { boundAsset(ref, 'Functional Design artifact'); if (!ref.path.endsWith('.md')) throw Error('Functional Design artifact copies must be Markdown'); fdTexts[ref.path] = boundedFile(root, ref.path).toString('utf8'); }
          const ledger = dispositions.length && approvalLedger ? JSON.parse(fs.readFileSync(fs.realpathSync(approvalLedger), 'utf8')) : {};
          // A Unit's denominator is exactly its contract slice (unit + screen/state
          // pairs of its requiredMappings); the matrix records that slice.
          const slice = unitSlice ? matrix.unitSlice(engine.unit, c.requiredMappings) : undefined;
          const result = matrix.checkRuleMatrix({ matrix: ruleMatrix, approved, fdTexts, dispositions, ledger, slice });
          if (!result.pass) throw Error('Element rule matrix failed: ' + result.findings.map(f => `${f.code}${f.elementKey ? ' ' + f.elementKey : ''}`).join('; '));
        }
        if (stage === 'code-generation') {
          // The implementation handoff consumes the approved Functional Design
          // contract, not merely a matrix file: a byte-identical copy with its
          // own approval receipt, the same frozen snapshot, matrix and dispositions.
          const fdRef = boundAsset(c.fidelity.functionalDesignContract, 'approved Functional Design UI contract (fidelity.functionalDesignContract)');
          const fd = matrix.contractBlock(boundedFile(root, fdRef.path).toString('utf8'), 'Invalid Functional Design contract block');
          if (fd.stage !== 'functional-design' || fd.arm !== c.arm || fd.schema !== 2) throw Error('Functional Design contract identity differs');
          if (fd.fidelity?.approvedSnapshot?.sha256 !== c.fidelity.approvedSnapshot.sha256) throw Error('Approved semantic snapshot changed between Functional Design and implementation');
          if (fd.fidelity?.elementRuleMatrix?.sha256 !== c.fidelity.elementRuleMatrix.sha256) throw Error('Element rule matrix changed after Functional Design approval');
          if (fidelity.canonical(fd.fidelity?.dispositions || []) !== fidelity.canonical(dispositions)) throw Error('UI dispositions changed after Functional Design approval');
          if (JSON.stringify(fd.requiredMappings) !== JSON.stringify(c.requiredMappings)) throw Error('Functional Design mapping inventory differs');
          const fdPath = fs.realpathSync(path.join(root, fdRef.path));
          const inheritedFd = check({stage:'functional-design',outputPath:fdPath,approvalLedger,imageFeatures,allowLegacySchema1,engine}, new Set(seen), path.basename(fdPath), depth + 1);
          if (!inheritedFd.pass) throw Error('Invalid Functional Design evidence: ' + inheritedFd.findings.join('; '));
          requireUpstreamApproval(engine, approvalLedger, root, {sha256:fdRef.sha256,stage:'functional-design',arm:c.arm,requiredMappings:c.requiredMappings});
        }
        if (stage === 'build-and-test' && multiUnit) verifyUnitUnion({c, root, engine, approved, ruleMatrix, dispositions, approvalLedger, imageFeatures, allowLegacySchema1, seen, depth});
        if (stage === 'build-and-test') {
          const testRef = boundAsset(c.fidelity.elementTestMatrix, 'element-level Build and Test matrix (fidelity.elementTestMatrix)');
          const actual = readAsset(boundAsset(c.fidelity.actualSnapshot, 'measured implementation semantic snapshot'));
          const ledger = approvalLedger ? JSON.parse(fs.readFileSync(fs.realpathSync(approvalLedger), 'utf8')) : {};
          const result = matrix.checkTestMatrix({ matrix: readAsset(testRef), approved, actual, ruleMatrix, dispositions, ledger });
          if (!result.pass) throw Error('Element test matrix failed: ' + result.findings.map(f => `${f.code}${f.elementKey ? ' ' + f.elementKey : ''}`).join('; '));
        }
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
    const prior = {'functional-design':'refined-mockups','code-generation':'refined-mockups','build-and-test':'code-generation'}[stage];
    if (prior && !multiUnit) {
      if (!c.upstream || c.upstream.stage !== prior || !/^[a-f0-9]{64}$/.test(c.upstream.sha256)) throw Error('Missing approved upstream contract reference');
      const upstreamBytes = boundedFile(root, c.upstream.path);
      if (hash(upstreamBytes) !== c.upstream.sha256) throw Error('Upstream contract hash mismatch');
      const parent = matrix.contractBlock(upstreamBytes.toString('utf8'), 'Invalid upstream contract block');
      if (![1,2].includes(parent.schema) || parent.schema !== c.schema || parent.stage !== prior || parent.arm !== c.arm || !Array.isArray(parent.requiredMappings)) throw Error('Upstream contract identity differs');
      const inventoryMatches = unitSlice && prior === 'refined-mockups'
        ? c.requiredMappings.every(key => parent.requiredMappings.includes(key))
        : JSON.stringify(parent.requiredMappings) === JSON.stringify(c.requiredMappings);
      if (!inventoryMatches) throw Error(unitSlice ? `Unit ${engine.unit} maps a screen/state/AC the upstream contract does not` : 'Upstream contract inventory differs');
      if (c.schema === 2) {
        if (parent.fidelity?.approvedSnapshot?.sha256 !== c.fidelity?.approvedSnapshot?.sha256) throw Error('Approved semantic snapshot changed across the handoff');
        if (stage === 'build-and-test' && fidelity.canonical(parent.fidelity?.dispositions || []) !== fidelity.canonical(c.fidelity?.dispositions || [])) throw Error('Approved UI dispositions changed after code-generation approval');
        if (stage === 'build-and-test' && parent.fidelity?.elementRuleMatrix?.sha256 !== c.fidelity?.elementRuleMatrix?.sha256) throw Error('Element rule matrix changed after code-generation approval');
      }
      const upstreamPath = fs.realpathSync(path.join(root, c.upstream.path));
      const inherited = check({stage:prior,outputPath:upstreamPath,approvalLedger,imageFeatures,allowLegacySchema1,engine}, new Set(seen), path.basename(upstreamPath), depth + 1);
      if (!inherited.pass) throw Error('Invalid upstream evidence: ' + inherited.findings.join('; '));
      requireUpstreamApproval(engine, approvalLedger, root, {sha256:c.upstream.sha256,stage:prior,arm:c.arm,requiredMappings:parent.requiredMappings});
    }
  } catch (e) { findings.push(e.message); }
  return {pass: findings.length === 0, findings_count: findings.length, findings};
}
/**
 * Multi-Unit Build and Test: every listed Unit implementation contract is a
 * byte-identical, approved copy whose own chain (Unit-scoped Functional Design
 * -> implementation) is re-validated as that Unit; the Unit matrices' union
 * (unionRuleMatrix, the one coverage owner) must give every approved element
 * that requires a rule an owner, and this contract must carry exactly that
 * union matrix and its merged dispositions.
 */
function verifyUnitUnion({c, root, engine, approved, ruleMatrix, dispositions, approvalLedger, imageFeatures, allowLegacySchema1, seen, depth}) {
  if (c.upstream !== undefined) throw Error('Build and Test names either one upstream code-generation contract (upstream) or every Unit implementation contract (fidelity.unitContracts), not both');
  if (engine.unit !== null) throw Error('Multi-Unit Build and Test runs once per Intent, not inside a Unit');
  const refs = c.fidelity.unitContracts;
  if (!Array.isArray(refs) || !refs.length) throw Error('fidelity.unitContracts must list every Unit implementation contract');
  const listed = new Map(c.assets.map(a => [a.path, a]));
  const entries = [], refinedShas = new Set();
  let refinedInventory = null;
  for (const ref of refs) {
    if (!ref || typeof ref.path !== 'string' || !listed.has(ref.path) || listed.get(ref.path).sha256 !== ref.sha256 || !ref.path.endsWith('.md')) throw Error('Missing or unbound Unit implementation contract (fidelity.unitContracts)');
    const unitPath = fs.realpathSync(path.join(root, ref.path)), unitRoot = path.dirname(unitPath);
    const u = matrix.contractBlock(boundedFile(root, ref.path).toString('utf8'), 'Invalid Unit implementation contract block');
    if (u.stage !== 'code-generation' || u.schema !== 2 || u.arm !== c.arm) throw Error('Unit implementation contract identity differs: ' + ref.path);
    if (u.fidelity?.approvedSnapshot?.sha256 !== c.fidelity.approvedSnapshot.sha256) throw Error('Approved semantic snapshot changed across the Unit handoff: ' + ref.path);
    const matrixBytes = boundedFile(unitRoot, u.fidelity?.elementRuleMatrix?.path);
    if (hash(matrixBytes) !== u.fidelity.elementRuleMatrix.sha256) throw Error('Unit element rule matrix hash mismatch: ' + ref.path);
    const unitMatrix = JSON.parse(matrixBytes.toString('utf8'));
    if (!matrix.validSlice(unitMatrix.slice)) throw Error(`Unit implementation contract ${ref.path} carries no Unit-scoped element rule matrix`);
    const unitEngine = {...engine, unit:unitMatrix.slice.unit};
    const inherited = check({stage:'code-generation',outputPath:unitPath,approvalLedger,imageFeatures,allowLegacySchema1,engine:unitEngine}, new Set(seen), path.basename(unitPath), depth + 1);
    if (!inherited.pass) throw Error(`Invalid Unit ${unitEngine.unit} implementation evidence: ` + inherited.findings.join('; '));
    requireUpstreamApproval(unitEngine, approvalLedger, root, {sha256:ref.sha256,stage:'code-generation',arm:c.arm,requiredMappings:u.requiredMappings});
    refinedShas.add(u.upstream?.sha256);
    refinedInventory ??= matrix.contractBlock(boundedFile(unitRoot, u.upstream.path).toString('utf8'), 'Invalid upstream contract block').requiredMappings;
    entries.push({matrix:unitMatrix, dispositions:u.fidelity.dispositions || []});
  }
  if (refinedShas.size !== 1) throw Error('Unit implementation contracts name different refined contracts');
  if (JSON.stringify(refinedInventory) !== JSON.stringify(c.requiredMappings)) throw Error('Build and Test inventory differs from the approved refined inventory');
  const union = matrix.unionRuleMatrix({approved, units:entries});
  if (!union.pass) throw Error('Intent-level element coverage failed: ' + union.findings.map(f => `${f.code}${f.elementKey ? ' ' + f.elementKey : ''}${f.code === 'ELEMENT_NO_OWNER' || f.code === 'ELEMENT_OWNER_CONFLICT' ? '' : ' (' + f.detail + ')'}`).join('; '));
  if (fidelity.canonical(ruleMatrix) !== fidelity.canonical(union.matrix)) throw Error('Build and Test element rule matrix is not the union of the approved Unit matrices; regenerate it with rule-matrix union');
  if (fidelity.canonical(dispositions) !== fidelity.canonical(union.dispositions)) throw Error('Build and Test dispositions differ from the union of the approved Unit dispositions');
}
/** One owner for "this upstream contract carries the person's recorded approval". */
function requireUpstreamApproval(engine, approvalLedger, root, approval) {
  if (engine.policy.upstreamApproval === 'engine-record') requireEngineRecord(engine, approval);
  else requireApproval(approvalLedger, root, approval);
}
/**
 * In an engine-record scope the official stage gate owns approval, so the
 * upstream copy must be byte-identical to the contract the engine record holds
 * for that stage: refined mockups at the intent level, Construction stages in
 * this Unit's directory.
 */
function requireEngineRecord(engine, {sha256, stage}) {
  if (!engine.recordRoot) throw Error('Upstream approval needs an engine record, and the stage output is not inside one');
  const name = contracts[stage];
  const candidates = stage === 'refined-mockups'
    ? fs.readdirSync(engine.recordRoot, {withFileTypes:true}).filter(entry => entry.isDirectory()).map(entry => path.join(engine.recordRoot, entry.name, stage, name))
    : [path.join(engine.recordRoot, 'construction', ...(engine.unit === null ? [] : [engine.unit]), stage, name)];
  const found = candidates.filter(file => fs.existsSync(file));
  if (found.length !== 1) throw Error(`Engine record holds ${found.length ? 'more than one' : 'no'} approved ${stage} contract (${name})`);
  if (hash(fs.readFileSync(found[0])) !== sha256) throw Error(`Upstream ${stage} contract copy differs from the engine record artifact ${path.relative(engine.recordRoot, found[0])}`);
}
function requireApproval(approvalLedger, root, {sha256, stage, arm, requiredMappings}) {
  if (!approvalLedger) throw Error('Trusted approval ledger is not configured');
  const ledgerReal = fs.realpathSync(approvalLedger), rootReal = fs.realpathSync(root);
  if (ledgerReal === rootReal || ledgerReal.startsWith(rootReal + path.sep)) throw Error('Approval ledger must be detached from evidence directory');
  const ledger = JSON.parse(fs.readFileSync(ledgerReal, 'utf8'));
  const approved = ledger.approvals?.find(a => a.contractSha256 === sha256 && a.stage === stage && a.arm === arm && a.status === 'approved' && typeof a.source === 'string' && a.source.trim() && typeof a.reviewer === 'string' && a.reviewer.trim());
  if (!approved) throw Error(stage === 'functional-design' ? 'Functional Design contract has no matching explicit approval receipt' : 'Upstream contract has no matching explicit approval receipt');
  if (JSON.stringify(approved.requiredMappings) !== JSON.stringify(requiredMappings)) throw Error('Approved mapping inventory differs');
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
module.exports = {check, hash, contracts, scopePolicy, engineFor, main, isAcId};
