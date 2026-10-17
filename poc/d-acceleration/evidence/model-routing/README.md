# Model identity and routing evidence (2026-10-17)

> **Clef declined (2026-10-17).** Based on the live evaluation in section 4, the
> owner decided not to integrate Clef into D. Section 4 found a 0.67 agreement
> rate, a judgment task under-routed to balanced, about 1.3 s per serialized
> route, and no speed-up. Clef routing support was removed in
> `refactor(d): remove Clef routing support`. `clef-eval.ts` and
> `tests/clef-routing.test.ts`, which section 4 cites, exist only in git
> history. The Clef records below are kept as decision evidence. Model-identity
> verification, the planner-owned quality floor, and effort/route-reason
> recording remain.

Claude Code CLI `2.1.302`, already-authenticated local terminal, synthetic
non-confidential prompts only. 35 real model calls in total, CLI-reported
list-price cost about USD 0.62. Reproduce with
`bun poc/d-acceleration/model-routing-probe.ts identity|parent|compare --out DIR`
and `bun poc/d-acceleration/clef-eval.ts --url http://127.0.0.1:18742 --out FILE`.

## 1. Requested vs runtime-reported identity (`identity.json`, `identity-alias-opus.json`)

Finding: CLI 2.1.302 `--output-format json` has **no top-level `model`
field**. The earlier adapter read only `model`/`model_id`, so every real
Claude worker recorded `runtimeReportedModel: null`. The served model is
the key of `modelUsage` (with `canonicalModel`, tokens, `costUSD`,
`costBasis`). `worker-adapters.ts` now parses `modelUsage` and classifies
each result as `verified-match`, `alias-resolved`, `mismatch`, or
`unverified`. An absent identity is always `unverified`.

| Worker type (production argv builder) | haiku-5-5 | sonnet-5-5 | opus-5-5 | alias `opus` |
|---|---|---|---|---|
| design-wave worker (`claudeWorkerLaunch`) | verified-match | verified-match | verified-match | alias-resolved -> claude-opus-5-5 |
| read-only fanout worker (`planReadOnlyFanout`, `--agent`) | verified-match | verified-match | verified-match | alias-resolved |
| Issue ambiguity assessor (`ambiguityAssessorLaunch`) | verified-match | verified-match | verified-match | alias-resolved |
| delegated question assessor (`questionAssessorLaunch`) | verified-match | verified-match | verified-match | alias-resolved |
| delegated approval assessor (`approvalAssessorLaunch`, restricted PATH) | verified-match | verified-match | verified-match | alias-resolved |

Mismatches: 0 of 20. Requested effort is recorded per run. The effective effort
is `unverified` because the JSON result does not report effort. The parent
session exported `CLAUDE_EFFORT=medium`, and workers inherit it unless they
pass `--effort`. Every D launcher passes `--effort` explicitly.

## 2. Parent Haiku / worker Opus policy (`parent.json`)

The parent model was simulated through the inherited environment, which is the
only way a parent model can reach a child process. The test set
`ANTHROPIC_MODEL=claude-haiku-5-5` and
`CLAUDE_CODE_SUBAGENT_MODEL=claude-haiku-5-5`. Design-wave and read-only fanout
workers that requested `claude-opus-5-5` were served by `claude-opus-5-5`
(`verified-match`). The test found no unauthorized substitution. A control
launch without `--model` was served by Haiku. That confirms an explicit
`--model` on each D worker is required and sufficient. The real parent-session
model stays `not-observable`. `run.ts --preflight` reports it separately from
the requested worker models (`modelContract.parentSession` /
`modelContract.dWorkers`).

## 3. fast / balanced / judgment comparison (`compare.json`)

Three fixed tasks were run with acceptance checks: T1 extracts codes into a
sorted JSON array, T2 sorts nodes topologically with a lexical tie-break, and
T3 finds a requirements conflict and returns an endpoint sketch. Each task ran
once per tier through the design-wave argv. The tiers mapped to haiku/low,
sonnet/medium, and opus/high.

| Tier | Accepted | Mean wall ms | Mean CLI duration ms | Output tokens (3 tasks) | Cost USD (3 tasks) |
|---|---|---|---|---|---|
| fast (haiku, low) | 3/3 | 5058 | 2506 | 826 | 0.0048 |
| balanced (sonnet, medium) | 3/3 | 4530 | 2115 | 316 | 0.0839 |
| judgment (opus, high) | 3/3 | 5084 | 2812 | 315 | 0.1674 |

Matched-input arms ran on the same three tasks:

| Arm | Wall ms | Critical path ms | Accepted | Cost USD |
|---|---|---|---|---|
| Baseline: serial, Opus for every task (C-like host order, D default model) | 15252 | 15252 | 3/3 | 0.167 |
| D: planner-routed (T1 fast, T2/T3 balanced), concurrent | 5271 | 5266 | **2/3** | 0.050 |

The D arm's fast T1 returned `["TX","OH","UT"]`, which is unsorted. The same
prompt passed on the earlier fast run. The scheduler escalates only on process
failure, not on an acceptance defect, so the defect was not reworked. Follow-up, not implemented: design-wave
workers produce official artifacts, and only the official host, sensors, and
review judge them. The scheduler has no deterministic acceptance signal that
it could safely escalate on without becoming a second judge of the artifacts.
Routing overhead was under 1 ms.

Caveats: n=1 per cell, with no variance or significance claim. The baseline
reuses the serial judgment-tier grid runs. A warm prompt cache was possible for
both arms. The prompts are tiny, and official stage context, reviews, and gates
are excluded. Cost is the CLI `costUSD` at list price. Process start-up
dominates wall time, at about 2-3 s per call.

## 4. Clef

### 4a. Stopped (`clef-health.txt`, `clef-eval-real-endpoint.json`)

At first, `curl --fail http://127.0.0.1:18742/health` exited with 7. All 15
labeled routes fell back with `unavailable`, and no design Unit routed below
balanced.

### 4b. Live service (`clef-health-live.txt`, `clef-eval-live.json`, `clef-live-concurrency-timeout.json`)

After the person authorized it, the coordinator started Clef (PID 19559,
`./test.sh` ALL PASSED). This workstream did not start or stop it. `/health`
returned `{"status":"ok","model":"clef"}`. The evaluation ran
`clef-eval.ts --repeat 3 --timeout-ms 10000` with threshold 0.75.

| Metric | Value |
|---|---|
| Routes / Clef applied / fallbacks | 15 / 9 / 6 (all 6 `low-confidence`) |
| Accuracy when applied, against reviewer labels | 0.67 (6/9) |
| Determinism | Same answer and confidence every round |
| Design Unit below balanced | 0 (fd-unit fell back as low-confidence) |
| Protected tasks sent to Clef | 0 of 6 (approval, security, compliance, approval-handoff, code-generation, design) |
| Routing latency p50 / p95 | 1309 / 1527 ms per route |
| Throughput | 0.83 routes/s |
| Routing wall time, 15 routes: Clef vs no Clef | 18.1 s vs 0.45 ms |

Per-task results:
- `rename-constant` and `fix-typo-docs` were routed to fast correctly, with
  confidence 0.93-0.94.
- `cache-consistency`, labeled judgment, was routed to **balanced** at
  confidence 0.7511, just above the 0.75 threshold. This is an
  under-route.
- `add-pagination` and `fd-unit` were low-confidence and fell back to
  judgment, which is conservative.

At `confidenceThreshold: 0.9`, only `rename-constant` was applied.

Serialization: with `maxParallel: 5`, the per-route latencies were
1.3/2.6/3.8/5.0/6.1 s, and total wall time was 6.1 s against 7.0 s serial.
The service processes one request at a time. The default `timeoutMs: 1500`
would therefore time out most routes when they run concurrently.

Misbehavior on the live service: `timeoutMs: 50` produced `timeout` on 5/5
routes, each falling back to judgment in about 55 ms. On the next run, one
request returned `unavailable` and fell back, probably because the aborted
requests were still queued. The fixture-server cases (malformed, HTTP 500,
missing choice, low confidence) remain in `tests/clef-routing.test.ts`.

Speed-up: none on this set. Clef adds about 1.3 s of routing per eligible task
to save model cost only when it chooses fast. On the routed set it chose fast
for 2 of 5 tasks. A worker call takes about 2-5 s (section 3). Clef pays off
only when it moves a task from judgment to fast or balanced, and then it adds
the under-route risk shown above.

Suggested follow-ups:
- Raise the threshold to at least 0.8.
- Scale `timeoutMs` with queue depth, or route serially.
- Keep Clef limited to explicitly named low-risk Units (the current default).
