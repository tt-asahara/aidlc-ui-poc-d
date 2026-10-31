'use strict';
// A design baseline for refined-mockups: an existing product's exported screen
// set (one folder of bundled HTML pages) that an intent copies whole into its
// refined-mockups record, changes there, and declares every change of.
//
//   adopt  --stage-dir <dir> --name <n> --from <folder> [--replace]
//            copy a person's folder into the space's design-baseline/<n>/
//   start  --stage-dir <dir> --name <n> [--from <folder>]
//            copy the space baseline (or, for this intent only, a folder)
//            into <stage>/<n>/ and record every file's hash in <n>-base.json
//   status --stage-dir <dir> --name <n>       what exists, as JSON
//   unpack --stage-dir <dir> --name <n> --file <rel>
//            write the page's HTML to <stage>/<n>-work/<rel> for editing
//   pack   --stage-dir <dir> --name <n> --file <rel>
//            put that edited HTML back into <stage>/<n>/<rel> and remove it
//   diff   --stage-dir <dir> --name <n>       added/modified/deleted vs base
//   verify --stage-dir <dir> --name <n>       the declared changes match diff
//
// Tools for determinism: every decision is a path, hash, or set comparison.
// The person's folder path is read once and never recorded; the records name
// only where the copy came from (space baseline or intent-only) and its hash.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const routingConfig = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'ui-poc', 'c-stage-routing.json'), 'utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const posix = rel => rel.split(path.sep).join('/');

/** The baseline format a design-skill choice declares, by baseline name. */
function baselineSpec(name) {
  for (const choice of Object.values(routingConfig().designSkillChoices || {})) {
    if (choice.baseline?.name === name) return choice.baseline;
  }
  throw Error(`no design-skill choice declares a baseline named ${name}`);
}

function files(root) {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw Error(`symbolic link in the screen set: ${posix(path.relative(root, full))}`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name !== '.DS_Store') out.push(posix(path.relative(root, full)));
    }
  };
  walk(root);
  return out;
}
function hashes(root) {
  return Object.fromEntries(files(root).map(rel => [rel, sha256(fs.readFileSync(path.join(root, rel)))]));
}
const treeSha = map => sha256(Object.entries(map).map(([rel, hash]) => `${rel}\0${hash}\n`).join(''));

/** Refuses a folder that is not in the declared screen-set format. */
function checkFormat(folder, spec) {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw Error('the folder does not exist or is not a folder');
  for (const required of spec.required || []) if (!fs.existsSync(path.join(folder, required))) throw Error(`the folder has no ${required}, so it is not an exported screen set`);
  const screens = fs.readdirSync(folder).filter(name => new RegExp(spec.screenPattern).test(name));
  if (!screens.length) throw Error('the folder has no screen pages (for example And-04-home.html)');
  return screens.length;
}

/** <prefix>/spaces/<space> from a refined-mockups stage directory inside an intent record. */
function spaceDir(stageDir) {
  const parts = path.resolve(stageDir).split(path.sep), at = parts.lastIndexOf('spaces');
  if (at < 0 || at + 2 > parts.length - 1 || !parts.includes('intents')) throw Error('--stage-dir must be a stage directory inside aidlc/spaces/<space>/intents/<record>/');
  return parts.slice(0, at + 2).join(path.sep);
}
function paths(stageDir, name) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name || '')) throw Error('--name must be a lowercase baseline name');
  const stage = path.resolve(stageDir), space = spaceDir(stage);
  return {
    stage, baseline: path.join(space, 'design-baseline', name), baselineRecord: path.join(space, 'design-baseline', `${name}.json`),
    copy: path.join(stage, name), base: path.join(stage, `${name}-base.json`), work: path.join(stage, `${name}-work`),
    changes: path.join(stage, `${name}-changes.json`), changesMd: path.join(stage, `${name}-changes.md`), refined: path.join(stage, 'refined'),
  };
}

function copyTree(from, to) {
  for (const rel of files(from)) {
    fs.mkdirSync(path.dirname(path.join(to, rel)), {recursive: true});
    fs.copyFileSync(path.join(from, rel), path.join(to, rel));
  }
}

function adopt({stageDir, name, from, replace}) {
  const p = paths(stageDir, name), spec = baselineSpec(name);
  const screens = checkFormat(path.resolve(from), spec);
  if (fs.existsSync(p.baseline) && !replace) throw Error(`the space already has a ${name} baseline; pass --replace to replace it`);
  fs.rmSync(p.baseline, {recursive: true, force: true});
  copyTree(path.resolve(from), p.baseline);
  const map = hashes(p.baseline), record = {kind: 'ui-poc-design-baseline', schema: 1, name, files: Object.keys(map).length, screens, treeSha256: treeSha(map)};
  fs.writeFileSync(p.baselineRecord, `${JSON.stringify(record, null, 2)}\n`);
  return {action: replace ? 'replaced' : 'adopted', ...record};
}

function start({stageDir, name, from}) {
  const p = paths(stageDir, name), spec = baselineSpec(name);
  if (fs.existsSync(p.base)) {
    const base = JSON.parse(fs.readFileSync(p.base, 'utf8'));
    return {action: 'kept', note: `${name}/ was copied earlier; keep changing it`, source: base.source, treeSha256: base.treeSha256};
  }
  const source = from ? path.resolve(from) : p.baseline;
  if (!from && !fs.existsSync(source)) throw Error(`the space has no ${name} baseline yet; give a folder (adopt, or start --from)`);
  checkFormat(source, spec);
  if (fs.existsSync(p.copy)) throw Error(`${name}/ already exists in the stage without ${name}-base.json; move it away first`);
  copyTree(source, p.copy);
  const map = hashes(p.copy);
  const record = {kind: 'ui-poc-baseline-copy', schema: 1, name, source: from ? 'intent-only-folder' : 'space-baseline', treeSha256: treeSha(map), files: map};
  fs.writeFileSync(p.base, `${JSON.stringify(record, null, 2)}\n`);
  return {action: 'copied', source: record.source, files: Object.keys(map).length, treeSha256: record.treeSha256};
}

function status({stageDir, name}) {
  const p = paths(stageDir, name);
  const baseline = fs.existsSync(p.baselineRecord) ? JSON.parse(fs.readFileSync(p.baselineRecord, 'utf8')) : null;
  return {baseline: baseline ? {files: baseline.files, screens: baseline.screens, treeSha256: baseline.treeSha256} : null, copied: fs.existsSync(p.base), changesDeclared: fs.existsSync(p.changes)};
}

// Bundled pages carry their HTML as one JSON string in a template script; the
// exporter writes `</` as `</` so the string never closes its own script.
const TEMPLATE = /(<script type="__bundler\/template">)([\s\S]*?)(<\/script>)/;
const encodeTemplate = html => JSON.stringify(html).replace(/<\//g, '<\\u002F');
function bundled(file) {
  const text = fs.readFileSync(file, 'utf8'), match = TEMPLATE.exec(text);
  if (!match) throw Error(`${path.basename(file)} is not a bundled page`);
  return {text, match, html: JSON.parse(match[2].trim())};
}
function inside(root, rel) {
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw Error('--file must name a page inside the copy');
  return full;
}
function unpack({stageDir, name, file}) {
  const p = paths(stageDir, name), page = inside(p.copy, file), out = inside(p.work, file);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, bundled(page).html);
  return {action: 'unpacked', edit: posix(path.relative(p.stage, out))};
}
function pack({stageDir, name, file}) {
  const p = paths(stageDir, name), page = inside(p.copy, file), edited = inside(p.work, file);
  if (!fs.existsSync(edited)) throw Error(`nothing to pack: run unpack for ${file} first`);
  const {text, match} = bundled(page), html = fs.readFileSync(edited, 'utf8');
  fs.writeFileSync(page, text.slice(0, match.index) + match[1] + encodeTemplate(html) + match[3] + text.slice(match.index + match[0].length));
  fs.rmSync(edited);
  for (let dir = path.dirname(edited); dir.startsWith(p.work) && fs.readdirSync(dir).length === 0; dir = path.dirname(dir)) fs.rmdirSync(dir);
  return {action: 'packed', file: posix(file)};
}

function diff({stageDir, name}) {
  const p = paths(stageDir, name);
  if (!fs.existsSync(p.base)) throw Error(`${name}-base.json is missing: start the copy first`);
  const before = JSON.parse(fs.readFileSync(p.base, 'utf8')).files, after = hashes(p.copy);
  const added = Object.keys(after).filter(rel => !(rel in before));
  const deleted = Object.keys(before).filter(rel => !(rel in after));
  const modified = Object.keys(after).filter(rel => rel in before && before[rel] !== after[rel]);
  return {added, modified, deleted, unchanged: Object.keys(after).length - added.length - modified.length};
}

function verify({stageDir, name}) {
  const p = paths(stageDir, name), spec = baselineSpec(name), findings = [];
  if (!fs.existsSync(p.base)) return {pass: false, findings: [`${name}-base.json is missing: the ${name} copy was never started`]};
  if (fs.existsSync(p.work) && files(p.work).length) findings.push(`${name}-work/ still holds unpacked pages; pack them: ${files(p.work).join(', ')}`);
  const actual = diff({stageDir, name});
  if (!fs.existsSync(p.changesMd)) findings.push(`${name}-changes.md is missing`);
  if (!fs.existsSync(p.changes)) return {pass: false, findings: [...findings, `${name}-changes.json is missing`], diff: actual};
  let declared;
  try { declared = JSON.parse(fs.readFileSync(p.changes, 'utf8')); } catch (e) { return {pass: false, findings: [...findings, `${name}-changes.json is not JSON: ${e.message}`], diff: actual}; }
  for (const kind of ['added', 'modified', 'deleted']) {
    const listed = declared.files?.[kind] || [];
    const undeclared = actual[kind].filter(rel => !listed.includes(rel)), stale = listed.filter(rel => !actual[kind].includes(rel));
    if (undeclared.length) findings.push(`${kind} but not declared in ${name}-changes.json: ${undeclared.join(', ')}`);
    if (stale.length) findings.push(`declared ${kind} in ${name}-changes.json but not ${kind}: ${stale.join(', ')}`);
  }
  const screen = new RegExp(spec.screenPattern), changedScreens = [...actual.added, ...actual.modified, ...actual.deleted].filter(rel => !rel.includes('/') && screen.test(rel));
  const entries = Array.isArray(declared.screens) ? declared.screens : [];
  const described = entries.map(entry => entry.file);
  const missing = changedScreens.filter(rel => !described.includes(rel));
  if (missing.length) findings.push(`changed screens without an entry in ${name}-changes.json screens: ${missing.join(', ')}`);
  for (const entry of entries) {
    if (!changedScreens.includes(entry.file)) { findings.push(`${name}-changes.json describes ${entry.file}, which did not change`); continue; }
    if (actual.deleted.includes(entry.file)) continue;
    if (!entry.refined || !fs.existsSync(path.join(p.stage, entry.refined))) findings.push(`${entry.file} changed but its refined contract page ${entry.refined || '(none named)'} is missing`);
    if (!Array.isArray(entry.elements) || !entry.elements.length) findings.push(`${entry.file} changed but ${name}-changes.json lists no element changes for it`);
  }
  return {pass: findings.length === 0, findings, diff: actual};
}

const COMMANDS = {adopt, start, status, unpack, pack, diff, verify};
function main(argv) {
  const [command, ...rest] = argv, flag = name => { const at = rest.indexOf(name); return at < 0 ? undefined : rest[at + 1]; };
  if (!COMMANDS[command]) throw Error(`usage: ui-poc-baseline.cjs <${Object.keys(COMMANDS).join('|')}> --stage-dir <dir> --name <name> [...]`);
  const result = COMMANDS[command]({stageDir: flag('--stage-dir'), name: flag('--name'), from: flag('--from'), file: flag('--file'), replace: rest.includes('--replace')});
  console.log(JSON.stringify(command === 'diff' ? {pass: true, ...result} : result, null, 2));
  if (command === 'verify' && !result.pass) process.exitCode = 1;
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`ui-poc-baseline: ${e.message}`); process.exit(2); }
}
module.exports = {adopt, start, status, unpack, pack, diff, verify, baselineSpec, encodeTemplate, spaceDir};
