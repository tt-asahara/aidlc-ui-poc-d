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
3. Read [`../../../poc/ui-poc/README.md`](../../../poc/ui-poc/README.md), [`../../../poc/ui-poc/docs/verification.md`](../../../poc/ui-poc/docs/verification.md), [`../../../poc/ui-poc/docs/contract.md`](../../../poc/ui-poc/docs/contract.md), [`../../../poc/ui-poc/docs/c-stage-skill-matrix.md`](../../../poc/ui-poc/docs/c-stage-skill-matrix.md), [`../../../poc/ui-poc/treatments/c.json`](../../../poc/ui-poc/treatments/c.json), its [`source-lock.json`](../../../poc/ui-poc/treatments/source-lock.json), [`../../../poc/skill-installation.json`](../../../poc/skill-installation.json), and the D acceleration [`README.md`](../../../poc/d-acceleration/README.md), [`verification.md`](../../../poc/d-acceleration/verification.md), [`stage-policy.json`](../../../poc/d-acceleration/stage-policy.json), and [`clef-local-contract.md`](../../../poc/d-acceleration/clef-local-contract.md).

Keep A/B/C conditions comparable. Do not substitute Anthropic frontend-design, latest Impeccable, engine/hooks/subagents, or an unavailable historical custom extension.

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

Use exactly `SRC/dist/claude` as runtime source and `SRC/poc/ui-poc/dist/claude` as marketplace. Confirm projection of `tools/ui-poc-c-routing.cjs`, `tools/ui-poc/c-stage-routing.json`, treatment/source-lock/runtime contract, and sensor adapter. Never use `dist` or `.claude` for `--from`, edit generated output, or use `--force`.

Present target, writes, and collisions. Stop on dirty target, differing path, or impact to settings/hooks/skills/plugins. A passing preview is not apply authority. Apply only after approval by rerunning the same command without `--dry-run`.

## Place the exact C payload

Compare complete product-relative directories: `.agents/skills/{prototype,grilling,domain-modeling,to-spec}`, `frontend-design` with all seven reference files, `teach-impeccable`, `.agents/skills/LICENSES/mattpocock-skills`, and `.agents/skills/LICENSES/impeccable` with `LICENSE` and `NOTICE.md`. Add absent directories only in the approved write set; leave byte-identical ones; stop on differences. Never merge or overwrite. Verify paths, bytes, commits, dependency, licenses, and exclusions against the installation manifest, treatment C, and source lock.

## Install and verify

Provide a handoff with resolved paths and commands, then open a new Claude session rooted at `PRODUCT`; shell `cd` is insufficient. Verify host root and `git rev-parse --show-toplevel`, then run:

```text
/plugin marketplace add <SRC>/poc/ui-poc/dist/claude
/plugin install aidlc-ui-poc@aidlc-plugins
```

Preserve existing plugins. Start another PRODUCT-rooted session, inspect `/plugin` **Installed** (or `claude plugin list`), and `/aidlc --doctor`. Confirm `ui-poc-comparison`, no unexpected compose drops, treatment C, routing verifier/config, runtime companion, sensor, all references/dependency/licenses. Do not use `/plugin list`.

## Preserve C adapters

Before design use, confirm Design Context in order: creator-confirmed loaded instructions; root `.impeccable.md`; then fixed `teach-impeccable` only as a bounded organizer in AI-DLC's existing question flow. Audience, use cases, and brand tone require creator confirmation. Do not infer from code, edit `AGENTS.md`, add an interview, or add approval. Bind the same confirmed A/B/C brief and record C-only follow-up as an evaluation difference.

Keep pinned reference bytes unchanged. For every design application, read and hash-verify all seven references and produce the routing contract's hashed WCAG correction report: large text is 24 CSS px normal or approximately 18.6667 CSS px bold (WCAG 18pt/14pt bold), overriding only the pinned file's incorrect 18px/14px statement through the adapter.

Record experiment Arm D and UI treatment Arm C as separate identities, read installed contracts/entrypoints, invoke `/aidlc --scope ui-poc-comparison`, preserve brownfield/greenfield classification, and stop after rough-mockups review absent separate authorization. Never fabricate approval-ledger entries.

Report paths, build/dry-run, authorized writes, collisions, exact payload/licenses, compose/plugin/doctor, Design Context and WCAG readiness, and stop point. Separate static/synthetic checks from live execution, model use, and approval.

## Verify automatic D acceleration

Do not copy the source `poc/d-acceleration` directory into `PRODUCT`. The Claude distribution projects the bounded runtime into `.claude/tools/d-acceleration`; verify that ordinary `/aidlc` uses that installed copy and never reaches back into `SRC`. The setup-only preflight is:

```bash
(cd "$PRODUCT" && bun "$PRODUCT/.claude/tools/d-acceleration/run.ts" --project-dir "$PRODUCT" --preflight)
```

Preflight must report `uiBaseline: C-composed`, `acceleration: D-automatic-for-supported-waves`, the four supported design waves, three supported read-only stages, the exact PRODUCT runtime path, and no missing compose files. Treat any other result as setup failure. Do not manually start the runner for ordinary design work: `/aidlc` invokes it for supported official waves. Every unsupported stage and every gate returns unchanged to the official host.

Acceleration is automatic only for a supported official wave and fails closed to the official host. The installed C plugin, pinned payload, HTML evidence contracts, blocking sensor, approvals, and downstream handoffs remain fully active. The runner obtains a fresh official `orchestrate next`; accepts only policy-supported read-only fanout or official design waves; preserves `gate`, state, stage, memory/record paths, contribution contracts, and sensor dispatch; and keeps overlapping writes, reviewers, approvals, and unsupported topologies serial.

Confirm at execution time: PRODUCT/framework paths, timeout/concurrency, evidence/log locations, and any existing loopback Clef URL. Never install, start, authenticate, or reconfigure Clef or a model provider. D tier routing is separate from official per-agent `config models` policy. Its precedence is explicit D CLI override, `.claude/d-acceleration.local.json`, `.claude/d-acceleration.json`, then the confirmed Claude CLI `opus` alias as the unspecified-tier default; requested, launched, and runtime-reported model identities remain separate. Clef is optional and low-risk only; each route records attempted/available/used/outcome, and timeout, malformed output, low confidence, or transport failure falls back conservatively.

The ordinary `/aidlc` skill runs only the installed `run.ts`; it resolves PRODUCT's composed engine/framework and obtains a fresh official directive. Workers write only their issued disjoint output sets; the native gate/state owner integrates and settles them. The D tools must never bypass the C plugin's HTML deliverables, approval receipts, `ui-poc-evidence` sensor, or refined-to-code-to-test handoff. Save preflight, stdout, stderr, enabled-feature summary, and returned official handoff as the D execution record; import checks alone are not setup completion.

Report the retained C source pins and licenses, UI compose status, D source commit, acceleration mode, directive validation, fallback disposition, requested/runtime model IDs, evidence paths, and exact official next handoff. Fixtures, fake workers, dry runs, and benchmark estimates are synthetic evidence and are not live-model or speed claims.
