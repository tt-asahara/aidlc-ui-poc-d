// Optional pr-lens-review plugin: the D switch, the fail-closed pinned install,
// the supplemental-only contract, and compose. Uses the real generated Claude
// runtime and the real compose hooks, with a fake PR Lens renderer so the
// suite is deterministic and offline. Requires:
//   bun scripts/package.ts claude
//   bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/ui-poc claude
//   bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/pr-lens-review claude
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { D_ACCELERATION_RUNTIME, projectCoreImports } from "../../d-acceleration/d-projection.ts";
import { PR_LENS_CLI, PR_LENS_LICENSE_SHA256, PR_LENS_PIN, writePrLensReceipt } from "../../d-acceleration/pr-lens-pin.ts";

const SRC = resolve(import.meta.dir, "..", "..", "..");
const PLUGIN = join(SRC, "poc", "pr-lens-review");
const DIST = join(SRC, "dist", "claude", ".claude");
const COMPOSE = { "ui-poc": join(SRC, "poc", "ui-poc", "dist", "claude"), "pr-lens-review": join(PLUGIN, "dist", "claude") } as const;
const TIMEOUT = 120_000;
const roots: string[] = [];
let scratch = "";
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

beforeAll(() => {
  for (const required of [join(DIST, "tools", "aidlc.ts"), join(COMPOSE["ui-poc"], "hooks", "compose.ts"), join(COMPOSE["pr-lens-review"], "hooks", "compose.ts")]) {
    if (!existsSync(required)) throw new Error(`build output missing: ${relative(SRC, required)}; run bun scripts/package.ts claude and both plugin builds`);
  }
  scratch = mkdtempSync(join(tmpdir(), "pr-lens-review-test-"));
});
afterAll(() => { for (const root of [...roots, scratch]) if (root) rmSync(root, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-C", cwd, "-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
function compose(P: string, plugin: keyof typeof COMPOSE) {
  const result = spawnSync(process.execPath, [join(COMPOSE[plugin], "hooks", "compose.ts")], { cwd: P, encoding: "utf8", env: { ...process.env, AIDLC_PROJECT_DIR: P, AIDLC_PLUGIN_ROOT: COMPOSE[plugin], AIDLC_HARNESS_DIR: ".claude", AIDLC_HARNESS_NAME: "claude" } });
  expect(result.status, result.stderr).toBe(0);
}
function treeSha(dir: string): string {
  const hash = createHash("sha256");
  const walk = (d: string): void => { for (const name of readdirSync(d).sort()) { const full = join(d, name); if (lstatSync(full).isDirectory()) walk(full); else hash.update(`${relative(dir, full).split(sep).join("/")}\0${sha(readFileSync(full))}\n`); } };
  walk(dir);
  return hash.digest("hex");
}
/** A Git PRODUCT carrying the real generated Claude runtime (D included), C composed, optionally pr-lens composed. */
function product(options: { prLens?: boolean } = {}): string {
  const P = mkdtempSync(join(tmpdir(), "pr-lens-product-")); roots.push(P);
  git(P, "init", "-q", "-b", "main");
  // As the setup does: the vendored checkout, its receipt, and previews stay out of PRODUCT commits.
  appendFileSync(join(P, ".git", "info", "exclude"), "/.vendor/pr-lens/\n/.vendor/pr-lens.receipt.json\n/.pr-lens/\n");
  cpSync(DIST, join(P, ".claude"), { recursive: true });
  compose(P, "ui-poc");
  if (options.prLens ?? true) compose(P, "pr-lens-review");
  writeFileSync(join(P, "README.md"), "product\n");
  git(P, "add", "-A"); git(P, "commit", "-qm", "installed");
  return P;
}
const FAKE_CLI = `import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [cmd, graph, ...rest] = process.argv.slice(2);
if (process.env.FAKE_PR_LENS_LOG) appendFileSync(process.env.FAKE_PR_LENS_LOG, cmd + "\\n");
if (cmd === "validate") { JSON.parse(readFileSync(graph, "utf8")); console.log("fake validate ok"); }
else if (cmd === "render") { const out = rest[rest.indexOf("--out") + 1]; mkdirSync(out, { recursive: true }); writeFileSync(join(out, "manifest.json"), JSON.stringify({ kind: "render-manifest", fake: true }) + "\\n"); console.log("fake render ok"); }
else process.exit(3);
`;
/** A fake pinned checkout: own Git dir whose HEAD names the pin, the MIT licence, a fake CLI, and the setup's receipt. */
function fakeVendor(P: string, options: { head?: string; receipt?: boolean } = {}) {
  const vendor = join(P, ".vendor", "pr-lens");
  mkdirSync(join(vendor, "packages", "cli", "dist"), { recursive: true });
  expect(spawnSync("git", ["init", "-q", vendor]).status).toBe(0);
  writeFileSync(join(vendor, ".git", "HEAD"), `${options.head ?? PR_LENS_PIN}\n`);
  cpSync(join(PLUGIN, "LICENSES", "pr-lens", "LICENSE"), join(vendor, "LICENSE"));
  writeFileSync(join(vendor, PR_LENS_CLI), FAKE_CLI);
  if (options.receipt ?? true) writePrLensReceipt(P);
  return vendor;
}
function setSwitch(P: string, value: boolean | string, layer = "d-acceleration.local.jsonc") {
  writeFileSync(join(P, ".claude", layer), `{ // test\n "features": { "prLensReview": ${value} }, }\n`);
}
function run(P: string, script: string, args: string[], log?: string) {
  return spawnSync(process.execPath, [join(P, ".claude", "tools", script), ...args], { cwd: P, encoding: "utf8", env: { ...process.env, FAKE_PR_LENS_LOG: log ?? join(scratch, "unused.log") } });
}
const gate = (P: string, ...args: string[]) => run(P, join("d-acceleration", "pr-lens-gate.ts"), args);
const tool = (P: string, args: string[], log?: string) => run(P, "pr-lens-review.ts", args, log);
const preflight = (P: string) => { const r = run(P, join("d-acceleration", "run.ts"), ["--project-dir", P, "--preflight"]); return { status: r.status, json: JSON.parse(r.stdout) as Record<string, any> }; };

describe("pr-lens-review plugin contract", () => {
  test("manifest, Build and Test fragment, and skill keep the supplemental-only contract", () => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN, ".aidlc-plugin", "plugin.json"), "utf8"));
    expect(manifest).toMatchObject({ name: "pr-lens-review", dependencies: ["core"], aidlc: { contributes: { overlays: "contributions/", tools: "tools/" } } });
    const fragment = readFileSync(join(PLUGIN, "contributions", "construction", "build-and-test.md"), "utf8");
    expect(fragment).toMatch(/^---\ntarget: build-and-test\nplugin: pr-lens-review\nfragments:\n {2}- anchor: before-step:11\n {4}order: 900\n---/);
    expect(fragment).toContain("Only when application implementation exists");
    expect(fragment).toContain("bun {{HARNESS_DIR}}/tools/d-acceleration/pr-lens-gate.ts");
    expect(fragment).toContain("never decide a gate");
    expect(fragment).toContain("skipped-by-config");
    const skill = readFileSync(join(PLUGIN, "tools", "pr-lens-review", "SKILL.md"), "utf8");
    expect(skill).toContain(`coldteadotai/pr-lens@${PR_LENS_PIN}`);
    expect(skill).toContain("never replaces AI-DLC reviewers, sensors, approval gates, or test verdicts");
    // The shipped MIT notice is exactly the licence the install check pins.
    expect(sha(readFileSync(join(PLUGIN, "LICENSES", "pr-lens", "LICENSE")))).toBe(PR_LENS_LICENSE_SHA256);
  });

  test("the D gate and pin modules are packaged into the Claude runtime exactly as projected", () => {
    for (const file of ["pr-lens-gate.ts", "pr-lens-pin.ts"]) {
      expect(D_ACCELERATION_RUNTIME).toContain(file);
      expect(sha(readFileSync(join(DIST, "tools", "d-acceleration", file)))).toBe(sha(Buffer.from(projectCoreImports(readFileSync(join(SRC, "poc", "d-acceleration", file), "utf8")))));
    }
  });
});

describe("pr-lens-review compose", () => {
  test("composes beside the C UI baseline, is idempotent, and installs the exact payload", () => {
    const P = product();
    const stagePath = join(P, ".claude", "aidlc-common", "stages", "construction", "build-and-test.md");
    const stage = readFileSync(stagePath, "utf8");
    expect(stage.match(/<!-- plugin:pr-lens-review:before-step:11:900:[0-9a-f]+ -->/g)).toHaveLength(1);
    expect(stage).toContain("<!-- plugin:ui-poc:");
    expect(stage.indexOf("<!-- plugin:pr-lens-review:")).toBeLessThan(stage.indexOf("### Step 11:"));
    expect(stage.indexOf("### Step 10:")).toBeLessThan(stage.indexOf("<!-- plugin:pr-lens-review:"));
    expect(stage).toContain("bun .claude/tools/d-acceleration/pr-lens-gate.ts");
    expect(readFileSync(join(P, ".claude", "tools", "pr-lens-review.ts"), "utf8")).toBe(readFileSync(join(PLUGIN, "tools", "pr-lens-review.ts"), "utf8"));
    expect(readFileSync(join(P, ".claude", "tools", "pr-lens-review", "SKILL.md"), "utf8")).toBe(readFileSync(join(PLUGIN, "tools", "pr-lens-review", "SKILL.md"), "utf8").replaceAll("{{HARNESS_DIR}}", ".claude"));
    expect(existsSync(join(P, ".claude", "tools", "data", "plugin-contrib-pr-lens-review.json"))).toBeTrue();
    const before = treeSha(join(P, ".claude"));
    compose(P, "pr-lens-review"); compose(P, "ui-poc"); compose(P, "pr-lens-review");
    expect(treeSha(join(P, ".claude"))).toBe(before);
    expect(git(P, "status", "--porcelain")).toBe("");
  }, TIMEOUT);
});

describe("features.prLensReview switch", () => {
  test("OFF (the default) runs nothing and writes only D's skipped-by-config evidence", () => {
    const P = product();
    fakeVendor(P); // even a ready install is not run while the switch is OFF (git-excluded like a real setup)
    const log = join(scratch, "off.log");
    const result = gate(P);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ enabled: false, status: "skipped-by-config", prLensRun: false, gateDecision: "none", approvalRecorded: false });
    for (const args of [["prepare", "--base", "HEAD"], ["validate-render"], ["verify-report", "--report", "x.md", "--metadata", "x.json"]]) {
      const r = tool(P, args, log);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ status: "skipped-by-config", command: args[0], prLensRun: false });
    }
    expect(existsSync(log)).toBeFalse();
    expect(existsSync(join(P, ".pr-lens"))).toBeFalse();
    expect(git(P, "status", "--porcelain", "--untracked-files=all")).toBe("?? aidlc/.aidlc-engine/d-evidence/build-and-test-pr-lens-review.json");
    const evidence = JSON.parse(readFileSync(join(P, "aidlc", ".aidlc-engine", "d-evidence", "build-and-test-pr-lens-review.json"), "utf8"));
    expect(evidence).toMatchObject({ stage: "build-and-test", feature: "features.prLensReview", enabled: false, status: "skipped-by-config", prLensRun: false });
    const { status, json } = preflight(P);
    expect(status).toBe(0);
    expect(json.optional.features.prLensReview).toBeFalse();
    expect(json.supplementalReview.prLensReview).toEqual({ enabled: false, status: "skipped-by-config", pin: PR_LENS_PIN, decidesGates: false });
    expect(json.prerequisites.checked).toEqual([]);
  }, TIMEOUT);

  test("ON without the pinned install fails closed with a one-line next step, in the gate, the tool, and preflight", () => {
    const P = product();
    setSwitch(P, true);
    const result = gate(P);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ enabled: true, status: "not-ready", reason: "not-installed", prLensRun: false });
    expect(result.stderr).toMatch(/^PR Lens review is ON but not ready \(not-installed: \.vendor\/pr-lens is missing\); next: run the D pr-lens setup \(bun <D checkout>\/poc\/pr-lens-review\/scripts\/setup-pr-lens\.ts --product <PRODUCT>\) or set features\.prLensReview=false\n$/);
    const r = tool(P, ["prepare", "--base", "HEAD"]);
    expect(r.status).toBe(2);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(existsSync(join(P, ".pr-lens"))).toBeFalse();
    const { status, json } = preflight(P);
    expect(status).toBe(3);
    expect(json.optional.features.prLensReview).toBeTrue();
    expect(json.supplementalReview.prLensReview).toMatchObject({ enabled: true, status: "not-ready", reason: "not-installed", decidesGates: false });
    expect(json.prerequisites.unmet.map((row: { setting: string; satisfied: boolean }) => [row.setting, row.satisfied])).toEqual([["features.prLensReview", false]]);
    expect(json.prerequisites.checked).toHaveLength(2);
  }, TIMEOUT);

  test("ON with a wrong pin, a changed licence, a tampered build, or no composed plugin fails closed", () => {
    const wrongPin = product(); setSwitch(wrongPin, true); fakeVendor(wrongPin, { head: "0".repeat(40), receipt: false });
    expect(JSON.parse(gate(wrongPin, "--no-record").stdout)).toMatchObject({ status: "not-ready", reason: "pin-mismatch" });
    const tampered = product(); setSwitch(tampered, true); const vendor = fakeVendor(tampered);
    expect(JSON.parse(gate(tampered, "--no-record").stdout).status).toBe("ready");
    appendFileSync(join(vendor, PR_LENS_CLI), "// changed after setup\n");
    expect(JSON.parse(gate(tampered, "--no-record").stdout)).toMatchObject({ status: "not-ready", reason: "receipt-mismatch" });
    writePrLensReceipt(tampered); appendFileSync(join(vendor, "LICENSE"), "extra\n");
    expect(JSON.parse(gate(tampered, "--no-record").stdout)).toMatchObject({ status: "not-ready", reason: "license-mismatch" });
    const uncomposed = product({ prLens: false }); setSwitch(uncomposed, true); fakeVendor(uncomposed);
    const r = gate(uncomposed, "--no-record");
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ status: "not-ready", reason: "plugin-not-composed" });
    expect(existsSync(join(uncomposed, "aidlc"))).toBeFalse(); // --no-record writes nothing
  }, TIMEOUT);

  test("an invalid switch value fails closed with the one-line configuration reason", () => {
    const P = product(); setSwitch(P, '"yes"', "d-acceleration.jsonc");
    const r = gate(P);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^D configuration invalid: invalid D feature prLensReview in .*d-acceleration\.jsonc\n$/);
    expect(tool(P, ["validate-render"]).status).toBe(2);
  }, TIMEOUT);

  test("ON with the pinned install runs prepare, the local renderer, and verify end to end", () => {
    const P = product(); fakeVendor(P);
    setSwitch(P, false, "d-acceleration.jsonc"); setSwitch(P, true); // local overrides project
    git(P, "add", "-A"); git(P, "commit", "-qm", "vendor and switch");
    const base = git(P, "rev-parse", "HEAD");
    git(P, "branch", "review-base");
    const record = join(P, "aidlc", "spaces", "default", "intents", "demo");
    mkdirSync(join(record, "audit"), { recursive: true }); mkdirSync(join(record, "inception", "requirements-analysis"), { recursive: true }); mkdirSync(join(record, "construction", "build-and-test"), { recursive: true });
    writeFileSync(join(record, "audit", "local.md"), "audit\n");
    writeFileSync(join(record, "inception", "requirements-analysis", "requirements.md"), "requirements v1\n");
    mkdirSync(join(P, "app"), { recursive: true }); writeFileSync(join(P, "app", "greet.ts"), "export const greet = (n: string) => `Hello, ${n}`;\n");
    writeFileSync(join(P, "app", "image.bin"), Buffer.from([0, 1, 2, 255]));
    const tests = join(record, "construction", "build-and-test", "test-run.txt"); writeFileSync(tests, "1 pass\n");
    expect(JSON.parse(gate(P).stdout).status).toBe("ready");
    const prepared = tool(P, ["prepare", "--base", "review-base"]);
    expect(prepared.status, prepared.stderr).toBe(0);
    const context = JSON.parse(readFileSync(join(P, ".pr-lens", "review-context.json"), "utf8"));
    expect(context.base).toBe(base); // a ref name is resolved to its commit SHA
    expect(context.prLensSha).toBe(PR_LENS_PIN);
    expect(context.files.map((f: { path: string }) => f.path)).toEqual(["app/greet.ts", "app/image.bin"]);
    expect(context.files[1]).toMatchObject({ binary: true, size: 4 });
    // Append-only audit shards are volatile and not part of the frozen evidence snapshot.
    expect(context.supportingEvidence.map((f: { path: string }) => f.path)).toEqual(["aidlc/spaces/default/intents/demo/construction/build-and-test/test-run.txt", "aidlc/spaces/default/intents/demo/inception/requirements-analysis/requirements.md"]);
    writeFileSync(join(P, ".pr-lens", "graph.json"), JSON.stringify({ provenance: { base: { sha: base }, head: { sha: context.head } } }));
    const log = join(scratch, "on.log");
    const rendered = tool(P, ["validate-render"], log);
    expect(rendered.status, rendered.stderr).toBe(0);
    expect(readFileSync(log, "utf8")).toBe("validate\nrender\n");
    const report = join(record, "construction", "build-and-test", "pr-lens-review.md");
    writeFileSync(report, "## Scope and provenance\n## Findings\n## Diagram cross-check\n## Tests and limits\n");
    const file = (rel: string) => ({ path: rel, sha256: `sha256:${sha(readFileSync(join(P, rel)))}` });
    const metadataPath = join(record, "construction", "build-and-test", "pr-lens-review.json");
    writeFileSync(metadataPath, JSON.stringify({ schemaVersion: 1, prLensSha: PR_LENS_PIN, context: { ...file(".pr-lens/review-context.json"), preparedWorktreeHash: context.preparedWorktreeHash }, reviewedPaths: ["app/greet.ts", "app/image.bin"], graph: file(".pr-lens/graph.json"), renderManifest: file(".pr-lens/render/manifest.json"), testEvidence: [file(relative(P, tests))], semanticCrossCheck: { performedBy: "ai-reviewer", disclaimer: "semantic source/requirements/test comparison is an AI judgment, not a machine guarantee" } }));
    const verify = () => tool(P, ["verify-report", "--context", ".pr-lens/review-context.json", "--report", relative(P, report), "--metadata", relative(P, metadataPath)]);
    expect(verify().status, verify().stderr).toBe(0);
    appendFileSync(join(record, "audit", "local.md"), "ARTIFACT_CREATED pr-lens-review.md\n");
    expect(verify().status).toBe(0);
    writeFileSync(join(record, "inception", "requirements-analysis", "requirements.md"), "requirements v2\n");
    expect(verify().stderr).toContain("supporting evidence path set/content changed after prepare");
    writeFileSync(join(record, "inception", "requirements-analysis", "requirements.md"), "requirements v1\n");
    writeFileSync(join(P, "app", "late.ts"), "export const late = 1;\n");
    expect(verify().stderr).toContain("application HEAD/path set/content changed after prepare");
    rmSync(join(P, "app", "late.ts"));
    expect(verify().status).toBe(0);
    // Nothing official was touched: no review receipt, approval, or state was written by the plugin.
    expect(existsSync(join(record, "aidlc-state.md"))).toBeFalse();
    expect(existsSync(join(record, ".aidlc-engine"))).toBeFalse();
  }, TIMEOUT);

  test("ON refuses to diagram AI-DLC or setup files when no application diff exists", () => {
    const P = product(); fakeVendor(P); setSwitch(P, true);
    git(P, "add", "-A"); git(P, "commit", "-qm", "vendor and switch");
    mkdirSync(join(P, "aidlc", "spaces", "default", "intents", "demo"), { recursive: true });
    writeFileSync(join(P, "aidlc", "spaces", "default", "intents", "demo", "requirements.md"), "# R\n");
    writeFileSync(join(P, ".claude", "extra.md"), "setup\n");
    const r = tool(P, ["prepare", "--base", "HEAD"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no application diff exists");
  }, TIMEOUT);
});
