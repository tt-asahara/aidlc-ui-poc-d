import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import policy from "../stage-policy.json";

const stagesRoot = join(import.meta.dir, "..", "..", "..", "core", "aidlc-common", "stages");
const official = readdirSync(stagesRoot).flatMap((phase) => readdirSync(join(stagesRoot, phase)).filter((file) => file.endsWith(".md")).map((file) => `${phase}/${file.slice(0, -3)}`)).sort();
const mapped = policy.stages.map((entry) => `${entry.phase}/${entry.stage}`).sort();

describe("all-stage acceleration policy", () => {
  test("covers every official v2.11.0 stage exactly once", () => {
    expect(policy.stages).toHaveLength(33);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(mapped).toEqual(official);
  });
  test("never crosses stages or delegates approval/state settlement", () => {
    expect(policy.invariants).toEqual({ crossStageParallelism: false, officialDirectiveIsAuthority: true, approvalAndReviewBoundaries: "official-host", sharedStateWriter: "official-host" });
    expect(policy.stages.find((entry) => entry.stage === "approval-handoff")).toMatchObject({ parallelism: "serial-host", tier: "judgment", clef: "never" });
  });
  test("enables only proven official waves and delegates native mob, ensemble, pipeline, and swarm", () => {
    expect(policy.stages.filter((entry) => entry.status === "implemented").map((entry) => entry.stage).sort()).toEqual(["functional-design", "infrastructure-design", "nfr-design", "nfr-requirements"]);
    expect(policy.stages.find((entry) => entry.stage === "user-stories")).toMatchObject({ status: "official-delegation", parallelism: "official-mob" });
    expect(policy.stages.find((entry) => entry.stage === "practices-discovery")).toMatchObject({ status: "official-delegation", parallelism: "official-ensemble" });
    expect(policy.stages.find((entry) => entry.stage === "reverse-engineering")).toMatchObject({ status: "official-delegation", parallelism: "official-pipeline" });
    expect(policy.stages.find((entry) => entry.stage === "code-generation")).toMatchObject({ status: "official-delegation", parallelism: "official-swarm", clef: "never" });
  });
  test("keeps speculative fanout disabled and Clef away from high-risk work", () => {
    expect(policy.stages.filter((entry) => entry.status === "implemented-read-only-fanout").map((entry) => entry.stage).sort()).toEqual(["feasibility", "market-research", "performance-validation"]);
    expect(policy.stages.filter((entry) => entry.parallelism === "read-only-fanout" && entry.status !== "implemented-read-only-fanout").every((entry) => entry.status === "candidate-not-enabled")).toBeTrue();
    expect(policy.stages.filter((entry) => entry.tier === "judgment").every((entry) => entry.clef === "never")).toBeTrue();
  });
});
