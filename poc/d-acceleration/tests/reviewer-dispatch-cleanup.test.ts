import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { reviewerDispatchPath } from "../../../core/tools/aidlc-lib.ts";
import { parseReviewCommand } from "../reviewer-dispatch-cleanup-hook.ts";

const HOOK = join(import.meta.dir, "..", "reviewer-dispatch-cleanup-hook.ts");
const LOG = "bun .claude/tools/aidlc.ts engine log review";
const VERDICT_STDOUT = JSON.stringify({ status: "recorded", reviewRecord: ".aidlc-engine/reviews/code-generation/units/u1/a/1.json" });

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function project(record: Record<string, unknown> | null): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "d-reviewer-dispatch-")); roots.push(root);
  mkdirSync(join(root, "aidlc", "spaces", "default", "intents"), { recursive: true });
  const path = reviewerDispatchPath(root);
  mkdirSync(dirname(path), { recursive: true });
  if (record) writeFileSync(path, JSON.stringify({ reviewer: "aidlc-architecture-reviewer-agent", exempt: [], ...record }));
  return { root, path };
}
function hook(root: string, command: string, toolResponse: unknown = { stdout: "{}" }, toolName = "Bash") {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
  delete env.AIDLC_PROJECT_DIR;
  const result = spawnSync("bun", [HOOK], { cwd: root, env, encoding: "utf8", input: JSON.stringify({ cwd: root, tool_name: toolName, tool_input: { command }, tool_response: toolResponse }) });
  expect(result.status, result.stderr).toBe(0);
}

describe("D reviewer dispatch cleanup", () => {
  test("parses one review invocation and refuses to guess between several", () => {
    expect(parseReviewCommand(`${LOG} --stage "code-generation" --unit "u1-walking-skeleton" --verdict READY`)).toEqual({ stage: "code-generation", unit: "u1-walking-skeleton", verdict: true });
    expect(parseReviewCommand(`bun .claude/tools/aidlc-log.ts review --stage=functional-design --reviewer x --iteration 1`)).toEqual({ stage: "functional-design", unit: null, verdict: false });
    expect(parseReviewCommand(`${LOG} --stage a --unit u1 --verdict READY && ${LOG} --stage a --unit u2 --verdict READY`)).toBeNull();
    expect(parseReviewCommand("bun .claude/tools/aidlc.ts engine orchestrate next")).toBeNull();
  });

  test("a recorded verdict removes the record for that same stage and Unit", () => {
    const { root, path } = project({ stage: "code-generation", unit: "u1" });
    hook(root, `${LOG} --stage "code-generation" --unit "u1" --verdict READY`, { stdout: VERDICT_STDOUT });
    expect(existsSync(path)).toBe(false);
  });

  test("a refused verdict, another Unit's verdict, or a failed call keeps the record", () => {
    const { root, path } = project({ stage: "code-generation", unit: "u1" });
    hook(root, `${LOG} --stage "code-generation" --unit "u1" --verdict READY`, { stdout: "Review refused: verdict line missing" });
    hook(root, `${LOG} --stage "code-generation" --unit "u2" --verdict READY`, { stdout: VERDICT_STDOUT });
    hook(root, `${LOG} --stage "code-generation" --unit "u1" --verdict READY`, { stdout: VERDICT_STDOUT, exit_code: 1 });
    hook(root, `${LOG} --stage "code-generation" --unit "u1" --verdict READY`, { stdout: VERDICT_STDOUT }, "Read");
    expect(existsSync(path)).toBe(true);
  });

  test("a new request for another Unit clears the leftover record of the finished one", () => {
    const { root, path } = project({ stage: "functional-design", unit: "u1" });
    hook(root, `${LOG} --stage "functional-design" --reviewer "aidlc-architecture-reviewer-agent" --iteration 1 --unit "u2"`);
    expect(existsSync(path)).toBe(false);
  });

  test("a re-request for the same review leaves the record for the conductor's fresh write", () => {
    const { root, path } = project({ stage: "functional-design", unit: "u1" });
    hook(root, `${LOG} --stage "functional-design" --reviewer "aidlc-architecture-reviewer-agent" --iteration 2 --unit "u1"`);
    expect(existsSync(path)).toBe(true);
  });

  test("a missing or unreadable record is a no-op", () => {
    const missing = project(null);
    hook(missing.root, `${LOG} --stage "code-generation" --unit "u1" --verdict READY`, { stdout: VERDICT_STDOUT });
    expect(existsSync(missing.path)).toBe(false);
    const broken = project(null);
    writeFileSync(broken.path, "{not json");
    hook(broken.root, `${LOG} --stage "code-generation" --unit "u2" --iteration 1`);
    expect(existsSync(broken.path)).toBe(true);
  });
});
