import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDecisionIssueSummary, type GhAdapter, type GhResult } from "../decision-issue-summary.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "decision-issue-summary-"));
  const intent = join(root, "aidlc/spaces/default/intents/budget");
  mkdirSync(join(intent, "decisions"), { recursive: true });
  writeFileSync(join(root, "aidlc/spaces/default/intents/active-intent"), "budget\n");
  writeFileSync(join(intent, "aidlc-state.md"), "- **Scope**: feature\n");
  const log = join(intent, "decisions/ai-approval-decisions.jsonl");
  writeFileSync(log, [
    JSON.stringify({ schemaVersion: 1, decisionId: "1".repeat(64), stage: "requirements-analysis", outcome: "approve", reason: "Keep deletion confirmation count-only", evidence: [{ path: "aidlc/spaces/default/intents/budget/requirements.md", sha256: "a".repeat(64) }], uncertainties: [] }),
    JSON.stringify({ schemaVersion: 1, decisionId: "2".repeat(64), stage: "functional-design", outcome: "block", reason: "CSV delimiter is undecided", evidence: [{ path: "aidlc/spaces/default/intents/budget/functional-design.md", sha256: "b".repeat(64) }], uncertainties: ["delimiter"] }),
  ].join("\n"));
  return { root, intent, log };
}
const config = { enabled: true, repository: "owner/repo", send: false, maxRetries: 2 };
async function authorize(root: string, intent: string, log: string): Promise<void> {
  const preview = await runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config });
  const payloadSha256 = createHash("sha256").update(JSON.stringify(preview.payload)).digest("hex");
  const intentRelative = `aidlc/spaces/default/intents/budget`;
  const prompt = `AI-DLC authorize-decision-summary --repository owner/repo --intent ${intentRelative} --payload-sha256 ${payloadSha256}`;
  const tool = join(import.meta.dir, "..", "..", "..", "core", "tools", "aidlc.ts");
  const hook = spawnSync(process.execPath, [tool, "engine", "hook", "record-human-turn", "--project-dir", root], { cwd: root, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root }, input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "01995000-dead-7000-8000-000000000004", prompt }) });
  if (hook.status !== 0) throw new Error(hook.stderr || hook.stdout);
}

class FakeGh implements GhAdapter {
  calls: readonly string[][] = [];
  constructor(private readonly answers: GhResult[]) {}
  async run(args: readonly string[]) { this.calls = [...this.calls, [...args]]; return this.answers.shift() ?? { status: 1, stdout: "", stderr: "unexpected" }; }
}

describe("decision Issue summary", () => {
  test("defaults safely and generates one local payload without calling GitHub", async () => {
    const { root, intent, log } = fixture(); const gh = new FakeGh([]);
    expect(await runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config: { ...config, enabled: false }, gh })).toEqual({ status: "stopped", reason: "disabled" });
    const result = await runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config, gh });
    expect(result).toMatchObject({ status: "generated", published: false, payload: { repository: "owner/repo", intent: "aidlc/spaces/default/intents/budget" } });
    expect(JSON.stringify(result)).toContain("requirements-analysis"); expect(JSON.stringify(result)).toContain("functional-design");
    expect(gh.calls).toEqual([]);
  });

  test("requires repository and explicit publish authorization", async () => {
    const { root, intent, log } = fixture(); const gh = new FakeGh([]);
    expect(await runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config: { ...config, repository: undefined }, gh })).toMatchObject({ reason: "repository-required" });
    expect(await runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config: { ...config, send: true }, gh })).toMatchObject({ status: "stopped" });
    expect(gh.calls).toEqual([]);
    expect(gh.calls).toEqual([]);
  });

  test("binds publication to the active Intent, canonical ledger, and one concurrent publisher", async () => {
    const { root, intent, log } = fixture();
    const other = join(root, "aidlc/spaces/default/intents/other"); mkdirSync(other, { recursive: true }); writeFileSync(join(other, "aidlc-state.md"), "- **Scope**: feature\n");
    await expect(runDecisionIssueSummary({ projectDir: root, intentDir: other, decisionsFile: log, config })).rejects.toThrow("active Intent");
    const alternate = join(intent, "other.jsonl"); writeFileSync(alternate, readFileSync(log));
    await expect(runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: alternate, config })).rejects.toThrow("canonical Intent ledger");
    const preview = await runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config });
    const key = (preview.payload as { key: string }).key;
    const state = join(root, ".aidlc-engine/d-decision-issue-summary"); mkdirSync(state, { recursive: true }); writeFileSync(join(state, `${key}.lock`), "busy");
    const gh = new FakeGh([]);
    await authorize(root, intent, log);
    expect(await runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config: { ...config, send: true }, gh })).toMatchObject({ reason: "publish-busy" });
    expect(gh.calls).toEqual([]);
  });

  test("rejects unversioned rows and possible secrets before publication", async () => {
    for (const row of [{ decisionId: "1".repeat(64), stage: "test", outcome: "approve", reason: "missing version", evidence: [], uncertainties: [] }, { schemaVersion: 1, decisionId: "1".repeat(64), stage: "test", outcome: "approve", reason: "token=ghp_abcdefghijklmnopqrstuvwxyz", evidence: [], uncertainties: [] }]) {
      const { root, intent, log } = fixture(); writeFileSync(log, `${JSON.stringify(row)}\n`);
      await expect(runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config })).rejects.toThrow(row.schemaVersion ? "possible secret" : "versioned decision");
    }
  });

  test("uses fixed argv, one stable binding per intent, and updates the same Issue", async () => {
    const { root, intent, log } = fixture();
    const preview = await runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config });
    const marker = `<!-- aidlc-decision-summary:${(preview.payload as { key: string }).key} -->`;
    const gh = new FakeGh([{ status: 0, stdout: "https://github.com/owner/repo/issues/41\n" }, { status: 0, stdout: JSON.stringify({ body: marker }) }, { status: 0, stdout: "" }]);
    await authorize(root, intent, log);
    const input = { projectDir: root, intentDir: intent, decisionsFile: log, config: { ...config, send: true }, gh };
    expect(await runDecisionIssueSummary(input)).toMatchObject({ status: "published", operation: "created", issueNumber: 41 });
    expect(await runDecisionIssueSummary(input)).toMatchObject({ status: "published", operation: "updated", issueNumber: 41 });
    expect(gh.calls[0]?.slice(0, 4)).toEqual(["issue", "create", "--repo", "owner/repo"]);
    expect(gh.calls[1]?.slice(0, 5)).toEqual(["issue", "view", "41", "--repo", "owner/repo"]);
    expect(gh.calls[2]?.slice(0, 5)).toEqual(["issue", "edit", "41", "--repo", "owner/repo"]);
    expect(gh.calls).toHaveLength(3);
  });

  test("gh login missing for the repository host stops after permission and before any GitHub call", async () => {
    const { root, intent, log } = fixture(); const gh = new FakeGh([]);
    await authorize(root, intent, log);
    const hosts: string[] = [];
    const result = await runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config: { ...config, send: true }, gh, ghAuth: async (host) => { hosts.push(host); return { ok: false, host, reason: "gh-auth-required", nextStep: `gh auth login --hostname ${host}`, detail: "not logged in" }; } });
    expect(result).toMatchObject({ status: "stopped", reason: "gh-auth-required", host: "github.com", nextStep: "gh auth login --hostname github.com" });
    expect(hosts).toEqual(["github.com"]);
    expect(gh.calls).toEqual([]);
  });

  test("a GHE HOST/owner/name repository is preserved in argv and preflighted against that host", async () => {
    const { root, intent, log } = fixture(); const gheConfig = { ...config, repository: "github.kddi.com/owner/repo" };
    const preview = await runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config: gheConfig });
    const payloadSha256 = createHash("sha256").update(JSON.stringify(preview.payload)).digest("hex");
    const prompt = `AI-DLC authorize-decision-summary --repository github.kddi.com/owner/repo --intent aidlc/spaces/default/intents/budget --payload-sha256 ${payloadSha256}`;
    const tool = join(import.meta.dir, "..", "..", "..", "core", "tools", "aidlc.ts");
    const hook = spawnSync(process.execPath, [tool, "engine", "hook", "record-human-turn", "--project-dir", root], { cwd: root, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root }, input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "01995000-dead-7000-8000-000000000005", prompt }) });
    expect(hook.status).toBe(0);
    const gh = new FakeGh([{ status: 0, stdout: "https://github.kddi.com/owner/repo/issues/7\n" }]);
    const hosts: string[] = [];
    expect(await runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config: { ...gheConfig, send: true }, gh, ghAuth: async (host) => { hosts.push(host); return { ok: true, host }; } })).toMatchObject({ status: "published", operation: "created", issueNumber: 7 });
    expect(hosts).toEqual(["github.kddi.com"]);
    expect(gh.calls[0]?.slice(0, 4)).toEqual(["issue", "create", "--repo", "github.kddi.com/owner/repo"]);
  });

  test("reconciles an ambiguous create receipt and never creates a duplicate", async () => {
    const { root, intent, log } = fixture();
    const preview = await runDecisionIssueSummary({ projectDir: root, intentDir: intent, decisionsFile: log, config });
    const marker = `<!-- aidlc-decision-summary:${(preview.payload as { key: string }).key} -->`;
    const failed = new FakeGh([{ status: 1, stdout: "", stderr: "connection lost after send" }]);
    await authorize(root, intent, log);
    const input = { projectDir: root, intentDir: intent, decisionsFile: log, config: { ...config, send: true } };
    expect(await runDecisionIssueSummary({ ...input, gh: failed })).toMatchObject({ reason: "create-result-ambiguous" });
    const recovered = new FakeGh([{ status: 0, stdout: '[{"number":41}]' }, { status: 0, stdout: JSON.stringify({ body: marker }) }, { status: 0, stdout: "" }]);
    expect(await runDecisionIssueSummary({ ...input, gh: recovered })).toMatchObject({ status: "published", operation: "updated", issueNumber: 41 });
    expect(recovered.calls.map((args) => args.slice(0, 2))).toEqual([["issue", "list"], ["issue", "view"], ["issue", "edit"]]);
    const generated = await runDecisionIssueSummary({ ...input, config: { ...config, send: false } });
    const payload = generated.payload as { key: string };
    expect(readFileSync(join(root, ".aidlc-engine/d-decision-issue-summary", `${payload.key}.json`), "utf8")).toContain('"state":"bound"');
  });

  test("does not create a separate Issue when a pending receipt cannot be reconciled", async () => {
    const { root, intent, log } = fixture(); const input = { projectDir: root, intentDir: intent, decisionsFile: log, config: { ...config, send: true } };
    await authorize(root, intent, log);
    await runDecisionIssueSummary({ ...input, gh: new FakeGh([{ status: 1, stdout: "" }]) });
    const gh = new FakeGh([{ status: 0, stdout: "[]" }]);
    expect(await runDecisionIssueSummary({ ...input, gh })).toMatchObject({ reason: "pending-receipt-unresolved" });
    expect(gh.calls.every((args) => args[1] !== "create")).toBeTrue();
  });

  test("CLI generates a local payload and never contacts GitHub when send is off", () => {
    const { root, intent, log } = fixture(); mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude/d-acceleration.jsonc"), JSON.stringify({ decisionIssueSummary: { enabled: true, repository: "owner/repo", send: false } }));
    const cli = join(import.meta.dir, "..", "decision-issue-summary.ts");
    const result = Bun.spawnSync([process.execPath, cli, "generate", "--project-dir", root, "--intent-dir", intent, "--decisions-file", log], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({ status: "generated", published: false });
  });
});
