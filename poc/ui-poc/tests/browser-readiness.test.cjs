'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { waitForBrowserPort } = require('../tools/ui-poc-fidelity.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('browser startup waits through missing, empty and partially written DevToolsActivePort files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-poc-browser-ready-'));
  const file = path.join(root, 'DevToolsActivePort');
  try {
    let settled = false;
    const port = waitForBrowserPort(file, 5000).then(value => { settled = true; return value; });
    await delay(60); assert.equal(settled, false);
    for (const incomplete of ['', '9', '9333\n', '0\n/devtools/browser/test', '65536\n/devtools/browser/test']) {
      fs.writeFileSync(file, incomplete);
      await delay(60);
      assert.equal(settled, false, `must not connect from ${JSON.stringify(incomplete)}`);
    }
    fs.writeFileSync(file, '9333\n/devtools/browser/test');
    assert.equal(await port, 9333);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an unfinished browser port file times out instead of selecting HTTP port 80', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-poc-browser-timeout-'));
  try {
    const file = path.join(root, 'DevToolsActivePort'); fs.writeFileSync(file, '');
    await assert.rejects(waitForBrowserPort(file, 80), /BROWSER_START_TIMEOUT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
