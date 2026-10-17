#!/usr/bin/env bun
// Supplemental PR Lens review for Build and Test (optional plugin pr-lens-review).
// Installed at PRODUCT/<harness>/tools/pr-lens-review.ts. Every command first
// asks D's gate (one owner of the switch features.prLensReview and of the
// pinned-install check): OFF does nothing, ON without the pinned install fails
// closed with a one-line next step. Nothing here touches review, sensor,
// approval, or gate state; the report is a supplement, never a verdict.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DISCLAIMER = "semantic source/requirements/test comparison is an AI judgment, not a machine guarantee";
const toolsDir = import.meta.dir;
const harnessDir = basename(resolve(toolsDir, ".."));
const root = resolve(toolsDir, "..", "..");
const argv = process.argv.slice(2); const command = argv.shift();
const flag = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const fail = (message: string, code = 1): never => { process.stderr.write(`${message}\n`); process.exit(code); };

type Gate = { status: "skipped-by-config" | "ready" | "not-ready"; reason?: string; detail?: string; next?: string };
const gateModule = join(toolsDir, "d-acceleration", "pr-lens-gate.ts");
const pinModule = join(toolsDir, "d-acceleration", "pr-lens-pin.ts");
if (!existsSync(gateModule) || !existsSync(pinModule)) fail(`pr-lens-review needs the installed D runtime (${harnessDir}/tools/d-acceleration/pr-lens-gate.ts); install D first, then run the D pr-lens setup`, 2);
const { prLensGate, prLensGateLine } = await import(gateModule) as { prLensGate: (dir: string) => Gate; prLensGateLine: (gate: Gate) => string };
const { PR_LENS_PIN, PR_LENS_VENDOR_DIR, PR_LENS_CLI } = await import(pinModule) as { PR_LENS_PIN: string; PR_LENS_VENDOR_DIR: string; PR_LENS_CLI: string };

let gate: Gate;
try { gate = prLensGate(root); } catch (error) { fail(`D configuration invalid: ${(error as Error).message}`, 2); }
if (gate!.status === "skipped-by-config") { process.stdout.write(`${JSON.stringify({ status: "skipped-by-config", command, prLensRun: false })}\n`); process.exit(0); }
if (gate!.status !== "ready") fail(prLensGateLine(gate!), 2);

const cli = join(root, PR_LENS_VENDOR_DIR, PR_LENS_CLI);
const exec = (cmd: string, args: string[], encoding: BufferEncoding | "buffer" = "utf8") => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: encoding === "buffer" ? null : encoding, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(String(r.stderr || r.stdout || `${cmd} failed`).trim());
  return r.stdout as string | Buffer;
};
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const rel = (path: string) => relative(root, resolve(root, path)).replaceAll("\\", "/");
const escaped = harnessDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Setup/integration surfaces are never application code.
const excluded = new RegExp(`^(?:${escaped}/|\\.agents/|\\.vendor/|\\.pr-lens/|aidlc/|\\.aidlc-engine/)`);
// AI-DLC intent artifacts are supporting evidence only. Append-only audit shards,
// workflow state, engine files, and this review's own outputs change while the
// review is written, so they are not part of the frozen snapshot.
const aidlcEvidence = /^aidlc\/spaces\/[^/]+\/intents\/(?!\.aidlc-engine(?:\/|$)).+/;
const volatileEvidence = /(?:\/audit\/|\/\.aidlc-engine\/|\/aidlc-state\.md$|\/construction\/build-and-test\/pr-lens-review\.(?:md|json)$)/;
const nul = (data: Buffer) => data.toString("utf8").split("\0").filter(Boolean);
const fileInfo = (path: string, status: string) => {
  const absolute = join(root, path); const bytes = existsSync(absolute) ? readFileSync(absolute) : Buffer.alloc(0);
  return { path, status, binary: bytes.includes(0), size: bytes.length, sha256: `sha256:${hash(bytes)}` };
};
const snapshot = (base: string) => {
  const head = String(exec("git", ["rev-parse", "HEAD"])).trim();
  const changed = nul(exec("git", ["diff", "--name-only", "-z", "--find-renames", base, "--"], "buffer") as Buffer);
  const untracked = nul(exec("git", ["ls-files", "--others", "--exclude-standard", "-z"], "buffer") as Buffer);
  const all = [...new Set([...changed, ...untracked])].sort();
  const paths = all.filter((p) => !excluded.test(p));
  const files = paths.map((p) => fileInfo(p, untracked.includes(p) ? "untracked" : "changed"));
  const supportingEvidence = all.filter((p) => aidlcEvidence.test(p) && !volatileEvidence.test(p)).map((p) => fileInfo(p, untracked.includes(p) ? "untracked" : "changed"));
  return { head, untracked, paths, files, supportingEvidence };
};

try {
  if (command === "prepare") {
    const requested = flag("--base"); const out = resolve(root, flag("--out") ?? ".pr-lens/review-context.json");
    if (!requested) throw new Error("prepare requires --base <commit>");
    // A ref name is resolved once here, so graph provenance and verify compare commit SHAs.
    const base = String(exec("git", ["rev-parse", "--verify", `${requested}^{commit}`])).trim();
    const { head, untracked, paths, files, supportingEvidence } = snapshot(base);
    if (!paths.length) throw new Error("no application diff exists; refusing to review setup/harness changes as application code");
    const textPaths = files.filter((f) => !f.binary).map((f) => f.path);
    const trackedText = textPaths.filter((p) => !untracked.includes(p));
    const patches = trackedText.length ? String(exec("git", ["diff", "--find-renames", base, "--", ...trackedText])) : "";
    const untrackedText = files.filter((f) => f.status === "untracked" && !f.binary).map((f) => `\n--- /dev/null\n+++ b/${f.path}\n@@ untracked file (${f.size} bytes) @@\n${readFileSync(join(root, f.path), "utf8")}`).join("\n");
    const preparedWorktreeHash = `sha256:${hash(JSON.stringify({ head, files, supportingEvidence }))}`;
    const context = { schemaVersion: 3, prLensSha: PR_LENS_PIN, base, head, preparedWorktreeHash, files, supportingEvidence, boundaries: { applicationExcludes: [`${harnessDir}/`, ".agents/", ".vendor/", ".pr-lens/", "aidlc/", ".aidlc-engine/"], aidlcArtifacts: "supporting-evidence-only" }, binaryPolicy: "hash-and-metadata-only", diffSha256: `sha256:${hash(patches + untrackedText)}` };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(context, null, 2)}\n`); writeFileSync(join(dirname(out), "application.diff"), patches + untrackedText);
    console.log(rel(out));
  } else if (command === "validate-render") {
    const graph = resolve(root, flag("--graph") ?? ".pr-lens/graph.json");
    const out = resolve(root, flag("--out") ?? ".pr-lens/render");
    if (!existsSync(graph)) throw new Error(`graph document missing: ${rel(graph)}`);
    // Local validate/render only: no analyze, comment, canvas, auth, or publication.
    process.stdout.write(String(exec(process.execPath, [cli, "validate", graph])));
    process.stdout.write(String(exec(process.execPath, [cli, "render", graph, "--theme", "light", "--out", out, "--no-config"])));
    console.log(`render manifest: ${rel(join(out, "manifest.json"))}`);
  } else if (command === "verify-report") {
    const reportPath = resolve(root, flag("--report") ?? ""); const metadataPath = resolve(root, flag("--metadata") ?? ""); const contextPath = resolve(root, flag("--context") ?? ".pr-lens/review-context.json");
    for (const p of [reportPath, metadataPath, contextPath]) if (!existsSync(p)) throw new Error(`required review file missing: ${rel(p)}`);
    const report = readFileSync(reportPath, "utf8"); for (const h of ["## Scope and provenance", "## Findings", "## Diagram cross-check", "## Tests and limits"]) if (!report.includes(h)) throw new Error(`review report missing ${h}`);
    const context = JSON.parse(readFileSync(contextPath, "utf8")); const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    if (metadata.schemaVersion !== 1 || metadata.prLensSha !== PR_LENS_PIN) throw new Error("review metadata schema or PR Lens SHA mismatch");
    if (metadata.context?.path !== rel(contextPath) || metadata.context.sha256 !== `sha256:${hash(readFileSync(contextPath))}` || metadata.context.preparedWorktreeHash !== context.preparedWorktreeHash) throw new Error("review metadata context mismatch");
    const expectedPaths = context.files.map((f: { path: string }) => f.path); if (JSON.stringify(metadata.reviewedPaths) !== JSON.stringify(expectedPaths)) throw new Error("reviewed paths do not exactly match prepared context");
    const current = snapshot(context.base);
    if (current.head !== context.head || JSON.stringify(current.files) !== JSON.stringify(context.files)) throw new Error("application HEAD/path set/content changed after prepare");
    if (JSON.stringify(current.supportingEvidence) !== JSON.stringify(context.supportingEvidence)) throw new Error("supporting evidence path set/content changed after prepare");
    if (`sha256:${hash(JSON.stringify({ head: current.head, files: current.files, supportingEvidence: current.supportingEvidence }))}` !== context.preparedWorktreeHash) throw new Error("review input snapshot changed after prepare");
    for (const key of ["graph", "renderManifest"]) { const item = metadata[key]; const p = resolve(root, item?.path ?? ""); if (!item?.path || !existsSync(p) || item.sha256 !== `sha256:${hash(readFileSync(p))}`) throw new Error(`${key} evidence mismatch`); }
    const graph = JSON.parse(readFileSync(resolve(root, metadata.graph.path), "utf8")); if (graph.provenance?.base?.sha !== context.base || graph.provenance?.head?.sha !== context.head) throw new Error("graph provenance does not match context");
    if (!Array.isArray(metadata.testEvidence) || !metadata.testEvidence.length) throw new Error("test evidence is required");
    for (const item of metadata.testEvidence) { const p = resolve(root, item.path); if (!existsSync(p) || item.sha256 !== `sha256:${hash(readFileSync(p))}`) throw new Error(`test evidence mismatch: ${item.path}`); }
    if (metadata.semanticCrossCheck?.performedBy !== "ai-reviewer" || metadata.semanticCrossCheck?.disclaimer !== DISCLAIMER) throw new Error("semantic cross-check disclaimer missing");
    console.log("review file integrity and provenance valid; semantic quality remains an AI judgment; this is a supplement and decides no gate");
  } else throw new Error("usage: pr-lens-review.ts <prepare|validate-render|verify-report>");
} catch (error) {
  fail(`pr-lens-review ${command ?? ""}: ${(error as Error).message}`.replace(/\s+$/, ""));
}
