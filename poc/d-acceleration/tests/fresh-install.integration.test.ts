// Clean-target install/update/parity against the real generated Claude package.
// Requires `bun scripts/package.ts claude` and the ui-poc plugin build
// (`bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/ui-poc claude`).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { install, manifest, parity, SetupStop, update } from "../fresh-install.ts";

const SRC = resolve(import.meta.dir, "..", "..", "..");
const TIMEOUT = 600_000;
let product = "";
const git = (...args: string[]) => {
  const result = spawnSync("git", ["-C", product, "-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};

beforeAll(() => {
  for (const required of ["dist/claude/.claude/tools/aidlc.ts", "poc/ui-poc/dist/claude/hooks/compose.ts"]) {
    if (!existsSync(join(SRC, required))) throw new Error(`build output missing: ${required}; run bun scripts/package.ts claude and the ui-poc plugin build`);
  }
  product = mkdtempSync(join(tmpdir(), "d-fresh-install-"));
  git("init", "-q", "-b", "main");
  writeFileSync(join(product, "README.md"), "existing product work\n");
  git("add", "-A"); git("commit", "-qm", "existing product");
});
afterAll(() => { if (product) rmSync(product, { recursive: true, force: true }); });

describe("clean-target D install, parity, and update", () => {
  test("installs through the documented path with byte parity resolved from PRODUCT", async () => {
    const result = await install(SRC, product) as Record<string, any>;
    expect(result.parity.ok).toBeTrue();
    expect(result.parity.outsideProduct).toEqual([]);
    expect(result.parity.resolvedModules).toBeGreaterThan(50);
    expect(result.preflight).toMatchObject({ uiBaseline: "C-composed", missing: [] });
    expect(result.gitignoreAdded).toBeTrue();
    expect(readFileSync(join(product, "README.md"), "utf8")).toBe("existing product work\n");
    // No machine-specific absolute path is required by the installed settings.
    expect(readFileSync(join(product, ".claude", "settings.json"), "utf8")).not.toContain(product);
    expect(readFileSync(join(product, ".claude", "settings.json"), "utf8")).not.toContain(SRC);
    // Every ordinary-/aidlc D command is pre-approved by the project allow list.
    const allow = JSON.parse(readFileSync(join(product, ".claude", "settings.json"), "utf8")).permissions.allow as string[];
    for (const script of ["generic-auto-cli.ts", "run.ts", "host-stage-boundary.ts"]) expect(allow).toContain(`Bash(bun .claude/tools/d-acceleration/${script} *)`);
    // The ui-poc stage-major+swarm proposal is composed in before Step 6, so the
    // agent reads it before the official Construction iteration choice.
    const delivery = readFileSync(join(product, ".claude", "aidlc-common", "stages", "inception", "delivery-planning.md"), "utf8");
    const at = (needle: string) => { const index = delivery.indexOf(needle); expect(index, needle).toBeGreaterThanOrEqual(0); return index; };
    const proposal = at("### UI application execution proposal (ui-poc)");
    expect(at("### Step 5: Phase Boundary Verification")).toBeLessThan(proposal);
    expect(proposal).toBeLessThan(at("### Step 6: Completion Handoff"));
    expect(at("### Step 6: Completion Handoff")).toBeLessThan(at("**Construction iteration.**"));
    expect(delivery.slice(proposal, at("**Construction iteration.**"))).not.toMatch(/^### Step [0-57-9]/m);
    git("add", "-A"); git("commit", "-qm", "install");
  }, TIMEOUT);

  test("a second install on an installed product stops instead of overwriting", async () => {
    appendFileSync(join(product, "README.md"), "dirty\n");
    await expect(install(SRC, product)).rejects.toBeInstanceOf(SetupStop);
    git("checkout", "--", "README.md");
  }, TIMEOUT);

  test("parity detects missing, extra, and changed runtime files", async () => {
    const runtime = join(product, ".claude", "tools", "d-acceleration");
    const original = readFileSync(join(runtime, "host-session.ts"));
    writeFileSync(join(runtime, "host-session.ts"), `${original}\n// drift\n`);
    // A leaf no other runtime module imports, so the module graph still builds.
    unlinkSync(join(runtime, "decision-issue-summary.ts"));
    writeFileSync(join(runtime, "stray.ts"), "export {};\n");
    appendFileSync(join(product, ".claude", "tools", "ui-poc-c-routing.cjs"), "\n// stale plugin copy\n");
    const report = await parity(SRC, product);
    expect(report.pluginPayload.changed).toEqual([".claude/tools/ui-poc-c-routing.cjs"]);
    expect(report.ok).toBeFalse();
    expect(report.dAccelerationTree).toMatchObject({ missing: ["decision-issue-summary.ts"], extra: ["stray.ts"], changed: ["host-session.ts"] });
    expect(report.changedFromDist).toContain(".claude/tools/d-acceleration/host-session.ts");
    git("checkout", "--", ".claude"); unlinkSync(join(runtime, "stray.ts"));
    expect((await parity(SRC, product)).ok).toBeTrue();
  }, TIMEOUT);

  test("parity verifies dispatched D adapter bytes and refuses a missing adapter", async () => {
    const rel = ".claude/hooks/aidlc-d-persistence-pre.ts";
    const adapter = join(product, rel);
    const original = readFileSync(adapter);
    try {
      appendFileSync(adapter, "\n// drift\n");
      const changed = await parity(SRC, product);
      expect(changed.ok).toBeFalse();
      expect(changed.changedFromDist).toContain(rel);
      unlinkSync(adapter);
      const missing = await parity(SRC, product);
      expect(missing.ok).toBeFalse();
      expect(missing.unresolved).toContain(rel);
    } finally { writeFileSync(adapter, original); }
    expect((await parity(SRC, product)).ok).toBeTrue();
  }, TIMEOUT);

  test("update retires only proven legacy D registrations and never duplicates the new adapters", async () => {
    const settingsPath = join(product, ".claude/settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const legacy: Record<string, string> = {
      "d-persistence-pre": 'bun "$CLAUDE_PROJECT_DIR/.claude/tools/d-acceleration/d-persistence-hook.ts" pre',
      "d-persistence-post": 'bun "$CLAUDE_PROJECT_DIR/.claude/tools/d-acceleration/d-persistence-hook.ts" post',
      "d-reviewer-dispatch-cleanup": 'bun "$CLAUDE_PROJECT_DIR/.claude/tools/d-acceleration/reviewer-dispatch-cleanup-hook.ts"',
      "d-blocking-sensor-override": 'bun "$CLAUDE_PROJECT_DIR/.claude/tools/d-acceleration/blocking-sensor-override-hook.ts"',
    };
    for (const groups of Object.values(settings.hooks) as { hooks: { command: string }[] }[][]) for (const group of groups) for (const hook of group.hooks) {
      const name = /engine hook ([a-z-]+)$/.exec(hook.command)?.[1];
      if (name && legacy[name]) hook.command = legacy[name];
    }
    const own = { type: "command", command: "echo project-owned-hook", timeout: 9 };
    settings.hooks.PostToolUse.push({ matcher: "Bash", hooks: [own] });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    const module = join(product, ".claude/tools/d-acceleration/d-persistence-hook.ts");
    const recorded = readFileSync(module);
    appendFileSync(module, "\n// project modification\n");
    git("add", "-A"); git("commit", "-qm", "legacy D fixture");
    const before = readFileSync(settingsPath, "utf8");
    await expect(update(SRC, product)).rejects.toThrow("legacy D hook is not proven");
    expect(readFileSync(settingsPath, "utf8")).toBe(before);
    expect(readFileSync(module, "utf8")).toContain("// project modification");
    writeFileSync(module, recorded);
    git("add", "-A"); git("commit", "-qm", "restore recorded D module");
    const result = await update(SRC, product) as Record<string, any>;
    expect(result.retiredLegacyDHooks).toBe(4);
    const after = JSON.parse(readFileSync(settingsPath, "utf8"));
    const hooks = Object.values(after.hooks).flatMap((groups: any) => groups.flatMap((group: any) => group.hooks));
    expect(hooks).toContainEqual(own);
    for (const name of Object.keys(legacy)) expect(hooks.filter((hook: any) => hook.command.endsWith(`engine hook ${name}`))).toHaveLength(1);
    expect(hooks.some((hook: any) => Object.values(legacy).includes(hook.command))).toBeFalse();
    git("add", "-A"); git("commit", "-qm", "migrated D fixture");
    const bytes = readFileSync(settingsPath, "utf8");
    expect((await update(SRC, product) as Record<string, any>).retiredLegacyDHooks).toBe(0);
    expect(readFileSync(settingsPath, "utf8")).toBe(bytes);
    git("add", "-A"); git("commit", "-qm", "idempotent D update", "--allow-empty");
  }, TIMEOUT);

  test("update replaces only receipt-proven compose output and refuses a user-edited stage", async () => {
    const stage = join(product, ".claude", "aidlc-common", "stages", "inception", "requirements-analysis.md");
    appendFileSync(stage, "\n<!-- team edit -->\n");
    git("add", "-A"); git("commit", "-qm", "team edits a composed stage");
    await expect(update(SRC, product)).rejects.toThrow("requirements-analysis.md");
    git("revert", "--no-edit", "HEAD");
    // A team edit to a compose-copied plugin file is never silently replaced.
    appendFileSync(join(product, ".claude", "tools", "ui-poc-c-routing.cjs"), "\n// team edit\n");
    git("add", "-A"); git("commit", "-qm", "team edits a plugin tool");
    await expect(update(SRC, product)).rejects.toThrow("ui-poc-c-routing.cjs");
    git("revert", "--no-edit", "HEAD");
    const result = await update(SRC, product) as Record<string, any>;
    // Upstream v2.11.2's official config keeps unmodified composed stage sources
    // (plan: preserve), so none is a conflict and none needs replacing; a
    // team-edited one is still refused above.
    expect(result.replacedComposeOwned).toEqual([]);
    expect(result.parity.ok).toBeTrue();
    expect(git("status", "--porcelain", "--", ".claude/aidlc-common")).toBe("");
  }, TIMEOUT);

  test("manifest records source, package, runtime, config, and official receipts", async () => {
    writeFileSync(join(product, ".claude", "d-acceleration.jsonc"), '{ "auto": { "enabled": true, "sessionOnly": false } }');
    const result = await manifest(SRC, product, []) as Record<string, any>;
    expect(result.source.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.package.dAcceleration.sha256).toBe(result.runtime.dAcceleration.sha256);
    expect(result.runtime.parity.ok).toBeTrue();
    expect(result.config.effective.auto).toMatchObject({ enabled: true, sessionOnly: false });
    expect(result.config.installReceipt.path).toBe(".claude/d-install-receipt.json");
    expect(result.official).toEqual({ intentCount: 0, intents: [] });
  }, TIMEOUT);
});
