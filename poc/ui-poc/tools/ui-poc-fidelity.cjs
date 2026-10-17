#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { spawn } = require('node:child_process');
const visual = require('./ui-poc-visual.cjs');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const hashJson = value => sha256(Buffer.from(canonical(value)));
const id = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}[A-Z0-9-]+$`).test(value);

function validateSnapshot(snapshot) {
  const findings = [];
  if (!snapshot || snapshot.schema !== 1 || snapshot.kind !== 'ui-semantic-snapshot') findings.push('Invalid semantic snapshot schema');
  if (!snapshot?.source || !/^[a-f0-9]{64}$/.test(snapshot.source.sha256 || '')) findings.push('Snapshot source hash is missing or invalid');
  if (!Array.isArray(snapshot?.captures) || !snapshot.captures.length) findings.push('Snapshot has no rendered captures');
  const captureKeys = new Set();
  for (const capture of snapshot?.captures || []) {
    if (!id(capture.screen, 'SCREEN-') || !id(capture.state, 'STATE-')) findings.push('Invalid snapshot screen/state');
    const captureKey = `${capture.screen}/${capture.state}`;
    if (captureKeys.has(captureKey)) findings.push(`Duplicate rendered capture: ${captureKey}`);
    captureKeys.add(captureKey);
    if (capture.rendered !== true) findings.push(`State was not rendered: ${captureKey}`);
    if (!Array.isArray(capture.elements)) findings.push(`Capture elements are missing: ${captureKey}`);
    const elementKeys = new Set();
    for (const element of capture.elements || []) {
      if (!element || typeof element.key !== 'string' || !element.key.trim()) findings.push(`Element key is missing: ${captureKey}`);
      else if (elementKeys.has(element.key)) findings.push(`Duplicate element key: ${captureKey}/${element.key}`);
      else elementKeys.add(element.key);
      if (!['text','control','field','region','business-value'].includes(element?.kind)) findings.push(`Invalid element kind: ${captureKey}/${element?.key || '?'}`);
      if (element?.exactCopy === true && (typeof element.text !== 'string' || !element.text.trim())) findings.push(`Exact-copy element has no text: ${captureKey}/${element?.key || '?'}`);
      if (element?.important === true && !element.explicitId) findings.push(`Important element lacks a stable explicit ID: ${captureKey}/${element?.key || '?'}`);
      if (element?.action && (!element.action.id || !id(element.action.expectedState, 'STATE-'))) findings.push(`Invalid action contract: ${captureKey}/${element?.key || '?'}`);
      if (element?.truncation && !['required','forbidden'].includes(element.truncation.mode)) findings.push(`Invalid truncation contract: ${captureKey}/${element?.key || '?'}`);
    }
    for (const element of capture.elements || []) {
      if (element?.truncation?.mode === 'required' && !(capture.elements || []).some(candidate => candidate?.action?.target === element.key)) findings.push(`Required truncation has no action target: ${captureKey}/${element.key}`);
    }
  }
  return findings;
}

/** The single owner of element identity (SCREEN/STATE/KEY) across snapshots. */
function snapshotElements(snapshot) {
  const elements = new Map();
  for (const capture of snapshot?.captures || []) for (const element of capture.elements || []) elements.set(`${capture.screen}/${capture.state}/${element.key}`, { capture, element });
  return elements;
}

/**
 * The single owner of "what counts as an element difference". Implementation
 * comparison, Build and Test matrices, and approved-upstream change control all
 * call this; none re-implements its own notion of drift.
 */
function elementDifferences(expected, observed, { observedIsApproved = false } = {}) {
  const differences = [];
  if (!observed) { differences.push('missing'); return differences; }
  if (expected.exactCopy === true && expected.text !== observed.text) differences.push(`copy ${JSON.stringify(expected.text)} != ${JSON.stringify(observed.text)}`);
  if ((expected.role || '') !== (observed.role || '')) differences.push(`role ${expected.role || '(none)'} != ${observed.role || '(none)'}`);
  if (observedIsApproved) {
    // Comparing two approved design snapshots: contracts, not runtime observations.
    if (expected.exactCopy !== observed.exactCopy) differences.push(`exact-copy ${Boolean(expected.exactCopy)} != ${Boolean(observed.exactCopy)}`);
    if (canonical(expected.truncation || null) !== canonical(observed.truncation || null)) differences.push('truncation contract changed');
    if (canonical(expected.action || null) !== canonical(observed.action || null)) differences.push('action contract changed');
    if (!expected.exactCopy && expected.important && (expected.text || '') !== (observed.text || '')) differences.push(`text ${JSON.stringify(expected.text)} != ${JSON.stringify(observed.text)}`);
    return differences;
  }
  if (expected.truncation?.mode === 'required' && observed.truncated !== true) differences.push('required truncation not observed');
  if (expected.truncation?.mode === 'forbidden' && observed.truncated === true) differences.push('unexpected truncation observed');
  if (expected.action && observed.actionVerified !== true) differences.push(`action ${expected.action.id} did not reach ${expected.action.expectedState}`);
  return differences;
}
const elementDeltaSha256 = (elementKey, differences) => hashJson({elementKey,differences});

function dispositionReceipt(disposition, ledger, approvedSnapshotHash, observedDeltaSha256 = disposition?.deltaSha256) {
  if (!disposition || !['upstream-revised','approved-deviation','intentionally-omitted'].includes(disposition.status) || typeof disposition.reason !== 'string' || !disposition.reason.trim() || typeof disposition.approvalReceipt !== 'string' || !disposition.approvalReceipt.trim() || !/^[a-f0-9]{64}$/.test(disposition.deltaSha256 || '') || disposition.deltaSha256 !== observedDeltaSha256) return false;
  const dispositionSha256=hashJson({elementKey:disposition.elementKey,status:disposition.status,reason:disposition.reason});
  return Boolean(ledger?.approvals?.find(entry => entry.decisionId === disposition.approvalReceipt && entry.stage === 'functional-design' && entry.status === 'approved' && entry.snapshotSha256 === approvedSnapshotHash && entry.dispositionSha256 === dispositionSha256 && entry.deltaSha256 === observedDeltaSha256 && Array.isArray(entry.elementKeys) && entry.elementKeys.includes(disposition.elementKey) && typeof entry.source === 'string' && entry.source.trim() && typeof entry.reviewer === 'string' && entry.reviewer.trim()));
}

function compareSnapshots(approved, actual, dispositions = [], ledger = {}) {
  const findings = [...validateSnapshot(approved), ...validateSnapshot(actual).map(value => `Actual: ${value}`)];
  if (findings.length) return { pass: false, findings_count: findings.length, findings, checked: 0, deviated: 0 };
  if (canonical(approved.source) === canonical(actual.source)) findings.push('Actual snapshot is not an independent implementation observation');
  if (actual.observation?.mode !== 'loopback-url' || actual.observation.target !== actual.source.path || actual.observation.targetSha256 !== actual.source.sha256) findings.push('Actual snapshot lacks a bound loopback capture observation');
  try { const url=new URL(actual.source.path); if (!['127.0.0.1','localhost','::1'].includes(url.hostname)) findings.push('Actual snapshot source is not a loopback implementation URL'); }
  catch { findings.push('Actual snapshot source is not a loopback implementation URL'); }
  const approvedHash = hashJson(approved);
  const results = elementResults(approved, actual, dispositions, ledger);
  let deviated = 0;
  for (const row of results) {
    if (row.result === 'pass') continue;
    if (row.result === 'fail') findings.push(`${row.addition ? 'Unapproved UI addition' : 'Unapproved UI difference'} ${row.elementKey}: ${row.differences.join(', ')}`);
    else deviated += 1;
  }
  const known = new Set(results.map(row => row.elementKey));
  for (const disposition of dispositions) {
    if (!known.has(disposition.elementKey)) findings.push(`Disposition names an unknown approved element: ${disposition.elementKey}`);
    else if (!dispositionReceipt(disposition, ledger, approvedHash)) findings.push(`Disposition has no matching detached approval receipt: ${disposition.elementKey}`);
  }
  return { pass: findings.length === 0, findings_count: findings.length, findings, checked: results.filter(row => !row.addition).length, deviated };
}

/**
 * The single owner of per-element implementation results. One row per approved
 * element (the denominator never comes from the implementation), plus a row
 * for every important explicit-ID element the implementation added without
 * approval. compareSnapshots and the Build and Test element matrix both read
 * these rows; neither re-derives pass/fail on its own.
 */
function elementResults(approved, actual, dispositions = [], ledger = {}) {
  const approvedHash = hashJson(approved);
  const approvedElements = snapshotElements(approved), actualElements = snapshotElements(actual);
  const byElement = new Map(dispositions.map(value => [value.elementKey, value]));
  const rows = [];
  const settle = (elementKey, differences, extra) => {
    const disposition = byElement.get(elementKey);
    const result = !differences.length ? 'pass' : dispositionReceipt(disposition, ledger, approvedHash, elementDeltaSha256(elementKey, differences)) ? disposition.status : 'fail';
    rows.push({ elementKey, differences, result, ...extra });
  };
  for (const [key, { element }] of approvedElements) settle(key, elementDifferences(element, actualElements.get(key)?.element), { element });
  for (const [key, { element }] of actualElements) if (!approvedElements.has(key) && element.explicitId && element.important) settle(key, ['unapproved-addition'], { element, addition: true });
  return rows.sort((a, b) => a.elementKey.localeCompare(b.elementKey));
}

function compareImages(baselinePng, actualPng, baselineSnapshot, actualSnapshot, options = {}) {
  const result = visual.compareVisual(fs.readFileSync(baselinePng), fs.readFileSync(actualPng), baselineSnapshot, actualSnapshot, { withDiffImage: Boolean(options.diffOut) });
  if (options.diffOut && result.diffImage) { fs.writeFileSync(options.diffOut, visual.encodePng(result.diffImage)); result.diffPng = { path: path.basename(options.diffOut), sha256: sha256(fs.readFileSync(options.diffOut)) }; }
  delete result.diffImage;
  return result;
}

function browserExecutable(explicit) {
  const candidates = [explicit, process.env.UI_POC_BROWSER_EXECUTABLE, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function requestJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if ((response.statusCode || 500) >= 400) return reject(new Error(`Browser HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.end();
  });
}

async function waitForFile(file, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('BROWSER_START_TIMEOUT');
}

class Cdp {
  constructor(url) { this.next = 1; this.pending = new Map(); this.ws = new WebSocket(url); }
  async open() {
    await new Promise((resolve, reject) => { this.ws.addEventListener('open', resolve, { once: true }); this.ws.addEventListener('error', reject, { once: true }); });
    this.ws.addEventListener('message', event => { const message = JSON.parse(String(event.data)); if (!message.id) return; const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); });
  }
  send(method, params = {}) { const id = this.next++; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  close() { this.ws.close(); }
}

async function waitForExpression(cdp, expression, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue:true });
    if (result.result?.value === true) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('RENDER_STATE_TIMEOUT');
}

// Each action verification must start from the same state the capture
// observed: an earlier verified action (for example a confirmed delete that
// persists to localStorage) must not leak into the next reload.
async function resetPageStorage(cdp) {
  const origin = (await cdp.send('Runtime.evaluate', { expression: 'location.origin', returnByValue: true })).result?.value;
  if (origin && origin !== 'null') { try { await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }); } catch {} }
  await cdp.send('Runtime.evaluate', { expression: 'try{localStorage.clear();sessionStorage.clear()}catch(e){}', returnByValue: true });
}

const extractionExpression = `(() => {
  const visible = element => { const s=getComputedStyle(element), r=element.getBoundingClientRect(); return s.display!=='none' && s.visibility!=='hidden' && Number(s.opacity)!==0 && r.width>0 && r.height>0; };
  const norm = value => String(value||'').replace(/\\s+/g,' ').trim();
  const root = document.querySelector('[data-ui-screen]') || document.body;
  const screen = root.getAttribute('data-ui-screen'); const state = root.getAttribute('data-ui-state');
  if (!screen || !state) return { rendered:false, error:'MISSING_SCREEN_STATE_ROOT' };
  const elements=[]; let ordinal=0;
  const add=(element, kind, text) => { if (!visible(element)) return; const explicitId=element.getAttribute('data-ui-id')||''; const normalized=norm(text); if (!explicitId && !normalized && kind==='text') return; const role=element.getAttribute('role')||({BUTTON:'button',A:'link',INPUT:'textbox',SELECT:'combobox',TEXTAREA:'textbox'}[element.tagName]||''); const rect=element.getBoundingClientRect(), style=getComputedStyle(element); const truncated=element.scrollHeight>element.clientHeight+1 || element.scrollWidth>element.clientWidth+1 || style.textOverflow==='ellipsis' || style.webkitLineClamp!=='none'; const key=explicitId || 'AUTO-'+sha(normalized+'|'+role+'|'+ordinal++).slice(0,16); const actionId=element.getAttribute('data-ui-action-id'), expectedState=element.getAttribute('data-ui-expected-state'), target=element.getAttribute('data-ui-action-target'); elements.push({key,explicitId:Boolean(explicitId),kind,text:normalized||undefined,role:role||undefined,exactCopy:element.hasAttribute('data-ui-exact-copy'),important:element.hasAttribute('data-ui-important'),truncated,truncation:element.hasAttribute('data-ui-require-truncation')?{mode:'required'}:undefined,action:actionId&&expectedState?{id:actionId,expectedState,target:target||undefined}:undefined,metrics:{clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,overflow:style.overflow,textOverflow:style.textOverflow,lineClamp:style.webkitLineClamp}}); };
  const sha=value=>{let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')};
  const kindOf=el=>/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)?'field':(/^(BUTTON|A)$/.test(el.tagName)||['button','link','checkbox','radio','switch','tab','menuitem'].includes(el.getAttribute('role')||'')||el.hasAttribute('data-ui-action-id'))?'control':el.hasAttribute('data-ui-business-value')?'business-value':(el.hasAttribute('data-ui-require-truncation')||el.hasAttribute('data-ui-region')||el.getAttribute('role'))?'region':'text';
  root.querySelectorAll('button,a,input,select,textarea,[role],[data-ui-id]').forEach(el=>add(el, kindOf(el), el.getAttribute('aria-label')||el.textContent||el.value));
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); let node; while(node=walker.nextNode()){ const parent=node.parentElement; if(parent && !parent.closest('button,a,input,select,textarea,[role],[data-ui-id]') && visible(parent) && norm(node.nodeValue)) add(parent,'text',node.nodeValue); }
  return {rendered:true,screen,state,elements};
})()`;

// Fixed renderer flags; their hash is part of the recorded environment.
const RENDER_FLAGS = Object.freeze(['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--hide-scrollbars','--force-color-profile=srgb','--font-render-hinting=none','--disable-lcd-text','--disable-extensions','--mute-audio']);
const positiveInt = (value, name) => { const number = Number(value); if (!Number.isInteger(number) || number < 1 || number > 10000) throw new Error(`INVALID_VIEWPORT_${name.toUpperCase()}`); return number; };

// Stop CSS animations/transitions, caret blink and smooth scroll, finish Web
// Animations, then wait two frames. Returns how many animations still run.
const freezeExpression = `(async () => {
  const style = document.createElement('style'); style.id = 'ui-poc-freeze';
  style.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
  document.head.appendChild(style);
  for (const animation of document.getAnimations()) { try { animation.finish(); } catch { animation.cancel(); } }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { running: document.getAnimations().filter(animation => animation.playState === 'running').length };
})()`;

const fontFaceExpression = `(async () => {
  await document.fonts.ready;
  const failed = Array.from(document.fonts).filter(face => face.status === 'error').map(face => face.family);
  const sources = [];
  const walk = (rules, base) => { for (const rule of Array.from(rules || [])) {
    if (rule.constructor.name === 'CSSFontFaceRule') { const src = rule.style.getPropertyValue('src'); for (const match of src.matchAll(/url\\((['"]?)([^'")]+)\\1\\)/g)) sources.push({ family: rule.style.getPropertyValue('font-family').replace(/['"]/g,'').trim(), weight: rule.style.getPropertyValue('font-weight') || 'normal', style: rule.style.getPropertyValue('font-style') || 'normal', url: new URL(match[2], base).href }); }
    else if (rule.cssRules) walk(rule.cssRules, base);
  } };
  for (const sheet of Array.from(document.styleSheets)) { try { walk(sheet.cssRules, sheet.href || document.baseURI); } catch { sources.push({ url: sheet.href, unreadable: true }); } }
  return { failed, sources };
})()`;

/**
 * Record which fonts actually rendered glyphs (platform font identity from the
 * renderer) and hash every bundled @font-face file. Policy 'bundled-only'
 * refuses any glyph drawn from an unpinned system font.
 */
async function collectFonts(cdp, policy) {
  const declared = (await cdp.send('Runtime.evaluate', { expression:fontFaceExpression, returnByValue:true, awaitPromise:true })).result?.value;
  if (!declared) throw new Error('FONT_INSPECTION_FAILED');
  if (declared.failed.length) throw new Error(`FONT_LOAD_FAILED: ${[...new Set(declared.failed)].join(', ')}`);
  const bundled = [];
  for (const source of declared.sources) {
    if (source.unreadable) throw new Error(`FONT_STYLESHEET_UNREADABLE: ${source.url}`);
    let fileSha256 = null;
    if (source.url.startsWith('data:')) fileSha256 = sha256(Buffer.from(source.url));
    else if (source.url.startsWith('file:')) { const file = fileURLToPath(source.url); if (fs.existsSync(file)) fileSha256 = sha256(fs.readFileSync(file)); }
    else if (!['127.0.0.1','localhost','[::1]'].includes(new URL(source.url).hostname)) throw new Error(`FONT_REMOTE_SOURCE: ${source.url}`);
    else { const response = await fetch(source.url); if (!response.ok) throw new Error(`FONT_FETCH_FAILED: ${source.url}`); const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > 50 * 1024 * 1024) throw new Error(`FONT_TOO_LARGE: ${source.url}`); fileSha256 = sha256(bytes); }
    bundled.push({ family:source.family, weight:source.weight, style:source.style, file:source.url.startsWith('data:') ? 'data:' : path.basename(new URL(source.url).pathname), sha256:fileSha256 });
  }
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const doc = await cdp.send('DOM.getDocument', { depth:0 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId:doc.root.nodeId, selector:'body, body *' });
  if (nodeIds.length > 5000) throw new Error('FONT_INSPECTION_TOO_MANY_NODES');
  const faces = new Map();
  for (const nodeId of nodeIds) {
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    for (const font of fonts || []) { const face = { familyName:font.familyName, postScriptName:font.postScriptName || '', isCustomFont:Boolean(font.isCustomFont) }; faces.set(canonical(face), face); }
  }
  const rendered = [...faces.values()].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  bundled.sort((a, b) => canonical(a).localeCompare(canonical(b)));
  if (!rendered.length) throw new Error('FONT_INSPECTION_NO_TEXT');
  if (policy.fonts === 'bundled-only') {
    const system = rendered.filter(face => !face.isCustomFont);
    if (system.length) throw new Error(`FONT_NOT_PINNED: system fonts rendered glyphs: ${system.map(face => face.postScriptName || face.familyName).join(', ')}`);
    const unhashed = bundled.filter(face => !face.sha256);
    if (unhashed.length) throw new Error(`FONT_NOT_PINNED: bundled font file not hashable: ${unhashed.map(face => face.file).join(', ')}`);
  }
  return { rendered, bundled, sha256:hashJson({ rendered, bundled }) };
}

async function capture(options) {
  const executable = browserExecutable(options.browser);
  if (!executable) throw new Error('BROWSER_TOOL_UNAVAILABLE');
  let target, source, observation;
  if (options.html) {
    const html = path.resolve(options.html);
    if (!fs.statSync(html).isFile()) throw new Error('HTML_NOT_FOUND');
    const fileUrl = pathToFileURL(html);
    if (options.query) { if (typeof options.query !== 'string' || !/^[A-Za-z0-9_=&.-]+$/.test(options.query)) throw new Error('INVALID_QUERY'); fileUrl.search = `?${options.query}`; }
    target = fileUrl.href;
    source = { path:path.basename(html), sha256:sha256(fs.readFileSync(html)) };
    observation = { mode:'approved-file', targetSha256:sha256(Buffer.from(target)) };
  } else {
    const url = new URL(options.url);
    if (!['127.0.0.1','localhost','::1'].includes(url.hostname) || !['http:','https:'].includes(url.protocol)) throw new Error('IMPLEMENTATION_URL_MUST_BE_LOOPBACK');
    target = url.href;
    source = { path:target, sha256:sha256(Buffer.from(target)) };
    observation = { mode:'loopback-url', target, targetSha256:source.sha256, capturedAt:new Date().toISOString() };
  }
  const viewport = { width:positiveInt(options.width ?? 1280, 'width'), height:positiveInt(options.height ?? 720, 'height'), deviceScaleFactor:Number(options['device-scale-factor'] ?? 1) };
  if (![1,2,3].includes(viewport.deviceScaleFactor)) throw new Error('INVALID_DEVICE_SCALE_FACTOR: use 1, 2, or 3');
  const checkedPolicy = visual.validatePolicy(options['visual-policy'] ? JSON.parse(fs.readFileSync(options['visual-policy'], 'utf8')) : {});
  if (checkedPolicy.findings.length) throw new Error(`INVALID_VISUAL_POLICY: ${checkedPolicy.findings.join('; ')}`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-poc-browser-'));
  const processHandle = spawn(executable, [...RENDER_FLAGS,'--remote-debugging-port=0',`--user-data-dir=${temp}`,target], { stdio:'ignore' });
  let cdp;
  try {
    const active = path.join(temp, 'DevToolsActivePort'); await waitForFile(active);
    const [port] = fs.readFileSync(active, 'utf8').trim().split(/\r?\n/);
    const version = await requestJson(`http://127.0.0.1:${port}/json/version`);
    const pages = await requestJson(`http://127.0.0.1:${port}/json`);
    const page = pages.find(item => item.type === 'page'); if (!page) throw new Error('BROWSER_PAGE_UNAVAILABLE');
    cdp = new Cdp(page.webSocketDebuggerUrl); await cdp.open(); await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width:viewport.width, height:viewport.height, deviceScaleFactor:viewport.deviceScaleFactor, mobile:false });
    await cdp.send('Emulation.setEmulatedMedia', { media:'screen', features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-color-scheme',value:'light'}] });
    await waitForExpression(cdp, `document.readyState==='complete' && Boolean(document.querySelector('[data-ui-screen][data-ui-state]'))`);
    const applySetup = async () => { for (const spec of String(options['setup-click'] || '').split(',').map(value => value.trim()).filter(Boolean)) { const separator=spec.lastIndexOf('@'), key=separator>0?spec.slice(0,separator):'', expectedState=separator>0?spec.slice(separator+1):''; if(!key||!id(expectedState,'STATE-'))throw new Error(`INVALID_SETUP_CLICK: ${spec}; expected ELEMENT-ID@STATE-ID`); try { await waitForExpression(cdp, `Boolean(document.querySelector('[data-ui-id='+CSS.escape(${JSON.stringify(key)})+']'))`); } catch { throw new Error(`SETUP_CONTROL_NOT_FOUND: ${key}`); } const clicked = await cdp.send('Runtime.evaluate', { expression:`(()=>{const el=document.querySelector('[data-ui-id='+CSS.escape(${JSON.stringify(key)})+']');if(!el)return false;el.click();return true})()`, returnByValue:true }); if (clicked.result?.value !== true) throw new Error(`SETUP_CONTROL_NOT_FOUND: ${key}`); await waitForExpression(cdp, `(document.querySelector('[data-ui-screen]')||document.body).getAttribute('data-ui-state')===${JSON.stringify(expectedState)}`); } };
    await applySetup();
    const frozen = await cdp.send('Runtime.evaluate', { expression:freezeExpression, returnByValue:true, awaitPromise:true });
    if (frozen.result?.value?.running !== 0) throw new Error(`ANIMATION_NOT_FROZEN: ${JSON.stringify(frozen.result?.value ?? frozen.exceptionDetails?.text)}`);
    const fonts = await collectFonts(cdp, checkedPolicy.policy);
    const result = await cdp.send('Runtime.evaluate', { expression: extractionExpression, returnByValue:true, awaitPromise:true });
    const captureResult = result.result?.value; if (!captureResult?.rendered) throw new Error(captureResult?.error || 'RENDER_CAPTURE_FAILED');
    captureResult.fonts = fonts;
    let visualRecord = null;
    if (options.png) {
      const scale = viewport.deviceScaleFactor, masks = [];
      for (const mask of checkedPolicy.policy.masks) {
        const rects = await cdp.send('Runtime.evaluate', { expression:`Array.from(document.querySelectorAll(${JSON.stringify(mask.selector)})).map(el=>el.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0).map(r=>({x:r.left*${scale},y:r.top*${scale},w:r.width*${scale},h:r.height*${scale}}))`, returnByValue:true });
        masks.push({ id:mask.id, rects:rects.result?.value || [] });
      }
      const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true}), bytes=Buffer.from(shot.data,'base64');
      fs.writeFileSync(options.png,bytes); captureResult.pngSha256=sha256(bytes);
      visualRecord = { policy:checkedPolicy.policy, policySha256:checkedPolicy.policySha256, masks };
    }
    for (const [index,element] of captureResult.elements.filter(value => value.action).entries()) {
      const action = JSON.stringify(element.action), key = JSON.stringify(element.key);
      const verification = await cdp.send('Runtime.evaluate', { expression:`(async()=>{const action=${action},el=document.querySelector('[data-ui-id='+CSS.escape(${key})+']');if(!el)return false;const target=action.target?document.querySelector('[data-ui-id='+CSS.escape(action.target)+']'):null,before=target?{clientHeight:target.clientHeight,scrollHeight:target.scrollHeight}:null;el.click();for(let attempt=0;attempt<100;attempt++){const root=document.querySelector('[data-ui-screen]')||document.body,stateOk=root.getAttribute('data-ui-state')===action.expectedState;if(stateOk&&!target)return true;if(stateOk&&target){const after={clientHeight:target.clientHeight,scrollHeight:target.scrollHeight};if(after.clientHeight>before.clientHeight||after.scrollHeight<=after.clientHeight+1)return true}await new Promise(r=>setTimeout(r,50))}return false})()`, returnByValue:true, awaitPromise:true });
      element.actionVerified = verification.result?.value === true;
      if(index<captureResult.elements.filter(value=>value.action).length-1){await resetPageStorage(cdp);await cdp.send('Page.reload');await waitForExpression(cdp, `document.readyState==='complete' && Boolean(document.querySelector('[data-ui-screen][data-ui-state]'))`);await applySetup();}
    }
    const environment = {
      renderer:{ executable:path.basename(executable), product:version.Browser, revision:version['WebKit-Version'], protocolVersion:version['Protocol-Version'], jsVersion:version['V8-Version'] },
      os:{ platform:os.platform(), release:os.release(), arch:os.arch() },
      viewport, colorProfile:'srgb', animations:'frozen', flagsSha256:sha256(Buffer.from(canonical([...RENDER_FLAGS].sort()))),
      fonts:{ policy:checkedPolicy.policy.fonts, sha256:fonts.sha256 },
    };
    const snapshot = { schema:1, kind:'ui-semantic-snapshot', source, observation, environment, captures:[captureResult] };
    const validation = validateSnapshot(snapshot); if (validation.length) throw new Error(validation.join('; '));
    if (options.png) { snapshot.png={path:path.basename(options.png),sha256:captureResult.pngSha256}; snapshot.visual=visualRecord; }
    return snapshot;
  } finally {
    if (cdp) cdp.close();
    processHandle.kill('SIGTERM');
    const exited = await Promise.race([new Promise(resolve => processHandle.once('exit', () => resolve(true))),new Promise(resolve => setTimeout(() => resolve(false),1000))]);
    if (!exited && processHandle.exitCode === null) { processHandle.kill('SIGKILL'); await Promise.race([new Promise(resolve => processHandle.once('exit', resolve)),new Promise(resolve => setTimeout(resolve,1000))]); }
    for(let attempt=0;attempt<3;attempt++){try{fs.rmSync(temp,{recursive:true,force:true});break;}catch(error){if(attempt===2)console.error(`Browser profile cleanup failed: ${error.message}`);else await new Promise(resolve=>setTimeout(resolve,100));}}
  }
}

function sameObservedSource(snapshot, first) {
  if (canonical(snapshot.source)===canonical(first.source)) return true;
  if (snapshot.observation?.mode!=='loopback-url' || first.observation?.mode!=='loopback-url') return false;
  try { const a=new URL(snapshot.source.path), b=new URL(first.source.path); return a.origin===b.origin && a.pathname===b.pathname && snapshot.observation.target===snapshot.source.path && snapshot.observation.targetSha256===snapshot.source.sha256; } catch { return false; }
}
const withoutFontHash = environment => environment?.fonts ? {...environment,fonts:{...environment.fonts,sha256:undefined}} : environment;

function mergeSnapshots(snapshots) {
  if (!snapshots.length) throw new Error('NO_SNAPSHOTS_TO_MERGE');
  const [first] = snapshots;
  for (const snapshot of snapshots) {
    const findings=validateSnapshot(snapshot); if(findings.length) throw new Error(findings.join('; '));
    if (!sameObservedSource(snapshot, first) || canonical(withoutFontHash(snapshot.environment))!==canonical(withoutFontHash(first.environment))) throw new Error('SNAPSHOT_SOURCE_OR_ENVIRONMENT_DIFFERS');
  }
  const captures=snapshots.flatMap(snapshot=>snapshot.captures);
  const merged={...first,captures};
  // Each state may render different glyphs; the merged font fingerprint binds every state's fonts in order.
  if (first.environment?.fonts) merged.environment={...first.environment,fonts:{...first.environment.fonts,sha256:hashJson(captures.map(capture=>capture.fonts?.sha256??null))}};
  // Loopback states reached through different query scenarios of one page keep
  // every bound observation; the first remains the snapshot's primary binding.
  if (snapshots.some(snapshot => canonical(snapshot.source)!==canonical(first.source))) merged.observations=snapshots.map(snapshot=>({state:`${snapshot.captures[0].screen}/${snapshot.captures[0].state}`,...snapshot.observation}));
  const findings=validateSnapshot(merged);if(findings.length)throw new Error(findings.join('; '));return merged;
}

function parse(argv) { const result={_:[]}; for(let i=0;i<argv.length;i++){ if(!argv[i].startsWith('--')) result._.push(argv[i]); else { const key=argv[i].slice(2); if(!argv[i+1]||argv[i+1].startsWith('--')) result[key]=true; else result[key]=argv[++i]; } } return result; }
async function main(argv) {
  try {
    const args=parse(argv), command=args._[0];
    if(command==='capture') { if((!args.html&&!args.url)||(args.html&&args.url)||!args.out) throw new Error('USAGE: capture (--html FILE [--query k=v] | --url LOOPBACK_URL) --out FILE [--png FILE] [--width N] [--height N] [--device-scale-factor 1|2|3] [--visual-policy JSON] [--setup-click ELEMENT-ID@STATE-ID,...]'); const snapshot=await capture(args); fs.writeFileSync(args.out,`${JSON.stringify(snapshot,null,2)}\n`); console.log(JSON.stringify({pass:true,snapshotSha256:hashJson(snapshot),captures:snapshot.captures.length,png:Boolean(args.png)})); return; }
    if(command==='merge') { if(!args.input||!args.out) throw new Error('USAGE: merge --input ONE.json,TWO.json --out MERGED.json'); const merged=mergeSnapshots(String(args.input).split(',').map(file=>JSON.parse(fs.readFileSync(file.trim(),'utf8')))); fs.writeFileSync(args.out,`${JSON.stringify(merged,null,2)}\n`); console.log(JSON.stringify({pass:true,snapshotSha256:hashJson(merged),captures:merged.captures.length})); return; }
    if(command==='compare') { if(!args.approved||!args.actual) throw new Error('USAGE: compare --approved FILE --actual FILE [--dispositions FILE] [--approval-ledger FILE]'); const read=file=>JSON.parse(fs.readFileSync(file,'utf8')); const result=compareSnapshots(read(args.approved),read(args.actual),args.dispositions?read(args.dispositions):[],args['approval-ledger']?read(args['approval-ledger']):{}); console.log(JSON.stringify(result)); process.exitCode=result.pass?0:1; return; }
    if(command==='visual-compare') { if(!args.baseline||!args.actual||!args['baseline-snapshot']||!args['actual-snapshot']) throw new Error('USAGE: visual-compare --baseline PNG --actual PNG --baseline-snapshot JSON --actual-snapshot JSON [--diff-out PNG]'); const read=file=>JSON.parse(fs.readFileSync(file,'utf8')); const result=compareImages(args.baseline,args.actual,read(args['baseline-snapshot']),read(args['actual-snapshot']),{diffOut:args['diff-out']}); console.log(JSON.stringify(result)); process.exitCode=result.pass?0:1; return; }
    if(command==='visual-calibrate') { if(!args.a||!args.b) throw new Error('USAGE: visual-calibrate --a PNG --b PNG [--a-snapshot JSON --b-snapshot JSON]  (two captures of the same build; snapshots supply policy and mask rects)'); const read=file=>JSON.parse(fs.readFileSync(file,'utf8')); const snaps=args['a-snapshot']&&args['b-snapshot']?[read(args['a-snapshot']),read(args['b-snapshot'])]:[]; const policy=snaps[0]?.visual?.policy||{}; const rects=snaps.flatMap(snap=>(snap.visual?.masks||[]).flatMap(mask=>mask.rects||[])); console.log(JSON.stringify({pass:true,...visual.calibrate(fs.readFileSync(args.a),fs.readFileSync(args.b),policy,rects)})); return; }
    throw new Error('USAGE: ui-poc-fidelity.cjs capture|merge|compare|visual-compare|visual-calibrate');
  } catch(error) { console.log(JSON.stringify({pass:false,findings_count:1,findings:[error.message]})); process.exitCode=1; }
}
if(require.main===module) main(process.argv.slice(2));
module.exports={RENDER_FLAGS,canonical,hashJson,validateSnapshot,snapshotElements,elementDifferences,elementDeltaSha256,elementResults,compareSnapshots,compareImages,dispositionReceipt,browserExecutable,capture,mergeSnapshots,main};
