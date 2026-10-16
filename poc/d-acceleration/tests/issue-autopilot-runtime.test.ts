import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileAssumptionLedger,
  createFileClaimStore,
  createGhIssueSource,
  issueAutopilotRuntimePaths,
  type CommandRunner,
} from "../issue-autopilot-runtime.ts";

const temporary: string[] = [];
const temp = () => { const path = mkdtempSync(join(tmpdir(), "aidlc-issue-runtime-")); temporary.push(path); return path; };
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("issue autopilot production adapters", () => {
  test("gh source uses fixed argv without a shell and parses untrusted body as data", async () => {
    const calls: Array<{ executable: string; argv: readonly string[]; cwd: string }> = [];
    const runner: CommandRunner = async (executable, argv, options) => {
      calls.push({ executable, argv, cwd: options.cwd });
      return { status: 0, stderr: "", stdout: JSON.stringify({ number: 7, title: "$(touch nope)", body: "; rm -rf /", labels: [{ name: "aidlc-auto" }], state: "OPEN" }) };
    };
    const source = createGhIssueSource({ cwd: "/project", repository: "owner/repo", runner });
    expect(await source.get(7)).toMatchObject({ number: 7, body: "; rm -rf /", state: "open" });
    expect(calls).toEqual([{ executable: "gh", cwd: "/project", argv: ["issue", "view", "7", "--repo", "owner/repo", "--json", "number,title,body,labels,state"] }]);
  });

  test("claim creation is atomic, owner-only, and stale leases are bounded", async () => {
    const directory = join(temp(), "claims");
    let time = 1_000;
    const first = createFileClaimStore({ directory, leaseMs: 100, clock: () => time });
    const second = createFileClaimStore({ directory, leaseMs: 100, clock: () => time });
    expect((await Promise.all([first.acquire(9, "alpha"), second.acquire(9, "beta")])).sort()).toEqual(["acquired", "busy"]);
    expect((await Promise.all([first.acquire(9, "alpha"), second.acquire(9, "beta")])).every((value) => value === "busy")).toBeTrue();
    expect(await first.renew!(9, "alpha")).toBe("renewed");
    expect(await second.renew!(9, "beta")).toBe("lost");
    await second.release(9, "beta");
    expect(await second.acquire(9, "beta")).toBe("busy");
    time = 1_101;
    expect(await second.acquire(9, "beta")).toBe("acquired");
    await first.release(9, "alpha");
    expect(await first.acquire(9, "gamma")).toBe("busy");
    await second.release(9, "beta");
    expect(await first.acquire(9, "gamma")).toBe("acquired");
  });

  test("assumption ledger appends durable JSONL atomically in session storage", async () => {
    const root = temp();
    const paths = issueAutopilotRuntimePaths(root, join(root, "session"));
    let time = 20;
    const ledger = createFileAssumptionLedger(paths.assumptions, { clock: () => time++ });
    await ledger.append({ issueNumber: 1, policy: "assume", assumptions: ["JPY"], researchedFacts: [] });
    await ledger.append({ issueNumber: 2, policy: "research", assumptions: [], researchedFacts: ["API v2"] });
    const records = readFileSync(paths.assumptions, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records).toEqual([
      { recordedAt: 20, issueNumber: 1, policy: "assume", assumptions: ["JPY"], researchedFacts: [] },
      { recordedAt: 21, issueNumber: 2, policy: "research", assumptions: [], researchedFacts: ["API v2"] },
    ]);
  });

  test("defaults runtime state beneath git metadata", () => {
    const root = temp();
    const paths = issueAutopilotRuntimePaths(root);
    expect(paths.claims).toBe(join(root, ".aidlc", "issue-autopilot", "claims"));
  });
});
