'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {check,hash} = require('../tools/ui-poc-evidence.cjs');
function render(c) { return '# Synthetic fixture, not workflow evidence\n\n## Artifact References\n\n## Screen State Acceptance Mapping\n\n## Approval Evidence\n\n## Testing Brief\n\n```ui-poc-contract\n'+JSON.stringify(c)+'\n```\n'; }
function fixture(t) {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(),'ui-poc-unit-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const root=path.join(temp,'evidence'); fs.mkdirSync(root);
 fs.writeFileSync(path.join(root,'screen.html'),'<!doctype html><title>Synthetic unit-test fixture</title>');
 const c={schema:1,stage:'code-generation',arm:'A',assets:[{path:'screen.html',sha256:hash(fs.readFileSync(path.join(root,'screen.html')))}],mappings:[{screen:'SCREEN-HOME',state:'STATE-EMPTY',ac:'AC-001',asset:'screen.html',check:'Shows empty state'}],requiredMappings:['SCREEN-HOME/STATE-EMPTY/AC-001']};
 fs.writeFileSync(path.join(root,'upstream.md'),render({...c,stage:'refined-mockups'}));
 c.upstream={path:'upstream.md',stage:'refined-mockups',sha256:hash(fs.readFileSync(path.join(root,'upstream.md')))};
 const outputPath=path.join(root,'ui-poc-implementation-contract.md');
 const approvalLedger=path.join(temp,'synthetic-approval.json');
 function writeContract(){fs.writeFileSync(outputPath,'# Synthetic fixture, not workflow evidence\n\n## Artifact References\n\n## Screen State Acceptance Mapping\n\n## Approval Evidence\n\n## Testing Brief\n\n```ui-poc-contract\n'+JSON.stringify(c)+'\n```\n');}
 function approve(){fs.writeFileSync(approvalLedger,JSON.stringify({approvals:[{contractSha256:c.upstream.sha256,stage:c.upstream.stage,arm:c.arm,status:'approved',source:'synthetic-unit-fixture-only',reviewer:'synthetic-test-reviewer',requiredMappings:c.requiredMappings}]}));}
 writeContract();approve();return {root,c,outputPath,approvalLedger,writeContract,approve,run:()=>check({stage:'code-generation',outputPath,approvalLedger})};
}
test('synthetic valid evidence passes local checker only',t=>assert.equal(fixture(t).run().pass,true));
const mutations={
 'missing HTML':f=>fs.unlinkSync(path.join(f.root,'screen.html')),
 'tampered HTML':f=>fs.appendFileSync(path.join(f.root,'screen.html'),'tampered'),
 'missing contract':f=>fs.unlinkSync(f.outputPath),
 'parent path escape':f=>{f.c.assets[0].path='../outside.html';f.writeContract();f.approve();},
 'absolute path':f=>{f.c.assets[0].path='/tmp/escape.html';f.writeContract();f.approve();},
 'symlink escape':f=>{const p=path.join(path.dirname(f.root),'outside.html');fs.copyFileSync(path.join(f.root,'screen.html'),p);fs.unlinkSync(path.join(f.root,'screen.html'));fs.symlinkSync(p,path.join(f.root,'screen.html'));},
 'tampered upstream contract':f=>fs.appendFileSync(path.join(f.root,'upstream.md'),'changed'),
 'unapproved status':f=>{const x=JSON.parse(fs.readFileSync(f.approvalLedger));x.approvals[0].status='pending';fs.writeFileSync(f.approvalLedger,JSON.stringify(x));},
 'missing approval':f=>fs.unlinkSync(f.approvalLedger),
 'missing mapping':f=>{f.c.mappings=[];f.writeContract();f.approve();},
 'missing required coverage':f=>{f.c.requiredMappings.push('SCREEN-HOME/STATE-ERROR/AC-002');f.writeContract();f.approve();},
 'duplicate mapping':f=>{f.c.mappings.push(f.c.mappings[0]);f.writeContract();f.approve();},
 'malformed JSON':f=>fs.writeFileSync(f.outputPath,'garbage'),
 'wrong stage':f=>{f.c.stage='rough-mockups';f.writeContract();f.approve();},
 'invalid arm':f=>{f.c.arm='D';f.writeContract();f.approve();}
};
for(const [name,mutate] of Object.entries(mutations))test('rejects '+name,t=>{const f=fixture(t);mutate(f);assert.equal(f.run().pass,false);});
test('rejects unconfigured trust input',t=>{const f=fixture(t);assert.equal(check({stage:'code-generation',outputPath:f.outputPath}).pass,false);});
test('checks sibling contract when dispatcher fires on another deliverable',t=>{const f=fixture(t);const outputPath=path.join(f.root,'mockups.md');fs.writeFileSync(outputPath,'Core artifact fixture');assert.equal(check({stage:'code-generation',outputPath,approvalLedger:f.approvalLedger}).pass,true);});

test('producer draft does not require an extra human approval gate',t=>{const f=fixture(t);f.c.stage='refined-mockups';f.writeContract();const outputPath=path.join(f.root,'ui-poc-refined-contract.md');fs.renameSync(f.outputPath,outputPath);assert.equal(check({stage:'refined-mockups',outputPath}).pass,true);});

test('verifies declared CSS and rejects tampering',t=>{const f=fixture(t);const css=path.join(f.root,'style.css');fs.writeFileSync(css,'body{color:black}');f.c.assets.push({path:'style.css',sha256:hash(fs.readFileSync(css))});f.writeContract();assert.equal(f.run().pass,true);fs.appendFileSync(css,'bad');assert.equal(f.run().pass,false);});
test('rejects wrong upstream approval hash',t=>{const f=fixture(t);const x=JSON.parse(fs.readFileSync(f.approvalLedger));x.approvals[0].contractSha256='0'.repeat(64);fs.writeFileSync(f.approvalLedger,JSON.stringify(x));assert.equal(f.run().pass,false);});
test('rejects wrong approval arm',t=>{const f=fixture(t);const x=JSON.parse(fs.readFileSync(f.approvalLedger));x.approvals[0].arm='B';fs.writeFileSync(f.approvalLedger,JSON.stringify(x));assert.equal(f.run().pass,false);});
test('rejects changed approved mapping inventory',t=>{const f=fixture(t);f.c.requiredMappings=['SCREEN-HOME/STATE-ERROR/AC-002'];f.c.mappings[0].state='STATE-ERROR';f.c.mappings[0].ac='AC-002';f.writeContract();assert.equal(f.run().pass,false);});
test('rejects ledger inside evidence directory',t=>{const f=fixture(t);const ledger=path.join(f.root,'ledger.json');fs.copyFileSync(f.approvalLedger,ledger);assert.equal(check({stage:'code-generation',outputPath:f.outputPath,approvalLedger:ledger}).pass,false);});
function buildFixture(t) {
 const f=fixture(t);
 const c={...f.c,stage:'build-and-test',upstream:{path:'ui-poc-implementation-contract.md',stage:'code-generation',sha256:hash(fs.readFileSync(f.outputPath))}};
 const outputPath=path.join(f.root,'ui-poc-test-contract.md');
 fs.writeFileSync(outputPath,render(c));
 function approveImplementation() {
   const ledger=JSON.parse(fs.readFileSync(f.approvalLedger));
   ledger.approvals=ledger.approvals.filter(a=>a.stage!=='code-generation');
   ledger.approvals.push({contractSha256:hash(fs.readFileSync(f.outputPath)),stage:'code-generation',arm:'A',status:'approved',source:'synthetic-unit-fixture-only',reviewer:'synthetic-test-reviewer',requiredMappings:c.requiredMappings});
   fs.writeFileSync(f.approvalLedger,JSON.stringify(ledger));
   c.upstream.sha256=hash(fs.readFileSync(f.outputPath));fs.writeFileSync(outputPath,render(c));
 }
 approveImplementation();
 return {...f,build:c,buildOutput:outputPath,approveImplementation,runBuild:()=>check({stage:'build-and-test',outputPath,approvalLedger:f.approvalLedger})};
}
test('build/test validates full refined to implementation hash chain',t=>{const f=buildFixture(t);assert.equal(f.runBuild().pass,true);fs.appendFileSync(path.join(f.root,'upstream.md'),'changed');assert.equal(f.runBuild().pass,false);});
for(const field of ['assets','mappings','upstream'])test('rejects approved implementation missing '+field,t=>{const f=buildFixture(t);delete f.c[field];f.writeContract();f.approveImplementation();assert.equal(f.runBuild().pass,false);});
test('rejects approved parent missing headings',t=>{const f=buildFixture(t);fs.writeFileSync(f.outputPath,'```ui-poc-contract\n'+JSON.stringify(f.c)+'\n```\n');f.approveImplementation();assert.equal(f.runBuild().pass,false);});
test('requires both implementation and refined approval receipts',t=>{const f=buildFixture(t);const ledger=JSON.parse(fs.readFileSync(f.approvalLedger));ledger.approvals=ledger.approvals.filter(a=>a.stage==='code-generation');fs.writeFileSync(f.approvalLedger,JSON.stringify(ledger));assert.equal(f.runBuild().pass,false);});
test('rejects upstream reference back to current contract',t=>{const f=buildFixture(t);f.c.upstream.path='ui-poc-implementation-contract.md';f.writeContract();f.approveImplementation();assert.equal(f.runBuild().pass,false);});
test('rejects recursion over fixed stage-chain depth',t=>{const f=fixture(t);assert.equal(check({stage:'code-generation',outputPath:f.outputPath,approvalLedger:f.approvalLedger},new Set(),'ui-poc-implementation-contract.md',3).pass,false);});
test('rejects previously visited contract identity',t=>{const f=fixture(t);assert.equal(check({stage:'code-generation',outputPath:f.outputPath,approvalLedger:f.approvalLedger},new Set([fs.realpathSync(f.outputPath)])).pass,false);});

test('actual TS adapter emits script verdict JSON on missing input',()=>{const {spawnSync}=require('node:child_process');const r=spawnSync(process.execPath,[path.resolve(__dirname,'../tools/aidlc-sensor-ui-poc-evidence.ts'),'--stage','code-generation','--output-path','/nonexistent-ui-poc-test-input'],{encoding:'utf8'});assert.equal(r.status,0);const o=JSON.parse(r.stdout);assert.equal(o.pass,false);assert.ok(o.findings_count>=1);assert.match(o.findings.join(' '),/(Declared deliverable is missing|ENOENT)/);});
test('regression: approved metadata-only implementation envelope is rejected',t=>{const f=buildFixture(t);const broken={schema:1,stage:'code-generation',arm:'A',requiredMappings:['SCREEN-HOME/STATE-EMPTY/AC-001']};fs.writeFileSync(f.outputPath,'```ui-poc-contract\n'+JSON.stringify(broken)+'\n```\n');f.approveImplementation();assert.equal(f.runBuild().pass,false);});
