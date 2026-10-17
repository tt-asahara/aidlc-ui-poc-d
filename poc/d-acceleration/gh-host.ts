/**
 * GitHub host detection and gh CLI authentication preflight.
 *
 * Every D action that reaches GitHub through `gh` (issue autopilot reads,
 * decision-summary publication) first resolves the exact host the target
 * repository lives on (github.com or a GitHub Enterprise host such as
 * github.kddi.com) and asks `gh auth status --hostname <host>` with fixed argv.
 * A missing login for THAT host fails closed with one exact next step instead
 * of a later opaque `gh issue ...` error. A login for a different host never
 * satisfies the check (the dogfood failure: gh logged into GHE only while the
 * repository was on github.com).
 */
import { spawnSync } from "node:child_process";

export type GhAuthResult =
  | { ok: true; host: string }
  | { ok: false; host: string; reason: "gh-auth-required" | "gh-unavailable"; nextStep: string; detail: string };

export type GhAuthRunner = (argv: readonly string[]) => Promise<{ status: number; stdout: string; stderr?: string }>;

const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?$/;

/** Validates and lowercases a bare host name; throws on anything else. */
export function normalizeGitHubHost(host: string): string {
  const value = host.trim().toLowerCase();
  if (!HOST.test(value)) throw new Error(`invalid GitHub host: ${JSON.stringify(host)}`);
  return value;
}

/**
 * Host of a git remote URL: https://host/o/r(.git), ssh://git@host[:port]/o/r,
 * git@host:o/r (scp form). Returns null for local paths and file:// remotes,
 * which have no GitHub host.
 */
export function githubHostFromRemote(remote: string): string | null {
  const raw = remote.trim();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let url: URL;
    try { url = new URL(raw); } catch { return null; }
    if (url.protocol === "file:" || !url.hostname) return null;
    return normalizeGitHubHost(url.hostname);
  }
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)/.exec(raw);
  if (scp && scp[1].includes(".")) return normalizeGitHubHost(scp[1]);
  return null;
}

/** Host of `[HOST/]OWNER/REPO`; host-less names mean github.com (gh's default). */
export function githubHostFromRepository(repository: string): string {
  const parts = repository.trim().split("/").filter(Boolean);
  if (parts.length === 3) return normalizeGitHubHost(parts[0]);
  if (parts.length === 2) return "github.com";
  throw new Error("GitHub repository must identify [HOST/]OWNER/REPO");
}

/** Host of `remote.<name>.url` in projectDir, or null when unset / not a GitHub-style URL. */
export function originGitHubHost(projectDir: string, remote = "origin"): string | null {
  const result = spawnSync("git", ["config", "--get", `remote.${remote}.url`], { cwd: projectDir, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return result.status === 0 ? githubHostFromRemote(result.stdout) : null;
}

export const ghLoginNextStep = (host: string) => `gh auth login --hostname ${host}`;

/** Fixed-argv `gh auth status --hostname <host>`; fails closed with the exact login command. */
export async function ghAuthPreflight(host: string, run: GhAuthRunner): Promise<GhAuthResult> {
  const exact = normalizeGitHubHost(host);
  let result: { status: number; stdout: string; stderr?: string };
  try {
    result = await run(["auth", "status", "--hostname", exact]);
  } catch (error) {
    return { ok: false, host: exact, reason: "gh-unavailable", nextStep: "install the GitHub CLI (gh) and run " + ghLoginNextStep(exact), detail: String(error instanceof Error ? error.message : error) };
  }
  if (result.status === 0) return { ok: true, host: exact };
  const detail = `${result.stderr ?? ""}${result.stdout}`.trim().split(/\r?\n/).slice(0, 3).join(" | ").slice(0, 400);
  return { ok: false, host: exact, reason: "gh-auth-required", nextStep: ghLoginNextStep(exact), detail };
}

/** Synchronous process runner for `gh` with no shell. */
export function spawnGhRunner(executable: string, cwd: string, env: NodeJS.ProcessEnv = process.env): GhAuthRunner {
  return async (argv) => {
    const child = spawnSync(executable, [...argv], { cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024, env, shell: false });
    if (child.error) throw child.error;
    return { status: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
  };
}
