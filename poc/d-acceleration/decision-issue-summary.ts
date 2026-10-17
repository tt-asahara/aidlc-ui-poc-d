import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { latestPersonTurn } from "../../core/tools/aidlc-lib.ts";
import { resolveDAiApproval, resolveDDecisionIssueSummary } from "./d-config.ts";
import { ghAuthPreflight, githubHostFromRepository, type GhAuthResult } from "./gh-host.ts";

export type DecisionIssueSummaryConfig = { enabled: boolean; repository?: string; send: boolean; maxRetries: number };
export type GhResult = { status: number; stdout: string; stderr?: string };
export type GhAdapter = { run(args: readonly string[]): Promise<GhResult> };
export type PublicationPermissionVerifier = { verify(input: { projectDir: string; repository: string; intent: string; payloadSha256: string }): Promise<{ authorized: boolean; receipt?: Record<string, unknown>; reason?: string }> };
export type DecisionIssueSummaryInput = {
  projectDir: string;
  intentDir: string;
  decisionsFile: string;
  config: DecisionIssueSummaryConfig;
  gh?: GhAdapter;
  stateDir?: string;
  /** gh login check for the repository's exact host; runs after permission, before any GitHub call. */
  ghAuth?: (host: string) => Promise<GhAuthResult>;
};

type Decision = { schemaVersion: 1; decisionId: string; stage: string; outcome: "approve" | "block"; reason: string; evidence: Array<{ path: string; sha256: string }>; uncertainties: string[] };
type Binding = { version: 1; key: string; repository: string; intent: string; state: "pending" | "bound"; receipt: string; issueNumber?: number };

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function confinedFile(project: string, input: string): string {
  const requested = resolve(project, input);
  if (!existsSync(requested)) throw new Error("decisions file must exist inside project");
  const stat = lstatSync(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("decisions file must be a regular non-symlink file");
  const actual = realpathSync(requested);
  if (!inside(project, actual)) throw new Error("decisions file must exist inside project");
  if (stat.size > 1_048_576) throw new Error("decisions file exceeds 1048576 bytes");
  return actual;
}

function activeIntent(project: string): string {
  const aidlc = join(project, "aidlc");
  const space = existsSync(join(aidlc, "active-space")) ? readFileSync(join(aidlc, "active-space"), "utf8").trim() : "default";
  if (!/^[A-Za-z0-9._-]+$/.test(space)) throw new Error("active-space is invalid");
  const intents = join(aidlc, "spaces", space, "intents");
  if (!existsSync(join(intents, "active-intent"))) throw new Error("active-intent pointer is required");
  const name = readFileSync(join(intents, "active-intent"), "utf8").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("active-intent is invalid");
  const resolved = realpathSync(join(intents, name));
  if (!inside(project, resolved) || !existsSync(join(resolved, "aidlc-state.md"))) throw new Error("active Intent is invalid");
  return resolved;
}

/** `[HOST/]owner/name`; validated here in D (core/ stays upstream). */
export const DECISION_SUMMARY_REPOSITORY = /^(?:[A-Za-z0-9.-]+\.[A-Za-z0-9.-]+\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Publication needs the person's exact permission words as the latest
 * host-recorded human turn. The turn is read through the upstream engine's own
 * read-only `latestPersonTurn` (the record-human-turn hook writes it); D never
 * writes engine state or audit and never treats its own text as the person's.
 */
async function verifyPublicationPermission(input: { projectDir: string; repository: string; intent: string; payloadSha256: string }): Promise<{ authorized: boolean; receipt?: Record<string, unknown>; reason?: string }> {
  if (!DECISION_SUMMARY_REPOSITORY.test(input.repository) || !/^[0-9a-f]{64}$/.test(input.payloadSha256)) return { authorized: false, reason: "Usage: --repository [HOST/]owner/name --intent RELATIVE_ACTIVE_INTENT --payload-sha256 SHA256" };
  const project = realpathSync(input.projectDir);
  const expectedIntent = relative(project, activeIntent(project)).split(sep).join("/");
  if (input.intent !== expectedIntent) return { authorized: false, reason: "Decision summary permission does not target the active Intent" };
  const expectedWords = `AI-DLC authorize-decision-summary --repository ${input.repository} --intent ${input.intent} --payload-sha256 ${input.payloadSha256}`;
  const latestTurn = latestPersonTurn(project);
  if (!latestTurn || latestTurn.words !== expectedWords) return { authorized: false, reason: "Decision summary publication lacks an exact latest host-recorded human permission" };
  return { authorized: true, receipt: { authorized: true, schemaVersion: 1, repository: input.repository, intent: input.intent, payloadSha256: input.payloadSha256, humanTurnAt: latestTurn.at, userMessageSha256: createHash("sha256").update(expectedWords).digest("hex") } };
}

function decisions(path: string, project: string): Decision[] {
  const rows = readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`invalid decision JSONL at line ${index + 1}`); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid decision at line ${index + 1}`);
    const row = value as Record<string, unknown>;
    if (row.schemaVersion !== 1 || typeof row.decisionId !== "string" || !/^[0-9a-f]{64}$/.test(row.decisionId) || typeof row.stage !== "string" || !row.stage.trim() || !["approve", "block"].includes(String(row.outcome)) || typeof row.reason !== "string" || !row.reason.trim() || !Array.isArray(row.evidence) || !Array.isArray(row.uncertainties) || !row.uncertainties.every((item) => typeof item === "string")) throw new Error(`invalid versioned decision at line ${index + 1}`);
    const evidence = row.evidence.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`invalid decision evidence at line ${index + 1}`);
      const value = item as Record<string, unknown>;
      if (typeof value.path !== "string" || !value.path.trim() || isAbsolute(value.path) || !inside(project, resolve(project, value.path)) || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)) throw new Error(`invalid decision evidence at line ${index + 1}`);
      return { path: value.path, sha256: value.sha256 };
    });
    return { schemaVersion: 1, decisionId: row.decisionId, stage: row.stage.trim(), outcome: row.outcome as "approve" | "block", reason: row.reason.trim(), evidence, uncertainties: row.uncertainties as string[] } satisfies Decision;
  });
  return rows;
}

const SECRET = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b|(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]{8,})/i;
function rejectSecrets(value: string): void {
  if (SECRET.test(value)) throw new Error("decision summary contains a possible secret");
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

function parseIssueNumber(stdout: string): number | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (Array.isArray(parsed) && parsed.length === 1 && Number.isSafeInteger((parsed[0] as Record<string, unknown>)?.number)) return Number((parsed[0] as Record<string, unknown>).number);
  } catch { /* gh issue create normally returns a URL */ }
  const match = stdout.match(/\/issues\/(\d+)(?:\s|$)/);
  return match ? Number(match[1]) : undefined;
}

function issueHasMarker(stdout: string, marker: string): boolean {
  try { return String((JSON.parse(stdout) as Record<string, unknown>).body ?? "").includes(`<!-- ${marker} -->`); } catch { return false; }
}

async function retry(adapter: GhAdapter, args: readonly string[], maxRetries: number): Promise<GhResult> {
  let result: GhResult = { status: 1, stdout: "", stderr: "not attempted" };
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    result = await adapter.run(args);
    if (result.status === 0) return result;
  }
  return result;
}

async function runDecisionIssueSummaryInternal(input: DecisionIssueSummaryInput, permissionVerifier: typeof verifyPublicationPermission): Promise<Record<string, unknown>> {
  if (!input.config.enabled) return { status: "stopped", reason: "disabled" };
  const project = realpathSync(resolve(input.projectDir));
  const intent = realpathSync(resolve(input.intentDir));
  if (!inside(project, intent)) throw new Error("intent directory escapes project");
  if (intent !== activeIntent(project)) throw new Error("intent directory must be the active Intent");
  const repository = input.config.repository?.trim();
  if (!repository) return { status: "stopped", reason: "repository-required" };
  if (!DECISION_SUMMARY_REPOSITORY.test(repository)) throw new Error("repository must be [HOST/]owner/name");
  const host = githubHostFromRepository(repository);
  if (!Number.isSafeInteger(input.config.maxRetries) || input.config.maxRetries < 0 || input.config.maxRetries > 10) throw new Error("maxRetries must be an integer from 0 to 10");

  const intentRelative = relative(project, intent);
  const key = createHash("sha256").update(`decision-issue-summary\0${repository}\0${intentRelative}`).digest("hex");
  const marker = `aidlc-decision-summary:${key}`;
  const decisionFile = confinedFile(project, input.decisionsFile);
  const canonicalDecisionFile = resolve(intent, resolveDAiApproval(project).decisionRecordPath);
  if (decisionFile !== canonicalDecisionFile) throw new Error("decisions file must be the configured canonical Intent ledger");
  const selected = decisions(decisionFile, project);
  const lines = selected.map((row) => {
    const link = row.evidence[0]?.path ? ` ([source](${encodeURI(row.evidence[0].path)}))` : "";
    const unresolved = row.outcome === "block" || row.uncertainties.length > 0;
    return `- **${row.decisionId.slice(0, 12)}** · ${row.stage} · ${row.outcome}: ${row.reason}${link}${unresolved ? " _(unresolved)_" : ""}`;
  });
  const title = `AI-DLC decisions: ${intentRelative}`;
  const body = [`<!-- ${marker} -->`, `# Decision summary`, "", ...(!lines.length ? ["No important decisions recorded."] : lines), "", "Unresolved items above remain in this one intent summary; no separate Issues are created."].join("\n");
  rejectSecrets(`${title}\n${body}`);
  const payload = { key, repository, intent: intentRelative, title, body };
  const payloadSha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if (!input.config.send) return { status: "generated", published: false, payload };
  const permission = await permissionVerifier({ projectDir: project, repository, intent: intentRelative, payloadSha256 });
  if (!permission.authorized) return { status: "stopped", reason: permission.reason ?? "publish-authorization-required", payload };
  if (!input.gh) throw new Error("GitHub adapter is required when send is enabled");
  if (input.ghAuth) {
    const auth = await input.ghAuth(host);
    if (!auth.ok) return { status: "stopped", reason: auth.reason, host: auth.host, nextStep: auth.nextStep, detail: auth.detail, payload };
  }

  const stateRoot = resolve(project, input.stateDir ?? ".aidlc-engine/d-decision-issue-summary");
  if (!inside(project, stateRoot)) throw new Error("state directory escapes project");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  if (lstatSync(stateRoot).isSymbolicLink() || !inside(project, realpathSync(stateRoot))) throw new Error("state directory must be a real directory inside project");
  const lockPath = join(stateRoot, `${key}.lock`);
  let lock: number;
  try { lock = openSync(lockPath, "wx", 0o600); } catch { return { status: "stopped", reason: "publish-busy", payload }; }
  try {
  const bindingPath = join(stateRoot, `${key}.json`);
  let binding: Binding | undefined;
  if (existsSync(bindingPath)) {
    binding = JSON.parse(readFileSync(bindingPath, "utf8")) as Binding;
    if (binding.version !== 1 || binding.key !== key || binding.repository !== repository || binding.intent !== intentRelative) throw new Error("decision Issue binding is corrupt or mismatched");
  }

  if (binding?.state === "pending") {
    const found = await retry(input.gh, ["issue", "list", "--repo", repository, "--state", "all", "--search", marker, "--json", "number", "--limit", "2"], input.config.maxRetries);
    if (found.status !== 0) return { status: "stopped", reason: "reconcile-failed", payload };
    const number = parseIssueNumber(found.stdout);
    if (!number) return { status: "stopped", reason: "pending-receipt-unresolved", payload };
    binding = { ...binding, state: "bound", issueNumber: number };
    atomicJson(bindingPath, binding);
  }

  if (binding?.state === "bound" && binding.issueNumber) {
    const viewed = await retry(input.gh, ["issue", "view", String(binding.issueNumber), "--repo", repository, "--json", "body"], input.config.maxRetries);
    if (viewed.status !== 0 || !issueHasMarker(viewed.stdout, marker)) return { status: "stopped", reason: "bound-issue-marker-mismatch", issueNumber: binding.issueNumber, payload };
    const edited = await retry(input.gh, ["issue", "edit", String(binding.issueNumber), "--repo", repository, "--title", title, "--body", body], input.config.maxRetries);
    return edited.status === 0 ? { status: "published", operation: "updated", issueNumber: binding.issueNumber, payload } : { status: "stopped", reason: "update-failed", issueNumber: binding.issueNumber, payload };
  }

  binding = { version: 1, key, repository, intent: intentRelative, state: "pending", receipt: randomUUID() };
  atomicJson(bindingPath, binding);
  const created = await input.gh.run(["issue", "create", "--repo", repository, "--title", title, "--body", body]);
  if (created.status !== 0) return { status: "stopped", reason: "create-result-ambiguous", payload };
  const issueNumber = parseIssueNumber(created.stdout);
  if (!issueNumber) return { status: "stopped", reason: "create-result-ambiguous", payload };
  atomicJson(bindingPath, { ...binding, state: "bound", issueNumber });
  return { status: "published", operation: "created", issueNumber, payload };
  } finally {
    closeSync(lock);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}

export async function runDecisionIssueSummary(input: DecisionIssueSummaryInput): Promise<Record<string, unknown>> {
  return runDecisionIssueSummaryInternal(input, verifyPublicationPermission);
}

/** Test seam kept out of the production input contract and CLI path. */
if (import.meta.main) {
  try {
    const argv = process.argv.slice(2), command = argv[0];
    const one = (flag: string) => { const indexes = argv.flatMap((value, index) => value === flag ? [index] : []); if (indexes.length !== 1 || !argv[indexes[0] + 1]) throw new Error(`${flag} is required exactly once`); return argv[indexes[0] + 1]; };
    const projectDir = one("--project-dir"), intentDir = one("--intent-dir"), decisionsFile = one("--decisions-file");
    if (!isAbsolute(projectDir) || !isAbsolute(intentDir)) throw new Error("--project-dir and --intent-dir must be absolute");
    if (command !== "generate" && command !== "publish") throw new Error("mode must be generate or publish");
    const resolvedConfig = resolveDDecisionIssueSummary(projectDir);
    const executable = command === "publish" && resolvedConfig.send
      ? pinnedExecutable(projectDir, process.env.AIDLC_GH_EXECUTABLE_PATH, process.env.AIDLC_GH_EXECUTABLE_SHA256)
      : undefined;
    // GH_HOST is pinned to the repository host so a host-less owner/name can
    // never be silently resolved against an inherited, different gh host.
    const ghHost = resolvedConfig.repository ? githubHostFromRepository(resolvedConfig.repository) : undefined;
    const ghAdapter: GhAdapter | undefined = executable ? { run: async (args) => { const child = spawnSync(executable, [...args], { cwd: projectDir, encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024, env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", ...(ghHost ? { GH_HOST: ghHost } : {}) } }); return { status: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? child.error?.message }; } } : undefined;
    const result = await runDecisionIssueSummary({
      projectDir, intentDir, decisionsFile,
      config: command === "generate" ? { ...resolvedConfig, send: false } : resolvedConfig,
      gh: ghAdapter,
      ghAuth: ghAdapter ? (host) => ghAuthPreflight(host, (args) => ghAdapter.run(args).then((r) => ({ status: r.status, stdout: r.stdout, stderr: r.stderr ?? "" }))) : undefined,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.status === "stopped" ? 2 : 0);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "stopped", reason: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    process.exit(2);
  }
}

function pinnedExecutable(projectDir: string, requested: string | undefined, expectedSha256: string | undefined): string {
  if (!requested || !expectedSha256) throw new Error("host-pinned gh executable path and sha256 are required");
  if (basename(requested) !== "gh") throw new Error("host-pinned gh executable entry must be named gh");
  const actual = realpathSync(requested);
  const metadata = lstatSync(actual);
  const bytes = readFileSync(actual);
  if (!metadata.isFile() || inside(realpathSync(projectDir), actual)) throw new Error("host-pinned gh executable must be a file outside the project");
  if (!isNativeExecutable(bytes)) throw new Error("host-pinned gh executable must be a native binary, not a script");
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw new Error("host-pinned gh executable digest mismatch");
  return actual;
}

function isNativeExecutable(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  const magic = bytes.subarray(0, 4).toString("hex");
  return magic === "7f454c46" || ["cffaedfe", "feedfacf", "cafebabe", "bebafeca"].includes(magic) || bytes.subarray(0, 2).toString("ascii") === "MZ";
}
