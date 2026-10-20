# D hook projection boundary

The D extension keeps `core/` byte-identical to upstream `6a378b53`. It uses
the existing generic `engine hook <name>` route, which loads `run(input)` from
the packaged runtime in native installs and from the project runtime in the
copy channel. No dispatcher or approval mechanism is duplicated.

Four D-owned adapters under `poc/d-acceleration/hooks/` are projected into
`hooks/aidlc-d-*.ts`. Their uniquely named targets pass the same path/basename
collision guard as other D files. The actual D modules remain under
`tools/d-acceleration/`; their standalone source CLI entry points remain intact.
Native hook commands use `aidlc engine hook ...`; they do not spawn external
Bun, import an edited project adapter, or widen a permission rule. Blocking
sensor guidance uses native engine command spellings in a compiled process.

The hook order and decisions are unchanged: persistence pre captures the report
boundary; persistence post consumes only the matching successful call; reviewer
cleanup and blocking-sensor guidance follow the official graph rebuild. The
four adapters are advisory. They do not add a human approval or bypass a gate.

## Baseline comparison and regression coverage

The `bb4754a9` baseline was built in a separate local clone. Its unchanged
`t219-claude-project-dir-quoting` and `t-claude-hook-project-root` tests reproduce
three failures. The affected unit implementations and D hook commands were
unchanged by the evidence/hash commits through `d57a553d`.

| Failing unit family | Cause and correction |
| --- | --- |
| t219, t-claude-hook-project-root | D commands bypassed the shared dispatcher. All four registrations now use its existing hook route. The assertions are unchanged. |
| t-native-install-hooks, t238-build-binaries, t244-install-management | Native settings retained direct Bun hook commands. The adapters expose `run(input)` to the native runtime. Existing execution/release assertions remain enforced. |
| t294-config-diagnostics, t296-config-setup-walk | Noncanonical D hook registrations disagreed with the setup/refresh/doctor dispatcher contract. Registration is corrected at the authored source. |
| t132-hooks-doc-count-sync | Four D registrations had no corresponding dispatcher hook source. Four real adapters now ship alongside the seventeen core hooks; documentation and its English number parser represent 21 sources and 20 hook-block entries. Independent disk/settings/doc equality remains enforced. |
| t145-packaging-parity, t294-document-extractors-seam | Source-only scratch copies omitted the D projection/runtime imported by the packager. Both fixtures now copy that dependency. No assertion is removed. |
| t123-skills-spec-conformance (unit) | The exact Claude skill inventory omitted the already-shipped autopilot skill. It is named explicitly; other harness inventories and the 500-line ceiling are unchanged. |
| t249-copilot-adapter compiled coverage | The required native build was absent after its release gate failed. Validate again after the native gate succeeds; do not disable compiled coverage. |

The native hook regression also blocks external Bun on PATH, exercises D
persistence marker creation/failed-call cleanup, reviewer cleanup and guidance,
and tampers with the project adapter to prove the installed runtime is used.
It explicitly requires all four D registrations, so deleting D to satisfy a
native test cannot pass. The ordinary D integration test still pins hook order.
