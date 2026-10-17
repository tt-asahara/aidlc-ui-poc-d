// Real-model speculation run against a synthetic fixture (fake official engine emitting present-gate).
import { cpSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
const wt = join(import.meta.dir, "..", "..", "..", ".."); // repository root
// Usage: bun poc/d-acceleration/evidence/cross-stage-parallel/real-model-run.ts <model-request>
const { runSpeculation, consumeSpeculativeDrafts, maxConcurrency } = await import(`${wt}/poc/d-acceleration/cross-stage-speculation.ts`);
const project = realpathSync(mkdtempSync(join(tmpdir(), "d-spec-real-"))), framework = realpathSync(mkdtempSync(join(tmpdir(), "d-spec-real-fw-")));
const I = "aidlc/spaces/default/intents/i1";
const w = (p: string, b: string) => { mkdirSync(dirname(join(project, p)), { recursive: true }); writeFileSync(join(project, p), b); };
const state = (m: string) => `- [x] intent-capture — EXECUTE\n- [${m}] market-research — EXECUTE\n- [ ] feasibility — EXECUTE\n`;
w("aidlc/spaces/default/intents/active-intent", "i1\n"); w(`${I}/aidlc-state.md`, state("?"));
w(`${I}/ideation/intent-capture/intent-statement.md`, "# Intent\nSynthetic: a small offline-first notes web app for one team; stores notes in browser localStorage; must export to CSV; no backend in v1.\n");
w(`${I}/ideation/market-research/build-vs-buy.md`, "# draft\n");
w("aidlc/spaces/default/memory/org.md", "# Org\nPrefer boring technology.\n");
w("next.json", JSON.stringify({ kind: "present-gate", stage: "market-research", phase: "ideation", memory_path: `${I}/ideation/market-research/memory.md` }));
for (const p of ["aidlc-common/stages/ideation/feasibility.md", "aidlc-common/stages/ideation/market-research.md", "agents/aidlc-architect-agent.md", "agents/aidlc-compliance-agent.md"]) { mkdirSync(dirname(join(framework, p)), { recursive: true }); cpSync(join(wt, "core", p), join(framework, p)); }
mkdirSync(join(framework, "tools"));
writeFileSync(join(framework, "tools/aidlc-orchestrate.ts"), `import { readFileSync } from "node:fs";\nconst d = process.argv[process.argv.indexOf("--project-dir") + 1];\nprocess.stdout.write(readFileSync(d + "/next.json", "utf8"));\n`);
const tasks = [
  { id: "integration-constraints", targetStage: "feasibility", agent: "aidlc-architect-agent", objective: "In at most 5 bullets, list technical constraints implied by the intent.", inputs: [`${I}/ideation/intent-capture/intent-statement.md`] },
  { id: "regulatory-scan", targetStage: "feasibility", agent: "aidlc-compliance-agent", objective: "In at most 5 bullets, list data-protection questions implied by the intent.", inputs: [`${I}/ideation/intent-capture/intent-statement.md`] },
  { id: "build-vs-buy-risk", targetStage: "feasibility", agent: "aidlc-architect-agent", objective: "Assess build-vs-buy risk.", inputs: [`${I}/ideation/market-research/build-vs-buy.md`] },
];
const model = process.argv[2] ?? "haiku";
const options = { projectDir: project, frameworkDir: framework, engineDir: join(framework, "tools"), timeoutMs: 180_000, now: () => Date.now() };
const t0 = Date.now();
const spec: any = await runSpeculation({ tasks, modelCatalog: { judgment: model } }, options);
w(`${I}/aidlc-state.md`, state("x"));
w("next.json", readFileSync(`${wt}/poc/d-acceleration/evidence/cross-stage-parallel/run-stage-feasibility.fixture.json`, "utf8"));
const consumed: any = consumeSpeculativeDrafts({ tasks, targetStage: "feasibility", modelCatalog: { judgment: model } }, options);
const drafts = consumed.drafts.map((d: any) => ({ taskId: d.taskId, merkleRoot: d.merkleRoot, draftSha256: d.draftSha256, notesChars: d.notes.length, notesHead: d.notes.slice(0, 400) }));
const routing = spec.completed.map((c: any) => JSON.parse(readFileSync(join(project, "aidlc/.aidlc-engine/d-speculation/default/i1/feasibility", `${c.taskId}.draft.json`), "utf8")).routing);
process.stdout.write(JSON.stringify({ requestedModel: model, wallMs: Date.now() - t0, speculation: { action: spec.action, launched: spec.launched, completed: spec.completed, failed: spec.failed, deferred: spec.deferred, intervals: spec.intervals.map((i: any) => ({ ...i, startedAt: i.startedAt - t0, endedAt: i.endedAt - t0 })), maxConcurrency: maxConcurrency(spec.intervals) }, routing, consumed: { action: consumed.action, serialFallback: consumed.serialFallback, discarded: consumed.discarded, drafts } }, null, 2) + "\n");
