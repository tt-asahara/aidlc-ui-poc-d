import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ENGINE = join(import.meta.dir, "..", "..", "..", "core", "tools", "aidlc.ts");

/**
 * Records `prompt` as the person's own turn through core's real
 * record-human-turn hook (the only writer of HUMAN_TURN), exactly as the host
 * does on UserPromptSubmit. Test fixtures use it instead of hand-written rows.
 */
export function recordHumanTurn(root: string, prompt: string, session = "01995000-dead-7000-8000-00000000d1d1"): void {
  const hook = spawnSync(process.execPath, [ENGINE, "engine", "hook", "record-human-turn", "--project-dir", root], { cwd: root, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root }, input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: session, prompt }) });
  if (hook.status !== 0) throw new Error(hook.stderr || hook.stdout || "record-human-turn failed");
}
