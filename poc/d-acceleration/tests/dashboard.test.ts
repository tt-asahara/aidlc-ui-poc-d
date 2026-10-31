// The space dashboard over official records: stage progress from the state
// file, timings, Bolts, units, and the Issue link from audit events, and a
// page whose embedded record text can never break out of its payload.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { intentRow, parseProgress, renderHtml, renderText, type Dashboard } from "../dashboard.ts";
import { run } from "../dashboard-refresh-hook.ts";

const STATE = `# AI-DLC State Tracking

## Project Information
- **Project**: Build the plan page AIDLC-INTAKE: {"provider":"github","repository":"github.com/acme/app","issueNumber":7}
- **Scope**: feature
- **Start Date**: 2026-10-01T00:00:00Z

## Execution Plan Summary
- **Total Stages**: 4
- **Completed**: 2
- **In Progress**: functional-design

## Phase Progress
- **Inception**: Verified
- **Construction**: Active

## Stage Progress
### INCEPTION PHASE
- [x] requirements-analysis — EXECUTE
- [x] user-stories — EXECUTE
- [ ] reverse-engineering — SKIP

### CONSTRUCTION PHASE
- [-] functional-design — EXECUTE
- [ ] code-generation — EXECUTE
`;

const block = (event: string, timestamp: string, fields: Record<string, string> = {}) =>
  ({ event, timestamp, block: [`## ${event}`, `**Timestamp**: ${timestamp}`, `**Event**: ${event}`, ...Object.entries(fields).map(([k, v]) => `**${k}**: ${v}`)].join("\n") });

const EVENTS = [
  block("STAGE_STARTED", "2026-10-01T01:00:00Z", { Stage: "requirements-analysis" }),
  block("STAGE_COMPLETED", "2026-10-01T01:30:00Z", { Stage: "requirements-analysis", "Tokens In": "100", "Tokens Out": "900", "Cost USD": "0.50" }),
  block("STAGE_STARTED", "2026-10-01T02:00:00Z", { Stage: "user-stories" }),
  block("STAGE_STARTED", "2026-10-01T02:10:00Z", { Stage: "user-stories" }),
  block("STAGE_COMPLETED", "2026-10-01T03:00:00Z", { Stage: "user-stories" }),
  block("UNIT_STARTED", "2026-10-01T04:00:00Z", { Unit: "plan-page" }),
  block("BOLT_STARTED", "2026-10-01T04:05:00Z", { "Bolt names": "plan-page", "Batch number": "1" }),
  block("BOLT_COMPLETED", "2026-10-01T05:00:00Z", { "Bolt names": "plan-page", "Batch number": "1" }),
  block("BOLT_STARTED", "2026-10-01T05:10:00Z", { "Bolt names": "billing" }),
  block("BOLT_FAILED", "2026-10-01T05:20:00Z", { "Bolt names": "billing" }),
  block("SENSOR_FAILED", "2026-10-01T05:30:00Z", { Stage: "functional-design" }),
];

describe("dashboard data", () => {
  test("stage and phase progress come from the state file, skipped stages left out of the total", () => {
    const { phases, stages } = parseProgress(STATE);
    expect(phases).toEqual([{ name: "Inception", status: "Verified" }, { name: "Construction", status: "Active" }]);
    expect(stages.map((s) => [s.slug, s.mark, s.plan])).toContainEqual(["functional-design", "-", "EXECUTE"]);
    const row = intentRow({ dirName: "plan-1", slug: "plan", status: "active", active: true }, STATE, EVENTS);
    expect([row.completed, row.total, row.current]).toEqual([2, 4, "functional-design"]);
    expect(row.project).toBe("Build the plan page");
  });

  test("timings, reruns, Bolts, units, sensor failures, Issue and usage come from audit events", () => {
    const row = intentRow({ dirName: "plan-1", slug: "plan", status: "active", active: true }, STATE, [...EVENTS].reverse());
    expect(row.timings.find((t) => t.stage === "requirements-analysis")).toMatchObject({ ms: 30 * 60_000, starts: 1 });
    expect(row.timings.find((t) => t.stage === "user-stories")).toMatchObject({ startedAt: "2026-10-01T02:00:00Z", starts: 2 });
    expect(row.bolts.map((b) => [b.name, b.state])).toEqual([["plan-page", "completed"], ["billing", "failed"]]);
    expect(row.units).toEqual([{ name: "plan-page", state: "running" }]);
    expect(row.sensorFailures).toBe(1);
    expect(row.issue).toEqual({ repository: "github.com/acme/app", number: 7 });
    expect(row.usage).toEqual({ tokensIn: 100, tokensOut: 900, costUsd: 0.5 });
    expect(row.events[0]!.event).toBe("SENSOR_FAILED");
  });

  test("between stages the state's \"none\" shows no current stage", () => {
    const row = intentRow({ dirName: "x", slug: "x", status: "active", active: true }, STATE.replace("- **In Progress**: functional-design", "- **In Progress**: none"), []);
    expect(row.current).toBeNull();
  });

  test("a record with no audit and no usage still renders", () => {
    const row = intentRow({ dirName: "x", slug: "x", status: "active", active: false }, "", []);
    expect(row).toMatchObject({ completed: 0, total: 0, usage: null, issue: null, bolts: [] });
  });
});

describe("dashboard page", () => {
  test("record text cannot close the payload script, and the page needs no external asset", () => {
    const row = intentRow({ dirName: "x", slug: "</script><script>alert(1)</script>", status: "active", active: true }, STATE, EVENTS);
    const html = renderHtml({ space: "default", generatedAt: "2026-10-31T00:00:00Z", intents: [row] } satisfies Dashboard);
    expect(html.match(/<\/script>/g)!.length).toBe(2);
    expect(html).not.toMatch(/(?:src|href)="https?:/);
    expect(html).toContain('<html lang="ja">');
  });

  test("the text summary says how to start when there is no intent", () => {
    expect(renderText({ space: "default", generatedAt: "", intents: [] })).toContain("まだ intent がありません");
  });

  test("the refresh hook never fails a session or a turn", () => {
    const dir = mkdtempSync(join(tmpdir(), "dashboard-hook-"));
    const saved = { a: process.env.AIDLC_PROJECT_DIR, c: process.env.CLAUDE_PROJECT_DIR };
    try {
      process.env.AIDLC_PROJECT_DIR = dir;
      expect(run("{}")).toBe(0);
      expect(run("not json")).toBe(0);
    } finally {
      if (saved.a === undefined) delete process.env.AIDLC_PROJECT_DIR; else process.env.AIDLC_PROJECT_DIR = saved.a;
      if (saved.c !== undefined) process.env.CLAUDE_PROJECT_DIR = saved.c;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
