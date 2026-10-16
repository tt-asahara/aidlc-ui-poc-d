import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { discoverCrossing, persistCrossing, type Crossing } from "../d-persistence.ts";
import { resolveDGitPersistence } from "../d-config.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function run(cwd: string, args: string[]) { const r = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr || r.stdout); return r.stdout.trim(); }
function repo() {
  const root = mkdtempSync(join(tmpdir(), "d-persist-")); roots.push(root); run(root, ["git", "init", "-b", "main"]); run(root, ["git", "config", "user.name", "Test"]); run(root, ["git", "config", "user.email", "test@example.com"]);
  writeFileSync(join(root, "README.md"), "base\n"); run(root, ["git", "add", "README.md"]); run(root, ["git", "commit", "-m", "base"]); return root;
}
function crossing(manifest = ["aidlc/result.md"]): Crossing { return { receipt: "receipt-1", events: [{ event: "STAGE_COMPLETED", stage: "intent-capture" }], manifest }; }
const off = { enabled: false, push: false, remote: "origin" };
const commit = { enabled: true, push: false, remote: "origin", branch: "main" };

describe("D approval persistence", () => {
  test("defaults off and resolves local over project settings", () => {
    const root = repo(); expect(resolveDGitPersistence(root)).toEqual({ enabled: false, push: false, remote: "origin", branch: undefined });
    mkdirSync(join(root, ".claude"));
    writeFileSync(join(root, ".claude/d-acceleration.json"), JSON.stringify({ gitPersistence: { enabled: true, push: true, remote: "upstream", branch: "main" } }));
    writeFileSync(join(root, ".claude/d-acceleration.local.json"), JSON.stringify({ gitPersistence: { push: false, remote: "origin" } }));
    expect(resolveDGitPersistence(root)).toEqual({ enabled: true, push: false, remote: "origin", branch: "main" });
  });

  test("is opt-in and idempotent", () => {
    const root = repo(); mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "approved\n");
    expect(persistCrossing(root, off, crossing()).status).toBe("disabled");
    const first = persistCrossing(root, commit, crossing()); expect(first.status).toBe("committed");
    expect(run(root, ["git", "show", "--pretty=", "--name-only", "HEAD"])).toBe("aidlc/result.md");
    expect(persistCrossing(root, commit, crossing())).toMatchObject({ status: "already-processed", commitOid: first.commitOid });
  });

  test("recovers a stale coordinator lock", () => {
    const root = repo(); mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "approved\n");
    mkdirSync(join(root, ".git/aidlc-d-persistence"), { recursive: true });
    writeFileSync(join(root, ".git/aidlc-d-persistence/lock"), JSON.stringify({ pid: 2147483647, createdAt: "2000-01-01T00:00:00Z" }));
    expect(persistCrossing(root, commit, crossing()).status).toBe("committed");
  });

  test("PostToolUse from a subagent is a no-op", () => {
    const root = repo(); mkdirSync(join(root, ".claude")); writeFileSync(join(root, ".claude/d-acceleration.json"), JSON.stringify({ gitPersistence: { enabled: true, branch: "main" } }));
    mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "approved\n");
    const hook = join(import.meta.dir, "..", "d-persistence-hook.ts");
    const result = spawnSync("bun", [hook], { cwd: root, encoding: "utf8", input: JSON.stringify({ cwd: root, agent_id: "worker-1", tool_name: "Bash", tool_input: { command: "bun .claude/tools/aidlc.ts engine orchestrate report --stage x --result approved" } }) });
    expect(result.status).toBe(0); expect(run(root, ["git", "rev-parse", "HEAD"])).toBe(run(root, ["git", "rev-list", "--max-parents=0", "HEAD"]));
  });

  test("does not mix user staged or unrelated unstaged changes", () => {
    const root = repo(); mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "approved\n"); writeFileSync(join(root, "README.md"), "user\n");
    writeFileSync(join(root, "user.txt"), "staged\n"); run(root, ["git", "add", "user.txt"]);
    expect(persistCrossing(root, commit, crossing())).toMatchObject({ status: "deferred", reason: expect.stringContaining("staged") });
    expect(run(root, ["git", "diff", "--cached", "--name-only"])).toBe("user.txt");
    run(root, ["git", "reset", "HEAD", "--", "user.txt"]);
    expect(persistCrossing(root, commit, crossing()).status).toBe("committed");
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("user\n"); expect(existsSync(join(root, "user.txt"))).toBeTrue();
  });

  test("rejects protected paths and worktrees", () => {
    const root = repo(); writeFileSync(join(root, ".env"), "SECRET=x\n");
    expect(() => persistCrossing(root, commit, crossing([".env"]))).toThrow("protected path");
    const wt = `${root}-wt`; roots.push(wt); run(root, ["git", "worktree", "add", "-b", "worker", wt]); mkdirSync(join(wt, "aidlc")); writeFileSync(join(wt, "aidlc/result.md"), "x\n");
    expect(persistCrossing(wt, { ...commit, branch: "worker" }, crossing())).toMatchObject({ status: "deferred", reason: expect.stringContaining("main checkout") });
  });

  test("rejects high-confidence secret content", () => {
    const root = repo(); mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "-----BEGIN PRIVATE KEY-----\nsecret\n");
    expect(() => persistCrossing(root, commit, crossing())).toThrow("secret detected");
    expect(run(root, ["git", "diff", "--cached", "--name-only"])).toBe("");
  });

  test("recursively rejects protected files and symlinks inside artifact directories", () => {
    const root = repo(); const dir = join(root, "aidlc/bundle"); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, ".env.local"), "TOKEN=opaque\n");
    expect(() => persistCrossing(root, commit, crossing(["aidlc/bundle"]))).toThrow("protected path");
    rmSync(join(dir, ".env.local")); const outside = join(root, "outside.txt"); writeFileSync(outside, "outside\n"); symlinkSync(outside, join(dir, "link"));
    expect(() => persistCrossing(root, commit, crossing(["aidlc/bundle"]))).toThrow("symlink");
  });

  test("keeps ordinary hooks and restores its index ownership on hook failure", () => {
    const root = repo(); mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "approved\n");
    const hook = join(root, ".git", "hooks", "pre-commit"); writeFileSync(hook, "#!/bin/sh\nexit 1\n"); chmodSync(hook, 0o755);
    expect(() => persistCrossing(root, commit, crossing())).toThrow("git commit failed");
    expect(run(root, ["git", "diff", "--cached", "--name-only"])).toBe("");
    expect(readFileSync(join(root, "aidlc/result.md"), "utf8")).toBe("approved\n");
  });

  test("a hook-added external path cannot enter the checkpoint commit", () => {
    const root = repo(); mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "approved\n"); writeFileSync(join(root, "hook-owned.txt"), "hook\n");
    const hook = join(root, ".git", "hooks", "pre-commit"); writeFileSync(hook, "#!/bin/sh\ngit add hook-owned.txt\n"); chmodSync(hook, 0o755);
    expect(() => persistCrossing(root, commit, crossing())).toThrow("rolled back");
    expect(run(root, ["git", "show", "--pretty=", "--name-only", "HEAD"])).toBe("README.md");
    expect(run(root, ["git", "diff", "--cached", "--name-only"])).toBe("hook-owned.txt");
  });

  test("records a fixed pending refspec and resumes the same push", () => {
    const root = repo(); const remote = mkdtempSync(join(tmpdir(), "d-remote-")); roots.push(remote); run(remote, ["git", "init", "--bare"]); run(root, ["git", "remote", "add", "origin", remote]);
    mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "approved\n");
    const result = persistCrossing(root, { ...commit, push: true }, crossing()); expect(result.status).toBe("pushed");
    expect(run(remote, ["git", "rev-parse", "refs/heads/main"])).toBe(result.commitOid);
    const journal = JSON.parse(readFileSync(join(root, ".git/aidlc-d-persistence/pending-push.json"), "utf8"));
    expect(journal.refspec).toBe(`${result.commitOid}:refs/heads/main`); expect(journal.state).toBe("pushed");
  });

  test("recovers both commit-before-ledger and ledger-before-pending crash windows", () => {
    const root = repo(); const remote = mkdtempSync(join(tmpdir(), "d-remote-")); roots.push(remote); run(remote, ["git", "init", "--bare"]); run(root, ["git", "remote", "add", "origin", remote]);
    mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "approved\n");
    const made = persistCrossing(root, commit, crossing()); expect(made.status).toBe("committed");
    rmSync(join(root, ".git/aidlc-d-persistence/ledger.json"));
    const recovered = persistCrossing(root, { ...commit, push: true }, crossing());
    expect(recovered).toMatchObject({ status: "pushed", commitOid: made.commitOid });
    expect(run(remote, ["git", "rev-parse", "refs/heads/main"])).toBe(made.commitOid);
  });

  test("discovers only report crossing events and aidlc changes", () => {
    const root = repo(); const dir = join(root, "aidlc/spaces/default/intents/one"); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "audit-1.md"), "## Await\n**Timestamp**: 2026-01-01T00:00:00Z\n**Event**: STAGE_AWAITING_APPROVAL\n**Stage**: scope-definition\n**Artifacts**: aidlc/spaces/default/intents/one/scope.md\n\n---\n## Human\n**Timestamp**: 2026-01-01T00:00:00.5Z\n**Event**: HUMAN_TURN\n\n---\n## Done\n**Timestamp**: 2026-01-01T00:00:01Z\n**Event**: STAGE_COMPLETED\n**Stage**: scope-definition\n");
    writeFileSync(join(dir, "scope.md"), "ok\n"); writeFileSync(join(root, "outside.txt"), "no\n");
    const found = discoverCrossing(root)!; expect(found.events).toEqual([{ event: "STAGE_COMPLETED", stage: "scope-definition" }]);
    expect(found.manifest).toContain("aidlc/spaces/default/intents/one/scope.md"); expect(found.manifest).not.toContain("outside.txt");
  });

  test("discovery never absorbs unrelated changes from another intent", () => {
    const root = repo();
    const one = join(root, "aidlc/spaces/default/intents/one");
    const two = join(root, "aidlc/spaces/default/intents/two");
    mkdirSync(one, { recursive: true }); mkdirSync(two, { recursive: true });
    writeFileSync(join(one, "audit.md"), "## Await\n**Timestamp**: 2026-01-01T00:00:00Z\n**Event**: STAGE_AWAITING_APPROVAL\n**Stage**: scope-definition\n**Artifacts**: aidlc/spaces/default/intents/one/scope.md\n\n---\n## Human\n**Timestamp**: 2026-01-01T00:00:00.5Z\n**Event**: HUMAN_TURN\n\n---\n## Done\n**Timestamp**: 2026-01-01T00:00:01Z\n**Event**: STAGE_COMPLETED\n**Stage**: scope-definition\n");
    writeFileSync(join(one, "scope.md"), "approved\n");
    writeFileSync(join(two, "draft.md"), "unrelated\n");
    const found = discoverCrossing(root)!;
    expect(found.manifest).toContain("aidlc/spaces/default/intents/one/scope.md");
    expect(found.manifest).not.toContain("aidlc/spaces/default/intents/two/draft.md");
  });

  test("joint approval keeps both terminal stages and records an exact override", () => {
    const root = repo(); const dir = join(root, "aidlc/spaces/default/intents/one"); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "audit.md"), "## Await A\n**Timestamp**: 2026-01-01T00:00:00Z\n**Event**: STAGE_AWAITING_APPROVAL\n**Stage**: intent-capture\n**Artifacts**: aidlc/spaces/default/intents/one/intent.md\n**Blocking Sensor Override**: true\n\n---\n## Await B\n**Timestamp**: 2026-01-01T00:00:00.1Z\n**Event**: STAGE_AWAITING_APPROVAL\n**Stage**: scope-definition\n**Artifacts**: aidlc/spaces/default/intents/one/scope.md\n\n---\n## Human\n**Timestamp**: 2026-01-01T00:00:01Z\n**Event**: HUMAN_TURN\n\n---\n## Done A\n**Timestamp**: 2026-01-01T00:00:02Z\n**Event**: STAGE_COMPLETED\n**Stage**: intent-capture\n\n---\n## Gate\n**Timestamp**: 2026-01-01T00:00:02.1Z\n**Event**: GATE_APPROVED\n**Stage**: scope-definition\n\n---\n## Done B\n**Timestamp**: 2026-01-01T00:00:03Z\n**Event**: STAGE_COMPLETED\n**Stage**: scope-definition\n");
    const found = discoverCrossing(root)!;
    expect(found.events.map((event) => event.stage)).toEqual(["intent-capture", "scope-definition"]);
    expect(found.manifest).toContain("aidlc/spaces/default/intents/one/intent.md");
    expect(found.manifest).toContain("aidlc/spaces/default/intents/one/scope.md");
    expect(found.approvalOutcome).toBe("override");
  });
});
