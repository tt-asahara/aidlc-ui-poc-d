// Offline tests of the optional design-skill setup: a local Git repository
// stands in for the pinned upstream, and the PRODUCT carries a copy of the
// composed routing tools re-pinned to that repository's commit.
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { setupDesignSkill, SetupStop } from "../scripts/setup-design-skill.ts";

const SRC_TOOLS = resolve(import.meta.dir, "..", "tools");
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); temps.push(dir); return dir; };
const git = (cwd: string, ...args: string[]) => { const r = spawnSync("git", args, { cwd, encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const blob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** A fake upstream for the "impeccable" choice plus a PRODUCT whose installed tools pin it. */
function world() {
  const upstream = temp("design-skill-upstream-");
  git(upstream, "init", "-q");
  const files: Record<string, string> = { "LICENSE": "Apache License (fake)\n", "NOTICE.md": "notice (fake)\n", ".claude/skills/impeccable/scripts/impeccable": "#!/bin/sh\necho launcher\n" };
  const tools = temp("design-skill-tools-");
  cpSync(SRC_TOOLS, tools, { recursive: true });
  const cfg = JSON.parse(readFileSync(join(tools, "ui-poc/c-stage-routing.json"), "utf8"));
  const skill = cfg.skills.impeccable;
  for (const entrypoint of skill.entrypoints) files[skill.sourcePaths[entrypoint]] = `fake ${entrypoint}\n`;
  for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(upstream, rel)), { recursive: true }); writeFileSync(join(upstream, rel), text); }
  spawnSync("chmod", ["+x", join(upstream, ".claude/skills/impeccable/scripts/impeccable")]);
  git(upstream, "add", "-A");
  git(upstream, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "pin");
  git(upstream, "config", "uploadpack.allowReachableSHA1InWant", "true");
  const commit = git(upstream, "rev-parse", "HEAD");
  skill.commit = commit;
  writeFileSync(join(tools, "ui-poc/c-stage-routing.json"), JSON.stringify(cfg));
  const lock = JSON.parse(readFileSync(join(tools, "ui-poc/design-skill-lock.json"), "utf8"));
  const source = lock.sources.find((s: { repository: string }) => s.repository === skill.repository);
  source.commit = commit;
  for (const file of source.files) { const bytes = Buffer.from(files[file.path]!); Object.assign(file, { git_blob_sha: blob(bytes), bytes: bytes.length }); }
  for (const license of source.licenseFiles) { const bytes = Buffer.from(files[license.path]!); Object.assign(license, { git_blob_sha: blob(bytes), bytes: bytes.length, sha256: sha256(bytes) }); }
  writeFileSync(join(tools, "ui-poc/design-skill-lock.json"), JSON.stringify(lock));
  const product = temp("design-skill-product-");
  cpSync(tools, join(product, ".claude/tools"), { recursive: true });
  const options = { srcTools: tools, fetchUrl: () => upstream };
  return { upstream, tools, product, options, skill };
}

/** A person's own copy of the local-folder choice plus a PRODUCT whose installed tools pin that copy's bytes and Git tree. */
function localWorld() {
  const source = temp("design-skill-local-source-");
  const files: Record<string, string> = { "SKILL.md": "fake skill\n", "references/screens.md": "fake screens\n", "scripts/check.py": "print('ok')\n", "assets/web/logo.png": "png" };
  for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(source, rel)), { recursive: true }); writeFileSync(join(source, rel), text); }
  const tree = temp("design-skill-local-tree-");
  git(tree, "init", "-q");
  cpSync(source, tree, { recursive: true });
  git(tree, "add", "-A");
  const commit = git(tree, "write-tree");
  const tools = temp("design-skill-tools-");
  cpSync(SRC_TOOLS, tools, { recursive: true });
  const cfg = JSON.parse(readFileSync(join(tools, "ui-poc/c-stage-routing.json"), "utf8"));
  const skill = cfg.skills["ponta-pass-design"];
  skill.commit = commit;
  writeFileSync(join(tools, "ui-poc/c-stage-routing.json"), JSON.stringify(cfg));
  const lock = JSON.parse(readFileSync(join(tools, "ui-poc/design-skill-lock.json"), "utf8"));
  const pinned = lock.sources.find((s: { repository: string }) => s.repository === skill.repository);
  pinned.commit = commit;
  pinned.files = Object.entries(files).map(([path, text]) => ({ path, git_blob_sha: blob(Buffer.from(text)), bytes: Buffer.byteLength(text) }));
  writeFileSync(join(tools, "ui-poc/design-skill-lock.json"), JSON.stringify(lock));
  const product = temp("design-skill-product-");
  cpSync(tools, join(product, ".claude/tools"), { recursive: true });
  return { source, product, options: { srcTools: tools, source }, commit };
}

describe("setup-design-skill", () => {
  test("dry-run previews the pinned fetch and writes nothing", () => {
    const w = world();
    const plan = setupDesignSkill(w.product, "impeccable", { ...w.options, dryRun: true }) as Record<string, unknown>;
    expect(plan).toMatchObject({ mode: "dry-run", skill: "impeccable", commit: w.skill.commit, to: ".agents/skills/impeccable", alreadyInstalled: false });
    expect(existsSync(join(w.product, ".agents"))).toBe(false);
  });
  test("apply installs the whole pinned skill and its licences, passes the routing install check, and is idempotent", () => {
    const w = world();
    const result = setupDesignSkill(w.product, "impeccable", w.options) as Record<string, unknown>;
    expect(result).toMatchObject({ mode: "apply", ready: true, files: 8 });
    expect(String(result.switch)).toContain('set it to "impeccable"');
    expect(readFileSync(join(w.product, ".agents/skills/LICENSES/impeccable-latest/NOTICE.md"), "utf8")).toBe("notice (fake)\n");
    expect(statSync(join(w.product, ".agents/skills/impeccable/scripts/impeccable")).mode & 0o111).not.toBe(0);
    expect(setupDesignSkill(w.product, "impeccable", w.options)).toMatchObject({ mode: "apply", ready: true });
    expect(existsSync(join(w.product, ".claude/d-acceleration.jsonc"))).toBe(false);
  });
  test("never overwrites a differing or extra file in the install directory", () => {
    const w = world();
    setupDesignSkill(w.product, "impeccable", w.options);
    appendFileSync(join(w.product, ".agents/skills/impeccable/reference/polish.md"), "local edit");
    expect(() => setupDesignSkill(w.product, "impeccable", w.options)).toThrow(/polish\.md exists and differs from the pinned file/);
    const fresh = world();
    mkdirSync(join(fresh.product, ".agents/skills/impeccable"), { recursive: true });
    writeFileSync(join(fresh.product, ".agents/skills/impeccable/mine.md"), "x");
    expect(() => setupDesignSkill(fresh.product, "impeccable", fresh.options)).toThrow(/files that are not in the pinned skill/);
  });
  test("stops on a licence that is not the recorded one, an outdated installed routing, or an unknown choice", () => {
    const w = world();
    writeFileSync(join(w.upstream, "LICENSE"), "relicensed\n");
    git(w.upstream, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-am", "relicense");
    git(w.upstream, "update-ref", "refs/heads/old", w.skill.commit);
    expect(() => setupDesignSkill(w.product, "impeccable", w.options)).not.toThrow();
    const other = world();
    writeFileSync(join(other.product, ".claude/tools/ui-poc/design-skill-lock.json"), "{}");
    expect(() => setupDesignSkill(other.product, "impeccable", other.options)).toThrow(/installed ui-poc\/design-skill-lock\.json differs from this D checkout/);
    expect(() => setupDesignSkill(w.product, "taste-skill", w.options)).toThrow(/Unknown uiDesign\.refinedMockupSkill: taste-skill/);
    const bad = world();
    const lockPath = join(bad.tools, "ui-poc/design-skill-lock.json"), lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.sources.find((s: { repository: string }) => s.repository === bad.skill.repository).licenseFiles[0].sha256 = "0".repeat(64);
    writeFileSync(lockPath, JSON.stringify(lock));
    cpSync(lockPath, join(bad.product, ".claude/tools/ui-poc/design-skill-lock.json"));
    expect(() => setupDesignSkill(bad.product, "impeccable", bad.options)).toThrow(SetupStop);
    expect(() => setupDesignSkill(bad.product, "impeccable", bad.options)).toThrow(/LICENSE at the pin is not the recorded Apache-2\.0 licence/);
  });
  test("the default choice needs no fetch and reports the Arm C payload status", () => {
    const w = world();
    expect(setupDesignSkill(w.product, "impeccable-historical", w.options)).toMatchObject({ skill: "impeccable-historical", ready: false });
  });
  test("a local-folder choice installs the person's own copy only when it is exactly the pinned tree", () => {
    const w = localWorld();
    expect(() => setupDesignSkill(w.product, "ponta-pass-design", { srcTools: w.options.srcTools })).toThrow(/installed from your own copy, not fetched; pass --source/);
    expect(setupDesignSkill(w.product, "ponta-pass-design", { ...w.options, dryRun: true })).toMatchObject({ mode: "dry-run", repository: "local/ponta-pass-design", commit: w.commit, from: realpathSync(w.source), to: ".agents/skills/ponta-pass-design", licenses: [], alreadyInstalled: false });
    expect(existsSync(join(w.product, ".agents"))).toBe(false);
    writeFileSync(join(w.source, ".DS_Store"), "finder");
    expect(setupDesignSkill(w.product, "ponta-pass-design", w.options)).toMatchObject({ mode: "apply", ready: true, files: 4 });
    expect(existsSync(join(w.product, ".agents/skills/ponta-pass-design/.DS_Store"))).toBe(false);
    expect(setupDesignSkill(w.product, "ponta-pass-design", w.options)).toMatchObject({ mode: "apply", ready: true });
    expect(existsSync(join(w.product, ".claude/d-acceleration.jsonc"))).toBe(false);
  });
  test("a local-folder copy that differs from the pin, or --source on a fetched choice, stops before writing", () => {
    const changed = localWorld();
    appendFileSync(join(changed.source, "scripts/check.py"), "# edited\n");
    expect(() => setupDesignSkill(changed.product, "ponta-pass-design", changed.options)).toThrow(/--source scripts\/check\.py differs from the pinned ponta-pass-design/);
    const extra = localWorld();
    writeFileSync(join(extra.source, "notes.md"), "mine");
    rmSync(join(extra.source, "assets/web/logo.png"));
    expect(() => setupDesignSkill(extra.product, "ponta-pass-design", extra.options)).toThrow(/is not the pinned ponta-pass-design \(extra notes\.md, missing assets\/web\/logo\.png\)/);
    const linked = localWorld();
    symlinkSync(join(linked.source, "SKILL.md"), join(linked.source, "link.md"));
    expect(() => setupDesignSkill(linked.product, "ponta-pass-design", linked.options)).toThrow(/--source contains a symlink \(link\.md\)/);
    for (const w of [changed, extra, linked]) expect(existsSync(join(w.product, ".agents"))).toBe(false);
    const fetched = world();
    expect(() => setupDesignSkill(fetched.product, "impeccable", { ...fetched.options, source: changed.source })).toThrow(/--source applies only to a choice installed from your own copy; impeccable is fetched from pbakaus\/impeccable/);
  });
});
