#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const values = process.argv.slice(2); const arg = (name: string) => values[values.indexOf(`--${name}`) + 1] ?? "";
const startedAt = Date.now(); await Bun.sleep(Number(arg("duration-ms")));
const failed = arg("fail") === "true";
if (!failed) for (const path of JSON.parse(arg("produce-json") || "[]")) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `# synthetic fixture for ${arg("task")}\n`); }
process.stdout.write(`${JSON.stringify({ task: arg("task"), stage: arg("stage"), unit: arg("unit") || null, requestedModel: arg("model") || null, launchedModel: arg("model") || null, runtimeReportedModel: null, tier: arg("tier"), retryOrdinal: Number(arg("retry-ordinal")), startedAt, endedAt: Date.now(), failed })}\n`);
if (failed) process.exitCode = 2;
