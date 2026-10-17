'use strict';
// Visual (PNG) comparison: renderer-metadata refusal, threshold, anti-aliasing
// tolerance, masks, and the "noise passes / real change fails" contract.
// Synthetic images only; the real headless-browser run is recorded under
// poc/d-acceleration/evidence/visual-regression/.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const visual = require('../tools/ui-poc-visual.cjs');
const { compareImages, mergeSnapshots } = require('../tools/ui-poc-fidelity.cjs');

const W = 200, H = 100;
function blank(width = W, height = H) { const data = new Uint8Array(width * height * 4).fill(255); return { width, height, data }; }
function set(img, x, y, [r, g, b]) { const o = (y * img.width + x) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255; }
function fill(img, x0, y0, w, h, colour) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(img, x, y, colour); }
/** Black/white diagonal edge with anti-aliased grey on the boundary pixels. */
function edge(grey) { const img = blank(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(img, x, y, x < y ? [0, 0, 0] : x === y ? [grey, grey, grey] : [255, 255, 255]); return img; }
/** A "page": header bar, a button, and text-like strokes. */
function page() { const img = blank(); fill(img, 0, 0, W, 12, [30, 60, 120]); fill(img, 20, 40, 60, 20, [0, 120, 80]); for (let x = 100; x < 180; x += 3) fill(img, x, 45, 2, 8, [40, 40, 40]); return img; }
const clone = img => ({ width: img.width, height: img.height, data: new Uint8Array(img.data) });

const environment = () => ({
  renderer: { executable: 'Google Chrome', product: 'HeadlessChrome/155.0.8059.82', revision: '@abc', protocolVersion: '1.3', jsVersion: '15.5' },
  os: { platform: 'darwin', release: '25.5.0', arch: 'arm64' },
  viewport: { width: W, height: H, deviceScaleFactor: 1 },
  colorProfile: 'srgb', animations: 'frozen', flagsSha256: 'f'.repeat(64), fonts: { policy: 'any', sha256: 'e'.repeat(64) },
});

function setup(t, baselineImg, actualImg, { policy = {}, baselineMasks = [], actualMasks = baselineMasks } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-visual-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const checked = visual.validatePolicy(policy);
  assert.deepEqual(checked.findings, []);
  const write = (name, img, masks) => {
    const file = path.join(dir, `${name}.png`), bytes = visual.encodePng(img);
    fs.writeFileSync(file, bytes);
    return { file, snapshot: { environment: environment(), png: { path: `${name}.png`, sha256: visual.sha256(bytes) }, visual: { policy: checked.policy, policySha256: checked.policySha256, masks } } };
  };
  return { dir, baseline: write('baseline', baselineImg, baselineMasks), actual: write('actual', actualImg, actualMasks) };
}
const run = (s, options) => compareImages(s.baseline.file, s.actual.file, s.baseline.snapshot, s.actual.snapshot, options);

test('PNG encode/decode round-trips RGBA exactly and is deterministic', () => {
  const img = page();
  const bytes = visual.encodePng(img);
  assert.deepEqual(visual.decodePng(bytes).data, img.data);
  assert.equal(visual.sha256(visual.encodePng(img)), visual.sha256(bytes));
  assert.throws(() => visual.decodePng(Buffer.from('not a png')), /NOT_A_PNG/);
});

test('byte-identical renders pass without pixel work', t => {
  const s = setup(t, page(), page());
  const result = run(s);
  assert.equal(result.pass, true);
  assert.equal(result.metrics.identicalBytes, true);
});

test('deliberate 1px sub-threshold colour noise passes with zero differing pixels', t => {
  const actual = page(); set(actual, 150, 80, [250, 250, 250]);
  const result = run(setup(t, page(), actual));
  assert.equal(result.pass, true, result.findings.join('\n'));
  assert.equal(result.metrics.diffPixels, 0);
});

test('a deliberate isolated 1px speck passes within the maxDiffPixels noise budget', t => {
  const actual = page(); set(actual, 150, 80, [0, 0, 0]);
  const result = run(setup(t, page(), actual));
  assert.equal(result.pass, true, result.findings.join('\n'));
  assert.equal(result.metrics.diffPixels, 1);
});

test('anti-aliasing noise on an edge passes; the same noise fails when anti-alias tolerance is off', t => {
  const tolerant = run(setup(t, edge(128), edge(170)));
  assert.equal(tolerant.pass, true, tolerant.findings.join('\n'));
  assert.equal(tolerant.metrics.diffPixels, 0);
  assert.ok(tolerant.metrics.antiAliasPixels >= 90, `aa=${tolerant.metrics.antiAliasPixels}`);
  const strict = run(setup(t, edge(128), edge(170), { policy: { antiAliasing: false } }));
  assert.equal(strict.pass, false);
  assert.equal(strict.status, 'FAIL');
});

test('a real element change (button colour) fails and reports its bounds', t => {
  const actual = page(); fill(actual, 20, 40, 60, 20, [200, 30, 30]);
  const result = run(setup(t, page(), actual));
  assert.equal(result.pass, false);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.metrics.diffPixels, 1200);
  assert.deepEqual(result.metrics.diffBounds, { x: 20, y: 40, w: 60, h: 20 });
});

test('a real element change (moved button) fails even though every pixel is a known colour', t => {
  const actual = blank(); fill(actual, 0, 0, W, 12, [30, 60, 120]); fill(actual, 30, 40, 60, 20, [0, 120, 80]); for (let x = 100; x < 180; x += 3) fill(actual, x, 45, 2, 8, [40, 40, 40]);
  assert.equal(run(setup(t, page(), actual)).pass, false);
});

test('threshold is configurable through the approved policy', t => {
  const actual = page(); fill(actual, 20, 40, 60, 20, [200, 30, 30]);
  const loose = run(setup(t, page(), actual, { policy: { maxDiffPixels: 2000, maxDiffRatio: 0.1 } }));
  assert.equal(loose.pass, true);
  const mild = page(); fill(mild, 20, 40, 60, 20, [0, 128, 86]);
  assert.equal(run(setup(t, page(), mild, { policy: { colorThreshold: 0.2 } })).metrics.diffPixels, 0);
  assert.equal(run(setup(t, page(), mild, { policy: { colorThreshold: 0.01 } })).pass, false);
});

test('a dynamic region masked by an approved selector is ignored; outside the mask still fails', t => {
  const policy = { masks: [{ id: 'CLOCK', selector: '[data-ui-id="CLOCK"]', reason: 'Current time changes every capture' }] };
  const masks = [{ id: 'CLOCK', rects: [{ x: 100, y: 40, w: 90, h: 20 }] }];
  const actual = page(); fill(actual, 100, 40, 90, 20, [255, 255, 0]);
  const masked = run(setup(t, page(), actual, { policy, baselineMasks: masks }));
  assert.equal(masked.pass, true, masked.findings.join('\n'));
  assert.equal(masked.metrics.maskedPixels, 1800);
  fill(actual, 20, 40, 60, 20, [200, 30, 30]);
  assert.equal(run(setup(t, page(), actual, { policy, baselineMasks: masks })).status, 'FAIL');
});

test('mask target missing in the actual capture refuses instead of silently skipping', t => {
  const policy = { masks: [{ id: 'CLOCK', selector: '#clock', reason: 'time' }] };
  const result = run(setup(t, page(), page(), { policy, baselineMasks: [{ id: 'CLOCK', rects: [{ x: 0, y: 0, w: 5, h: 5 }] }], actualMasks: [{ id: 'CLOCK', rects: [] }] }));
  assert.equal(result.status, 'NOT-READY');
  assert.match(result.findings.join('\n'), /CLOCK target not found in actual/);
});

test('masks cannot hide more than maxMaskRatio of the image', t => {
  const policy = { masks: [{ id: 'ALL', selector: 'main', reason: 'too broad' }] };
  const actual = page(); set(actual, 1, 1, [0, 0, 0]);
  const result = run(setup(t, page(), actual, { policy, baselineMasks: [{ id: 'ALL', rects: [{ x: 0, y: 0, w: W, h: H }] }] }));
  assert.equal(result.status, 'NOT-READY');
  assert.match(result.findings.join('\n'), /maxMaskRatio/);
});

for (const [label, mutate, pattern] of [
  ['browser version', env => { env.renderer.product = 'HeadlessChrome/156.0.0.0'; }, /renderer\.product/],
  ['device scale factor', env => { env.viewport.deviceScaleFactor = 2; }, /viewport\.deviceScaleFactor/],
  ['viewport width', env => { env.viewport.width = 375; }, /viewport\.width/],
  ['OS', env => { env.os.platform = 'linux'; }, /os\.platform/],
  ['fonts hash', env => { env.fonts.sha256 = 'd'.repeat(64); }, /fonts\.sha256/],
  ['renderer flags', env => { env.flagsSha256 = '0'.repeat(64); }, /flagsSha256/],
]) {
  test(`renderer metadata mismatch (${label}) refuses comparison even when pixels are identical`, t => {
    const s = setup(t, page(), page());
    mutate(s.actual.snapshot.environment);
    const result = run(s);
    assert.equal(result.pass, false);
    assert.equal(result.status, 'NOT-READY');
    assert.equal(result.refused, true);
    assert.equal(result.metrics, undefined);
    assert.match(result.findings.join('\n'), pattern);
  });
}

test('incomplete renderer metadata (legacy renderer-name-only snapshot) refuses', t => {
  const s = setup(t, page(), page());
  s.baseline.snapshot.environment = { renderer: 'Google Chrome', viewport: { width: W, height: H } };
  const result = run(s);
  assert.equal(result.status, 'NOT-READY');
  assert.match(result.findings.join('\n'), /Renderer metadata incomplete in baseline/);
});

test('actual capture cannot use a looser policy than the approved baseline', t => {
  const s = setup(t, page(), page());
  const loose = visual.validatePolicy({ maxDiffPixels: 100000 });
  s.actual.snapshot.visual = { ...s.actual.snapshot.visual, policy: loose.policy, policySha256: loose.policySha256 };
  assert.match(run(s).findings.join('\n'), /different visual policy/);
  const tampered = setup(t, page(), page());
  tampered.baseline.snapshot.visual.policy = { ...tampered.baseline.snapshot.visual.policy, maxDiffPixels: 100000 };
  assert.match(run(tampered).findings.join('\n'), /policy hash mismatch/);
});

test('PNG hash and size are bound; size drift fails instead of comparing a common area', t => {
  const s = setup(t, page(), page());
  s.actual.snapshot.png.sha256 = '0'.repeat(64);
  assert.match(run(s).findings.join('\n'), /Actual PNG hash mismatch/);
  const sized = setup(t, page(), blank(W, H + 10));
  const result = run(sized);
  assert.equal(result.status, 'FAIL');
  assert.match(result.findings.join('\n'), /size differs/);
  const wrongViewport = setup(t, page(), page());
  wrongViewport.baseline.snapshot.environment.viewport.height = 50; wrongViewport.actual.snapshot.environment.viewport.height = 50;
  assert.match(run(wrongViewport).findings.join('\n'), /not the recorded viewport/);
});

test('comparison never rewrites the approved baseline and writes a reviewable diff image', t => {
  const actual = page(); fill(actual, 20, 40, 60, 20, [200, 30, 30]);
  const s = setup(t, page(), actual);
  const before = fs.readFileSync(s.baseline.file);
  const diffOut = path.join(s.dir, 'diff.png');
  const result = run(s, { diffOut });
  assert.equal(result.pass, false);
  assert.deepEqual(fs.readFileSync(s.baseline.file), before);
  const diff = visual.decodePng(fs.readFileSync(diffOut));
  const o = (50 * W + 50) * 4;
  assert.deepEqual([...diff.data.slice(o, o + 3)], [255, 0, 0]);
  assert.equal(result.diffPng.sha256, visual.sha256(fs.readFileSync(diffOut)));
});

test('policy validation rejects unknown keys, unexplained masks and out-of-range thresholds', () => {
  assert.match(visual.validatePolicy({ maxDifPixels: 3 }).findings.join('\n'), /Unknown visual policy key/);
  assert.match(visual.validatePolicy({ masks: [{ id: 'CLOCK', selector: '#c' }] }).findings.join('\n'), /recorded reason/);
  assert.match(visual.validatePolicy({ colorThreshold: 2 }).findings.join('\n'), /colorThreshold/);
  assert.match(visual.validatePolicy({ maxMaskRatio: 0.9 }).findings.join('\n'), /maxMaskRatio/);
  assert.match(visual.validatePolicy({ fonts: 'system' }).findings.join('\n'), /fonts/);
});

test('calibration (reference repo B) recommends a budget from two captures of the same build', () => {
  const a = page(), b = clone(a); set(b, 5, 90, [0, 0, 0]); set(b, 6, 95, [0, 0, 0]);
  const result = visual.calibrate(visual.encodePng(a), visual.encodePng(b));
  assert.equal(result.noiseDiffPixels, 2);
  assert.equal(result.recommendedMaxDiffPixels, 16);
});

test('merge keeps environment identity but binds each state font fingerprint', () => {
  const capture = (state, fontSha) => ({ schema: 1, kind: 'ui-semantic-snapshot', source: { path: 'a.html', sha256: 'a'.repeat(64) }, environment: { ...environment(), fonts: { policy: 'any', sha256: fontSha } }, captures: [{ screen: 'SCREEN-A', state, rendered: true, elements: [], fonts: { sha256: fontSha } }] });
  const merged = mergeSnapshots([capture('STATE-A', '1'.repeat(64)), capture('STATE-B', '2'.repeat(64))]);
  assert.equal(merged.captures.length, 2);
  assert.notEqual(merged.environment.fonts.sha256, '1'.repeat(64));
  const other = capture('STATE-B', '2'.repeat(64)); other.environment.renderer.product = 'X';
  assert.throws(() => mergeSnapshots([capture('STATE-A', '1'.repeat(64)), other]), /ENVIRONMENT_DIFFERS/);
});
