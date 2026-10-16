/** Production adapters for the default-off issue autopilot. */
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AssumptionLedger, ClaimStore, Issue, IssueSource, IssueSummary } from "./issue-autopilot.ts";

export type CommandResult = { status: number; stdout: string; stderr: string };
export type CommandRunner = (executable: string, argv: readonly string[], options: { cwd: string }) => Promise<CommandResult>;

export const spawnCommand: CommandRunner = (executable, argv, options) =>
  new Promise((resolveResult, reject) => {
    // Deliberately no shell: issue-controlled text can never become command syntax.
    const child = spawn(executable, [...argv], { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolveResult({ status: code ?? 1, stdout, stderr }));
  });

type GhLabel = string | { name?: unknown };
type GhIssue = { number?: unknown; title?: unknown; body?: unknown; labels?: unknown; state?: unknown };

function labels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((label: GhLabel) =>
    typeof label === "string" ? [label] : label && typeof label.name === "string" ? [label.name] : [],
  );
}

function parseIssue(value: GhIssue): Issue | null {
  if (!Number.isSafeInteger(value.number) || (value.number as number) <= 0 || typeof value.title !== "string") return null;
  if (value.state !== "OPEN" && value.state !== "CLOSED" && value.state !== "open" && value.state !== "closed") return null;
  return {
    number: value.number as number,
    title: value.title,
    body: typeof value.body === "string" ? value.body : "",
    labels: labels(value.labels),
    state: String(value.state).toLowerCase() as "open" | "closed",
  };
}

export function createGhIssueSource(options: {
  cwd: string;
  repository?: string;
  executable?: string;
  runner?: CommandRunner;
}): IssueSource {
  const runner = options.runner ?? spawnCommand;
  const executable = options.executable ?? "gh";
  const repoArgs = options.repository ? ["--repo", options.repository] : [];
  const run = async (argv: string[]): Promise<unknown> => {
    const result = await runner(executable, argv, { cwd: options.cwd });
    if (result.status !== 0) throw new Error(`gh issue read failed (${result.status}): ${result.stderr.trim()}`);
    return JSON.parse(result.stdout);
  };
  return {
    async get(number) {
      if (!Number.isSafeInteger(number) || number <= 0) throw new Error("issue number must be a positive integer");
      const value = (await run(["issue", "view", String(number), ...repoArgs, "--json", "number,title,body,labels,state"])) as GhIssue;
      return parseIssue(value);
    },
    async list() {
      const value = await run(["issue", "list", ...repoArgs, "--state", "open", "--limit", "100", "--json", "number,title,labels,state"]);
      if (!Array.isArray(value)) throw new Error("gh issue list returned a non-array JSON value");
      return value.flatMap((entry: GhIssue): IssueSummary[] => {
        const issue = parseIssue({ ...entry, body: "" });
        return issue ? [{ number: issue.number, title: issue.title, labels: issue.labels }] : [];
      });
    },
  };
}

type ClaimRecord = { issueNumber: number; owner: string; acquiredAt: number; expiresAt: number };

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function tryCreate(path: string, contents: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeFileSync(fd, contents, "utf8");
  } finally {
    closeSync(fd);
  }
  return true;
}

export function createFileClaimStore(options: {
  directory: string;
  leaseMs: number;
  clock?: () => number;
}): ClaimStore {
  if (!Number.isSafeInteger(options.leaseMs) || options.leaseMs <= 0) throw new Error("claim leaseMs must be a positive integer");
  const now = options.clock ?? Date.now;
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const pathFor = (issueNumber: number) => join(options.directory, `issue-${issueNumber}.json`);
  return {
    async acquire(issueNumber, owner) {
      if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0 || !owner.trim()) throw new Error("valid issue number and owner are required");
      const path = pathFor(issueNumber);
      const create = () => {
        const acquiredAt = now();
        return tryCreate(path, `${JSON.stringify({ issueNumber, owner, acquiredAt, expiresAt: acquiredAt + options.leaseMs })}\n`);
      };
      if (create()) return "acquired";

      // Serialize stale reclamation. Fresh contenders never remove a live claim.
      const recovery = `${path}.recovery`;
      if (!tryCreate(recovery, `${owner}\n`)) return "busy";
      try {
        const current = readJson<ClaimRecord>(path);
        if (!current || current.issueNumber !== issueNumber || current.expiresAt > now()) return "busy";
        try {
          unlinkSync(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        return create() ? "acquired" : "busy";
      } finally {
        try { unlinkSync(recovery); } catch { /* another failure remains recoverable */ }
      }
    },
    async release(issueNumber, owner) {
      const path = pathFor(issueNumber);
      const current = readJson<ClaimRecord>(path);
      if (!current || current.issueNumber !== issueNumber || current.owner !== owner) return;
      // Recovery lock prevents release/reclaim from deleting a successor claim.
      const recovery = `${path}.recovery`;
      if (!tryCreate(recovery, `${owner}\n`)) return;
      try {
        const verified = readJson<ClaimRecord>(path);
        if (verified?.issueNumber === issueNumber && verified.owner === owner && verified.acquiredAt === current.acquiredAt) {
          try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
      } finally {
        try { unlinkSync(recovery); } catch { /* best effort */ }
      }
    },
  };
}

function gitDirectory(projectDir: string): { path: string; git: boolean } {
  const dotGit = join(projectDir, ".git");
  if (!existsSync(dotGit)) return { path: join(projectDir, ".aidlc"), git: false };
  try {
    const marker = readFileSync(dotGit, "utf8").trim();
    const match = /^gitdir:\s*(.+)$/i.exec(marker);
    if (match) return { path: isAbsolute(match[1]) ? match[1] : resolve(projectDir, match[1]), git: true };
  } catch {
    // A directory is the normal repository form.
  }
  return { path: dotGit, git: true };
}

export function issueAutopilotRuntimePaths(projectDir: string, sessionDirectory?: string): {
  claims: string;
  assumptions: string;
} {
  const storage = gitDirectory(resolve(projectDir));
  const root = sessionDirectory
    ? resolve(sessionDirectory)
    : join(storage.path, ...(storage.git ? ["aidlc", "issue-autopilot"] : ["issue-autopilot"]));
  return { claims: join(root, "claims"), assumptions: join(root, "assumptions.jsonl") };
}

export function createFileAssumptionLedger(path: string, options: { clock?: () => number } = {}): AssumptionLedger {
  const now = options.clock ?? Date.now;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  return {
    async append(entry) {
      const timestamp = now();
      const lock = `${path}.lock`;
      if (!tryCreate(lock, "locked\n")) throw new Error("assumption ledger is busy");
      const temporary = `${path}.tmp-${process.pid}-${timestamp}`;
      try {
        const prior = existsSync(path) ? readFileSync(path, "utf8") : "";
        const record = JSON.stringify({ recordedAt: timestamp, ...entry });
        writeFileSync(temporary, `${prior}${record}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        renameSync(temporary, path);
      } finally {
        try { unlinkSync(temporary); } catch { /* renamed or never created */ }
        try { unlinkSync(lock); } catch { /* best effort */ }
      }
    },
  };
}
