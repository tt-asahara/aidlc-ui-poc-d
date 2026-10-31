import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const cli = join(import.meta.dir, "..", "generic-auto-cli.ts");
function fixture(config: object) {
  const root = mkdtempSync(join(tmpdir(), "d-generic-auto-"));
  mkdirSync(join(root, ".claude", "tools"), { recursive: true });
  mkdirSync(join(root, ".aidlc-engine"), { recursive: true });
  writeFileSync(join(root, ".claude", "d-acceleration.jsonc"), JSON.stringify(config));
  writeFileSync(join(root, ".claude", "tools", "aidlc-orchestrate.ts"), `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2), at = args.indexOf("--project-dir"), root = args[at + 1];
writeFileSync(join(root, "official-argv.json"), JSON.stringify(args.filter((_, i) => i !== at && i !== at + 1)));
process.stdout.write(JSON.stringify({ kind: "ask", ask_type: "scope-confirm", gate: true, question: "Choose scope" }));
`);
  return root;
}
const STAGES = "- [ ] intent-capture — EXECUTE\n- [ ] scope-definition — EXECUTE\n- [ ] requirements-analysis — EXECUTE\n- [ ] units-generation — EXECUTE\n- [ ] code-generation — EXECUTE\n";
// Simulates the record upstream `intent create` builds: state plus a WORKFLOW_STARTED audit row.
function intentRecord(root: string, intent: string, startedAt: string, activate = true) {
  const intents = join(root, "aidlc", "spaces", "default", "intents");
  mkdirSync(join(intents, intent, "audit"), { recursive: true });
  writeFileSync(join(intents, intent, "aidlc-state.md"), STAGES);
  writeFileSync(join(intents, intent, "audit", "host-clone.md"), `# AI-DLC Audit Log\n\n## Workflow Started\n**Timestamp**: ${startedAt}\n**Event**: WORKFLOW_STARTED\n\n---\n`);
  if (activate) writeFileSync(join(intents, "active-intent"), `${intent}\n`);
}
function policyTools(root: string) {
  writeFileSync(join(root, ".claude", "tools", "aidlc-orchestrate.ts"), `process.stdout.write(JSON.stringify({kind:"run-stage",stage:"intent-capture",receipt:"first"}));\n`);
  writeFileSync(join(root, ".claude", "tools", "aidlc-state.ts"), `
import { appendFileSync } from "node:fs"; import { join } from "node:path";
const args=process.argv.slice(2), at=args.indexOf("--project-dir"), root=args[at+1]; appendFileSync(join(root,"policy-calls"),args.filter((_,i)=>i!==at&&i!==at+1).join(" ")+"\\n"); process.stdout.write(JSON.stringify({updated:true}));
`);
}
const run = (root: string, args: string[]) => spawnSync(process.execPath, [cli, ...args, "--project-dir", root], { cwd: root, encoding: "utf8" });

describe("generic /aidlc --auto controller", () => {
  test("routes the representative budget request and preserves bounded human-gated continuation", () => {
    const root = fixture({ auto: { enabled: true, sessionOnly: false, through: "inception", maxSteps: 3, deadlineMs: 60000 } });
    const description = "架空データだけを使う予算管理Webアプリを作ってください。収支登録、カテゴリ別予算、月次集計、CSV入出力が必要です。TypeScriptで実装し、実口座連携・外部送信は不要です。";
    writeFileSync(join(root, ".aidlc-engine", "representative-request.txt"), description);

    const routed = JSON.parse(run(root, ["start", "--description-file", ".aidlc-engine/representative-request.txt"]).stdout);
    expect(routed).toMatchObject({ status: "routed", reason: "human-gate", directive: { ask_type: "scope-confirm", gate: true }, hostControl: { through: "inception", maxSteps: 3 } });
    const officialArgv = JSON.parse(readFileSync(join(root, "official-argv.json"), "utf8"));
    expect(officialArgv).toEqual(["next", description]);
    expect(officialArgv.join(" ")).not.toContain("/aidlc");
    expect(officialArgv.join(" ")).not.toContain("--auto");

    expect(run(root, ["init", "--active-stages", "requirements-analysis,units-generation"]).status).toBe(0);
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "run-stage", stage: "requirements-analysis", receipt: "work-1" }));
    expect(JSON.parse(run(root, ["checkpoint", "--directive-file", "directive.json"]).stdout)).toMatchObject({ action: "continue", state: { steps: 1 } });
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "ask", stage: "requirements-analysis", gate: true, receipt: "approval-1" }));
    expect(JSON.parse(run(root, ["checkpoint", "--directive-file", "directive.json"]).stdout)).toMatchObject({ action: "stop", reason: "human-gate", state: { awaitingHuman: true, steps: 2 } });
  });

  test("chains initialization and checkpointing for the first post-intent directive", () => {
    const root = fixture({ auto: { enabled: true, sessionOnly: false, through: "inception", maxSteps: 3, deadlineMs: 60000 } });
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "run-stage", stage: "intent-capture", receipt: "intent-1" }));

    const resumed = run(root, ["resume", "--active-stages", "intent-capture,scope-definition,requirements-analysis", "--directive-file", "directive.json"]);
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(JSON.parse(resumed.stdout)).toMatchObject({
      action: "continue",
      initialized: true,
      state: { through: "requirements-analysis", activeStages: ["intent-capture", "scope-definition", "requirements-analysis"], steps: 1 },
    });
    expect(existsSync(join(root, ".aidlc-engine", "d-autopilot-session.json"))).toBeTrue();

    const replay = run(root, ["resume", "--active-stages", "intent-capture,scope-definition,requirements-analysis", "--directive-file", "directive.json"]);
    expect(replay.status).toBe(0);
    expect(JSON.parse(replay.stdout)).toMatchObject({ action: "stop", reason: "no-progress", initialized: false });
  });

  test("bootstraps the Intent the host created from the official print into the first checkpoint", () => {
    const root = fixture({ auto: { enabled: true, sessionOnly: false, through: "inception", maxSteps: 4, deadlineMs: 60000 }, constructionDefaults: { iteration: "stage-major", execution: "swarm" } });
    writeFileSync(join(root, "request.txt"), "Build a budget web app");
    expect(run(root, ["start", "--description-file", "request.txt"]).status).toBe(0);
    // No Intent exists yet: bootstrap never creates one itself.
    const early = run(root, ["bootstrap"]);
    expect(early.status).not.toBe(0);
    expect(early.stderr).toContain("no new official Intent since generic auto start");
    // The host ran the official print's intent-create exactly (simulated here).
    intentRecord(root, "261017-budget-app", new Date().toISOString());
    policyTools(root);

    const result = run(root, ["bootstrap"]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ action: "continue", initialized: true, activeStages: ["intent-capture", "scope-definition", "requirements-analysis", "units-generation", "code-generation"], directive: { stage: "intent-capture" }, state: { steps: 1, through: "units-generation" } });
    expect(readFileSync(join(root, "policy-calls"), "utf8")).toBe("set-construction-iteration stage-major\nset-construction-execution swarm\n");
    const replay = run(root, ["bootstrap"]);
    expect(replay.status, replay.stderr).toBe(0);
    expect(JSON.parse(replay.stdout)).toMatchObject({ action: "continue", initialized: false, reason: "already-bootstrapped", state: { steps: 1 } });
  });

  test("bootstrap never rewrites the Construction policy of an Intent not created after start", () => {
    const config = { auto: { enabled: true, sessionOnly: false, through: "inception", maxSteps: 4, deadlineMs: 60000 }, constructionDefaults: { iteration: "stage-major", execution: "swarm" } };
    // Intent B existed (inactive) before start; the person then switches to / resumes it.
    const switched = fixture(config);
    intentRecord(switched, "260901-intent-a", "2026-09-01T00:00:00Z");
    intentRecord(switched, "260902-intent-b", "2026-09-02T00:00:00Z", false);
    writeFileSync(join(switched, "request.txt"), "Build a budget web app");
    expect(run(switched, ["start", "--description-file", "request.txt"]).status).toBe(0);
    expect(JSON.parse(readFileSync(join(switched, ".aidlc-engine", "d-auto-start.json"), "utf8")).preIntents).toEqual(["260901-intent-a", "260902-intent-b"]);
    writeFileSync(join(switched, "aidlc", "spaces", "default", "intents", "active-intent"), "260902-intent-b\n");
    policyTools(switched);
    const refused = run(switched, ["bootstrap"]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("active Intent 260902-intent-b was not created after generic auto start");
    expect(existsSync(join(switched, "policy-calls"))).toBeFalse();
    expect(existsSync(join(switched, ".aidlc-engine", "d-autopilot-session.json"))).toBeFalse();

    // A record that appears after start but whose WORKFLOW_STARTED predates it (e.g. pulled from git).
    const pulled = fixture(config);
    writeFileSync(join(pulled, "request.txt"), "Build a budget web app");
    expect(run(pulled, ["start", "--description-file", "request.txt"]).status).toBe(0);
    intentRecord(pulled, "250101-old-work", "2025-01-01T00:00:00Z");
    policyTools(pulled);
    expect(run(pulled, ["bootstrap"]).stderr).toContain("was not created after generic auto start");
    expect(existsSync(join(pulled, "policy-calls"))).toBeFalse();

    // A start journal from before the inventory existed cannot prove creation.
    const legacy = fixture(config);
    writeFileSync(join(legacy, ".aidlc-engine", "d-auto-start.json"), JSON.stringify({ version: 1, space: "default", preActive: null, descriptionSha256: "0".repeat(64), startedAt: "2026-01-01T00:00:00.000Z" }));
    intentRecord(legacy, "261017-new", new Date().toISOString());
    policyTools(legacy);
    expect(run(legacy, ["bootstrap"]).stderr).toContain("start journal predates the Intent inventory");
    expect(existsSync(join(legacy, "policy-calls"))).toBeFalse();
  });

  test("bootstrap refuses a directive handoff and a missing start", () => {
    const root = fixture({ auto: { enabled: true, sessionOnly: false } });
    writeFileSync(join(root, "creation.json"), JSON.stringify({ kind: "print", message: "x", machine_action: { kind: "intent-create", argv: ["intent", "create", "--scope", "feature", "--request", "1234abcd"] } }));
    const typed = run(root, ["bootstrap", "--directive-file", "creation.json"]);
    expect(typed.status).not.toBe(0);
    expect(typed.stderr).toContain("bootstrap takes no directive");
    const unstarted = run(root, ["bootstrap"]);
    expect(unstarted.status).not.toBe(0);
    expect(unstarted.stderr).toContain("requires a generic auto start");
  });

  test("routes arbitrary description as one official argv value without leaking --auto", () => {
    const root = fixture({ auto: { enabled: true, sessionOnly: false, through: "inception", maxSteps: 7, deadlineMs: 60000 } });
    const description = "Build a budget app; $(touch nope)\nwith approvals";
    writeFileSync(join(root, ".aidlc-engine", "request.txt"), description);
    const result = run(root, ["start", "--description-file", ".aidlc-engine/request.txt"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "routed", reason: "human-gate", directive: { kind: "ask", ask_type: "scope-confirm" }, hostControl: { through: "inception", maxSteps: 7, deadlineMs: 60000 } });
    expect(JSON.parse(readFileSync(join(root, "official-argv.json"), "utf8"))).toEqual(["next", description]);
    expect(readFileSync(join(root, ".aidlc-engine", "request.txt"), "utf8")).toBe(description);
    expect(existsSync(join(root, "nope"))).toBeFalse();
  });

  test("consumes only the skill's request handoff file, in every outcome", () => {
    for (const auto of [{ enabled: true, sessionOnly: false }, { enabled: false, sessionOnly: false }]) {
      const root = fixture({ auto });
      const handoff = join(root, ".aidlc-engine", "d-auto-request-a1B2_c3.txt");
      writeFileSync(handoff, "Build a tiny todo CLI");
      const result = run(root, ["start", "--description-file", ".aidlc-engine/d-auto-request-a1B2_c3.txt"]);
      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(handoff)).toBeFalse();
      const lookalike = join(root, ".aidlc-engine", "d-auto-request-x.txt.keep");
      writeFileSync(lookalike, "Build it");
      run(root, ["start", "--description-file", ".aidlc-engine/d-auto-request-x.txt.keep"]);
      expect(existsSync(lookalike)).toBeTrue();
    }
  });

  test("fails closed when auto is disabled or session-only", () => {
    for (const auto of [{ enabled: false, sessionOnly: false }, { enabled: true, sessionOnly: true }]) {
      const root = fixture({ auto });
      writeFileSync(join(root, ".aidlc-engine", "request.txt"), "Build it");
      expect(JSON.parse(run(root, ["start", "--description-file", ".aidlc-engine/request.txt"]).stdout).reason).toBe(auto.enabled ? "session-only" : "disabled");
      expect(existsSync(join(root, "official-argv.json"))).toBeFalse();
    }
  });

  test("rejects description symlinks and initializes configured bounded session", () => {
    const root = fixture({ auto: { enabled: true, sessionOnly: false, through: "inception", maxSteps: 5, deadlineMs: 45000 } });
    writeFileSync(join(root, ".aidlc-engine", "real.txt"), "Build it");
    symlinkSync(join(root, ".aidlc-engine", "real.txt"), join(root, ".aidlc-engine", "link.txt"));
    expect(run(root, ["start", "--description-file", ".aidlc-engine/link.txt"]).status).not.toBe(0);
    const initialized = run(root, ["init", "--active-stages", "requirements-analysis,units-generation"]);
    expect(initialized.status).toBe(0);
    expect(JSON.parse(initialized.stdout)).toMatchObject({ action: "continue", state: { through: "units-generation", maxSteps: 5, deadlineMs: 45000, steps: 0 } });
  });

  test("checkpoint preserves human gates and enforces configured step bound", () => {
    const root = fixture({ auto: { enabled: true, sessionOnly: false, maxSteps: 1, deadlineMs: 45000 } });
    expect(run(root, ["init", "--active-stages", "requirements-analysis"]).status).toBe(0);
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "ask", stage: "requirements-analysis", gate: true, receipt: "human-1" }));
    const gate = JSON.parse(run(root, ["checkpoint", "--directive-file", "directive.json"]).stdout);
    expect(gate).toMatchObject({ action: "stop", reason: "human-gate", state: { awaitingHuman: true, steps: 1 } });
    expect(run(root, ["init", "--active-stages", "requirements-analysis"]).status).toBe(0);
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "run-stage", stage: "requirements-analysis", receipt: "work-2" }));
    expect(JSON.parse(run(root, ["checkpoint", "--directive-file", "directive.json"]).stdout)).toMatchObject({ action: "stop", reason: "max-steps-exceeded" });
  });

  test("stop is wired through the generic controller and prevents resume", () => {
    const root = fixture({ auto: { enabled: true, sessionOnly: false, maxSteps: 3, deadlineMs: 45000 } });
    expect(run(root, ["init", "--active-stages", "requirements-analysis"]).status).toBe(0);
    expect(JSON.parse(run(root, ["stop"]).stdout)).toMatchObject({ action: "stop", reason: "operator-stop", state: { terminalReason: "operator-stop" } });
    expect(JSON.parse(run(root, ["status"]).stdout)).toMatchObject({ active: false, state: { terminalReason: "operator-stop" } });
  });
});
