---
name: aidlc-setup
description: Set up the pinned Arm C UI baseline plus automatically integrated, bounded D acceleration while preserving official host authority and existing work.
argument-hint: "[D checkout path] [product repository path]"
user-invocable: true
---

# Set up AI-DLC D on the Arm C UI baseline

Invoke from the D checkout containing this skill. D retains the complete pinned Arm C UI treatment and installs bounded acceleration into the ordinary `/aidlc` wave path. Invocation permits inspection and dry-run only; applying reviewed product changes requires separate explicit authorization.

## Establish boundaries

1. Resolve absolute `SRC` and `PRODUCT`. Confirm an isolated D target, project-local scope, trust/permissions, and preview-versus-apply authority. Never change authentication, global/shared settings, or model configuration.
2. Inspect both repos with `git -C <path> status --short --branch`. Preserve all existing tracked, untracked, ignored, and uncommitted files. Never replace product `CLAUDE.md`, `AGENTS.md`, `.claude`, skills, hooks, settings, or plugins.
3. Read [`../../../poc/ui-poc/README.md`](../../../poc/ui-poc/README.md), [`../../../poc/ui-poc/docs/verification.md`](../../../poc/ui-poc/docs/verification.md), [`../../../poc/ui-poc/docs/contract.md`](../../../poc/ui-poc/docs/contract.md), [`../../../poc/ui-poc/docs/c-stage-skill-matrix.md`](../../../poc/ui-poc/docs/c-stage-skill-matrix.md), [`../../../poc/ui-poc/treatments/c.json`](../../../poc/ui-poc/treatments/c.json), its [`source-lock.json`](../../../poc/ui-poc/treatments/source-lock.json), [`../../../poc/skill-installation.json`](../../../poc/skill-installation.json), and the D acceleration [`README.md`](../../../poc/d-acceleration/README.md), [`verification.md`](../../../poc/d-acceleration/verification.md), [`configuration.md`](../../../poc/d-acceleration/configuration.md), [`feature-21-22.md`](../../../poc/d-acceleration/feature-21-22.md), [`grounding-integration.md`](../../../poc/d-acceleration/grounding-integration.md), and [`stage-policy.json`](../../../poc/d-acceleration/stage-policy.json).

Keep A/B/C conditions comparable. Do not substitute Anthropic frontend-design, latest Impeccable, engine/hooks/subagents, or an unavailable historical custom extension. The only sanctioned exception is the person's explicit opt-in to a refined-mockups design skill outside `ui-poc-comparison` (see "Optional refined-mockups design skill" below); the router refuses it inside the comparison.

The complete C UI baseline is mandatory even when acceleration is disabled. The official host remains the single writer for questions, approvals, reviews, transitions, state, artifacts, and swarm settlement. D acceleration may schedule only the bounded seams in its policy and must return all UI contribution consumes/produces, sensor results, gates, and handoffs to that host unchanged.

## Build and preview

From `SRC`, stop on failure:

```bash
bun install --frozen-lockfile
bun scripts/package.ts claude
bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/ui-poc claude --json
bun test poc/ui-poc/tests poc/d-acceleration/tests tests/resume-ledger.test.ts
bun "$SRC/dist/claude/.claude/tools/aidlc.ts" config --from "$SRC/dist/claude" --harness claude --project-dir "$PRODUCT" --mcp none --dry-run
```

Use exactly `SRC/dist/claude` as runtime source and `SRC/poc/ui-poc/dist/claude` as the project-local compose payload. Confirm projection of `tools/ui-poc-c-routing.cjs`, `tools/ui-poc/c-stage-routing.json`, treatment/source-lock/runtime contract, and sensor adapter. Never use `dist` or `.claude` for `--from`, edit generated output, or use `--force`.

For a separate clean target, `bun poc/d-acceleration/fresh-install.ts install --src "$SRC" --product "$PRODUCT"` automates this section, the C payload placement, compose, parity, and preflight below, and `update` handles a later package update without a blanket `--force` (it replaces only composed files whose bytes match `.claude/d-install-receipt.json`); see [`clean-target.md`](../../../poc/d-acceleration/clean-target.md).

Present target, writes, and collisions. Stop on dirty target, differing path, or impact to settings/hooks/skills/plugins. A passing preview is not apply authority. Apply only after approval by rerunning the same command without `--dry-run`.

## Place the exact C payload

Compare complete product-relative directories: `.agents/skills/{prototype,grilling,domain-modeling,to-spec}`, `frontend-design` with all seven reference files, `teach-impeccable`, `.agents/skills/LICENSES/mattpocock-skills`, and `.agents/skills/LICENSES/impeccable` with `LICENSE` and `NOTICE.md`. Add absent directories only in the approved write set; leave byte-identical ones; stop on differences. Never merge or overwrite. Verify paths, bytes, commits, dependency, licenses, and exclusions against the installation manifest, treatment C, and source lock.

## Compose and verify inside the project

Do not add, remove, or repoint a Claude marketplace. After the reviewed runtime
copy is applied, run the emitted official compose hook directly against the
project and exact built payload:

```bash
AIDLC_PROJECT_DIR="$PRODUCT" \
AIDLC_PLUGIN_ROOT="$SRC/poc/ui-poc/dist/claude" \
AIDLC_HARNESS_DIR=.claude \
AIDLC_HARNESS_NAME=claude \
bun "$SRC/poc/ui-poc/dist/claude/hooks/compose.ts"
```

This must remain project-local: it copies the sensor/tools/scopes with
no-clobber checks, merges sentinel-marked contributions into official stage
sources, writes compose provenance sidecars, and recompiles the official stage
graph. It must not edit generated files by hand or weaken a gate. Run it twice
and require identical stage-graph and sidecar hashes on the second pass. Then
run `/aidlc --doctor` and D preflight. Confirm `ui-poc-comparison`, no compose
drops, treatment C, routing verifier/config, runtime companion, sensor, all
references/dependency/licenses, and the refined-to-code-to-test
produce/consume/sensor edges. A host-plugin inventory warning may remain because
this supported compatibility path deliberately has no Claude marketplace
installation; report it explicitly and judge readiness from compose provenance,
graph validation, sensor discovery, zero drops, and preflight rather than
silently pruning the composed payload.

## Preserve C adapters

Before design use, confirm Design Context in order: creator-confirmed loaded instructions; root `.impeccable.md`; then fixed `teach-impeccable` only as a bounded organizer in AI-DLC's existing question flow. Audience, use cases, and brand tone require creator confirmation. Do not infer from code, edit `AGENTS.md`, add an interview, or add approval. Bind the same confirmed A/B/C brief and record C-only follow-up as an evaluation difference.

Keep pinned reference bytes unchanged. For every design application, read and hash-verify all seven references and produce the routing contract's hashed WCAG correction report: large text is 24 CSS px normal or approximately 18.6667 CSS px bold (WCAG 18pt/14pt bold), overriding only the pinned file's incorrect 18px/14px statement through the adapter.

Record experiment Arm D and UI treatment Arm C as separate identities, read installed contracts/entrypoints, invoke `/aidlc --scope ui-poc-comparison`, preserve brownfield/greenfield classification, and stop after rough-mockups review absent separate authorization. Never fabricate approval-ledger entries.

Report paths, build/dry-run, authorized writes, collisions, exact payload/licenses, compose/plugin/doctor, Design Context and WCAG readiness, and stop point. Separate static/synthetic checks from live execution, model use, and approval.

## Verify automatic D acceleration

Do not copy the source `poc/d-acceleration` directory into `PRODUCT`. The Claude distribution projects the bounded runtime into `.claude/tools/d-acceleration`; verify that ordinary `/aidlc` uses that installed copy and never reaches back into `SRC`. The setup-only preflight is:

Install or update that projected runtime as one indivisible directory, never as a selected-file patch. After setup, byte-compare every file under `SRC/dist/claude/.claude/tools/d-acceleration` with `PRODUCT/.claude/tools/d-acceleration` (for example with `diff -qr`) and stop as a setup failure on any missing, extra, or changed file. This full-tree parity check is required before preflight so later additions such as configuration resolvers cannot be silently omitted. `fresh-install.ts parity` additionally resolves every installed D, spawned-official, and hook entrypoint with Bun's resolver from PRODUCT and stops on any module outside PRODUCT, differing from the package, or importing a non-built-in package.

Also verify that `PRODUCT/.claude/skills/aidlc-issue-autopilot/SKILL.md` exists and is byte-identical to the packaged Claude distribution. Claude Code's standard `/loop` scheduler must not be overwritten; recurring use schedules `/aidlc-issue-autopilot`. Setup must not enable autopilot or create project configuration unless the person explicitly requested those exact settings for this product.

```bash
(cd "$PRODUCT" && bun "$PRODUCT/.claude/tools/d-acceleration/run.ts" --project-dir "$PRODUCT" --preflight)
```

Preflight must report `uiBaseline: C-composed`, `acceleration: D-automatic-for-supported-waves`, the four supported design waves, three supported read-only stages, the exact PRODUCT runtime path, and no missing compose files. Treat any other result as setup failure. Do not manually start the runner for ordinary design work: `/aidlc` invokes it for supported official waves. Every unsupported stage and every gate returns unchanged to the official host.

Acceleration is automatic only for a supported official wave and fails closed to the official host. The installed C plugin, pinned payload, HTML evidence contracts, blocking sensor, approvals, and downstream handoffs remain fully active. The runner obtains a fresh official `orchestrate next`; accepts only policy-supported read-only fanout or official design waves; preserves `gate`, state, stage, memory/record paths, contribution contracts, and sensor dispatch; and keeps overlapping writes, reviewers, approvals, and unsupported topologies serial.

Confirm at execution time: PRODUCT/framework paths, timeout/concurrency, and evidence/log locations. Never install, authenticate, or reconfigure a model provider. D tier routing is separate from official per-agent `config models` policy. Its precedence is explicit D CLI override, `.claude/d-acceleration.local.jsonc`, `.claude/d-acceleration.jsonc`, then the confirmed Claude CLI `opus` alias as the unspecified-tier default; requested, launched, and runtime-reported model identities remain separate. Legacy `.json` names remain readable, but do not install both names for one layer because the runtime rejects that ambiguity. Clef routing was removed on 2026-10-17; a leftover `clef` key or `--clef-*` flag fails closed, so remove it instead of installing it. The planner keeps design-wave work at `balanced` or above and protected decisions at `judgment`.

Approval checkpoint persistence is a separate, project-controlled D feature. It is off by default and reads `gitPersistence` from `.claude/d-acceleration.local.jsonc`, then `.claude/d-acceleration.jsonc`, with `enabled`, `push`, `remote`, and `branch` fields. Do not enable either commit or push unless the person explicitly requested it for this PRODUCT. Verify that the installed Claude `PostToolUse` Bash hook runs `d-persistence-hook.ts` immediately after the official `rebuild-stage-graph` hook; this preserves the official report/auto-advance result as the checkpoint input. Do not add a second prompt-based commit path, run the hook in workers, or turn a failed push into a stage rollback.

The ordinary `/aidlc` skill runs only the installed `run.ts`; it resolves PRODUCT's composed engine/framework and obtains a fresh official directive. Workers write only their issued disjoint output sets; the native gate/state owner integrates and settles them. The D tools must never bypass the C plugin's HTML deliverables, approval receipts, `ui-poc-evidence` sensor, or refined-to-code-to-test handoff. Save preflight, stdout, stderr, enabled-feature summary, and returned official handoff as the D execution record; import checks alone are not setup completion.

Report the retained C source pins and licenses, UI compose status, D source commit, acceleration mode, directive validation, fallback disposition, requested/runtime model IDs, evidence paths, and exact official next handoff. Fixtures, fake workers, dry runs, and benchmark estimates are synthetic evidence and are not live-model or speed claims.

## Optional PR Lens supplemental review (opt-in only)

`poc/pr-lens-review` is an optional plugin. It adds a supplemental PR Lens
diagram and review at Build and Test. The switch `features.prLensReview` is
OFF by default because a review run is slow. Do not install the plugin or
enable the switch unless the person explicitly asked for PR Lens review in
this PRODUCT. Setup itself must never set `features.prLensReview`.

When asked, read [`../../../poc/pr-lens-review/README.md`](../../../poc/pr-lens-review/README.md).
Then, from `SRC`, after the D install:

```bash
bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/pr-lens-review claude --json
bun poc/pr-lens-review/scripts/setup-pr-lens.ts --product "$PRODUCT" --dry-run
```

Present the preview. It lists the fetch of
`https://github.com/coldteadotai/pr-lens.git` at exactly
`7a9115c8202da4db030be5954ada8862e6135dce` (MIT) into
`PRODUCT/.vendor/pr-lens`, the pnpm install/build, the receipt, the local
`.git/info/exclude` lines, and the project-local compose. Apply by rerunning
the same command without `--dry-run`. Add `--offline` when only the local
pnpm store may be used.

The setup stops on any of these, and you report it as a setup failure:

- an existing checkout at another commit
- a changed licence
- dirty compose surfaces
- a non-idempotent compose

The person turns the review on in `.claude/d-acceleration.local.jsonc` or
`.claude/d-acceleration.jsonc` with `{ "features": { "prLensReview": true } }`.
Then preflight must show `supplementalReview.prLensReview.status: ready` and
no unmet `features.prLensReview` row.

The review never replaces official reviewers, sensors, approvals, or gates.
When it is OFF it does nothing. When it is ON without the pinned install, it
fails closed with a one-line next step.

## Optional refined-mockups design skill (opt-in only)

The refined-mockups design slot defaults to the pinned Arm C component
(`impeccable-historical`). The person may choose another skill for the
`ui-poc-application` and `ui-poc-requirements` scopes:

- `impeccable`: Impeccable 4.6.0, `pbakaus/impeccable@08d5b470`, Apache-2.0.
- `ui-ux-pro-max`: UI/UX Pro Max, `nextlevelbuilder/ui-ux-pro-max-skill@56ea9cf1`, MIT. It needs `python3`.
- `ponta-pass-design`: the Pontaパス design system, `local/ponta-pass-design@c73c420e` (a Git tree ID). It is not published, so it is never fetched: ask the person for the absolute path of their copy and add `--source <path>` to both setup commands. It needs `python3`.

The router refuses any non-default choice in `ui-poc-comparison`. Do not
install a choice or set `uiDesign.refinedMockupSkill` unless the person
explicitly asked for that skill in this PRODUCT. Setup itself must never set
the value.

When asked, read [`../../../poc/d-acceleration/configuration.md`](../../../poc/d-acceleration/configuration.md)
("詳細モックアップのデザインスキル"). Then, from `SRC`, after the D install:

```bash
bun poc/ui-poc/scripts/setup-design-skill.ts --product "$PRODUCT" --skill <id> --dry-run
```

Present the preview: the pinned repository and commit, the source skill
directory, `PRODUCT/.agents/skills/<id>/`, and the licence paths. Apply by
rerunning the same command without `--dry-run`.

The setup stops on any of these, and you report it as a setup failure:

- installed routing files that differ from SRC
- a symlink or submodule in the pinned skill
- a `--source` folder with an extra, missing, or changed file
- a licence that differs from the record
- an existing file that differs from the pinned file
- an extra file in the install directory

The person selects the skill in `.claude/d-acceleration.local.jsonc` or
`.claude/d-acceleration.jsonc` with
`{ "uiDesign": { "refinedMockupSkill": "<id>" } }`. Then preflight must show
`optional.uiDesign` with that value and no unmet `uiDesign.refinedMockupSkill`
row.
