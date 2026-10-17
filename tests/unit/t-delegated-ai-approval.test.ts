import { afterEach, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { AIDLC_SRC, cleanupTestProject, createTestProject, seededAuditShard, seededRecordDir, seededStateFile, seedStateFile } from "../harness/fixtures.ts";
import { stateDigest, steeringReceiptFor, steeringTokenKeyPathFor, writeActiveDirectiveMarker } from "../../core/tools/aidlc-lib.ts";

const projects: string[] = [];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value);
const bindGrant = <T extends Record<string, unknown>>(grant: T): T & { requestSha256: string } => ({ ...grant, requestSha256: sha(canonical(grant)) });
const stateTool = join(AIDLC_SRC, "tools", "aidlc-state.ts");
function run(project: string, args: string[], skipHumanPresence = true) {
  const env: Record<string, string | undefined> = { ...process.env, AIDLC_SKIP_ARTIFACT_GUARD: "1", AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD: "1", AIDLC_ALLOW_DIRECT_STATE_TRANSITIONS: "1" };
  env.PATH = `${project}:${process.env.PATH ?? ""}`;
  if (skipHumanPresence) env.AIDLC_SKIP_HUMAN_PRESENCE_GUARD = "1";
  else delete env.AIDLC_SKIP_HUMAN_PRESENCE_GUARD;
  return spawnSync(process.execPath, [stateTool, ...args, "--project-dir", project], { cwd: project, encoding: "utf8", env });
}

afterEach(() => { for (const project of projects.splice(0)) cleanupTestProject(project); });

describe("delegated AI stage approval", () => {
  test("rejects an interpreted publication adapter even after a payload-bound host receipt", () => {
    const project = createTestProject(); projects.push(project);
    seedStateFile(project, "state-mid-ideation.md");
    const record = seededRecordDir(project), decisions = join(record, "decisions"); mkdirSync(decisions, { recursive: true });
    const evidence = join(record, "evidence.md"); writeFileSync(evidence, "verified\n");
    const ledger = join(decisions, "ai-approval-decisions.jsonl");
    writeFileSync(ledger, `${JSON.stringify({ schemaVersion: 1, decisionId: "1".repeat(64), stage: "feasibility", outcome: "approve", reason: "verified", evidence: [{ path: relative(project, evidence), sha256: sha(readFileSync(evidence)) }], uncertainties: [] })}\n`);
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude/d-acceleration.jsonc"), JSON.stringify({ decisionIssueSummary: { enabled: true, repository: "owner/repo", send: true } }));
    const summaryTool = join(process.cwd(), "poc/d-acceleration/decision-issue-summary.ts");
    const baseArgs = ["--project-dir", project, "--intent-dir", record, "--decisions-file", ledger];
    const generated = spawnSync(process.execPath, [summaryTool, "generate", ...baseArgs], { cwd: project, encoding: "utf8" });
    expect(generated.status, `${generated.stdout}${generated.stderr}`).toBe(0);
    const payload = JSON.parse(generated.stdout).payload;
    const payloadSha256 = sha(JSON.stringify(payload));
    const intent = relative(project, record).split("\\").join("/");
    const prompt = `AI-DLC authorize-decision-summary --repository owner/repo --intent ${intent} --payload-sha256 ${payloadSha256}`;
    const hook = spawnSync(process.execPath, [join(AIDLC_SRC, "tools", "aidlc.ts"), "engine", "hook", "record-human-turn", "--project-dir", project], { cwd: project, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: project }, input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "01995000-dead-7000-8000-000000000003", prompt }) });
    expect(hook.status, `${hook.stdout}${hook.stderr}`).toBe(0);
    const fakeBin = mkdtempSync(join(tmpdir(), "aidlc-trusted-bin-")); projects.push(fakeBin);
    const fakeGh = join(fakeBin, "gh");
    writeFileSync(fakeGh, `#!/usr/bin/env bun\nimport {writeFileSync} from "node:fs"; writeFileSync("gh-argv.json",JSON.stringify(process.argv.slice(2))); console.log("https://github.com/owner/repo/issues/41");\n`); chmodSync(fakeGh, 0o755);
    const published = spawnSync(process.execPath, [summaryTool, "publish", ...baseArgs], { cwd: project, encoding: "utf8", env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`, AIDLC_GH_EXECUTABLE_PATH: fakeGh, AIDLC_GH_EXECUTABLE_SHA256: sha(readFileSync(fakeGh)) } });
    expect(published.status).toBe(2);
    expect(JSON.parse(published.stdout)).toMatchObject({ status: "stopped" });
    expect(published.stdout).toContain("native binary");
  });

  test("verifies an exact host-recorded decision-summary publication receipt", () => {
    const project = createTestProject(); projects.push(project);
    seedStateFile(project, "state-mid-ideation.md");
    const intent = relative(project, seededRecordDir(project)).split("\\").join("/");
    const repository = "owner/repo", payloadSha256 = "a".repeat(64);
    const prompt = `AI-DLC authorize-decision-summary --repository ${repository} --intent ${intent} --payload-sha256 ${payloadSha256}`;
    const hook = spawnSync(process.execPath, [join(AIDLC_SRC, "tools", "aidlc.ts"), "engine", "hook", "record-human-turn", "--project-dir", project], {
      cwd: project, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: project },
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "01995000-dead-7000-8000-000000000001", prompt }),
    });
    expect(hook.status, `${hook.stdout}${hook.stderr}`).toBe(0);
    const verified = spawnSync(process.execPath, [stateTool, "verify-decision-summary-permission", "--repository", repository, "--intent", intent, "--payload-sha256", payloadSha256, "--project-dir", project], { cwd: project, encoding: "utf8" });
    expect(verified.status, `${verified.stdout}${verified.stderr}`).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ authorized: true, repository, intent, payloadSha256 });
    const refused = spawnSync(process.execPath, [stateTool, "verify-decision-summary-permission", "--repository", repository, "--intent", intent, "--payload-sha256", "b".repeat(64), "--project-dir", project], { cwd: project, encoding: "utf8" });
    expect(refused.status).not.toBe(0);
  });

  test("rejects a project-local PATH assessor and never mints a human reply", () => {
    const project = createTestProject(); projects.push(project);
    seedStateFile(project, "state-mid-ideation.md");
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude/d-acceleration.jsonc"), JSON.stringify({ aiApproval: { mode: "stage-gates", minConfidence: 0.9, decisionRecordPath: "decisions/ai-approval-decisions.jsonl" } }));
    const fakeClaude = join(project, "claude"); writeFileSync(fakeClaude, "#!/bin/sh\nexit 0\n"); chmodSync(fakeClaude, 0o755);
    // This fixture deliberately omits the stage question artifact that gate-start
    // validates; seed only the already-open gate so this test isolates approval
    // authority and the normal approve transition.
    expect(run(project, ["checkbox", "feasibility=awaiting-approval"]).status).toBe(0);
    const record = seededRecordDir(project), decisions = join(record, "decisions"); mkdirSync(decisions, { recursive: true });
    const delegatedWords = "AI-DLC delegate-ai-approvals --scope feature --through construction --stages feasibility";
    const hook = spawnSync(process.execPath, [join(AIDLC_SRC, "tools", "aidlc.ts"), "engine", "hook", "record-human-turn", "--project-dir", project], {
      cwd: project, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: project },
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "01995000-dead-7000-8000-000000000002", prompt: delegatedWords }),
    });
    expect(hook.status, `${hook.stdout}${hook.stderr}`).toBe(0);
    const grantFields = { messageId: "Sentinel_fixture", userMessage: delegatedWords, userMessageSha256: sha(delegatedWords), mode: "stage-gates", scope: "feature", through: "construction", allowedStages: ["feasibility"], minConfidence: 0.9 };
    const grant = { schemaVersion: 1, ...bindGrant(grantFields) };
    const grantPath = join(decisions, "delegation.json"); writeFileSync(grantPath, JSON.stringify(grant));
    const memoryPath = join(record, "memory.md"); writeFileSync(memoryPath, "gate memory\n");
    const directivePath = join(record, "directive.json"); writeFileSync(directivePath, JSON.stringify({ kind: "present-gate", stage: "feasibility", phase: "ideation", memory_path: relative(project, memoryPath) }));
    const directiveSha256 = sha(readFileSync(directivePath));
    const key = randomBytes(32), keyPath = steeringTokenKeyPathFor(project, seededStateFile(project)); mkdirSync(dirname(keyPath), { recursive: true }); writeFileSync(keyPath, key.toString("base64url"));
    const gatePayload = { v: 1, s: "feasibility", c: "present-gate", i: 1, b: "", d: directiveSha256, r: "", a: false, u: null, k: null, f: false, g: true, n: null, x: false, p: false, w: false };
    writeActiveDirectiveMarker(project, { kind: "present-gate", stage: "feasibility", state_sha256: stateDigest(readFileSync(seededStateFile(project), "utf8")), directive_sha256: directiveSha256, steering_payload: gatePayload, steering_payload_receipt: steeringReceiptFor(gatePayload, key) });
    const artifactPath = join(decisions, "evidence.md"); writeFileSync(artifactPath, "reviewed evidence\n");
    const binding = { schemaVersion: 1, directiveSha256: sha(readFileSync(directivePath)), stage: "feasibility", stateSha256: sha(readFileSync(seededStateFile(project))), delegationSha256: sha(readFileSync(grantPath)), evidence: [{ path: relative(project, artifactPath), sha256: sha(readFileSync(artifactPath)) }] };
    const ledgerPath = join(decisions, "ai-approval-decisions.jsonl");
    const decision = { schemaVersion: 1, decisionId: sha(canonical(binding)), actor: "ai", ledgerPath: relative(project, ledgerPath), outcome: "approve", stage: binding.stage, reason: "All declared evidence is verified and the bounded PoC has no external effects.", confidence: 0.98, directive: { path: relative(project, directivePath), sha256: binding.directiveSha256 }, directiveSha256: binding.directiveSha256, stateSha256: binding.stateSha256, delegation: { path: relative(project, grantPath), sha256: binding.delegationSha256, messageId: grant.messageId }, evidence: binding.evidence, riskFlags: [], uncertainties: [], createdAt: "2026-10-17T00:00:00Z" };
    writeFileSync(ledgerPath, `${JSON.stringify(decision)}\n`);
    const decisionPath = join(decisions, "decision.json"); writeFileSync(decisionPath, JSON.stringify(decision));
    const approved = spawnSync(process.execPath, [stateTool, "approve", "feasibility", "--ai-decision-file", relative(project, decisionPath), "--project-dir", project], { cwd: project, encoding: "utf8", env: { ...process.env, PATH: project, AIDLC_SKIP_ARTIFACT_GUARD: "1", AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD: "1", AIDLC_ALLOW_DIRECT_STATE_TRANSITIONS: "1" } });
    expect(approved.status).not.toBe(0);
    expect(`${approved.stdout}${approved.stderr}`).toContain("no trusted native Claude executable was found on PATH");
    const audit = readFileSync(seededAuditShard(project), "utf8");
    expect(audit).not.toContain("**Decision Actor**: AI");
    expect(audit).not.toContain("**User Input**:");
  });

  test("rejects a stale decision and leaves the gate open", () => {
    const project = createTestProject(); projects.push(project);
    seedStateFile(project, "state-mid-ideation.md");
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude/d-acceleration.jsonc"), JSON.stringify({ aiApproval: { mode: "stage-gates", minConfidence: 0.9, decisionRecordPath: "decisions/ai-approval-decisions.jsonl" } }));
    expect(run(project, ["checkbox", "feasibility=awaiting-approval"]).status).toBe(0);
    const record = seededRecordDir(project), decisions = join(record, "decisions"); mkdirSync(decisions, { recursive: true });
    const delegatedWords = "AI-DLC delegate-ai-approvals --scope feature --through construction --stages feasibility";
    const grantFields = { messageId: "Sentinel_fixture", userMessage: delegatedWords, userMessageSha256: sha(delegatedWords), mode: "stage-gates", scope: "feature", through: "construction", allowedStages: ["feasibility"], minConfidence: 0.9 };
    const grant = { schemaVersion: 1, ...bindGrant(grantFields) };
    const grantPath = join(decisions, "delegation.json"); writeFileSync(grantPath, JSON.stringify(grant));
    const artifactPath = join(decisions, "evidence.md"); writeFileSync(artifactPath, "evidence\n");
    const decisionPath = join(decisions, "decision.json"); writeFileSync(decisionPath, JSON.stringify({ schemaVersion: 1, decisionId: "d".repeat(64), actor: "ai", ledgerPath: relative(project, join(decisions, "ai-approval-decisions.jsonl")), outcome: "approve", stage: "feasibility", reason: "stale", confidence: 1, directive: { path: relative(project, artifactPath), sha256: "c".repeat(64) }, directiveSha256: "c".repeat(64), stateSha256: "0".repeat(64), delegation: { path: relative(project, grantPath), sha256: sha(readFileSync(grantPath)), messageId: grant.messageId }, evidence: [{ path: relative(project, artifactPath), sha256: sha(readFileSync(artifactPath)) }], riskFlags: [], uncertainties: [], createdAt: "2026-10-17T00:00:00Z" }));
    const refused = run(project, ["approve", "feasibility", "--ai-decision-file", relative(project, decisionPath)]);
    expect(refused.status).not.toBe(0);
    expect(`${refused.stdout}${refused.stderr}`).toContain("stale");
    expect(readFileSync(seededStateFile(project), "utf8")).toContain("- [?] feasibility");
  });
});
