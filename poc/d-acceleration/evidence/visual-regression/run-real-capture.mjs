#!/usr/bin/env node
// Real headless-browser capture + visual comparison run for issue #6
// ("Exercise PNG capture and visual comparison with fixed viewport, fonts,
// renderer metadata, and false-positive handling").
//
// Usage: node run-real-capture.mjs <work-dir> [font-file]
//   work-dir   scratch directory (large PNG/JSON outputs; not committed)
//   font-file  a locally installed font to bundle as the pinned web font
//              (copied into work-dir only; never committed)
// Writes summary.json (and the small review PNGs) next to this script.
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const tool = path.join(repo, 'poc/ui-poc/tools/ui-poc-fidelity.cjs');
const work = path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/vr-'));
const fontFile = process.argv[3] || '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, 'fonts'), { recursive: true });
fs.copyFileSync(fontFile, path.join(work, 'fonts/pinned.ttf'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ---- sample mockup (Refined Mockups style, one screen/state) ----
function page({ label = '保存する', dot = false, subpixel = 0, fontFamily = 'Pinned', radius = 8, lineOffset = 0 } = {}) {
  return `<!doctype html>
<meta charset="utf-8">
<title>Budget</title>
<style>
  @font-face { font-family: Pinned; src: url(fonts/pinned.ttf); }
  html, body { margin: 0; background: #fff; }
  body { font: 16px/1.5 ${fontFamily}; color: #1f2328; }
  header { background: #1e3c78; color: #fff; padding: 12px 24px; font-size: 20px; }
  main { padding: 24px; transform: translateX(${subpixel}px); }
  .card { border: 1px solid #d1d9e0; border-radius: ${radius}px; padding: 16px; width: 420px; }
  button { font: inherit; background: #00784f; color: #fff; border: 0; border-radius: 6px; padding: 8px 20px; }
  .spinner { width: 24px; height: 24px; border: 3px solid #ccc; border-top-color: #1e3c78; border-radius: 50%; animation: spin 0.8s linear infinite; display: inline-block; vertical-align: middle; }
  input { font: inherit; width: 200px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #dot { position: absolute; left: 700px; top: 500px; width: 1px; height: 1px; background: #000; }
</style>
<header>家計簿 Household budget</header>
<main data-ui-screen="SCREEN-BUDGET" data-ui-state="STATE-READY">
  <div class="card">
    <p data-ui-id="SAVE-NOTICE" data-ui-important data-ui-exact-copy>✓ 保存しました Saved</p>
    <p>今月の予算 Monthly budget: ¥120,000</p>
    <p>Updated <span data-ui-id="CLOCK"></span> <span class="spinner"></span></p>
    <input data-ui-id="MEMO-INPUT" value="memo" autofocus>
    <button data-ui-id="SAVE" data-ui-important>${label}</button>
    <svg width="420" height="60" aria-hidden="true"><polyline points="0,50 ${140 + lineOffset},10 280,45 420,${15 + lineOffset}" fill="none" stroke="#1e3c78" stroke-width="2"/></svg>
  </div>
</main>
${dot ? '<div id="dot"></div>' : ''}
<script>document.querySelector('[data-ui-id="CLOCK"]').textContent = new Date().toISOString();</script>
`;
}
const pages = {
  'approved.html': page(),
  'element-change.html': page({ label: '登録する' }),
  'noise-1px.html': page({ dot: true }),
  'subpixel-0.25.html': page({ subpixel: 0.25 }),
  'aa-radius.html': page({ radius: 8.4 }),
  'aa-chart-line.html': page({ lineOffset: 0.3 }),
  'system-font.html': page({ fontFamily: '-apple-system, sans-serif' }),
};
for (const [name, html] of Object.entries(pages)) fs.writeFileSync(path.join(work, name), html);
const maskedPolicy = { masks: [{ id: 'CLOCK', selector: '[data-ui-id="CLOCK"]', reason: 'Timestamp text changes on every render' }] };
fs.writeFileSync(path.join(work, 'policy-masked.json'), JSON.stringify(maskedPolicy));
fs.writeFileSync(path.join(work, 'policy-unmasked.json'), JSON.stringify({}));
fs.writeFileSync(path.join(work, 'policy-bundled-only.json'), JSON.stringify({ ...maskedPolicy, fonts: 'bundled-only' }));

const node = process.execPath;
async function cli(args) {
  const started = Date.now();
  const res = await new Promise(resolve => { const child = spawn(node, [tool, ...args], { cwd: work }); let stdout = '', stderr = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 120000); child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; }); child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); }); });
  const line = res.stdout.trim().split('\n').at(-1) || '{}';
  let json; try { json = JSON.parse(line); } catch { json = { raw: res.stdout, stderr: res.stderr }; }
  return { exitCode: res.status, ms: Date.now() - started, ...json };
}
const common = ['--width', '800', '--height', '600'];
function captureHtml(name, out, policy = 'policy-masked.json', extra = []) {
  return cli(['capture', '--html', name, '--out', `${out}.json`, '--png', `${out}.png`, '--visual-policy', policy, ...common, ...extra]);
}
function compare(base, actual, diff) {
  return cli(['visual-compare', '--baseline', `${base}.png`, '--actual', `${actual}.png`, '--baseline-snapshot', `${base}.json`, '--actual-snapshot', `${actual}.json`, ...(diff ? ['--diff-out', `${diff}.png`] : [])]);
}

// Loopback server for the "implementation" observation (same bytes as approved.html).
const server = http.createServer((req, res) => {
  const file = path.join(work, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(work + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'font/ttf' });
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const runs = {};
const cases = [];
try {
  runs.baseline = await captureHtml('approved.html', 'baseline');
  runs.recapture = await captureHtml('approved.html', 'recapture');
  runs.loopback = await cli(['capture', '--url', `http://127.0.0.1:${port}/approved.html`, '--out', 'loopback.json', '--png', 'loopback.png', '--visual-policy', 'policy-masked.json', ...common]);
  runs.elementChange = await captureHtml('element-change.html', 'element-change');
  runs.noise1px = await captureHtml('noise-1px.html', 'noise-1px');
  runs.subpixel = await captureHtml('subpixel-0.25.html', 'subpixel');
  runs.aaRadius = await captureHtml('aa-radius.html', 'aa-radius');
  runs.aaLine = await captureHtml('aa-chart-line.html', 'aa-line');
  runs.dsf2 = await captureHtml('approved.html', 'dsf2', 'policy-masked.json', ['--device-scale-factor', '2']);
  runs.unmaskedBaseline = await captureHtml('approved.html', 'unmasked-baseline', 'policy-unmasked.json');
  runs.unmaskedRecapture = await captureHtml('approved.html', 'unmasked-recapture', 'policy-unmasked.json');
  runs.bundledOnlyPinned = await captureHtml('approved.html', 'bundled-pinned', 'policy-bundled-only.json');
  runs.bundledOnlySystemFont = await captureHtml('system-font.html', 'bundled-system', 'policy-bundled-only.json');
  runs.calibration = await cli(['visual-calibrate', '--a', 'baseline.png', '--b', 'recapture.png', '--a-snapshot', 'baseline.json', '--b-snapshot', 'recapture.json']);

  const expect = async (name, base, actual, expected, diff) => { const r = await compare(base, actual, diff); cases.push({ name, expected, observed: r.status, ok: r.status === expected, findings: r.findings, metrics: r.metrics }); };
  await expect('same build recaptured (masked clock)', 'baseline', 'recapture', 'PASS');
  await expect('loopback implementation observation, same page', 'baseline', 'loopback', 'PASS');
  await expect('deliberate 1px dot noise', 'baseline', 'noise-1px', 'PASS', 'diff-noise-1px');
  await expect('anti-alias noise: card corner radius 8px -> 8.4px', 'baseline', 'aa-radius', 'PASS', 'diff-aa-radius');
  await expect('anti-alias noise: chart polyline vertex moved 0.3px', 'baseline', 'aa-line', 'PASS', 'diff-aa-line');
  // A whole-content 0.25px translation re-rasterizes every glyph; it is a layout change, not AA noise (documented limit).
  await expect('0.25px sub-pixel layout shift of all content', 'baseline', 'subpixel', 'FAIL', 'diff-subpixel');
  await expect('real element change: button label', 'baseline', 'element-change', 'FAIL', 'diff-element-change');
  await expect('renderer metadata differs: deviceScaleFactor 2', 'baseline', 'dsf2', 'NOT-READY');
  await expect('false positive without mask: dynamic clock', 'unmasked-baseline', 'unmasked-recapture', 'FAIL', 'diff-unmasked-clock');
} finally {
  server.close();
}

const base = JSON.parse(fs.readFileSync(path.join(work, 'baseline.json'), 'utf8'));
const summary = {
  generatedAt: new Date().toISOString(),
  tool: 'poc/ui-poc/tools/ui-poc-fidelity.cjs',
  toolSha256: sha(tool), visualModuleSha256: sha(path.join(repo, 'poc/ui-poc/tools/ui-poc-visual.cjs')),
  node: process.version,
  font: { source: fontFile, sha256: sha(path.join(work, 'fonts/pinned.ttf')), note: 'copied into the scratch work dir only; not committed' },
  environment: base.environment,
  renderedFonts: base.captures[0].fonts,
  visualPolicy: base.visual,
  captures: Object.fromEntries(Object.entries(runs).map(([key, value]) => [key, value])),
  pngSha256: Object.fromEntries(['baseline', 'recapture', 'loopback', 'element-change', 'noise-1px', 'aa-radius', 'aa-line', 'subpixel', 'dsf2'].filter(n => fs.existsSync(path.join(work, `${n}.png`))).map(n => [n, sha(path.join(work, `${n}.png`))])),
  cases,
  allExpected: cases.every(c => c.ok) && runs.bundledOnlySystemFont.pass === false && runs.bundledOnlyPinned.pass === true,
};
fs.writeFileSync(path.join(here, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const name of ['baseline', 'element-change', 'diff-element-change', 'diff-aa-radius', 'diff-aa-line', 'diff-subpixel', 'diff-unmasked-clock']) {
  const src = path.join(work, `${name}.png`); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(here, `${name}.png`));
}
console.log(JSON.stringify({ allExpected: summary.allExpected, cases: cases.map(c => `${c.ok ? 'ok' : 'UNEXPECTED'} ${c.name}: ${c.observed}`), bundledOnlyPinned: runs.bundledOnlyPinned.pass, bundledOnlySystemFont: runs.bundledOnlySystemFont.findings }, null, 2));
