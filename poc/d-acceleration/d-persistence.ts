import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { DGitPersistenceConfig } from "./d-config.ts";

export type Crossing = { receipt: string; events: Array<{ event: "STAGE_COMPLETED" | "STAGE_SKIPPED" | "WORKFLOW_COMPLETED"; stage?: string }>; manifest: string[]; approvalOutcome?: "pass" | "override" };
export type AuditBoundary = { version: 1; files: Record<string, { bytes: number; prefixHash: string }> };
type Pending = { version: 1; receipt: string; commitOid: string; remote: string; branch: string; refspec: string; state: "pending" | "pushed"; manifestHash: string };
export type PersistenceResult = { status: "disabled" | "deferred" | "committed" | "pushed" | "already-processed"; reason?: string; commitOid?: string };

function git(projectDir: string, args: string[], input?: string) {
  return spawnSync("git", args, { cwd: projectDir, input, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
function gitWithEnv(projectDir: string, args: string[], env: Record<string, string>, input?: string) {
  return spawnSync("git", args, { cwd: projectDir, input, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } });
}
function gitBuffer(projectDir: string, args: string[], maxBuffer: number) {
  return spawnSync("git", args, { cwd: projectDir, encoding: null, maxBuffer, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
function out(projectDir: string, args: string[]): string {
  const r = git(projectDir, args); if (r.status !== 0) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim()); return r.stdout.trim();
}
function atomicJson(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temp, path); }
function sha(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function validateRefPart(value: string, label: string) { if (!value || /[\s~^:?*\\\[\]]/.test(value) || value.startsWith("-") || value.includes("..") || value.includes("@{")) throw new Error(`unsafe ${label}`); }

const HIGH_CONFIDENCE_SECRETS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
  { kind: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { kind: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { kind: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { kind: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "stripe-live-key", pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/ },
];

/** Persistence always scans the exact approved manifest; this is not optional. */
export function detectHighConfidenceSecret(bytes: Buffer): string | null {
  // Known credential families are ASCII, so check them before classifying a
  // NUL-heavy payload as binary. Prefixing a token with binary bytes must not
  // turn the mandatory scan into a bypass.
  const text = bytes.toString("latin1");
  const match = HIGH_CONFIDENCE_SECRETS.find(({ pattern }) => pattern.test(text))?.kind;
  if (match) return match;
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.length && sample.filter((byte) => byte === 0).length / sample.length > 0.05) return null;
  return null;
}

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
    const secret = detectHighConfidenceSecret(bytes);
    if (secret) throw new Error(`high-confidence ${secret} detected in persistence manifest: ${path}`);
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
function recordRootForAudit(path: string): string { const parent = dirname(path); return parent.split(sep).at(-1) === "audit" ? dirname(parent) : parent; }

function officialDagUnits(recordDir: string): Set<string> {
  const path = join(recordDir, "runtime-graph.json");
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("cannot read official current Unit DAG from runtime-graph.json"); }
  const dag = value && typeof value === "object" && !Array.isArray(value) ? (value as { bolt_dag?: unknown }).bolt_dag : undefined;
  if (!dag || typeof dag !== "object" || Array.isArray(dag)) throw new Error("official current Unit DAG is missing from runtime-graph.json");
  const batches = (dag as { batches?: unknown }).batches;
  if (!Array.isArray(batches) || !batches.every((batch) => Array.isArray(batch) && batch.every((unit) => typeof unit === "string" && /^[a-z0-9][a-z0-9._-]*$/.test(unit)))) {
    throw new Error("official current Unit DAG is malformed in runtime-graph.json");
  }
  const units = batches.flat() as string[];
  if (!units.length || new Set(units).size !== units.length) throw new Error("official current Unit DAG is empty or duplicated in runtime-graph.json");
  return new Set(units);
}

function currentReadyReviews(blocks: string[], stage: string, obligations: ReadonlySet<string>): string[] {
  const latestAttempt = new Map<string, string>();
  for (const body of blocks) {
    if (!["UNIT_STARTED", "UNIT_RESUMED", "UNIT_COMPLETED"].includes(field(body, "Event") ?? "") || field(body, "Stage") !== stage) continue;
    const unit = field(body, "Unit"); const attempt = field(body, "Attempt Generation");
    if (unit && obligations.has(unit) && attempt) latestAttempt.set(unit, attempt);
  }
  const newest = new Map<string, string>();
  for (const body of blocks) {
    if (field(body, "Event") !== "REVIEW_COMPLETED" || field(body, "Stage") !== stage) continue;
    const unit = field(body, "Unit"); if (!unit || !obligations.has(unit)) continue;
    const requiredAttempt = latestAttempt.get(unit);
    if (!requiredAttempt || field(body, "Attempt Generation") !== requiredAttempt) continue;
    newest.set(unit, body);
  }
  return [...newest.values()].filter((body) => field(body, "Verdict") === "READY");
}

function serialConstructionSources(projectDir: string, manifestPaths: string[], evidenceBlocks: string[]): string[] {
  const expanded: string[] = [];
  for (const manifestPath of manifestPaths) {
    const matched = /(?:^|\/)construction\/([^/]+)\/([^/]+)\/source-manifest\.json$/.exec(manifestPath);
    if (!matched) continue;
    const [, unit, stage] = matched;
    const absolute = join(projectDir, manifestPath);
    const obligations = officialDagUnits(dirname(dirname(dirname(dirname(absolute)))));
    if (!obligations.has(unit)) throw new Error(`serial Construction source manifest unit is not in the official current DAG: ${unit}`);
    const swarmLanded = evidenceBlocks.some((body) => field(body, "Event") === "SWARM_SOURCE_MERGED" &&
      (field(body, "Unit") === unit || field(body, "Unit name") === unit) && field(body, "Stage") === stage);
    if (swarmLanded) continue;
    const raw = readFileSync(absolute);
    let value: unknown;
    try { value = JSON.parse(raw.toString("utf8")); } catch { throw new Error(`invalid serial Construction source manifest: ${manifestPath}`); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid serial Construction source manifest: ${manifestPath}`);
    const object = value as Record<string, unknown>;
    if (object.version !== 1 || object.stage !== stage || ("unit" in object && object.unit !== unit) || !Array.isArray(object.writes) ||
      Object.keys(object).some((key) => !["version", "stage", "unit", "writes"].includes(key))) {
      throw new Error(`invalid serial Construction source manifest binding: ${manifestPath}`);
    }
    const manifestSha = sha(raw);
    const reviews = currentReadyReviews(evidenceBlocks, stage, obligations).filter((body) => field(body, "Unit") === unit);
    let reviewedEvidence: string | undefined;
    const binding = reviews.findLast((body) => {
      const fingerprint = field(body, "Unit Source Fingerprint");
      if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint ?? "")) return false;
      const evidence = readdirSync(dirname(absolute)).filter((name) => /^reviewed-source-[0-9a-f]{12}\.tsv$/.test(name));
      return evidence.some((name) => {
        const bytes = readFileSync(join(dirname(absolute), name));
        const match = `sha256:${sha(bytes)}` === fingerprint && bytes.toString("utf8").startsWith(`manifest\t${manifestSha}\t-\n`);
        if (match) reviewedEvidence = join(dirname(manifestPath), name).split(sep).join("/");
        return match;
      });
    });
    if (!binding || !reviewedEvidence) throw new Error(`serial Construction source manifest lacks a matching reviewed validation receipt: ${manifestPath}`);
    const listing = readFileSync(join(projectDir, reviewedEvidence), "utf8").split("\n").slice(1).filter(Boolean).map((line) => {
      const fields = line.split("\t");
      if (fields.length !== 4 || fields[0] !== "" || !/^[^\\\t\r\n]+$/.test(fields[1]) || !/^100(?:644|755)$/.test(fields[2]) || !/^[0-9a-f]{40,64}$/.test(fields[3])) {
        throw new Error(`invalid reviewed source evidence: ${reviewedEvidence}`);
      }
      return { path: fields[1], mode: fields[2], oid: fields[3] };
    });
    expanded.push(reviewedEvidence);
    for (const [index, write] of object.writes.entries()) {
      if (!write || typeof write !== "object" || Array.isArray(write) || typeof (write as Record<string, unknown>).path !== "string" ||
        Object.keys(write as object).some((key) => !["path", "repo"].includes(key))) throw new Error(`invalid writes[${index}] in ${manifestPath}`);
      const repo = (write as Record<string, unknown>).repo;
      if (repo !== undefined) throw new Error(`serial Construction persistence does not support recorded-repo claim ${JSON.stringify(repo)}`);
      const claim = (write as { path: string }).path;
      const prefix = claim.endsWith("/");
      const normalized = claim.replace(/\/+$/, "");
      const covered = listing.filter((entry) => entry.path === normalized || (prefix && entry.path.startsWith(`${normalized}/`)));
      if (!covered.length) {
        // A reviewed exact-path deletion has no current listing row. It is
        // nevertheless a real claim when HEAD still owns that exact path;
        // `git add -- <path>` below records the deletion. Empty directory
        // prefixes remain ambiguous and fail closed.
        const trackedDeletion = !prefix && !existsSync(join(projectDir, normalized)) &&
          git(projectDir, ["cat-file", "-e", `HEAD:${normalized}`]).status === 0;
        if (!trackedDeletion) throw new Error(`reviewed source evidence does not cover writes[${index}] in ${manifestPath}`);
        expanded.push(normalized);
      }
      for (const entry of covered) {
        const source = join(projectDir, entry.path);
        if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`reviewed serial Construction source is missing: ${entry.path}`);
        const oid = out(projectDir, ["hash-object", "--", entry.path]);
        const mode = statSync(source).mode & 0o111 ? "100755" : "100644";
        if (oid !== entry.oid || mode !== entry.mode) throw new Error(`reviewed serial Construction source hash changed: ${entry.path}`);
        expanded.push(entry.path);
      }
    }
  }
  return expanded;
}

function auditBlocks(projectDir: string) {
  return walk(join(projectDir, "aidlc")).filter((path) => /(?:^|[\\/])audit(?:[\\/].+|[^\\/]*)\.md$/i.test(path)).map((path) => ({
    path,
    rel: relative(projectDir, path).split(sep).join("/"),
    raw: readFileSync(path),
    bodies: readFileSync(path, "utf8").replace(/\r\n/g, "\n").split(/\n---\n/),
  }));
}

/** Immutable audit prefix captured immediately before one report invocation. */
export function captureAuditBoundary(projectDir: string): AuditBoundary {
  const files: AuditBoundary["files"] = {};
  for (const { rel, raw } of auditBlocks(projectDir)) files[rel] = { bytes: raw.length, prefixHash: sha(raw) };
  return { version: 1, files };
}

/** Build one receipt from the report-owned audit tail; never treats approval alone as a crossing. */
export function discoverCrossing(projectDir: string, boundary?: AuditBoundary): Crossing | null {
  const files = auditBlocks(projectDir);
  if (boundary && boundary.version !== 1) return null;
  if (boundary) {
    for (const [rel, before] of Object.entries(boundary.files)) {
      const current = files.find((file) => file.rel === rel);
      if (!current || current.raw.length < before.bytes || sha(current.raw.subarray(0, before.bytes)) !== before.prefixHash) return null;
    }
  }
  const blocks = files.flatMap(({ path, rel, bodies }) => bodies.map((body, index) => ({ body, path, rel, index })));
  blocks.sort((a, b) => (field(a.body, "Timestamp") ?? "").localeCompare(field(b.body, "Timestamp") ?? "") || a.path.localeCompare(b.path));
  const terminal = new Set(["STAGE_COMPLETED", "STAGE_SKIPPED", "WORKFLOW_COMPLETED"]);
  const appended = boundary ? files.flatMap(({ path, rel, raw }) => {
    const offset = boundary.files[rel]?.bytes ?? 0;
    return raw.subarray(offset).toString("utf8").replace(/\r\n/g, "\n").split(/\n---\n/)
      .map((body) => body.replace(/^\s*---\s*\n/, "").trim())
      .filter(Boolean)
      .map((body, index) => ({ body, path, rel, index }));
  }) : blocks;
  const relevant = appended.filter(({ body }) => terminal.has(field(body, "Event") ?? ""));
  if (!relevant.length) return null;
  const shards = new Set(relevant.map(({ path }) => path));
  if (shards.size !== 1) return null;
  const shard = relevant[0].path;
  // Bind terminal events to the approval evidence in the same audit shard.
  // The evidence may precede the report boundary; it is selected only for the
  // stages whose terminal events were appended by this exact report.
  const approvedStages = new Set(relevant.map(({ body }) => field(body, "Stage")).filter(Boolean));
  const newest = Math.max(...relevant.map((entry) => blocks.findLastIndex((block) => block.path === entry.path && block.body.trim() === entry.body.trim())));
  let floor = newest;
  while (floor > 0 && !(
    blocks[floor - 1].path === shard &&
    ["HUMAN_TURN", "GATE_APPROVED"].includes(field(blocks[floor - 1].body, "Event") ?? "")
  )) floor--;
  const window = blocks.slice(floor, newest + 1).filter(({ path }) => path === shard);
  const events = relevant.map(({ body }) => ({ event: field(body, "Event") as Crossing["events"][number]["event"], stage: field(body, "Stage") }));
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
    const recordDir = recordRootForAudit(path);
    return [relative(projectDir, path), relative(projectDir, join(recordDir, "aidlc-state.md"))];
  });
  // workspace_requires source manifests are engine-required bindings rather
  // than ordinary declared artifacts, so include the exact completed Unit's
  // binding even when STAGE_AWAITING_APPROVAL omits it from Artifacts.
  const constructionBindings = relevant.flatMap(({ body, path }) => {
    const stage = field(body, "Stage");
    if (!stage) return [];
    const recordDir = recordRootForAudit(path);
    const available = walk(join(recordDir, "construction")).filter((candidate) =>
      candidate.split(sep).join("/").endsWith(`/${stage}/source-manifest.json`));
    if (!available.length) return [];
    const obligations = officialDagUnits(recordDir);
    const units = new Set(currentReadyReviews(evidenceWindow.map(({ body: evidence }) => evidence), stage, obligations)
      .map((evidence) => field(evidence, "Unit")).filter((unit): unit is string => Boolean(unit)));
    return [...units].flatMap((unit) => {
      const candidate = join(recordDir, "construction", unit, stage, "source-manifest.json");
      return existsSync(candidate) ? [relative(projectDir, candidate)] : [];
    });
  });
  const approvalEvidence = evidenceWindow.filter(({ body }) => {
    const event = field(body, "Event");
    const stage = field(body, "Stage");
    return event === "HUMAN_TURN" || ((event === "GATE_APPROVED" || event === "STAGE_AWAITING_APPROVAL") && (!stage || approvedStages.has(stage)));
  });
  const receiptBytes = [...approvalEvidence, ...relevant].map(({ body, path }) => `${relative(projectDir, path)}\0${body}`).join("\0");
  const override = evidenceWindow.some(({ body }) => /\*\*(Blocking Sensor Override|Override)\*\*:[ \t]*(yes|true)[ \t]*$/im.test(body));
  const baseManifest = [...frameworkRecords, ...artifacts, ...constructionBindings];
  const sources = serialConstructionSources(projectDir, baseManifest, evidenceWindow.map(({ body }) => body));
  return { receipt: `sha256:${sha(receiptBytes)}`, events, manifest: [...baseManifest, ...sources], approvalOutcome: override ? "override" : "pass" };
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
function stagedWithIndex(projectDir: string, indexPath: string): string[] {
  const result = gitWithEnv(projectDir, ["diff", "--cached", "--name-only", "-z"], { GIT_INDEX_FILE: indexPath });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "cannot inspect isolated persistence index").trim());
  return result.stdout.split("\0").filter(Boolean).sort();
}
function scanTreeManifest(projectDir: string, tree: string, paths: string[]): void {
  for (const path of paths) {
    const entry = gitBuffer(projectDir, ["ls-tree", "-z", tree, "--", path], 64_000);
    if (entry.status !== 0 || entry.error) throw new Error(`cannot inspect hook-produced tree entry: ${path}`);
    if (!entry.stdout.length) continue; // an exact-path deletion has no blob
    const size = git(projectDir, ["cat-file", "-s", `${tree}:${path}`]);
    if (size.status !== 0 || !/^\d+\n?$/.test(size.stdout)) throw new Error(`cannot inspect hook-produced tree blob: ${path}`);
    if (Number(size.stdout.trim()) > 2_000_000) throw new Error(`persistence manifest file is too large to inspect after hooks: ${path}`);
    const blob = gitBuffer(projectDir, ["cat-file", "blob", `${tree}:${path}`], 2_100_000);
    if (blob.status !== 0 || blob.error) throw new Error(`cannot read hook-produced tree blob for secret inspection: ${path}`);
    const bytes = blob.stdout;
    const secret = detectHighConfidenceSecret(bytes);
    if (secret) throw new Error(`high-confidence ${secret} detected in hook-produced persistence tree: ${path}`);
  }
}
function validatedCommitMessage(messagePath: string, receipt: string, approval: "pass" | "override"): string {
  const bytes = readFileSync(messagePath);
  if (bytes.length > 2_000_000) throw new Error("hook-updated persistence commit message is too large to inspect");
  const secret = detectHighConfidenceSecret(bytes);
  if (secret) throw new Error(`high-confidence ${secret} detected in hook-updated persistence commit message`);
  const text = bytes.toString("utf8");
  const receiptTrailer = `AI-DLC-Receipt: ${receipt}`;
  const approvalTrailer = `AI-DLC-Approval: ${approval}`;
  if (text.split("\n").filter((line) => line === receiptTrailer).length !== 1 || text.split("\n").filter((line) => line === approvalTrailer).length !== 1) {
    throw new Error("hook removed or changed a required AI-DLC persistence trailer");
  }
  return text;
}
function runHook(projectDir: string, indexPath: string, name: string, args: string[] = []): void {
  const result = gitWithEnv(projectDir, ["hook", "run", "--ignore-missing", name, "--", ...args], { GIT_INDEX_FILE: indexPath });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${name} hook failed`).trim());
}
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
    const isolatedIndex = join(paths.root, `checkpoint-index-${process.pid}`);
    rmSync(isolatedIndex, { force: true });
    const indexEnv = { GIT_INDEX_FILE: isolatedIndex };
    const seed = gitWithEnv(projectDir, ["read-tree", head], indexEnv);
    if (seed.status !== 0) throw new Error((seed.stderr || seed.stdout).trim());
    const add = gitWithEnv(projectDir, ["add", "--", ...manifest], indexEnv);
    if (add.status !== 0) throw new Error((add.stderr || add.stdout).trim());
    const cached = stagedWithIndex(projectDir, isolatedIndex);
    if (!cached.length) { rmSync(isolatedIndex, { force: true }); return { status: "deferred", reason: "manifest has no changes" }; }
    const message = `chore(aidlc): persist approved transition ${crossing.events.map((e) => e.stage ?? e.event).join(", ")}\n\nAI-DLC-Receipt: ${crossing.receipt}\nAI-DLC-Approval: ${crossing.approvalOutcome ?? "pass"}`;
    const messagePath = join(paths.root, `checkpoint-message-${process.pid}`);
    try {
      writeFileSync(messagePath, `${message}\n`, { mode: 0o600 });
      runHook(projectDir, isolatedIndex, "pre-commit");
      runHook(projectDir, isolatedIndex, "prepare-commit-msg", [messagePath, "message"]);
      runHook(projectDir, isolatedIndex, "commit-msg", [messagePath]);
      const hookPaths = stagedWithIndex(projectDir, isolatedIndex);
      if (hookPaths.join("\0") !== cached.join("\0")) throw new Error("hook changed the exact persistence path set; commit suppressed");
      const tree = gitWithEnv(projectDir, ["write-tree"], indexEnv);
      if (tree.status !== 0) throw new Error((tree.stderr || tree.stdout).trim());
      const treeOid = tree.stdout.trim();
      scanTreeManifest(projectDir, treeOid, cached);
      const finalMessage = validatedCommitMessage(messagePath, crossing.receipt, crossing.approvalOutcome ?? "pass");
      const committed = gitWithEnv(projectDir, ["commit-tree", treeOid, "-p", head, "-F", "-"], indexEnv, finalMessage);
      if (committed.status !== 0) throw new Error((committed.stderr || committed.stdout || "git commit-tree failed").trim());
      const oid = committed.stdout.trim();
      if (out(projectDir, ["symbolic-ref", "--short", "HEAD"]) !== branch || out(projectDir, ["rev-parse", `refs/heads/${branch}`]) !== head) {
        throw new Error("checked-out branch or checkpoint parent changed before ref update");
      }
      const updated = git(projectDir, ["update-ref", `refs/heads/${branch}`, oid, head]);
      if (updated.status !== 0) throw new Error("checkpoint parent changed unexpectedly; commit was not attached to the branch");
      if (out(projectDir, ["symbolic-ref", "--short", "HEAD"]) !== branch || out(projectDir, ["rev-parse", "HEAD"]) !== oid) {
        throw new Error("checked-out branch changed during checkpoint; primary index was not refreshed");
      }
      const refresh = git(projectDir, ["reset", "--mixed", oid, "--", ...cached]);
      if (refresh.status !== 0) throw new Error((refresh.stderr || refresh.stdout || "cannot refresh persistence paths in the primary index").trim());
      runHook(projectDir, isolatedIndex, "post-commit");
      if (staged(projectDir).length) throw new Error("checkpoint postcondition failed; push suppressed");
      ledger[crossing.receipt] = { commitOid: oid }; atomicJson(paths.ledger, ledger);
      if (!config.push) return { status: "committed", commitOid: oid };
      const refspec = `${oid}:refs/heads/${branch}`;
      const next: Pending = { version: 1, receipt: crossing.receipt, commitOid: oid, remote: config.remote, branch, refspec, state: "pending", manifestHash: sha(manifest.join("\0")) };
      atomicJson(paths.pending, next);
      return pushPending(projectDir, paths.pending, next);
    } finally { rmSync(isolatedIndex, { force: true }); rmSync(messagePath, { force: true }); }
  } finally { closeSync(lock); rmSync(paths.lock, { force: true }); }
}
