# Verification procedure

## Local functional verification

1. Run `bun test poc/d-acceleration/tests`.
2. Run `bun poc/d-acceleration/benchmark.ts` and retain its JSON. Treat the
   reduction as a synthetic critical-path estimate only.
3. If Clef is already running, set `clef.enabled=true` on a synthetic,
   non-confidential ambiguous task. Confirm the route records `source=clef`, a
   confidence, and routing latency. Stop neither the service nor other work.
4. Repeat with an unreachable loopback port and a low-confidence fixture server;
   both must produce `source=fallback`, `tier=judgment`.

## Real-model A/B (requires existing authorized runtime; no new API purchase)

Use the same synthetic prompt set, acceptance tests, caller-supplied model
requests, concurrency cap, and warm/cold policy for both paths. Availability
and actual model identity are established only by the execution result:

- Baseline: official AI-DLC ordering with no optional design wave/swarm.
- Treatment: the generated plan, dispatched only through engine-issued
  `directive.wave` and the official swarm worktrees.

Record separately: end-to-end wall time, planner/routing time, queue time,
per-task model ID actually reported by the runtime, attempts and escalations,
input/output/cache tokens, whether price metadata exists, calculated cost only
when it does, acceptance-test results, approval/review/audit completeness, and
artifact hashes. A plan's requested model is not evidence that the runtime used
it. If the runtime exposes no actual model identity or usage, mark those fields
`unverified`/`unavailable`; do not infer them.

Run four arms separately: baseline, routing only, parallel only, and combined.
Include validation and rework time in the end-to-end total. Sweep at least
concurrency 1, 2, and the resource-safe cap rather than treating 2 as a fixed
limit; record CPU pressure, memory pressure, queueing, and Clef's single-request
serialization. Back off when resource pressure or validation failures grow.

## Minimal authenticated-terminal reproduction

Use only synthetic, non-confidential input and an already authorized user
terminal. Do not log in, install packages, buy API access, or send company data
to a new service. If authentication or model availability fails, record it and
stop.

1. Work from the pushed branch and a disposable AI-DLC project/intent:

   ```bash
   cd <D checkout containing the merged Arm C UI baseline>
   git status --short --branch
   git status --short --branch
   git rev-parse HEAD
   mkdir -p /tmp/aidlc-d-evidence
   ```

   Use a disposable D PRODUCT with the Arm C UI plugin composed and its exact pinned payload installed. Do not use A, B, a standalone C checkout, a production intent, or an existing approval ledger.

2. Reuse the existing local Clef installation. Check it without reading
   environment values: `curl --fail http://127.0.0.1:18742/health`. If it is
   stopped and needs no install/download, use a separate terminal:

   ```bash
   cd /Users/cb-329/work/cloudflare/clef/local
   ./start.sh
   ./test.sh
   ```

   Record whether this test started it. Never stop a pre-existing shared
   process; if this test started it, `./stop.sh` is the rollback.

3. Choose three model request values configured for that user terminal. These
   assignments do not prove availability:

   ```bash
   D_FAST_MODEL='<fast-model-request>'
   D_BALANCED_MODEL='<balanced-model-request>'
   D_JUDGMENT_MODEL='<judgment-model-request>'
   ```

   Preserve requested, launched, and runtime-reported identities separately.
   A missing runtime identity remains `unverified`.

4. Have the official host obtain fresh `orchestrate next` output for the
   disposable intent. Handoff is permitted only for the same active
   `run-stage` with `gate: false` and a policy-supported seam. Questions,
   approvals, reviews, official mob/subagent/pipeline, swarm, another stage, or
   another record remain with the official host. For read-only fanout, copy
   `fixtures/read-only-fanout.json`, replace the example directive with the
   exact host-issued directive, use synthetic evidence paths, and populate its
   tiered model request catalog.

5. Start read-only fanout with `maxParallel: 1`; try `2` only after quality
   checks pass. Inspect the launch without a model call first:

   ```bash
   bun poc/d-acceleration/read-only-fanout.ts \
     --input /tmp/aidlc-d-fanout.json \
     --project-dir '<disposable-project-absolute-path>' \
     --framework-dir "$PWD/core" \
     --dry-run | tee /tmp/aidlc-d-evidence/fanout-dry-run.json
   ```

   Remove `--dry-run` for the treatment. The runner obtains another fresh
   `next` immediately before launch. Save stdout and stderr separately.

6. For an official design Unit wave, the host may invoke:

   ```bash
   bun poc/d-acceleration/conductor.ts \
     --project-dir '<disposable-project-absolute-path>' \
     --engine-dir "$PWD/core/tools" \
     --worker claude \
     --claude-fast "$D_FAST_MODEL" \
     --claude-balanced "$D_BALANCED_MODEL" \
     --claude-judgment "$D_JUDGMENT_MODEL" \
     --clef-url http://127.0.0.1:18742 \
     --timeout-ms 120000 \
     > /tmp/aidlc-d-evidence/design-treatment.json \
     2> /tmp/aidlc-d-evidence/design-treatment.stderr
   ```

   Omit `--clef-low-risk-units` unless specific Units were explicitly reviewed
   as low risk. Never use disposable fake-artifact mode as real-model evidence.

7. Run the baseline from a separately reset disposable project with the same
   starting commit, intent inputs, prompts, requested model, quality checks,
   warm/cold policy, and approvals. Let the official host execute serially
   without D's optional fanout/wave dispatch. Save `baseline.*` beside the
   treatment logs. Compare end-to-end, routing, queue, and worker time; retries
   and rework; runtime-reported identity and usage; artifact hashes; tests;
   review, approval, and audit completeness; and host resource pressure.

8. Stop by interrupting only the PoC process. Preserve logs and the disposable
   project for diagnosis. Use `git switch main` to leave the feature branch.
   Remove only the disposable project after archiving evidence. Stop Clef only
   when this test started it, using its documented `./stop.sh`.

This is a bounded proof procedure, not completion of automatic acceleration for
all stages. Cross-stage scheduling, approvals, reviews, official ensembles,
pipeline stages, and code-generation swarm settlement remain delegated to the
official host.
