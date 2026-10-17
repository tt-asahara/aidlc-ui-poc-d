#!/usr/bin/env bun
/**
 * Real-CLI probe for D model identity and tier routing.
 *
 * Every launch is built by the same production argv builder that the worker
 * type uses (design-wave scheduler, read-only fanout, Issue ambiguity
 * assessor, delegated question assessor, delegated approval assessor); only
 * the prompt is a small synthetic, non-confidential fixture. Nothing here
 * writes official AI-DLC state, emits a human turn, or approves anything.
 *
 *   bun poc/d-acceleration/model-routing-probe.ts identity --out DIR [--models a,b,c]
 *   bun poc/d-acceleration/model-routing-probe.ts parent   --out DIR
 *   bun poc/d-acceleration/model-routing-probe.ts compare  --out DIR
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effortForTier, plan, type Input, type Tier } from "./aidlc-acceleration-plan.ts";
import { approvalAssessorLaunch, productionClaudeExecutable } from "./ai-approval-controller.ts";
import { questionAssessorLaunch } from "./ai-question-controller.ts";
import { ambiguityAssessorLaunch } from "./issue-ambiguity-assessor.ts";
import { planReadOnlyFanout } from "./read-only-fanout.ts";
import { claudeWorkerLaunch, runWorker, type WorkerLaunch, type WorkerResult } from "./worker-adapters.ts";

export const DEFAULT_MODELS: Record<Tier, string> = { fast: "claude-haiku-5-5", balanced: "claude-sonnet-5-5", judgment: "claude-opus-5-5" };
const REPO = join(import.meta.dir, "..", "..");
const LIMITS = { timeoutMs: 180_000, maxStdoutBytes: 1_048_576, maxStderrBytes: 65_536 };

function scratchProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "d-model-probe-"));
  writeFileSync(join(dir, "evidence.md"), "# Synthetic evidence\n\nThe fixture product is a to-do list with no external integrations.\n");
  return dir;
}

function summarize(workerType: string, launch: WorkerLaunch, result: WorkerResult, extra: Record<string, unknown> = {}): Record<string, any> {
  let resultText: string | null = null;
  try { const parsed = JSON.parse(result.stdout); resultText = typeof parsed.result === "string" ? parsed.result.slice(0, 400) : null; } catch { /* unparsable stays null */ }
  return {
    workerType,
    requestedModel: launch.requestedModel,
    requestedEffort: launch.requestedEffort,
    effectiveEffort: "unverified (the CLI JSON result does not report effort)",
    modelIdentity: result.modelIdentity,
    usage: result.usage,
    ok: result.ok,
    failure: result.failure,
    exitCode: result.exitCode,
    wallMs: result.endedAt - result.startedAt,
    resultText,
    stderrHead: result.stderr.slice(0, 300),
    ...extra,
  };
}

const IDENTITY_PROMPT = "Synthetic identity probe. Reply with exactly the single word OK and nothing else.";

export function identityLaunches(model: string, projectDir: string, trustedExecutable?: string): Array<{ workerType: string; launch: WorkerLaunch }> {
  const fanout = planReadOnlyFanout({
    directive: { kind: "run-stage", stage: "market-research", phase: "ideation", mode: "inline", gate: false, lead_agent: "aidlc-product-agent", support_agents: [], inline_context_paths: [], memory_path: "aidlc/spaces/default/intents/probe/ideation/market-research/memory.md", consumes: [], produces: ["aidlc/spaces/default/intents/probe/ideation/market-research/research.md"], rules_in_context: [], sensors_applicable: [], ceremony: { sensors: "on", learnings: "on", summary_confirmation: "on", plan_approval: "on", collaborators: "off" }, stage_file: "core/aidlc-common/stages/ideation/market-research.md" },
    tasks: [
      { id: "probe-a", agent: "aidlc-architect-agent", objective: IDENTITY_PROMPT, evidencePaths: ["evidence.md"] },
      { id: "probe-b", agent: "aidlc-quality-agent", objective: IDENTITY_PROMPT, evidencePaths: ["evidence.md"] },
    ],
    modelCatalog: { balanced: model },
  }, { projectDir, frameworkDir: join(REPO, "core") });
  if (fanout.action !== "unverified-read-only-fanout-plan") throw new Error(`fanout plan refused: ${JSON.stringify(fanout)}`);
  const trusted = trustedExecutable ?? productionClaudeExecutable(projectDir);
  return [
    { workerType: "design-wave-worker", launch: claudeWorkerLaunch({ model, effort: "low", prompt: IDENTITY_PROMPT }) },
    { workerType: "read-only-fanout-worker", launch: fanout.launches[0]!.launch },
    { workerType: "issue-ambiguity-assessor", launch: ambiguityAssessorLaunch({ model, effort: "low", prompt: IDENTITY_PROMPT }) },
    { workerType: "delegated-question-assessor", launch: questionAssessorLaunch({ executable: trusted, model, prompt: IDENTITY_PROMPT }) },
    { workerType: "delegated-approval-assessor", launch: approvalAssessorLaunch({ executable: trusted, environment: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }, model, prompt: IDENTITY_PROMPT }) },
  ];
}

async function identity(out: string, models: string[]) {
  const projectDir = scratchProject(); const rows: any[] = [];
  for (const model of models) for (const { workerType, launch } of identityLaunches(model, projectDir)) {
    const result = await runWorker(launch, { projectDir, ...LIMITS });
    rows.push(summarize(workerType, launch, result));
    process.stderr.write(`${workerType} ${model} -> ${result.modelIdentity.status} ${result.modelIdentity.runtimeReportedModels.join(",")}\n`);
  }
  return { kind: "model-identity", rows, mismatches: rows.filter((row) => row.modelIdentity.status === "mismatch"), unverified: rows.filter((row) => row.modelIdentity.status === "unverified") };
}

/**
 * Parent Haiku / worker Opus-policy case. The parent session's model is
 * simulated the only ways a child can inherit it: ANTHROPIC_MODEL (the CLI's
 * default-model env) and CLAUDE_CODE_SUBAGENT_MODEL (subagent override). A
 * worker request for Opus must still be served by Opus, with no silent
 * substitution by the parent's Haiku.
 */
async function parent(out: string) {
  const projectDir = scratchProject(); const rows: any[] = [];
  const parentEnv = { ...process.env, ANTHROPIC_MODEL: DEFAULT_MODELS.fast, CLAUDE_CODE_SUBAGENT_MODEL: DEFAULT_MODELS.fast, AIDLC_PARENT_MODEL: DEFAULT_MODELS.fast };
  for (const { workerType, launch } of identityLaunches(DEFAULT_MODELS.judgment, projectDir)) {
    if (!["design-wave-worker", "read-only-fanout-worker"].includes(workerType)) continue;
    const withParent = { ...launch, environment: { ...(launch.environment ?? parentEnv), ANTHROPIC_MODEL: DEFAULT_MODELS.fast, CLAUDE_CODE_SUBAGENT_MODEL: DEFAULT_MODELS.fast } };
    const result = await runWorker(withParent, { projectDir, ...LIMITS });
    rows.push(summarize(workerType, withParent, result, { simulatedParentModel: DEFAULT_MODELS.fast, inheritedEnv: ["ANTHROPIC_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"] }));
  }
  // Control: no --model flag at all shows what the parent env would select.
  const control: WorkerLaunch = { kind: "claude", executable: "claude", requestedModel: null, requestedEffort: "low", environment: { ...parentEnv }, args: ["--print", "--output-format", "json", "--no-session-persistence", "--permission-prompts", "none", "--effort", "low", IDENTITY_PROMPT] };
  const controlResult = await runWorker(control, { projectDir, ...LIMITS });
  rows.push(summarize("control-no-model-flag", control, controlResult, { simulatedParentModel: DEFAULT_MODELS.fast }));
  const substituted = rows.filter((row) => row.requestedModel && row.modelIdentity.status !== "verified-match");
  return { kind: "parent-haiku-worker-opus", rows, unauthorizedSubstitution: substituted.length > 0, substituted };
}

// --- fast / balanced / judgment comparison ---------------------------------
type Fixture = { id: string; taskType: Input["tasks"][number]["taskType"]; difficulty: "low" | "medium"; prompt: string; accept: (text: string) => { pass: boolean; detail: string } };
function jsonIn(text: string): any { const match = text.match(/[[{][\s\S]*[\]}]/); if (!match) throw new Error("no JSON"); return JSON.parse(match[0]); }
export const FIXTURES: Fixture[] = [
  {
    id: "T1-extract-codes", taskType: "templated", difficulty: "low",
    prompt: "Return ONLY a JSON array (no prose) of the distinct two-letter US state codes mentioned below, sorted ascending.\nText: Shipments went to Texas (TX), Ohio (OH) and back to TX, then on to Utah (UT).",
    accept: (text) => { try { const value = jsonIn(text); return { pass: JSON.stringify(value) === JSON.stringify(["OH", "TX", "UT"]), detail: JSON.stringify(value) }; } catch (error) { return { pass: false, detail: String(error) }; } },
  },
  {
    id: "T2-lexical-toposort", taskType: "implementation", difficulty: "low",
    prompt: "Dependencies (X <- Y means X depends on Y): api <- db, api <- auth, auth <- schema, db <- schema, ui <- api, tests <- api, tests <- ui. Also nodes cache and docs exist with no dependencies. Return ONLY a JSON array giving the topological order where, whenever several nodes are ready, the alphabetically smallest is taken first.",
    accept: (text) => { const expected = ["cache", "docs", "schema", "auth", "db", "api", "ui", "tests"]; try { const value = jsonIn(text); return { pass: JSON.stringify(value) === JSON.stringify(expected), detail: JSON.stringify(value) }; } catch (error) { return { pass: false, detail: String(error) }; } },
  },
  {
    id: "T3-requirements-conflict", taskType: "design", difficulty: "medium",
    prompt: "Requirements: R1 Users can permanently delete their account at any time. R2 All user records must be retained unaltered for 7 years. R3 Users can list their own orders. R4 Admins can export all orders as CSV.\nReturn ONLY JSON: {\"conflict\":[\"Rx\",\"Ry\"],\"endpoints\":[{\"method\":\"GET|POST|PUT|PATCH|DELETE\",\"path\":\"...\",\"requirement\":\"Rn\"}]} naming the one conflicting pair and a minimal REST endpoint per functional requirement R1, R3, R4.",
    accept: (text) => {
      try {
        const value = jsonIn(text); const conflict = [...(value.conflict ?? [])].sort();
        const endpoints = Array.isArray(value.endpoints) ? value.endpoints : [];
        const covers = ["R1", "R3", "R4"].every((id) => endpoints.some((entry: any) => entry?.requirement === id));
        const methods = new Set(endpoints.map((entry: any) => String(entry?.method).toUpperCase()));
        const pass = JSON.stringify(conflict) === JSON.stringify(["R1", "R2"]) && covers && methods.has("GET") && (methods.has("DELETE") || methods.has("POST"));
        return { pass, detail: JSON.stringify({ conflict, endpointCount: endpoints.length, covers, methods: [...methods] }) };
      } catch (error) { return { pass: false, detail: String(error) }; }
    },
  },
];

async function runFixture(fixture: Fixture, tier: Tier, model: string, projectDir: string): Promise<Record<string, any>> {
  const launch = claudeWorkerLaunch({ model, effort: effortForTier(tier), prompt: fixture.prompt });
  const result = await runWorker(launch, { projectDir, ...LIMITS });
  const row = summarize("design-wave-worker", launch, result, { task: fixture.id, tier });
  const acceptance = row.resultText === null ? { pass: false, detail: "no result text" } : fixture.accept(JSON.parse(result.stdout).result);
  return { ...row, acceptance };
}

async function compare(out: string) {
  const projectDir = scratchProject(); const grid: any[] = [];
  for (const fixture of FIXTURES) for (const tier of ["fast", "balanced", "judgment"] as const) {
    grid.push(await runFixture(fixture, tier, DEFAULT_MODELS[tier], projectDir));
    process.stderr.write(`${fixture.id} ${tier} pass=${grid.at(-1).acceptance.pass}\n`);
  }
  // Matched-input arms over the same three fixtures.
  // Baseline (C-like): official serial host order, one model for every task
  // (the D default is Opus for every tier), so the serial judgment-tier grid
  // runs above are the baseline measurement.
  const baselineRows = grid.filter((row) => row.tier === "judgment");
  // D: planner-routed tiers, dispatched concurrently (the fixtures are
  // independent and have disjoint, empty write sets).
  const routedPlan = await plan({ tasks: FIXTURES.map((fixture) => ({ id: fixture.id, stage: "custom", dependsOn: [], estimatedMs: 1, taskType: fixture.taskType, difficulty: fixture.difficulty, risk: "low", execution: "serial", writeSet: [] })) });
  const started = performance.now();
  const dRows: Array<Record<string, any>> = await Promise.all(FIXTURES.map((fixture) => { const tier = routedPlan.routes[fixture.id]!.tier; return runFixture(fixture, tier, DEFAULT_MODELS[tier], projectDir).then((row) => ({ ...row, routeReason: routedPlan.routes[fixture.id]!.reason })); }));
  const dWallMs = performance.now() - started;
  const sum = (rows: any[], pick: (row: any) => number | null | undefined) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  const arms = {
    baselineSerialSingleModel: { model: DEFAULT_MODELS.judgment, wallMs: sum(baselineRows, (row) => row.wallMs), criticalPathMs: sum(baselineRows, (row) => row.wallMs), acceptancePass: baselineRows.filter((row) => row.acceptance.pass).length, costUSD: sum(baselineRows, (row) => row.usage?.costUSD), outputTokens: sum(baselineRows, (row) => row.usage?.outputTokens) },
    dRoutedParallel: { tiers: Object.fromEntries(dRows.map((row) => [row.task, row.tier])), wallMs: dWallMs, criticalPathMs: Math.max(...dRows.map((row) => row.wallMs)), acceptancePass: dRows.filter((row) => row.acceptance.pass).length, costUSD: sum(dRows, (row) => row.usage?.costUSD), outputTokens: sum(dRows, (row) => row.usage?.outputTokens), routingMs: routedPlan.routingMetrics.plannerWallMs },
  };
  return { kind: "tier-comparison", fixtures: FIXTURES.map(({ id, taskType, difficulty, prompt }) => ({ id, taskType, difficulty, prompt })), models: DEFAULT_MODELS, grid, matchedInput: { arms, dRows, rework: "none attempted (single attempt per task; failures are reported, not retried)", caveats: ["n=1 per cell: no variance estimate, no significance claim", "baseline reuses the serial judgment-tier grid runs; D arm ran afterwards (warm prompt cache possible for both)", "tiny synthetic prompts; official stage context, reviews, and gates are not included", "cost is the CLI-reported list-price costUSD, not an invoice"] } };
}

if (import.meta.main) {
  const args = process.argv.slice(2); const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const mode = args[0]; const out = value("--out");
  if (!out || !["identity", "parent", "compare"].includes(mode ?? "")) throw new Error("usage: model-routing-probe.ts identity|parent|compare --out DIR [--models a,b,c]");
  mkdirSync(out, { recursive: true });
  const meta = { cli: Bun.spawnSync(["claude", "--version"]).stdout.toString().trim(), recordedAt: new Date().toISOString(), observedParentSessionModel: process.env.AIDLC_PARENT_MODEL ?? "not-observable", parentEffortEnv: process.env.CLAUDE_EFFORT ?? null };
  const body = mode === "identity" ? await identity(out, (value("--models") ?? Object.values(DEFAULT_MODELS).join(",")).split(",")) : mode === "parent" ? await parent(out) : await compare(out);
  const path = join(out, `${mode}.json`);
  writeFileSync(path, `${JSON.stringify({ meta, ...body }, null, 2)}\n`);
  process.stdout.write(`${path}\n`);
}
