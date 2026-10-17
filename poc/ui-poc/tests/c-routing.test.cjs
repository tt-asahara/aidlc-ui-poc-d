'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {plan, verify, load, lockedEntrypoint} = require('../tools/ui-poc-c-routing.cjs');

const root = path.resolve(__dirname, '../../..');
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const expectedStages = [
  'workspace-scaffold','workspace-detection','state-init','intent-capture','market-research','feasibility','scope-definition','team-formation','rough-mockups','approval-handoff',
  'reverse-engineering','practices-discovery','requirements-analysis','user-stories','refined-mockups','domain-design','units-generation','contract-design','delivery-planning',
  'functional-design','nfr-requirements','nfr-design','infrastructure-design','code-generation','build-and-test','ci-pipeline',
  'deployment-pipeline','environment-provisioning','deployment-execution','observability-setup','performance-validation','incident-response','feedback-optimization'
];
function fixture(t, stage='code-generation', facts={}, scope='ui-poc-comparison') {
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'ui-poc-routing-project-')); t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  const record=path.join(project,'aidlc/spaces/default/intents/intent-001');fs.mkdirSync(record,{recursive:true});
  const statePath=path.join(record,'aidlc-state.md');fs.writeFileSync(statePath,'# State\n\n**Scope**: '+scope+'\n**Current Stage**: '+stage+'\n**Last Updated**: attempt-1\n');
  const unit=['code-generation'].includes(stage)?'unit-ui':null;
  const evidence=unit?path.join(record,'construction',unit,stage):path.join(record,'inception',stage); fs.mkdirSync(evidence,{recursive:true});
  fs.mkdirSync(path.join(project,'evidence'),{recursive:true});
  const commonBriefRel='evidence/common-comparison-brief.md',commonBriefFile=path.join(project,commonBriefRel);fs.writeFileSync(commonBriefFile,'Approved common A/B/C comparison brief');
  const confirmationRel='evidence/design-context-confirmation.md',confirmationFile=path.join(project,confirmationRel);fs.writeFileSync(confirmationFile,'Observed AI-DLC question answers supplied by the creator');
  const designContextRel='evidence/creator-confirmed-design-context.json',designContextFile=path.join(project,designContextRel);fs.writeFileSync(designContextFile,JSON.stringify({schema:1,creatorConfirmed:true,source:{kind:'aidlc-questions',path:confirmationRel,sha256:sha256(confirmationFile)},commonBrief:{path:commonBriefRel,sha256:sha256(commonBriefFile)},audience:'operators',useCases:'complete the approved task',brandTone:'calm and precise'}));
  const p=plan(stage,facts,scope), events=[];
  for (const inv of p.invocations.filter(x=>x.decision==='use')) {
    for (const entrypoint of inv.entrypoints) {
      const target=path.join(project,entrypoint); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.copyFileSync(path.join(root,entrypoint),target);
      events.push({type:'skill-read',skill:inv.skill,entrypoint,sha256:sha256(target)});
    }
    const inputs=inv.inputs.map((name,index)=>{
      if (name === 'creator-confirmed-design-context-snapshot') return {name,kind:'file',path:designContextRel,sha256:sha256(designContextFile)};
      return {name,kind:'value',value:`bounded ${name}`};
    });
    const outputs=inv.outputs.map((name,index)=>{if(name==='creator-confirmed-design-context-snapshot')return {name,kind:'file',path:designContextRel,sha256:sha256(designContextFile)};const rel=`evidence/${name}-${index}.json`,file=path.join(project,rel);fs.writeFileSync(file,name==='accessibility-correction-report'?JSON.stringify({schema:1,pinnedSourcePreserved:true,sourceStatement:'18px+ or 14px bold',normalCssPx:24,boldCssPx:18.6667,normativeBasis:'WCAG 18pt or 14pt bold'}):JSON.stringify({artifact:`actual ${name}`}));return {name,kind:'file',path:rel,sha256:sha256(file)};});
    events.push({type:'skill-applied',skill:inv.skill,inputs,outputs});
  }
  for (const inv of p.invocations.filter(x=>x.decision==='do-not-use'&&x.condition)) events.push({type:'skill-skipped',skill:inv.skill,condition:inv.condition,reason:'explicit false fact'});
  const factsPath=path.join(evidence,'ui-poc-routing-facts.json'); fs.writeFileSync(factsPath,JSON.stringify(facts));
  const context={stage,scope,recordId:'intent-001',attempt:1,unit,engineStateSha256:sha256(statePath)};
  const contextPath=path.join(evidence,'ui-poc-routing-context.json'); fs.writeFileSync(contextPath,JSON.stringify(context));
  const outputPath=path.join(evidence,'stage-output.md'); fs.writeFileSync(outputPath,'stage output');
  const logPath=path.join(evidence,'ui-poc-skill-evidence.json');
  const write=()=>fs.writeFileSync(logPath,JSON.stringify({schema:1,runtimeProfile:p.runtimeProfile,comparisonTreatment:p.comparisonTreatment,stage,configSha256:p.configSha256,context,contextSha256:sha256(contextPath),factsSha256:sha256(factsPath),events})); write();
  return {project,record,statePath,evidence,p,events,facts,context,factsPath,contextPath,outputPath,logPath,write};
}

test('routing explicitly covers every core stage', () => {
  assert.deepEqual(Object.keys(load().stages).sort(), expectedStages.sort());
});
test('routing config is the single source for enabled scopes and separates application runtime from comparison treatment', () => {
  assert.deepEqual(Object.keys(load().runtimeProfiles).sort(), ['ui-poc-application','ui-poc-comparison']);
  assert.equal(plan('build-and-test', {}, 'ui-poc-comparison').comparisonTreatment, 'C');
  assert.equal(plan('build-and-test', {}, 'ui-poc-application').comparisonTreatment, null);
  assert.equal(plan('build-and-test', {}, 'ui-poc-application').runtimeProfile, 'application-c');
  assert.equal(plan('build-and-test', {}, 'poc').pass, false);
});
test('ordinary UI routing is distinct, reproducible, and preserves explicit choice semantics', () => {
  const scope=fs.readFileSync(path.join(root,'poc/ui-poc/scopes/ui-poc-application.md'),'utf8');
  assert.match(scope,/name: ui-poc-application/);
  for(const keyword of ['web app','dashboard','website','frontend','user interface','mobile app']) assert.ok(scope.includes(`  - ${keyword}`));
  assert.match(scope,/Explicit user scope and execution choices always win/);
  const delivery=fs.readFileSync(path.join(root,'core/aidlc-common/stages/inception/delivery-planning.md'),'utf8');
  assert.match(delivery,/ready Units with\s+disjoint write sets/);
  assert.match(delivery,/wait for the person's answer at the official gate/);
  const readme=fs.readFileSync(path.join(root,'poc/ui-poc/README.md'),'utf8');
  assert.match(readme,/\/aidlc\nBuild a household budget web app/);
  assert.doesNotMatch(readme,/\/aidlc --scope ui-poc-comparison/);
});
test('unrelated stages deterministically select no skills', () => {
  assert.deepEqual(plan('build-and-test', {}, 'ui-poc-comparison').invocations, []);
  assert.deepEqual(plan('functional-design', {}, 'ui-poc-application').invocations, []);
});
test('conditional routing fails closed on missing fact', () => {
  assert.equal(plan('requirements-analysis', {}, 'ui-poc-comparison').pass, false);
});
test('conditional false records do-not-use without invocation', () => {
  const p = plan('requirements-analysis', {unresolved_requirement_decisions:false, domain_language_conflict:false}, 'ui-poc-comparison');
  assert.equal(p.pass, true);
  assert.ok(p.invocations.every(x => x.decision === 'do-not-use'));
});
test('routing facts must be booleans', () => {
  assert.equal(plan('domain-design', {unresolved_domain_terms_or_boundaries:'false'}, 'ui-poc-comparison').pass, false);
});
test('rough routing requires context and logic facts and uses bounded adapters', () => {
  const p = plan('rough-mockups', {design_context_missing:false,state_model_uncertainty:false}, 'ui-poc-comparison');
  assert.equal(p.pass, true);
  assert.equal(p.invocations[1].applicationKind, 'bounded-adapter');
  assert.equal(p.invocations[0].decision, 'do-not-use');
  assert.equal(p.invocations[3].decision, 'do-not-use');
});
test('to-spec is disabled in every lifecycle stage', () => {
  for (const stage of expectedStages) assert.ok(!(load().stages[stage] || []).some(x => x.skill === 'to-spec'));
  assert.equal(load().skills['to-spec'].lifecyclePolicy, 'disabled');
});
test('verified evidence distinguishes reads, application, approval and publication', t => {
  const f=fixture(t),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));
  const options={contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath};
  assert.equal(verify('code-generation',f.logPath,f.facts,options).pass,true);
  f.events.push({type:'approval'});f.write();
  assert.equal(verify('code-generation',f.logPath,f.facts,options).pass,false);
});
test('application scope verifies through the real routing contract without comparison-treatment metadata', t => {
  const f=fixture(t,'code-generation',{},'ui-poc-application'),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));
  assert.equal(f.p.runtimeProfile,'application-c');
  assert.equal(f.p.comparisonTreatment,null);
  assert.equal(verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath}).pass,true);
});
test('rejects a forged context scope even when it names another enabled profile', t => {
  const f=fixture(t,'code-generation',{},'ui-poc-application'),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));
  f.context.scope='ui-poc-comparison';fs.writeFileSync(f.contextPath,JSON.stringify(f.context));f.write();
  const result=verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});
  assert.equal(result.pass,false);assert.match(result.findings[0],/Invalid routing execution context/);
});
test('rejects an engine scope outside the routing config allowlist', t => {
  const f=fixture(t),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));
  fs.writeFileSync(f.statePath,'# State\n\n**Scope**: poc\n**Current Stage**: code-generation\n**Last Updated**: attempt-1\n');
  const result=verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});
  assert.equal(result.pass,false);assert.match(result.findings[0],/not enabled by the routing config/);
});
test('rejects skill-applied evidence for an unselected disabled skill', t => {
  const f=fixture(t),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));
  f.events.push({type:'skill-applied',skill:'to-spec',inputs:[],outputs:[]});f.write();
  const result = verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});
  assert.equal(result.pass,false);
  assert.match(result.findings[0],/Unselected or disabled skill was applied: to-spec/);
});
test('rejects modified payload even when the log reports its matching sha256', t => {
  const f=fixture(t),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));
  const event=f.events.find(x=>x.type==='skill-read'),target=path.join(f.project,event.entrypoint);fs.appendFileSync(target,'\nmodified');event.sha256=sha256(target);f.write();
  const result=verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});
  assert.equal(result.pass,false);
  assert.match(result.findings[0],/differs from source-lock/);
});
test('rejects evidence reused from a different attempt', t => {
  const f=fixture(t),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));
  f.context.attempt=2;fs.writeFileSync(f.contextPath,JSON.stringify(f.context));
  const result=verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});
  assert.equal(result.pass,false);assert.match(result.findings[0],/not bound to the current context and facts/);
});
test('rejects an old context and log bundle after engine state advances', t => {
  const f=fixture(t),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));
  fs.writeFileSync(f.statePath,'# State\n\n**Scope**: ui-poc-comparison\n**Current Stage**: code-generation\n**Last Updated**: attempt-2\n');
  const result=verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});
  assert.equal(result.pass,false);assert.match(result.findings[0],/does not match the current engine record, Unit, and state snapshot/);
  const dispatched=spawnSync(process.execPath,[path.join(root,'poc/ui-poc/tools/aidlc-sensor-ui-poc-evidence.ts'),'--stage','code-generation','--output-path',f.outputPath],{cwd:f.project,encoding:'utf8'});
  assert.equal(dispatched.status,0);const out=JSON.parse(dispatched.stdout);assert.equal(out.pass,false);assert.match(out.findings.join(' '),/does not match the current engine record, Unit, and state snapshot/);
});
test('rejects symbolic output names without actual hashed artifacts', t => {
  const f=fixture(t),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));
  f.events.find(x=>x.type==='skill-applied').outputs=f.p.invocations[0].outputs;f.write();
  const result=verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});
  assert.equal(result.pass,false);assert.match(result.findings[0],/(Incomplete skill-applied output evidence|Invalid output reference kind)/);
});
test('routing pins exact upstream commits and installed entrypoints', () => {
  const cfg=load();
  assert.equal(cfg.sourceCommit,'49dd158d1076134a641b33efb035946536778336');
  assert.equal(cfg.designCommit,'209444a9d552c18bcaa74e26bf66a25fc568a767');
  assert.deepEqual(cfg.accessibilityCorrections,{largeTextNormalCssPx:24,largeTextBoldCssPx:18.6667,sourceStatement:'18px+ or 14px bold',normativeBasis:'WCAG 18pt or 14pt bold; 1pt = 1.333 CSS px'});
  for (const [name,skill] of Object.entries(cfg.skills)) for (const entrypoint of skill.entrypoints) {
    const bytes=fs.readFileSync(path.join(root,entrypoint)),locked=lockedEntrypoint(name,entrypoint);
    assert.equal(bytes.length,locked.bytes);
    assert.equal(crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),locked.git_blob_sha);
  }
});
test('frontend design requires hashed creator-confirmed context and correction report', t => {
  const f=fixture(t),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));
  const applied=f.events.find(x=>x.type==='skill-applied'&&x.skill==='frontend-design');applied.inputs.find(x=>x.name==='creator-confirmed-design-context-snapshot').kind='value';f.write();
  const result=verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});assert.equal(result.pass,false);assert.match(result.findings[0],/creator-confirmed|Invalid bounded value input/);
});
test('rejects a context snapshot without observed confirmation and common brief binding',t=>{const f=fixture(t),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));const ref=f.events.find(x=>x.type==='skill-applied'&&x.skill==='frontend-design').inputs.find(x=>x.name==='creator-confirmed-design-context-snapshot');fs.writeFileSync(path.join(f.project,ref.path),JSON.stringify({schema:1,creatorConfirmed:false,source:{kind:'code-inference'}}));ref.sha256=sha256(path.join(f.project,ref.path));f.write();const result=verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});assert.equal(result.pass,false);assert.match(result.findings[0],/observed confirmation/);});
test('rejects a fabricated confirmation-source hash',t=>{const f=fixture(t),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));const ref=f.events.find(x=>x.type==='skill-applied'&&x.skill==='frontend-design').inputs.find(x=>x.name==='creator-confirmed-design-context-snapshot'),file=path.join(f.project,ref.path),value=JSON.parse(fs.readFileSync(file));value.source.sha256='b'.repeat(64);fs.writeFileSync(file,JSON.stringify(value));ref.sha256=sha256(file);f.write();const result=verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});assert.equal(result.pass,false);assert.match(result.findings[0],/confirmation source hash mismatch/);});
test('rejects a fabricated common-brief hash',t=>{const f=fixture(t),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));const ref=f.events.find(x=>x.type==='skill-applied'&&x.skill==='frontend-design').inputs.find(x=>x.name==='creator-confirmed-design-context-snapshot'),file=path.join(f.project,ref.path),value=JSON.parse(fs.readFileSync(file));value.commonBrief.sha256='c'.repeat(64);fs.writeFileSync(file,JSON.stringify(value));ref.sha256=sha256(file);f.write();const result=verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});assert.equal(result.pass,false);assert.match(result.findings[0],/common comparison brief hash mismatch/);});
test('rejects the pinned source large-text values in the correction report',t=>{const f=fixture(t),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));const ref=f.events.find(x=>x.type==='skill-applied'&&x.skill==='frontend-design').outputs.find(x=>x.name==='accessibility-correction-report');fs.writeFileSync(path.join(f.project,ref.path),JSON.stringify({schema:1,pinnedSourcePreserved:true,sourceStatement:'18px+ or 14px bold',normalCssPx:18,boldCssPx:14,normativeBasis:'source'}));ref.sha256=sha256(path.join(f.project,ref.path));f.write();const result=verify('code-generation',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});assert.equal(result.pass,false);assert.match(result.findings[0],/declared pinned-source adapter/);});
test('rough stage requires explicit Design Context routing fact',()=>{assert.equal(plan('rough-mockups',{state_model_uncertainty:false},'ui-poc-comparison').pass,false);});
test('false context setup records an evidenced teach-impeccable skip',t=>{const f=fixture(t,'rough-mockups',{design_context_missing:false,state_model_uncertainty:false}),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));const result=verify('rough-mockups',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});assert.equal(result.pass,true);assert.ok(f.events.some(x=>x.type==='skill-skipped'&&x.skill==='teach-impeccable'));});
test('selected teach output must be the exact subsequent design input',t=>{const f=fixture(t,'rough-mockups',{design_context_missing:true,state_model_uncertainty:false}),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));const design=f.events.find(x=>x.type==='skill-applied'&&x.skill==='frontend-design'),ref=design.inputs.find(x=>x.name==='creator-confirmed-design-context-snapshot');const rel='evidence/substituted-context.json',file=path.join(f.project,rel);fs.copyFileSync(path.join(f.project,ref.path),file);ref.path=rel;ref.sha256=sha256(file);f.write();const result=verify('rough-mockups',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});assert.equal(result.pass,false);assert.match(result.findings[0],/exact frontend-design context input/);});
test('selected teach must complete before frontend design',t=>{const f=fixture(t,'rough-mockups',{design_context_missing:true,state_model_uncertainty:false}),old=process.cwd();process.chdir(f.project);t.after(()=>process.chdir(old));const teach=f.events.findIndex(x=>x.type==='skill-applied'&&x.skill==='teach-impeccable'),design=f.events.findIndex(x=>x.type==='skill-applied'&&x.skill==='frontend-design');[f.events[teach],f.events[design]]=[f.events[design],f.events[teach]];f.write();const result=verify('rough-mockups',f.logPath,f.facts,{contextPath:f.contextPath,factsPath:f.factsPath,outputPath:f.outputPath});assert.equal(result.pass,false);assert.match(result.findings[0],/complete before frontend-design/);});
test('C rejects the Anthropic frontend-design identity',()=>{assert.equal(load().skills['frontend-design'].repository,'pbakaus/impeccable');assert.ok(!JSON.stringify(load()).includes('anthropics/skills'));});
test('sensor dispatch adapter fails when routing evidence is missing', t => {
  const facts={unresolved_requirement_decisions:false,domain_language_conflict:false},f=fixture(t,'requirements-analysis',facts);
  fs.unlinkSync(f.logPath);
  const r=spawnSync(process.execPath,[path.join(root,'poc/ui-poc/tools/aidlc-sensor-ui-poc-evidence.ts'),'--stage','requirements-analysis','--output-path',f.outputPath],{cwd:f.project,encoding:'utf8'});
  assert.equal(r.status,0);const out=JSON.parse(r.stdout);assert.equal(out.pass,false);assert.match(out.findings.join(' '),/Unreadable evidence log/);
});
test('sensor dispatch adapter rejects forbidden skill application', t => {
  const facts={unresolved_requirement_decisions:false,domain_language_conflict:false},f=fixture(t,'requirements-analysis',facts);
  f.events.push({type:'skill-applied',skill:'to-spec',inputs:[],outputs:[]});f.write();
  const r=spawnSync(process.execPath,[path.join(root,'poc/ui-poc/tools/aidlc-sensor-ui-poc-evidence.ts'),'--stage','requirements-analysis','--output-path',f.outputPath],{cwd:f.project,encoding:'utf8'});
  assert.equal(r.status,0);const out=JSON.parse(r.stdout);assert.equal(out.pass,false);assert.match(out.findings.join(' '),/Unselected or disabled skill was applied: to-spec/);
});
test('real sensor dispatcher records failed when routing log is missing', t => {
  const facts={unresolved_requirement_decisions:false,domain_language_conflict:false},f=fixture(t,'requirements-analysis',facts);
  fs.unlinkSync(f.logPath);
  const dispatcher=path.join(root,'dist/claude/.claude/tools/aidlc-sensor.ts');
  assert.ok(fs.existsSync(dispatcher),'run bun scripts/package.ts before this integration test');
  const r=spawnSync('bun',[dispatcher,'fire','ui-poc-evidence','--stage','requirements-analysis','--output-path',f.outputPath],{cwd:root,encoding:'utf8',env:{...process.env,CLAUDE_PROJECT_DIR:f.project,AIDLC_SENSORS_DIR:path.join(root,'poc/ui-poc/sensors'),AIDLC_SENSOR_SCRIPT_DIR:path.join(root,'poc/ui-poc/tools')}});
  assert.equal(r.status,0,`${r.stdout}${r.stderr}`);const out=JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));assert.equal(out.result,'failed');
});
