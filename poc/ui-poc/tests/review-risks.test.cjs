'use strict';
// Review-finding decisions at the mockup gates and their Build and Test handoff
// (tools/ui-poc-review-risks.cjs) plus the identical-state-image check, over a
// synthetic engine record: state file, audit shard, review record, gate-words.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const risks = require('../tools/ui-poc-review-risks.cjs');
const {check, hash} = require('../tools/ui-poc-evidence.cjs');

const TOOL = path.resolve(__dirname, '../tools/ui-poc-review-risks.cjs');
const ORIGINAL_CWD = process.cwd();
const SESSION = '26d6b6ac-3c4d-41c2-821c-e67a5e0974d4';
const [FIX_ALL, EACH, ACCEPT_ALL] = risks.REVIEW_FINDINGS_OPTIONS;
const R01 = {id: 'R-01', severity: 'Major', location: 'mockups.md > home', finding: 'The uninspected count has no target screen', required_action: 'Add the state and map it', status: 'New'};
const R02 = {id: 'R-02', severity: 'Major', location: 'ui-poc-refined-contract.md > AC1.4.4', finding: 'photo-attached PNG is byte-identical to from-ng', required_action: 'Capture the photo field', status: 'New'};
const R03 = {id: 'R-03', severity: 'Minor', location: 'accessibility-checklist.md > #6', finding: 'Only 375px was rendered', required_action: 'Render 360 and 430 too', status: 'New'};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const render = c => `# Synthetic fixture, not workflow evidence\n\n## Artifact References\n\n## Screen State Acceptance Mapping\n\n## Approval Evidence\n\n## Testing Brief\n\n\`\`\`ui-poc-contract\n${JSON.stringify(c)}\n\`\`\`\n`;

/** A synthetic engine record with one mockup stage, its contract, audit shard, and the hooks' gate-words file. */
function project(t, {stage = 'refined-mockups'} = {}) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ui-poc-risks-')));
  process.chdir(temp);
  t.after(() => process.chdir(ORIGINAL_CWD));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  const record = path.join(temp, 'aidlc', 'intents', 'x');
  const stageDir = path.join(record, stage === 'rough-mockups' ? 'ideation' : 'inception', stage);
  fs.mkdirSync(stageDir, {recursive: true});
  fs.writeFileSync(path.join(record, 'aidlc-state.md'), '# State\n\n- **Scope**: ui-poc-application\n');
  const html = Buffer.from('<main data-ui-screen="SCREEN-HOME" data-ui-state="STATE-READY">Ready</main>');
  fs.writeFileSync(path.join(stageDir, 'screen.html'), html);
  const ac = stage === 'rough-mockups' ? 'AC-001' : 'AC1.1.1';
  const contractName = stage === 'rough-mockups' ? 'ui-poc-rough-contract.md' : 'ui-poc-refined-contract.md';
  const outputPath = path.join(stageDir, contractName);
  const capture = (state, extra = {}) => ({screen: 'SCREEN-HOME', state, rendered: true, elements: [{key: `AUTO-${state}`, explicitId: false, kind: 'text', text: state}], ...extra});
  /** Writes the snapshot and a contract whose mapping denominator is exactly its captures. */
  const writeContract = ({captures = [capture('STATE-READY')], extraAssets = []} = {}) => {
    const snapshot = {schema: 1, kind: 'ui-semantic-snapshot', source: {path: 'screen.html', sha256: hash(html)}, captures};
    fs.writeFileSync(path.join(stageDir, 'snapshot.json'), JSON.stringify(snapshot));
    const snap = {path: 'snapshot.json', sha256: hash(fs.readFileSync(path.join(stageDir, 'snapshot.json')))};
    const mappings = captures.map(x => ({screen: x.screen, state: x.state, ac, asset: 'screen.html', check: `${x.state} text`}));
    const c = {schema: 2, stage, arm: 'C', assets: [{path: 'screen.html', sha256: hash(html)}, snap, ...extraAssets], mappings, requiredMappings: mappings.map(m => `${m.screen}/${m.state}/${m.ac}`), fidelity: {approvedSnapshot: snap, dispositions: []}};
    fs.writeFileSync(outputPath, render(c));
    return c;
  };
  writeContract();
  const shardFile = path.join(record, 'audit', 'shard.md');
  fs.mkdirSync(path.dirname(shardFile), {recursive: true});
  fs.writeFileSync(shardFile, '# Audit\n');
  let tick = 0;
  const row = (event, fields = {}) => {
    const at = `2026-10-18T13:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}Z`; tick++;
    fs.appendFileSync(shardFile, [`\n---\n\n## ${event}`, `**Timestamp**: ${at}`, `**Event**: ${event}`, ...Object.entries(fields).map(([k, v]) => `**${k}**: ${v}`), ''].join('\n'));
    return at;
  };
  const review = (findings, {iteration = 1, attempt = '6834fedc9f146fb4', verdict = 'READY'} = {}) => {
    const rel = `.aidlc-engine/reviews/${stage}/stage/${attempt}/${iteration}.json`;
    const file = path.join(record, rel); fs.mkdirSync(path.dirname(file), {recursive: true});
    const bytes = Buffer.from(`${JSON.stringify({version: 1, stage, unit: null, workflow: null, attempt, iteration, reviewer: 'aidlc-product-lead-agent', verdict, request_id: 'review:c220f487', request_challenge: null, artifact_fingerprint: `sha256:${'0'.repeat(64)}`, source_fingerprint: null, unit_source_fingerprint: null, findings, derived_findings: findings.map(f => ({...f, introduced_in_review: true})), body: '# Review', recorded_at: '2026-10-18T13:32:38Z'}, null, 2)}\n`);
    fs.writeFileSync(file, bytes);
    const digest = `sha256:${sha(bytes)}`;
    row('REVIEW_COMPLETED', {Stage: stage, Reviewer: 'aidlc-product-lead-agent', Iteration: iteration, Verdict: verdict, 'Review Record': rel, 'Review Record Digest': digest});
    return {path: rel, digest};
  };
  // The person typed `text`: a HUMAN_TURN row, then the hooks' gate-words entry kept under the shard size.
  const humanTurn = text => {
    row('HUMAN_TURN', {Session: SESSION});
    const dir = path.join(record, '.aidlc-engine', 'gate-words'); fs.mkdirSync(dir, {recursive: true});
    const file = path.join(dir, `${SESSION}.json`);
    const words = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {version: 1, session: SESSION, shard: path.relative(temp, shardFile).split(path.sep).join('/'), dropped: 0, messages: []};
    words.messages.push({offset: fs.statSync(shardFile).size, text});
    fs.writeFileSync(file, JSON.stringify(words));
  };
  const ask = () => row('DECISION_RECORDED', {Stage: stage, Decision: risks.REVIEW_FINDINGS_DECISION, Options: risks.REVIEW_FINDINGS_OPTIONS.join(',')});
  const answer = choice => row('QUESTION_ANSWERED', {Stage: stage, Details: choice});
  const approve = dispositions => row('GATE_APPROVED', {Stage: stage, 'User Input': 'Approve', 'Person Reply': 'Approve', 'Review Finding Dispositions': JSON.stringify({version: 1, dispositions})});
  const accepted = (ids, reviewed, severity = id => id === 'R-03' ? 'Minor' : 'Major') => ids.map(id => ({artifact: 'mockups.md', id, fingerprint: `sha256:${'1'.repeat(64)}`, status: 'Accepted risk', decided_at_severity: severity(id), reviewed_record: reviewed}));
  const decide = options => risks.decide({outputPath, stage, ...options});
  const ledger = () => JSON.parse(fs.readFileSync(path.join(stageDir, risks.DECISIONS_FILE), 'utf8'));
  const run = () => check({stage, outputPath});
  return {temp, record, stageDir, outputPath, contractName, capture, writeContract, row, review, humanTurn, ask, answer, approve, accepted, decide, ledger, run};
}
const text = result => result.findings.join('\n');

test('an open Major finding without the person\'s decision holds the gate; Minor-only or no review does not', t => {
  const p = project(t);
  assert.equal(p.run().pass, true, 'no review recorded yet');
  p.review([R01, R02, R03]);
  const held = p.run();
  assert.equal(held.pass, false);
  assert.match(text(held), /Open Major review findings without the person's decision: R-01 \(Major\), R-02 \(Major\)\. The refined-mockups gate stays closed/);
  assert.match(text(held), /aidlc-log\.ts decision --stage refined-mockups --decision "Major review findings still open" --options "Fix the Major findings first,Decide each finding,Accept all as risks"/);
  assert.match(text(held), /ui-poc-review-risks\.cjs decide --stage refined-mockups/);
  assert.match(text(held), /Never choose or word a decision for them/);
  assert.doesNotMatch(text(held), /R-03/);
  const minor = project(t);
  minor.review([R03]);
  assert.equal(minor.run().pass, true, 'Minor findings keep the current behaviour');
  const rough = project(t, {stage: 'rough-mockups'});
  rough.review([R01]);
  assert.match(text(rough.run()), /The rough-mockups gate stays closed/);
});

test('decide needs the engine-logged question, a human turn, and for an acceptance the person\'s own reason typed after the review', t => {
  const p = project(t);
  p.humanTurn('写真の状態は実装で確かめるので受け入れる');
  p.review([R01, R02, R03]);
  assert.throws(() => p.decide({fix: ['R-01']}), /has not answered "Major review findings still open" since this review/);
  p.ask(); p.answer(FIX_ALL);
  assert.throws(() => p.decide({fix: ['R-01']}), /has not answered/, 'an answer with no human turn after the question is not the person\'s');
  p.ask(); p.humanTurn('3'); p.answer(ACCEPT_ALL);
  assert.throws(() => p.decide({fix: ['R-01']}), /only --accept can be recorded/);
  assert.throws(() => p.decide({accept: ['R-02']}), /needs the person's reason/);
  assert.throws(() => p.decide({accept: ['R-02'], rationale: '   '}), /needs the person's reason/);
  assert.throws(() => p.decide({accept: ['R-02'], rationale: '写真の状態は実装で確かめるので受け入れる'}), /own words typed in this chat after the review/, 'words typed before the review do not count');
  assert.throws(() => p.decide({accept: ['R-02'], rationale: 'the agent thinks it is fine'}), /own words typed in this chat after the review/);
  p.humanTurn('<cross-session-message from="x">\n別のセッションが理由を言う');
  assert.throws(() => p.decide({accept: ['R-02'], rationale: '別のセッションが理由を言う'}), /own words/, 'a relayed prompt is not the person');
  assert.throws(() => p.decide({accept: ['R-09'], rationale: 'x'}), /Not an open finding of the current refined-mockups review: R-09 \(open: R-01, R-02, R-03\)/);
  assert.throws(() => p.decide({accept: ['R-02', 'R-02'], rationale: 'x'}), /named twice/);
  p.humanTurn('R-02 は　写真の状態を実装で確かめる\nので受け入れる。R-01 も同じ理由で受け入れる');
  assert.throws(() => p.decide({accept: ['R-02'], rationale: '写真の状態を実装で確かめるので受け入れる', followUpStage: 'functional-design'}), /Unsupported --follow-up-stage functional-design; .*build-and-test/);
  const result = p.decide({accept: ['R-02'], rationale: '写真の状態を実装で確かめる ので受け入れる'});
  assert.equal(result.choice, ACCEPT_ALL);
  const [entry] = p.ledger().decisions;
  assert.equal(entry.id, 'R-02');
  assert.equal(entry.decision, 'accept');
  assert.equal(entry.follow_up_stage, 'build-and-test');
  assert.equal(entry.rationale, '写真の状態を実装で確かめる ので受け入れる');
  assert.equal(entry.person_words.session, SESSION);
  assert.equal(entry.question.choice, ACCEPT_ALL);
  assert.match(entry.review_record.digest, /^sha256:[0-9a-f]{64}$/);
  const still = p.run();
  assert.match(text(still), /decision: R-01 \(Major\)\./, 'the undecided finding alone keeps the gate closed');
  assert.doesNotMatch(text(still), /R-02 \(Major\)/);
  p.decide({accept: ['R-01'], rationale: '同じ理由で受け入れる'});
  assert.equal(p.ledger().decisions.length, 2);
  assert.equal(p.run().pass, true, 'every open Major has the person\'s decision');
});

test('fix decisions open the gate, carry over while the finding is unchanged, and lapse when it is reworded', t => {
  const p = project(t);
  const first = p.review([R01, R02]);
  p.ask(); p.humanTurn('1'); p.answer(FIX_ALL);
  assert.throws(() => p.decide({fix: ['R-01'], accept: ['R-02'], rationale: '1'}), /only --fix can be recorded/);
  const result = p.decide({fix: ['R-01', 'R-02']});
  assert.equal(result.decisions.map(d => d.decision).join(','), 'fix,fix');
  assert.equal(p.ledger().decisions.every(d => d.review_record.digest === first.digest), true);
  assert.equal(p.run().pass, true);
  // The revision was reviewed again: R-01 fixed, R-02 unchanged, a new Major appeared.
  p.review([{...R01, status: 'Resolved'}, R02, {...R03, id: 'R-04', severity: 'Major'}], {iteration: 2});
  const again = p.run();
  assert.match(text(again), /decision: R-04 \(Major\)\./);
  assert.doesNotMatch(text(again), /R-02/);
  // Reworded (regraded) finding: the earlier decision no longer applies.
  p.review([{...R02, finding: 'photo-attached PNG shows no photo field at all'}], {iteration: 3});
  assert.match(text(p.run()), /decision: R-02 \(Major\)\./);
  // Decide each finding: a mix in one call.
  p.ask(); p.humanTurn('2'); p.answer(EACH);
  p.humanTurn('R-02 は受け入れる。写真欄は実装で確認する');
  p.review([{...R02, finding: 'photo-attached PNG shows no photo field at all'}, R01], {iteration: 4});
  p.ask(); p.humanTurn('2'); p.answer(EACH); p.humanTurn('R-02 は受け入れる。写真欄は実装で確認する。R-01 は直す');
  const mixed = p.decide({fix: ['R-01'], accept: ['R-02'], rationale: '写真欄は実装で確認する'});
  assert.deepEqual(mixed.decisions.map(d => [d.id, d.decision]), [['R-01', 'fix'], ['R-02', 'accept']]);
  assert.equal(p.run().pass, true);
});

test('Build and Test requires every accepted Major as a check item with a result and the person\'s recorded reason', t => {
  const p = project(t);
  const reviewed = p.review([R01, R02, R03]);
  p.approve(p.accepted(['R-01', 'R-02', 'R-03'], reviewed));
  const items = risks.handoffItems(p.record);
  assert.deepEqual(items.map(i => [i.stage, i.id, i.severity, i.rationale, i.followUpStage]), [['refined-mockups', 'R-01', 'Major', null, 'build-and-test'], ['refined-mockups', 'R-02', 'Major', null, 'build-and-test']]);
  assert.equal(items[1].finding, R02.finding);
  const none = risks.handoffFindings({recordRoot: p.record, contract: {fidelity: {}}});
  assert.match(none.join('\n'), /Accepted review risk refined-mockups R-01 \(Major\) has no reason recorded from the person/);
  assert.match(none.join('\n'), /refined-mockups R-02 \(Major\) is not carried into this Build and Test contract/);
  assert.doesNotMatch(none.join('\n'), /R-03/);
  assert.equal(none.length, 4);
  // The person records their reason after the gate (the override path left none).
  p.ask(); p.humanTurn('3'); p.answer(ACCEPT_ALL); p.humanTurn('両方とも次の段階で確かめるので受け入れる');
  p.decide({accept: ['R-01', 'R-02'], rationale: '次の段階で確かめるので受け入れる'});
  assert.equal(risks.handoffItems(p.record).every(i => i.rationale === '次の段階で確かめるので受け入れる'), true);
  const rows = ids => ids.map(([id, result, note]) => ({stage: 'refined-mockups', id, reviewRecordDigest: reviewed.digest, check: 'opened the state in the running app', result, ...(note ? {note} : {})}));
  const findings = contract => risks.handoffFindings({recordRoot: p.record, contract});
  assert.deepEqual(findings({fidelity: {acceptedRisks: rows([['R-01', 'pass'], ['R-02', 'pass']])}}), []);
  assert.match(findings({fidelity: {acceptedRisks: rows([['R-01', 'pass'], ['R-02', 'fail', 'photo field still hidden']])}}).join('\n'), /R-02 \(Major\) failed its Build and Test check: photo field still hidden/);
  assert.match(findings({fidelity: {acceptedRisks: rows([['R-01', 'unverified'], ['R-02', 'pass']])}}).join('\n'), /R-01 \(Major\) is unverified without a note/);
  assert.deepEqual(findings({fidelity: {acceptedRisks: rows([['R-01', 'unverified', 'no device'], ['R-02', 'pass']])}}), []);
  assert.match(findings({fidelity: {acceptedRisks: [...rows([['R-01', 'pass'], ['R-02', 'pass']]), {stage: 'refined-mockups', id: 'R-09', reviewRecordDigest: reviewed.digest, check: 'x', result: 'pass'}]}}).join('\n'), /names refined-mockups R-09, which the engine never recorded as an accepted risk/);
  assert.match(findings({fidelity: {acceptedRisks: [{...rows([['R-01', 'pass']])[0], check: ' '}, ...rows([['R-02', 'pass']])]}}).join('\n'), /R-01 \(Major\) has no check/);
  assert.match(findings({fidelity: {acceptedRisks: [{...rows([['R-01', 'pass']])[0], reviewRecordDigest: `sha256:${'2'.repeat(64)}`}, ...rows([['R-02', 'pass']])]}}).join('\n'), /R-01 \(Major\) is not carried/);
  assert.match(findings({fidelity: {acceptedRisks: {}}}).join('\n'), /must be an array/);
  // Wired into the Build and Test gate check: the handoff finding appears beside the contract's own.
  const bt = path.join(p.record, 'construction', 'build-and-test'); fs.mkdirSync(bt, {recursive: true});
  const btContract = path.join(bt, 'ui-poc-test-contract.md');
  fs.writeFileSync(btContract, render({schema: 2, stage: 'build-and-test', arm: 'C', assets: [], mappings: []}));
  const gate = check({stage: 'build-and-test', outputPath: btContract});
  assert.match(text(gate), /Empty assets or mappings/);
  assert.match(text(gate), /R-02 \(Major\) is not carried into this Build and Test contract/);
});

test('a later GATE_APPROVED and an unreadable reviewed record are handled', t => {
  const p = project(t);
  const first = p.review([R01]);
  p.approve(p.accepted(['R-01'], first));
  const second = p.review([R02], {iteration: 2});
  p.approve(p.accepted(['R-02'], second));
  assert.deepEqual(risks.handoffItems(p.record).map(i => i.id), ['R-02'], 'the latest gate approval of the stage counts');
  p.approve(p.accepted(['R-05'], {path: second.path, digest: `sha256:${'f'.repeat(64)}`}));
  const [item] = risks.handoffItems(p.record);
  assert.equal(item.finding, null);
  assert.match(risks.handoffFindings({recordRoot: p.record, contract: {}}).join('\n'), /R-05 \(Major\) has no reason recorded/);
});

test('the CLI reports status, records decisions, and prints the Build and Test handoff rows', t => {
  const p = project(t);
  const reviewed = p.review([R01, R02, R03]);
  const cli = (...args) => { const r = spawnSync(process.execPath, [TOOL, ...args], {cwd: p.temp, encoding: 'utf8'}); return {status: r.status, out: JSON.parse(r.stdout || '{}'), err: r.stderr}; };
  const status = cli('status', '--stage', 'refined-mockups', '--output-path', p.outputPath);
  assert.equal(status.status, 0, status.err);
  assert.deepEqual(status.out.undecidedMajor, ['R-01', 'R-02']);
  assert.equal(status.out.review.digest, reviewed.digest);
  assert.equal(status.out.question.answer, null);
  const refused = cli('decide', '--stage', 'refined-mockups', '--output-path', p.outputPath, '--accept', 'R-02', '--rationale', 'x');
  assert.equal(refused.status, 1);
  assert.match(refused.out.error, /has not answered/);
  p.ask(); p.humanTurn('2'); p.answer(EACH); p.humanTurn('R-02 は受け入れる。実装で確認する');
  const ok = cli('decide', '--stage', 'refined-mockups', '--output-path', p.outputPath, '--fix', 'R-01', '--accept', 'R-02', '--rationale', '実装で確認する');
  assert.equal(ok.status, 0, JSON.stringify(ok.out));
  assert.equal(ok.out.decisions.length, 2);
  assert.deepEqual(cli('status', '--stage', 'refined-mockups', '--output-path', p.outputPath).out.undecidedMajor, []);
  assert.match(cli('decide', '--stage', 'refined-mockups', '--output-path', p.outputPath, '--bogus', 'x').out.error, /Unknown argument --bogus/);
  assert.match(cli('nope', '--stage', 'x', '--output-path', p.outputPath).out.error, /USAGE: ui-poc-review-risks\.cjs <status\|decide\|handoff>/);
  p.approve(p.accepted(['R-02', 'R-03'], reviewed));
  const bt = path.join(p.record, 'construction', 'build-and-test'); fs.mkdirSync(bt, {recursive: true});
  const handoff = cli('handoff', '--stage', 'build-and-test', '--output-path', path.join(bt, 'ui-poc-test-contract.md'));
  assert.equal(handoff.status, 0, handoff.err);
  assert.deepEqual(handoff.out.acceptedRisks, [{stage: 'refined-mockups', id: 'R-02', severity: 'Major', reviewRecordDigest: reviewed.digest, finding: R02.finding, rationale: '実装で確認する', check: '', result: ''}]);
});
