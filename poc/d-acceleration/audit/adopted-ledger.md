# Adopted-number ledger: items 7, 9–17, 21, 22, 27, 28 (issue #10)

Observed 2026-10-17 at source tree `bb813a16…`. This tree is shared by
`29f4820d` (PR #4 head), `3bde2496` (`main`) and `52447d81` (`develop`).

## Numbering source

- The only primary record of the numbers is
  `poc/d-acceleration/implementation-plan.md` ("Adopted features",
  introduced in `b070cff6`, 2026-10-17). It adopts 7, 9–17, 21, 22, 27, 28
  and explicitly excludes 6, 8, 18–20, 23–26, and 29+.
  `poc/d-acceleration/feature-21-22.md` elaborates 21/22.
- **未確認:** the full numbered list 1–29+ and the decision record that chose
  these numbers. Issues #1, #2, #6, #10 and PR #4 do not contain it; issue #10
  only references the numbers. The original discussion or decision document,
  linked from issue #10, would settle it. The "source decision" column
  therefore cites the plan wording, not a human decision record.

## Column conventions

- **Config.** Keys live under `<project>/.claude/d-acceleration.jsonc`, and
  `d-acceleration.local.jsonc` overrides it field by field (`d-config.ts`).
  The default comes from `d-config.ts` and matches
  `d-acceleration.example.jsonc`.
- **Effective value.** This is what `resolveDConfig` returns when no project
  file sets the key. That equals the default, because no installed product
  configuration was inspected for PR #4.
- **Test.** Each test file was run on this machine with
  `bun test --timeout 60000 <file>` (logs in the workstream scratchpad). Load
  average was 15–38, from other agents. "timeout" marks failures that time out
  at a test's own 15 s limit and pass in another run. Those results are
  load-sensitive, not a verdict.
- **Installed run.** Every item is **未実施**. No clean install of `29f4820d`
  has run these features with a real host (issue #7 owns that). The
  dogfooding checkouts predate PR #4 and are not evidence for it.

## Ledger

| # | Requirement wording (plan) | Implementation path / introducing commit (last change) | Config key / default / effective | Test (result) | Installed run | Status |
|---|---|---|---|---|---|---|
| 7 | High-confidence secret scanning integrated into approved-transition Git persistence; no separate switch | `poc/d-acceleration/d-persistence.ts` `detectHighConfidenceSecret` (manifest and hook-produced tree), called from `d-persistence-hook.ts` and wired as Claude `PreToolUse`/`PostToolUse` Bash hooks in `harness/claude/settings.json`. Added `2c582965`, last change `b6f5d028`. | No switch. It is always on whenever persistence runs, and persistence itself is gated by `gitPersistence.enabled` = `false`. So the scan is only reachable after a human enables persistence. | `d-persistence.test.ts`: 32 pass / 1 fail. The failure is a timeout in "real official report audit…". It passed in the full-suite run. | 未実施 | Implemented + packaged + offline-tested |
| 9 | Intake of one explicitly numbered issue | `issue-autopilot.ts` (added `beceb01b`, last change `ed507a88`), `issue-autopilot-cli.ts` (added `e7978ce6`), skill `aidlc-issue-autopilot` `<n>`, and `/aidlc --next-intent --from-issue <n>` in `harness/claude/skills/aidlc/SKILL.md` | `auto.enabled` = `false` AND `issueAutopilot.enabled` = `false`; effective = disabled | `issue-autopilot.test.ts` "supports exact-number intake…": 14/0. `issue-autopilot-cli.integration.test.ts`: 15/3 (timeouts), then 18/0 on rerun | 未実施 | Implemented + packaged + offline-tested |
| 10 | Deterministic issue-list selection intake | Same files; `list` argument; candidates normalised to ascending issue number (`configuration.md`) | Same parents; effective = disabled | `issue-autopilot.test.ts` "supports selection only from the offered list": pass | 未実施 | Implemented + packaged + offline-tested |
| 11 | `halt` / `assume` / `research` for unresolved requirements, with assumption ledger | `issue-ambiguity-assessor.ts` (added `2ee0914a`); policy wiring in `issue-autopilot-cli.ts` | `auto.ambiguityPolicy` = `"halt"`, `auto.assumptionLedger` = `true`; effective = `halt`. Note: `assumptionLedger: false` forces `halt` regardless of policy (`issue-autopilot-cli.ts`, `uncertaintyPolicy`). | `issue-ambiguity-assessor.test.ts`: 4/0. `issue-autopilot.test.ts` "halts on ambiguity by default…": pass | 未実施. The real judgment model was never called; tests use a fixed executable. | Implemented + packaged + offline-tested |
| 12 | Automation status and stop controls | `issue-autopilot-cli.ts`, `host-session-cli.ts` (added `5666c9da`), `generic-auto-cli.ts`; `/aidlc --auto status` and `/aidlc --auto stop` | Command, not a key. `status` is read-only; `stop` writes a flag consumed at the next checkpoint. | `issue-autopilot.test.ts` "reports explicit loop status…": pass. `host-session-cli.integration.test.ts`: 7/0 | 未実施 | Implemented + packaged + offline-tested |
| 13 | Explicitly recorded `through` boundary | `host-session.ts` and `generic-auto-cli.ts` / `issue-autopilot-cli.ts` (`--through`) | `auto.through` = `"code-generation"`; effective = `code-generation` | `issue-autopilot.test.ts` "rejects unknown through stages…": pass | 未実施 | Implemented + packaged + offline-tested |
| 14 | Session-scoped automation state | `host-session.ts`; state at `.aidlc-engine/d-autopilot-session.json` | `auto.sessionOnly` = `true`; effective = stop after Intent creation | `host-session.test.ts`: 4/0. `generic-auto-cli.integration.test.ts`: 9/0 | 未実施 | Implemented + packaged + offline-tested |
| 15 | Issue claim, lock, and bounded retry | `issue-autopilot.ts` file claim store (lease/heartbeat), `issue-autopilot-runtime.ts` | `auto.maxRetries` = `2` (also `maxSteps` 64, `deadlineMs` 900000) | `issue-autopilot.test.ts` "claim contention stops and bounded retry…": pass. `issue-autopilot-runtime.test.ts`: 8/0 | 未実施 | Implemented + packaged + offline-tested |
| 16 | Target-label allowlist | `issue-autopilot.ts` (`labelAllowlist`) | `auto.labelAllowlist` = `[]`, meaning **nothing** is allowed (not everything) | `issue-autopilot.test.ts` "enforces label allowlist before claim or creation": pass | 未実施 | Implemented + packaged + offline-tested |
| 17 | One-issue-per-run issue autopilot callable from `/loop`, default off | Skill `harness/claude/skills/aidlc-issue-autopilot/SKILL.md` (added `e7978ce6`), `issue-autopilot-cli.ts` | `issueAutopilot.enabled` = `false`; `issueAutopilot.oneIssuePerRun` = `true`. **Finding:** `oneIssuePerRun` is validated and resolved in `d-config.ts` but no runtime reads it. The one-issue limit is hard-coded, so setting it to `false` has no effect. | `issue-autopilot.test.ts` "list polling … processes at most one": pass | 未実施. `/loop` was never exercised. | Implemented + packaged + offline-tested; config key inert |
| 21 | Optional cross-check between official traceability IDs and the C screen/state/AC contract, default off | `requirement-ui-cross-validation.ts` (added `dce8819d`), entry `d-feature-checks.ts` via `host-stage-boundary.ts` | `features.requirementIdValidation` = `false`; `featureInputs.requirementIdBridges` = `[]` | `requirement-ui-cross-validation.test.ts`: 5/0. `feature-entry.integration.test.ts`: 7/0 | 未実施 | Implemented + packaged + offline-tested. Invocation depends on orchestrator prose (see `skill-invocation.md`). |
| 22 | Optional Functional Design duplicate-meta discipline, default off | `functional-design-discipline.ts` (added `dce8819d`, last change `2ee0914a`), same entry | `features.functionalDesignDocumentDiscipline` = `false`; budgets 60000 / 160000 / 30000 bytes | `functional-design-discipline.test.ts`: 4/0. `feature-entry.integration.test.ts`: 7/0 | 未実施 | Same as 21 |
| 27 | Optional bounded source grounding, default off | `grounding.ts` (added `dce8819d`, last change `ed507a88`), `grounding-runtime.ts` (added `e7978ce6`), same entry | `features.sourceGrounding` = `false`; `featureInputs.sourceRoots` = `[]`. With no roots it stays OFF. | `grounding.test.ts`: 9/0. `grounding-runtime.test.ts`: 1/0 | 未実施. Brownfield validation belongs to #15. | Same as 21 |
| 28 | Optional bounded specification grounding, default off | Same as 27 | `features.specGrounding` = `false`; `featureInputs.specRoots` = `[]` | Same as 27 | 未実施 | Same as 21 |

## Packaged path and hash

`bun scripts/package.ts` exits 0, and `bun scripts/package.ts --check` exits 0
(deterministic for all 7 harnesses). The D runtime is copied only into the
Claude projection, at `dist/claude/.claude/tools/d-acceleration/`
(`scripts/package.ts`, Claude branch). Every packaged file below is
byte-identical to its `poc/d-acceleration/` source, except
`read-only-fanout.ts` and `host-stage-boundary.ts`. Those two have one import
path rewritten, so their hashes differ from source by design. All relative
imports in the packaged directory resolve.

| Packaged file | sha256 | Items |
|---|---|---|
| `d-persistence.ts` | `1b3f41f6dc88a017b17ca82bcae28fd52e130499c7d99cb127b33fe6bcc3d5e0` | 7 |
| `d-persistence-hook.ts` | `16e9094677ee9f1d47de4a8ae174595448b4b73297d8bc8fc3fce6869361828a` | 7 |
| `issue-autopilot.ts` | `15baf969ff72ea3070378650b73ee60fc7bb8991fda54e62dfa605a00af73d79` | 9, 10, 15, 16, 17 |
| `issue-autopilot-cli.ts` | `c3e016bf0c244088d35c58a2824e369af249870f096d8f59759377040eeb8cc0` | 9–17 |
| `issue-autopilot-runtime.ts` | `9841c071bea227a416e29946c0b02d23bec4c0809ff119e76313bef94264c58a` | 15 |
| `issue-ambiguity-assessor.ts` | `a7cd7de15f940108b0845ad6132feb255cc349ad04bdf1505fccb918170493ec` | 11 |
| `host-session.ts` | `8dd3eaa5a2edcdc2962631c9568dab380114378fb3d9bd4183ce4d0928fef08e` | 12–14 |
| `host-session-cli.ts` | `7b7527b4c4c085c6f352875dda7bbfa2b90f1981c2e9ba5f2176f41f68542cc2` | 12–14 |
| `generic-auto-cli.ts` | `08718ef9636e157a0abe7001d4f22c7000076151ed1567af98fa89b8b0ca7ea9` | 12–14 |
| `d-config.ts` | `b4e841ff331fdb4e9d4e19b2f888818692f5b283547827ecbeccc324acfbc826` | all |
| `d-acceleration.example.jsonc` | `548d20010948fbad885ff0960a2285a94ce8f359bb12790c08c9c1d9db24cc8f` | all |
| `d-feature-checks.ts` | `99825e9a70f213ba4942ad409bd5c5ef3d4db9c1863028b13dde45eaf10b4c1d` | 21, 22, 27, 28 |
| `host-stage-boundary.ts` (projected) | `39480418655e941256fd90114d502c96de92d46777c98c2a8b62a138e29ed5d1` | 21, 22, 27, 28 |
| `requirement-ui-cross-validation.ts` | `bfe2110916025de1e2fffe27e4586de9e904b1374adcfe32b7ec64ba5486adca` | 21 |
| `functional-design-discipline.ts` | `bcbe13d38e49162a41b01bc2217bc6ee9480469b96041eacfae05b7a52cffb58` | 22 |
| `grounding.ts` | `ec853e317d619f8cc93bfad0f7dbc5f1ad212a79b2779673b5a93b2259909117` | 27, 28 |
| `grounding-runtime.ts` | `f90f506dca27e93243b98f85647b89ae3a4e0f03e326df9d43c88031842991d1` | 27, 28 |
| `../../skills/aidlc-issue-autopilot/SKILL.md` | `4c8c6ed6609cd4f94a161f56e6d8433ab6c84bdb2c1760648626632fd55dbc85` | 9, 10, 12, 17 |
| `../../skills/aidlc/SKILL.md` | `90062024d0f80443e3c0f6a5fe1e3060f02a4a533db92a5639528451878718b2` | 9, 12–14, 21, 22, 27, 28 |
| `../../settings.json` | `78fc8678758b4948568129a2d9e757e019d902cea65845d3c15dbc259ee43540` | 7 |

## Full-suite context

`bun test poc/d-acceleration/tests` (24 files) gave 201 pass, 11 fail, 3
errors under load. Re-running the failing files one at a time with
`--timeout 60000` cleared every failure except:

- `d-config.test.ts`, "documents every boolean switch in Japanese…": expected
  16 switches, received 17. This is deterministic. `parallel.enabled`
  (`b5b4c926`) added a boolean without updating the test, so it is a real
  regression at `29f4820d`.
- `issue-autopilot-cli.integration.test.ts`: 3 tests timed out at their own
  15 s limit on one run, and the next run passed 18/0. This is load-sensitive.
- `official-next.integration.test.ts` "composes C …": needs
  `poc/ui-poc/dist/claude` built first
  (`bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/ui-poc claude`).
  Without it the test fails with "Module not found …/hooks/compose.ts". After
  the build, the file passes 5/0. This is a test prerequisite, not a product
  failure, but CI must build the plugin first.

UI-PoC suites: `node --test poc/ui-poc/tests/*.cjs` 79/0;
`bun test poc/ui-poc/tests/` 83/0.
