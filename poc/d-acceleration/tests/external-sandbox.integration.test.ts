/**
 * External-integration sandbox (issue #6 "Grounding and external integration
 * gaps", issue #8). Exercises issue autopilot, decision-summary publication,
 * and git persistence push end to end against LOCAL stand-ins only:
 *   - a stateful fake `gh` (fixtures/fake-gh.ts, compiled to a native binary)
 *     that records every argv and holds Issue state in a JSON file;
 *   - a bare git repository in a temp dir as the push remote.
 * Nothing here contacts GitHub. Set D_SANDBOX_EVIDENCE_DIR to keep a JSON
 * record of every scenario (argv log, fake GitHub state, results).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistCrossing, type Crossing } from "../d-persistence.ts";
import { resolveDGitPersistence } from "../d-config.ts";

const D = join(import.meta.dir, "..");
const autopilotCli = join(D, "issue-autopilot-cli.ts");
const summaryCli = join(D, "decision-issue-summary.ts");
const humanTurnTool = join(D, "..", "..", "core", "tools", "aidlc.ts");
const evidence: Record<string, unknown> = {};
let sandbox = "";
let gh = "";
let ghSha256 = "";

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "d-external-sandbox-"));
  gh = join(sandbox, "bin", "gh");
  const built = spawnSync(process.execPath, ["build", "--compile", join(D, "fixtures", "fake-gh.ts"), "--outfile", gh], { encoding: "utf8" });
  if (built.status !== 0) throw new Error(built.stderr || built.stdout);
  ghSha256 = createHash("sha256").update(readFileSync(gh)).digest("hex");
}, 60_000);

afterAll(() => {
  const out = process.env.D_SANDBOX_EVIDENCE_DIR;
  if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, "sandbox-scenarios.json"), `${JSON.stringify(evidence, null, 2).split(sandbox).join("<sandbox>")}\n`); }
  rmSync(sandbox, { recursive: true, force: true });
});

type FakeIssue = { number: number; title: string; body: string; labels: string[]; state: "OPEN" | "CLOSED" };
type FakeState = { loggedIn: string[]; repos: Record<string, { nextNumber: number; issues: FakeIssue[] }>; faults?: Array<{ match: string; mode: "fail" | "fail-after-write"; remaining: number }> };

function fakeGitHub(name: string, state: FakeState) {
  const dir = join(sandbox, name); mkdirSync(dir, { recursive: true });
  const statePath = join(dir, "github-state.json"), logPath = join(dir, "gh-argv.jsonl");
  writeFileSync(statePath, JSON.stringify(state)); writeFileSync(logPath, "");
  return {
    env: { FAKE_GH_STATE: statePath, FAKE_GH_LOG: logPath },
    state: () => JSON.parse(readFileSync(statePath, "utf8")) as FakeState,
    patch: (change: (state: FakeState) => void) => { const value = JSON.parse(readFileSync(statePath, "utf8")) as FakeState; change(value); writeFileSync(statePath, JSON.stringify(value)); },
    calls: () => readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { argv: string[]; ghHost: string | null }),
  };
}
const git = (cwd: string, args: string[]) => { const r = spawnSync("git", args, { cwd, encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr || r.stdout); return r.stdout.trim(); };
const executable = (path: string, source: string) => { writeFileSync(path, `#!/usr/bin/env bun\n${source}`); chmodSync(path, 0o755); };
const issue = (number: number, labels: string[], state: "OPEN" | "CLOSED" = "OPEN"): FakeIssue => ({ number, title: `Sandbox task ${number}`, body: `Build sandbox task ${number}`, labels, state });

/** A product with fake official tools (intent-create / next) standing in for the installed engine. */
function product(name: string, config: Record<string, unknown>, origin = "https://github.com/sandbox/app.git") {
  const root = join(sandbox, name, "product"), tools = join(root, ".claude", "tools"); mkdirSync(tools, { recursive: true });
  git(root, ["init", "-q", "-b", "main"]); git(root, ["remote", "add", "origin", origin]);
  writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify(config));
  executable(join(tools, "aidlc-utility.ts"), `import {appendFileSync,mkdirSync,writeFileSync} from "node:fs"; const args=process.argv.slice(2), label=args[args.indexOf("--label")+1]; appendFileSync("intent-create.jsonl", JSON.stringify(args.slice(0,5))+"\\n"); const dir="aidlc/spaces/default/intents/"+label; mkdirSync(dir,{recursive:true}); writeFileSync(dir+"/project-description.json",JSON.stringify(args[args.indexOf("--arguments")+1])); writeFileSync(dir+"/aidlc-state.md","state"); writeFileSync("aidlc/spaces/default/intents/active-intent",label+"\\n"); console.log(JSON.stringify({ok:true}));`);
  executable(join(tools, "aidlc-orchestrate.ts"), `console.log(JSON.stringify({kind:"ask",gate:true,stage:"requirements-analysis"}));`);
  const assessor = join(root, "..", "fake-assessor.ts");
  executable(assessor, `console.log(JSON.stringify({result:JSON.stringify({unresolved:[],assumptions:[],researchedFacts:[]})}));`);
  const intentCreates = () => existsSync(join(root, "intent-create.jsonl")) ? readFileSync(join(root, "intent-create.jsonl"), "utf8").split("\n").filter(Boolean).length : 0;
  return { root, assessor, intentCreates };
}
function autopilot(p: ReturnType<typeof product>, env: Record<string, string>, args: string[]) {
  const r = spawnSync(process.execPath, [autopilotCli, "--claude-executable", p.assessor, "--claude-judgment", "fixture", "--project-dir", p.root, "--gh-executable", gh, ...args], { cwd: p.root, encoding: "utf8", env: { ...process.env, ...env } });
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(r.stdout); } catch { /* non-JSON failure stays in stderr */ }
  return { status: r.status, json, stderr: r.stderr };
}
const autoConfig = (auto: Record<string, unknown> = {}, issueAutopilot = true) => ({ auto: { enabled: true, sessionOnly: true, labelAllowlist: ["aidlc-auto"], ...auto }, issueAutopilot: { enabled: issueAutopilot } });
const repoState = (loggedIn = ["github.com"], issues = [issue(3, ["aidlc-auto"]), issue(4, []), issue(5, ["aidlc-auto"]), issue(6, ["aidlc-auto"], "CLOSED")]): FakeState =>
  ({ loggedIn, repos: { "github.com/sandbox/app": { nextNumber: 100, issues }, "github.kddi.com/sandbox/app": { nextNumber: 100, issues } } });
const issueReads = (calls: Array<{ argv: string[] }>) => calls.filter((call) => call.argv[0] === "issue");

describe("issue autopilot against the fake GitHub", () => {
  test("auto OFF and issueAutopilot OFF never touch GitHub or the engine", () => {
    const rows: unknown[] = [];
    for (const [name, config] of [["auto-off", { auto: { enabled: false }, issueAutopilot: { enabled: true } }], ["autopilot-off", autoConfig({}, false)], ["default", {}]] as const) {
      const github = fakeGitHub(`ap-${name}`, repoState()), p = product(`ap-${name}`, config);
      for (const args of [["3"], ["aidlc-auto"], ["list"]]) {
        const r = autopilot(p, github.env, args);
        expect(r.status).toBe(0); expect(r.json).toMatchObject({ status: "stopped", reason: "disabled" });
        rows.push({ config: name, args, result: r.json });
      }
      expect(github.calls()).toEqual([]); expect(p.intentCreates()).toBe(0);
    }
    evidence.autoOff = rows;
  }, 60_000);

  test("gh logged into GHE only: a github.com repository fails closed with the exact login step; a GHE origin proceeds", () => {
    const github = fakeGitHub("ap-auth", repoState(["github.kddi.com"]));
    const p = product("ap-auth", autoConfig());
    const denied = autopilot(p, github.env, ["3"]);
    expect(denied.json).toMatchObject({ status: "stopped", reason: "gh-auth-required", host: "github.com", nextStep: "gh auth login --hostname github.com", repository: "github.com/sandbox/app" });
    expect(github.calls().map((call) => call.argv)).toEqual([["auth", "status", "--hostname", "github.com"]]);
    expect(p.intentCreates()).toBe(0);

    const ghe = product("ap-auth-ghe", autoConfig(), "git@github.kddi.com:sandbox/app.git");
    const allowed = autopilot(ghe, github.env, ["3"]);
    expect(allowed.json).toMatchObject({ reason: "intent-created", issueNumber: 3 });
    const calls = github.calls().slice(1).map((call) => call.argv);
    expect(calls).toEqual([["auth", "status", "--hostname", "github.kddi.com"], ["issue", "view", "3", "--repo", "github.kddi.com/sandbox/app", "--json", "number,title,body,labels,state"]]);
    evidence.ghAuth = { denied: denied.json, gheAllowed: allowed.json, argv: github.calls() };
  }, 60_000);

  test("explicit number: label present creates once, absent/closed stop, read error fails closed without a claim", () => {
    const github = fakeGitHub("ap-explicit", repoState());
    const p = product("ap-explicit", autoConfig());
    const present = autopilot(p, github.env, ["3"]);
    expect(present.json).toMatchObject({ reason: "intent-created", issueNumber: 3, attempts: 1, selection: { mode: "explicit-number" } });
    const again = autopilot(p, github.env, ["3"]);
    expect(again.json).toMatchObject({ reason: "intent-created", issueNumber: 3, attempts: 0 });
    expect(p.intentCreates()).toBe(1);
    expect(autopilot(p, github.env, ["4"]).json).toMatchObject({ reason: "label-not-allowed", issueNumber: 4 });
    expect(autopilot(p, github.env, ["6"]).json).toMatchObject({ reason: "not-open", issueNumber: 6 });
    expect(autopilot(p, github.env, ["999"]).json).toMatchObject({ status: "stopped", reason: "github-read-failed" });
    github.patch((state) => { state.faults = [{ match: "issue view", mode: "fail", remaining: 1 }]; });
    const readError = autopilot(p, github.env, ["5"]);
    expect(readError.json).toMatchObject({ status: "stopped", reason: "github-read-failed" });
    expect(String(readError.json.detail)).toContain("injected fault");
    expect(existsSync(join(p.root, ".git", "aidlc", "issue-autopilot", "claims", "issue-5.json"))).toBeFalse();
    expect(p.intentCreates()).toBe(1);
    expect(issueReads(github.calls()).every((call) => call.argv[1] === "view" && call.argv[3] === "--repo" && call.argv[4] === "github.com/sandbox/app")).toBeTrue();
    evidence.explicitNumber = { present: present.json, rerun: again.json, readError: readError.json, intentCreates: p.intentCreates(), argv: github.calls() };
  }, 90_000);

  test("discovery: list offers choices; label poll continues in ascending order and terminates when nothing is eligible", () => {
    const github = fakeGitHub("ap-loop", repoState());
    const p = product("ap-loop", autoConfig());
    const listed = autopilot(p, github.env, ["list"]);
    expect(listed.json).toMatchObject({ status: "selection-required", issues: [{ number: 3 }, { number: 4 }, { number: 5 }] });
    expect(p.intentCreates()).toBe(0);
    const polls = [1, 2, 3].map(() => autopilot(p, github.env, ["aidlc-auto"]).json);
    expect(polls[0]).toMatchObject({ reason: "intent-created", issueNumber: 3, selection: { mode: "label-poll", eligibleIssueNumbers: [3, 5] } });
    expect(polls[1]).toMatchObject({ reason: "intent-created", issueNumber: 5, selection: { eligibleIssueNumbers: [5] } });
    expect(polls[2]).toMatchObject({ status: "stopped", reason: "selection-cancelled" });
    expect(p.intentCreates()).toBe(2);
    // A label nobody carries terminates immediately; GitHub list errors fail closed.
    expect(autopilot(p, github.env, ["no-such-label"]).json).toMatchObject({ reason: "selection-cancelled" });
    github.patch((state) => { state.faults = [{ match: "issue list", mode: "fail", remaining: 1 }]; });
    expect(autopilot(p, github.env, ["aidlc-auto"]).json).toMatchObject({ reason: "github-read-failed" });
    const stopped = autopilot(p, github.env, ["stop"]);
    expect(stopped.json).toMatchObject({ status: "stopped", reason: "operator-stop" });
    expect(p.intentCreates()).toBe(2);
    evidence.discoveryLoop = { listed: listed.json, polls, stop: stopped.json, intentCreates: p.intentCreates() };
  }, 120_000);

  test("assumptionLedger OFF forces halt for every ambiguityPolicy; oneIssuePerRun=false is refused", () => {
    const rows: Record<string, unknown> = {};
    for (const policy of ["assume", "research"] as const) {
      const github = fakeGitHub(`ap-ledger-${policy}`, repoState());
      const p = product(`ap-ledger-${policy}`, autoConfig({ ambiguityPolicy: policy, assumptionLedger: false }));
      // The assessor (a fake Claude) answers with an assumption/fact; under halt the
      // production parser rejects it, so the run stops before intake.
      executable(p.assessor, `console.log(JSON.stringify({result:JSON.stringify({unresolved:[],assumptions:${policy === "assume" ? '["Use JPY"]' : "[]"},researchedFacts:${policy === "research" ? '["ISO 4217 lists JPY"]' : "[]"}})}));`);
      const status = autopilot(p, github.env, ["status"]).json;
      expect(status).toMatchObject({ uncertaintyPolicy: "halt" });
      const run = autopilot(p, github.env, ["3"]).json;
      expect(run).toMatchObject({ status: "stopped", reason: "uncertainty", issueNumber: 3 });
      expect(existsSync(join(p.root, ".git", "aidlc", "issue-autopilot", "assumptions.jsonl"))).toBeFalse();
      expect(p.intentCreates()).toBe(0);
      rows[policy] = { statusPolicy: status.uncertaintyPolicy, run };
    }
    const github = fakeGitHub("ap-one-issue", repoState());
    const p = product("ap-one-issue", { ...autoConfig(), issueAutopilot: { enabled: true, oneIssuePerRun: false } });
    const refused = autopilot(p, github.env, ["aidlc-auto"]);
    expect(refused.status).not.toBe(0); expect(refused.stderr).toContain("oneIssuePerRun=false is not supported");
    expect(github.calls()).toEqual([]); expect(p.intentCreates()).toBe(0);
    evidence.ledgerAndOneIssue = { ...rows, oneIssuePerRunFalse: refused.stderr.split("\n").find((line) => line.includes("oneIssuePerRun")) };
  }, 90_000);

  test("every through boundary resolves to the last active stage of its phase, or fails closed before GitHub", () => {
    const active = ["requirements-analysis", "user-stories", "units-generation", "delivery-planning", "functional-design", "code-generation", "build-and-test", "ci-pipeline"];
    const expected: Record<string, string | null> = { inception: "delivery-planning", construction: "ci-pipeline", "units-generation": "units-generation", "code-generation": "code-generation", none: null };
    const rows: Record<string, unknown> = {};
    for (const through of ["none", "initialization", "ideation", "inception", "construction", "operation", "units-generation", "code-generation", "deployment-execution"]) {
      const github = fakeGitHub(`ap-through-${through}`, repoState());
      const p = product(`ap-through-${through}`, autoConfig({ sessionOnly: false, ...(through === "none" ? {} : { through }) }));
      const r = autopilot(p, github.env, ["--active-stages", active.join(","), "3"]);
      if (through in expected) {
        expect(r.json).toMatchObject({ reason: "intent-created", issueNumber: 3, hostControl: { through: expected[through] } });
      } else {
        expect(r.status).not.toBe(0);
        expect(r.stderr).toMatch(/has no active stage|is not active/);
        expect(github.calls()).toEqual([]); expect(p.intentCreates()).toBe(0);
      }
      rows[through] = r.status === 0 ? { hostControl: r.json.hostControl } : { failedClosed: r.stderr.split("\n").find((line) => /error/i.test(line)) ?? r.stderr.slice(0, 200) };
    }
    evidence.throughBoundaries = rows;
  }, 180_000);
});

function summaryProduct(name: string, decision: Record<string, unknown>) {
  const root = join(sandbox, name, "product"), intent = join(root, "aidlc/spaces/default/intents/budget");
  mkdirSync(join(intent, "decisions"), { recursive: true }); mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, "aidlc/spaces/default/intents/active-intent"), "budget\n");
  writeFileSync(join(intent, "aidlc-state.md"), "- **Scope**: feature\n");
  const ledger = join(intent, "decisions/ai-question-answers.jsonl");
  // The D question-answer ledger row shape settled by ai-question-answers.ts.
  const row = (id: string, reason: string) => JSON.stringify({ schemaVersion: 1, kind: "d-delegated-question-answer", ledger: "d-acceleration (not the official AI-DLC audit)", actor: "ai", decisionId: id.repeat(64), stage: "requirements-analysis", unit: null, questionId: `Q${id}`, answer: "A. count-only", answerSource: "delegated-ai-assumption", reason, questionsFile: "aidlc/spaces/default/intents/budget/inception/requirements-analysis/requirements-analysis-questions.md", questionsTemplateSha256: "a".repeat(64), delegationSha256: "b".repeat(64), confidence: 0.95, requestedModel: "fixture-judgment", runtimeReportedModel: "fixture-judgment", settledAt: "2026-10-17T00:00:00.000Z" });
  writeFileSync(ledger, row("1", "Keep deletion confirmation count-only"));
  const configure = (value: Record<string, unknown>) => writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify({ decisionIssueSummary: { ...decision, ...value } }));
  configure({});
  return { root, intent, ledger, configure, appendDecision: () => writeFileSync(ledger, `${readFileSync(ledger, "utf8")}\n${row("2", "CSV export uses comma")}`) };
}
function summary(p: ReturnType<typeof summaryProduct>, mode: "generate" | "publish", env: Record<string, string>) {
  const r = spawnSync(process.execPath, [summaryCli, mode, "--project-dir", p.root, "--intent-dir", p.intent, "--decisions-file", p.ledger], { cwd: p.root, encoding: "utf8", env: { ...process.env, AIDLC_GH_EXECUTABLE_PATH: gh, AIDLC_GH_EXECUTABLE_SHA256: ghSha256, ...env } });
  return { status: r.status, json: JSON.parse(r.stdout) as Record<string, unknown> };
}
function humanAuthorize(p: ReturnType<typeof summaryProduct>, repository: string, payload: unknown, session: string) {
  const payloadSha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const prompt = `AI-DLC authorize-decision-summary --repository ${repository} --intent aidlc/spaces/default/intents/budget --payload-sha256 ${payloadSha256}`;
  const r = spawnSync(process.execPath, [humanTurnTool, "engine", "hook", "record-human-turn", "--project-dir", p.root], { cwd: p.root, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: p.root }, input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: session, prompt }) });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return { prompt, payloadSha256 };
}

describe("decision-summary publication against the fake GitHub (native pinned gh)", () => {
  test("default-off, send gate, exact permission + payload hash, host auth, ambiguous create, idempotent retry", () => {
    const github = fakeGitHub("summary", { loggedIn: ["github.kddi.com"], repos: { "github.com/sandbox/app": { nextNumber: 40, issues: [] } } });
    const p = summaryProduct("summary", { enabled: false, repository: "sandbox/app", send: false });
    const steps: Record<string, unknown> = {};
    steps.disabled = summary(p, "publish", github.env).json;
    expect(steps.disabled).toMatchObject({ status: "stopped", reason: "disabled" });

    p.configure({ enabled: true });
    const generated = summary(p, "publish", github.env);
    expect(generated.json).toMatchObject({ status: "generated", published: false }); steps.sendOff = generated.json;
    expect(github.calls()).toEqual([]);

    p.configure({ enabled: true, send: true });
    steps.noPermission = summary(p, "publish", github.env).json;
    expect(steps.noPermission).toMatchObject({ status: "stopped" });
    expect(String((steps.noPermission as { reason: string }).reason)).toContain("lacks an exact latest host-recorded human permission");
    expect(github.calls()).toEqual([]);

    // Permission is bound to the payload hash: a later ledger change invalidates it.
    const authorized = humanAuthorize(p, "sandbox/app", generated.json.payload, "01995000-dead-7000-8000-00000000e001");
    p.appendDecision();
    steps.stalePayloadHash = summary(p, "publish", github.env).json;
    expect(steps.stalePayloadHash).toMatchObject({ status: "stopped" });
    expect(github.calls()).toEqual([]);

    const preview = summary(p, "generate", github.env).json;
    const current = humanAuthorize(p, "sandbox/app", preview.payload, "01995000-dead-7000-8000-00000000e002");
    expect(current.payloadSha256).not.toBe(authorized.payloadSha256);
    steps.ghAuthMissing = summary(p, "publish", github.env).json;
    expect(steps.ghAuthMissing).toMatchObject({ status: "stopped", reason: "gh-auth-required", host: "github.com", nextStep: "gh auth login --hostname github.com" });
    expect(github.calls()).toEqual([{ argv: ["auth", "status", "--hostname", "github.com"], ghHost: "github.com" }]);

    github.patch((state) => { state.loggedIn.push("github.com"); state.faults = [{ match: "issue create", mode: "fail-after-write", remaining: 1 }]; });
    steps.ambiguousCreate = summary(p, "publish", github.env).json;
    expect(steps.ambiguousCreate).toMatchObject({ status: "stopped", reason: "create-result-ambiguous" });
    expect(github.state().repos["github.com/sandbox/app"].issues).toHaveLength(1);

    steps.reconciled = summary(p, "publish", github.env).json;
    expect(steps.reconciled).toMatchObject({ status: "published", operation: "updated", issueNumber: 40 });
    steps.rerun = summary(p, "publish", github.env).json;
    expect(steps.rerun).toMatchObject({ status: "published", operation: "updated", issueNumber: 40 });
    const issues = github.state().repos["github.com/sandbox/app"].issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].body).toContain(`<!-- aidlc-decision-summary:${(preview.payload as { key: string }).key} -->`);
    expect(issues[0].body).toContain("CSV export uses comma");
    const verbs = github.calls().map((call) => call.argv.slice(0, 2).join(" "));
    expect(verbs.filter((verb) => verb === "issue create")).toHaveLength(1);
    expect(github.calls().every((call) => call.ghHost === "github.com")).toBeTrue();
    evidence.decisionSummary = { steps, humanPermissionWords: current.prompt, argv: github.calls(), finalIssues: issues };
  }, 120_000);

  test("non-native or digest-mismatched gh executables are refused before any call", () => {
    const github = fakeGitHub("summary-pin", { loggedIn: ["github.com"], repos: {} });
    const p = summaryProduct("summary-pin", { enabled: true, repository: "sandbox/app", send: true });
    const script = join(sandbox, "summary-pin", "bin", "gh"); mkdirSync(join(sandbox, "summary-pin", "bin"), { recursive: true });
    executable(script, "console.log('should never run')");
    const scriptResult = summary(p, "publish", { ...github.env, AIDLC_GH_EXECUTABLE_PATH: script, AIDLC_GH_EXECUTABLE_SHA256: createHash("sha256").update(readFileSync(script)).digest("hex") });
    expect(scriptResult.json).toMatchObject({ status: "stopped", reason: "host-pinned gh executable must be a native binary, not a script" });
    const mismatch = summary(p, "publish", { ...github.env, AIDLC_GH_EXECUTABLE_SHA256: "0".repeat(64) });
    expect(mismatch.json).toMatchObject({ status: "stopped", reason: "host-pinned gh executable digest mismatch" });
    expect(github.calls()).toEqual([]);
    evidence.pinnedExecutable = { script: scriptResult.json, digestMismatch: mismatch.json };
  }, 60_000);
});

describe("git persistence push against a local bare remote", () => {
  function setup(name: string) {
    const dir = join(sandbox, name); mkdirSync(dir, { recursive: true });
    const remote = join(dir, "remote.git"); git(dir, ["init", "-q", "--bare", remote]);
    const root = join(dir, "product"); mkdirSync(root);
    git(root, ["init", "-q", "-b", "main"]); git(root, ["config", "user.name", "Sandbox"]); git(root, ["config", "user.email", "sandbox@example.invalid"]);
    writeFileSync(join(root, "README.md"), "base\n"); git(root, ["add", "README.md"]); git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["remote", "add", "origin", remote]); git(root, ["push", "-q", "origin", "main"]);
    mkdirSync(join(root, "aidlc"));
    const remoteHead = () => git(dir, ["--git-dir", remote, "rev-parse", "refs/heads/main"]);
    const pending = () => JSON.parse(readFileSync(join(root, ".git/aidlc-d-persistence/pending-push.json"), "utf8")) as { state: string; refspec: string; commitOid: string };
    return { dir, remote, root, remoteHead, pending };
  }
  const crossing = (receipt: string, stage: string): Crossing => ({ receipt, events: [{ event: "STAGE_COMPLETED", stage }], manifest: ["aidlc/result.md"] });

  test("default-off, commit-only, push-failure pending refspec retried exactly, never force-pushed", () => {
    const s = setup("persist");
    const base = s.remoteHead();
    const steps: Record<string, unknown> = {};
    expect(resolveDGitPersistence(s.root)).toMatchObject({ enabled: false, push: false });
    writeFileSync(join(s.root, "aidlc/result.md"), "approved v1\n");
    steps.defaultOff = persistCrossing(s.root, resolveDGitPersistence(s.root), crossing("r1", "intent-capture"));
    expect(steps.defaultOff).toEqual({ status: "disabled" });

    const commitOnly = { enabled: true, push: false, remote: "origin", branch: "main" };
    const committed = persistCrossing(s.root, commitOnly, crossing("r1", "intent-capture")); steps.commitOnly = committed;
    expect(committed.status).toBe("committed"); expect(s.remoteHead()).toBe(base);

    // Remote unavailable: commit stays local, the exact refspec is journaled.
    const push = { ...commitOnly, push: true };
    renameSync(s.remote, `${s.remote}.offline`);
    writeFileSync(join(s.root, "aidlc/result.md"), "approved v2\n");
    const deferred = persistCrossing(s.root, push, crossing("r2", "requirements-analysis")); steps.remoteOffline = deferred;
    expect(deferred.status).toBe("deferred"); expect(deferred.reason).toContain("push pending");
    expect(s.pending()).toMatchObject({ state: "pending", refspec: `${deferred.commitOid}:refs/heads/main` });

    // While pending, a later crossing only retries the fixed refspec.
    renameSync(`${s.remote}.offline`, s.remote);
    writeFileSync(join(s.root, "aidlc/result.md"), "approved v3\n");
    const retried = persistCrossing(s.root, push, crossing("r3", "user-stories")); steps.retry = retried;
    expect(retried).toMatchObject({ status: "pushed", commitOid: deferred.commitOid });
    expect(s.remoteHead()).toBe(deferred.commitOid!); expect(s.pending().state).toBe("pushed");

    // Then r3 is processed normally.
    const third = persistCrossing(s.root, push, crossing("r3", "user-stories")); steps.next = third;
    expect(third.status).toBe("pushed"); expect(s.remoteHead()).toBe(third.commitOid!);
    expect(persistCrossing(s.root, push, crossing("r3", "user-stories"))).toMatchObject({ status: "pushed", commitOid: third.commitOid });

    // Someone else advances the remote: the next push is rejected, never forced.
    const other = join(s.dir, "other"); git(s.dir, ["clone", "-q", s.remote, other]);
    git(other, ["config", "user.name", "Other"]); git(other, ["config", "user.email", "other@example.invalid"]);
    writeFileSync(join(other, "OTHER.md"), "x\n"); git(other, ["add", "OTHER.md"]); git(other, ["commit", "-q", "-m", "other"]); git(other, ["push", "-q", "origin", "main"]);
    const foreign = s.remoteHead();
    writeFileSync(join(s.root, "aidlc/result.md"), "approved v4\n");
    const rejected = persistCrossing(s.root, push, crossing("r4", "domain-design")); steps.nonFastForward = rejected;
    expect(rejected.status).toBe("deferred"); expect(s.remoteHead()).toBe(foreign);

    // Branch moved after the checkpoint: the fixed refspec is not pushed.
    writeFileSync(join(s.root, "USER.md"), "user work\n"); git(s.root, ["add", "USER.md"]); git(s.root, ["commit", "-q", "-m", "user work"]);
    const moved = persistCrossing(s.root, push, crossing("r5", "units-generation")); steps.branchMoved = moved;
    expect(moved).toMatchObject({ status: "deferred", reason: "branch moved since checkpoint; fixed pending refspec was not pushed" });
    expect(s.remoteHead()).toBe(foreign);
    const remoteBranches = git(s.dir, ["--git-dir", s.remote, "for-each-ref", "--format=%(refname)"]).split("\n");
    expect(remoteBranches).toEqual(["refs/heads/main"]);
    evidence.persistence = { steps, remoteBranches, remoteLog: git(s.dir, ["--git-dir", s.remote, "log", "--format=%H %s", "main"]).split("\n") };
  }, 120_000);
});

