import { describe, expect, test } from "bun:test";
import { claudeWorkerLaunch, fakeWorkerLaunch, runWorker } from "../worker-adapters.ts";

const limits = { projectDir: process.cwd(), timeoutMs: 1_000, maxStdoutBytes: 4_096, maxStderrBytes: 4_096 };

describe("worker adapters", () => {
  test("fake launch uses an argv array and captures both output streams", async () => {
    const launch = fakeWorkerLaunch({ script: `${import.meta.dir}/../fake-worker.ts`, task: "alpha", stage: "functional-design", unit: "alpha", tier: "fast", model: "fixture-model", durationMs: 1, retryOrdinal: 0 });
    expect(launch.args).toContain("fixture-model");
    const result = await runWorker(launch, limits);
    expect(result.ok).toBe(true);
    expect(result.requestedModel).toBe("fixture-model");
    expect(result.runtimeReportedModel).toBeNull();
  });

  test("times out and terminates a child", async () => {
    const launch = { kind: "fake" as const, executable: process.execPath, args: ["-e", "await Bun.sleep(5000)"], requestedModel: null, requestedEffort: null };
    const result = await runWorker(launch, { ...limits, timeoutMs: 20 });
    expect(result.failure).toBe("timeout");
    expect(result.endedAt - result.startedAt).toBeLessThan(2_000);
  });

  test("caps output and kills the producer", async () => {
    const launch = { kind: "fake" as const, executable: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(10000)); await Bun.sleep(5000)"], requestedModel: null, requestedEffort: null };
    const result = await runWorker(launch, { ...limits, maxStdoutBytes: 32 });
    expect(result.failure).toBe("output-limit");
    expect(new TextEncoder().encode(result.stdout).byteLength).toBeLessThanOrEqual(32);
    expect(result.stdoutTruncated).toBe(true);
  });

  test("supports caller cancellation", async () => {
    const controller = new AbortController();
    const launch = { kind: "fake" as const, executable: process.execPath, args: ["-e", "await Bun.sleep(5000)"], requestedModel: null, requestedEffort: null };
    setTimeout(() => controller.abort(), 20);
    const result = await runWorker(launch, { ...limits, signal: controller.signal });
    expect(result.failure).toBe("cancelled");
  });

  test("Claude argv is explicit and missing executable fails without login retry", async () => {
    const launch = claudeWorkerLaunch({ model: "runtime-confirmed-model", effort: "medium", prompt: "synthetic fixture", executable: "/definitely/missing/claude" });
    expect(launch.args).toEqual(["--print", "--output-format", "json", "--permission-prompts", "none", "--model", "runtime-confirmed-model", "--effort", "medium", "synthetic fixture"]);
    const result = await runWorker(launch, limits);
    expect(result.failure).toBe("unavailable");
    expect(result.argv.filter((value) => /login/i.test(value))).toEqual([]);
  });

  test("independent results can be collected with allSettled", async () => {
    const launches = [0, 1].map((ordinal) => ({ kind: "fake" as const, executable: process.execPath, args: ["-e", ordinal ? "process.exit(2)" : "process.stdout.write('{}')"], requestedModel: null, requestedEffort: null }));
    const settled = await Promise.allSettled(launches.map((launch) => runWorker(launch, limits)));
    expect(settled.every((item) => item.status === "fulfilled")).toBe(true);
    expect(settled.map((item: any) => item.value.ok)).toEqual([true, false]);
  });
});
