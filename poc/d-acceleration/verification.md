# Verification procedure

## Local functional verification

1. Run `bun test poc/d-acceleration/tests`. The suite uses fixture Issues,
   injected command runners, fake workers, and disposable repositories. It does
   not run a live `/loop`, contact GitHub, invoke a model, or mutate a real
   product repository.
2. Run `bun poc/d-acceleration/benchmark.ts` and retain its JSON. Treat the
   reduction as a synthetic critical-path estimate only.
3. `tests/quality-floor.test.ts` proves the planner-owned floor: design-wave
   stages and design tasks stay at `balanced` or above, and protected
   decisions stay at `judgment`. Routing makes no network call.

## Model identity and tier probe (real CLI, synthetic prompts)

```bash
bun poc/d-acceleration/model-routing-probe.ts identity --out poc/d-acceleration/evidence/model-routing
bun poc/d-acceleration/model-routing-probe.ts parent   --out poc/d-acceleration/evidence/model-routing
bun poc/d-acceleration/model-routing-probe.ts compare  --out poc/d-acceleration/evidence/model-routing
```

`identity` runs every worker type's production argv builder against each
requested model. `parent` simulates a Haiku parent through the inherited
environment while workers request Opus. `compare` runs three accepted tasks
per tier, plus a matched serial-Opus versus routed-parallel pair. Results and
caveats are in `evidence/model-routing/README.md`.

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
limit; record CPU pressure, memory pressure, and queueing. Back off when resource pressure or validation failures grow.

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

2. Choose three model request values configured for that user terminal. These
   assignments do not prove availability:

   ```bash
   D_FAST_MODEL='<fast-model-request>'
   D_BALANCED_MODEL='<balanced-model-request>'
   D_JUDGMENT_MODEL='<judgment-model-request>'
   ```

   Preserve requested, launched, and runtime-reported identities separately.
   A missing runtime identity remains `unverified`.

3. Have the official host obtain fresh `orchestrate next` output for the
   disposable intent. Handoff is permitted only for the same active
   `run-stage` with `gate: false` and a policy-supported seam. Questions,
   approvals, reviews, official mob/subagent/pipeline, swarm, another stage, or
   another record remain with the official host. For read-only fanout, copy
   `fixtures/read-only-fanout.json`, replace the example directive with the
   exact host-issued directive, use synthetic evidence paths, and populate its
   tiered model request catalog.

4. Start read-only fanout with `maxParallel: 1`; try `2` only after quality
   checks pass. Inspect the launch without a model call first:

   ```bash
   bun poc/d-acceleration/run.ts \
     --project-dir '<disposable-project-absolute-path>' \
     --fanout-input /tmp/aidlc-d-fanout.json \
     --dry-run | tee /tmp/aidlc-d-evidence/fanout-dry-run.json
   ```

   Remove `--dry-run` for the treatment. The runner obtains another fresh
   `next` immediately before launch. Save stdout and stderr separately.

5. For an official design Unit wave, the host may invoke:

   ```bash
   bun poc/d-acceleration/run.ts \
     --project-dir '<disposable-project-absolute-path>' \
     --worker claude \
     --claude-fast "$D_FAST_MODEL" \
     --claude-balanced "$D_BALANCED_MODEL" \
     --claude-judgment "$D_JUDGMENT_MODEL" \
     --timeout-ms 120000 \
     > /tmp/aidlc-d-evidence/design-treatment.json \
     2> /tmp/aidlc-d-evidence/design-treatment.stderr
   ```

   Never use disposable fake-artifact mode as real-model evidence.

6. Run the baseline from a separately reset disposable project with the same
   starting commit, intent inputs, prompts, requested model, quality checks,
   warm/cold policy, and approvals. Let the official host execute serially
   without D's optional fanout/wave dispatch. Save `baseline.*` beside the
   treatment logs. Compare end-to-end, routing, queue, and worker time; retries
   and rework; runtime-reported identity and usage; artifact hashes; tests;
   review, approval, and audit completeness; and host resource pressure.

7. Stop by interrupting only the PoC process. Preserve logs and the disposable
   project for diagnosis. Use `git switch main` to leave the feature branch.
   Remove only the disposable project after archiving evidence.

This is a bounded proof procedure, not completion of automatic acceleration for
all stages. Cross-stage scheduling, approvals, reviews, official ensembles,
pipeline stages, and code-generation swarm settlement remain delegated to the
official host.
