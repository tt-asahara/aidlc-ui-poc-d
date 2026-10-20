#!/usr/bin/env node
'use strict';
// Review-finding decisions at the mockup gates, and their handoff to Build and Test.
//
// The engine records the person's gate reply and maps every finding still open
// to `Accepted risk` on its GATE_APPROVED row; it cannot ask why, and nothing
// downstream reads that row. In the dogfood-3 run the person approved refined
// mockups 70 seconds after a review with two Major findings, all six findings
// became `Accepted risk` with no reason, and no later stage heard of them.
// core/ stays byte-identical to upstream, so the plugin adds the missing part
// through its own gate sensor and a small ledger beside the stage contract:
//   - the gate stays closed while a Critical or Major finding of the current
//     review has no decision by the person (fix it, or accept it with a reason);
//   - the choice is asked as an engine-logged question (DECISION_RECORDED,
//     HUMAN_TURN, QUESTION_ANSWERED, the same shape the engine uses for its
//     blocking-sensor override), and a reason must be the person's own words
//     typed in this chat after the review, read from the engine's gate-words
//     record, which only the hooks write;
//   - what the gate finally accepted (the engine's own GATE_APPROVED
//     dispositions) is a Build and Test obligation: every accepted Critical or
//     Major finding needs a check item and a result in the test contract, with
//     the recorded reason beside it.
// This module decides nothing. It reads facts the engine wrote, records the
// person's decision, and names the next step; the engine's blocking-sensor
// override remains the one way around the hold, and it is the person's.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {engineRecord} = require('./ui-poc-c-routing.cjs');

const DECISIONS_FILE = 'ui-poc-review-decisions.json';
const REVIEW_FINDINGS_DECISION = 'Major review findings still open';
const REVIEW_FINDINGS_OPTIONS = Object.freeze(['Fix the Major findings first', 'Decide each finding', 'Accept all as risks']);
const [FIX_ALL_CHOICE, , ACCEPT_ALL_CHOICE] = REVIEW_FINDINGS_OPTIONS;
const SUPPORTED_FOLLOW_UP_STAGES = Object.freeze(['build-and-test']);
const DEFAULT_FOLLOW_UP_STAGE = 'build-and-test';
const MAJOR_SEVERITIES = new Set(['Critical', 'Major']);
const OPEN_STATUSES = new Set(['New', 'Unresolved']);
const GATE_STAGES = Object.freeze(['rough-mockups', 'refined-mockups']);
const HANDOFF_RESULTS = new Set(['pass', 'fail', 'unverified']);
const FINDING_ID = /^R-[0-9]+$/;
// Prompts another agent or the host wrapped and routed through the prompt seam
// are not the person's words.
const RELAYED_PROMPT = /^\s*<(?:cross-session-message|agent-message|side-sessions-event|task-notification|system-reminder)\b/;

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const normalize = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const toolPath = (toolsDir, projectRoot) => {
  const rel = path.relative(projectRoot, path.join(toolsDir, 'ui-poc-review-risks.cjs')).split(path.sep).join('/');
  return rel && !rel.startsWith('..') ? rel : path.join(toolsDir, 'ui-poc-review-risks.cjs');
};

function stateField(content, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.match(new RegExp(`^(?:[-*]\\s+)?\\*\\*${escaped}\\*\\*:\\s*(.+?)\\s*$`, 'm'))?.[1] ?? null;
}

/**
 * Every audit row of the record in audit order (timestamp, then shard, then
 * position), each with the byte offset where its block ends in its shard, so a
 * gate-words message (kept under the shard size at the time it arrived) can be
 * placed before or after it.
 */
function auditRows(recordRoot, projectRoot = process.cwd()) {
  const dir = path.join(recordRoot, 'audit');
  const rows = [];
  if (!fs.existsSync(dir)) return rows;
  fs.readdirSync(dir).filter(name => name.endsWith('.md')).sort().forEach((name, shard) => {
    const file = path.join(dir, name);
    const text = fs.readFileSync(file, 'utf8');
    const shardPath = path.relative(projectRoot, file).split(path.sep).join('/');
    let start = 0, position = 0, bytesBefore = 0;
    const separator = /\n---\n/g;
    const emit = (block, end) => {
      const endOffset = bytesBefore + Buffer.byteLength(text.slice(start, end));
      const field = key => stateField(block, key);
      const event = field('Event');
      if (event) rows.push({event, field, timestamp: field('Timestamp') || '', shard, shardPath, position: position++, endOffset});
      bytesBefore = endOffset;
    };
    for (let match = separator.exec(text); match; match = separator.exec(text)) {
      emit(text.slice(start, match.index), match.index);
      bytesBefore += Buffer.byteLength(match[0]);
      start = match.index + match[0].length;
    }
    emit(text.slice(start), text.length);
  });
  rows.sort((a, b) => a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.shard - b.shard || a.position - b.position);
  return rows;
}

function recordRelativeFile(recordRoot, rel, label) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\\') || rel.split('/').includes('..')) throw Error(`Unsafe ${label} path: ${rel}`);
  return path.join(recordRoot, rel);
}

function readReviewRecord(recordRoot, rel, digest, label) {
  const file = recordRelativeFile(recordRoot, rel, label);
  if (!fs.existsSync(file)) throw Error(`${label} ${rel} is missing from the engine record`);
  const bytes = fs.readFileSync(file);
  if (`sha256:${sha256(bytes)}` !== digest) throw Error(`${label} ${rel} does not match the digest the audit trail recorded`);
  const record = JSON.parse(bytes.toString('utf8'));
  if (record?.version !== 1 || !Array.isArray(record.findings)) throw Error(`${label} ${rel} is not a review record`);
  return record;
}

const rowStage = row => row.field('Stage');
const rowUnit = row => row.field('Unit') ?? null;

/** The latest REVIEW_COMPLETED of the stage (and Unit), with its digest-verified record. */
function currentReview(recordRoot, stage, unit = null, projectRoot = process.cwd()) {
  const rows = auditRows(recordRoot, projectRoot);
  const row = rows.filter(r => r.event === 'REVIEW_COMPLETED' && rowStage(r) === stage && rowUnit(r) === unit).pop();
  if (!row) return null;
  const rel = row.field('Review Record'), digest = row.field('Review Record Digest');
  if (!rel || !digest) throw Error(`REVIEW_COMPLETED for ${stage} names no review record`);
  return {row, rows, path: rel, digest, record: readReviewRecord(recordRoot, rel, digest, 'Review record')};
}

/** The findings the engine's own list still shows open: New or Unresolved, with no earlier human decision. */
function openFindings(record) {
  const list = Array.isArray(record.derived_findings) ? record.derived_findings : record.findings;
  return list.filter(f => f && OPEN_STATUSES.has(f.status) && !f.earlier_decision);
}
const findingHash = f => sha256(JSON.stringify([f.id, f.severity, f.location, f.finding, f.required_action]));
const majorOpen = record => openFindings(record).filter(f => MAJOR_SEVERITIES.has(f.severity));

function readDecisions(stageDir) {
  const file = path.join(stageDir, DECISIONS_FILE);
  if (!fs.existsSync(file)) return {version: 1, decisions: []};
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw Error(`Unreadable ${DECISIONS_FILE}: ${e.message}`); }
  if (value?.version !== 1 || !Array.isArray(value.decisions)) throw Error(`Invalid ${DECISIONS_FILE}: expected {version:1, decisions:[]}`);
  return value;
}
const decisionFor = (decisions, finding) => decisions.find(d => d && d.finding_sha256 === findingHash(finding) && d.id === finding.id) ?? null;

/** The messages the person typed in this chat after `row`, as the hooks kept them. */
function personWordsAfter(recordRoot, row) {
  const dir = path.join(recordRoot, '.aidlc-engine', 'gate-words');
  const words = [];
  if (!fs.existsSync(dir)) return words;
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    let record;
    try { record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { continue; }
    if (record?.version !== 1 || record.shard !== row.shardPath || !Array.isArray(record.messages)) continue;
    for (const message of record.messages) {
      if (Number.isSafeInteger(message?.offset) && message.offset > row.endOffset && typeof message.text === 'string' && !RELAYED_PROMPT.test(message.text)) words.push({session: record.session, offset: message.offset, text: message.text});
    }
  }
  return words;
}

/** The person's answer to the engine-logged review-findings question asked after the review, or null. */
function questionAnswer(rows, reviewRow, stage) {
  const after = rows.slice(rows.indexOf(reviewRow) + 1);
  const answerAt = after.findLastIndex(r => r.event === 'QUESTION_ANSWERED' && rowStage(r) === stage && REVIEW_FINDINGS_OPTIONS.includes(r.field('Details')));
  if (answerAt < 0) return null;
  const sameOptions = csv => (csv ?? '').split(',').map(s => s.trim()).join(',') === REVIEW_FINDINGS_OPTIONS.join(',');
  const decisionAt = after.slice(0, answerAt).findLastIndex(r => r.event === 'DECISION_RECORDED' && rowStage(r) === stage && r.field('Decision') === REVIEW_FINDINGS_DECISION && sameOptions(r.field('Options')));
  if (decisionAt < 0) return null;
  if (!after.slice(decisionAt + 1, answerAt).some(r => r.event === 'HUMAN_TURN')) return null;
  return {choice: after[answerAt].field('Details'), answeredAt: after[answerAt].timestamp};
}

const questionCommands = (stage, tools) => [
  `bun ${tools.log} decision --stage ${stage} --decision "${REVIEW_FINDINGS_DECISION}" --options "${REVIEW_FINDINGS_OPTIONS.join(',')}"`,
  `bun ${tools.log} answer --stage ${stage} --details "<the chosen label>"`,
];
function toolNames(toolsDir, projectRoot) {
  const self = toolPath(toolsDir, projectRoot);
  return {self, log: path.posix.join(path.posix.dirname(self), 'aidlc-log.ts')};
}

/**
 * Gate check for a mockup stage: every Critical or Major finding the current
 * review leaves open needs the person's recorded decision. Returns the sensor
 * findings (empty when nothing is open, or no review was recorded).
 */
function gateFindings({recordRoot, stage, unit = null, stageDir, projectRoot = process.cwd(), toolsDir = __dirname}) {
  const review = currentReview(recordRoot, stage, unit, projectRoot);
  if (!review) return [];
  const open = majorOpen(review.record);
  if (!open.length) return [];
  const decisions = readDecisions(stageDir).decisions;
  const undecided = open.filter(f => !decisionFor(decisions, f));
  if (!undecided.length) return [];
  const tools = toolNames(toolsDir, projectRoot);
  const [ask, answer] = questionCommands(stage, tools);
  const list = undecided.map(f => `${f.id} (${f.severity})`).join(', ');
  return [
    `Open Major review findings without the person's decision: ${list}. The ${stage} gate stays closed until the person decides each one. ` +
    `Ask them through the engine (${ask}; show the open findings and the three choices in that order, the first recommended; wait for their reply; ${answer}), ` +
    `then record what they decided: bun ${tools.self} decide --stage ${stage} --output-path <this stage's ui-poc contract> --fix R-NN (they want it fixed; their Request Changes at the gate reopens the artifacts) ` +
    `or --accept R-NN --rationale "<their own words>" [--follow-up-stage ${DEFAULT_FOLLOW_UP_STAGE}] (they accept the risk; the reason must be what they typed after the review), and report again. ` +
    'Never choose or word a decision for them.',
  ];
}

function stageDirOf(outputPath) {
  const resolved = path.resolve(outputPath);
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? fs.realpathSync(resolved) : fs.realpathSync(path.dirname(resolved));
}
/** The engine record of a stage output that may not exist yet (its directory must). */
function recordOf(outputPath, stage) {
  const resolved = path.resolve(outputPath);
  return engineRecord(fs.existsSync(resolved) ? resolved : path.dirname(resolved), stage);
}

/**
 * Record the person's decision on open findings of the current review:
 * `fix` (the person wants it fixed) or `accept` (the person accepts the risk,
 * with their reason, to be checked again at `followUpStage`).
 */
function decide({outputPath, stage, fix = [], accept = [], rationale, followUpStage = DEFAULT_FOLLOW_UP_STAGE, projectRoot = process.cwd(), now = new Date()}) {
  const {recordRoot, unit} = recordOf(outputPath, stage);
  const stageDir = stageDirOf(outputPath);
  const review = currentReview(recordRoot, stage, unit, projectRoot);
  if (!review) throw Error(`No review of ${stage} is recorded; there is nothing to decide`);
  const ids = [...fix, ...accept];
  if (!ids.length) throw Error('Name at least one finding: --fix R-NN or --accept R-NN');
  if (new Set(ids).size !== ids.length) throw Error('A finding is named twice');
  const open = openFindings(review.record);
  const unknown = ids.filter(id => !FINDING_ID.test(id) || !open.some(f => f.id === id));
  if (unknown.length) throw Error(`Not an open finding of the current ${stage} review: ${unknown.join(', ')} (open: ${open.map(f => f.id).join(', ') || 'none'})`);
  const answer = questionAnswer(review.rows, review.row, stage);
  if (!answer) {
    const tools = toolNames(__dirname, projectRoot);
    throw Error(`The person has not answered "${REVIEW_FINDINGS_DECISION}" since this review. Record the question first (${questionCommands(stage, tools)[0]}), show the choices, wait for their reply, record it with aidlc-log.ts answer, then run this command again.`);
  }
  if (answer.choice === FIX_ALL_CHOICE && accept.length) throw Error(`The person chose "${FIX_ALL_CHOICE}"; only --fix can be recorded under that answer`);
  if (answer.choice === ACCEPT_ALL_CHOICE && fix.length) throw Error(`The person chose "${ACCEPT_ALL_CHOICE}"; only --accept can be recorded under that answer`);
  let words = null;
  if (accept.length) {
    if (!normalize(rationale)) throw Error('Accepting a finding as a risk needs the person\'s reason: --rationale "<their own words>"');
    if (!SUPPORTED_FOLLOW_UP_STAGES.includes(followUpStage)) throw Error(`Unsupported --follow-up-stage ${followUpStage}; the accepted risk can be checked again at: ${SUPPORTED_FOLLOW_UP_STAGES.join(', ')}`);
    const wanted = normalize(rationale);
    words = personWordsAfter(recordRoot, review.row).find(message => normalize(message.text).includes(wanted)) ?? null;
    if (!words) throw Error('The reason must be the person\'s own words typed in this chat after the review; it is not among the messages the hooks kept since then. Ask the person to type their reason, then run this command again with their words verbatim.');
  }
  const ledger = readDecisions(stageDir);
  const recordedAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const entries = ids.map(id => {
    const finding = open.find(f => f.id === id);
    const accepted = accept.includes(id);
    return {
      id, severity: finding.severity, finding_sha256: findingHash(finding),
      review_record: {path: review.path, digest: review.digest},
      decision: accepted ? 'accept' : 'fix',
      ...(accepted ? {rationale: rationale.trim(), follow_up_stage: followUpStage, person_words: {session: words.session, offset: words.offset}} : {}),
      question: {decision: REVIEW_FINDINGS_DECISION, choice: answer.choice, answered_at: answer.answeredAt},
      recorded_at: recordedAt,
    };
  });
  const kept = ledger.decisions.filter(d => !entries.some(e => e.finding_sha256 === d.finding_sha256 && e.id === d.id));
  const next = {version: 1, stage, ...(unit ? {unit} : {}), decisions: [...kept, ...entries]};
  fs.writeFileSync(path.join(stageDir, DECISIONS_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return {file: path.join(stageDir, DECISIONS_FILE), choice: answer.choice, decisions: entries};
}

/** What the engine's latest GATE_APPROVED of the stage recorded as Accepted risk at Critical or Major severity. */
function acceptedAtGate(recordRoot, stage, unit = null, projectRoot = process.cwd()) {
  const rows = auditRows(recordRoot, projectRoot);
  const gate = rows.filter(r => r.event === 'GATE_APPROVED' && (r.field('Gate Stages') ?? rowStage(r) ?? '').split(',').map(s => s.trim()).includes(stage) && (unit === null || rowUnit(r) === unit)).pop();
  if (!gate) return [];
  const raw = gate.field('Review Finding Dispositions');
  if (!raw) return [];
  let envelope;
  try { envelope = JSON.parse(raw); } catch (e) { throw Error(`Unreadable Review Finding Dispositions on the ${stage} GATE_APPROVED row: ${e.message}`); }
  const dispositions = Array.isArray(envelope?.dispositions) ? envelope.dispositions : [];
  const records = new Map();
  return dispositions.filter(d => d && d.status === 'Accepted risk' && MAJOR_SEVERITIES.has(d.decided_at_severity)).map(d => {
    const ref = d.reviewed_record;
    const key = ref ? `${ref.path}\u0000${ref.digest}` : null;
    let record = null;
    if (key) {
      if (!records.has(key)) { try { records.set(key, readReviewRecord(recordRoot, ref.path, ref.digest, 'Reviewed record')); } catch { records.set(key, null); } }
      record = records.get(key);
    }
    const finding = record ? (Array.isArray(record.derived_findings) ? record.derived_findings : record.findings).find(f => f.id === d.id) ?? null : null;
    return {stage, unit, id: d.id, severity: d.decided_at_severity, approvedAt: gate.timestamp, reviewRecordDigest: ref?.digest ?? null, finding, finding_sha256: finding ? findingHash(finding) : null};
  });
}

function decisionsDirOf(recordRoot, stage) {
  for (const phase of fs.readdirSync(recordRoot, {withFileTypes: true}).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort()) {
    const dir = path.join(recordRoot, phase, stage);
    if (fs.existsSync(path.join(dir, DECISIONS_FILE))) return dir;
  }
  return null;
}

/** Every accepted Critical or Major mockup finding, with the person's recorded reason when there is one. */
function handoffItems(recordRoot, projectRoot = process.cwd()) {
  const items = [];
  for (const stage of GATE_STAGES) {
    const accepted = acceptedAtGate(recordRoot, stage, null, projectRoot);
    if (!accepted.length) continue;
    const dir = decisionsDirOf(recordRoot, stage);
    const decisions = dir ? readDecisions(dir).decisions : [];
    for (const item of accepted) {
      const decision = item.finding ? decisions.find(d => d.decision === 'accept' && d.finding_sha256 === item.finding_sha256 && d.id === item.id) ?? null : null;
      items.push({
        stage, id: item.id, severity: item.severity, reviewRecordDigest: item.reviewRecordDigest,
        finding: item.finding?.finding ?? null, requiredAction: item.finding?.required_action ?? null,
        rationale: decision?.rationale ?? null, followUpStage: decision?.follow_up_stage ?? DEFAULT_FOLLOW_UP_STAGE, approvedAt: item.approvedAt,
      });
    }
  }
  return items;
}

/** Build and Test check: each accepted Major carries a reason and a check item with a result in `fidelity.acceptedRisks`. */
function handoffFindings({recordRoot, contract, stage = 'build-and-test', projectRoot = process.cwd(), toolsDir = __dirname}) {
  const items = handoffItems(recordRoot, projectRoot).filter(item => item.followUpStage === stage);
  const rows = contract?.fidelity?.acceptedRisks;
  const listed = Array.isArray(rows) ? rows : [];
  const findings = [];
  if (rows !== undefined && !Array.isArray(rows)) findings.push('fidelity.acceptedRisks must be an array');
  const tools = toolNames(toolsDir, projectRoot);
  const name = item => `Accepted review risk ${item.stage} ${item.id} (${item.severity})`;
  for (const item of items) {
    if (!item.rationale) findings.push(`${name(item)} has no reason recorded from the person. Record their own words with bun ${tools.self} decide --stage ${item.stage} --output-path <that stage's ui-poc contract> --accept ${item.id} --rationale "<their words>" after asking them, then re-run this gate.`);
    const row = listed.find(r => r && r.stage === item.stage && r.id === item.id && (item.reviewRecordDigest === null || r.reviewRecordDigest === item.reviewRecordDigest));
    if (!row) { findings.push(`${name(item)} is not carried into this Build and Test contract. Add it to fidelity.acceptedRisks (bun ${tools.self} handoff --stage ${stage} --output-path <this contract> prints the rows) with the check you ran against the running implementation and its result.`); continue; }
    if (typeof row.check !== 'string' || !row.check.trim()) findings.push(`${name(item)} has no check in fidelity.acceptedRisks: say what was verified in the running implementation`);
    if (!HANDOFF_RESULTS.has(row.result)) findings.push(`${name(item)} has no result in fidelity.acceptedRisks (pass, fail, or unverified)`);
    else if (row.result !== 'pass' && (typeof row.note !== 'string' || !row.note.trim())) findings.push(`${name(item)} is ${row.result} without a note saying why`);
    else if (row.result === 'fail') findings.push(`${name(item)} failed its Build and Test check: ${row.note.trim()}`);
  }
  for (const row of listed) {
    if (!row || !items.some(item => item.stage === row.stage && item.id === row.id && (item.reviewRecordDigest === null || item.reviewRecordDigest === row.reviewRecordDigest))) findings.push(`fidelity.acceptedRisks names ${row?.stage ?? '?'} ${row?.id ?? '?'}, which the engine never recorded as an accepted risk`);
  }
  return findings;
}

function parseArgs(argv) {
  const out = {fix: [], accept: []};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!value?.length) throw Error(`Missing value for ${flag}`);
    if (flag === '--fix' || flag === '--accept') out[flag.slice(2)].push(value);
    else if (['--stage', '--output-path', '--rationale', '--follow-up-stage'].includes(flag)) { if (out[flag.slice(2)] !== undefined) throw Error(`Repeated ${flag}`); out[flag.slice(2)] = value; }
    else throw Error(`Unknown argument ${flag}`);
  }
  if (!out.stage || !out['output-path']) throw Error('Missing --stage <slug> or --output-path <stage deliverable>');
  return out;
}

function main(argv) {
  const [command, ...rest] = argv;
  try {
    const args = parseArgs(rest);
    const stage = args.stage, outputPath = args['output-path'];
    if (command === 'status') {
      const {recordRoot, unit} = recordOf(outputPath, stage);
      const review = currentReview(recordRoot, stage, unit);
      const decisions = readDecisions(stageDirOf(outputPath)).decisions;
      const open = review ? openFindings(review.record) : [];
      console.log(JSON.stringify({ok: true, stage, review: review ? {path: review.path, digest: review.digest, verdict: review.record.verdict, recorded_at: review.record.recorded_at} : null,
        question: {decision: REVIEW_FINDINGS_DECISION, options: REVIEW_FINDINGS_OPTIONS, answer: review ? questionAnswer(review.rows, review.row, stage) : null},
        open: open.map(f => ({id: f.id, severity: f.severity, finding: f.finding, decision: decisionFor(decisions, f)})),
        undecidedMajor: open.filter(f => MAJOR_SEVERITIES.has(f.severity) && !decisionFor(decisions, f)).map(f => f.id)}, null, 2));
      return;
    }
    if (command === 'decide') {
      const result = decide({outputPath, stage, fix: args.fix, accept: args.accept, rationale: args.rationale, followUpStage: args['follow-up-stage'] ?? DEFAULT_FOLLOW_UP_STAGE});
      console.log(JSON.stringify({ok: true, ...result}, null, 2));
      return;
    }
    if (command === 'handoff') {
      const {recordRoot} = recordOf(outputPath, stage);
      const items = handoffItems(recordRoot).filter(item => item.followUpStage === stage);
      console.log(JSON.stringify({ok: true, stage, acceptedRisks: items.map(item => ({stage: item.stage, id: item.id, severity: item.severity, reviewRecordDigest: item.reviewRecordDigest, finding: item.finding, rationale: item.rationale, check: '', result: ''}))}, null, 2));
      return;
    }
    throw Error('USAGE: ui-poc-review-risks.cjs <status|decide|handoff> --stage <slug> --output-path <stage deliverable> [--fix R-NN]... [--accept R-NN --rationale "<the person\'s words>" [--follow-up-stage build-and-test]]...');
  } catch (e) {
    console.log(JSON.stringify({ok: false, error: e.message}));
    process.exitCode = 1;
  }
}
if (require.main === module) main(process.argv.slice(2));
module.exports = {
  DECISIONS_FILE, REVIEW_FINDINGS_DECISION, REVIEW_FINDINGS_OPTIONS, SUPPORTED_FOLLOW_UP_STAGES, DEFAULT_FOLLOW_UP_STAGE, MAJOR_SEVERITIES, GATE_STAGES,
  auditRows, currentReview, openFindings, findingHash, readDecisions, personWordsAfter, questionAnswer, gateFindings, decide, acceptedAtGate, handoffItems, handoffFindings, main,
};
