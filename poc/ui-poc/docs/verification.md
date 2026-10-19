# Verification record

Checked 2026-10-14. Runtime used: installed Node v24.19.0 and Python 3. No dependencies installed, no auth changes, no archive fetch, no user-computer access. The local verification predates repository publication; repository-level WORKLOG.md records the subsequent remote checkpoints.

## Passed local checks

- `node --test tests/evidence.test.cjs`: 35 tests passed, 0 failed, 0 skipped. Synthetic valid evidence, missing/tampered HTML and CSS, path traversal and symlink escapes, malformed contract, incomplete/duplicate mappings, wrong stage/arm, absent or changed approvals, detached-ledger requirement, upstream hash binding, and direct TS adapter stdout.
- `python3 tests/check-source-contract.py --source-root /path/to/pinned-source --tree /path/to/tree.json`: 23 contribution targets exist in pinned tree; all authored fragment anchors exist in inspected pinned stages; 30 selected source blob identities verified (a single materialization trailing newline is explicitly recorded if present).
- `node tools/aidlc-sensor-ui-poc-evidence.ts --stage refined-mockups --output-path /missing`: exits 0 with JSON `{pass:false, findings_count:1, findings:[...]}`, the upstream sensor-script result contract. Exit 0 does NOT mean a successful sensor finding; `pass` determines it.

## Source-backed API findings

Pinned commit: 6a378b53c0a4fe0641ed7d8de8dfff94264d5b6a.

- core/tools/aidlc-sensor-schema.ts validates id/kind/command/default_severity/description; accepts fire_on gate and output_path input schema.
- core/tools/aidlc-sensor.ts resolveScriptPath requires a .ts token or native sensor delegate and resolves sibling tool basenames. resolveSensorScriptPath checks aidlc-sensor-<id>.ts. The manifest prefix is NOT executed as an arbitrary shell command.
- Dispatcher decideOutcome reads script JSON boolean pass and numeric findings_count. It generates its OWN verdict with fire_id, sensor_id, stage, output_path, result, detail_path and optional note. This plugin correctly does not impersonate those dispatcher fields.
- docs/reference/07-sensor-system.md documents blocking gate enforcement: only an unnoted passed verdict is accepted. Malformed script output creates a script-error note, which the blocking gate rejects. That is source-backed behavior, NOT a locally executed dispatcher/gate test.
- Contributions use implemented adds.scopes/produces/consumes/sensors and before-step/after-step anchors. They do not rely on deferred adds.requires_stage or non-enforced adds.required_sections.
- Scope guard_policy uses the supported strict value (also used by pinned core enterprise scope), not a boolean on value. Draft producers do not gain extra approval gates; consumers verify prior ordinary approvals.

- `node --test tests/visual.test.cjs` (2026-10-17): 24 tests passed. Synthetic PNGs cover renderer-metadata refusal (browser version, scale factor, viewport, OS, fonts hash, flags, incomplete legacy metadata), policy binding, size drift, deliberate 1px and anti-aliasing noise passing, real element changes failing, masks (including missing targets and maxMaskRatio), calibration, and diff-image output.
- Real headless capture (2026-10-17, local Chrome 155 on macOS arm64, `node ../d-acceleration/evidence/visual-regression/run-real-capture.mjs <scratch>`): all 9 expected outcomes met. Re-capturing the same build with a masked clock gave 0 differing pixels; the loopback observation passed; the 1px dot (1 pixel) and anti-aliasing noise (118 anti-aliased pixels tolerated) passed; the button label change (183 pixels), the whole-content 0.25px shift, and the unmasked clock (a demonstrated false positive) failed; scale factor 2 against 1 was refused NOT-READY; `bundled-only` fonts passed with a pinned web font and refused a system font (`FONT_NOT_PINNED: HiraKakuProN-W3`). Evidence: `../d-acceleration/evidence/visual-regression/summary.json` plus diff PNGs.

## Not run / remaining blockers

- Official plugin validation, Claude projection build, disposable compose integration, generated graph inspection, zero-drop check, and idempotent second compose: PASS on 2026-10-16 in this checkout. This is deterministic harness evidence, not a live model run or human approval.
- Real dispatcher audit writes and engine blocking gate test (including malformed stdout): NOT RUN. No simulated harness replaces this requirement.
- Model-backed CLI / actual stage handoff / external skill invocation: NOT RUN. Live CLI preflight is blocked by a read-only home directory; no permissions workaround performed.
- Real human approval capture, ledger ownership/ACL enforcement, and identity: NOT VERIFIED. A detached file alone is not a trust guarantee. An operator must manage its source beyond the agent’s write authority. No production approval receipts are shipped.
- C selection is now resolved: historical official frontend-design component at 209444a9d552c18bcaa74e26bf66a25fc568a767 plus the same Matt payload as B. See treatments/c.json for the exact 11-file design/dependency/license inventory. This does not claim latest full Impeccable, complete historical package behavior, installation, or stage execution; runtime/hooks remain excluded.
- Exact old custom stage-2.5 HTML extension reproduction: source unavailable. It is separate from pinned public Matt skills and not required merely to create this new integration.
- Multi-Unit Build and Test uses the aggregate shape `fidelity.unitContracts` (every Unit implementation contract, re-validated per Unit) plus the deterministic union of the Unit-scoped element rule matrices; an unowned or inconsistently owned element is NOT-READY (`tests/unit-matrix.test.cjs`, synthetic six-Unit fixture). Real multi-Unit dogfood evidence is still pending.
- Asset dependency completeness, visual/accessibility quality, semantic AC completeness, and actual browser behavior are NOT established by hashes. The contract requires every local dependency declared and no remote dependencies, but the checker does not inspect every dynamic import or network request. Review/browser checks remain required.

No test here establishes A/B/C superiority, successful AI-DLC execution, real approval, or original-extension parity.

## Review hardening

Full upstream envelope/asset validation is recursive through refined → implementation → test, with prior approval at each consumption edge, fixed maximum chain depth and repeated real-path rejection. Runtime documentation/config now resides in the projected tools/ui-poc subtree. Source static validation refuses an incorrect commit or truncated/unspecified tree. Contribution effects are global while the plugin is enabled; isolated A/B/C repositories are required, not merely selecting the owned scope. These fixes remain locally tested only.
