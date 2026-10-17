# Are skills invoked by stages, or merely copied? (issue #10)

Source tree `bb813a16…` (= `29f4820d` = `main` `3bde2496`). The raw output
is in `skill-invocation-evidence.txt`.

## Short answer

The C skills are copied **and** wired: composed stage text tells the agent to
run a deterministic router, and that router names exact skill files. This is
not a Claude Code Skill-tool invocation, and no tool forces the agent to
follow it:

- None of `prototype`, `grilling`, `domain-modeling`, `to-spec`,
  `frontend-design`, or `teach-impeccable` is registered under
  `.claude/skills/`. They live as plain files under `.agents/skills/`, which
  Claude Code does not auto-load as skills.
- The "invocation" is: composed stage prose → `node
  .claude/tools/ui-poc-c-routing.cjs plan` → the agent reads the returned
  entrypoint files → `ui-poc-c-routing.cjs verify` checks the
  `skill-read`/`skill-applied` hashes in `ui-poc-skill-evidence.json` → the
  blocking `ui-poc-evidence` sensor.
- The routing contract states that a `skill-read` event is an agent
  attestation, checked by hash. It is not proof that the model followed the
  prose (`poc/ui-poc/docs/c-stage-skill-matrix.md`).

## Trace from packaged output to a stage

| Link | Evidence | Verified how |
|---|---|---|
| 1. The C payload exists in the source | `.agents/skills/**`, tree `a0de87d6…`, identical to Arm C `c7385186` | `git rev-parse` (see `lineage.md`) |
| 2. The payload is **not** in the Claude package | `dist/claude` contains no `.agents/`. `aidlc-setup` copies the payload into the product as a separate approved write set (`.claude/skills/aidlc-setup/SKILL.md`, "Place the exact C payload"). | `find dist/claude -path '*.agents*'` returns nothing |
| 3. The UI plugin is built separately | `bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/ui-poc claude --json` gives `valid: true`. Output is under `poc/ui-poc/dist/claude/`, which is not git-ignored (see `lineage.md`). | Run on 2026-10-17 |
| 4. Compose injects stage fragments | In a disposable product (`aidlc.ts config --from dist/claude`, then plugin `hooks/compose.ts`), 7 official stage files carry a `<!-- plugin:ui-poc:… -->` fragment: rough-mockups, requirements-analysis, refined-mockups, domain-design, functional-design, code-generation, build-and-test. 16 more stages get only frontmatter (scope/produces/sensor membership). A 3rd compose pass is byte-identical (aggregate `7c51c60b…`). | `skill-invocation-evidence.txt` |
| 5. The router resolves skills per stage | With required facts supplied: rough-mockups → teach-impeccable, prototype-ui, frontend-design, prototype-logic. requirements-analysis → grilling, domain-modeling. refined-mockups → frontend-design, prototype-ui. domain-design → domain-modeling. code-generation → frontend-design. user-stories, functional-design, build-and-test → none. A missing fact is a hard stop (`pass: false`, "Missing routing fact"). | Same file |
| 6. Read/apply evidence is verified and gated | `ui-poc-c-routing.cjs verify` and the `ui-poc-evidence` sensor | `node --test poc/ui-poc/tests/*.cjs` 79/0; `bun test poc/ui-poc/tests/` 83/0 |
| 7. A real host run produced the evidence | **Pre-PR-#4 dogfood only:** `aidlc-ui-poc-d-dogfooding-2`, Intent `261016-budget-manager-app`, files `ui-poc-skill-evidence.json`, summarised below. | Read-only inspection; file sha256 below |
| 8. The same holds for an install of `29f4820d` | **未実施.** Needs the clean-install E2E in issue #7, keeping the four evidence files and the sensor verdicts. | — |

### Dogfood-2 evidence (read-only, observed 2026-10-17)

| Stage | Events | sha256 |
|---|---|---|
| rough-mockups | teach-impeccable read 1 / applied 1; prototype-ui read 2 / applied 1; frontend-design read 8 / applied 1; prototype-logic skipped | `5a66317050a7a2aadc544bcc30d6d882385542ea34db05ea8ef8c66a2a54346c` |
| requirements-analysis | grilling read 1 / applied 1; domain-modeling skipped | `9d624b3f1c4c3d2ede42df793fb3814a953407d983c4931e94954c7eb3c2102d` |
| refined-mockups | frontend-design read 8 / applied 1; prototype-ui skipped | `61ae3c86a087f35062b12190b090987922f99681ce2178773db888513ef3541f` |
| domain-design | domain-modeling skipped | `8209ae39a72076a15ea39b0252f628f614e73e902798f4e728b9ac56e9bf9fc1` |

These records show the routed skill files were read and applied in a real
session. Limits on what they prove:

- The dogfood's composed payload (`sourceHash
  d6d6d83a…` in `.claude/tools/data/plugin-compose-ui-poc.json`) cannot be
  tied to a D commit. Its tracked `.claude/tools/ui-poc*` files are locally
  modified.
- The verifier was not re-run here, to avoid writing into the dogfood.

## D's own skills and stage-boundary features

- `aidlc-issue-autopilot` is a registered, user-invocable Claude skill
  (packaged, sha256 `4c8c6ed6…`). It is invoked by the person or by `/loop`,
  not by a stage.
- Features 21, 22, 27, and 28 and the D wave runner are triggered from the
  orchestrator prose in `skills/aidlc/SKILL.md` ("Optional D checks",
  `run.ts`). The deterministic part starts only once the agent runs
  `host-stage-boundary.ts`, which re-derives the official `next` and rejects
  stale or invented directives. No hook enforces that the boundary check runs
  when a feature is ON. This prose dependency is the same as for the C router.
  Enforcement would need a sensor or hook that refuses a stage report when an
  enabled feature has no evidence file. That is not implemented.
- `aidlc-setup` (`.claude/skills/aidlc-setup/SKILL.md`) is a skill for
  operating the source checkout. It is not packaged into products.
