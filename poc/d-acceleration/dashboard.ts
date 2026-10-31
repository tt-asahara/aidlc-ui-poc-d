#!/usr/bin/env bun
// The space's workflow dashboard: one self-contained HTML page (and a short
// text summary) over every intent's official record, so a person sees where
// the work stands without reading state files.
//
//   bun dashboard.ts [--project-dir ABS] [--output html|text] [--quiet]
//     html (default) writes aidlc/spaces/<space>/dashboard.html and prints its path
//     text prints the summary only
//
// Read-only over AI-DLC: it reads each record's aidlc-state.md and audit
// shards through core (listIntents, readStateFile, readAuditShardEvents,
// auditBlockField) and writes only the dashboard file. It never writes state,
// emits an audit event, or calls the network. The page has no external asset:
// a JSON payload plus inline CSS and JS, so it opens from the filesystem.
//
// Views: ワークフロー (where the active intent stands, phases, recent events),
// Intent 一覧, タイムライン (intent bars over real time), ボード (Construction
// Bolts by state), ループ (each stage's start, end, duration, and reruns), and
// Issue (intents taken from a GitHub Issue by D's intake). Milestones and DORA
// metrics are not shown: the official record has no source for them.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import {
  activeSpace, auditBlockField, getField, listIntents, readAuditShardEvents, readStateFile, spacesRoot,
} from "../../core/tools/aidlc-lib.ts";

export type StageRow = { slug: string; phase: string; mark: string; plan: string };
export type StageTiming = { stage: string; startedAt: string | null; endedAt: string | null; ms: number | null; starts: number };
export type BoltRow = { name: string; batch: string | null; state: "running" | "completed" | "failed"; startedAt: string | null; endedAt: string | null };
export type EventRow = { at: string; event: string; stage: string | null; unit: string | null };
export type IntentRow = {
  dir: string; slug: string; status: string; scope: string; active: boolean; project: string;
  startedAt: string | null; lastAt: string | null; current: string | null; completed: number; total: number;
  phases: { name: string; status: string }[]; stages: StageRow[]; timings: StageTiming[]; bolts: BoltRow[];
  units: { name: string; state: "running" | "completed" }[]; events: EventRow[]; sensorFailures: number;
  issue: { repository: string; number: number } | null;
  usage: { tokensIn: number; tokensOut: number; costUsd: number | null } | null;
};
export type Dashboard = { space: string; generatedAt: string; intents: IntentRow[] };

const RECENT_EVENTS = 40;
const MARKS: Record<string, string> = { "x": "完了", "-": "進行中", "?": "承認待ち", "R": "差し戻し", "S": "スキップ", " ": "未着手" };

/** `## Phase Progress` and `## Stage Progress` of one state file. */
export function parseProgress(state: string): { phases: IntentRow["phases"]; stages: StageRow[] } {
  const section = (name: string) => {
    const at = state.indexOf(`\n## ${name}`);
    if (at < 0) return "";
    const next = state.indexOf("\n## ", at + 4);
    return state.slice(at, next < 0 ? undefined : next);
  };
  const phases = [...section("Phase Progress").matchAll(/^- \*\*([A-Za-z]+)\*\*:\s*(\S+)/gm)].map((m) => ({ name: m[1]!, status: m[2]! }));
  const stages: StageRow[] = [];
  let phase = "";
  for (const line of section("Stage Progress").split("\n")) {
    const heading = /^### ([A-Z]+) PHASE/.exec(line);
    if (heading) { phase = heading[1]!; continue; }
    const row = /^- \[(.)\] ([a-z0-9-]+)(?: — (\w+))?/.exec(line);
    if (row) stages.push({ slug: row[2]!, phase, mark: row[1]!, plan: row[3] ?? "" });
  }
  return { phases, stages };
}

const ms = (from: string | null, to: string | null) => from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : null;
const number = (text: string | null) => text !== null && text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : null;

/** Everything one record shows, from its state text and its audit events. */
export function intentRow(info: { dirName: string; slug: string; status: string; scope?: string; active: boolean }, state: string, events: { event: string; timestamp: string; block: string }[]): IntentRow {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const field = (block: string, name: string) => auditBlockField(block, name);
  const { phases, stages } = parseProgress(state);
  const timings = new Map<string, StageTiming>();
  const bolts = new Map<string, BoltRow>(), units = new Map<string, "running" | "completed">();
  let sensorFailures = 0;
  const usage = { tokensIn: 0, tokensOut: 0, costUsd: null as number | null, seen: false };
  for (const row of sorted) {
    const stage = field(row.block, "Stage");
    if (stage && (row.event === "STAGE_STARTED" || row.event === "STAGE_COMPLETED")) {
      const timing = timings.get(stage) ?? { stage, startedAt: null, endedAt: null, ms: null, starts: 0 };
      if (row.event === "STAGE_STARTED") { timing.starts++; timing.startedAt ??= row.timestamp; }
      else timing.endedAt = row.timestamp;
      timing.ms = ms(timing.startedAt, timing.endedAt);
      timings.set(stage, timing);
    }
    if (row.event === "STAGE_COMPLETED") {
      const tin = number(field(row.block, "Tokens In")), tout = number(field(row.block, "Tokens Out")), cost = number(field(row.block, "Cost USD"));
      if (tin !== null || tout !== null) { usage.seen = true; usage.tokensIn += tin ?? 0; usage.tokensOut += tout ?? 0; }
      if (cost !== null) usage.costUsd = (usage.costUsd ?? 0) + cost;
    }
    const unit = field(row.block, "Unit");
    if (unit && row.event === "UNIT_STARTED") units.set(unit, "running");
    if (unit && row.event === "UNIT_COMPLETED") units.set(unit, "completed");
    if (row.event.startsWith("BOLT_")) {
      const name = field(row.block, "Bolt names") ?? field(row.block, "Bolt slug") ?? "(名前なし)";
      const bolt = bolts.get(name) ?? { name, batch: field(row.block, "Batch number"), state: "running" as const, startedAt: null, endedAt: null };
      if (row.event === "BOLT_STARTED") { bolt.state = "running"; bolt.startedAt ??= row.timestamp; bolt.endedAt = null; }
      if (row.event === "BOLT_COMPLETED") { bolt.state = "completed"; bolt.endedAt = row.timestamp; }
      if (row.event === "BOLT_FAILED") { bolt.state = "failed"; bolt.endedAt = row.timestamp; }
      bolts.set(name, bolt);
    }
    if (row.event === "SENSOR_FAILED") sensorFailures++;
  }
  const intake = /AIDLC-INTAKE: (\{[^}\n]*\})/.exec(state) ?? /AIDLC-INTAKE: (\{[^}\n]*\})/.exec(sorted.find((row) => row.event === "WORKFLOW_STARTED")?.block ?? "");
  let issue: IntentRow["issue"] = null;
  try {
    const parsed = intake ? JSON.parse(intake[1]!) as { repository?: string; issueNumber?: number } : null;
    if (parsed && typeof parsed.repository === "string" && Number.isInteger(parsed.issueNumber)) issue = { repository: parsed.repository, number: parsed.issueNumber! };
  } catch { issue = null; }
  const project = (getField(state, "Project") ?? "").replace(/\s*AIDLC-INTAKE:.*$/s, "").trim();
  return {
    dir: info.dirName, slug: info.slug, status: info.status, scope: getField(state, "Scope") ?? info.scope ?? "", active: info.active,
    project: project.length > 120 ? `${project.slice(0, 119)}…` : project,
    startedAt: getField(state, "Start Date") ?? sorted[0]?.timestamp ?? null, lastAt: sorted.at(-1)?.timestamp ?? null,
    current: getField(state, "In Progress") || null,
    completed: stages.filter((stage) => stage.mark === "x").length,
    total: stages.filter((stage) => stage.plan !== "SKIP").length,
    phases, stages, timings: [...timings.values()], bolts: [...bolts.values()],
    units: [...units].map(([name, state]) => ({ name, state })),
    events: sorted.slice(-RECENT_EVENTS).reverse().map((row) => ({ at: row.timestamp, event: row.event, stage: field(row.block, "Stage"), unit: field(row.block, "Unit") })),
    sensorFailures, issue,
    usage: usage.seen || usage.costUsd !== null ? { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd } : null,
  };
}

export function collect(projectDir: string, now = new Date()): Dashboard {
  const space = activeSpace(projectDir);
  const intents: IntentRow[] = [];
  for (const info of listIntents(projectDir, space)) {
    if (!info.dirName) continue;
    let state = "";
    try { state = readStateFile(projectDir, info.dirName, space); } catch { state = ""; }
    let events: { event: string; timestamp: string; block: string }[] = [];
    try { events = readAuditShardEvents(projectDir, info.dirName, space); } catch { events = []; }
    intents.push(intentRow({ ...info, dirName: info.dirName }, state, events));
  }
  return { space, generatedAt: now.toISOString(), intents };
}

export function dashboardPath(projectDir: string, space: string): string {
  return join(spacesRoot(projectDir), space, "dashboard.html");
}

const pct = (row: IntentRow) => row.total ? Math.round((row.completed / row.total) * 100) : 0;

export function renderText(data: Dashboard): string {
  if (!data.intents.length) return `AI-DLC ダッシュボード（space: ${data.space}）\nまだ intent がありません。/aidlc で作りたいものを伝えると始まります。\n`;
  const lines = [`AI-DLC ダッシュボード（space: ${data.space}）`];
  for (const row of data.intents) {
    const bar = "█".repeat(Math.round(pct(row) / 10)).padEnd(10, "░");
    lines.push(`${row.active ? "▶" : " "} ${row.slug}  [${bar}] ${row.completed}/${row.total}  ${row.current ? `現在: ${row.current}` : row.status}${row.sensorFailures ? `  センサー失敗 ${row.sensorFailures}` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

const escapeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export function renderHtml(data: Dashboard): string {
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI-DLC ダッシュボード — ${data.space.replace(/[<&"]/g, "")}</title>
<style>${STYLE}</style></head>
<body><div class="viz-root">
<header><h1>AI-DLC ダッシュボード</h1><p class="meta" id="meta"></p></header>
<div class="filters"><input id="q" type="search" placeholder="intent・ステージを検索" aria-label="検索">
<select id="scope" aria-label="スコープ"><option value="">すべてのスコープ</option></select>
<select id="status" aria-label="状態"><option value="">すべての状態</option></select></div>
<nav role="tablist" id="tabs"></nav><main id="view"></main><div id="tip" role="tooltip" hidden></div>
</div>
<script id="payload" type="application/json">${escapeJson(data)}</script>
<script>${SCRIPT}</script></body></html>
`;
}

export function writeDashboard(projectDir: string, now = new Date()): { path: string; intents: number; text: string } {
  const data = collect(projectDir, now), path = dashboardPath(projectDir, data.space);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderHtml(data));
  return { path, intents: data.intents.length, text: renderText(data) };
}

const STYLE = `
.viz-root,:root{color-scheme:light;--surface-1:#fcfcfb;--surface-2:#f2f1ee;--line:#e2e1dc;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#7a7974;--series-1:#2a78d6;--good:#0ca30c;--warning:#fab219;--serious:#ec835a;--critical:#d03b3b}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])),:root:where(:not([data-theme="light"])) .viz-root{color-scheme:dark;--surface-1:#1a1a19;--surface-2:#242422;--line:#3a3a37;--text-primary:#f0efec;--text-secondary:#c3c2b7;--text-muted:#94938b;--series-1:#3987e5}}
*{box-sizing:border-box}body{margin:0;background:var(--surface-1)}
.viz-root{min-height:100vh;background:var(--surface-1);color:var(--text-primary);font:14px/1.5 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;padding:24px;max-width:1200px;margin:0 auto}
h1{font-size:20px;margin:0}.meta{color:var(--text-secondary);margin:4px 0 16px}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
input,select{font:inherit;color:inherit;background:var(--surface-1);border:1px solid var(--line);border-radius:6px;padding:6px 10px}
input:focus-visible,select:focus-visible,button:focus-visible{outline:2px solid var(--series-1);outline-offset:2px}
nav{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px;overflow-x:auto}
nav button{font:inherit;color:var(--text-secondary);background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px;cursor:pointer;white-space:nowrap}
nav button[aria-selected="true"]{color:var(--text-primary);border-bottom-color:var(--series-1)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--text-secondary);font-weight:600}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.card{background:var(--surface-2);border-radius:8px;padding:12px 14px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.hero{font-size:28px;font-weight:600}.label{color:var(--text-secondary);font-size:12px}
.track{height:8px;background:var(--line);border-radius:4px;overflow:hidden}.fill{height:100%;background:var(--series-1);border-radius:4px}
.status{display:inline-flex;align-items:center;gap:4px;color:var(--text-primary)}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.board{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.col h3{font-size:14px;margin:0 0 8px}
.bolt{background:var(--surface-1);border:1px solid var(--line);border-radius:6px;padding:8px;margin-bottom:8px}
.bars .row{display:grid;grid-template-columns:200px 1fr 90px;gap:8px;align-items:center;margin:4px 0}
.bars .bar{height:12px;background:var(--series-1);border-radius:0 4px 4px 0;min-width:2px}
.timeline{position:relative}.tl-row{display:grid;grid-template-columns:200px 1fr;gap:8px;align-items:center;margin:6px 0}
.tl-lane{position:relative;height:14px;background:var(--surface-2);border-radius:4px}.tl-bar{position:absolute;top:0;height:14px;background:var(--series-1);border-radius:4px}
.empty{color:var(--text-muted);padding:16px 0}
#tip{position:fixed;pointer-events:none;background:var(--text-primary);color:var(--surface-1);padding:6px 8px;border-radius:4px;font-size:12px;max-width:320px;z-index:10}
@media (max-width:720px){.board{grid-template-columns:1fr}.bars .row,.tl-row{grid-template-columns:120px 1fr}.bars .row span:last-child{display:none}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const SCRIPT = `
(function(){
var data=JSON.parse(document.getElementById('payload').textContent);
var MARK=${JSON.stringify(MARKS)};
var STATUS={completed:['good','完了','✓'],running:['warning','進行中','●'],failed:['critical','失敗','✕']};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function when(t){if(!t)return '—';var d=new Date(t);return isNaN(d)?esc(t):d.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}
function dur(ms){if(ms==null)return '—';if(ms<60000)return '1分未満';var m=Math.round(ms/60000);if(m<60)return m+'分';var h=Math.floor(m/60);return h<48?h+'時間'+(m%60)+'分':Math.round(h/24)+'日';}
function pct(r){return r.total?Math.round(r.completed/r.total*100):0;}
function badge(k){var s=STATUS[k];return '<span class="status"><span class="dot" style="background:var(--'+s[0]+')"></span>'+s[2]+' '+s[1]+'</span>';}
document.getElementById('meta').textContent='space: '+data.space+' ・ intent '+data.intents.length+'件 ・ 更新 '+when(data.generatedAt);
var scopes={},statuses={};data.intents.forEach(function(r){scopes[r.scope]=1;statuses[r.status]=1;});
function fill(id,keys){var el=document.getElementById(id);Object.keys(keys).filter(Boolean).sort().forEach(function(k){var o=document.createElement('option');o.value=k;o.textContent=k;el.appendChild(o);});}
fill('scope',scopes);fill('status',statuses);
function rows(){var q=document.getElementById('q').value.toLowerCase(),sc=document.getElementById('scope').value,st=document.getElementById('status').value;
return data.intents.filter(function(r){return (!sc||r.scope===sc)&&(!st||r.status===st)&&(!q||(r.slug+' '+r.project+' '+(r.current||'')+' '+r.stages.map(function(s){return s.slug;}).join(' ')).toLowerCase().indexOf(q)>=0);});}
function active(list){return list.filter(function(r){return r.active;})[0]||list[0];}
var VIEWS=[['workflow','ワークフロー',workflow],['intents','Intent 一覧',intents],['timeline','タイムライン',timeline],['board','ボード',board],['loops','ループ',loops],['issues','Issue',issues]];
var current=(location.hash||'').slice(1)||'workflow';
function workflow(list){var r=active(list);if(!r)return empty();
var h='<div class="grid"><div class="card"><div class="label">現在の intent</div><div class="hero">'+esc(r.slug)+'</div><div class="label">'+esc(r.scope)+'</div></div>'
+'<div class="card"><div class="label">進み具合</div><div class="hero">'+pct(r)+'%</div><div class="track"><div class="fill" style="width:'+pct(r)+'%"></div></div><div class="label">'+r.completed+' / '+r.total+' ステージ</div></div>'
+'<div class="card"><div class="label">いまのステージ</div><div class="hero">'+esc(r.current||'—')+'</div></div>'
+'<div class="card"><div class="label">センサー失敗</div><div class="hero">'+r.sensorFailures+'</div></div>'
+(r.usage?'<div class="card"><div class="label">トークン（入力 / 出力）</div><div class="hero">'+(r.usage.tokensIn+r.usage.tokensOut).toLocaleString()+'</div><div class="label">'+r.usage.tokensIn.toLocaleString()+' / '+r.usage.tokensOut.toLocaleString()+(r.usage.costUsd!=null?' ・ $'+r.usage.costUsd.toFixed(2):'')+'</div></div>':'<div class="card"><div class="label">トークン</div><div class="label">記録なし（Claude Code 以外では記録されません）</div></div>')
+'</div><h2>フェーズ</h2><table><tr><th>フェーズ</th><th>状態</th></tr>'+r.phases.map(function(p){return '<tr><td>'+esc(p.name)+'</td><td>'+esc(p.status)+'</td></tr>';}).join('')+'</table>'
+'<h2>ステージ</h2><table><tr><th>フェーズ</th><th>ステージ</th><th>状態</th></tr>'+r.stages.filter(function(s){return s.plan!=='SKIP';}).map(function(s){return '<tr><td>'+esc(s.phase)+'</td><td>'+esc(s.slug)+'</td><td>'+esc(MARK[s.mark]||s.mark)+'</td></tr>';}).join('')+'</table>'
+'<h2>最近の出来事</h2><table><tr><th>時刻</th><th>出来事</th><th>ステージ</th><th>Unit</th></tr>'+r.events.map(function(e){return '<tr><td>'+when(e.at)+'</td><td>'+esc(e.event)+'</td><td>'+esc(e.stage||'')+'</td><td>'+esc(e.unit||'')+'</td></tr>';}).join('')+'</table>';return h;}
function intents(list){if(!list.length)return empty();return '<table><tr><th>intent</th><th>スコープ</th><th>状態</th><th class="num">進み具合</th><th>いまのステージ</th><th>開始</th><th>最終更新</th></tr>'+list.map(function(r){return '<tr><td>'+(r.active?'▶ ':'')+esc(r.slug)+'<div class="label">'+esc(r.project)+'</div></td><td>'+esc(r.scope)+'</td><td>'+esc(r.status)+'</td><td class="num">'+r.completed+'/'+r.total+'（'+pct(r)+'%）</td><td>'+esc(r.current||'—')+'</td><td>'+when(r.startedAt)+'</td><td>'+when(r.lastAt)+'</td></tr>';}).join('')+'</table>';}
function timeline(list){var spans=list.filter(function(r){return r.startedAt&&r.lastAt;});if(!spans.length)return empty();
var lo=Math.min.apply(null,spans.map(function(r){return Date.parse(r.startedAt);})),hi=Math.max.apply(null,spans.map(function(r){return Date.parse(r.lastAt);}));var w=Math.max(1,hi-lo);
return '<p class="label">'+when(new Date(lo).toISOString())+' 〜 '+when(new Date(hi).toISOString())+'</p><div class="timeline">'+spans.map(function(r){var a=Date.parse(r.startedAt),b=Date.parse(r.lastAt);var left=(a-lo)/w*100,width=Math.max(0.5,(b-a)/w*100);
return '<div class="tl-row"><div>'+esc(r.slug)+'</div><div class="tl-lane"><div class="tl-bar" style="left:'+left+'%;width:'+width+'%" data-tip="'+esc(r.slug+'：'+when(r.startedAt)+' 〜 '+when(r.lastAt)+'（'+dur(b-a)+'）')+'"></div></div></div>';}).join('')+'</div>'
+'<table><tr><th>intent</th><th>開始</th><th>最終更新</th><th class="num">期間</th></tr>'+spans.map(function(r){return '<tr><td>'+esc(r.slug)+'</td><td>'+when(r.startedAt)+'</td><td>'+when(r.lastAt)+'</td><td class="num">'+dur(Date.parse(r.lastAt)-Date.parse(r.startedAt))+'</td></tr>';}).join('')+'</table>';}
function board(list){var bolts=[];list.forEach(function(r){r.bolts.forEach(function(b){bolts.push([r,b]);});});if(!bolts.length)return '<p class="empty">Construction の Bolt はまだありません。</p>';
return '<div class="board">'+['running','completed','failed'].map(function(k){var col=bolts.filter(function(x){return x[1].state===k;});return '<div class="col"><h3>'+badge(k)+'（'+col.length+'）</h3>'+col.map(function(x){var b=x[1];return '<div class="bolt"><strong>'+esc(b.name)+'</strong><div class="label">'+esc(x[0].slug)+(b.batch?' ・ batch '+esc(b.batch):'')+'</div><div class="label">'+when(b.startedAt)+(b.endedAt?' 〜 '+when(b.endedAt):'')+'</div></div>';}).join('')+'</div>';}).join('')+'</div>';}
function loops(list){var r=active(list);if(!r||!r.timings.length)return '<p class="empty">ステージの開始・完了の記録はまだありません。</p>';var max=Math.max.apply(null,r.timings.map(function(t){return t.ms||0;}).concat([1]));
return '<h2>'+esc(r.slug)+' のステージごとの所要時間</h2><div class="bars">'+r.timings.map(function(t){return '<div class="row"><div>'+esc(t.stage)+(t.starts>1?' <span class="label">（'+t.starts+'回）</span>':'')+'</div><div class="bar" style="width:'+((t.ms||0)/max*100)+'%" data-tip="'+esc(t.stage+'：'+dur(t.ms)+(t.starts>1?' ・ 開始 '+t.starts+'回':''))+'"></div><span class="num">'+dur(t.ms)+'</span></div>';}).join('')+'</div>'
+'<table><tr><th>ステージ</th><th>開始</th><th>完了</th><th class="num">所要時間</th><th class="num">開始回数</th></tr>'+r.timings.map(function(t){return '<tr><td>'+esc(t.stage)+'</td><td>'+when(t.startedAt)+'</td><td>'+when(t.endedAt)+'</td><td class="num">'+dur(t.ms)+'</td><td class="num">'+t.starts+'</td></tr>';}).join('')+'</table>';}
function issues(list){var linked=list.filter(function(r){return r.issue;});if(!linked.length)return '<p class="empty">GitHub Issue から始めた intent はありません。</p>';
return '<table><tr><th>Issue</th><th>intent</th><th>状態</th><th class="num">進み具合</th></tr>'+linked.map(function(r){var url='https://'+r.issue.repository.replace(/^https?:\\/\\//,'')+'/issues/'+r.issue.number;return '<tr><td><a href="'+esc(url)+'">#'+r.issue.number+'</a> <span class="label">'+esc(r.issue.repository)+'</span></td><td>'+esc(r.slug)+'</td><td>'+esc(r.status)+'</td><td class="num">'+pct(r)+'%</td></tr>';}).join('')+'</table>';}
function empty(){return '<p class="empty">表示する intent がありません。</p>';}
function render(){var tabs=document.getElementById('tabs');tabs.innerHTML=VIEWS.map(function(v){return '<button role="tab" aria-selected="'+(v[0]===current)+'" data-v="'+v[0]+'">'+v[1]+'</button>';}).join('');
var v=VIEWS.filter(function(x){return x[0]===current;})[0]||VIEWS[0];document.getElementById('view').innerHTML=v[2](rows());}
document.getElementById('tabs').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;current=b.getAttribute('data-v');history.replaceState(null,'','#'+current);render();});
['q','scope','status'].forEach(function(id){document.getElementById(id).addEventListener('input',render);});
var tip=document.getElementById('tip');document.addEventListener('mousemove',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');if(!t){tip.hidden=true;return;}tip.textContent=t.getAttribute('data-tip');tip.hidden=false;tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px';});
render();})();
`;

if (import.meta.main) {
  const argv = process.argv.slice(2), flag = (name: string) => { const at = argv.indexOf(name); return at < 0 ? undefined : argv[at + 1]; };
  const explicit = flag("--project-dir") ?? process.env.AIDLC_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR;
  const projectDir = explicit && isAbsolute(explicit) ? explicit : process.cwd();
  try {
    if ((flag("--output") ?? "html") === "text") process.stdout.write(renderText(collect(projectDir)));
    else {
      const result = writeDashboard(projectDir);
      if (!argv.includes("--quiet")) process.stdout.write(`${result.text}${relative(projectDir, result.path)}\n`);
    }
  } catch (error) {
    process.stderr.write(`dashboard: ${(error as Error).message}\n`);
    process.exit(2);
  }
}
