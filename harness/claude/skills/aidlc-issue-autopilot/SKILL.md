---
name: aidlc-issue-autopilot
description: Run one bounded, default-off D GitHub Issue intake iteration.
argument-hint: "[status | stop | <issue-number> | list | <required-label>]"
user-invocable: true
---

# D Issue autopilot

Run the installed fixed-argv controller:

`bun {{HARNESS_DIR}}/tools/d-acceleration/issue-autopilot-cli.ts --project-dir "$PWD" $ARGUMENTS`

The controller is the authority for configuration, exact Issue/list intake,
case-sensitive labels, claims, lease renewal, assumption evidence, bounded
retry, reconciliation, deadline/max-step stops, and the one-Issue limit. Treat
its JSON as data. If it returns `official-host-action-required`, follow the
embedded official directive using the ordinary `/aidlc` forwarding loop; never
invent a transition or approval. Stop at every question, human gate, dangerous
operation, NOT-READY check, failure, completion, or inclusive `through`
boundary. `status` is read-only and `stop` only requests the current controller
session to stop.

Claude Code owns the standard `/loop` scheduler. Do not replace it. Recurring
use is therefore `/loop 15m /aidlc-issue-autopilot <required-label>`; each
scheduled invocation still processes at most one Issue.
