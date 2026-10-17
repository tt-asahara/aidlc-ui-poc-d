import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveDDecisionIssueSummary } from "./d-config.ts";

export type DecisionIssueSummaryConfig = { enabled: boolean; repository?: string; send: boolean; maxRetries: number };
export type GhResult = { status: number; stdout: string; stderr?: string };
export type GhAdapter = { run(args: readonly string[]): Promise<GhResult> };
export type DecisionIssueSummaryInput = {
  projectDir: string;
  intentDir: string;
  decisionsFile: string;
  config: DecisionIssueSummaryConfig;
  publishAuthorized?: boolean;
  gh?: GhAdapter;
  stateDir?: string;
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

async function retry(adapter: GhAdapter, args: readonly string[], maxRetries: number): Promise<GhResult> {
  let result: GhResult = { status: 1, stdout: "", stderr: "not attempted" };
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    result = await adapter.run(args);
    if (result.status === 0) return result;
  }
  return result;
}

export async function runDecisionIssueSummary(input: DecisionIssueSummaryInput): Promise<Record<string, unknown>> {
  if (!input.config.enabled) return { status: "stopped", reason: "disabled" };
  const project = realpathSync(resolve(input.projectDir));
  const intent = realpathSync(resolve(input.intentDir));
  if (!inside(project, intent)) throw new Error("intent directory escapes project");
  const repository = input.config.repository?.trim();
  if (!repository) return { status: "stopped", reason: "repository-required" };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("repository must be owner/name");
  if (!Number.isSafeInteger(input.config.maxRetries) || input.config.maxRetries < 0 || input.config.maxRetries > 10) throw new Error("maxRetries must be an integer from 0 to 10");

  const intentRelative = relative(project, intent);
  const key = createHash("sha256").update(`decision-issue-summary\0${repository}\0${intentRelative}`).digest("hex");
  const marker = `aidlc-decision-summary:${key}`;
  const selected = decisions(confinedFile(project, input.decisionsFile), project);
  const lines = selected.map((row) => {
    const link = row.evidence[0]?.path ? ` ([source](${encodeURI(row.evidence[0].path)}))` : "";
    const unresolved = row.outcome === "block" || row.uncertainties.length > 0;
    return `- **${row.decisionId.slice(0, 12)}** · ${row.stage} · ${row.outcome}: ${row.reason}${link}${unresolved ? " _(unresolved)_" : ""}`;
  });
  const title = `AI-DLC decisions: ${intentRelative}`;
  const body = [`<!-- ${marker} -->`, `# Decision summary`, "", ...(!lines.length ? ["No important decisions recorded."] : lines), "", "Unresolved items above remain in this one intent summary; no separate Issues are created."].join("\n");
  rejectSecrets(`${title}\n${body}`);
  const payload = { key, repository, intent: intentRelative, title, body };
  if (!input.config.send) return { status: "generated", published: false, payload };
  if (!input.publishAuthorized) return { status: "stopped", reason: "publish-authorization-required", payload };
  if (!input.gh) throw new Error("GitHub adapter is required when send is enabled");

  const stateRoot = resolve(project, input.stateDir ?? ".aidlc-engine/d-decision-issue-summary");
  if (!inside(project, stateRoot)) throw new Error("state directory escapes project");
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
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2), command = argv[0];
    const one = (flag: string) => { const indexes = argv.flatMap((value, index) => value === flag ? [index] : []); if (indexes.length !== 1 || !argv[indexes[0] + 1]) throw new Error(`${flag} is required exactly once`); return argv[indexes[0] + 1]; };
    const projectDir = one("--project-dir"), intentDir = one("--intent-dir"), decisionsFile = one("--decisions-file");
    if (!isAbsolute(projectDir) || !isAbsolute(intentDir)) throw new Error("--project-dir and --intent-dir must be absolute");
    if (command !== "generate" && command !== "publish") throw new Error("mode must be generate or publish");
    if (command === "publish") throw new Error("CLI publication is disabled until a host-bound human permission receipt is implemented");
    const executable = argv.includes("--gh-executable") ? one("--gh-executable") : "gh";
    const result = await runDecisionIssueSummary({
      projectDir, intentDir, decisionsFile,
      config: resolveDDecisionIssueSummary(projectDir),
      publishAuthorized: false,
      gh: { run: async (args) => { const child = spawnSync(executable, [...args], { cwd: projectDir, encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024 }); return { status: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? child.error?.message }; } },
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.status === "stopped" ? 2 : 0);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "stopped", reason: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    process.exit(2);
  }
}
