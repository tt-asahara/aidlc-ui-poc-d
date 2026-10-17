# Clean D target: install, update, parity, real-host run, and evidence manifest

This is the reproducible procedure for a **separate clean target** built from a
reviewed commit. It never touches an existing dogfood product. Every step is
deterministic except the headless real-host turns, which use the already
authenticated local `claude` CLI.

`SRC` is the reviewed checkout (record `git rev-parse HEAD`); `PRODUCT` is a new
empty directory outside `SRC`.

## 1. Build

```bash
cd "$SRC"
bun scripts/package.ts claude
bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/ui-poc claude --json
```

## 2. Install (documented setup path, automated)

```bash
mkdir -p "$PRODUCT" && git -C "$PRODUCT" init -q -b main
git -C "$PRODUCT" commit -q --allow-empty -m "empty product"
bun poc/d-acceleration/fresh-install.ts install --src "$SRC" --product "$PRODUCT"
```

`install` runs exactly the steps of `.claude/skills/aidlc-setup/SKILL.md`:
official `aidlc config --dry-run` (stops on any conflict), the same command
without `--dry-run`, no-clobber placement of the pinned C payload under
`.agents/skills`, project-local compose run twice with an identical-tree check,
full package parity, and D preflight. It also appends a marked `.gitignore`
block for D's root `.aidlc-engine/` runtime files and writes
`.claude/d-install-receipt.json` (source SHA, package hash, and the exact bytes
compose produced for each composed stage source and the orchestrator skill).
It stops on a dirty PRODUCT, a differing C payload, a non-idempotent compose,
any parity failure, or a preflight that is not ready.

## 3. Update

```bash
bun poc/d-acceleration/fresh-install.ts update --src "$SRC" --product "$PRODUCT"
```

Compose deliberately changes shipped stage sources, so the official
`aidlc config` reports them as "locally modified" on every later update and
would require `--force`; compose itself never overwrites a plugin file it
copied earlier. `update` passes `--force` only when every conflict is named by
the installed plugin contribution sidecar **and** still has the exact bytes
recorded in the receipt, and it removes a stale plugin-copied file (so compose
re-copies it) under the same receipt proof; a team edit to a composed stage stops the update
and names the file. It then re-composes, re-verifies parity, and rewrites the
receipt. Only `.claude`, `.agents`, and `.gitignore` must be clean, so an update
can run while an Intent is in progress. A product installed before receipts
existed can pass `--legacy-install-commit <product commit that recorded the
install>`; each conflict must then equal that commit's bytes.

## 4. Package parity

```bash
bun poc/d-acceleration/fresh-install.ts parity --src "$SRC" --product "$PRODUCT"
```

Checks, from the installed location only:

- `.claude/tools/d-acceleration` has no missing, extra, or changed file
  against `SRC/dist/claude`;
- Bun's own resolver (`Bun.build` metafile, `packages: "external"`) over every
  installed D script, the official scripts the D CLIs spawn by path, and every
  hook script named in the installed `settings.json` yields a transitive module
  closure that lies entirely inside `PRODUCT/.claude`, is byte-identical to the
  package, and imports only Node/Bun built-ins;
- every file compose copies from the ui-poc plugin payload (`tools/`,
  `sensors/`, `scopes/`) is present and byte-identical (Markdown after
  `{{HARNESS_DIR}}` substitution). Compose is no-clobber, so without this an
  update silently keeps a stale plugin tool and only logs a degraded drop;
- `aidlc` and `aidlc-issue-autopilot` skills are present; the only accepted
  difference in `aidlc/SKILL.md` is compose's added scope-table rows for scopes
  the plugin installed.

## 5. Headless real-host turns

```bash
poc/d-acceleration/clean-target-turn.sh "$PRODUCT" "$LOGS" t1 new:<uuid> \
  "/aidlc --auto Build a tiny command-line todo list in TypeScript ..."
poc/d-acceleration/clean-target-turn.sh "$PRODUCT" "$LOGS" t2 resume:<uuid> "poc"
```

A brand-new workspace has never passed Claude Code's interactive trust dialog,
so the CLI ignores project `permissions.allow`. The driver passes exactly the
installed allow list with `--allowedTools` instead of editing the user's global
`~/.claude.json`, and uses `--setting-sources project,local` so no user-level
plugin or hook is involved. An optional last argument kills the CLI after N
seconds (crash injection). Restart with a new session id and plain `/aidlc`.

## 6. Evidence manifest

```bash
bun poc/d-acceleration/fresh-install.ts manifest --src "$SRC" --product "$PRODUCT" \
  --run-log "$LOGS/t1.jsonl" --run-log "$LOGS/t2.jsonl" --out manifest.json
```

Schema `aidlc-d-clean-target/v1`: source SHA/branch/dirty files; package tree
hashes (`dist/claude/.claude`, the D runtime, the ui-poc plugin payload, the C
payload); installed runtime hashes and parity summary; `bun`, `claude`, and
`aidlc` versions; raw D config files with hashes plus the runtime-resolved
effective values and install receipt; per-run session id, requested session
model, assistant/runtime-reported models, cost, turns, terminal state, and
permission denials; every official Intent with stage dispositions and
SHA-256 of its state, audit, and JSONL receipts; and PRODUCT Git refs.

## Lifecycle tests on an installed target

`tests/fresh-install.integration.test.ts` covers install/parity/update/receipt
refusal/manifest. `tests/clean-target-lifecycle.integration.test.ts` drives the
installed runtime and official engine through scope wait, single bootstrap,
crash replay without a duplicate Intent, lock contention, an injected heartbeat
kill, restart, human-gate wait credit, no-progress, boundary, and operator stop.
