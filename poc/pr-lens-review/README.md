# pr-lens-review: optional PR Lens supplemental review (D, default OFF)

An optional AIDLC plugin for D. At Build and Test, when application code exists,
it can draw the change with a pinned [PR Lens](https://github.com/coldteadotai/pr-lens)
and write an evidence-backed supplemental review. The review takes minutes and
extra model use, so it is **OFF by default**. You turn it on with one JSONC key.

Ported from the dogfood-2 product-local plugin (`product-plugins/pr-lens-review`,
branch `feat/pr-lens-review`, commits `a2e6c2e`, `03be4fd`, `73c6514`, `cb5405c`).
Owner decision: issue #10, "accept, default OFF". Evidence:
[`../d-acceleration/audit/pr-lens.md`](../d-acceleration/audit/pr-lens.md).

## Contract

- **Supplemental only.** The diagram and report add to Build and Test's own
  source, requirement, and test review. They never replace or change official
  reviewers, sensors, test verdicts, approvals, or gate outcomes, and they never
  decide a gate.
- **Where it runs.** The fragment is composed before Build and Test Step 11
  (`before-step:11`, order 900), after the Cross-Unit coverage gate. It runs only
  when application implementation exists. With no application diff, `prepare`
  refuses: it never diagrams AI-DLC records or setup files.
- **Switch OFF (default).** The fragment's first command,
  `bun .claude/tools/d-acceleration/pr-lens-gate.ts`, prints
  `"status":"skipped-by-config"` and exits 0. Nothing PR Lens related runs and
  no review file is created. The skip is recorded only in D's own evidence,
  `aidlc/.aidlc-engine/d-evidence/build-and-test-pr-lens-review.json`.
- **Switch ON but not installed.** This covers a missing checkout, a pin
  mismatch, a changed licence, a build that differs from the setup receipt, and
  a missing composed fragment. The gate and every plugin command **fail closed**
  with exit 2 and one line that names the next step (run the setup, or switch
  OFF). They never report success.
- **Switch ON and ready.** The agent follows
  `.claude/tools/pr-lens-review/SKILL.md`:
  1. `prepare` freezes the application diff and supporting AI-DLC evidence.
  2. The agent writes the graph.
  3. `validate-render` runs only the pinned CLI's local `validate` and `render`.
     It never uses `analyze`, `comment`, `canvas`, `auth`, or any publication.
  4. The agent writes the review files.
  5. `verify-report` checks file integrity and provenance.

  Semantic quality remains an AI judgment.

The switch (`features.prLensReview`) has one owner: `d-config.ts`.
`../d-acceleration/pr-lens-pin.ts` owns the pin and install check, and
`../d-acceleration/pr-lens-gate.ts` owns the gate. The plugin tool, the doctor
check, the setup, and `run.ts --preflight` all call those modules.

## Pin and licence

- Repository: `https://github.com/coldteadotai/pr-lens.git`
- Commit: `7a9115c8202da4db030be5954ada8862e6135dce` (cli 0.13.0, renderer 0.3.2)
- Licence: MIT, Copyright (c) 2026 Coldtea AI. The notice is shipped at
  [`LICENSES/pr-lens/LICENSE`](LICENSES/pr-lens/LICENSE). Its sha256
  (`f95e90af…1ae7`) is the value the install check requires of
  `.vendor/pr-lens/LICENSE`.

Nothing from PR Lens is vendored into this repository. dogfood-2 pinned it as a
Git submodule of the product. D does not, because:

- a submodule of this source repository is not part of the packaged runtime
  that installs copy into a PRODUCT;
- adding a submodule to the PRODUCT would rewrite its `.gitmodules` and index.

Instead the setup does a **pinned, verified fetch** into the PRODUCT:

1. It fetches exactly the pinned commit into `PRODUCT/.vendor/pr-lens`.
2. It requires `HEAD` to be that commit, the commit object to exist, the tracked
   tree to be clean, and the LICENSE bytes to match.
3. It installs with `pnpm install --frozen-lockfile` and builds.
4. It writes `PRODUCT/.vendor/pr-lens.receipt.json`, which binds the commit to
   a hash of every built `packages/*/dist` file.

It never moves an existing checkout. It stops on any difference. The vendored
directory, the receipt, and `.pr-lens/` are added to the PRODUCT's local
`.git/info/exclude`. That file is untracked, and the PRODUCT `.gitignore` is not
changed.

## Opt in

From the D source checkout (`SRC`), with D already installed in `PRODUCT`
(`poc/d-acceleration/fresh-install.ts install`):

```bash
bun scripts/package.ts claude
bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/pr-lens-review claude
bun poc/pr-lens-review/scripts/setup-pr-lens.ts --product "$PRODUCT" --dry-run   # preview
bun poc/pr-lens-review/scripts/setup-pr-lens.ts --product "$PRODUCT"             # fetch, build, receipt, compose
```

Flags:

- `--offline` passes `--offline` to pnpm, so it uses only the local pnpm store.
- `--verify` also runs the upstream typecheck and tests. That is slow.

The setup needs `git`, Node.js with `corepack` (pnpm 10.5.2 is pinned by the
upstream `packageManager`), and network access to github.com and the npm
registry, unless you pass `--offline`.

The setup **does not turn the review on**. Set the switch yourself:

```jsonc
// PRODUCT/.claude/d-acceleration.local.jsonc (personal) or d-acceleration.jsonc (project)
{ "features": { "prLensReview": true } }
```

Then confirm `bun .claude/tools/d-acceleration/run.ts --project-dir "$PRODUCT" --preflight`.
It shows `optional.features.prLensReview` and
`supplementalReview.prLensReview.status` (`ready`), and two
`features.prLensReview` prerequisite rows. `/aidlc --doctor` shows a
`Plugin check (pr-lens-review)` row. Like `ui-poc`, the plugin is composed
project-locally with no Claude marketplace entry. The doctor's
`pr-lens-review:installed-missing` host-inventory warning is expected.

After a D update (`fresh-install.ts update`), rerun the setup. It is
idempotent: it keeps an existing pinned checkout, rebuilds, rewrites the
receipt, and recomposes. Preflight reports a missing fragment as an unmet
prerequisite.

The fragment and skill call two commands that the project allow list does not
cover: `bun .claude/tools/d-acceleration/pr-lens-gate.ts` and
`bun .claude/tools/pr-lens-review.ts`. Claude Code may ask for permission the
first time. Allow them in your local settings if you want no prompt.

## Build and test

```bash
bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/ui-poc claude
bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/pr-lens-review claude
bun test --timeout 120000 poc/pr-lens-review/tests
```

The suite uses the real generated runtime and the real compose hooks, with a
fake renderer, so it needs no network. A real smoke run is recorded under
[`../d-acceleration/evidence/pr-lens/`](../d-acceleration/evidence/pr-lens/). It
covers the setup against the real pinned repository, a render of a synthetic
sample with the pinned renderer, and verify. That sample is synthetic. It is not
a review of a real application.

## Why `poc/` and not `plugins/`

Every directory under `plugins/` is emitted by `bun scripts/package.ts` for all
seven harnesses, and the release fixtures include it. This plugin is
Claude-only. Its gate lives in D's Claude-only runtime
(`.claude/tools/d-acceleration/`). It is built and composed project-locally,
exactly like `poc/ui-poc`. Keeping it under `poc/` leaves the multi-harness
packaging and release surfaces unchanged.
