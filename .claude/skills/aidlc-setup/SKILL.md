---
name: aidlc-setup
description: Set up this repository's AI-DLC Claude runtime and bounded D acceleration PoC in another product while preserving official host authority and existing files. Do not use for the A/B/C UI plugin.
argument-hint: "[D checkout path] [product repository path]"
user-invocable: true
---

# Set up AI-DLC D acceleration

Invoke from the D checkout containing this skill. D is an opt-in acceleration PoC around the official host, not a UI treatment/plugin. Never build, copy, install, or reference `poc/ui-poc`, frontend-design, Impeccable, or the comparison scope.

## Establish boundaries

1. Resolve absolute `SRC` and `PRODUCT`. Confirm exact target, project scope, disposable/non-production use, trust/permissions, and preview-versus-apply authority.
2. Inspect both repos with `git -C <path> status --short --branch`. Preserve every tracked, untracked, ignored, and uncommitted product file. Never overwrite `CLAUDE.md`, `AGENTS.md`, `.claude`, settings, hooks, skills, or plugins. Never change authentication, global/shared settings, or model defaults.
3. Read [`../../../poc/d-acceleration/README.md`](../../../poc/d-acceleration/README.md), [`verification.md`](../../../poc/d-acceleration/verification.md), [`stage-coverage.md`](../../../poc/d-acceleration/stage-coverage.md), [`stage-policy.json`](../../../poc/d-acceleration/stage-policy.json), [`schema.md`](../../../poc/d-acceleration/schema.md), and [`clef-local-contract.md`](../../../poc/d-acceleration/clef-local-contract.md).

The official host retains questions, approvals, reviews, transitions, shared state/artifacts, mob/ensemble/pipeline modes, and code-generation swarm settlement.

## Build and preview

From `SRC`, stop on failure:

```bash
bun install --frozen-lockfile
bun scripts/package.ts claude
bun test poc/d-acceleration/tests
bun "$SRC/dist/claude/.claude/tools/aidlc.ts" config --from "$SRC/dist/claude" --harness claude --project-dir "$PRODUCT" --mcp none --dry-run
```

`--from` must be `SRC/dist/claude`, never `dist` or `.claude`. Present target, writes, and collisions. A passing dry run is not apply authority. Stop on dirty targets/differences; never use `--force`. Apply only after approval using the identical config command without `--dry-run`.

## Stage D without clobbering

Runtime config does not install the PoC. Compare complete `SRC/poc/d-acceleration/` with a user-approved project-local destination, defaulting to `PRODUCT/poc/d-acceleration/` only if appropriate. Include it in preview. Copy an absent tree only after approval; leave byte-identical; stop on differences. Never embed `SRC`, `PRODUCT`, Clef checkout, credentials, model IDs, or log directories. Run its tests from the product checkout. Fixtures, fake workers, dry runs, and benchmark estimates remain synthetic evidence.

## Parameterize the handoff

Ask for or confirm at execution time: product/framework absolute paths; existing loopback Clef URL (contract default `http://127.0.0.1:18742`) and explicitly reviewed low-risk Units; user-selected fast/balanced/judgment model request values available in their authorized terminal; approved evidence/log directory; timeout/concurrency; and read-only fanout versus official design wave.

Do not start, stop, install, authenticate, or reconfigure Clef during setup. Health-check only a confirmed loopback URL without reading environment values. Do not log in, buy model access, or claim requested models were used; retain requested, launched, and runtime-reported IDs separately.

For read-only fanout, require the current unmodified official `orchestrate next`, a policy-supported inline `gate:false` stage, independent evidence paths, and caller model catalog. Run `read-only-fanout.ts --dry-run` first. A real run validates a fresh official `next`; workers remain read-only and return separate findings to the lead.

For design waves, use `conductor.ts` only for an engine-issued official wave in the four implemented design stages. Pass user-selected model values, loopback `--clef-url`, explicit `--clef-low-risk-units` when applicable, project/framework paths, timeout, and separate stdout/stderr log destinations. Return approvals, reviews, gates, unsupported topologies, completed worker records, and the next official handoff unchanged to the host. Never use fake-artifact mode as real evidence.

## Continue in the correct project

Give a handoff with resolved paths, approved changes, parameterized dry-run, log locations, and official-host next step. Shell `cd` does not switch Claude projects. Open a new Claude session rooted at `PRODUCT`; verify host root and `git rev-parse --show-toplevel`. Inspect `/plugin` **Installed** or `claude plugin list` only to confirm existing plugins remain—D installs none—then `/aidlc --doctor`. Obtain a fresh official `orchestrate next` before PoC execution and return every boundary to the official host.

Report paths, build/tests/dry-run, authorized writes/collisions, PoC hash, Clef URL/health disposition, requested versus runtime model IDs, process working directory, stdout/stderr/evidence locations, directive validation, and exact official next handoff. Separate static, synthetic, dry-run, and authenticated evidence; never claim unrecorded transition, approval, review, model use, quality, speed, or cost.
