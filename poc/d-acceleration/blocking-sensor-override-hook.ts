#!/usr/bin/env bun
// Points the conductor at the official blocking-sensor override path, in order.
// The official engine accepts "Override blocking sensors" only when its exact
// decision row ("Blocking gate sensor failure", options "Fix findings,Override
// blocking sensors") is recorded BEFORE the person's reply and the answer after
// it. A conductor that asks first and records decision and answer afterwards,
// or rewords the decision, is refused with "no fresh authorization receipt",
// and that refusal reads as if recording now would help. Arm D adds, from
// PostToolUse on the conductor's own engine commands and without changing the
// official engine, one context line with the exact ordered commands for the
// stage named by a blocking-sensor failure or that refusal. It records nothing
// and decides nothing: the person still chooses, and the engine still checks.
import { dirname, relative, resolve, isAbsolute } from "node:path";
import { isCompiledExecutable } from "../../core/tools/aidlc-runtime-paths.ts";
import {
  BLOCKING_SENSOR_OVERRIDE_CHOICE as CHOICE,
  BLOCKING_SENSOR_OVERRIDE_DECISION as DECISION,
  BLOCKING_SENSOR_OVERRIDE_OPTIONS,
} from "../../core/tools/aidlc-lib.ts";

type HookInput = { cwd?: string; tool_name?: string; tool_input?: { command?: string }; tool_response?: unknown };
export type OverrideTrigger = { stage: string; kind: "sensor-failure" | "override-refused"; result: "awaiting-approval" | "revised" };

const OPTIONS = BLOCKING_SENSOR_OVERRIDE_OPTIONS.join(",");
const FAILURE = /Blocking gate sensor evaluation did not pass for "([^"]+)"/;
const REFUSED = /Refusing blocking sensor override for "([^"]+)": no fresh authorization receipt/;

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const entry of value) strings(entry, out);
  else if (value && typeof value === "object") for (const entry of Object.values(value)) strings(entry, out);
  return out;
}

// Directives travel as JSON inside stdout, so quotes may arrive escaped.
export function overrideTrigger(response: unknown, command = ""): OverrideTrigger | null {
  const text = strings(response).join("\n").replaceAll('\\"', '"');
  const refused = text.match(REFUSED);
  const failed = refused ? null : text.match(FAILURE);
  const stage = refused?.[1] ?? failed?.[1];
  if (!stage) return null;
  const result = /--result(?:=|\s+)["']?revised\b/.test(command) || /--result revised --override-blocking-sensors/.test(text)
    ? "revised"
    : "awaiting-approval";
  return { stage, kind: refused ? "override-refused" : "sensor-failure", result };
}

const quote = (value: string) => /^[A-Za-z0-9._/-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, "\\$1")}"`;

export function overrideGuidance(trigger: OverrideTrigger, toolsDir: string, native = false): string {
  const log = native ? "aidlc engine log" : `bun ${toolsDir}/aidlc-log.ts`;
  const orchestrate = native ? "aidlc engine orchestrate" : `bun ${toolsDir}/aidlc-orchestrate.ts`;
  const stage = quote(trigger.stage);
  const lead = trigger.kind === "override-refused"
    ? `The override for ${stage} was refused because no "${DECISION}" decision with these exact options was recorded before the person's reply. ` +
      "A decision or answer recorded now cannot count for a reply already given, so offer the choice again through the steps below."
    : `If the person may want to override the blocking sensor findings for ${stage}, use only this path; the engine refuses any other order or wording.`;
  return [
    `[D] ${lead}`,
    `1) Before asking, run exactly: ${log} decision --stage ${stage} --decision "${DECISION}" --options "${OPTIONS}"`,
    `2) Show the findings and exactly the choices ${BLOCKING_SENSOR_OVERRIDE_OPTIONS.map((option) => `"${option}"`).join(" and ")}, then wait for the person's own reply (end the turn, or ask with these two labels).`,
    `3) Only if the person chose "${CHOICE}": run ${log} answer --stage ${stage} --details "${CHOICE}", then ` +
      `${orchestrate} report --stage ${stage} --result ${trigger.result} --override-blocking-sensors --user-input "${CHOICE}".`,
    "If they chose to fix the findings, fix them and report again without the override.",
  ].join("\n");
}

function projectRoot(input: HookInput): string | undefined {
  const explicit = process.env.AIDLC_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR;
  return explicit ? (isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit)) : input.cwd;
}

export function run(text: string): number {
  let input: HookInput = {};
  try { input = JSON.parse(text); } catch { return 0; }
  const command = input.tool_input?.command ?? "";
  if (input.tool_name !== "Bash" || !/aidlc-(?:orchestrate|state)|\baidlc(?:\.ts)?\s+engine\b/.test(command)) return 0;
  const trigger = overrideTrigger(input.tool_response, command);
  const root = projectRoot(input);
  if (!trigger || !root) return 0;
  // This file is installed in <harness>/tools/d-acceleration/; the engine tools sit one level up.
  const toolsDir = relative(root, dirname(import.meta.dir)).split("\\").join("/") || ".";
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: overrideGuidance(trigger, toolsDir, isCompiledExecutable()) },
  }) + "\n");
  return 0;
}
if (import.meta.main) process.exitCode = run(await Bun.stdin.text());
