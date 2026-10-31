#!/usr/bin/env bun
// design-document.ts — deterministic inputs for `/aidlc --doc`, ported from the
// KDDI harness (`aidlc-kddi-task-ledger.ts doc-manifest|doc-snapshot` plus
// `aidlc-kddi-paths.ts`).
//
// The design document itself is written by the LLM following
// `design-document-guide.md`. This tool only owns what must be exact: which
// records are inputs, where the space-level document lives, and the one-
// generation recovery copy taken right before `--doc --full` overwrites it.
// It never touches workflow state or the audit trail.
//
// The document is SPACE-LEVEL (`aidlc/spaces/<space>/design-document/`), not
// per-record: it spans every intent, so a per-record copy would leave the next
// intent unable to read the previous output and incremental merge would
// silently degrade into full regeneration on every intent switch. This is the
// same reason core keeps codekb space-level.
//
// The snapshot lives under `aidlc/spaces/<space>/intents/.aidlc-d-doc-snapshot/`
// so the shipped `aidlc/spaces/*/intents/.aidlc-*` ignore rule already keeps it
// machine-local; it holds no aidlc-state.md, so it is never listed as a record.

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { activeSpace, intentsDir, listIntents, spacesRoot } from "../../core/tools/aidlc-lib.ts";

export const DESIGN_DOCUMENT_DIRNAME = "design-document";
export const DOC_SNAPSHOT_DIRNAME = ".aidlc-d-doc-snapshot";

export function designDocumentDir(projectDir: string, space?: string): string {
  return join(spacesRoot(projectDir), space ?? activeSpace(projectDir), DESIGN_DOCUMENT_DIRNAME);
}

export function relativeDesignDocumentDir(projectDir: string, space?: string): string {
  return `aidlc/spaces/${space ?? activeSpace(projectDir)}/${DESIGN_DOCUMENT_DIRNAME}`;
}

export function docSnapshotDir(projectDir: string, space?: string): string {
  return join(intentsDir(projectDir, space), DOC_SNAPSHOT_DIRNAME);
}

export function relativeDocSnapshotDir(projectDir: string, space?: string): string {
  return `${relativeIntentsDir(projectDir, space)}/${DOC_SNAPSHOT_DIRNAME}`;
}

// Relative (posix) so the manifest never embeds the generating machine's layout.
export function relativeIntentsDir(projectDir: string, space?: string): string {
  return `aidlc/spaces/${space ?? activeSpace(projectDir)}/intents`;
}

export interface DocManifest {
  space: string;
  design_document_root: string;
  intents: Array<{
    uuid: string;
    record_dir: string;
    record_root: string;
    status: string;
    active: boolean;
    design_summary: string;
    design_summary_exists: boolean;
    /** This intent's refined-mockups copies of a design baseline, with their declared changes. */
    baseline_copies: BaselineCopy[];
  }>;
  /** The space's design baselines: the product's current screens, flows, and specifications. */
  design_baselines: DesignBaseline[];
  warnings: string[];
}

export type DesignBaseline = { name: string; dir: string; files: number; screens: number; tree_sha256: string };
export type BaselineCopy = { name: string; dir: string; source: string; changes: string | null; changes_md: string | null };

/**
 * The space's design baselines (design-baseline/<name>.json, written by the
 * ui-poc baseline tool) as posix paths relative to the project. A record that
 * is not that tool's is ignored.
 */
export function designBaselines(projectDir: string, space?: string): DesignBaseline[] {
  const sp = space ?? activeSpace(projectDir), root = join(spacesRoot(projectDir), sp, "design-baseline");
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((file) => file.endsWith(".json")).sort().flatMap((file) => {
    try {
      const record = JSON.parse(readFileSync(join(root, file), "utf8")) as { kind?: string; name?: string; files?: number; screens?: number; treeSha256?: string };
      if (record.kind !== "ui-poc-design-baseline" || !record.name || !existsSync(join(root, record.name))) return [];
      return [{ name: record.name, dir: `aidlc/spaces/${sp}/design-baseline/${record.name}`, files: record.files ?? 0, screens: record.screens ?? 0, tree_sha256: record.treeSha256 ?? "" }];
    } catch { return []; }
  });
}

/** One record's refined-mockups copies of a design baseline (<name>-base.json beside <name>/). */
export function baselineCopies(projectDir: string, recordRoot: string): BaselineCopy[] {
  const rel = `${recordRoot}/inception/refined-mockups`, stage = join(projectDir, rel);
  if (!existsSync(stage)) return [];
  return readdirSync(stage).filter((file) => file.endsWith("-base.json")).sort().flatMap((file) => {
    try {
      const record = JSON.parse(readFileSync(join(stage, file), "utf8")) as { kind?: string; name?: string; source?: string };
      if (record.kind !== "ui-poc-baseline-copy" || !record.name) return [];
      const has = (name: string) => existsSync(join(stage, name)) ? `${rel}/${name}` : null;
      return [{ name: record.name, dir: `${rel}/${record.name}`, source: record.source ?? "", changes: has(`${record.name}-changes.json`), changes_md: has(`${record.name}-changes.md`) }];
    } catch { return []; }
  });
}

/**
 * The deterministic input set for `/aidlc --doc`. Abnormal records are dropped
 * with a warning rather than errored, so one broken record cannot stop
 * design-document generation.
 */
export function docManifest(projectDir: string): DocManifest {
  const warnings: string[] = [];
  const intents: DocManifest["intents"] = [];
  for (const info of listIntents(projectDir)) {
    if (!info.dirName) {
      warnings.push(`skipped intent ${info.uuid}: registry row has no record dir`);
      continue;
    }
    if (!info.uuid) {
      warnings.push(`skipped record ${info.dirName}: no registry row (uuid unresolvable)`);
      continue;
    }
    // dirName is used verbatim: rebuilding it from the slug would lose the
    // same-day `-2` suffix the engine adds on a clash.
    const recordRoot = `${relativeIntentsDir(projectDir)}/${info.dirName}`;
    const summary = `${recordRoot}/design-summary.md`;
    intents.push({
      uuid: info.uuid,
      record_dir: info.dirName,
      record_root: recordRoot,
      status: info.status,
      active: info.active,
      design_summary: summary,
      design_summary_exists: existsSync(join(projectDir, summary)),
      baseline_copies: baselineCopies(projectDir, recordRoot),
    });
  }
  return {
    space: activeSpace(projectDir),
    design_document_root: relativeDesignDocumentDir(projectDir),
    intents,
    design_baselines: designBaselines(projectDir),
    warnings,
  };
}

export type DocSnapshotResult =
  | { snapshotted: false; reason: string; source: string }
  | { snapshotted: true; entries: number; source: string; dest: string };

/**
 * Copy the live design document aside right before `--doc --full` overwrites
 * it. Exactly one previous generation is kept. Deliberately not fail-soft: a
 * copy error throws so the conductor stops before regenerating. A missing or
 * empty source is a reported no-op that leaves any existing snapshot intact.
 */
export function docSnapshot(projectDir: string): DocSnapshotResult {
  const src = designDocumentDir(projectDir);
  const dest = docSnapshotDir(projectDir);
  const source = relativeDesignDocumentDir(projectDir);
  const entries = existsSync(src) ? readdirSync(src).filter((e) => !e.startsWith(".")) : [];
  if (entries.length === 0) {
    return { snapshotted: false, reason: "design-document is missing or empty", source };
  }
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  writeFileSync(
    join(dest, ".snapshot-meta.json"),
    `${JSON.stringify({ taken_at: new Date().toISOString(), source }, null, 2)}\n`,
  );
  return { snapshotted: true, entries: entries.length, source, dest: relativeDocSnapshotDir(projectDir) };
}

function main(argv: string[]): number {
  const [subcommand, ...rest] = argv;
  const json = rest.includes("--json");
  const at = rest.indexOf("--project-dir");
  const projectDir = at >= 0 ? rest[at + 1] : process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  if (!projectDir || !isAbsolute(projectDir)) {
    process.stderr.write("design-document: --project-dir must be an absolute path\n");
    return 2;
  }
  if (subcommand === "doc-manifest") {
    const manifest = docManifest(projectDir);
    if (json) {
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`design-document root: ${manifest.design_document_root}\n`);
    for (const w of manifest.warnings) process.stdout.write(`warn: ${w}\n`);
    for (const i of manifest.intents) {
      process.stdout.write(`  ${i.record_dir} [${i.status}] summary=${i.design_summary_exists ? "あり" : "なし"}\n`);
    }
    return 0;
  }
  if (subcommand === "doc-snapshot") {
    const result = docSnapshot(projectDir);
    if (json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (!result.snapshotted) {
      process.stdout.write(`doc-snapshot: ${result.source} が空または未生成のため退避しません（既存スナップショットは保持）。\n`);
    } else {
      process.stdout.write(
        `doc-snapshot: ${result.source}（${result.entries} エントリ）を ${result.dest} へ退避しました。復旧: cp -R ${result.dest}/. ${result.source}/\n`,
      );
    }
    return 0;
  }
  process.stderr.write(`Usage: design-document.ts <doc-manifest|doc-snapshot> [--json] [--project-dir <abs>]\n`);
  return 2;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
