// Repository-owner rule: `core/` stays byte-identical to upstream AI-DLC
// v2.11.2 (commit 10a9bc9d). D and the C UI plugin extend AI-DLC only through
// the supported extension surfaces (poc/, plugins, contributions, sensors,
// D-owned tools). This guard fails on any committed, staged, unstaged, or
// untracked difference under core/.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const UPSTREAM_CORE_COMMIT = "10a9bc9d";
const root = join(import.meta.dir, "..", "..", "..");
const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
const upstreamPresent = git("cat-file", "-e", `${UPSTREAM_CORE_COMMIT}^{commit}`).status === 0;

describe("core/ is pristine upstream AI-DLC v2.11.2", () => {
  if (!upstreamPresent) {
    // A shallow or foreign clone cannot prove the rule; say so instead of passing silently.
    console.warn(`core-pristine: upstream commit ${UPSTREAM_CORE_COMMIT} is absent from this clone; guard SKIPPED`);
  }
  test.skipIf(!upstreamPresent)("tracked core/ content equals the upstream tree (HEAD, index, and working tree)", () => {
    const committed = git("diff", "--quiet", UPSTREAM_CORE_COMMIT, "HEAD", "--", "core");
    expect(committed.status, git("diff", "--stat", UPSTREAM_CORE_COMMIT, "HEAD", "--", "core").stdout).toBe(0);
    const working = git("diff", "--quiet", UPSTREAM_CORE_COMMIT, "--", "core");
    expect(working.status, git("diff", "--stat", UPSTREAM_CORE_COMMIT, "--", "core").stdout).toBe(0);
    const staged = git("diff", "--cached", "--quiet", UPSTREAM_CORE_COMMIT, "--", "core");
    expect(staged.status).toBe(0);
  });
  test.skipIf(!upstreamPresent)("no untracked file exists under core/", () => {
    const untracked = git("ls-files", "--others", "--exclude-standard", "--", "core").stdout.trim();
    expect(untracked).toBe("");
  });
  // The projection collision guard itself is exercised on real trees in d-projection.test.ts.
  test("the Claude packager routes D through the guarded projection and ships no removed core settler", () => {
    const packager = readFileSync(join(root, "scripts", "package.ts"), "utf8");
    expect(packager).toContain("projectDAcceleration(treeRoot");
    expect(packager).not.toContain("aidlc-ai-answers.ts");
  });
});
