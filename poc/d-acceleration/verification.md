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

Use the same synthetic prompt set, acceptance tests, runtime-confirmed model
catalog, concurrency cap, and warm/cold policy for both paths:

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
