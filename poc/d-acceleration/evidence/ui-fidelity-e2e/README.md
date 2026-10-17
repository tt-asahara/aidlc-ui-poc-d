# UI fidelity: scripted dogfood evidence (Refined Mockups → Construction)

`run-dogfood.cjs` runs a bounded, scripted dogfood on a disposable temp
project:

1. **Refined Mockups**: the approved fixture mockup
   (`poc/ui-poc/fixtures/fidelity-e2e/approved/notes.html`) is rendered by the
   real Chrome renderer in all six declared states; the refined contract gate
   runs.
2. **Functional Design**: `rule-matrix generate` builds the element matrix; a
   **real model** (local `claude -p`, no tools) receives the shipped
   functional-design contribution text, the generated rows, and the mockup,
   and writes `functional-spec.md`, `frontend-components.md`, and the rule IDs.
   `rule-matrix check` and the Functional Design gate run. One repair round
   with the gate findings is allowed.
3. **Code Generation**: the real model receives the approved Functional Design
   documents and matrix (plus the mockup as reference) and writes a single-file
   implementation; the code-generation gate checks the handoff chain.
4. **Build and Test**: the implementation is served on loopback, every state
   is captured, the element-level test matrix is generated, and the
   build-and-test gate recomputes and checks it.

`run.json` records the requested model, the runtime-reported model IDs
(`modelUsage`), usage, cost, duration, every gate result, and the per-semantic
results for deletion confirmation details, completion wording, long-note
truncation/expansion, private-mode guidance, and storage-read failure text.

## Not covered by this script (remaining procedure)

- Approvals are **synthetic** operator ledger entries written by the script so
  the deterministic gates can run. No human approved anything and no official
  AI-DLC gate was exercised.
- The official `/aidlc` engine, directives, reviewer agents, Design Context
  questions, and Arm C routing evidence were not exercised.

To close the item with an official run:

1. `bun scripts/package.ts`; `bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/ui-poc claude --json`.
2. Create a disposable product and install it with the `aidlc-setup` skill. Compose `poc/ui-poc/dist/claude` with its `hooks/compose.ts`, run it twice, and confirm 0 drops and an idempotent graph.
3. Put `UI_POC_APPROVAL_LEDGER` in an operator-owned file outside the product. The agent must not be able to write to it.
4. Run `/aidlc --scope ui-poc-application` with the memo-app request, then:
   - Approve Refined Mockups at the official gate. Record the human approval in the ledger.
   - At Functional Design, the contribution has the agent generate and fill `ui-poc-element-rule-matrix.json` and write `ui-poc-functional-contract.md`. The `ui-poc-evidence` sensor blocks on any matrix finding. Approve at the official gate and record the approval.
   - At Code Generation, the gate refuses the handoff unless the approved FD contract copy, matrix, snapshot, and dispositions are present.
   - At Build and Test, capture the running app, generate `ui-poc-element-test-matrix.json`, and confirm that the sensor passes.
5. Keep the audit log, ledger, sensor outputs, and the five semantics' rows as the evidence.

## Runs

See `runs/<timestamp>/run.json`. The first run (`2026-10-17T06-09-58-515Z`)
found a real capture-tool defect. While the capture tool verified the
`CONFIRM-DELETE` action, the model-written app persisted the delete to
localStorage. The tool then reloaded the page with that state still in place,
so the `STATE-CONFIRM-DELETE` capture lost its `DELETE-NOTE` setup control,
which produced a false NOT-READY (6 failed rows). `resetPageStorage` now
clears origin storage before every verification reload. A regression test in
`poc/ui-poc/tests/fidelity-e2e-browser.test.cjs` fails without the fix.
Re-capturing that same model output with the fix gives 26/26 elements pass.

The second run (`2026-10-17T06-16-12-298Z`, with the fix) was a clean end-to-end
run and returned **READY**:

- Requested model `sonnet`; the runtime reported `claude-sonnet-5-5` for both model steps.
- Functional Design: matrix check passed on the first attempt (36 s, $0.094).
- Code Generation: 45 s, $0.113.
- Build and Test: 26/26 approved elements passed, and all five reported semantics passed.
- Every stage gate passed.

Approvals in the run were synthetic, as described above.
