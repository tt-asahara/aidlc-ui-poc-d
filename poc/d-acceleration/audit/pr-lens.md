# pr-lens in the earlier dogfood: primary evidence (issue #10)

Observed read-only on 2026-10-17. Nothing was run, installed, or modified in
any dogfood checkout.

## Where pr-lens exists

| Location | Finding |
|---|---|
| `aidlc-ui-poc-d` (this repo, tree `bb813a16`) | No `pr-lens` / `prlens` reference anywhere outside `node_modules`/`dist`. |
| KDDI-ref `aidlc-workflows-kddi` | `git grep -il pr-lens kddi/v2` finds nothing, and no commit message on any branch mentions it. |
| `aidlc-ui-poc-d-dogfooding` (reached Build and Test, HEAD `d6366a2`) | No pr-lens files or references. |
| `aidlc-ui-poc-d-dogfooding-3` | No pr-lens files or references. |
| `aidlc-ui-poc-d-dogfooding-2` | Integrated as a PRODUCT-local plugin. Branch `feat/pr-lens-review`: `a2e6c2e` feat: add pinned PR Lens review workflow, `03be4fd`, `73c6514`, `cb5405c` (2026-10-16 20:27 JST). That branch is an ancestor of `feat/budget-manager-app` (`6a8f2f6`). Submodule `.vendor/pr-lens` = `coldteadotai/pr-lens` at `7a9115c8202da4db030be5954ada8862e6135dce`. Doc: `docs/pr-lens-integration.md`. The composed Build and Test stage contains `<!-- plugin:pr-lens-review:before-step:11:900:… -->`, which runs `.claude/tools/pr-lens-review/SKILL.md` "when application implementation exists". |

## Was it invoked?

Verified from primary records:

1. **Not invoked on the dogfood application.** The only trigger is the Build
   and Test fragment. The dogfood-2 Intent `261016-budget-manager-app` has
   Construction records for U1–U3 (and partial U4). Its audit file contains
   no `build-and-test` entry
   (`aidlc/spaces/default/intents/261016-budget-manager-app/audit/cb-329-local-cd948f98721c.md`,
   sha256 at observation `e319cbe54b8dd65f4e70658e3fb2490b0d4ac8495947acc659736a768c87e9f7`;
   the file is live and may grow).
2. **Session self-report.** Audit line 21266 (`SUBAGENT_COMPLETED`,
   2026-10-17T05:44:00Z, Agent ID `a98dad00e8236eb5f`) records the session
   answering: 「PR-lens を使った確認は、このセッションでは実施していません」
   ("this session did not run a PR-lens check"). It adds that the name had
   not come up in that session, and that reviews so far were by
   `aidlc-architecture-reviewer` on design documents.
3. **Artifacts under `.pr-lens/` are not a review of the app.** The directory
   is git-ignored. It holds `synthetic.graph.json` ("Batch broadcast sending
   through Postmark", `generatedAt` 2026-08-19) and a rendered set for the
   same sample (`render-manifest`, renderer `@coldtea/pr-lens-renderer`
   0.3.2, `headSha b71e0d4c…`). All have mtime 2026-10-16 20:02 JST, one minute
   before the first integration commit `a2e6c2e` (20:03 JST). They are a toolchain smoke render of a
   synthetic graph, consistent with `setup-pr-lens.sh` verification. They do
   not cover the budget app.
4. Practices Discovery recorded pr-lens as an open question.
   `inception/practices-discovery/evidence.md` line 70 says whether it is used
   as a pre-merge gate is 未確認, and `memory.md` line 17 matches.

Conclusion from evidence at that time (superseded in part by "Later
observation" below): pr-lens was **installed and composed** into
dogfood-2, its renderer was **smoke-run on a synthetic sample**, and it was
**never invoked on dogfood application changes**. It was absent from the
other dogfoods, from D, and from KDDI-ref.

Not verified:

- **未確認:** whether pr-lens ran in a Claude session outside the AI-DLC audit,
  for example manually. Settling this needs the Claude Code session
  transcripts for dogfood-2 around 2026-10-16 20:00 JST. `~/.claude` history
  was deliberately not read.

## D standardization decision (for the human)

The tools do not decide this. Options:

| Option | Meaning |
|---|---|
| accept | Port `product-plugins/pr-lens-review` into D as an optional, default-off plugin with the pinned submodule, MIT licence, and the supplemental-only contract. |
| decline | Keep pr-lens a product-local choice, outside D. |
| defer | Wait until a Build and Test run actually exercises it on application changes and shows value. |

Decision: **accepted, default OFF** (owner decision recorded on issue #10). The
review run takes time, so it is an optional plugin switched by JSONC.

- Toggle key: `features.prLensReview` in `.claude/d-acceleration.jsonc`. The
  local `.claude/d-acceleration.local.jsonc` overrides it. Default `false`.
- Plugin: `poc/pr-lens-review/` (see its README for why it lives under `poc/`).
- Pin: a pinned, verified fetch by `poc/pr-lens-review/scripts/setup-pr-lens.ts`
  of `coldteadotai/pr-lens@7a9115c8202da4db030be5954ada8862e6135dce` (MIT). D
  does not use a submodule: a submodule of the D repo is not part of the
  installed runtime, and a PRODUCT submodule would rewrite the PRODUCT's
  `.gitmodules`.
- Behaviour:
  - OFF: `skipped-by-config`, recorded only in D's evidence.
  - ON without the pinned install: fails closed with a one-line next step.
  - In all cases the review is a supplement only and never decides a gate.
- Smoke evidence: `../evidence/pr-lens/`. It covers the real pinned fetch, the
  build, the receipt, compose, a render of a synthetic sample, and verify.
- Tests: `poc/pr-lens-review/tests/pr-lens-review.test.ts` and
  `poc/d-acceleration/tests/d-config.test.ts`.

## Later observation (2026-10-17 22:18–22:20 JST, read-only)

After the observation above, dogfood-2 **did** run the PR Lens review on its
application at Build and Test. This supersedes item 1 of "Was it invoked?" from
that time onward.

- Files:
  `aidlc/spaces/default/intents/261016-budget-manager-app/construction/build-and-test/pr-lens-review.md`
  (sha256 `3952e076834c917ea91a7cb1162dc8f5f494371370e52c76cf56d76856920251`) and
  `pr-lens-review.json`
  (sha256 `9174c7abfe55296a09b0ae2d1714a35764d9f10ba75e209a579e50387b45679f`).
  The audit shard records `ARTIFACT_CREATED` for the `.md`.
- Coverage: 123 application files under `app/src` and `app/tests`, base
  `627c0d4d…` and head `6a8f2f68…`. The render is
  `.pr-lens/budget-app-csv-exchange-and-local-storage/` (5 SVGs). Findings were
  high 0, medium 0, low 3, info 1. Tests were not re-run; the review cites
  `build-and-test-summary.md`.
- Problems the run reported, and the D port's response:
  1. The first `verify-report` failed because the framework appended
     `ARTIFACT_CREATED` to the audit shard after the review `.md` was written.
     The shard was part of the frozen supporting evidence.
     D now excludes append-only `audit/`, `aidlc-state.md`, and `.aidlc-engine/`
     paths from that snapshot (test "ON with the pinned install runs …").
  2. `prepare --base main` stored the ref name, so the graph provenance check
     (a SHA) failed. D's `prepare` now resolves the base to its commit SHA once.

The renders are still not a value judgement on PR Lens. Whether the findings
were acted on is **未確認**.
