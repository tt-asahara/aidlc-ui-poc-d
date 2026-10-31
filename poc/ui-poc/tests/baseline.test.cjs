'use strict';
// The design-baseline tool on a small exported screen set: the space baseline
// is adopted once, an intent copies it whole, edits bundled pages through
// unpack/pack, and verify accepts only a change list that matches the copy.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const baseline = require('../tools/ui-poc-baseline.cjs');

function page(html) {
  return `<!DOCTYPE html><html><head><script type="__bundler/manifest">{}</script></head><body><script type="__bundler/template">${baseline.encodeTemplate(html)}</script></body></html>`;
}
function world(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-poc-baseline-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const exported = path.join(root, 'export-anything');
  fs.mkdirSync(path.join(exported, '_docs'), {recursive: true});
  fs.writeFileSync(path.join(exported, '_index.html'), '<html>index</html>');
  fs.writeFileSync(path.join(exported, '_docs', 'rules.md'), '# rules\n');
  fs.writeFileSync(path.join(exported, 'Web-13-gate.html'), page('<div>gate</div><script>x()</script>'));
  fs.writeFileSync(path.join(exported, 'Flow-00-transition.html'), page('<div>flow</div>'));
  const stageDir = path.join(root, 'aidlc', 'spaces', 'default', 'intents', 'r1', 'inception', 'refined-mockups');
  fs.mkdirSync(stageDir, {recursive: true});
  return {root, exported, stageDir, args: {stageDir, name: 'ponta-pass'}};
}

test('the bundled template round-trips byte for byte, including a closing script tag', () => {
  const html = '<p>a</p><script>b()</script>\n日本語';
  const encoded = baseline.encodeTemplate(html);
  assert.ok(!encoded.includes('</'));
  assert.equal(JSON.parse(encoded), html);
});

test('adopt refuses a folder that is not an exported screen set, and never overwrites without --replace', t => {
  const w = world(t);
  fs.rmSync(path.join(w.exported, '_index.html'));
  assert.throws(() => baseline.adopt({...w.args, from: w.exported}), /no _index\.html/);
  fs.writeFileSync(path.join(w.exported, '_index.html'), '<html>index</html>');
  const adopted = baseline.adopt({...w.args, from: w.exported});
  assert.equal(adopted.action, 'adopted');
  assert.ok(fs.existsSync(path.join(w.root, 'aidlc', 'spaces', 'default', 'design-baseline', 'ponta-pass', 'Web-13-gate.html')));
  assert.throws(() => baseline.adopt({...w.args, from: w.exported}), /pass --replace/);
  assert.equal(baseline.adopt({...w.args, from: w.exported, replace: true}).action, 'replaced');
  const record = JSON.parse(fs.readFileSync(path.join(w.root, 'aidlc', 'spaces', 'default', 'design-baseline', 'ponta-pass.json'), 'utf8'));
  assert.ok(!JSON.stringify(record).includes(w.exported), 'the person\'s folder path is never recorded');
});

test('start copies the whole set into the stage, records hashes without the folder path, and keeps the copy later', t => {
  const w = world(t);
  assert.throws(() => baseline.start(w.args), /no ponta-pass baseline yet/);
  baseline.adopt({...w.args, from: w.exported});
  const started = baseline.start(w.args);
  assert.equal(started.source, 'space-baseline');
  assert.equal(started.files, 4);
  assert.ok(fs.existsSync(path.join(w.stageDir, 'ponta-pass', '_docs', 'rules.md')));
  assert.equal(baseline.start(w.args).action, 'kept');
  assert.deepEqual(baseline.diff(w.args), {added: [], modified: [], deleted: [], unchanged: 4});
});

test('start --from uses a folder for this intent only and leaves the space without a baseline', t => {
  const w = world(t);
  assert.equal(baseline.start({...w.args, from: w.exported}).source, 'intent-only-folder');
  assert.equal(baseline.status(w.args).baseline, null);
  assert.ok(!fs.readFileSync(path.join(w.stageDir, 'ponta-pass-base.json'), 'utf8').includes(w.exported));
});

test('unpack and pack edit a bundled page in place and leave nothing behind', t => {
  const w = world(t);
  baseline.start({...w.args, from: w.exported});
  const {edit} = baseline.unpack({...w.args, file: 'Web-13-gate.html'});
  const work = path.join(w.stageDir, edit);
  assert.equal(fs.readFileSync(work, 'utf8'), '<div>gate</div><script>x()</script>');
  fs.writeFileSync(work, '<div>gate premium</div><script>x()</script>');
  baseline.pack({...w.args, file: 'Web-13-gate.html'});
  assert.ok(!fs.existsSync(path.join(w.stageDir, 'ponta-pass-work')));
  assert.match(fs.readFileSync(path.join(w.stageDir, 'ponta-pass', 'Web-13-gate.html'), 'utf8'), /gate premium/);
  assert.throws(() => baseline.unpack({...w.args, file: '../escape.html'}), /inside the copy/);
});

test('verify accepts only a change list that matches the copy, with element changes and a refined page per changed screen', t => {
  const w = world(t);
  baseline.start({...w.args, from: w.exported});
  baseline.unpack({...w.args, file: 'Web-13-gate.html'});
  fs.writeFileSync(path.join(w.stageDir, 'ponta-pass-work', 'Web-13-gate.html'), '<div>premium</div>');
  baseline.pack({...w.args, file: 'Web-13-gate.html'});
  fs.copyFileSync(path.join(w.stageDir, 'ponta-pass', 'Web-13-gate.html'), path.join(w.stageDir, 'ponta-pass', 'Web-14-plan.html'));
  fs.writeFileSync(path.join(w.stageDir, 'ponta-pass', 'Flow-00-transition.html'), page('<div>flow + plan</div>'));

  let result = baseline.verify(w.args);
  assert.equal(result.pass, false);
  assert.match(result.findings.join('\n'), /ponta-pass-changes\.md is missing/);
  assert.match(result.findings.join('\n'), /ponta-pass-changes\.json is missing/);

  const changes = {
    files: {added: ['Web-14-plan.html'], modified: ['Flow-00-transition.html'], deleted: []},
    screens: [{file: 'Web-14-plan.html', status: 'added', refined: 'refined/Web-14-plan.html', elements: [{id: 'el-001', change: '新規実装', summary: 'plan'}]}],
  };
  fs.writeFileSync(path.join(w.stageDir, 'ponta-pass-changes.md'), '# changes\n');
  fs.writeFileSync(path.join(w.stageDir, 'ponta-pass-changes.json'), JSON.stringify(changes));
  result = baseline.verify(w.args);
  assert.match(result.findings.join('\n'), /modified but not declared in ponta-pass-changes\.json: Web-13-gate\.html/);
  assert.match(result.findings.join('\n'), /changed screens without an entry .*Web-13-gate\.html/);
  assert.match(result.findings.join('\n'), /Web-14-plan\.html changed but its refined contract page refined\/Web-14-plan\.html is missing/);

  changes.files.modified.push('Web-13-gate.html');
  changes.screens.push({file: 'Web-13-gate.html', status: 'modified', refined: 'refined/Web-13-gate.html', elements: [{id: 'el-005', change: '既存改修', summary: 'price'}]});
  fs.writeFileSync(path.join(w.stageDir, 'ponta-pass-changes.json'), JSON.stringify(changes));
  fs.mkdirSync(path.join(w.stageDir, 'refined'));
  for (const file of ['Web-13-gate.html', 'Web-14-plan.html']) fs.writeFileSync(path.join(w.stageDir, 'refined', file), '<html></html>');
  result = baseline.verify(w.args);
  assert.deepEqual(result.findings, []);
  assert.equal(result.pass, true);

  changes.files.deleted.push('_index.html');
  fs.writeFileSync(path.join(w.stageDir, 'ponta-pass-changes.json'), JSON.stringify(changes));
  assert.match(baseline.verify(w.args).findings.join('\n'), /declared deleted in ponta-pass-changes\.json but not deleted: _index\.html/);
});

test('the stage directory must sit inside an intent record of a space', () => {
  assert.throws(() => baseline.spaceDir('/tmp/somewhere'), /inside aidlc\/spaces\/<space>\/intents/);
  assert.equal(baseline.spaceDir('/p/aidlc/spaces/s1/intents/r/inception/refined-mockups'), '/p/aidlc/spaces/s1');
});

test('show and shot read and picture only baseline or intent-copy pages, and shot writes only into design-document/figures', t => {
  const w = world(t);
  baseline.adopt({...w.args, from: w.exported});
  const page = path.join(w.root, 'aidlc', 'spaces', 'default', 'design-baseline', 'ponta-pass', 'Web-13-gate.html');
  assert.equal(baseline.show({page}).html, '<div>gate</div><script>x()</script>');
  assert.throws(() => baseline.show({page: path.join(w.exported, 'Web-13-gate.html')}), /design baseline or an intent/);
  const figures = path.join(w.root, 'aidlc', 'spaces', 'default', 'design-document', 'figures');
  assert.throws(() => baseline.shot({page, out: path.join(w.root, 'elsewhere.png')}), /inside design-document\/figures\/ or pdm-deck\/figures/);
  assert.throws(() => baseline.shot({page, out: path.join(figures, 'a.png'), width: '50'}), /from 200 to 4000/);
  const fidelity = require('../tools/ui-poc-fidelity.cjs');
  if (!fidelity.browserExecutable()) return;
  const result = baseline.shot({page, out: path.join(figures, 'Web-13.png'), width: '400', height: '300'});
  assert.ok(result.bytes > 0);
  assert.ok(fs.existsSync(path.join(figures, 'Web-13.png')));
});
