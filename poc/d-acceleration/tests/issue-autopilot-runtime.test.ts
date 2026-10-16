import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileAssumptionLedger,
  createFileClaimStore,
  createFileIntakeBindingStore,
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

  test("a corrupt claim stays protected for one lease then is reclaimed", async () => {
    const directory = join(temp(), "claims");
    let time = Date.now();
    const store = createFileClaimStore({ directory, leaseMs: 100, clock: () => time });
    writeFileSync(join(directory, "issue-9.json"), "{truncated", { mode: 0o600 });
    time = statSync(join(directory, "issue-9.json")).mtimeMs;
    expect(await store.acquire(9, "alpha")).toBe("busy");
    time += 101;
    expect(await store.acquire(9, "alpha")).toBe("acquired");
    expect(JSON.parse(readFileSync(join(directory, "issue-9.json"), "utf8"))).toMatchObject({ issueNumber: 9, owner: "alpha" });

    await store.release(9, "alpha");
    writeFileSync(join(directory, "issue-9.json"), JSON.stringify({ issueNumber: "9", owner: "alpha" }), { mode: 0o600 });
    time = statSync(join(directory, "issue-9.json")).mtimeMs + 101;
    expect(await store.acquire(9, "beta")).toBe("acquired");
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

  test("intake binding reservation is atomic and exact", async () => {
    const directory = join(temp(), "bindings"); let time = 10;
    const store = createFileIntakeBindingStore(directory, { clock: () => time++ });
    const binding = { provider: "github", repository: "owner/repo", issueNumber: 9, intakeKey: "key-9" };
    expect(await store.reserve(binding, "alpha")).toBe("reserved");
    await store.recordAttempt!(binding, "alpha", { attempts: 3, outcome: "transient-exhausted", detail: "temporary" });
    expect(JSON.parse(readFileSync(join(directory, "key-9.json"), "utf8"))).toMatchObject({ createdAt: 10, updatedAt: 11, attempts: 3, outcome: "transient-exhausted", detail: "temporary" });
    expect(await store.reserve(binding, "beta")).toBe("pending");
    await store.finalize(binding, "beta");
    expect(await store.reserve(binding, "beta")).toBe("bound");
    await expect(store.reserve({ ...binding, repository: "other/repo" }, "beta")).rejects.toThrow("collision");
  });

  test("ambiguous pending bindings never auto-recover", async () => {
    const directory = join(temp(), "bindings"); let time = 10;
    const store = createFileIntakeBindingStore(directory, { clock: () => time, recoveryLeaseMs: 5 });
    const binding = { provider: "github", repository: "github.com/owner/repo", issueNumber: 8, intakeKey: "key-8" };
    expect(await store.reserve(binding, "alpha")).toBe("reserved");
    await store.recordAttempt!(binding, "alpha", { attempts: 1, outcome: "ambiguous", detail: "response lost" });
    time = 10_000;
    expect(await store.reserve(binding, "beta")).toBe("pending");
  });

  test("defaults runtime state beneath git metadata", () => {
    const root = temp();
    const paths = issueAutopilotRuntimePaths(root);
    expect(paths.claims).toBe(join(root, ".aidlc", "issue-autopilot", "claims"));
  });
});
