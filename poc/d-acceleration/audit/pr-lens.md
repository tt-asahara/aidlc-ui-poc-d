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

Conclusion from evidence: pr-lens was **installed and composed** into
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

Decision: **未決定 (pending human judgement).**
