import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

setDefaultTimeout(60_000);

// End-to-end source/spec grounding against a realistic brownfield repository,
// driven through the same installed entry the runtime uses
// (d-feature-checks.ts, spawned by host-stage-boundary.ts). Only the model is
// replaced by a scripted worker executable; path bounding, snapshotting,
// hashing, staleness, and evidence persistence are the production code.

const entry = join(import.meta.dir, "..", "d-feature-checks.ts");
const sandboxes: string[] = [];
afterAll(() => { for (const path of sandboxes) rmSync(path, { recursive: true, force: true }); });

const ARTIFACT = "aidlc/spaces/default/intents/orders-refund/inception/domain-design/domain-model.md";

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}
function put(root: string, path: string, content: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }

/** A small but real-looking existing service: several modules, specs, ADRs, tests, and a multi-commit history. */
function brownfield(features: Record<string, boolean>, featureInputs: Record<string, unknown>) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "d-brownfield-"))); sandboxes.push(sandbox);
  const root = join(sandbox, "orders-service"), control = join(sandbox, "control"), outside = join(sandbox, "outside");
  mkdirSync(root); mkdirSync(control); mkdirSync(outside);
  writeFileSync(join(outside, "secret.ts"), "export const leaked = 'outside the product';\n");
  git(root, "init", "-q", "-b", "main");
  put(root, "package.json", JSON.stringify({ name: "orders-service", version: "2.3.1", private: true, scripts: { test: "bun test" } }, null, 2));
  put(root, "README.md", "# orders-service\n\nLegacy order management API (2019-).\n");
  put(root, "src/shared/money.ts", "export type Money = { currency: 'JPY' | 'USD'; minor: number };\nexport const add = (a: Money, b: Money): Money => ({ currency: a.currency, minor: a.minor + b.minor });\n");
  put(root, "src/orders/repository.ts", "import type { Money } from '../shared/money';\nexport type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled';\nexport type Order = { id: string; customerId: string; status: OrderStatus; total: Money };\nexport interface OrderRepository { find(id: string): Promise<Order | null>; save(order: Order): Promise<void>; }\n");
  put(root, "src/orders/service.ts", "import type { Order, OrderRepository } from './repository';\nexport class OrderService {\n  constructor(private readonly repo: OrderRepository) {}\n  async cancel(id: string): Promise<Order> {\n    const order = await this.repo.find(id);\n    if (!order) throw new Error('order not found');\n    if (order.status === 'shipped') throw new Error('shipped orders cannot be cancelled');\n    const next = { ...order, status: 'cancelled' as const }; await this.repo.save(next); return next;\n  }\n}\n");
  put(root, "src/orders/routes.ts", "export const routes = [\n  { method: 'GET', path: '/v1/orders/:id' },\n  { method: 'POST', path: '/v1/orders/:id/cancel' },\n];\n");
  git(root, "add", "-A"); git(root, "commit", "-q", "-m", "feat: initial orders module");
  put(root, "src/billing/invoice.ts", "import { add, type Money } from '../shared/money';\nexport const invoiceTotal = (lines: Money[]): Money => lines.reduce(add);\n");
  put(root, "tests/orders.service.test.ts", "// legacy tests\n");
  put(root, "docs/spec/orders-api.md", "# Orders API\n\n- GET /v1/orders/:id returns an order.\n- POST /v1/orders/:id/cancel cancels a non-shipped order.\n- Refunds are out of scope for v1.\n");
  put(root, "docs/spec/billing.md", "# Billing\n\nInvoices sum line totals in minor units; currency is per invoice.\n");
  put(root, "docs/adr/0001-money-minor-units.md", "# ADR 0001: store money in minor units\n\nStatus: accepted\n");
  git(root, "add", "-A"); git(root, "commit", "-q", "-m", "feat: billing module, API spec, ADR");
  put(root, "src/orders/service.ts", readFileSync(join(root, "src/orders/service.ts"), "utf8").replace("order not found", "order not found: ' + id + '"));
  git(root, "add", "-A"); git(root, "commit", "-q", "-m", "fix: include id in not-found error");
  // The official AI-DLC stage artifact under review (written by the stage lead, not committed yet).
  put(root, ARTIFACT, "# Domain model: order refund\n\n- Order has statuses pending, paid, shipped, cancelled.\n- Shipped orders cannot be cancelled.\n- Cancel is exposed as POST /v1/orders/:id/cancel.\n");
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify({ features, featureInputs }));
  return { root, control, outside };
}

/** Scripted model stand-in: cites what the control file says, records its calls, and can mutate files mid-run. */
function workerExecutable(control: string, plan: { findings: unknown[]; uncertainty?: string[]; mutate?: { path: string; content: string } }) {
  writeFileSync(join(control, "plan.json"), JSON.stringify(plan));
  const script = join(control, "worker.ts");
  writeFileSync(script, `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const control = ${JSON.stringify(control)};
const plan = JSON.parse(readFileSync(control + "/plan.json", "utf8"));
appendFileSync(control + "/calls.log", JSON.stringify({ argv: process.argv.slice(2), stdin: readFileSync(0, "utf8") }) + "\\n");
if (plan.mutate) writeFileSync(plan.mutate.path, plan.mutate.content);
process.stdout.write(JSON.stringify({ findings: plan.findings, uncertainty: plan.uncertainty ?? [] }));
`);
  const wrapper = join(control, "worker.sh");
  writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`); chmodSync(wrapper, 0o755);
  return wrapper;
}
const calls = (control: string) => existsSync(join(control, "calls.log")) ? readFileSync(join(control, "calls.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { argv: string[]; stdin: string }) : [];

function runEntry(root: string, manifest: Record<string, unknown>) {
  writeFileSync(join(root, "aidlc-d-input.json"), JSON.stringify({ stage: "domain-design", artifactPaths: [ARTIFACT], ...manifest }));
  const result = spawnSync(process.execPath, [entry, "--project-dir", root, "--input", "aidlc-d-input.json"], { cwd: root, encoding: "utf8" });
  let output: any = null; try { output = JSON.parse(result.stdout); } catch { /* reported below */ }
  return { status: result.status, stderr: result.stderr, output };
}
function recheck(root: string, evidencePath: string) {
  const result = spawnSync(process.execPath, [entry, "--project-dir", root, "--recheck-evidence", evidencePath], { cwd: root, encoding: "utf8" });
  return { status: result.status, output: JSON.parse(result.stdout) };
}
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const confirmed = (claim: string, ...paths: string[]) => ({ code: "confirmed", severity: "info", claim, evidencePaths: paths, detail: "literal match in the brownfield repository" });
const ROOTS = { sourceRoots: ["src"], specRoots: ["docs/spec"] };

describe("brownfield grounding through the installed D feature-check entry", () => {
  test("source and spec grounding cite hashed, git-pinned evidence from the existing repository", () => {
    const { root, control } = brownfield({ sourceGrounding: true, specGrounding: true }, ROOTS);
    // One worker serves both lanes; each lane validates citations against its own roots.
    const exe = workerExecutable(control, { findings: [confirmed("cancel route", "src/orders/routes.ts")] });
    let run = runEntry(root, { workerExecutable: exe });
    // spec lane rejects a source-root citation: out-of-root evidence fails closed and is recorded.
    expect(run.status).toBe(2);
    expect(run.output.results.sourceGrounding).toMatchObject({ action: "grounding-findings", verdict: "READY", compliance: "grounded" });
    expect(run.output.results.specGrounding).toMatchObject({ action: "grounding-failed", verdict: "NOT-READY", compliance: "not-claimed", error: expect.stringContaining("outside configured roots") });

    // Source-only configuration: a fully evidenced run is READY with hash and git provenance.
    writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify({ features: { sourceGrounding: true }, featureInputs: ROOTS }));
    writeFileSync(join(control, "plan.json"), JSON.stringify({ findings: [confirmed("shipped orders cannot be cancelled", "src/orders/service.ts"), confirmed("cancel route", "src/orders/routes.ts")] }));
    rmSync(join(control, "calls.log"));
    run = runEntry(root, { workerExecutable: exe });
    expect(run.status).toBe(0);
    const source = run.output.results.sourceGrounding;
    expect(source).toMatchObject({ action: "grounding-findings", verdict: "READY", compliance: "grounded", workerCalls: 1, approvalRecorded: false });
    expect(source.citedEvidence.map((item: { path: string }) => item.path)).toEqual([join(root, "src/orders/routes.ts"), join(root, "src/orders/service.ts")]);
    for (const item of source.citedEvidence) expect(item.sha256).toBe(sha(item.path));
    expect(source.artifacts[0]).toMatchObject({ path: join(root, ARTIFACT), sha256: sha(join(root, ARTIFACT)) });
    expect(source.git).toEqual({ head: git(root, "rev-parse", "HEAD"), uncommittedCitedPaths: [] });
    // The model only saw the bounded snapshot: modules under src/, never README, docs, tests, or .git.
    const prompt = calls(control)[0]!.stdin;
    expect(calls(control)[0]!.argv).toEqual(["-p", "--allowedTools", "", "--permission-mode", "dontAsk"]);
    for (const shown of ["src/orders/service.ts", "src/billing/invoice.ts", "src/shared/money.ts", "order not found: ' + id + '"]) expect(prompt).toContain(shown);
    for (const hidden of ["README.md", "docs/spec/orders-api.md", "tests/orders.service.test.ts", ".git/"]) expect(prompt).not.toContain(hidden);
    expect(existsSync(run.output.evidencePath)).toBe(true);
    expect(recheck(root, run.output.evidencePath)).toMatchObject({ status: 0, output: { status: "fresh" } });
  });

  test("spec grounding refutes a claim the existing specification contradicts", () => {
    const { root, control } = brownfield({ specGrounding: true }, ROOTS);
    put(root, ARTIFACT, "# Domain model\n\n- Refund is exposed as POST /v1/orders/:id/refund.\n");
    const exe = workerExecutable(control, { findings: [{ code: "refuted", severity: "warn", claim: "refund endpoint exists", evidencePaths: ["docs/spec/orders-api.md"], detail: "spec says refunds are out of scope for v1" }] });
    const run = runEntry(root, { workerExecutable: exe });
    expect(run.status).toBe(2);
    expect(run.output).toMatchObject({ verdict: "NOT-READY", notReady: ["specGrounding"], approvalRecorded: false });
    expect(run.output.results.specGrounding).toMatchObject({ verdict: "NOT-READY", compliance: "not-claimed" });
  });

  test("evidence that goes stale after citation is detected: edit, later commit, deletion, symlink swap", () => {
    const { root, control } = brownfield({ sourceGrounding: true }, ROOTS);
    const exe = workerExecutable(control, { findings: [confirmed("shipped orders cannot be cancelled", "src/orders/service.ts")] });
    const run = runEntry(root, { workerExecutable: exe });
    expect(run.status).toBe(0);
    const evidence = run.output.evidencePath as string, service = join(root, "src/orders/service.ts");
    expect(recheck(root, evidence).status).toBe(0);
    // touch with identical bytes is not staleness: the content hash is the authority, not mtime.
    writeFileSync(service, readFileSync(service));
    expect(recheck(root, evidence).status).toBe(0);
    // A later commit changes the cited file (git-changed after citation).
    put(root, "src/orders/service.ts", readFileSync(service, "utf8").replace("shipped orders cannot be cancelled", "shipped orders may be cancelled within 1h"));
    git(root, "commit", "-q", "-am", "feat: allow late cancellation");
    let checked = recheck(root, evidence);
    expect(checked).toMatchObject({ status: 2, output: { status: "stale-or-unverifiable", checks: { sourceGrounding: { fresh: false, headMoved: true, stale: [{ path: service, reason: "hash-changed" }] } } } });
    // The stage artifact itself changing after grounding is also stale.
    git(root, "revert", "--no-edit", "HEAD");
    expect(recheck(root, evidence).status).toBe(0);
    put(root, ARTIFACT, "# Domain model rewritten after grounding\n");
    checked = recheck(root, evidence);
    expect(checked.output.checks.sourceGrounding.stale).toEqual([{ path: join(root, ARTIFACT), reason: "hash-changed" }]);
    // Deleted and symlink-swapped evidence.
    const original = readFileSync(service);
    unlinkSync(service);
    expect(recheck(root, evidence).output.checks.sourceGrounding.stale).toContainEqual({ path: service, reason: "missing" });
    writeFileSync(join(root, "src/orders/service.copy.ts"), original); symlinkSync(join(root, "src/orders/service.copy.ts"), service);
    expect(recheck(root, evidence).output.checks.sourceGrounding.stale).toContainEqual({ path: service, reason: "not-regular-file" });
  });

  test("evidence mutated while the worker runs fails closed before any READY claim", () => {
    const { root, control } = brownfield({ sourceGrounding: true }, ROOTS);
    const exe = workerExecutable(control, { findings: [confirmed("shipped orders cannot be cancelled", "src/orders/service.ts")], mutate: { path: join(root, "src/orders/service.ts"), content: "// rewritten concurrently\n" } });
    const run = runEntry(root, { workerExecutable: exe });
    expect(run.status).toBe(2);
    expect(run.output.results.sourceGrounding).toMatchObject({ action: "grounding-failed", compliance: "not-claimed", error: expect.stringContaining("grounding evidence is stale") });
  });

  test("missing evidence cited by the model fails closed", () => {
    const { root, control } = brownfield({ sourceGrounding: true }, ROOTS);
    const exe = workerExecutable(control, { findings: [confirmed("refund service exists", "src/orders/refund.ts")] });
    const run = runEntry(root, { workerExecutable: exe });
    expect(run.status).toBe(2);
    expect(run.output.results.sourceGrounding).toMatchObject({ action: "grounding-failed", error: expect.stringContaining("does not exist: src/orders/refund.ts") });
  });

  test("symlinked evidence fails closed: inside a root, as a root escaping the project, and via a symlinked ancestor", () => {
    const inside = brownfield({ sourceGrounding: true }, ROOTS);
    symlinkSync(join(inside.root, "src/orders/service.ts"), join(inside.root, "src/orders/service-alias.ts"));
    let run = runEntry(inside.root, { workerExecutable: workerExecutable(inside.control, { findings: [confirmed("x", "src/orders/service.ts")] }) });
    expect(run.output.results.sourceGrounding).toMatchObject({ action: "grounding-failed", error: expect.stringContaining("contains a symlink") });
    expect(calls(inside.control)).toHaveLength(0);

    const escaping = brownfield({ sourceGrounding: true }, { sourceRoots: ["vendor-link"] });
    symlinkSync(escaping.outside, join(escaping.root, "vendor-link"));
    run = runEntry(escaping.root, { workerExecutable: workerExecutable(escaping.control, { findings: [confirmed("x", "vendor-link/secret.ts")] }) });
    expect(run.status).toBe(2);
    expect(run.output.results.sourceGrounding).toMatchObject({ action: "off-no-valid-roots", compliance: "not-claimed", workerCalls: 0, rejectedRoots: [{ root: "vendor-link", reason: expect.stringContaining("escapes project") }] });
    expect(calls(escaping.control)).toHaveLength(0);

    const ancestor = brownfield({ sourceGrounding: true }, { sourceRoots: ["lib/orders"] });
    symlinkSync(join(ancestor.root, "src"), join(ancestor.root, "lib"));
    run = runEntry(ancestor.root, { workerExecutable: workerExecutable(ancestor.control, { findings: [confirmed("x", "lib/orders/service.ts")] }) });
    expect(run.output.results.sourceGrounding).toMatchObject({ action: "off-no-valid-roots", rejectedRoots: [{ root: "lib/orders", reason: expect.stringContaining("traverses a symlink") }] });

    // A citation through a symlinked ancestor is refused even when the root itself is valid.
    const cited = brownfield({ sourceGrounding: true }, ROOTS);
    symlinkSync(join(cited.root, "src"), join(cited.root, "src-alias"));
    run = runEntry(cited.root, { workerExecutable: workerExecutable(cited.control, { findings: [confirmed("x", "src-alias/orders/service.ts")] }) });
    expect(run.output.results.sourceGrounding).toMatchObject({ action: "grounding-failed", error: expect.stringContaining("traverses a symlink") });
  });

  test("oversized evidence fails closed before the model is called (bytes and file count)", () => {
    const big = brownfield({ sourceGrounding: true }, ROOTS);
    put(big.root, "src/generated/schema.ts", `// generated\nexport const blob = "${"x".repeat(1_000_001)}";\n`);
    let run = runEntry(big.root, { workerExecutable: workerExecutable(big.control, { findings: [confirmed("x", "src/orders/service.ts")] }) });
    expect(run.status).toBe(2);
    expect(run.output.results.sourceGrounding).toMatchObject({ action: "grounding-failed", compliance: "not-claimed", error: expect.stringContaining("exceed 1000000 bytes before read") });
    expect(calls(big.control)).toHaveLength(0);

    const many = brownfield({ sourceGrounding: true }, ROOTS);
    for (let index = 0; index < 201; index++) put(many.root, `src/migrations/${String(index).padStart(4, "0")}.ts`, `export const id = ${index};\n`);
    run = runEntry(many.root, { workerExecutable: workerExecutable(many.control, { findings: [confirmed("x", "src/orders/service.ts")] }) });
    expect(run.output.results.sourceGrounding).toMatchObject({ action: "grounding-failed", error: expect.stringContaining("exceeds 200 files") });
    expect(calls(many.control)).toHaveLength(0);
  });

  test("default caps are recorded in evidence; raised caps let the previously capped fixture pass with a >1 MiB stdin prompt", () => {
    const DEFAULTS = { maxEvidenceFiles: 200, maxInputBytes: 1_000_000 };
    const capped = brownfield({ sourceGrounding: true }, ROOTS);
    for (let index = 0; index < 201; index++) put(capped.root, `src/migrations/${String(index).padStart(4, "0")}.ts`, `export const id = ${index};\n`);
    put(capped.root, "src/generated/schema.ts", `export const blob = "${"x".repeat(1_100_000)}";\n`);
    const exe = workerExecutable(capped.control, { findings: [confirmed("shipped orders cannot be cancelled", "src/orders/service.ts")] });
    let run = runEntry(capped.root, { workerExecutable: exe });
    expect(run.status).toBe(2);
    expect(run.output.results.sourceGrounding).toMatchObject({ action: "grounding-failed", limits: DEFAULTS, error: expect.stringContaining("exceeds 200 files (featureInputs.groundingLimits.maxEvidenceFiles; ceiling 5000)") });
    expect(calls(capped.control)).toHaveLength(0);

    // Project raises only the file cap: the byte cap (default) now trips, still before any worker call.
    writeFileSync(join(capped.root, ".claude", "d-acceleration.json"), JSON.stringify({ features: { sourceGrounding: true }, featureInputs: { ...ROOTS, groundingLimits: { maxEvidenceFiles: 500 } } }));
    run = runEntry(capped.root, { workerExecutable: exe });
    expect(run.output.results.sourceGrounding).toMatchObject({ action: "grounding-failed", limits: { maxEvidenceFiles: 500, maxInputBytes: 1_000_000 }, error: expect.stringContaining("exceed 1000000 bytes before read (featureInputs.groundingLimits.maxInputBytes; ceiling 4000000)") });
    expect(calls(capped.control)).toHaveLength(0);

    // Local layer raises the byte cap field-by-field over the project file cap.
    writeFileSync(join(capped.root, ".claude", "d-acceleration.local.json"), JSON.stringify({ featureInputs: { groundingLimits: { maxInputBytes: 2_000_000 } } }));
    run = runEntry(capped.root, { workerExecutable: exe });
    expect(run.status).toBe(0);
    expect(run.output.results.sourceGrounding).toMatchObject({ action: "grounding-findings", verdict: "READY", workerCalls: 1, limits: { maxEvidenceFiles: 500, maxInputBytes: 2_000_000 } });
    expect(JSON.parse(readFileSync(run.output.evidencePath, "utf8")).results.sourceGrounding.limits).toEqual({ maxEvidenceFiles: 500, maxInputBytes: 2_000_000 });
    // The whole snapshot (larger than macOS ARG_MAX) reached the worker through stdin, not argv.
    const [call] = calls(capped.control);
    expect(call!.argv).toEqual(["-p", "--allowedTools", "", "--permission-mode", "dontAsk"]);
    expect(call!.stdin.length).toBeGreaterThan(1_100_000);
    expect(call!.stdin).toContain("src/migrations/0200.ts");
  });

  test("an out-of-range grounding cap fails closed before any read or worker call", () => {
    for (const [groundingLimits, message] of [
      [{ maxInputBytes: 4_000_001 }, "invalid featureInputs.groundingLimits.maxInputBytes: 4000001 (allowed: integer 1..4000000)"],
      [{ maxEvidenceFiles: 0 }, "invalid featureInputs.groundingLimits.maxEvidenceFiles: 0 (allowed: integer 1..5000)"],
    ] as const) {
      const fixture = brownfield({ sourceGrounding: true }, { ...ROOTS, groundingLimits });
      const run = runEntry(fixture.root, { workerExecutable: workerExecutable(fixture.control, { findings: [] }) });
      expect(run.status).toBe(2);
      expect(run.output).toBeNull();
      expect(run.stderr).toBe(`D configuration invalid: ${message} in ${join(fixture.root, ".claude", "d-acceleration.json")}\n`);
      expect(calls(fixture.control)).toHaveLength(0);
    }
  });

  test("path traversal in roots and citations fails closed", () => {
    for (const roots of [["../outside"], ["src/../../outside"], ["/etc"], ["src", "../outside"]]) {
      const fixture = brownfield({ sourceGrounding: true }, { sourceRoots: roots });
      const run = runEntry(fixture.root, { workerExecutable: workerExecutable(fixture.control, { findings: [] }) });
      expect(run.status).toBe(2);
      // A single bad root makes the lane OFF: partial coverage is never claimed.
      expect(run.output.results.sourceGrounding).toMatchObject({ action: "off-no-valid-roots", compliance: "not-claimed", verdict: "NOT-READY", workerCalls: 0 });
      expect(calls(fixture.control)).toHaveLength(0);
    }
    const fixture = brownfield({ sourceGrounding: true }, ROOTS);
    for (const cited of ["src/../../outside/secret.ts", join(fixture.outside, "secret.ts"), "src/../README.md", "src/orders/service.ts\0.md"]) {
      const run = runEntry(fixture.root, { workerExecutable: workerExecutable(fixture.control, { findings: [confirmed("x", cited)] }) });
      expect(run.status).toBe(2);
      expect(run.output.results.sourceGrounding).toMatchObject({ action: "grounding-failed", compliance: "not-claimed" });
    }
  });

  test("no valid roots reports OFF / not-compliant and never a compliance claim", () => {
    for (const featureInputs of [{}, { sourceRoots: [] }, { sourceRoots: ["does/not/exist"] }]) {
      const fixture = brownfield({ sourceGrounding: true }, featureInputs);
      const run = runEntry(fixture.root, { workerExecutable: workerExecutable(fixture.control, { findings: [confirmed("x", "src/orders/service.ts")] }) });
      expect(run.status).toBe(2);
      expect(run.output).toMatchObject({ verdict: "NOT-READY", notReady: ["sourceGrounding"], approvalRecorded: false });
      expect(run.output.results.sourceGrounding).toMatchObject({ action: "off-no-valid-roots", verdict: "NOT-READY", compliance: "not-claimed", workerCalls: 0, approvalRecorded: false, limits: { maxEvidenceFiles: 200, maxInputBytes: 1_000_000 } });
      expect(JSON.stringify(run.output)).not.toContain('"grounded"');
      expect(calls(fixture.control)).toHaveLength(0);
      // Rechecking an OFF result is never "fresh": there is no citation to vouch for.
      expect(recheck(fixture.root, run.output.evidencePath)).toMatchObject({ status: 2, output: { status: "stale-or-unverifiable" } });
    }
  });
});
