#!/usr/bin/env bun
import { resolveDGitPersistence } from "./d-config.ts";
import { discoverCrossing, persistCrossing } from "./d-persistence.ts";

type HookInput = { cwd?: string; tool_input?: { command?: string }; tool_name?: string; agent_id?: string; agent_type?: string };
let input: HookInput = {};
try { input = JSON.parse(await Bun.stdin.text()); } catch { process.exit(0); }
const projectDir = input.cwd ?? process.env.CLAUDE_PROJECT_DIR;
const command = input.tool_input?.command ?? "";
// PostToolUse ordering is authoritative: report already completed (including auto-advance).
if (!projectDir || input.agent_id || input.agent_type || !/(?:aidlc-orchestrate(?:\.ts)?|aidlc(?:\.ts)?[^\n]*\bengine\s+orchestrate)[^\n]*\breport\b/.test(command)) process.exit(0);
try {
  const config = resolveDGitPersistence(projectDir);
  const crossing = discoverCrossing(projectDir);
  const result = crossing ? persistCrossing(projectDir, config, crossing) : { status: "deferred", reason: "no completed/skipped/workflow crossing in report audit tail" };
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  // Workflow settlement is authoritative and is never rolled back by persistence.
  process.stderr.write(`D Git persistence deferred: ${error instanceof Error ? error.message : String(error)}\n`);
}
