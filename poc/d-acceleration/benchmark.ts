#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { plan, type Input } from "./aidlc-acceleration-plan.ts";
const input = JSON.parse(readFileSync(process.argv[2] ?? "poc/d-acceleration/fixtures/synthetic-plan.json", "utf8")) as Input;
const result = await plan(input);
const durations = new Map(input.tasks.map((task) => [task.id, task.estimatedMs]));
const serialEstimateMs = input.tasks.reduce((sum, task) => sum + task.estimatedMs, 0);
const criticalPathEstimateMs = result.waves.reduce((sum, wave) => sum + Math.max(...wave.map((id) => durations.get(id) ?? 0)), 0);
const plannerOverheadMs = result.routingMetrics.plannerWallMs;
const arms = {
  baseline: { executionEstimateMs: serialEstimateMs, routingMs: 0, totalEstimateMs: serialEstimateMs },
  routingOnly: { executionEstimateMs: serialEstimateMs, routingMs: plannerOverheadMs, totalEstimateMs: serialEstimateMs + plannerOverheadMs },
  parallelOnly: { executionEstimateMs: criticalPathEstimateMs, routingMs: 0, totalEstimateMs: criticalPathEstimateMs },
  combined: { executionEstimateMs: criticalPathEstimateMs, routingMs: plannerOverheadMs, totalEstimateMs: criticalPathEstimateMs + plannerOverheadMs },
};
process.stdout.write(`${JSON.stringify({ evidenceType: "synthetic-estimate-not-real-model-measurement", sameInput: true, sameQualityContract: result.qualityContract, modelConditions: "no model execution", arms, estimatedReductionMs: serialEstimateMs - criticalPathEstimateMs, estimatedReductionPct: Number((((serialEstimateMs - criticalPathEstimateMs) / serialEstimateMs) * 100).toFixed(2)), routingMetrics: result.routingMetrics, retries: 0, fallbackCount: result.routingMetrics.fallbackCount, validation: "planner tests only", rework: "not modeled", waves: result.waves }, null, 2)}\n`);
