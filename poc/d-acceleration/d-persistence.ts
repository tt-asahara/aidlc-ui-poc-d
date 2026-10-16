import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { DGitPersistenceConfig } from "./d-config.ts";

export type Crossing = { receipt: string; events: Array<{ event: "STAGE_COMPLETED" | "STAGE_SKIPPED" | "WORKFLOW_COMPLETED"; stage?: string }>; manifest: string[]; approvalOutcome?: "pass" | "override" };
type Pending = { version: 1; receipt: string; commitOid: string; remote: string; branch: string; refspec: string; state: "pending" | "pushed"; manifestHash: string };
export type PersistenceResult = { status: "disabled" | "deferred" | "committed" | "pushed" | "already-processed"; reason?: string; commitOid?: string };

function git(projectDir: string, args: string[], input?: string) {
  return spawnSync("git", args, { cwd: projectDir, input, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
function out(projectDir: string, args: string[]): string {
  const r = git(projectDir, args); if (r.status !== 0) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim()); return r.stdout.trim();
}
function atomicJson(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temp, path); }
function sha(value: string) { return createHash("sha256").update(value).digest("hex"); }
function validateRefPart(value: string, label: string) { if (!value || /[\s~^:?*\\\[\]]/.test(value) || value.startsWith("-") || value.includes("..") || value.includes("@{")) throw new Error(`unsafe ${label}`); }

function normalizeManifest(projectDir: string, paths: string[]): string[] {
  const root = realpathSync(projectDir); const unique = new Set<string>();
  const inspect = (raw: string): void => {
    if (!raw || raw.includes("\0")) throw new Error("invalid manifest path");
    const absolute = resolve(root, raw); const rel = relative(root, absolute);
    if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`manifest path escapes PRODUCT: ${raw}`);
    const segments = rel.split(/[\\/]/);
    if (segments.some((part) => part === ".git" || /^\.env(?:\..+)?$/i.test(part) || /^\.(?:npmrc|netrc)$/i.test(part) || /^(?:credentials|id_(rsa|dsa|ecdsa|ed25519)|.*\.(pem|key|p12))$/i.test(part))) throw new Error(`protected path in persistence manifest: ${rel}`);
    let cursor = root;
    for (const segment of segments.slice(0, -1)) { cursor = join(cursor, segment); if (existsSync(cursor) && !realpathSync(cursor).startsWith(`${root}${sep}`)) throw new Error(`manifest symlink escapes PRODUCT: ${rel}`); }
    if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) throw new Error(`manifest symlink is not allowed: ${rel}`);
    if (existsSync(absolute) && statSync(absolute).isDirectory()) {
      for (const entry of readdirSync(absolute)) inspect(join(rel, entry));
    } else unique.add(rel.split(sep).join("/"));
  };
  for (const raw of paths) inspect(raw);
  const manifest = [...unique].sort();
  for (const path of manifest) {
    const absolute = join(root, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    const bytes = readFileSync(absolute);
    if (bytes.length > 2_000_000) throw new Error(`persistence manifest file is too large to inspect: ${path}`);
    const text = bytes.toString("utf8");
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) || /\bAKIA[0-9A-Z]{16}\b/.test(text) || /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/.test(text)) throw new Error(`high-confidence secret detected in persistence manifest: ${path}`);
  }
  return manifest;
}

function walk(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...walk(path)); else if (entry.isFile()) found.push(path);
  }
  return found;
}
function field(block: string, name: string): string | undefined { return block.match(new RegExp(`^\\*\\*${name}\\*\\*:[ \\t]*(.+)$`, "m"))?.[1]?.trim(); }

/** Build one receipt from the report-owned audit tail; never treats approval alone as a crossing. */
export function discoverCrossing(projectDir: string): Crossing | null {
  const auditFiles = walk(join(projectDir, "aidlc")).filter((path) => /audit.*\.md$/i.test(path));
  const blocks = auditFiles.flatMap((path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n").split(/\n---\n/).map((body) => ({ body, path, mtime: statSync(path).mtimeMs })));
  blocks.sort((a, b) => (field(a.body, "Timestamp") ?? "").localeCompare(field(b.body, "Timestamp") ?? "") || a.path.localeCompare(b.path));
  const terminal = new Set(["STAGE_COMPLETED", "STAGE_SKIPPED", "WORKFLOW_COMPLETED"]);
  const newest = blocks.findLastIndex(({ body }) => terminal.has(field(body, "Event") ?? ""));
  if (newest < 0) return null;
  const shard = blocks[newest].path;
  // A single human turn can approve several approvesTogether stages. The
  // report emits all of their terminal events after that HUMAN_TURN, followed
  // by auto-advance. Bind exactly that report-owned suffix.
  let floor = newest;
  while (floor > 0 && !(blocks[floor - 1].path === shard && field(blocks[floor - 1].body, "Event") === "HUMAN_TURN")) floor--;
  const window = blocks.slice(floor, newest + 1).filter(({ path }) => path === shard);
  const relevant = window.filter(({ body }) => terminal.has(field(body, "Event") ?? ""));
  if (!relevant.length) return null;
  const events = relevant.map(({ body }) => ({ event: field(body, "Event") as Crossing["events"][number]["event"], stage: field(body, "Stage") }));
  const approvedStages = new Set(events.map((event) => event.stage).filter(Boolean));
  let evidenceFloor = floor - 1;
  while (evidenceFloor > 0 && !(blocks[evidenceFloor - 1].path === shard && terminal.has(field(blocks[evidenceFloor - 1].body, "Event") ?? ""))) evidenceFloor--;
  const evidenceWindow = blocks.slice(evidenceFloor, newest + 1).filter(({ path }) => path === shard);
  const artifacts = evidenceWindow.flatMap(({ body }) => {
    const event = field(body, "Event");
    const stage = field(body, "Stage");
    if (event === "STAGE_AWAITING_APPROVAL" && stage && approvedStages.has(stage)) return (field(body, "Artifacts") ?? "").split(/[,;]/).map((p) => p.trim()).filter(Boolean);
    return [];
  });
  // The report-owned audit shard and state document are framework records for
  // this crossing. Never widen this to every dirty path under aidlc/: another
  // user or process may be editing a different intent concurrently.
  const frameworkRecords = relevant.flatMap(({ path }) => {
    const recordDir = dirname(path);
    return [relative(projectDir, path), relative(projectDir, join(recordDir, "aidlc-state.md"))];
  });
  const receiptBytes = relevant.map(({ body, path }) => `${relative(projectDir, path)}\0${body}`).join("\0");
  const override = evidenceWindow.some(({ body }) => /\*\*(Blocking Sensor Override|Override)\*\*:[ \t]*(yes|true)[ \t]*$/im.test(body));
  return { receipt: `sha256:${sha(receiptBytes)}`, events, manifest: [...frameworkRecords, ...artifacts], approvalOutcome: override ? "override" : "pass" };
}

function statePaths(projectDir: string) { const root = join(resolve(projectDir, out(projectDir, ["rev-parse", "--git-dir"])), "aidlc-d-persistence"); return { root, lock: join(root, "lock"), ledger: join(root, "ledger.json"), pending: join(root, "pending-push.json") }; }
function loadJson<T>(path: string, fallback: T): T { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback; }
function mainCheckoutOnly(projectDir: string): boolean {
  const gitDir = realpathSync(resolve(projectDir, out(projectDir, ["rev-parse", "--git-dir"])));
  const common = realpathSync(resolve(projectDir, out(projectDir, ["rev-parse", "--git-common-dir"])));
  return gitDir === common;
}
function operationInProgress(projectDir: string): boolean { const gd = resolve(projectDir, out(projectDir, ["rev-parse", "--git-dir"])); return ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"].some((p) => existsSync(join(gd, p))); }
function staged(projectDir: string): string[] { return out(projectDir, ["diff", "--cached", "--name-only", "-z"]).split("\0").filter(Boolean).sort(); }
function acquireLock(path: string): number | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const fd = openSync(path, "wx", 0o600); writeFileSync(fd, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`); return fd; }
    catch {
      try {
        const value = JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown };
        if (typeof value.pid !== "number") return null;
        try { process.kill(value.pid, 0); return null; } catch { rmSync(path, { force: true }); }
      } catch { return null; }
    }
  }
  return null;
}

function pushPending(projectDir: string, pendingPath: string, pending: Pending): PersistenceResult {
  const current = out(projectDir, ["rev-parse", `refs/heads/${pending.branch}`]);
  if (current !== pending.commitOid) return { status: "deferred", reason: "branch moved since checkpoint; fixed pending refspec was not pushed", commitOid: pending.commitOid };
  const pushed = git(projectDir, ["push", pending.remote, pending.refspec]);
  if (pushed.status !== 0) return { status: "deferred", reason: `push pending: ${(pushed.stderr || pushed.stdout).trim()}`, commitOid: pending.commitOid };
  pending.state = "pushed"; atomicJson(pendingPath, pending); return { status: "pushed", commitOid: pending.commitOid };
}

export function persistCrossing(projectDir: string, config: DGitPersistenceConfig, crossing: Crossing): PersistenceResult {
  if (!config.enabled) return { status: "disabled" };
  if (!crossing.receipt || crossing.events.length === 0 || crossing.events.some((e) => !["STAGE_COMPLETED", "STAGE_SKIPPED", "WORKFLOW_COMPLETED"].includes(e.event))) throw new Error("invalid report crossing receipt");
  if (!mainCheckoutOnly(projectDir)) return { status: "deferred", reason: "official host main checkout required" };
  if (operationInProgress(projectDir)) return { status: "deferred", reason: "merge/rebase/cherry-pick/revert in progress" };
  validateRefPart(config.remote, "remote");
  const branch = config.branch ?? out(projectDir, ["symbolic-ref", "--short", "HEAD"]); validateRefPart(branch, "branch");
  if (out(projectDir, ["symbolic-ref", "--short", "HEAD"]) !== branch) return { status: "deferred", reason: `configured branch ${branch} is not checked out` };
  const paths = statePaths(projectDir); mkdirSync(paths.root, { recursive: true });
  const lock = acquireLock(paths.lock); if (lock === null) return { status: "deferred", reason: "persistence coordinator is already running" };
  try {
    const pending = loadJson<Pending | null>(paths.pending, null);
    if (pending?.state === "pending") return config.push ? pushPending(projectDir, paths.pending, pending) : { status: "deferred", reason: "a prior push remains pending", commitOid: pending.commitOid };
    const ledger = loadJson<Record<string, { commitOid: string }>>(paths.ledger, {});
    let recoveredOid = ledger[crossing.receipt]?.commitOid;
    if (!recoveredOid) {
      const found = git(projectDir, ["log", "-1", "--format=%H", "--grep", `^AI-DLC-Receipt: ${crossing.receipt}$`, "HEAD"]);
      if (found.status === 0 && found.stdout.trim()) recoveredOid = found.stdout.trim();
    }
    if (recoveredOid) {
      ledger[crossing.receipt] = { commitOid: recoveredOid }; atomicJson(paths.ledger, ledger);
      if (config.push) {
        const refspec = `${recoveredOid}:refs/heads/${branch}`;
        const resumed: Pending = { version: 1, receipt: crossing.receipt, commitOid: recoveredOid, remote: config.remote, branch, refspec, state: "pending", manifestHash: sha(normalizeManifest(projectDir, crossing.manifest).join("\0")) };
        atomicJson(paths.pending, resumed); return pushPending(projectDir, paths.pending, resumed);
      }
      return { status: "already-processed", commitOid: recoveredOid };
    }
    if (staged(projectDir).length) return { status: "deferred", reason: "existing staged changes are owned by the user" };
    const manifest = normalizeManifest(projectDir, crossing.manifest);
    if (!manifest.length) return { status: "deferred", reason: "empty persistence manifest" };
    const head = out(projectDir, ["rev-parse", "HEAD"]);
    const add = git(projectDir, ["add", "--", ...manifest]);
    if (add.status !== 0) throw new Error((add.stderr || add.stdout).trim());
    const cached = staged(projectDir);
    if (cached.join("\0") !== manifest.filter((p) => existsSync(join(projectDir, p)) || git(projectDir, ["ls-files", "--error-unmatch", "--", p]).status === 0).sort().join("\0")) throw new Error("staged path set differs from exact manifest");
    if (!cached.length) return { status: "deferred", reason: "manifest has no changes" };
    const message = `chore(aidlc): persist approved transition ${crossing.events.map((e) => e.stage ?? e.event).join(", ")}\n\nAI-DLC-Receipt: ${crossing.receipt}\nAI-DLC-Approval: ${crossing.approvalOutcome ?? "pass"}`;
    // --only constrains the commit even if an ordinary hook stages another path.
    const committed = git(projectDir, ["commit", "--only", "-m", message, "--", ...manifest]);
    if (committed.status !== 0) {
      if (out(projectDir, ["rev-parse", "HEAD"]) === head && staged(projectDir).join("\0") === cached.join("\0")) git(projectDir, ["reset", "--mixed", "HEAD", "--", ...manifest]);
      throw new Error((committed.stderr || committed.stdout || "git commit failed").trim());
    }
    const oid = out(projectDir, ["rev-parse", "HEAD"]);
    if (out(projectDir, ["rev-parse", `${oid}^`]) !== head) throw new Error("checkpoint parent changed unexpectedly");
    const committedPaths = out(projectDir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", oid]).split("\0").filter(Boolean).sort();
    if (committedPaths.join("\0") !== cached.join("\0")) {
      // A hook may have staged an external path. Roll back only our just-created
      // commit, retain the hook-added index entries, and leave every worktree
      // byte untouched. Unknown concurrent HEAD movement is never rewritten.
      if (out(projectDir, ["rev-parse", "HEAD"]) === oid) {
        const external = committedPaths.filter((path) => !cached.includes(path));
        git(projectDir, ["reset", "--soft", head]);
        git(projectDir, ["reset", "HEAD", "--", ...manifest]);
        if (external.length) git(projectDir, ["add", "--", ...external]);
      }
      throw new Error("checkpoint included a path outside the exact manifest; commit rolled back and push suppressed");
    }
    if (staged(projectDir).length) throw new Error("checkpoint postcondition failed; push suppressed");
    ledger[crossing.receipt] = { commitOid: oid }; atomicJson(paths.ledger, ledger);
    if (!config.push) return { status: "committed", commitOid: oid };
    const refspec = `${oid}:refs/heads/${branch}`;
    const next: Pending = { version: 1, receipt: crossing.receipt, commitOid: oid, remote: config.remote, branch, refspec, state: "pending", manifestHash: sha(manifest.join("\0")) };
    atomicJson(paths.pending, next);
    return pushPending(projectDir, paths.pending, next);
  } finally { closeSync(lock); rmSync(paths.lock, { force: true }); }
}
