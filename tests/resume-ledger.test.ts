import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DirectiveFingerprintMismatchError,
  fingerprintDirective,
  loadResumeLedger,
  recordUnitSuccess,
  unitsToResume,
} from "../poc/d-acceleration/resume-ledger.ts";

const roots: string[] = [];
const temporaryLedger = () => {
  const root = mkdtempSync(join(tmpdir(), "aidlc-d-ledger-"));
  roots.push(root);
  return { root, path: join(root, "state", "resume.json") };
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("D acceleration resume ledger", () => {
  test("fingerprints equivalent directives deterministically", () => {
    expect(fingerprintDirective({ stage: "functional-design", wave: { batch_index: 0 } })).toBe(
      fingerprintDirective({ wave: { batch_index: 0 }, stage: "functional-design" }),
    );
    expect(fingerprintDirective({ entries: ["alpha", "beta"] })).not.toBe(fingerprintDirective({ entries: ["beta", "alpha"] }));
  });

  test("atomically persists success and skips it on resume", () => {
    const { root, path } = temporaryLedger();
    const directive = { kind: "run-stage", stage: "functional-design", wave: { batch_index: 0, entries: [{ unit: "alpha" }, { unit: "beta" }] } };
    expect(unitsToResume(path, directive, ["alpha", "beta"])).toEqual(["alpha", "beta"]);

    recordUnitSuccess(path, directive, "alpha", { receipt: "accepted" }, "2026-10-16T00:00:00.000Z");

    expect(existsSync(path)).toBeTrue();
    expect(unitsToResume(path, directive, ["alpha", "beta"])).toEqual(["beta"]);
    expect(loadResumeLedger(path, directive).succeeded.alpha).toMatchObject({
      completedAt: "2026-10-16T00:00:00.000Z",
      result: { receipt: "accepted" },
    });
    expect(readdirSync(join(root, "state"))).toEqual(["resume.json"]);
    expect(() => JSON.parse(readFileSync(path, "utf8"))).not.toThrow();
  });

  test("does not overwrite an existing successful unit", () => {
    const { path } = temporaryLedger();
    const directive = { kind: "run-stage", stage: "functional-design", wave: { batch_index: 2 } };
    recordUnitSuccess(path, directive, "alpha", { attempt: 1 }, "2026-10-16T00:00:00.000Z");
    recordUnitSuccess(path, directive, "alpha", { attempt: 2 }, "2026-10-16T01:00:00.000Z");
    expect(loadResumeLedger(path, directive).succeeded.alpha).toMatchObject({
      completedAt: "2026-10-16T00:00:00.000Z",
      result: { attempt: 1 },
    });
  });

  test("refuses to reuse successes for a different issued directive", () => {
    const { path } = temporaryLedger();
    recordUnitSuccess(path, { stage: "functional-design", wave: { batch_index: 0 } }, "alpha");
    expect(() => loadResumeLedger(path, { stage: "functional-design", wave: { batch_index: 1 } })).toThrow(
      DirectiveFingerprintMismatchError,
    );
  });
});
