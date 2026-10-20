#!/usr/bin/env bun
// Clean-target installer, updater, package-parity verifier, and evidence
// manifest for Arm D. It runs from the reviewed source checkout (SRC) against a
// separate product directory (PRODUCT) and only automates the documented
// setup path in .claude/skills/aidlc-setup/SKILL.md:
//
//   install   official `aidlc config` (dry-run, then apply) + exact C payload
//             (no-clobber) + project-local compose twice (idempotence) +
//             parity + D preflight
//   update    the same, for a product that was installed and composed before.
//             Composed stage sources differ from the shipped bytes on purpose,
//             so the official config reports them as conflicts. Those (and only
//             those) are replaced when each one is named by the installed
//             plugin contribution sidecar AND still has the exact bytes that
//             install/update recorded in .claude/d-install-receipt.json;
//             anything else stops the update. Compose then reapplies.
//   parity    every file the installed D flow can load is present, inside
//             PRODUCT, byte-identical to SRC/dist/claude, and resolvable
//             through Bun's own resolver from the installed location.
//   manifest  records source SHA, package/runtime hashes, config snapshot and
//             effective values, model identities, official audit receipts, and
//             Git refs into one JSON file.
//
// Tools for determinism: every decision here is a byte/hash/path comparison
// over recorded facts. It never answers a gate, writes official state, or
// edits generated output by hand.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { builtinModules } from "node:module";
import {
  copyFileSync, existsSync, unlinkSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

type Json = Record<string, unknown>;
export class SetupStop extends Error {}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const fileHash = (path: string) => sha256(readFileSync(path));
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

export function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else out.push(relative(root, path).split(sep).join("/"));
    }
  };
  visit(root);
  return out.sort();
}

/** Order-independent content hash of a directory tree (path + bytes). */
export function treeHash(root: string, filter: (rel: string) => boolean = () => true): { sha256: string; files: number } {
  const files = walkFiles(root).filter(filter);
  const h = createHash("sha256");
  for (const rel of files) h.update(`${rel}\0${fileHash(join(root, rel))}\n`);
  return { sha256: h.digest("hex"), files: files.length };
}

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function must(cmd: string, args: string[], cwd: string, what: string, env: Record<string, string> = {}): string {
  const result = run(cmd, args, cwd, env);
  if (result.status !== 0) throw new SetupStop(`${what} failed (${result.status}): ${(result.stderr || result.stdout).trim().slice(0, 4000)}`);
  return result.stdout;
}

function git(cwd: string, args: string[]): string { return must("git", ["-C", cwd, ...args], cwd, `git ${args.join(" ")}`).trim(); }

function paths(src: string, product: string) {
  if (!isAbsolute(src) || !isAbsolute(product)) throw new SetupStop("--src and --product must be absolute paths");
  const S = realpathSync(src), P = realpathSync(product);
  if (inside(S, P) || inside(P, S)) throw new SetupStop("PRODUCT must be separate from the SRC checkout");
  const dist = join(S, "dist", "claude");
  const dispatcher = join(dist, ".claude", "tools", "aidlc.ts");
  const pluginRoot = join(S, "poc", "ui-poc", "dist", "claude");
  for (const required of [dispatcher, join(pluginRoot, "hooks", "compose.ts")]) {
    if (!existsSync(required)) throw new SetupStop(`missing build output ${relative(S, required)}; run bun scripts/package.ts claude and the ui-poc plugin build first`);
  }
  return { S, P, dist, dispatcher, pluginRoot };
}

function requireCleanGit(P: string, scope: string[] = []): void {
  if (!existsSync(join(P, ".git"))) throw new SetupStop("PRODUCT must be a Git repository so existing work can be proven untouched");
  const dirty = git(P, ["status", "--porcelain", "--", ...scope]);
  if (dirty) throw new SetupStop(`PRODUCT has uncommitted changes; commit or move them first:\n${dirty}`);
}

function configArgs(p: ReturnType<typeof paths>, extra: string[]): string[] {
  return [p.dispatcher, "config", "--from", p.dist, "--harness", "claude", "--project-dir", p.P, "--mcp", "none", ...extra];
}

/** Conflicting paths from an official config dry-run (empty when clean). */
export function configConflicts(p: ReturnType<typeof paths>): string[] {
  const result = run(process.execPath, configArgs(p, ["--dry-run"]), p.P);
  if (result.status === 0) return [];
  const match = /error: \d+ config conflict\(s\): (.*)/.exec(result.stderr + result.stdout);
  if (!match) throw new SetupStop(`config dry-run failed: ${(result.stderr || result.stdout).trim().slice(0, 2000)}`);
  return match[1].split(/, (?=\.)/).map((entry) => entry.replace(/ \([^)]*\)$/, "").trim());
}

const C_PAYLOAD_ROOT = ".agents";
function placeCPayload(S: string, P: string): { added: number; identical: number } {
  const files = git(S, ["ls-files", C_PAYLOAD_ROOT]).split("\n").filter(Boolean);
  if (!files.length) throw new SetupStop("SRC has no tracked C payload under .agents");
  const differing = files.filter((rel) => existsSync(join(P, rel)) && fileHash(join(P, rel)) !== fileHash(join(S, rel)));
  if (differing.length) throw new SetupStop(`C payload differs in PRODUCT (never merged or overwritten): ${differing.join(", ")}`);
  let added = 0, identical = 0;
  for (const rel of files) {
    const target = join(P, rel);
    if (existsSync(target)) { identical++; continue; }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(S, rel), target);
    added++;
  }
  return { added, identical };
}

const D_GITIGNORE = "# BEGIN AI-DLC D:gitignore\n# D generic-auto host session, bootstrap journal, and directive handoff files\n/.aidlc-engine/\n# END AI-DLC D:gitignore\n";
function ignoreDRuntime(P: string): boolean {
  const path = join(P, ".gitignore");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current.includes("# BEGIN AI-DLC D:gitignore")) return false;
  writeFileSync(path, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${D_GITIGNORE}`);
  return true;
}

function compose(p: ReturnType<typeof paths>): void {
  must(process.execPath, [join(p.pluginRoot, "hooks", "compose.ts")], p.P, "project-local compose", {
    AIDLC_PROJECT_DIR: p.P, AIDLC_PLUGIN_ROOT: p.pluginRoot, AIDLC_HARNESS_DIR: ".claude", AIDLC_HARNESS_NAME: "claude",
  });
}

function composeTwice(p: ReturnType<typeof paths>) {
  compose(p);
  const first = treeHash(join(p.P, ".claude"));
  compose(p);
  const second = treeHash(join(p.P, ".claude"));
  if (first.sha256 !== second.sha256) throw new SetupStop("second compose changed the installed tree; compose is not idempotent");
  return second;
}

function preflight(P: string): Json {
  const result = run(process.execPath, [join(P, ".claude", "tools", "d-acceleration", "run.ts"), "--project-dir", P, "--preflight"], P);
  let parsed: Json;
  try { parsed = JSON.parse(result.stdout) as Json; } catch { throw new SetupStop(`D preflight did not return JSON: ${result.stderr.trim()}`); }
  const runtime = String(parsed.runtime ?? "");
  const ok = result.status === 0 && parsed.uiBaseline === "C-composed" && parsed.acceleration === "D-automatic-for-supported-waves" &&
    Array.isArray(parsed.missing) && parsed.missing.length === 0 && runtime === join(P, ".claude");
  if (!ok) throw new SetupStop(`D preflight is not ready: ${JSON.stringify({ status: result.status, uiBaseline: parsed.uiBaseline, missing: parsed.missing, runtime })}`);
  return parsed;
}

// ---------------------------------------------------------------- parity ---

/** Installed scripts the host runs directly (skill commands, hooks, spawns). */
function runtimeEntrypoints(P: string): string[] {
  const tools = join(P, ".claude", "tools");
  const entries = new Set<string>();
  for (const rel of walkFiles(join(tools, "d-acceleration"))) if (rel.endsWith(".ts")) entries.add(join(tools, "d-acceleration", rel));
  // Official scripts the D CLIs spawn by path (generic-auto, host-session).
  for (const name of ["aidlc.ts", "aidlc-orchestrate.ts", "aidlc-state.ts", "aidlc-directive.ts"]) entries.add(join(tools, name));
  const settings = JSON.parse(readFileSync(join(P, ".claude", "settings.json"), "utf8")) as { hooks?: Record<string, { hooks: { command: string }[] }[]> };
  for (const groups of Object.values(settings.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        const match = /\$CLAUDE_PROJECT_DIR\/([^"\s]+\.ts)/.exec(hook.command);
        if (match) entries.add(join(P, match[1]));
        const dispatch = /\bengine hook ([a-z0-9-]+)(?:\s|$)/.exec(hook.command);
        if (dispatch) entries.add(join(P, ".claude", "hooks", `aidlc-${dispatch[1]}.ts`));
      }
    }
  }
  return [...entries].sort();
}

/**
 * Compose regenerates the orchestrator's scope table, adding one row per
 * plugin scope. Accept exactly that: every shipped line kept in order, and each
 * added line is a table row naming a scope the plugin installed (present in
 * PRODUCT, absent from the stock package).
 */
export function onlyComposedScopeRows(shipped: string, installedText: string, distClaude: string, installed: string): boolean {
  const want = shipped.split("\n"), have = installedText.split("\n");
  let at = 0;
  for (const line of have) {
    if (at < want.length && line === want[at]) { at++; continue; }
    const row = /^\| ([a-z0-9-]+) +\|/.exec(line);
    if (!row) return false;
    const scope = `scopes/${row[1]}.md`;
    if (!existsSync(join(installed, scope)) || existsSync(join(distClaude, scope))) return false;
  }
  return at === want.length;
}

/**
 * Files compose copies from the plugin payload, mapped to their installed
 * path and expected bytes ({{HARNESS_DIR}} substituted in Markdown, exactly as
 * compose does). Compose never overwrites an existing file, so a changed
 * payload file is otherwise silently left stale by an update.
 */
export function pluginPayload(pluginRoot: string): { rel: string; sha256: string }[] {
  return walkFiles(pluginRoot)
    // Host-plugin metadata (dot paths) and compose inputs are not copied.
    .filter((rel) => rel.includes("/") && !rel.startsWith(".") && !rel.startsWith("hooks/") && !rel.startsWith("contributions/"))
    .map((rel) => {
      const bytes = readFileSync(join(pluginRoot, rel));
      return { rel: `.claude/${rel}`, sha256: rel.endsWith(".md") ? sha256(bytes.toString("utf8").replaceAll("{{HARNESS_DIR}}", ".claude")) : sha256(bytes) };
    });
}

export interface ParityReport {
  ok: boolean;
  dAccelerationTree: { missing: string[]; extra: string[]; changed: string[]; sha256: string; files: number };
  entrypoints: number;
  resolvedModules: number;
  outsideProduct: string[];
  missingFromDist: string[];
  changedFromDist: string[];
  unresolved: string[];
  nonBuiltinExternal: string[];
  skills: { missing: string[]; changed: string[] };
  pluginPayload: { missing: string[]; changed: string[] };
}

export async function parity(src: string, product: string): Promise<ParityReport> {
  const S = realpathSync(src), P = realpathSync(product);
  const distClaude = join(S, "dist", "claude", ".claude");
  const installed = join(P, ".claude");
  const distD = join(distClaude, "tools", "d-acceleration"), installedD = join(installed, "tools", "d-acceleration");
  const want = new Set(walkFiles(distD)), have = new Set(walkFiles(installedD));
  const dTree = {
    missing: [...want].filter((rel) => !have.has(rel)),
    extra: [...have].filter((rel) => !want.has(rel)),
    changed: [...want].filter((rel) => have.has(rel) && fileHash(join(distD, rel)) !== fileHash(join(installedD, rel))),
    ...treeHash(installedD),
  };

  // Bun's own resolver, rooted at the installed copy: the transitive closure of
  // every import (static and literal dynamic) the installed D flow can load.
  const entrypoints = runtimeEntrypoints(P).filter((path) => existsSync(path));
  const unresolved = runtimeEntrypoints(P).filter((path) => !existsSync(path)).map((path) => relative(P, path));
  const builtins = new Set(builtinModules);
  const outsideProduct: string[] = [], missingFromDist: string[] = [], changedFromDist: string[] = [], nonBuiltinExternal = new Set<string>();
  let resolvedModules = 0;
  const build = await Bun.build({ entrypoints, target: "bun", packages: "external", metafile: true, throw: false } as Parameters<typeof Bun.build>[0] & { metafile: boolean; throw: boolean });
  if (!build.success) unresolved.push(...build.logs.map((log) => String(log.message ?? log)));
  const metafile = (build as unknown as { metafile?: { inputs: Record<string, { imports: { original?: string; path: string; external?: boolean }[] }> } }).metafile;
  for (const [input, meta] of Object.entries(metafile?.inputs ?? {})) {
    const absolute = realpathSync(resolve(process.cwd(), input));
    resolvedModules++;
    if (!inside(installed, absolute)) { outsideProduct.push(absolute); continue; }
    const counterpart = join(distClaude, relative(installed, absolute));
    if (!existsSync(counterpart)) missingFromDist.push(relative(P, absolute));
    else if (fileHash(counterpart) !== fileHash(absolute)) changedFromDist.push(relative(P, absolute));
    for (const imported of meta.imports) {
      if (!imported.external) continue;
      const spec = imported.original ?? imported.path;
      const bare = spec.replace(/^node:/, "");
      if (!(spec.startsWith("node:") || spec.startsWith("bun:") || spec === "bun" || builtins.has(bare))) nonBuiltinExternal.add(`${relative(P, absolute)} -> ${spec}`);
    }
  }

  const skillMissing: string[] = [], skillChanged: string[] = [];
  for (const skill of ["aidlc/SKILL.md", "aidlc-issue-autopilot/SKILL.md"]) {
    const from = join(distClaude, "skills", skill), to = join(installed, "skills", skill);
    if (!existsSync(to)) skillMissing.push(skill);
    else if (fileHash(from) !== fileHash(to) && !onlyComposedScopeRows(readFileSync(from, "utf8"), readFileSync(to, "utf8"), distClaude, installed)) skillChanged.push(skill);
  }
  const pluginMissing: string[] = [], pluginChanged: string[] = [];
  for (const entry of pluginPayload(join(S, "poc", "ui-poc", "dist", "claude"))) {
    const target = join(P, entry.rel);
    if (!existsSync(target)) pluginMissing.push(entry.rel);
    else if (fileHash(target) !== entry.sha256) pluginChanged.push(entry.rel);
  }
  const report: ParityReport = {
    ok: false, dAccelerationTree: dTree, entrypoints: entrypoints.length, resolvedModules,
    outsideProduct, missingFromDist, changedFromDist: changedFromDist.sort(), unresolved, nonBuiltinExternal: [...nonBuiltinExternal].sort(),
    skills: { missing: skillMissing, changed: skillChanged },
    pluginPayload: { missing: pluginMissing, changed: pluginChanged },
  };
  report.ok = !dTree.missing.length && !dTree.extra.length && !dTree.changed.length && !outsideProduct.length &&
    !missingFromDist.length && !changedFromDist.length && !unresolved.length && !report.nonBuiltinExternal.length &&
    !skillMissing.length && !skillChanged.length && !pluginMissing.length && !pluginChanged.length && resolvedModules > 0;
  return report;
}

// ------------------------------------------------------- install / update ---

const RECEIPT = ".claude/d-install-receipt.json";
type Receipt = { schema: 1; sourceSha: string; distClaude: string; composeOwned: Record<string, string> };
/** Records the exact compose-produced bytes so a later update can prove them unmodified. */
function writeReceipt(p: ReturnType<typeof paths>): Receipt {
  const composeOwned: Record<string, string> = {};
  const owned = [...composeOwnedStageSources(p.P), ...pluginPayload(p.pluginRoot).map((entry) => entry.rel)].filter((rel) => existsSync(join(p.P, rel)));
  for (const rel of [...new Set(owned)].sort()) composeOwned[rel] = fileHash(join(p.P, rel));
  const receipt: Receipt = { schema: 1, sourceSha: git(p.S, ["rev-parse", "HEAD"]), distClaude: treeHash(join(p.dist, ".claude")).sha256, composeOwned };
  writeFileSync(join(p.P, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export async function install(src: string, product: string): Promise<Json> {
  const p = paths(src, product);
  requireCleanGit(p.P);
  const conflicts = configConflicts(p);
  if (conflicts.length) throw new SetupStop(`official config reports conflicts on a fresh install: ${conflicts.join(", ")}`);
  must(process.execPath, configArgs(p, []), p.P, "official config apply");
  const cPayload = placeCPayload(p.S, p.P);
  const gitignoreAdded = ignoreDRuntime(p.P);
  const composed = composeTwice(p);
  const report = await parity(p.S, p.P);
  if (!report.ok) throw new SetupStop(`package parity failed: ${JSON.stringify(report)}`);
  const pf = preflight(p.P);
  const receipt = writeReceipt(p);
  return { mode: "install", gitignoreAdded, receipt: { path: RECEIPT, composeOwned: Object.keys(receipt.composeOwned).length }, product: p.P, cPayload, composedTree: composed, parity: report, preflight: { uiBaseline: pf.uiBaseline, acceleration: pf.acceleration, missing: pf.missing, runtime: pf.runtime } };
}

export function composeOwnedStageSources(P: string): Set<string> {
  const sidecars = readdirSync(join(P, ".claude", "tools", "data")).filter((name) => /^plugin-contrib-.+\.json$/.test(name));
  const stageFiles = new Map<string, string>();
  const stagesRoot = join(P, ".claude", "aidlc-common", "stages");
  for (const rel of walkFiles(stagesRoot)) if (rel.endsWith(".md")) stageFiles.set(rel.split("/").pop()!.replace(/\.md$/, ""), `.claude/aidlc-common/stages/${rel}`);
  // Compose also regenerates the orchestrator skill's scope table.
  const owned = new Set<string>(sidecars.length ? [".claude/skills/aidlc/SKILL.md"] : []);
  for (const sidecar of sidecars) {
    const data = JSON.parse(readFileSync(join(P, ".claude", "tools", "data", sidecar), "utf8")) as Record<string, unknown>;
    for (const stage of Object.keys(data)) { const path = stageFiles.get(stage); if (path) owned.add(path); }
  }
  return owned;
}

/**
 * Products installed before the receipt existed: the person names the product
 * commit that recorded the install (their judgement), and a conflict is
 * accepted only when its current bytes equal that commit's bytes.
 */
function legacyReceipt(P: string, commit: string, rels: string[]): Receipt {
  const composeOwned: Record<string, string> = {};
  for (const rel of rels) {
    const shown = spawnSync("git", ["-C", P, "show", `${commit}:${rel}`], { maxBuffer: 64 * 1024 * 1024 });
    if (shown.status === 0) composeOwned[rel] = sha256(shown.stdout);
  }
  return { schema: 1, sourceSha: "legacy", distClaude: "legacy", composeOwned };
}

export async function update(src: string, product: string, legacyInstallCommit?: string): Promise<Json> {
  const p = paths(src, product);
  // Workflow records may be mid-flight during an update; only the surfaces
  // the update writes must be clean.
  requireCleanGit(p.P, [".claude", ".agents", ".gitignore"]);
  const conflicts = configConflicts(p);
  // Plugin files compose would leave stale (no-clobber) are replaced under the
  // same receipt proof as composed stage sources.
  const stalePlugin = pluginPayload(p.pluginRoot).filter((entry) => existsSync(join(p.P, entry.rel)) && fileHash(join(p.P, entry.rel)) !== entry.sha256).map((entry) => entry.rel);
  const replaced = [...conflicts, ...stalePlugin];
  if (replaced.length && !existsSync(join(p.P, RECEIPT)) && !legacyInstallCommit) throw new SetupStop(`update stops: ${RECEIPT} is missing, so the ${conflicts.length} conflicting file(s) cannot be proven to be unmodified setup output (pass --legacy-install-commit <product commit that recorded the install> to compare against that commit): ${replaced.join(", ")}`);
  // An explicit --legacy-install-commit is the person's judgement and wins.
  const receipt = !replaced.length ? null
    : legacyInstallCommit ? legacyReceipt(p.P, legacyInstallCommit, replaced)
    : JSON.parse(readFileSync(join(p.P, RECEIPT), "utf8")) as Receipt;
  const owned = new Set([...composeOwnedStageSources(p.P), ...stalePlugin]);
  const refused = replaced.filter((rel) => !owned.has(rel) || receipt?.composeOwned[rel] !== fileHash(join(p.P, rel)));
  if (refused.length) throw new SetupStop(`update stops: conflicts not proven to be unmodified compose output recorded in ${RECEIPT}: ${refused.join(", ")}`);
  must(process.execPath, configArgs(p, conflicts.length ? ["--force"] : []), p.P, "official config update");
  for (const rel of stalePlugin) unlinkSync(join(p.P, rel));
  const cPayload = placeCPayload(p.S, p.P);
  ignoreDRuntime(p.P);
  const composed = composeTwice(p);
  const report = await parity(p.S, p.P);
  if (!report.ok) throw new SetupStop(`package parity failed after update: ${JSON.stringify(report)}`);
  const pf = preflight(p.P);
  writeReceipt(p);
  return { mode: "update", product: p.P, replacedComposeOwned: conflicts, replacedPluginFiles: stalePlugin, cPayload, composedTree: composed, parity: report, preflight: { uiBaseline: pf.uiBaseline, missing: pf.missing, runtime: pf.runtime } };
}

// -------------------------------------------------------------- manifest ---

function claudeRunIdentities(logs: string[]): Json[] {
  return logs.map((log) => {
    const lines = readFileSync(log, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as Json]; } catch { return []; } });
    const init = lines.find((line) => line.type === "system" && line.subtype === "init");
    const results = lines.filter((line) => line.type === "result");
    const result = results.at(-1);
    const assistantModels = new Set<string>();
    for (const line of lines) { const message = line.message as Json | undefined; if (line.type === "assistant" && typeof message?.model === "string") assistantModels.add(message.model); }
    return {
      log: log.split(sep).pop(), sha256: fileHash(log), sessionId: init?.session_id ?? null, claudeCodeVersion: init?.claude_code_version ?? null,
      sessionModel: init?.model ?? null, assistantModels: [...assistantModels].sort(),
      runtimeModels: result ? Object.keys((result.modelUsage as Json | undefined) ?? {}).sort() : [],
      costUSD: result?.total_cost_usd ?? null, numTurns: result?.num_turns ?? null, terminal: result?.subtype ?? "no-result (killed or crashed)",
      permissionDenials: Array.isArray(result?.permission_denials) ? (result!.permission_denials as unknown[]).length : null,
    };
  });
}

function officialReceipts(P: string): Json {
  const spaces = join(P, "aidlc", "spaces");
  const intents: Json[] = [];
  for (const space of existsSync(spaces) ? readdirSync(spaces) : []) {
    const root = join(spaces, space, "intents");
    if (!existsSync(root)) continue;
    for (const intent of readdirSync(root)) {
      const dir = join(root, intent);
      if (!lstatSync(dir).isDirectory() || !existsSync(join(dir, "aidlc-state.md"))) continue;
      // Official receipts: state, audit shards, review records, decision JSONL.
      const files = walkFiles(dir).filter((rel) => /^(aidlc-state\.md|audit\/.+\.md|\.aidlc-engine\/reviews\/.+\.json|.+\.jsonl)$/.test(rel));
      const state = existsSync(join(dir, "aidlc-state.md")) ? readFileSync(join(dir, "aidlc-state.md"), "utf8") : "";
      intents.push({
        space, intent,
        stages: state.split("\n").flatMap((line) => { const m = /^- \[(.)\] ([a-z0-9-]+) — (EXECUTE|SKIP)/.exec(line); return m ? [{ mark: m[1], stage: m[2], disposition: m[3] }] : []; }),
        receipts: files.map((rel) => ({ path: relative(P, join(dir, rel)), sha256: fileHash(join(dir, rel)), bytes: statSync(join(dir, rel)).size })),
      });
    }
  }
  return { intentCount: intents.length, intents };
}

export async function manifest(src: string, product: string, logs: string[]): Promise<Json> {
  const p = paths(src, product);
  const read = (rel: string) => existsSync(join(p.P, rel)) ? { path: rel, sha256: fileHash(join(p.P, rel)), content: readFileSync(join(p.P, rel), "utf8") } : null;
  const dConfig = await import(join(p.P, ".claude", "tools", "d-acceleration", "d-config.ts")) as { resolveDConfig: (dir: string) => Json };
  const tool = (cmd: string, args: string[]) => run(cmd, args, p.P).stdout.trim();
  const productGit = existsSync(join(p.P, ".git")) ? {
    head: git(p.P, ["rev-parse", "HEAD"]),
    refs: git(p.P, ["for-each-ref", "--format=%(refname) %(objectname)"]).split("\n").filter(Boolean),
    dirty: git(p.P, ["status", "--porcelain"]).split("\n").filter(Boolean).length,
  } : null;
  const parityReport = await parity(p.S, p.P);
  return {
    schema: "aidlc-d-clean-target/v1",
    source: { sha: git(p.S, ["rev-parse", "HEAD"]), branch: git(p.S, ["rev-parse", "--abbrev-ref", "HEAD"]), dirtyFiles: git(p.S, ["status", "--porcelain"]).split("\n").filter(Boolean) },
    package: {
      distClaude: treeHash(join(p.dist, ".claude")),
      dAcceleration: treeHash(join(p.dist, ".claude", "tools", "d-acceleration")),
      uiPocPlugin: treeHash(p.pluginRoot),
      cPayload: treeHash(join(p.S, C_PAYLOAD_ROOT)),
    },
    runtime: {
      installedClaude: treeHash(join(p.P, ".claude")),
      dAcceleration: treeHash(join(p.P, ".claude", "tools", "d-acceleration")),
      cPayload: treeHash(join(p.P, C_PAYLOAD_ROOT)),
      parity: { ok: parityReport.ok, resolvedModules: parityReport.resolvedModules, outsideProduct: parityReport.outsideProduct.length, changedFromDist: parityReport.changedFromDist },
    },
    tools: { bun: Bun.version, claude: tool("claude", ["--version"]), aidlc: tool(process.execPath, [join(p.P, ".claude", "tools", "aidlc.ts"), "--version"]) },
    config: {
      files: [read(".claude/d-acceleration.jsonc"), read(".claude/d-acceleration.local.jsonc"), read(".claude/d-acceleration.json"), read(".claude/d-acceleration.local.json")].filter(Boolean),
      effective: dConfig.resolveDConfig(p.P),
      settingsSha256: fileHash(join(p.P, ".claude", "settings.json")),
      installReceipt: existsSync(join(p.P, RECEIPT)) ? { path: RECEIPT, sha256: fileHash(join(p.P, RECEIPT)) } : null,
    },
    models: claudeRunIdentities(logs),
    official: officialReceipts(p.P),
    productGit,
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => { const at = argv.indexOf(name); return at < 0 ? undefined : argv[at + 1]; };
  const all = (name: string) => argv.flatMap((value, index) => (argv[index - 1] === name ? [value] : []));
  const src = flag("--src"), product = flag("--product"), out = flag("--out");
  try {
    if (!src || !product) throw new SetupStop("usage: fresh-install.ts <install|update|parity|manifest> --src ABS_SRC --product ABS_PRODUCT [--out FILE] [--run-log FILE ...] [--legacy-install-commit SHA]");
    let result: unknown;
    if (argv[0] === "install") result = await install(src, product);
    else if (argv[0] === "update") result = await update(src, product, flag("--legacy-install-commit"));
    else if (argv[0] === "parity") result = await parity(src, product);
    else if (argv[0] === "manifest") result = await manifest(src, product, all("--run-log"));
    else throw new SetupStop("mode must be install, update, parity, or manifest");
    const text = `${JSON.stringify(result, null, 2)}\n`;
    if (out) writeFileSync(out, text); else process.stdout.write(text);
    if (argv[0] === "parity" && !(result as ParityReport).ok) process.exit(1);
  } catch (error) {
    process.stderr.write(`${error instanceof SetupStop ? "setup stop" : "error"}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
