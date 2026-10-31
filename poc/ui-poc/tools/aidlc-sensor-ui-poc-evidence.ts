// The pinned dispatcher requires aidlc-sensor-<id>.ts and invokes it with its runtime.
// This adapter intentionally has no upstream imports or third-party dependencies.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { check, contracts, engineFor } = require('./ui-poc-evidence.cjs');
const { verify, harnessDirOf } = require('./ui-poc-c-routing.cjs');
const harnessDir = harnessDirOf(dirname(fileURLToPath(import.meta.url)));

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--stage','--output-path'].includes(argv[i]) || !argv[i + 1] || out[argv[i]]) throw Error('Invalid arguments');
    out[argv[i]] = argv[i + 1];
  }
  return out;
}
function baselineFindings(stageDir) {
  const baseline = require('./ui-poc-baseline.cjs'), out = [];
  for (const name of readdirSync(stageDir).filter(file => file.endsWith('-base.json'))) {
    let record;
    try { record = JSON.parse(readFileSync(join(stageDir, name), 'utf8')); } catch { continue; }
    if (record?.kind !== 'ui-poc-baseline-copy') continue;
    const result = baseline.verify({stageDir, name: record.name});
    if (!result.pass) out.push(...result.findings.map(finding => `${record.name} baseline: ${finding}`));
  }
  return out;
}

async function main(argv) {
  const findings = [];
  try {
    const parsed = args(argv), stage = parsed['--stage'], outputPath = parsed['--output-path'];
    if (!stage || !outputPath) throw Error('Invalid arguments');
    const root = dirname(resolve(outputPath));
    // tools/ui-poc/scope-evidence.json can declare this sensor off for a scope.
    const engine = engineFor(outputPath, stage);
    if (engine.policy.sensor === 'off') {
      console.log(JSON.stringify({pass:true,findings_count:0,findings:[],notApplicable:`UI evidence is off for scope ${engine.scope}`}));
      return;
    }
    if (Object.hasOwn(contracts, stage)) {
      let imageFeatures = {};
      const configModule = resolve(dirname(fileURLToPath(import.meta.url)), 'd-acceleration', 'd-config.ts');
      if (existsSync(configModule)) imageFeatures = (await import(pathToFileURL(configModule).href)).resolveDFeatureFlags(process.cwd());
      else if (['d-acceleration.json', 'd-acceleration.jsonc', 'd-acceleration.local.json', 'd-acceleration.local.jsonc'].some(name => existsSync(resolve(process.cwd(), harnessDir, name)))) {
        // A D configuration exists but its resolver is not installed: image
        // settings cannot be read, so fail closed instead of silently treating
        // mockupPngGeneration/visualRegression as OFF.
        throw Error('D configuration is present but the D config resolver is not installed beside this sensor; PNG/visual settings cannot be resolved');
      }
      const evidence = check({stage, outputPath, approvalLedger:process.env.UI_POC_APPROVAL_LEDGER,imageFeatures,engine,allowLegacySchema1:process.env.UI_POC_SCHEMA1_MIGRATION === '1'});
      findings.push(...evidence.findings);
    }
    const factsPath = resolve(root, 'ui-poc-routing-facts.json');
    let facts = {};
    try { facts = JSON.parse(require('node:fs').readFileSync(factsPath, 'utf8')); }
    catch (e) {
      // Stages with no routing rules need neither facts nor a skill log.
      const empty = require('./ui-poc-c-routing.cjs').plan(stage, {}, require('./ui-poc-c-routing.cjs').deriveEngineContext(outputPath, stage).scope);
      if (!empty.pass || empty.invocations.length) findings.push(`Unreadable routing facts: ${e.message}`);
    }
    const routing = verify(stage, resolve(root, 'ui-poc-skill-evidence.json'), facts, {contextPath:resolve(root, 'ui-poc-routing-context.json'),factsPath,outputPath});
    if (!routing.pass) findings.push(...routing.findings);
    // A design-baseline copy started in this stage must declare every change.
    if (stage === 'refined-mockups') findings.push(...baselineFindings(root));
  } catch (e) { findings.push(e.message); }
  console.log(JSON.stringify({pass:findings.length === 0,findings_count:findings.length,findings}));
}
await main(process.argv.slice(2));
