'use strict';
// Deterministic PNG visual comparison for the UI fidelity lane.
//
// Dependency-free: PNG decode/encode use node:zlib only. The pixel classifier
// follows the published pixelmatch approach (YIQ colour delta plus
// neighbour-based anti-aliasing detection, Mapbox, ISC) re-implemented here so
// no package is installed. The decoder shape is reused from KDDI reference
// repo B (aidlc-kddi-patch.ts decodePng, #364); unlike B, size mismatch, missing
// metadata, or a renderer difference never degrade to a "common area" pass.
//
// Authority: the policy (threshold, anti-aliasing, masks) is captured into the
// approved baseline snapshot, so Build and Test cannot loosen it. Comparison is
// refused (NOT-READY) when renderer metadata or policy differ.

const crypto = require('node:crypto');
const zlib = require('node:zlib');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

// ───────────── PNG ─────────────

function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !sig.every((b, i) => buf[i] === b)) throw new Error('NOT_A_PNG');
  let pos = 8, width = 0, height = 0, colorType = -1;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      const depth = body[8]; colorType = body[9];
      if (depth !== 8 || ![0, 2, 4, 6].includes(colorType) || body[12] !== 0) throw new Error(`UNSUPPORTED_PNG depth=${depth} colorType=${colorType} interlace=${body[12]}`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!width || !height || colorType < 0) throw new Error('PNG_HEADER_MISSING');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) throw new Error('PNG_DATA_TRUNCATED');
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride), p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a; else if (filter === 2) pred = b; else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filter !== 0) throw new Error(`PNG_BAD_FILTER ${filter}`);
      cur[x] = (raw[p++] + pred) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, i = x * bpp;
      if (colorType === 0 || colorType === 4) { out[o] = out[o + 1] = out[o + 2] = cur[i]; out[o + 3] = colorType === 4 ? cur[i + 1] : 255; }
      else { out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; out[o + 3] = colorType === 6 ? cur[i + 3] : 255; }
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: out };
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, body) { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb)); return Buffer.concat([len, tb, crc]); }

/** Encode RGBA (8-bit, filter 0). Deterministic for identical input. */
function encodePng(image) {
  const { width, height, data } = image;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ───────────── policy ─────────────

const DEFAULT_POLICY = Object.freeze({
  colorThreshold: 0.1, // YIQ delta, 0..1; pixel differs above this
  antiAliasing: true, // ignore pixels classified as anti-aliasing in either image
  maxDiffPixels: 16, // absolute budget for isolated noise
  maxDiffRatio: 0.0005, // and relative budget (diff / compared)
  maxMaskRatio: 0.25, // masks may never hide more than this share of the image
  fonts: 'any', // 'any' | 'bundled-only' (every rendered glyph from a web font)
  masks: [], // [{id, selector, reason}] dynamic regions resolved at capture
});

function validatePolicy(input) {
  const findings = [];
  const policy = { ...DEFAULT_POLICY, ...(input || {}) };
  const allowed = new Set(Object.keys(DEFAULT_POLICY));
  for (const key of Object.keys(input || {})) if (!allowed.has(key)) findings.push(`Unknown visual policy key: ${key}`);
  const num = (key, min, max) => { if (typeof policy[key] !== 'number' || !Number.isFinite(policy[key]) || policy[key] < min || policy[key] > max) findings.push(`Visual policy ${key} must be a number in [${min}, ${max}]`); };
  num('colorThreshold', 0, 1); num('maxDiffRatio', 0, 1); num('maxMaskRatio', 0, 0.5);
  if (!Number.isInteger(policy.maxDiffPixels) || policy.maxDiffPixels < 0) findings.push('Visual policy maxDiffPixels must be a non-negative integer');
  if (typeof policy.antiAliasing !== 'boolean') findings.push('Visual policy antiAliasing must be boolean');
  if (!['any', 'bundled-only'].includes(policy.fonts)) findings.push('Visual policy fonts must be "any" or "bundled-only"');
  if (!Array.isArray(policy.masks)) findings.push('Visual policy masks must be an array');
  else {
    const ids = new Set();
    for (const mask of policy.masks) {
      if (!mask || typeof mask.id !== 'string' || !/^[A-Z0-9-]+$/.test(mask.id)) { findings.push('Visual mask id must match [A-Z0-9-]+'); continue; }
      if (ids.has(mask.id)) findings.push(`Duplicate visual mask: ${mask.id}`); ids.add(mask.id);
      if (typeof mask.selector !== 'string' || !mask.selector.trim()) findings.push(`Visual mask ${mask.id} needs a CSS selector`);
      if (typeof mask.reason !== 'string' || !mask.reason.trim()) findings.push(`Visual mask ${mask.id} needs a recorded reason`);
      for (const key of Object.keys(mask)) if (!['id', 'selector', 'reason'].includes(key)) findings.push(`Unknown visual mask key: ${mask.id}.${key}`);
    }
  }
  return { policy, findings, policySha256: sha256(Buffer.from(canonical(policy))) };
}

// ───────────── environment ─────────────

const REQUIRED_ENVIRONMENT = ['renderer.product', 'renderer.revision', 'os.platform', 'os.release', 'os.arch', 'viewport.width', 'viewport.height', 'viewport.deviceScaleFactor', 'fonts.sha256', 'animations', 'colorProfile', 'flagsSha256'];
const get = (obj, dotted) => dotted.split('.').reduce((value, key) => (value == null ? undefined : value[key]), obj);
function flatten(value, prefix = '', out = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) { for (const key of Object.keys(value)) flatten(value[key], prefix ? `${prefix}.${key}` : key, out); }
  else out[prefix] = canonical(value);
  return out;
}

/** Return refusal reasons; empty means the two renders are comparable. */
function environmentRefusals(baselineEnv, actualEnv) {
  const findings = [];
  for (const [label, env] of [['baseline', baselineEnv], ['actual', actualEnv]]) {
    const missing = REQUIRED_ENVIRONMENT.filter(key => get(env, key) === undefined || get(env, key) === null || get(env, key) === '');
    if (missing.length) findings.push(`Renderer metadata incomplete in ${label}: ${missing.join(', ')}`);
  }
  if (findings.length) return findings;
  const a = flatten(baselineEnv), b = flatten(actualEnv);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const differing = keys.filter(key => a[key] !== b[key]);
  if (differing.length) findings.push(`Visual rendering environment differs from approved baseline: ${differing.map(key => `${key} ${a[key] ?? '(none)'} != ${b[key] ?? '(none)'}`).join('; ')}`);
  return findings;
}

// ───────────── pixel classifier ─────────────

function blend(c, a) { return 255 + (c - 255) * a; }
function rgb(img, i) { const a = img.data[i + 3] / 255; return [blend(img.data[i], a), blend(img.data[i + 1], a), blend(img.data[i + 2], a)]; }
function yiq(r, g, b) { return [r * 0.29889531 + g * 0.58662247 + b * 0.11448223, r * 0.59597799 - g * 0.2741761 - b * 0.32180189, r * 0.21147017 - g * 0.52261711 + b * 0.31114694]; }
/** Squared YIQ distance (max 35215); signed by brightness when yOnly. */
function colorDelta(img1, img2, i, j, yOnly = false) {
  const [r1, g1, b1] = rgb(img1, i), [r2, g2, b2] = rgb(img2, j);
  const [y1, i1, q1] = yiq(r1, g1, b1), [y2, i2, q2] = yiq(r2, g2, b2);
  const y = y1 - y2;
  if (yOnly) return y;
  const delta = 0.5053 * y * y + 0.299 * (i1 - i2) * (i1 - i2) + 0.1957 * (q1 - q2) * (q1 - q2);
  return y1 > y2 ? -delta : delta;
}
function hasManySiblings(img, x1, y1) {
  const { width, height } = img, x0 = Math.max(x1 - 1, 0), y0 = Math.max(y1 - 1, 0), x2 = Math.min(x1 + 1, width - 1), y2 = Math.min(y1 + 1, height - 1);
  const pos = (y1 * width + x1) * 4; let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
  for (let x = x0; x <= x2; x++) for (let y = y0; y <= y2; y++) {
    if (x === x1 && y === y1) continue;
    const pos2 = (y * width + x) * 4;
    if (img.data[pos] === img.data[pos2] && img.data[pos + 1] === img.data[pos2 + 1] && img.data[pos + 2] === img.data[pos2 + 2] && img.data[pos + 3] === img.data[pos2 + 3]) zeroes++;
    if (zeroes > 2) return true;
  }
  return false;
}
/** Pixel (x1,y1) of img looks like an anti-aliased edge (relative to img2). */
function antialiased(img, x1, y1, img2) {
  const { width, height } = img, x0 = Math.max(x1 - 1, 0), y0 = Math.max(y1 - 1, 0), x2 = Math.min(x1 + 1, width - 1), y2 = Math.min(y1 + 1, height - 1);
  const pos = (y1 * width + x1) * 4; let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0, min = 0, max = 0, minX, minY, maxX, maxY;
  for (let x = x0; x <= x2; x++) for (let y = y0; y <= y2; y++) {
    if (x === x1 && y === y1) continue;
    const delta = colorDelta(img, img, pos, (y * width + x) * 4, true);
    if (delta === 0) { zeroes++; if (zeroes > 2) return false; }
    else if (delta < min) { min = delta; minX = x; minY = y; }
    else if (delta > max) { max = delta; maxX = x; maxY = y; }
  }
  if (min === 0 || max === 0) return false;
  return (hasManySiblings(img, minX, minY) && hasManySiblings(img2, minX, minY)) || (hasManySiblings(img, maxX, maxY) && hasManySiblings(img2, maxX, maxY));
}

function clampRect(rect, width, height) {
  const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
  const x2 = Math.min(width, Math.ceil(rect.x + rect.w)), y2 = Math.min(height, Math.ceil(rect.y + rect.h));
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

/**
 * Classify every pixel. Returns counts and an optional diff image
 * (red = differing, yellow = anti-aliasing tolerated, blue = masked, grey = equal).
 */
function diffImages(baseline, actual, { policy = DEFAULT_POLICY, maskRects = [], withDiffImage = false } = {}) {
  if (baseline.width !== actual.width || baseline.height !== actual.height) throw new Error(`IMAGE_SIZE_DIFFERS ${baseline.width}x${baseline.height} != ${actual.width}x${actual.height}`);
  const { width, height } = baseline, total = width * height;
  const mask = new Uint8Array(total);
  for (const raw of maskRects) { const r = clampRect(raw, width, height); if (!r) continue; for (let y = r.y; y < r.y + r.h; y++) mask.fill(1, y * width + r.x, y * width + r.x + r.w); }
  const maxDelta = 35215 * policy.colorThreshold * policy.colorThreshold;
  const out = withDiffImage ? new Uint8Array(total * 4) : null;
  let diffPixels = 0, aaPixels = 0, maskedPixels = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const idx = y * width + x, pos = idx * 4;
    let kind = 'same';
    if (mask[idx]) { kind = 'masked'; maskedPixels++; }
    else {
      const delta = Math.abs(colorDelta(baseline, actual, pos, pos));
      if (delta > maxDelta) {
        if (policy.antiAliasing && (antialiased(baseline, x, y, actual) || antialiased(actual, x, y, baseline))) { kind = 'aa'; aaPixels++; }
        else { kind = 'diff'; diffPixels++; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
      }
    }
    if (out) {
      const [r, g, b] = rgb(baseline, pos), grey = 255 - 0.1 * (255 - (0.299 * r + 0.587 * g + 0.114 * b));
      const colour = { same: [grey, grey, grey], masked: [120, 160, 255], aa: [255, 210, 0], diff: [255, 0, 0] }[kind];
      out[pos] = colour[0]; out[pos + 1] = colour[1]; out[pos + 2] = colour[2]; out[pos + 3] = 255;
    }
  }
  const compared = total - maskedPixels;
  return {
    width, height, comparedPixels: compared, maskedPixels, antiAliasPixels: aaPixels, diffPixels,
    diffRatio: compared ? diffPixels / compared : 0, maskRatio: maskedPixels / total,
    diffBounds: diffPixels ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
    diffImage: out ? { width, height, data: out } : null,
  };
}

/** Union mask rects of baseline and actual for each policy mask id. Missing targets refuse. */
function resolveMasks(policy, baselineVisual, actualVisual) {
  const findings = [], rects = [];
  for (const mask of policy.masks) {
    for (const [label, visual] of [['baseline', baselineVisual], ['actual', actualVisual]]) {
      const resolved = (visual?.masks || []).find(item => item.id === mask.id);
      if (!resolved || !Array.isArray(resolved.rects) || !resolved.rects.length) findings.push(`Visual mask ${mask.id} target not found in ${label} capture`);
      else rects.push(...resolved.rects);
    }
  }
  return { findings, rects };
}

/**
 * Compare two decoded PNG buffers under the baseline's approved visual policy.
 * Returns {pass, status: PASS|FAIL|NOT-READY, findings, metrics}.
 */
function compareVisual(baselineBytes, actualBytes, baselineSnapshot, actualSnapshot, { withDiffImage = false } = {}) {
  const refuse = findings => ({ pass: false, status: 'NOT-READY', refused: true, findings_count: findings.length, findings });
  const findings = [];
  if (!baselineSnapshot?.png || !actualSnapshot?.png) findings.push('PNG metadata is missing');
  if (baselineSnapshot?.png?.sha256 !== sha256(baselineBytes)) findings.push('Approved baseline PNG hash mismatch');
  if (actualSnapshot?.png?.sha256 !== sha256(actualBytes)) findings.push('Actual PNG hash mismatch');
  findings.push(...environmentRefusals(baselineSnapshot?.environment, actualSnapshot?.environment));
  const baselineVisual = baselineSnapshot?.visual, actualVisual = actualSnapshot?.visual;
  if (!baselineVisual?.policy) findings.push('Approved baseline has no visual policy');
  const checked = validatePolicy(baselineVisual?.policy);
  findings.push(...checked.findings);
  if (baselineVisual?.policySha256 !== checked.policySha256) findings.push('Approved baseline visual policy hash mismatch');
  if (actualVisual?.policySha256 !== baselineVisual?.policySha256) findings.push('Actual capture used a different visual policy than the approved baseline');
  if (findings.length) return refuse(findings);
  const masks = resolveMasks(checked.policy, baselineVisual, actualVisual);
  if (masks.findings.length) return refuse(masks.findings);
  let base, act;
  try { base = decodePng(baselineBytes); act = decodePng(actualBytes); } catch (error) { return refuse([`PNG decode failed: ${error.message}`]); }
  const expected = baselineSnapshot.environment.viewport;
  const want = { w: Math.round(expected.width * expected.deviceScaleFactor), h: Math.round(expected.height * expected.deviceScaleFactor) };
  if (base.width !== want.w || base.height !== want.h) return refuse([`Baseline PNG is ${base.width}x${base.height}, not the recorded viewport ${want.w}x${want.h}`]);
  if (act.width !== base.width || act.height !== base.height) return { pass: false, status: 'FAIL', refused: false, findings_count: 1, findings: [`Rendered PNG size differs: ${act.width}x${act.height} != ${base.width}x${base.height}`] };
  if (sha256(baselineBytes) === sha256(actualBytes)) return { pass: true, status: 'PASS', refused: false, findings_count: 0, findings: [], metrics: { identicalBytes: true, diffPixels: 0 } };
  const metrics = diffImages(base, act, { policy: checked.policy, maskRects: masks.rects, withDiffImage });
  if (metrics.maskRatio > checked.policy.maxMaskRatio) return refuse([`Visual masks hide ${(metrics.maskRatio * 100).toFixed(2)}% of the image, above maxMaskRatio ${(checked.policy.maxMaskRatio * 100).toFixed(2)}%`]);
  const out = [];
  if (metrics.diffPixels > checked.policy.maxDiffPixels) out.push(`Rendered PNG differs from approved baseline: ${metrics.diffPixels} pixels exceed maxDiffPixels ${checked.policy.maxDiffPixels}`);
  if (metrics.diffRatio > checked.policy.maxDiffRatio) out.push(`Rendered PNG differs from approved baseline: ratio ${metrics.diffRatio.toFixed(6)} exceeds maxDiffRatio ${checked.policy.maxDiffRatio}`);
  if (out.length && metrics.diffBounds) out.push(`Differing region bounds x=${metrics.diffBounds.x} y=${metrics.diffBounds.y} w=${metrics.diffBounds.w} h=${metrics.diffBounds.h}`);
  const { diffImage, ...summary } = metrics;
  return { pass: out.length === 0, status: out.length ? 'FAIL' : 'PASS', refused: false, findings_count: out.length, findings: out, metrics: { identicalBytes: false, ...summary }, diffImage };
}

/**
 * Calibration (idea from reference repo B, aidlc-kddi-patch.ts): measure the
 * noise between two captures of the same build under the same policy and masks,
 * and recommend 3x that noise (never below the defaults). The recommendation is
 * advisory input for the human approving the baseline policy; it never edits
 * an approved policy.
 */
function calibrate(aBytes, bBytes, policy = DEFAULT_POLICY, maskRects = []) {
  const metrics = diffImages(decodePng(aBytes), decodePng(bBytes), { policy: validatePolicy(policy).policy, maskRects });
  return { noiseDiffPixels: metrics.diffPixels, noiseAntiAliasPixels: metrics.antiAliasPixels, maskedPixels: metrics.maskedPixels, noiseRatio: metrics.diffRatio, recommendedMaxDiffPixels: Math.max(metrics.diffPixels * 3, DEFAULT_POLICY.maxDiffPixels), recommendedMaxDiffRatio: Math.max(metrics.diffRatio * 3, DEFAULT_POLICY.maxDiffRatio) };
}

module.exports = { DEFAULT_POLICY, REQUIRED_ENVIRONMENT, canonical, sha256, decodePng, encodePng, validatePolicy, environmentRefusals, diffImages, colorDelta, antialiased, compareVisual, calibrate };
