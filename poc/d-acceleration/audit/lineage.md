# A/B/C/D lineage (issue #10)

Observed 2026-10-17 (JST). Every SHA below is a full commit that can be
re-checked with `bash poc/d-acceleration/audit/lineage.sh [work-dir]`; the
output captured for this record is in `lineage-results.txt` next to this file.
Anything not settled by a primary Git/GitHub record is marked **未確認** with
what would settle it.

## Naming

- **Arms A/B/C/D** are the UI-PoC treatment compositions, each in its own
  GitHub repository `tt-asahara/aidlc-ui-poc-{a,b,c,d}`. Arms are historical
  baselines for comparison, not cumulative runtime layers. D is C-based: it
  merges the Arm C commit `c7385186` and adds the D acceleration line.
- The **KDDI reference repository**
  (`SystemManagement/aidlc-workflows-kddi`, KDDI main = `kddi/v2`) is not one
  of the arms. The workstream briefing calls it "repo B". This record calls it
  "KDDI-ref" so it is not confused with Arm B.

## Common upstream

All four arms branch from the same upstream commit:
`6a378b53c0a4fe0641ed7d8de8dfff94264d5b6a`. This is awslabs/aidlc-workflows
`v2.11.0` (tag `v2.11.0^{}` in Arm B/C remotes and KDDI-ref). Evidence:
`git merge-base <tip> 6a378b53…` returns `6a378b53…` for every arm tip.
Arm A `main` is the exception described below.

## Immutable lineage table

| Arm | Repository / branch (tip) | Upstream base | Divergence point | Included change sets | Excluded / not carried |
|---|---|---|---|---|---|
| A | `aidlc-ui-poc-a` `feature/aidlc-setup-skill` `e7a685538878e1cf66743f6aca934a9199a983a3` (most complete). Other heads: `issue/6-formal-workflow-probe` `62a5794d…`, `integration/aidlc-v2.11.0-ui-poc-a` `a699de1c…`, `feature/ui-poc-foundation` `ad6afd9e…`, `baseline/aidlc-v2.11.0` = `6a378b53`, `main` `3c8c0c52…` | v2.11.0 `6a378b53`, imported by merge `f44a0c6e` (parents `3c8c0c52` + `6a378b53`) | `f44a0c6e`, which joins an unrelated root `3c8c0c52` ("initialize arm A integration scaffold") to upstream | The 15 commits after upstream add 55 files (+14 613) under `poc/` and `.agents/skills/frontend-design/` (Anthropic frontend-design, `treatments/a.json`). `core/` and `harness/` are untouched. | Arm A `main` (`3c8c0c52`) is a scaffold-only root with **no** upstream history. The A commits are **not** in D: `ad6afd9e` scaffold content was copied byte-identically into the shared foundation `3ecaba40` (WORKLOG, 2026-10-14), but no A SHA is an ancestor of D. |
| B | `aidlc-ui-poc-b` `feature/aidlc-setup-skill` `dd88c39f348b169236ec331ae0052e289a0de99c`; `feature/ui-poc-b-stage-harness` `eaccab0f…`; `feature/ui-poc-foundation` `29570572…`; `main` = `6a378b53` | `6a378b53` | `3ecaba40` (shared UI-PoC plugin foundation; same SHA in B, C and D) | 10 commits: shared foundation + `7660452e` (Arm B treatment: Matt Pocock skills) + B stage harness/routing evidence + B setup skill. 67 files (+15 148), additions only. | No B-only commit is in D. B's routing harness was "adapted" for C per C's WORKLOG (C `4f9b9dd8`); that is a re-implementation, not a merge. |
| C | `aidlc-ui-poc-c` `feature/aidlc-setup-skill` `c738518615c91bb5968f2fea4e1c670f4eefdac8` (Arm C pin used by D); `feature/ui-poc-c-stage-harness` `e0a522a2…`; `feature/ui-poc-foundation` `442b44d0…`; `main` = `6a378b53` | `6a378b53` | `3ecaba40` | 9 commits `3ecaba40..c7385186`: foundation, Arm C treatment (Matt `49dd158d` + historical Impeccable `209444a9`), source evidence, deterministic C stage harness, WCAG/context provenance, C setup skill. 76 files (+16 287), additions only. | `main` was never advanced; the C line exists only on feature branches. |
| D | `aidlc-ui-poc-d` `main` `3bde2496bffd0088ed50f07a5ef03cf10c24e88a` (merge of PR #4, head `29f4820d11081a771bccb23301db3a796f4e380c`); `develop` `52447d81…` | `6a378b53` | Two lines from `6a378b53`: (1) D acceleration `e254c9fe..86f1ec7f` (14 commits; branches `feature/ui-poc-d-acceleration` `7e9a86c4`, `feature/aidlc-setup-skill` `86f1ec7f`); (2) Arm C `3ecaba40..c7385186` (same SHAs as the C repository). Joined by merge `9ce3a25b` (parents `86f1ec7f`, `c7385186`, issue #2). | 66 commits `6a378b53..29f4820d` (65 linear + merge `9ce3a25b`): 171 files, +26 792/−24. Outside `poc/` and `.agents/`: 22 files (+954/−24) in `core/tools/*` (state, orchestrate, directive, audit, utility, lib, new `aidlc-ai-answers.ts`), `core/aidlc-common/stages/inception/delivery-planning.md`, `core/knowledge/aidlc-shared/audit-format.md`, `harness/claude/{manifest.ts,settings.json,skills/aidlc/SKILL.md,skills/aidlc-issue-autopilot/SKILL.md}`, `scripts/package.ts`, tests, `.claude/skills/aidlc-setup/SKILL.md`, `WORKLOG.md`. | Arms A and B are not ancestors. KDDI-ref commits are not ancestors (see below). The C pinned payload `.agents/` is byte-identical to C (tree `a0de87d6…` at both `c7385186` and `29f4820d`). The C **plugin** tree `poc/ui-poc` is **not** identical: C `aba7ec2a…` vs D `e867ee29…`, 40 files +821/−53 from 8 D commits (`0387b8f4`, `d860e829`, `d1e54d7f`, `4605c171`, `2c582965`, `38c483bb`, `6ae4c89f`, `2ee0914a`). |

### D branch topology (origin, 2026-10-17)

| Branch | Tip | Commits after `6a378b53` | Ancestor of `29f4820d` |
|---|---|---|---|
| `feature/ui-poc-d-acceleration` | `7e9a86c4` | 12 | yes |
| `feature/aidlc-setup-skill` | `86f1ec7f` | 14 | yes |
| `feat/auto-d-acceleration` | `2c582965` | 38 | yes |
| `feat/d-automation-intake-grounding` | `3c90e025` | 52 | yes |
| `fix/inherit-c-ui-layer` | `44c1a67f` (PR #3 merge, parents `d163fa86` + `3c90e025`) | 53 | no. Its tree equals `3c90e025`'s tree (`be1fca9c…`), so there is no content outside the PR #4 line. |
| `feat/ui-fidelity-contract` | `29f4820d` | 66 | (head of PR #4) |
| `main` | `3bde2496` | 67 | tree `bb813a16…` = tree of `29f4820d` |
| `develop` | `52447d81` | 67 | tree `bb813a16…` = tree of `29f4820d` |

`main` and `develop` are different merge commits of the same tree, so they
contain no content difference (`git diff origin/main origin/develop` is
empty).

### KDDI-ref relation

- `kddi/v2` = `79a2baab9d5ca3aa80a3fb3dad06fc51986327fe` (2026-10-12). Its
  merge-base with v2.11.0 is `6a378b53`. It adds 440 commits that D does not
  contain, and no KDDI-ref commit is an ancestor of any arm.
- `git -C <KDDI-ref> cat-file -t` returns "missing" for `c7385186`,
  `e0a522a2`, `86f1ec7f`, and `7e9a86c4`.
- **未確認:** whether D content was hand-ported from KDDI-ref branches (for
  example `feature/kddi-autopilot-requirement-gap-policy` vs feature 11). Git
  history cannot show this. A file-level similarity diff between the named
  KDDI branches and `poc/d-acceleration/`, or the author's statement, would
  settle it.

## Reproducible comparison commands and results

| Command (D checkout; arms cloned bare by the script) | Result |
|---|---|
| `git merge-base <arm tip> 6a378b53` | `6a378b53` for A `e7a68553`, B `dd88c39f`, C `c7385186`, D `29f4820d` |
| `git rev-list --count 6a378b53..<tip>` | A 15, B 10, C 9, D 66 (`main` 67) |
| `git diff --shortstat 6a378b53 <tip>` | A 55 files +14 613; B 67 files +15 148; C 76 files +16 287; D 171 files +26 792/−24 |
| `git rev-parse c7385186:.agents 29f4820d:.agents` | identical `a0de87d68b9425825656fd1cc053d9cf108231ad` |
| `git rev-parse c7385186:poc/ui-poc 29f4820d:poc/ui-poc` | differ: `aba7ec2a…` vs `e867ee29…` |
| `git rev-parse origin/main^{tree} origin/develop^{tree} 29f4820d^{tree}` | all `bb813a169157ffe7aa85ea03892d82ef1200252a` |
| `git rev-parse origin/fix/inherit-c-ui-layer^{tree} 3c90e025^{tree}` | both `be1fca9cd1cc34f11cffb39e2a4b275139fc54ec` |
| `bun scripts/package.ts --check` (at `52447d81`, tree `bb813a16`) | exit 0, deterministic for all 7 harnesses |

## Public commits, PR scope, CI

- PR #4 `feat: make D automation auditable and safely parallel` merged
  `feat/ui-fidelity-contract` (`29f4820d`) into `main` at 2026-10-17T05:36:24Z
  as `3bde2496`. It contains 66 commits. The GitHub file list is capped at
  100 entries; the true diff has 171 files.
- The PR body describes only the last 4 commits (generic auto bootstrap,
  delegated questions, `parallel.enabled`, question-heading parsing). It does
  not describe the C merge, issue autopilot, grounding, persistence, UI
  fidelity, or delegated stage approvals that the same diff contains. PR #4 has
  no review comments. The only review attempt was `github-advanced-security`
  ("Commented"), and the label is `aida:review-error`.
- `gh pr checks 4` against head `29f4820d`: **16 failing**, 16 passing, 6
  skipped, 1 pending (`guard-matrix`). Failing checks:
  - Contract checks (determinism + typecheck + lint)
  - Gitleaks (full history)
  - Require Contributor Statement
  - Review pull request
  - Tests: smoke, integration, unit-1, unit-2, unit-3, unit-4, unit-5, unit-6,
    unit-7, unit-9, unit-11, unit-12

  The workflow runs are 39005713838, 39005713821, and 39005712544. Root-cause
  analysis belongs to issue #16 / `d/pr4-review`.
- Main went from `6a378b53` to `3bde2496` with failing required-looking
  checks. Whether protections were bypassed is **未確認**. The branch
  protection settings or the merge actor's audit log would settle it.
  (Issue #6's earlier comment says PR #4 had not been merged; that was
  superseded by the merge.)

## Local-only work (main checkout and worktrees, 2026-10-17 ~15:00 JST)

- Main checkout `develop` = `52447d81` = `origin/develop`, with a clean
  working tree. Local `main` is stale (`6a378b53`, behind `origin/main` by
  67). This is a ref lag only, not content.
- These local branches are ahead of origin by one WIP commit each. They are
  the in-flight #6 sub-workstreams and are not published:
  - `d/cross-stage-parallel` `206b6ff4`
  - `d/delegated-questions` `4d9a5b89`
  - `d/grounding-brownfield` `38b67afa`
  - `d/model-routing` `4c3cdde4`
  - `d/parallel-off` `441adc0a`
  - `d/visual-regression` `a11a22ea`
- One shared stash entry exists: `stash@{0}: WIP on d/grounding-brownfield:
  29f4820d`. It was not created by this workstream, and it was neither
  inspected nor popped.
- The parallel-OFF correction that issue #6 described as "local, uncommitted"
  was not found (issue #6 comment, 2026-10-17). Issue #11 re-implements it on
  `d/parallel-off`.
- `poc/ui-poc/dist/` is **not** git-ignored. Running the documented
  `aidlc-plugin-build.ts poc/ui-poc claude` leaves it untracked. This is the
  "untracked UI build output" issue #6 refers to. It is not committed here.
