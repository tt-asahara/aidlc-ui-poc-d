# D audit record (issue #10)

This is a point-in-time audit of source tree
`bb813a169157ffe7aa85ea03892d82ef1200252a`, which is shared by PR #4 head
`29f4820d`, `main` `3bde2496`, and `develop` `52447d81`. It was observed on
2026-10-17. Later commits do not change these files; a new audit adds a new
record.

| File | Content |
|---|---|
| [`lineage.md`](lineage.md) | A/B/C/D upstream, branches, divergence points, included and excluded change sets; PR #4 scope and CI; local-only work |
| [`lineage.sh`](lineage.sh), [`lineage-results.txt`](lineage-results.txt) | Reproducible comparison commands and their captured output |
| [`adopted-ledger.md`](adopted-ledger.md) | Items 7, 9–17, 21, 22, 27, 28: wording, source, implementation, packaged hash, config, test, installed run, status |
| [`skill-invocation.md`](skill-invocation.md), [`skill-invocation-evidence.txt`](skill-invocation-evidence.txt) | Whether stage files actually route to the C skills, traced through packaged output and a disposable compose |
| [`pr-lens.md`](pr-lens.md) | Primary evidence of pr-lens use in the earlier dogfood. The standardization decision is left to the human. |

Markers: **未確認** means the claim is not settled by primary evidence, and
each occurrence names what would settle it. **未実施** means the run has not
been performed.
