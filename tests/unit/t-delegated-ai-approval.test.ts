import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { AIDLC_SRC, cleanupTestProject, createTestProject, seededAuditShard, seededRecordDir, seededStateFile, seedStateFile } from "../harness/fixtures.ts";

const projects: string[] = [];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value);
const bindGrant = <T extends Record<string, unknown>>(grant: T): T & { requestSha256: string } => ({ ...grant, requestSha256: sha(canonical(grant)) });
const stateTool = join(AIDLC_SRC, "tools", "aidlc-state.ts");
function run(project: string, args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env, AIDLC_SKIP_ARTIFACT_GUARD: "1", AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD: "1", AIDLC_ALLOW_DIRECT_STATE_TRANSITIONS: "1" };
  env.AIDLC_SKIP_HUMAN_PRESENCE_GUARD = "1";
  return spawnSync(process.execPath, [stateTool, ...args, "--project-dir", project], { cwd: project, encoding: "utf8", env });
}

afterEach(() => { for (const project of projects.splice(0)) cleanupTestProject(project); });

describe("delegated AI stage approval", () => {
  test("uses a fresh hash-bound AI decision without minting a human reply", () => {
    const project = createTestProject(); projects.push(project);
    seedStateFile(project, "state-mid-ideation.md");
    // This fixture deliberately omits the stage question artifact that gate-start
    // validates; seed only the already-open gate so this test isolates approval
    // authority and the normal approve transition.
    expect(run(project, ["checkbox", "feasibility=awaiting-approval"]).status).toBe(0);
    const record = seededRecordDir(project), decisions = join(record, "decisions"); mkdirSync(decisions, { recursive: true });
    const grantFields = { messageId: "Sentinel_fixture", userMessage: "工程承認の判断をAIに委任します", userMessageSha256: sha("工程承認の判断をAIに委任します"), mode: "stage-gates", scope: "feature", through: "construction", allowedStages: ["feasibility"], minConfidence: 0.9 };
    const grant = { schemaVersion: 1, ...bindGrant(grantFields) };
    const grantPath = join(decisions, "delegation.json"); writeFileSync(grantPath, JSON.stringify(grant));
    const artifactPath = join(decisions, "evidence.md"); writeFileSync(artifactPath, "reviewed evidence\n");
    const binding = { schemaVersion: 1, directiveSha256: "c".repeat(64), stage: "feasibility", stateSha256: sha(readFileSync(seededStateFile(project))), delegationSha256: sha(readFileSync(grantPath)), evidence: [{ path: relative(project, artifactPath), sha256: sha(readFileSync(artifactPath)) }] };
    const decision = { schemaVersion: 1, decisionId: sha(canonical(binding)), actor: "ai", outcome: "approve", stage: binding.stage, reason: "All declared evidence is verified and the bounded PoC has no external effects.", confidence: 0.98, directiveSha256: binding.directiveSha256, stateSha256: binding.stateSha256, delegation: { path: relative(project, grantPath), sha256: binding.delegationSha256, messageId: grant.messageId }, evidence: binding.evidence, riskFlags: [], uncertainties: [], createdAt: "2026-10-17T00:00:00Z" };
    const decisionPath = join(decisions, "decision.json"); writeFileSync(decisionPath, JSON.stringify(decision));
    const approved = run(project, ["approve", "feasibility", "--ai-decision-file", relative(project, decisionPath)]);
    expect(approved.status).toBe(0);
    const audit = readFileSync(seededAuditShard(project), "utf8");
    expect(audit).toContain("**Decision Actor**: AI");
    expect(audit).toContain("**Decision Authority**: explicit user delegation");
    expect(audit).not.toContain("**User Input**:");
  });

  test("rejects a stale decision and leaves the gate open", () => {
    const project = createTestProject(); projects.push(project);
    seedStateFile(project, "state-mid-ideation.md");
    expect(run(project, ["checkbox", "feasibility=awaiting-approval"]).status).toBe(0);
    const record = seededRecordDir(project), decisions = join(record, "decisions"); mkdirSync(decisions, { recursive: true });
    const grantFields = { messageId: "Sentinel_fixture", userMessage: "AIに委任", userMessageSha256: sha("AIに委任"), mode: "stage-gates", scope: "feature", through: "construction", allowedStages: ["feasibility"], minConfidence: 0.9 };
    const grant = { schemaVersion: 1, ...bindGrant(grantFields) };
    const grantPath = join(decisions, "delegation.json"); writeFileSync(grantPath, JSON.stringify(grant));
    const artifactPath = join(decisions, "evidence.md"); writeFileSync(artifactPath, "evidence\n");
    const decisionPath = join(decisions, "decision.json"); writeFileSync(decisionPath, JSON.stringify({ schemaVersion: 1, decisionId: "d".repeat(64), actor: "ai", outcome: "approve", stage: "feasibility", reason: "stale", confidence: 1, directiveSha256: "c".repeat(64), stateSha256: "0".repeat(64), delegation: { path: relative(project, grantPath), sha256: sha(readFileSync(grantPath)), messageId: grant.messageId }, evidence: [{ path: relative(project, artifactPath), sha256: sha(readFileSync(artifactPath)) }], riskFlags: [], uncertainties: [], createdAt: "2026-10-17T00:00:00Z" }));
    const refused = run(project, ["approve", "feasibility", "--ai-decision-file", relative(project, decisionPath)]);
    expect(refused.status).not.toBe(0);
    expect(`${refused.stdout}${refused.stderr}`).toContain("stale");
    expect(readFileSync(seededStateFile(project), "utf8")).toContain("- [?] feasibility");
  });
});
