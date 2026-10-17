import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { AI_GATE_APPROVAL_DROPPED, createAiApprovalGrant } from "../ai-approval-controller.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
};
const requestHash = (value: unknown) => hash(JSON.stringify(canonical(value)));
const executable = (path: string, source: string) => {
  writeFileSync(path, `#!/usr/bin/env bun\n${source}`);
  chmodSync(path, 0o755);
};

function fixture(options: { mode?: "human" | "stage-gates"; stage?: string; directive?: Record<string, unknown>; minConfidence?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), "d-ai-approval-"));
  const intent = join(root, "aidlc/spaces/default/intents/intent-one");
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(intent, { recursive: true });
  writeFileSync(join(root, "aidlc/spaces/default/intents/active-intent"), "intent-one\n");
  writeFileSync(join(intent, "aidlc-state.md"), "- **State Version**: 7\n- **Scope**: feature\n- **Current Stage**: domain-design\n");
  writeFileSync(join(root, ".claude/d-acceleration.jsonc"), JSON.stringify({
    models: { judgment: "fixture-judgment" },
    aiApproval: { mode: options.mode ?? "stage-gates", minConfidence: options.minConfidence ?? 0.9, decisionRecordPath: "decisions/ai-approval-decisions.jsonl" },
  }));
  const directive = {
    kind: "present-gate",
    stage: options.stage ?? "domain-design",
    phase: "inception",
    memory_path: "aidlc/spaces/default/intents/intent-one/inception/domain-design/memory.md",
    ...options.directive,
  };
  writeFileSync(join(root, "directive.json"), JSON.stringify(directive));
  const grantedStage = options.stage ?? "domain-design";
  const message = `AI-DLC delegate-ai-approvals --scope feature --through ${grantedStage} --stages ${grantedStage}`;
  const request = { messageId: "user-message-17", userMessage: message, userMessageSha256: hash(message), mode: "stage-gates", scope: "feature", through: grantedStage, allowedStages: [grantedStage], minConfidence: 0.92 };
  writeFileSync(join(intent, "delegation.json"), JSON.stringify({ schemaVersion: 1, ...request, requestSha256: requestHash(request) }));
  writeFileSync(join(intent, "evidence.md"), "# Domain design review\nAll required checks passed with no open findings.\n");
  return { root, intent, relativeIntent: "aidlc/spaces/default/intents/intent-one" };
}

function options(root: string, executablePath: string) {
  return {
    projectDir: root,
    directiveFile: "directive.json",
    delegationFile: "aidlc/spaces/default/intents/intent-one/delegation.json",
    evidenceFiles: ["aidlc/spaces/default/intents/intent-one/evidence.md"],
    claudeExecutable: executablePath,
  };
}

describe("AI delegation grant (stage-gate approval dropped)", () => {
  test("evaluate, verify, and any non-grant command fail closed without a model call or approval argv", () => {
    const { root } = fixture();
    const controller = join(import.meta.dir, "..", "ai-approval-controller.ts");
    for (const command of ["evaluate", "verify", "approve"]) {
      const run = Bun.spawnSync([process.execPath, controller, command, "--project-dir", root, "--directive-file", "directive.json"], { cwd: root, stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).toBe(2);
      const output = JSON.parse(run.stdout.toString());
      expect(output.status).toBe("block");
      expect(output.reason).toBe(AI_GATE_APPROVAL_DROPPED);
      expect(output.generatedCommandArgs).toBeUndefined();
    }
    expect(existsSync(join(root, "aidlc/spaces/default/intents/intent-one/decisions/ai-approval-decisions.jsonl"))).toBeFalse();
  });

  test("creates a canonical explicit grant through the CLI inside the active intent", () => {
    const { root } = fixture();
    const userMessage = "AI-DLC delegate-ai-approvals --scope feature --through domain-design --stages domain-design\n";
    writeFileSync(join(root, "user-message.txt"), userMessage);
    const controller = join(import.meta.dir, "..", "ai-approval-controller.ts");
    const run = Bun.spawnSync([
      process.execPath, controller, "grant", "--project-dir", root,
      "--user-message-file", "user-message.txt", "--message-id", "message-99",
      "--scope", "feature", "--through", "domain-design", "--allowed-stages", "domain-design",
    ], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(run.exitCode).toBe(0);
    const output = JSON.parse(run.stdout.toString());
    expect(output.path).toBe("aidlc/spaces/default/intents/intent-one/decisions/ai-approval-delegation.json");
    const body = readFileSync(join(root, output.path));
    expect(output.sha256).toBe(hash(body.toString()));
    const grant = JSON.parse(body.toString());
    expect(grant).toMatchObject({ schemaVersion: 1, mode: "stage-gates", messageId: "message-99", userMessage: userMessage.trim(), scope: "feature", through: "domain-design", allowedStages: ["domain-design"], minConfidence: 0.9 });
    expect(grant.userMessageSha256).toBe(hash(userMessage.trim()));
    expect(grant.requestSha256).toBe(output.requestSha256);
  });

  test("grant creation refuses human mode, operation stages, and empty user text", () => {
    const human = fixture({ mode: "human" });
    writeFileSync(join(human.root, "message.txt"), "Delegate safely\n");
    expect(() => createAiApprovalGrant({ projectDir: human.root, userMessageFile: "message.txt", messageId: "m1", scope: "feature", allowedStages: ["domain-design"] })).toThrow("mode=stage-gates");

    const operation = fixture();
    writeFileSync(join(operation.root, "message.txt"), "AI-DLC delegate-ai-approvals --scope feature --through environment-provisioning --stages environment-provisioning\n");
    expect(() => createAiApprovalGrant({ projectDir: operation.root, userMessageFile: "message.txt", messageId: "m2", scope: "feature", through: "environment-provisioning", allowedStages: ["environment-provisioning"] })).toThrow("human-only stage");

    const unrelated = fixture();
    writeFileSync(join(unrelated.root, "message.txt"), "Show me the current status.\n");
    expect(() => createAiApprovalGrant({ projectDir: unrelated.root, userMessageFile: "message.txt", messageId: "m-unrelated", scope: "feature", through: "domain-design", allowedStages: ["domain-design"] })).toThrow("exact structured");

    const overBoundary = fixture();
    writeFileSync(join(overBoundary.root, "message.txt"), "AI-DLC delegate-ai-approvals --scope feature --through requirements-analysis --stages delivery-planning\n");
    expect(() => createAiApprovalGrant({ projectDir: overBoundary.root, userMessageFile: "message.txt", messageId: "m-boundary", scope: "feature", through: "requirements-analysis", allowedStages: ["delivery-planning"] })).toThrow("exceeds AI approval through boundary");

    const empty = fixture();
    writeFileSync(join(empty.root, "message.txt"), "\n");
    expect(() => createAiApprovalGrant({ projectDir: empty.root, userMessageFile: "message.txt", messageId: "m3", scope: "feature", allowedStages: ["domain-design"] })).toThrow("non-empty string");
  });
});
