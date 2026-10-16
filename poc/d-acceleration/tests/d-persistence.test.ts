import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { captureAuditBoundary, detectHighConfidenceSecret, discoverCrossing, persistCrossing, type Crossing } from "../d-persistence.ts";
import { resolveDGitPersistence } from "../d-config.ts";
import { createOrchestrationTestProject, FIXTURES_DIR, runOrchestrateNext, seedStateFile } from "../../../tests/harness/fixtures.ts";
import { appendAuditEntry } from "../../../dist/claude/.claude/tools/aidlc-audit.ts";

const ORCHESTRATE = join(import.meta.dir, "../../../dist/claude/.claude/tools/aidlc-orchestrate.ts");

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function run(cwd: string, args: string[]) { const r = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr || r.stdout); return r.stdout.trim(); }
function repo() {
  const root = mkdtempSync(join(tmpdir(), "d-persist-")); roots.push(root); run(root, ["git", "init", "-b", "main"]); run(root, ["git", "config", "user.name", "Test"]); run(root, ["git", "config", "user.email", "test@example.com"]);
  writeFileSync(join(root, "README.md"), "base\n"); run(root, ["git", "add", "README.md"]); run(root, ["git", "commit", "-m", "base"]); return root;
}
function crossing(manifest = ["aidlc/result.md"]): Crossing { return { receipt: "receipt-1", events: [{ event: "STAGE_COMPLETED", stage: "intent-capture" }], manifest }; }
function currentDag(recordDir: string, units = ["alpha"]) { mkdirSync(recordDir, { recursive: true }); writeFileSync(join(recordDir, "runtime-graph.json"), `${JSON.stringify({ bolt_dag: { batches: [units], units: units.map((name) => ({ name })) } })}\n`); }
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

  test("commits only the changed subset when the exact manifest also names an unchanged file", () => {
    const root = repo(); mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "approved\n");
    const result = persistCrossing(root, commit, crossing(["aidlc/result.md", "README.md"]));
    expect(result.status).toBe("committed");
    expect(run(root, ["git", "show", "--pretty=", "--name-only", "HEAD"])).toBe("aidlc/result.md");
    expect(run(root, ["git", "diff", "--cached", "--name-only"])).toBe("");
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

  test("PreToolUse binds PostToolUse to the exact successful report audit suffix", () => {
    const root = repo();
    mkdirSync(join(root, ".claude"));
    writeFileSync(join(root, ".claude/d-acceleration.json"), JSON.stringify({ gitPersistence: { enabled: true, branch: "main" } }));
    const dir = join(root, "aidlc/spaces/default/intents/one"); mkdirSync(dir, { recursive: true });
    const audit = join(dir, "audit.md");
    writeFileSync(audit, "## Old\n**Timestamp**: 2026-01-01T00:00:00Z\n**Event**: STAGE_COMPLETED\n**Stage**: old-stage\n");
    writeFileSync(join(dir, "aidlc-state.md"), "old\n");
    run(root, ["git", "add", "aidlc", ".claude/d-acceleration.json"]); run(root, ["git", "commit", "-m", "fixture"]);
    const hook = join(import.meta.dir, "..", "d-persistence-hook.ts");
    const commandLine = "bun .claude/tools/aidlc.ts engine orchestrate report --stage scope-definition --result approved";
    const packet = { cwd: root, session_id: "s1", tool_use_id: "tool-1", tool_name: "Bash", tool_input: { command: commandLine } };
    const head = run(root, ["git", "rev-parse", "HEAD"]);
    spawnSync("bun", [hook, "pre"], { cwd: root, encoding: "utf8", input: JSON.stringify(packet) });
    spawnSync("bun", [hook, "post"], { cwd: root, encoding: "utf8", input: JSON.stringify({ ...packet, tool_response: { success: true } }) });
    expect(run(root, ["git", "rev-parse", "HEAD"])).toBe(head);

    spawnSync("bun", [hook, "pre"], { cwd: root, encoding: "utf8", input: JSON.stringify({ ...packet, tool_use_id: "tool-2" }) });
    writeFileSync(audit, `${readFileSync(audit, "utf8")}\n---\n## Failed\n**Timestamp**: 2026-01-01T00:00:01Z\n**Event**: STAGE_COMPLETED\n**Stage**: failed-stage\n`);
    spawnSync("bun", [hook, "post"], { cwd: root, encoding: "utf8", input: JSON.stringify({ ...packet, tool_use_id: "tool-2", tool_response: { success: false } }) });
    expect(run(root, ["git", "rev-parse", "HEAD"])).toBe(head);

    // A later successful report cannot consume the failed report's crossing.
    spawnSync("bun", [hook, "pre"], { cwd: root, encoding: "utf8", input: JSON.stringify({ ...packet, tool_use_id: "tool-3" }) });
    writeFileSync(audit, `${readFileSync(audit, "utf8")}\n---\n## Human\n**Timestamp**: 2026-01-01T00:00:02Z\n**Event**: HUMAN_TURN\n**Answer Receipt**: answer-123\n\n---\n## Gate\n**Timestamp**: 2026-01-01T00:00:03Z\n**Event**: GATE_APPROVED\n**Stage**: scope-definition\n**Approval Fingerprint**: fp-123\n\n---\n## Done\n**Timestamp**: 2026-01-01T00:00:04Z\n**Event**: STAGE_COMPLETED\n**Stage**: scope-definition\n`);
    writeFileSync(join(dir, "aidlc-state.md"), "done\n");
    const succeeded = spawnSync("bun", [hook, "post"], { cwd: root, encoding: "utf8", input: JSON.stringify({ ...packet, tool_use_id: "tool-3", tool_response: { success: true } }) });
    expect(succeeded.status).toBe(0);
    expect(run(root, ["git", "rev-parse", "HEAD"])).not.toBe(head);
    expect(run(root, ["git", "show", "-s", "--format=%B", "HEAD"])).toContain("scope-definition");
    expect(run(root, ["git", "show", "-s", "--format=%B", "HEAD"])).not.toContain("failed-stage");
  });

  test("real official report audit drives the hook and a refused report cannot commit", () => {
    const root = createOrchestrationTestProject(); roots.push(root);
    seedStateFile(root, join(FIXTURES_DIR, "state-mid-ideation.md"));
    run(root, ["git", "init", "-b", "main"]); run(root, ["git", "config", "user.name", "Test"]); run(root, ["git", "config", "user.email", "test@example.com"]);
    mkdirSync(join(root, ".claude"));
    writeFileSync(join(root, ".claude/d-acceleration.json"), JSON.stringify({ gitPersistence: { enabled: true, branch: "main" } }));
    run(root, ["git", "add", "."]); run(root, ["git", "commit", "-m", "fixture"]);
    const engineEnv = { ...process.env, AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD: "1", AIDLC_SKIP_ARTIFACT_GUARD: "1" };
    const next = runOrchestrateNext(ORCHESTRATE, root, [], { env: engineEnv });
    expect(next.directive?.kind).toBe("run-stage"); expect(next.directive?.stage).toBe("feasibility");
    for (const produced of (next.directive?.produces as string[] | undefined) ?? []) {
      const absolute = join(root, produced); mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, "# Official report fixture\n");
    }
    const opened = spawnSync(process.execPath, [ORCHESTRATE, "report", "--stage", "feasibility", "--result", "awaiting-approval", "--project-dir", root], { cwd: root, encoding: "utf8", env: engineEnv });
    expect(opened.status).toBe(0); expect(JSON.parse(opened.stdout).kind).not.toBe("error");
    appendAuditEntry("HUMAN_TURN", { Session: "real-report-fixture" }, root);

    const hook = join(import.meta.dir, "..", "d-persistence-hook.ts");
    const commandLine = `bun ${ORCHESTRATE} report --stage feasibility --result approved --user-input Approve --project-dir ${root}`;
    const packet = { cwd: root, session_id: "real-report", tool_use_id: "success", tool_name: "Bash", tool_input: { command: commandLine } };
    expect(spawnSync("bun", [hook, "pre"], { cwd: root, encoding: "utf8", input: JSON.stringify(packet) }).status).toBe(0);
    const report = spawnSync(process.execPath, [ORCHESTRATE, "report", "--stage", "feasibility", "--result", "approved", "--user-input", "Approve", "--project-dir", root], { cwd: root, encoding: "utf8", env: engineEnv });
    expect(report.status).toBe(0);
    const reportDirective = JSON.parse(report.stdout);
    if (reportDirective.kind !== "done") throw new Error(`official report refused fixture: ${reportDirective.message ?? report.stdout}`);
    const post = spawnSync("bun", [hook, "post"], { cwd: root, encoding: "utf8", input: JSON.stringify({ ...packet, tool_response: { success: true, stdout: report.stdout } }) });
    expect(post.status).toBe(0); if (!post.stdout.trim()) throw new Error(`persistence hook produced no result: ${post.stderr}`); const postResult = JSON.parse(post.stdout);
    if (postResult.status !== "committed") {
      throw new Error(JSON.stringify(postResult));
    }
    const committed = run(root, ["git", "rev-parse", "HEAD"]);
    expect(run(root, ["git", "show", "-s", "--format=%B", "HEAD"])).toContain("feasibility");

    const refusedCommand = `bun ${ORCHESTRATE} report --stage wrong-stage --result completed --project-dir ${root}`;
    const refusedPacket = { ...packet, tool_use_id: "refused", tool_input: { command: refusedCommand } };
    spawnSync("bun", [hook, "pre"], { cwd: root, encoding: "utf8", input: JSON.stringify(refusedPacket) });
    const refused = spawnSync(process.execPath, [ORCHESTRATE, "report", "--stage", "wrong-stage", "--result", "completed", "--project-dir", root], { cwd: root, encoding: "utf8", env: engineEnv });
    expect(JSON.parse(refused.stdout).kind).toBe("error");
    spawnSync("bun", [hook, "post"], { cwd: root, encoding: "utf8", input: JSON.stringify({ ...refusedPacket, tool_response: { success: true, stdout: refused.stdout } }) });
    expect(run(root, ["git", "rev-parse", "HEAD"])).toBe(committed);
  }, 15_000);

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
    expect(() => persistCrossing(root, commit, crossing())).toThrow(/high-confidence private-key detected/);
    expect(run(root, ["git", "diff", "--cached", "--name-only"])).toBe("");
  });

  test("the mandatory persistence scan covers common high-confidence token families", () => {
    expect(detectHighConfidenceSecret(Buffer.from("ASIAABCDEFGHIJKLMNOP"))).toBe("aws-access-key");
    expect(detectHighConfidenceSecret(Buffer.from(`ghp_${"a".repeat(36)}`))).toBe("github-token");
    expect(detectHighConfidenceSecret(Buffer.from(`xoxb-${"a".repeat(24)}`))).toBe("slack-token");
    expect(detectHighConfidenceSecret(Buffer.from(`AIza${"a".repeat(35)}`))).toBe("google-api-key");
    expect(detectHighConfidenceSecret(Buffer.from(`sk_live_${"a".repeat(24)}`))).toBe("stripe-live-key");
    expect(detectHighConfidenceSecret(Buffer.from("ordinary approved artifact"))).toBeNull();
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
    expect(() => persistCrossing(root, commit, crossing())).toThrow("pre-commit hook failed");
    expect(run(root, ["git", "diff", "--cached", "--name-only"])).toBe("");
    expect(readFileSync(join(root, "aidlc/result.md"), "utf8")).toBe("approved\n");
  });

  test("a hook-added external path cannot enter the checkpoint commit", () => {
    const root = repo(); mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "approved\n"); writeFileSync(join(root, "hook-owned.txt"), "hook\n");
    const hook = join(root, ".git", "hooks", "pre-commit"); writeFileSync(hook, "#!/bin/sh\ngit add hook-owned.txt\n"); chmodSync(hook, 0o755);
    expect(() => persistCrossing(root, commit, crossing())).toThrow("path set");
    expect(run(root, ["git", "show", "--pretty=", "--name-only", "HEAD"])).toBe("README.md");
    expect(run(root, ["git", "diff", "--cached", "--name-only"])).toBe("");
    expect(readFileSync(join(root, "hook-owned.txt"), "utf8")).toBe("hook\n");
  });

  test("rescans the hook-updated manifest blob before any commit object is created", () => {
    const root = repo(); mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "approved\n");
    const beforeObjects = run(root, ["git", "count-objects", "-v"]);
    const hook = join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, `#!/bin/sh\nprintf '%s\\n' 'AKIAABCDEFGHIJKLMNOP' > aidlc/result.md\ngit add aidlc/result.md\n`); chmodSync(hook, 0o755);
    expect(() => persistCrossing(root, commit, crossing())).toThrow(/hook-updated persistence index/);
    expect(run(root, ["git", "rev-list", "--count", "HEAD"])).toBe("1");
    expect(run(root, ["git", "show", "HEAD:README.md"])).toBe("base");
    expect(run(root, ["git", "diff", "--cached", "--name-only"])).toBe("");
    expect(readFileSync(join(root, "aidlc/result.md"), "utf8")).toBe("AKIAABCDEFGHIJKLMNOP\n");
    // Blob objects written by git add are harmless; there must be no new commit.
    expect(run(root, ["git", "count-objects", "-v"])).not.toBe(beforeObjects);
  });

  test("runs ordinary hooks against the isolated candidate and commits their safe manifest update", () => {
    const root = repo(); mkdirSync(join(root, "aidlc")); writeFileSync(join(root, "aidlc/result.md"), "approved\n");
    const hook = join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nprintf '%s\\n' 'approved by hook' > aidlc/result.md\ngit add aidlc/result.md\n"); chmodSync(hook, 0o755);
    expect(persistCrossing(root, commit, crossing()).status).toBe("committed");
    expect(run(root, ["git", "show", "HEAD:aidlc/result.md"])).toBe("approved by hook");
    expect(run(root, ["git", "diff", "--cached", "--name-only"])).toBe("");
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

  test("sharded audit serial Construction expands and commits hash-bound reviewed source", () => {
    const root = repo(); const dir = join(root, "aidlc/spaces/default/intents/one");
    currentDag(dir);
    const stageDir = join(dir, "construction/alpha/code-generation"); mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(dir, "aidlc-state.md"), "state\n");
    writeFileSync(join(stageDir, "code-summary.md"), "approved summary\n");
    writeFileSync(join(root, "app.ts"), "export const approved = true;\n");
    const manifest = Buffer.from(`${JSON.stringify({ stage: "code-generation", unit: "alpha", version: 1, writes: [{ path: "app.ts" }] }, null, 2)}\n`);
    writeFileSync(join(stageDir, "source-manifest.json"), manifest);
    const manifestSha = createHash("sha256").update(manifest).digest("hex");
    const appOid = run(root, ["git", "hash-object", "--", "app.ts"]);
    const evidence = Buffer.from(`manifest\t${manifestSha}\t-\n\tapp.ts\t100644\t${appOid}\n`);
    const fingerprint = createHash("sha256").update(evidence).digest("hex");
    writeFileSync(join(stageDir, `reviewed-source-${fingerprint.slice(0, 12)}.tsv`), evidence);
    const auditDir = join(dir, "audit"); mkdirSync(auditDir);
    writeFileSync(join(auditDir, "session-a.md"), `## Unit\n**Timestamp**: 2025-12-31T23:59:59Z\n**Event**: UNIT_STARTED\n**Stage**: code-generation\n**Unit**: alpha\n**Run floor**: STAGE_STARTED:fixture#1\n**Attempt Generation**: 1\n\n---\n## Review\n**Timestamp**: 2026-01-01T00:00:00Z\n**Event**: REVIEW_COMPLETED\n**Verdict**: READY\n**Stage**: code-generation\n**Unit**: alpha\n**Attempt Generation**: 1\n**Unit Source Fingerprint**: sha256:${fingerprint}\n\n---\n## Await\n**Timestamp**: 2026-01-01T00:00:01Z\n**Event**: STAGE_AWAITING_APPROVAL\n**Stage**: code-generation\n**Artifacts**: aidlc/spaces/default/intents/one/construction/alpha/code-generation/code-summary.md\n\n---\n## Human\n**Timestamp**: 2026-01-01T00:00:02Z\n**Event**: HUMAN_TURN\n\n---\n## Done\n**Timestamp**: 2026-01-01T00:00:03Z\n**Event**: STAGE_COMPLETED\n**Stage**: code-generation\n`);
    const found = discoverCrossing(root)!;
    expect(found.manifest).toContain("app.ts");
    expect(persistCrossing(root, commit, found).status).toBe("committed");
    expect(run(root, ["git", "show", "--pretty=", "--name-only", "HEAD"]).split("\n")).toContain("app.ts");
  });

  test("serial Construction refuses source bytes changed after reviewed evidence", () => {
    const root = repo(); const dir = join(root, "aidlc/spaces/default/intents/one");
    currentDag(dir);
    const stageDir = join(dir, "construction/alpha/code-generation"); mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(root, "app.ts"), "reviewed\n");
    const manifest = Buffer.from(`${JSON.stringify({ stage: "code-generation", unit: "alpha", version: 1, writes: [{ path: "app.ts" }] })}\n`);
    writeFileSync(join(stageDir, "source-manifest.json"), manifest);
    const manifestSha = createHash("sha256").update(manifest).digest("hex"); const appOid = run(root, ["git", "hash-object", "--", "app.ts"]);
    const evidence = Buffer.from(`manifest\t${manifestSha}\t-\n\tapp.ts\t100644\t${appOid}\n`); const fingerprint = createHash("sha256").update(evidence).digest("hex");
    writeFileSync(join(stageDir, `reviewed-source-${fingerprint.slice(0, 12)}.tsv`), evidence); writeFileSync(join(root, "app.ts"), "tampered\n");
    writeFileSync(join(dir, "audit.md"), `## Unit\n**Timestamp**: 2025-12-31T23:59:59Z\n**Event**: UNIT_STARTED\n**Stage**: code-generation\n**Unit**: alpha\n**Run floor**: STAGE_STARTED:fixture#1\n**Attempt Generation**: 1\n\n---\n## Review\n**Timestamp**: 2026-01-01T00:00:00Z\n**Event**: REVIEW_COMPLETED\n**Verdict**: READY\n**Stage**: code-generation\n**Unit**: alpha\n**Attempt Generation**: 1\n**Unit Source Fingerprint**: sha256:${fingerprint}\n\n---\n## Await\n**Timestamp**: 2026-01-01T00:00:01Z\n**Event**: STAGE_AWAITING_APPROVAL\n**Stage**: code-generation\n**Artifacts**: aidlc/spaces/default/intents/one/construction/alpha/code-generation/source-manifest.json\n\n---\n## Human\n**Timestamp**: 2026-01-01T00:00:02Z\n**Event**: HUMAN_TURN\n\n---\n## Done\n**Timestamp**: 2026-01-01T00:00:03Z\n**Event**: STAGE_COMPLETED\n**Stage**: code-generation\n`);
    expect(() => discoverCrossing(root)).toThrow("source hash changed");
  });

  test("serial Construction persists a reviewed exact-path deletion with an empty listing", () => {
    const root = repo(); writeFileSync(join(root, "obsolete.ts"), "remove me\n"); run(root, ["git", "add", "obsolete.ts"]); run(root, ["git", "commit", "-m", "add obsolete"]); rmSync(join(root, "obsolete.ts"));
    const dir = join(root, "aidlc/spaces/default/intents/one"); const stageDir = join(dir, "construction/alpha/code-generation"); mkdirSync(stageDir, { recursive: true });
    currentDag(dir);
    writeFileSync(join(dir, "aidlc-state.md"), "state\n");
    const manifest = Buffer.from(`${JSON.stringify({ stage: "code-generation", unit: "alpha", version: 1, writes: [{ path: "obsolete.ts" }] })}\n`); writeFileSync(join(stageDir, "source-manifest.json"), manifest);
    const manifestSha = createHash("sha256").update(manifest).digest("hex"); const evidence = Buffer.from(`manifest\t${manifestSha}\t-\n`); const fingerprint = createHash("sha256").update(evidence).digest("hex");
    writeFileSync(join(stageDir, `reviewed-source-${fingerprint.slice(0, 12)}.tsv`), evidence);
    writeFileSync(join(dir, "audit.md"), `## Unit\n**Timestamp**: 2025-12-31T23:59:59Z\n**Event**: UNIT_STARTED\n**Stage**: code-generation\n**Unit**: alpha\n**Run floor**: STAGE_STARTED:fixture#1\n**Attempt Generation**: 1\n\n---\n## Review\n**Timestamp**: 2026-01-01T00:00:00Z\n**Event**: REVIEW_COMPLETED\n**Verdict**: READY\n**Stage**: code-generation\n**Unit**: alpha\n**Attempt Generation**: 1\n**Unit Source Fingerprint**: sha256:${fingerprint}\n\n---\n## Human\n**Timestamp**: 2026-01-01T00:00:01Z\n**Event**: HUMAN_TURN\n\n---\n## Done\n**Timestamp**: 2026-01-01T00:00:02Z\n**Event**: STAGE_COMPLETED\n**Stage**: code-generation\n`);
    const found = discoverCrossing(root)!; expect(found.manifest).toContain("obsolete.ts");
    expect(persistCrossing(root, commit, found).status).toBe("committed");
    expect(run(root, ["git", "show", "--pretty=", "--name-status", "HEAD"])).toContain("D\tobsolete.ts");
  });

  test("swarm source already landed by official authority is not re-expanded", () => {
    const root = repo(); const dir = join(root, "aidlc/spaces/default/intents/one"); const stageDir = join(dir, "construction/alpha/code-generation"); mkdirSync(stageDir, { recursive: true });
    currentDag(dir);
    writeFileSync(join(stageDir, "source-manifest.json"), "not-json\n");
    writeFileSync(join(dir, "audit.md"), `## Await\n**Timestamp**: 2026-01-01T00:00:00Z\n**Event**: STAGE_AWAITING_APPROVAL\n**Stage**: code-generation\n**Artifacts**: aidlc/spaces/default/intents/one/construction/alpha/code-generation/source-manifest.json\n\n---\n## Merged\n**Timestamp**: 2026-01-01T00:00:01Z\n**Event**: SWARM_SOURCE_MERGED\n**Unit name**: alpha\n**Stage**: code-generation\n\n---\n## Human\n**Timestamp**: 2026-01-01T00:00:02Z\n**Event**: HUMAN_TURN\n\n---\n## Done\n**Timestamp**: 2026-01-01T00:00:03Z\n**Event**: STAGE_COMPLETED\n**Stage**: code-generation\n`);
    expect(discoverCrossing(root)?.manifest).not.toContain("app.ts");
  });

  test("serial Construction refuses an unreviewed or hash-mismatched source manifest", () => {
    const root = repo(); const dir = join(root, "aidlc/spaces/default/intents/one");
    currentDag(dir);
    const stageDir = join(dir, "construction/alpha/code-generation"); mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(root, "app.ts"), "unreviewed\n");
    writeFileSync(join(stageDir, "source-manifest.json"), `${JSON.stringify({ stage: "code-generation", unit: "alpha", version: 1, writes: [{ path: "app.ts" }] })}\n`);
    writeFileSync(join(dir, "audit.md"), `## Await\n**Timestamp**: 2026-01-01T00:00:01Z\n**Event**: STAGE_AWAITING_APPROVAL\n**Stage**: code-generation\n**Artifacts**: aidlc/spaces/default/intents/one/construction/alpha/code-generation/source-manifest.json\n\n---\n## Human\n**Timestamp**: 2026-01-01T00:00:02Z\n**Event**: HUMAN_TURN\n\n---\n## Done\n**Timestamp**: 2026-01-01T00:00:03Z\n**Event**: STAGE_COMPLETED\n**Stage**: code-generation\n`);
    expect(() => discoverCrossing(root)).toThrow("lacks a matching reviewed validation receipt");
  });

  test("Construction selects only newest READY review for current attempt obligations", () => {
    const root = repo(); const dir = join(root, "aidlc/spaces/default/intents/one"); currentDag(dir, ["alpha"]); const alpha = join(dir, "construction/alpha/code-generation"); const retired = join(dir, "construction/retired/code-generation"); mkdirSync(alpha, { recursive: true }); mkdirSync(retired, { recursive: true });
    writeFileSync(join(root, "app.ts"), "current\n"); const manifest = Buffer.from(`${JSON.stringify({ stage: "code-generation", unit: "alpha", version: 1, writes: [{ path: "app.ts" }] })}\n`); writeFileSync(join(alpha, "source-manifest.json"), manifest); writeFileSync(join(retired, "source-manifest.json"), "invalid retired bytes\n");
    const manifestSha = createHash("sha256").update(manifest).digest("hex"); const oid = run(root, ["git", "hash-object", "--", "app.ts"]); const evidence = Buffer.from(`manifest\t${manifestSha}\t-\n\tapp.ts\t100644\t${oid}\n`); const fingerprint = createHash("sha256").update(evidence).digest("hex"); writeFileSync(join(alpha, `reviewed-source-${fingerprint.slice(0, 12)}.tsv`), evidence);
    writeFileSync(join(dir, "audit.md"), `## Unit\n**Timestamp**: 2026-01-01T00:00:01Z\n**Event**: UNIT_STARTED\n**Stage**: code-generation\n**Unit**: alpha\n**Attempt Generation**: 2\n\n---\n## Old\n**Timestamp**: 2026-01-01T00:00:02Z\n**Event**: REVIEW_COMPLETED\n**Verdict**: READY\n**Stage**: code-generation\n**Unit**: alpha\n**Attempt Generation**: 1\n**Unit Source Fingerprint**: sha256:${fingerprint}\n\n---\n## Not ready\n**Timestamp**: 2026-01-01T00:00:03Z\n**Event**: REVIEW_COMPLETED\n**Verdict**: NOT-READY\n**Stage**: code-generation\n**Unit**: alpha\n**Attempt Generation**: 2\n**Unit Source Fingerprint**: sha256:${fingerprint}\n\n---\n## Retired\n**Timestamp**: 2026-01-01T00:00:04Z\n**Event**: REVIEW_COMPLETED\n**Verdict**: READY\n**Stage**: code-generation\n**Unit**: retired\n**Attempt Generation**: 2\n**Unit Source Fingerprint**: sha256:${fingerprint}\n\n---\n## Current\n**Timestamp**: 2026-01-01T00:00:05Z\n**Event**: REVIEW_COMPLETED\n**Verdict**: READY\n**Stage**: code-generation\n**Unit**: alpha\n**Attempt Generation**: 2\n**Unit Source Fingerprint**: sha256:${fingerprint}\n\n---\n## Human\n**Timestamp**: 2026-01-01T00:00:06Z\n**Event**: HUMAN_TURN\n\n---\n## Done\n**Timestamp**: 2026-01-01T00:00:07Z\n**Event**: STAGE_COMPLETED\n**Stage**: code-generation\n`);
    const found = discoverCrossing(root)!; expect(found.manifest).toContain("app.ts"); expect(found.manifest.some((path) => path.includes("/retired/"))).toBeFalse();
  });

  test("crossing receipt is bound to the human answer and gate approval fingerprint", () => {
    const root = repo(); const dir = join(root, "aidlc/spaces/default/intents/one"); mkdirSync(dir, { recursive: true });
    const audit = join(dir, "audit.md");
    const prefix = "## Await\n**Timestamp**: 2026-01-01T00:00:00Z\n**Event**: STAGE_AWAITING_APPROVAL\n**Stage**: scope-definition\n";
    writeFileSync(audit, prefix); const boundary = captureAuditBoundary(root);
    const suffix = (answer: string, fingerprint: string) => `\n---\n## Human\n**Timestamp**: 2026-01-01T00:00:01Z\n**Event**: HUMAN_TURN\n**Answer Receipt**: ${answer}\n\n---\n## Gate\n**Timestamp**: 2026-01-01T00:00:02Z\n**Event**: GATE_APPROVED\n**Stage**: scope-definition\n**Approval Fingerprint**: ${fingerprint}\n\n---\n## Done\n**Timestamp**: 2026-01-01T00:00:03Z\n**Event**: STAGE_COMPLETED\n**Stage**: scope-definition\n`;
    writeFileSync(audit, prefix + suffix("answer-a", "fp-a"));
    const first = discoverCrossing(root, boundary)!;
    writeFileSync(audit, prefix + suffix("answer-b", "fp-b"));
    const second = discoverCrossing(root, boundary)!;
    expect(first.receipt).not.toBe(second.receipt);
  });
});
