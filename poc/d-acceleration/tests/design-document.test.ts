import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docManifest, docSnapshot } from "../design-document.ts";

const repo = join(import.meta.dir, "..", "..", "..");
const cli = join(import.meta.dir, "..", "design-document.ts");

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "d-design-document-"));
  const intents = join(root, "aidlc", "spaces", "default", "intents");
  for (const dir of ["alpha-aaaaaaaa", "beta-bbbbbbbb", "orphan-cccccccc"]) {
    mkdirSync(join(intents, dir), { recursive: true });
    writeFileSync(join(intents, dir, "aidlc-state.md"), "# state\n");
  }
  writeFileSync(join(intents, "beta-bbbbbbbb", "design-summary.md"), "# summary\n");
  writeFileSync(
    join(intents, "intents.json"),
    JSON.stringify([
      { uuid: "aaaaaaaa-0000-4000-8000-000000000001", slug: "alpha", status: "complete", dirName: "alpha-aaaaaaaa" },
      { uuid: "bbbbbbbb-0000-4000-8000-000000000002", slug: "beta", status: "in-flight", dirName: "beta-bbbbbbbb" },
      { uuid: "dddddddd-0000-4000-8000-000000000004", slug: "ghost", status: "in-flight", dirName: "ghost-dddddddd" },
    ]),
  );
  writeFileSync(join(intents, "active-intent"), "beta-bbbbbbbb\n");
  return root;
}

describe("/aidlc --doc deterministic inputs", () => {
  test("doc-manifest lists every recorded intent with relative space-level paths", () => {
    const root = project();
    const manifest = docManifest(root);
    expect(manifest.space).toBe("default");
    expect(manifest.design_document_root).toBe("aidlc/spaces/default/design-document");
    expect(manifest.intents.map((i) => i.record_dir)).toEqual(["alpha-aaaaaaaa", "beta-bbbbbbbb"]);
    expect(manifest.intents[1]).toMatchObject({
      record_root: "aidlc/spaces/default/intents/beta-bbbbbbbb",
      status: "in-flight",
      active: true,
      design_summary: "aidlc/spaces/default/intents/beta-bbbbbbbb/design-summary.md",
      design_summary_exists: true,
    });
    expect(manifest.intents[0].design_summary_exists).toBe(false);
    expect(manifest.warnings).toEqual([
      "skipped intent dddddddd-0000-4000-8000-000000000004: registry row has no record dir",
      "skipped record orphan-cccccccc: no registry row (uuid unresolvable)",
    ]);
  });

  test("doc-manifest lists the space's design baselines and each intent's refined-mockups copy", () => {
    const root = project();
    expect(docManifest(root).design_baselines).toEqual([]);
    const baselines = join(root, "aidlc", "spaces", "default", "design-baseline");
    mkdirSync(join(baselines, "ponta-pass"), { recursive: true });
    writeFileSync(join(baselines, "ponta-pass.json"), JSON.stringify({ kind: "ui-poc-design-baseline", schema: 1, name: "ponta-pass", files: 579, screens: 298, treeSha256: "abc" }));
    writeFileSync(join(baselines, "notes.json"), JSON.stringify({ kind: "something-else", name: "notes" }));
    const stage = join(root, "aidlc", "spaces", "default", "intents", "beta-bbbbbbbb", "inception", "refined-mockups");
    mkdirSync(join(stage, "ponta-pass"), { recursive: true });
    writeFileSync(join(stage, "ponta-pass-base.json"), JSON.stringify({ kind: "ui-poc-baseline-copy", name: "ponta-pass", source: "space-baseline" }));
    writeFileSync(join(stage, "ponta-pass-changes.json"), "{}");
    const manifest = docManifest(root);
    expect(manifest.design_baselines).toEqual([{ name: "ponta-pass", dir: "aidlc/spaces/default/design-baseline/ponta-pass", files: 579, screens: 298, tree_sha256: "abc" }]);
    expect(manifest.intents[1]!.baseline_copies).toEqual([{
      name: "ponta-pass", dir: "aidlc/spaces/default/intents/beta-bbbbbbbb/inception/refined-mockups/ponta-pass", source: "space-baseline",
      changes: "aidlc/spaces/default/intents/beta-bbbbbbbb/inception/refined-mockups/ponta-pass-changes.json", changes_md: null,
    }]);
    expect(manifest.intents[0]!.baseline_copies).toEqual([]);
  });

  test("doc-snapshot is a reported no-op when the document is absent and keeps an older snapshot", () => {
    const root = project();
    const snapshot = join(root, "aidlc", "spaces", "default", "intents", ".aidlc-d-doc-snapshot");
    mkdirSync(snapshot, { recursive: true });
    writeFileSync(join(snapshot, "kept.md"), "old\n");
    expect(docSnapshot(root)).toEqual({
      snapshotted: false,
      reason: "design-document is missing or empty",
      source: "aidlc/spaces/default/design-document",
    });
    expect(readFileSync(join(snapshot, "kept.md"), "utf8")).toBe("old\n");
  });

  test("doc-snapshot replaces the single previous generation and is never listed as a record", () => {
    const root = project();
    const doc = join(root, "aidlc", "spaces", "default", "design-document");
    mkdirSync(join(doc, "00_設計管理"), { recursive: true });
    writeFileSync(join(doc, "README.md"), "# 設計書\n");
    writeFileSync(join(doc, "00_設計管理", "要件一覧.md"), "# 要件一覧\n");
    const snapshot = join(root, "aidlc", "spaces", "default", "intents", ".aidlc-d-doc-snapshot");
    mkdirSync(snapshot, { recursive: true });
    writeFileSync(join(snapshot, "stale.md"), "stale\n");

    expect(docSnapshot(root)).toEqual({
      snapshotted: true,
      entries: 2,
      source: "aidlc/spaces/default/design-document",
      dest: "aidlc/spaces/default/intents/.aidlc-d-doc-snapshot",
    });
    expect(existsSync(join(snapshot, "stale.md"))).toBe(false);
    expect(readFileSync(join(snapshot, "00_設計管理", "要件一覧.md"), "utf8")).toBe("# 要件一覧\n");
    expect(JSON.parse(readFileSync(join(snapshot, ".snapshot-meta.json"), "utf8")).source).toBe(
      "aidlc/spaces/default/design-document",
    );
    expect(docManifest(root).intents.map((i) => i.record_dir)).toEqual(["alpha-aaaaaaaa", "beta-bbbbbbbb"]);
  });

  test("the snapshot location is covered by the shipped Claude ignore rule", () => {
    const ignore = readFileSync(join(repo, "harness", "claude", "dot-gitignore"), "utf8");
    expect(ignore.split("\n")).toContain("aidlc/spaces/*/intents/.aidlc-*");
  });

  test("CLI emits JSON and rejects unknown subcommands", () => {
    const root = project();
    const ok = spawnSync(process.execPath, [cli, "doc-manifest", "--json", "--project-dir", root], { encoding: "utf8" });
    expect(ok.status, ok.stderr).toBe(0);
    expect(JSON.parse(ok.stdout).intents).toHaveLength(2);
    const bad = spawnSync(process.execPath, [cli, "status", "--project-dir", root], { encoding: "utf8" });
    expect(bad.status).toBe(2);
  });
});
