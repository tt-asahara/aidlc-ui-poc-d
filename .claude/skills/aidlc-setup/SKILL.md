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
bun test poc/d-acceleration/tests tests/resume-ledger.test.ts
bun "$SRC/dist/claude/.claude/tools/aidlc.ts" config --from "$SRC/dist/claude" --harness claude --project-dir "$PRODUCT" --mcp none --dry-run
```

`--from` must be `SRC/dist/claude`, never `dist` or `.claude`. Present target, writes, and collisions. A passing dry run is not apply authority. Stop on dirty targets/differences; never use `--force`. Apply only after approval using the identical config command without `--dry-run`.

## Keep the D harness in its source checkout

Do not copy `poc/d-acceleration` into `PRODUCT`. Its tools intentionally import pinned source contracts from `SRC/core`, and its integration tests use `SRC/tests/harness`; copying only the PoC tree creates a broken runtime, while copying `core` or `tests` would add an unauthorized source tree to the product. Keep the complete D checkout at `SRC` and invoke its tools by absolute path while the process working directory is `PRODUCT`.

Before handoff, verify source-relative resolution without writing to the product:

```bash
(cd "$PRODUCT" && bun -e 'await import(process.argv[1])' "$SRC/poc/d-acceleration/read-only-fanout.ts")
(cd "$PRODUCT" && bun -e 'await import(process.argv[1])' "$SRC/poc/d-acceleration/conductor.ts")
claude --help
```

The first two checks prove the source checkout supplies the PoC, `core/tools/aidlc-directive.ts`, and sibling modules even when launched from `PRODUCT`. The Claude help output must expose every capability required by `read-only-fanout.ts`; the real runner repeats that capability check immediately before workers. Do not treat any of these checks as a model call. Fixtures, fake workers, dry runs, and benchmark estimates remain synthetic evidence.

## Parameterize the handoff

Ask for or confirm at execution time: product/framework absolute paths; existing loopback Clef URL (contract default `http://127.0.0.1:18742`) and explicitly reviewed low-risk Units; user-selected fast/balanced/judgment model request values available in their authorized terminal; approved evidence/log directory; timeout/concurrency; and read-only fanout versus official design wave.

Do not start, stop, install, authenticate, or reconfigure Clef during setup. Health-check only a confirmed loopback URL without reading environment values. Do not log in, buy model access, or claim requested models were used; retain requested, launched, and runtime-reported IDs separately.

For read-only fanout, require the current unmodified official `orchestrate next`, a policy-supported inline `gate:false` stage, independent PRODUCT-relative evidence paths, and caller model catalog. Create the input in an approved temporary or product evidence location, then preview from the product working directory:

```bash
(cd "$PRODUCT" && bun "$SRC/poc/d-acceleration/read-only-fanout.ts" \
  --input '<absolute-input-path>' \
  --project-dir "$PRODUCT" \
  --framework-dir "$SRC/core" \
  --dry-run)
```

Do not use the example directive as authority. A real run removes `--dry-run`, validates a fresh official `next` through `SRC/core/tools`, and keeps workers read-only with separate findings returned to the lead.

For design waves, use `SRC/poc/d-acceleration/conductor.ts` only for an engine-issued official wave in the four implemented design stages. Launch it from `PRODUCT`, pass `--project-dir "$PRODUCT"`, `--engine-dir "$SRC/core/tools"`, user-selected model values, loopback `--clef-url`, explicit `--clef-low-risk-units` when applicable, timeout, and separate stdout/stderr log destinations. Return approvals, reviews, gates, unsupported topologies, completed worker records, and the next official handoff unchanged to the host. Never use fake-artifact mode as real evidence.

## Continue in the correct project

Give a handoff with resolved paths, approved changes, parameterized dry-run, log locations, and official-host next step. Shell `cd` does not switch Claude projects. Open a new Claude session rooted at `PRODUCT`; verify host root and `git rev-parse --show-toplevel`. Inspect `/plugin` **Installed** or `claude plugin list` only to confirm existing plugins remain—D installs none—then `/aidlc --doctor`. Obtain a fresh official `orchestrate next` before PoC execution and return every boundary to the official host.

Report paths, build/tests/dry-run, authorized runtime writes/collisions, the retained SRC PoC commit/hash, source-relative import and Claude capability checks, Clef URL/health disposition, requested versus runtime model IDs, PRODUCT process working directory, stdout/stderr/evidence locations, directive validation, and exact official next handoff. Separate static, synthetic, dry-run, and authenticated evidence; never claim unrecorded transition, approval, review, model use, quality, speed, or cost.
