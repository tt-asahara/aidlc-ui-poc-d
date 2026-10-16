# AI-DLC acceleration coverage

This table prevents the proof of concept from being mistaken for a complete
replacement execution runtime.

| Area | Status | Owner / boundary |
|---|---|---|
| Initialization stages | Official delegation | AI-DLC engine remains serial and owns state creation and audit |
| Ideation stages | Official delegation | Approval and human judgment stay in the official conductor |
| Inception stages | Official delegation | Stage transitions and approvals are not scheduled here |
| Functional Design per-Unit wave | Locally exercised | Same-stage, engine-issued entries only; bounded fake child processes overlap |
| NFR Requirements per-Unit wave | Planner-supported | Official wave stage, but no raw `aidlc next` integration fixture yet |
| NFR Design per-Unit wave | Planner-supported | Official wave stage, but no raw `aidlc next` integration fixture yet |
| Infrastructure Design per-Unit wave | Planner-supported | Official wave stage, but no raw `aidlc next` integration fixture yet |
| Code Generation swarm | Not executable here | Official worktree preparation, referee merge, landing, receipts, and settlement are required |
| Build and Test / reviewers | Official delegation | Kept serial; official reviewer scope and receipts remain authoritative |
| Operation stages | Official delegation | No custom parallel dispatch |
| Ensemble spokes / mob contribution | Not implemented | Existing official ensemble implementation should be used |
| Model selection | Adapter only | Claude argv exists, but no host model-list discovery; fake argv evidence only |
| Clef routing | Local adapter verified | Optional low-risk ambiguous classification; deterministic and safety decisions excluded |

## Missing integration evidence

There is currently no test that pipes the raw JSON produced by an actual
`aidlc next` invocation directly into this scheduler. The fixture models the
reviewed directive shape but is not engine-issued evidence. There is also no
authenticated Claude execution. Caller `modelCatalog` is never accepted for
Claude; production use needs a catalog record derived from the selected host's
own model-list response and must retain
requested, launched, and runtime-reported identities separately.
