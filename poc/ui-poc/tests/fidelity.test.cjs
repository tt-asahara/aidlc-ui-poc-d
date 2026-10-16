'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { compareImages, compareSnapshots, hashJson, validateSnapshot } = require('../tools/ui-poc-fidelity.cjs');

const source = { path:'screen.html', sha256:'a'.repeat(64) };
const actualSource = { path:'http://127.0.0.1:4173/budget', sha256:'b'.repeat(64) };
function snapshot(elements, actual=false) { return { schema:1, kind:'ui-semantic-snapshot', source:actual?actualSource:source, observation:actual?{mode:'loopback-url',target:actualSource.path,targetSha256:actualSource.sha256}:undefined, captures:[{screen:'SCREEN-BUDGET',state:'STATE-READY',rendered:true,elements}] }; }
const save = {key:'SAVE-NOTICE',explicitId:true,kind:'text',text:'✓ 保存しました',exactCopy:true,important:true};
const helper = {key:'AUTO-helper',explicitId:false,kind:'text',text:'プライベートモードなど',exactCopy:false,important:false};
const expand = {key:'EXPAND-MEMO',explicitId:true,kind:'control',text:'全文を表示',role:'button',important:true,action:{id:'EXPAND',expectedState:'STATE-EXPANDED',target:'MEMO'},actionVerified:true};
const memo = {key:'MEMO',explicitId:true,kind:'region',text:'長いメモ',important:true,truncation:{mode:'required'},truncated:true};
const approved = snapshot([save,helper,expand,memo]);

test('four reported fidelity regressions fail deterministically when not approved', () => {
  const actual = snapshot([
    {...save,text:'✓ 登録しました'},
    {...memo,truncated:false,truncation:undefined}
  ],true);
  const result = compareSnapshots(approved, actual);
  assert.equal(result.pass,false);
  assert.match(result.findings.join('\n'),/SAVE-NOTICE/);
  assert.match(result.findings.join('\n'),/AUTO-helper/);
  assert.match(result.findings.join('\n'),/EXPAND-MEMO/);
  assert.match(result.findings.join('\n'),/required truncation/);
});

test('approved D2-style deviation requires a detached receipt bound to snapshot and element', () => {
  const actual = snapshot([helper,expand,memo],true);
  const elementKey='SCREEN-BUDGET/STATE-READY/SAVE-NOTICE';
  const deltaSha256=hashJson({elementKey,differences:['missing']});
  const dispositions=[{elementKey,status:'approved-deviation',reason:'User approved count-only presentation',approvalReceipt:'decision-1',deltaSha256}];
  assert.equal(compareSnapshots(approved,actual,dispositions,{}).pass,false);
  const ledger={approvals:[{decisionId:'decision-1',stage:'functional-design',status:'approved',snapshotSha256:hashJson(approved),dispositionSha256:hashJson({elementKey,status:'approved-deviation',reason:'User approved count-only presentation'}),deltaSha256,elementKeys:[elementKey],source:'synthetic-test-only',reviewer:'synthetic-reviewer'}]};
  const result=compareSnapshots(approved,actual,dispositions,ledger);
  assert.equal(result.pass,true);
  assert.equal(result.deviated,1);
});

test('receipt for another snapshot or element cannot approve an omission', () => {
  const elementKey='SCREEN-BUDGET/STATE-READY/SAVE-NOTICE';
  const deltaSha256=hashJson({elementKey,differences:['missing']});
  const dispositions=[{elementKey,status:'intentionally-omitted',reason:'Synthetic omission',approvalReceipt:'decision-1',deltaSha256}];
  const ledger={approvals:[{decisionId:'decision-1',stage:'functional-design',status:'approved',snapshotSha256:'b'.repeat(64),dispositionSha256:hashJson({elementKey,status:'intentionally-omitted',reason:'Synthetic omission'}),deltaSha256,elementKeys:[elementKey],source:'synthetic-test-only',reviewer:'synthetic-reviewer'}]};
  assert.equal(compareSnapshots(approved,snapshot([helper,expand,memo],true),dispositions,ledger).pass,false);
});

test('receipt for an omission cannot approve a different observed delta', () => {
  const elementKey='SCREEN-BUDGET/STATE-READY/SAVE-NOTICE';
  const deltaSha256=hashJson({elementKey,differences:['missing']});
  const dispositions=[{elementKey,status:'approved-deviation',reason:'Synthetic approved omission',approvalReceipt:'decision-1',deltaSha256}];
  const ledger={approvals:[{decisionId:'decision-1',stage:'functional-design',status:'approved',snapshotSha256:hashJson(approved),dispositionSha256:hashJson({elementKey,status:'approved-deviation',reason:'Synthetic approved omission'}),deltaSha256,elementKeys:[elementKey],source:'synthetic-test-only',reviewer:'synthetic-reviewer'}]};
  const actual=snapshot([{...save,text:'✓ 登録しました'},helper,expand,memo],true);
  assert.equal(compareSnapshots(approved,actual,dispositions,ledger).pass,false);
});

test('important semantic elements require explicit IDs while static text may use generated fingerprints', () => {
  assert.deepEqual(validateSnapshot(approved),[]);
  assert.match(validateSnapshot(snapshot([{...save,key:'AUTO-save',explicitId:false}])).join('\n'),/stable explicit ID/);
});

test('required truncation must name an expansion action target', () => {
  assert.match(validateSnapshot(snapshot([save,helper,{...expand,action:{id:'EXPAND',expectedState:'STATE-EXPANDED'}},memo])).join('\n'),/has no action target/);
});

test('an action control that exists but does not reach its expected state fails', () => {
  const actual=snapshot([save,helper,{...expand,actionVerified:false},memo],true);
  assert.match(compareSnapshots(approved,actual).findings.join('\n'),/did not reach STATE-EXPANDED/);
});

test('actual evidence cannot be a copied approved snapshot', () => {
  assert.match(compareSnapshots(approved,JSON.parse(JSON.stringify(approved))).findings.join('\n'),/not an independent implementation observation/);
});

test('a separately observed loopback implementation with identical semantics passes', () => {
  const actual=snapshot(JSON.parse(JSON.stringify(approved.captures[0].elements)),true);
  assert.equal(compareSnapshots(approved,actual).pass,true);
});

test('visual comparison never updates its approved baseline and fails on bytes or environment drift', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ui-visual-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const baseline=path.join(dir,'baseline.png'), actual=path.join(dir,'actual.png');fs.writeFileSync(baseline,'approved');fs.writeFileSync(actual,'approved');
  const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
  const baselineSnapshot={environment:{renderer:'Chrome',viewport:{width:1280,height:720}},png:{sha256:digest('approved')}};
  const actualSnapshot=JSON.parse(JSON.stringify(baselineSnapshot));
  assert.equal(compareImages(baseline,actual,baselineSnapshot,actualSnapshot).pass,true);
  fs.writeFileSync(actual,'changed');actualSnapshot.png.sha256=digest('changed');
  assert.equal(compareImages(baseline,actual,baselineSnapshot,actualSnapshot).pass,false);
  assert.equal(fs.readFileSync(baseline,'utf8'),'approved');
  fs.writeFileSync(actual,'approved');actualSnapshot.png.sha256=digest('approved');actualSnapshot.environment.viewport.width=375;
  assert.match(compareImages(baseline,actual,baselineSnapshot,actualSnapshot).findings.join('\n'),/environment differs/);
});
