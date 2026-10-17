// Read-only probe: plans grounding snapshots against reference repo B under default, raised, and ceiling caps. No worker calls, no writes to B.
import { spawnSync } from "node:child_process";
const G = process.argv[2], B = process.argv[3];
const { resolveGroundingRoots, snapshotGroundingInputs, DEFAULT_GROUNDING_LIMITS, GROUNDING_LIMIT_CEILINGS } = await import(G);
const head = spawnSync("git", ["-C", B, "rev-parse", "HEAD"], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).stdout.trim();
const cases = [
  ["small source root", "source", ["core/tools/aidlc-version.ts"]],
  ["module source root", "source", ["harness/kddi/tools"]],
  ["large source root", "source", ["core/tools"]],
  ["spec root docs/reference", "spec", ["docs/reference"]],
  ["whole repo root", "source", ["."]],
  ["node_modules root", "source", ["node_modules"]],
];
const profiles = { default: DEFAULT_GROUNDING_LIMITS, raised: { maxEvidenceFiles: 1000, maxInputBytes: 2_000_000 }, ceiling: GROUNDING_LIMIT_CEILINGS };
const out = { repo: "reference-repo-B (read-only)", head, workerCalls: 0, artifact: "README.md", profiles, cases: [] as unknown[] };
for (const [name, lane, roots] of cases) {
  const resolved = resolveGroundingRoots(B, roots);
  const row: Record<string, unknown> = { name, lane, roots };
  for (const [profile, limits] of Object.entries(profiles)) {
    const start = performance.now();
    try {
      const snap = snapshotGroundingInputs([`${B}/README.md`], resolved.roots, limits);
      row[profile] = { action: "planned", evidenceFiles: snap.evidenceFiles.length, bytes: [...snap.artifactFiles, ...snap.evidenceFiles].reduce((s: number, e: { bytes: number }) => s + e.bytes, 0), ms: Math.round(performance.now() - start) };
    } catch (error) { row[profile] = { action: "failed-closed", error: (error as Error).message, ms: Math.round(performance.now() - start) }; }
  }
  out.cases.push(row);
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
