// The pinned dispatcher requires aidlc-sensor-<id>.ts and invokes it with its runtime.
// This adapter intentionally has no upstream imports or third-party dependencies.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { check, contracts } = require('./ui-poc-evidence.cjs');
const { verify } = require('./ui-poc-c-routing.cjs');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--stage','--output-path'].includes(argv[i]) || !argv[i + 1] || out[argv[i]]) throw Error('Invalid arguments');
    out[argv[i]] = argv[i + 1];
  }
  return out;
}
function main(argv) {
  const findings = [];
  try {
    const parsed = args(argv), stage = parsed['--stage'], outputPath = parsed['--output-path'];
    if (!stage || !outputPath) throw Error('Invalid arguments');
    const root = dirname(resolve(outputPath));
    if (Object.hasOwn(contracts, stage)) {
      const evidence = check({stage, outputPath, approvalLedger:process.env.UI_POC_APPROVAL_LEDGER});
      findings.push(...evidence.findings);
    }
    const factsPath = resolve(root, 'ui-poc-routing-facts.json');
    let facts = {};
    try { facts = JSON.parse(require('node:fs').readFileSync(factsPath, 'utf8')); }
    catch (e) {
      // Stages with no routing rules need neither facts nor a skill log.
      const empty = require('./ui-poc-c-routing.cjs').plan(stage, {});
      if (!empty.pass || empty.invocations.length) findings.push(`Unreadable routing facts: ${e.message}`);
    }
    const routing = verify(stage, resolve(root, 'ui-poc-skill-evidence.json'), facts, {contextPath:resolve(root, 'ui-poc-routing-context.json'),factsPath,outputPath});
    if (!routing.pass) findings.push(...routing.findings);
  } catch (e) { findings.push(e.message); }
  console.log(JSON.stringify({pass:findings.length === 0,findings_count:findings.length,findings}));
}
main(process.argv.slice(2));
