'use strict';
// Shared helpers for the Mockups -> Functional Design -> implementation
// fidelity fixture. Real renderer captures only; no regex or hand inventory.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { capture, mergeSnapshots, browserExecutable } = require('../tools/ui-poc-fidelity.cjs');

const FIXTURE = path.resolve(__dirname, '..', 'fixtures', 'fidelity-e2e');
// The approved state denominator for SCREEN-NOTES. Each entry is reached the
// same way a person would reach it: a query scenario or real clicks.
const STATES = [
  { state: 'STATE-LIST' },
  { state: 'STATE-CONFIRM-DELETE', setup: 'DELETE-NOTE@STATE-CONFIRM-DELETE' },
  { state: 'STATE-DELETED', setup: 'DELETE-NOTE@STATE-CONFIRM-DELETE,CONFIRM-DELETE@STATE-DELETED' },
  { state: 'STATE-SAVED', setup: 'SAVE-NOTE@STATE-SAVED' },
  { state: 'STATE-STORAGE-ERROR', query: 'scenario=storage-error' },
  { state: 'STATE-PRIVATE-MODE', query: 'scenario=private' },
];
// The five reported dogfooding discrepancies, each bound to the element(s)
// that must carry it from the approved mockup to the implementation.
const REQUIRED_SEMANTICS = {
  'deletion-confirmation-details': ['SCREEN-NOTES/STATE-CONFIRM-DELETE/DELETE-CONFIRM-DETAIL', 'SCREEN-NOTES/STATE-CONFIRM-DELETE/DELETE-CONFIRM-TITLE'],
  'completion-wording': ['SCREEN-NOTES/STATE-SAVED/SAVE-COMPLETE', 'SCREEN-NOTES/STATE-DELETED/DELETE-COMPLETE'],
  'long-note-truncation-expansion': ['SCREEN-NOTES/STATE-LIST/MEMO-BODY', 'SCREEN-NOTES/STATE-LIST/EXPAND-MEMO'],
  'private-mode-guidance': ['SCREEN-NOTES/STATE-PRIVATE-MODE/PRIVATE-MODE-GUIDANCE'],
  'storage-read-failure-text': ['SCREEN-NOTES/STATE-STORAGE-ERROR/STORAGE-READ-ERROR'],
};

async function captureState(target, spec) {
  const options = target.html ? { html: target.html, query: spec.query } : { url: spec.query ? `${target.url}?${spec.query}` : target.url };
  if (spec.setup) options['setup-click'] = spec.setup;
  const snapshot = await capture(options);
  if (snapshot.captures[0].state !== spec.state) throw new Error(`Expected ${spec.state}, rendered ${snapshot.captures[0].state}`);
  return snapshot;
}
async function captureStates(target) {
  const snapshots = [];
  for (const spec of STATES) snapshots.push(await captureState(target, spec));
  return mergeSnapshots(snapshots);
}
// The state in which each reported semantic is observable.
const SEMANTIC_STATE = { 'deletion-confirmation-details': 'STATE-CONFIRM-DELETE', 'completion-wording': 'STATE-SAVED', 'long-note-truncation-expansion': 'STATE-LIST', 'private-mode-guidance': 'STATE-PRIVATE-MODE', 'storage-read-failure-text': 'STATE-STORAGE-ERROR' };

function serve(html) {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      if (new URL(request.url, 'http://127.0.0.1').pathname !== '/notes') { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html);
    });
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/notes`, close: () => new Promise(done => server.close(done)) }));
  });
}

// Each mutation removes exactly one reported semantic from the implementation.
const REGRESSIONS = {
  'deletion-confirmation-details': html => html.replace("confirmDetail: note => `「${note.title}」（${note.updated} 更新）を削除します。この操作は取り消せません。`", "confirmDetail: () => '削除します。'"),
  'completion-wording': html => html.replace("saved: '✓ 保存しました'", "saved: '保存完了'"),
  'long-note-truncation-expansion': html => html.replace('-webkit-line-clamp: 1;', '').replace('display: -webkit-box;', ''),
  'private-mode-guidance': html => html.replace("if (state === 'STATE-PRIVATE-MODE') app.append(el('p', ui('PRIVATE-MODE-GUIDANCE', { role: 'note' }), COPY.privateMode));", ''),
  'storage-read-failure-text': html => html.replace("storageReadError: '保存データを読み込めませんでした。ブラウザのストレージ設定を確認してから、再読み込みしてください。'", "storageReadError: 'エラーが発生しました'"),
};

module.exports = { FIXTURE, STATES, REQUIRED_SEMANTICS, SEMANTIC_STATE, REGRESSIONS, captureState, captureStates, serve, browserAvailable: () => Boolean(browserExecutable()), readFixture: rel => fs.readFileSync(path.join(FIXTURE, rel), 'utf8') };
