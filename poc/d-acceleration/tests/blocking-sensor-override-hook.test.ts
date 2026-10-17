import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  BLOCKING_SENSOR_OVERRIDE_CHOICE,
  BLOCKING_SENSOR_OVERRIDE_DECISION,
  BLOCKING_SENSOR_OVERRIDE_OPTIONS,
} from "../../../core/tools/aidlc-lib.ts";
import { overrideGuidance, overrideTrigger } from "../blocking-sensor-override-hook.ts";

const HOOK = join(import.meta.dir, "..", "blocking-sensor-override-hook.ts");
const REPORT = "bun .claude/tools/aidlc-orchestrate.ts report --stage code-generation --result awaiting-approval";
// The official wording, as the engine printed it in a dogfood run.
const FAILURE = 'Blocking gate sensor evaluation did not pass for "code-generation". Sensors: ui-poc-evidence. Fix the findings and retry, or first run ' +
  'bun .claude/tools/aidlc-log.ts decision --stage code-generation --decision "Blocking gate sensor failure" --options "Fix findings,Override blocking sensors", present those choices, ' +
  'and after the human selects "Override blocking sensors" record it with bun .claude/tools/aidlc-log.ts answer. Then retry: bun .claude/tools/aidlc-orchestrate.ts ' +
  'report --stage code-generation --result awaiting-approval --override-blocking-sensors --user-input "Override blocking sensors". Autonomous mode cannot override.';
const REFUSED = 'Refusing blocking sensor override for "code-generation": no fresh authorization receipt proves that "Override blocking sensors" was offered and selected ' +
  "after a HUMAN_TURN. Record the decision and exact answer through aidlc-log.ts, then retry.";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function hook(command: string, toolResponse: unknown, toolName = "Bash"): string {
  const root = mkdtempSync(join(tmpdir(), "d-sensor-override-")); roots.push(root);
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
  delete env.AIDLC_PROJECT_DIR;
  const result = spawnSync("bun", [HOOK], { cwd: root, env, encoding: "utf8", input: JSON.stringify({ cwd: root, tool_name: toolName, tool_input: { command }, tool_response: toolResponse }) });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe("D blocking sensor override guidance", () => {
  test("names the stage from a sensor failure, including JSON-escaped directives", () => {
    expect(overrideTrigger({ stderr: FAILURE })).toEqual({ stage: "code-generation", kind: "sensor-failure", result: "awaiting-approval" });
    expect(overrideTrigger({ stdout: JSON.stringify({ error: FAILURE }) })).toEqual({ stage: "code-generation", kind: "sensor-failure", result: "awaiting-approval" });
    expect(overrideTrigger({ stderr: REFUSED }, `${REPORT.replace("awaiting-approval", "revised")} --override-blocking-sensors`))
      .toEqual({ stage: "code-generation", kind: "override-refused", result: "revised" });
    expect(overrideTrigger({ stdout: "Stage approved." })).toBeNull();
  });

  test("gives the official decision, options, and answer in the order the engine accepts", () => {
    const text = overrideGuidance({ stage: "code-generation", kind: "sensor-failure", result: "awaiting-approval" }, ".claude/tools");
    const decision = text.indexOf(
      `bun .claude/tools/aidlc-log.ts decision --stage code-generation --decision "${BLOCKING_SENSOR_OVERRIDE_DECISION}" --options "${BLOCKING_SENSOR_OVERRIDE_OPTIONS.join(",")}"`,
    );
    const answer = text.indexOf(`bun .claude/tools/aidlc-log.ts answer --stage code-generation --details "${BLOCKING_SENSOR_OVERRIDE_CHOICE}"`);
    const report = text.indexOf(
      `bun .claude/tools/aidlc-orchestrate.ts report --stage code-generation --result awaiting-approval --override-blocking-sensors --user-input "${BLOCKING_SENSOR_OVERRIDE_CHOICE}"`,
    );
    expect(decision).toBeGreaterThan(0);
    expect(text.indexOf("wait for the person's own reply")).toBeGreaterThan(decision);
    expect(answer).toBeGreaterThan(text.indexOf("wait for the person's own reply"));
    expect(report).toBeGreaterThan(answer);
  });

  test("a refusal explains why recording now cannot count and restarts at the decision", () => {
    const text = overrideGuidance({ stage: "code-generation", kind: "override-refused", result: "awaiting-approval" }, ".claude/tools");
    expect(text).toContain("cannot count for a reply already given");
    expect(text).toContain("1) Before asking, run exactly:");
  });

  test("the hook adds one PostToolUse context line only for engine commands that surfaced the failure", () => {
    const out = JSON.parse(hook(REPORT, { stderr: FAILURE, exit_code: 1 }));
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(out.hookSpecificOutput.additionalContext).toContain('decision --stage code-generation --decision "Blocking gate sensor failure"');
    expect(hook("bun .claude/tools/aidlc.ts engine orchestrate next", { stdout: JSON.stringify({ message: REFUSED }) })).toContain("cannot count");
    expect(hook("cat notes.md", { stdout: FAILURE })).toBe("");
    expect(hook(REPORT, { stderr: FAILURE }, "Read")).toBe("");
    expect(hook(REPORT, { stdout: "Stage approved." })).toBe("");
  });
});
