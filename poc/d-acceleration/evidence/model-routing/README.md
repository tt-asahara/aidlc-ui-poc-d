# Model identity and routing evidence (2026-10-17)

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
failure, not on an acceptance defect, so the defect was not reworked.
Routing overhead was under 1 ms.

Caveats: n=1 per cell, with no variance or significance claim. The baseline
reuses the serial judgment-tier grid runs. A warm prompt cache was possible for
both arms. The prompts are tiny, and official stage context, reviews, and gates
are excluded. Cost is the CLI `costUSD` at list price. Process start-up
dominates wall time, at about 2-3 s per call.

## 4. Clef (`clef-health.txt`, `clef-eval-real-endpoint.json`)

`curl --fail http://127.0.0.1:18742/health` exited with 7 (connection
refused). Per the workstream rule, Clef was **not started**. Real Clef
availability, routing accuracy, throughput, and speed-up are therefore
**未検証**.
Against the stopped endpoint, all 15 labeled routes fell back. The outcome was
`unavailable` 15/15, and no design Unit routed below balanced. The
enabled, disabled, unavailable, HTTP-error, malformed, missing-choice,
low-confidence, and timeout cases, plus the balanced floor and the
protected-decision exclusion, are covered against a real loopback fixture
server in `poc/d-acceleration/tests/clef-routing.test.ts`.

Procedure to close the Clef item. It needs explicit authorization to start a
process that uses about 16 GB:

```bash
cd /Users/cb-329/work/cloudflare/clef/local && ./start.sh && ./test.sh
curl --fail http://127.0.0.1:18742/health
cd <D worktree>
bun poc/d-acceleration/clef-eval.ts --url http://127.0.0.1:18742 --repeat 5 \
  --out poc/d-acceleration/evidence/model-routing/clef-eval-live.json
# Record accuracyWhenApplied, fallbacks, outcomes, designBelowBalanced (must be 0),
# throughputRoutesPerSec, routingMsP50/P95. Stop Clef with ./stop.sh only if this run started it.
```
