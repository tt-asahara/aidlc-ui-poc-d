import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDModelContract } from "../d-config.ts";
import { FIXTURES, identityLaunches } from "../model-routing-probe.ts";

describe("parent-session vs D-worker model contract", () => {
  test("parent is not observable without a caller report; workers default to explicit opus requests", () => {
    const project = mkdtempSync(join(tmpdir(), "d-model-contract-"));
    const contract = resolveDModelContract(project, undefined);
    expect(contract.parentSession).toMatchObject({ status: "not-observable", source: "none", model: null });
    expect(contract.dWorkers).toMatchObject({ requested: { fast: "opus", balanced: "opus", judgment: "opus" }, sources: { fast: "default", balanced: "default", judgment: "default" }, runtimeIdentity: "reported-per-worker-result" });
  });

  test("a parent Haiku report is a labelled unverified mismatch and does not change the worker Opus policy", () => {
    const project = mkdtempSync(join(tmpdir(), "d-model-contract-"));
    mkdirSync(join(project, ".claude"));
    writeFileSync(join(project, ".claude", "d-acceleration.jsonc"), JSON.stringify({ models: { fast: "claude-haiku-5-5", balanced: "claude-sonnet-5-5", judgment: "claude-opus-5-5" } }));
    const contract = resolveDModelContract(project, "claude-haiku-5-5");
    expect(contract.parentSession).toMatchObject({ status: "caller-reported-mismatch", source: "unverified-caller-report", model: "claude-haiku-5-5" });
    expect(contract.parentSession.requiredAction).toContain("parent Claude session");
    expect(contract.dWorkers.requested.judgment).toBe("claude-opus-5-5");
    expect(contract.dWorkers.sources.judgment).toBe("project");
  });

  test("run.ts --preflight reports both parent and worker models", () => {
    const project = mkdtempSync(join(tmpdir(), "d-model-contract-"));
    const result = spawnSync(process.execPath, [join(import.meta.dir, "..", "run.ts"), "--project-dir", project, "--preflight"], { cwd: project, encoding: "utf8", env: { ...process.env, AIDLC_PARENT_MODEL: "claude-haiku-5-5" } });
    const report = JSON.parse(result.stdout);
    expect(report.modelContract.parentSession).toMatchObject({ status: "caller-reported-mismatch", model: "claude-haiku-5-5" });
    expect(report.modelContract.dWorkers.requested).toEqual({ fast: "opus", balanced: "opus", judgment: "opus" });
    expect(report.modelContract.separation).toContain("cannot switch or prove");
  });

  test("every worker type the probe exercises passes an explicit --model equal to the request", () => {
    const project = mkdtempSync(join(tmpdir(), "d-model-contract-"));
    writeFileSync(join(project, "evidence.md"), "synthetic\n");
    const launches = identityLaunches("claude-opus-5-5", project, "/fixture/bin/claude");
    expect(launches.map((entry) => entry.workerType)).toEqual(["design-wave-worker", "read-only-fanout-worker", "issue-ambiguity-assessor", "delegated-question-assessor", "delegated-approval-assessor"]);
    for (const { launch } of launches) {
      expect(launch.requestedModel).toBe("claude-opus-5-5");
      expect(launch.args[launch.args.indexOf("--model") + 1]).toBe("claude-opus-5-5");
      expect(launch.args.filter((arg) => arg === "--model")).toHaveLength(1);
    }
    expect(FIXTURES.map((fixture) => fixture.accept("not json").pass)).toEqual([false, false, false]);
  });
});
