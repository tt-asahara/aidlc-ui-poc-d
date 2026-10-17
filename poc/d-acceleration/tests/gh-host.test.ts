import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ghAuthPreflight, githubHostFromRemote, githubHostFromRepository, originGitHubHost, spawnGhRunner } from "../gh-host.ts";

/** A fake gh that is logged in only to the hosts listed in FAKE_GH_HOSTS. */
function fakeGh(dir: string, loggedIn: string[]): string {
  const path = join(dir, "gh");
  writeFileSync(path, `#!/usr/bin/env bun
const args = process.argv.slice(2), hosts = ${JSON.stringify(loggedIn)};
if (args[0] === "auth" && args[1] === "status" && args[2] === "--hostname" && args.length === 4) {
  if (hosts.includes(args[3])) { console.log(args[3] + "\\n  ✓ Logged in to " + args[3]); process.exit(0); }
  console.error("You are not logged into any accounts on " + args[3]); process.exit(1);
}
console.error("unexpected argv " + JSON.stringify(args)); process.exit(2);
`);
  chmodSync(path, 0o755);
  return path;
}

describe("GitHub host detection", () => {
  test("parses https, ssh, scp, and GHE remotes; local remotes have no host", () => {
    expect(githubHostFromRemote("https://github.com/tt-asahara/aidlc-ui-poc-d.git")).toBe("github.com");
    expect(githubHostFromRemote("https://github.kddi.com/SystemManagement/aidlc-workflows-kddi")).toBe("github.kddi.com");
    expect(githubHostFromRemote("git@github.kddi.com:Org/repo.git")).toBe("github.kddi.com");
    expect(githubHostFromRemote("ssh://git@GitHub.com:22/o/r.git")).toBe("github.com");
    expect(githubHostFromRemote("/tmp/sandbox/remote.git")).toBeNull();
    expect(githubHostFromRemote("file:///tmp/sandbox/remote.git")).toBeNull();
    expect(githubHostFromRemote("")).toBeNull();
  });

  test("repository host defaults to github.com only when no host is named", () => {
    expect(githubHostFromRepository("owner/repo")).toBe("github.com");
    expect(githubHostFromRepository("github.kddi.com/owner/repo")).toBe("github.kddi.com");
    expect(() => githubHostFromRepository("a/b/c/d")).toThrow("[HOST/]OWNER/REPO");
    expect(() => githubHostFromRepository("bad host/o/r")).toThrow("invalid GitHub host");
  });

  test("reads the origin remote host from git config", () => {
    const root = mkdtempSync(join(tmpdir(), "gh-host-origin-"));
    spawnSync("git", ["init", "-q", root]);
    expect(originGitHubHost(root)).toBeNull();
    spawnSync("git", ["-C", root, "remote", "add", "origin", "git@github.kddi.com:Org/repo.git"]);
    expect(originGitHubHost(root)).toBe("github.kddi.com");
  }, 30_000);
});

describe("gh auth preflight", () => {
  test("GHE-only login fails closed for github.com with the exact login command (dogfood case)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-host-auth-"));
    const run = spawnGhRunner(fakeGh(dir, ["github.kddi.com"]), dir);
    expect(await ghAuthPreflight("github.kddi.com", run)).toEqual({ ok: true, host: "github.kddi.com" });
    const denied = await ghAuthPreflight("GitHub.com", run);
    expect(denied).toMatchObject({ ok: false, host: "github.com", reason: "gh-auth-required", nextStep: "gh auth login --hostname github.com" });
    expect(denied.ok ? "" : denied.detail).toContain("not logged into any accounts on github.com");
  }, 30_000);

  test("a missing gh executable is gh-unavailable, never success", async () => {
    const result = await ghAuthPreflight("github.com", spawnGhRunner("/nonexistent/gh", tmpdir()));
    expect(result).toMatchObject({ ok: false, reason: "gh-unavailable", host: "github.com" });
  });

  test("uses fixed argv and rejects host injection", async () => {
    const seen: string[][] = [];
    await ghAuthPreflight("github.com", async (argv) => { seen.push([...argv]); return { status: 0, stdout: "" }; });
    expect(seen).toEqual([["auth", "status", "--hostname", "github.com"]]);
    await expect(ghAuthPreflight("github.com --show-token", async () => ({ status: 0, stdout: "" }))).rejects.toThrow("invalid GitHub host");
  });
});
