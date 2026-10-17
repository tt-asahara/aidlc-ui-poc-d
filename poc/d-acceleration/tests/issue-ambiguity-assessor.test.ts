import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeIssueAssessor } from "../issue-ambiguity-assessor.ts";
import type { Issue } from "../issue-autopilot.ts";

const issue: Issue = { number: 42, title: "Budget currency", body: "Track a household budget, but the currency is not specified.", labels: ["aidlc-auto"], state: "open" };
const executable = (path: string, source: string) => { writeFileSync(path, `#!/usr/bin/env bun\n${source}`); chmodSync(path, 0o755); };

describe("bounded Issue ambiguity assessor", () => {
  test("uses fixed no-tool argv and returns explicit assumptions", async () => {
    const root = mkdtempSync(join(tmpdir(), "d-assessor-")), fake = join(root, "fake-claude.ts");
    executable(fake, `import {writeFileSync} from "node:fs"; writeFileSync("assessor-argv.json", JSON.stringify(process.argv.slice(2))); console.log(JSON.stringify({result:JSON.stringify({unresolved:[],assumptions:["Use JPY until the user specifies another currency"],researchedFacts:[]})}));`);
    const result = await createClaudeIssueAssessor({ projectDir: root, model: "fixture-judgment", executable: fake }).assess(issue, "assume");
    expect(result).toEqual({ unresolved: [], assumptions: ["Use JPY until the user specifies another currency"], researchedFacts: [], description: issue.body, modelIdentity: { requested: "fixture-judgment", runtimeReported: null, runtimeReportedModels: [], status: "unverified", source: "none" } });
    const argv = JSON.parse(readFileSync(join(root, "assessor-argv.json"), "utf8")) as string[];
    for (const expected of ["--no-session-persistence", "--restricted", "--strict-mcp-config", "--disable-slash-commands", "--tools", "--allowed-tools", "--disallowed-tools", "--model", "fixture-judgment", "--effort", "high"]) expect(argv).toContain(expected);
    expect(argv[argv.indexOf("--tools") + 1]).toBe("");
    expect(argv[argv.indexOf("--allowed-tools") + 1]).toBe("");
    expect(argv[argv.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
    expect(argv.at(-1)).toContain("Do not approve work");
  });

  test("records verified runtime identity from Claude modelUsage", async () => {
    const root = mkdtempSync(join(tmpdir(), "d-assessor-")), fake = join(root, "fake-claude.ts");
    executable(fake, `console.log(JSON.stringify({result:JSON.stringify({unresolved:[],assumptions:[],researchedFacts:[]}),modelUsage:{"claude-opus-5-5":{inputTokens:3,outputTokens:4,costUSD:0.01,canonicalModel:"claude-opus-5-5",costBasis:"list"}}}));`);
    const result = await createClaudeIssueAssessor({ projectDir: root, model: "claude-opus-5-5", executable: fake }).assess(issue, "assume");
    expect(result.modelIdentity).toMatchObject({ requested: "claude-opus-5-5", runtimeReported: "claude-opus-5-5", status: "verified-match", source: "claude-modelUsage" });
  });

  test("tells the model which fields each policy forbids", async () => {
    const root = mkdtempSync(join(tmpdir(), "d-assessor-")), fake = join(root, "fake-claude.ts");
    executable(fake, `import {appendFileSync} from "node:fs"; appendFileSync("prompts.jsonl", JSON.stringify(process.argv.at(-1))+"\\n"); console.log(JSON.stringify({result:JSON.stringify({unresolved:["x"],assumptions:[],researchedFacts:[]})}));`);
    const assessor = createClaudeIssueAssessor({ projectDir: root, model: "fixture", executable: fake });
    for (const mode of ["halt", "assume", "research"] as const) await assessor.assess(issue, mode);
    const prompts = readFileSync(join(root, "prompts.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as string);
    expect(prompts[0]).toContain("assumptions and researchedFacts MUST both be empty arrays");
    expect(prompts[1]).toContain("researchedFacts MUST be an empty array");
    expect(prompts[2]).toContain("assumptions MUST be an empty array");
  }, 30_000);

  test("connects research facts while retaining unresolved evidence needs", async () => {
    const root = mkdtempSync(join(tmpdir(), "d-assessor-")), fake = join(root, "fake-claude.ts");
    executable(fake, `console.log(JSON.stringify({result:JSON.stringify({unresolved:["Current exchange rate requires external evidence"],assumptions:[],researchedFacts:["ISO 4217 identifies currencies with three-letter codes"]})}));`);
    const result = await createClaudeIssueAssessor({ projectDir: root, model: "fixture-judgment", executable: fake }).assess(issue, "research");
    expect(result).toMatchObject({ unresolved: ["Current exchange rate requires external evidence"], assumptions: [], researchedFacts: ["ISO 4217 identifies currencies with three-letter codes"] });
  });

  test("fails closed on unavailable, invalid, oversized, and timed-out model results", async () => {
    const unavailableRoot = mkdtempSync(join(tmpdir(), "d-assessor-"));
    const unavailable = await createClaudeIssueAssessor({ projectDir: unavailableRoot, model: "fixture", executable: join(unavailableRoot, "missing") }).assess(issue, "halt");
    expect(unavailable.unresolved[0]).toContain("failed closed");

    const invalidRoot = mkdtempSync(join(tmpdir(), "d-assessor-")), invalid = join(invalidRoot, "invalid.ts");
    executable(invalid, `console.log(JSON.stringify({result:JSON.stringify({unresolved:[],assumptions:[],researchedFacts:[],approval:"approved"})}));`);
    const malformed = await createClaudeIssueAssessor({ projectDir: invalidRoot, model: "fixture", executable: invalid }).assess(issue, "halt");
    expect(malformed.unresolved).toEqual(["Ambiguity assessment failed closed: model returned invalid structured output"]);

    const oversized = await createClaudeIssueAssessor({ projectDir: invalidRoot, model: "fixture", executable: invalid }).assess({ ...issue, body: "x".repeat(129 * 1024) }, "halt");
    expect(oversized.unresolved[0]).toContain("exceeds the bounded assessor limit");

    const timeoutRoot = mkdtempSync(join(tmpdir(), "d-assessor-")), timeout = join(timeoutRoot, "timeout.ts");
    executable(timeout, `await Bun.sleep(5000);`);
    const timedOut = await createClaudeIssueAssessor({ projectDir: timeoutRoot, model: "fixture", executable: timeout, timeoutMs: 20 }).assess(issue, "halt");
    expect(timedOut.unresolved).toEqual(["Ambiguity assessment failed closed: model execution timeout"]);
  });

  test("rejects cross-policy fields instead of silently treating them as evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "d-assessor-")), fake = join(root, "fake-claude.ts");
    executable(fake, `console.log(JSON.stringify({result:JSON.stringify({unresolved:[],assumptions:["Pretend approval"],researchedFacts:[]})}));`);
    const result = await createClaudeIssueAssessor({ projectDir: root, model: "fixture", executable: fake }).assess(issue, "halt");
    expect(result.unresolved).toEqual(["Ambiguity assessment failed closed: model returned invalid structured output"]);
  });
});
