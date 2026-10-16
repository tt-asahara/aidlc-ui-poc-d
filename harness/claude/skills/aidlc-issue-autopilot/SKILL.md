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
its JSON as data. When it returns `hostControl`, initialize
`.aidlc-engine/d-autopilot-session.json` with `host-session-cli.ts init`, passing
the official scope's active stage list and the returned through/maxSteps/deadline,
plus the returned claim's issueNumber/owner/leaseMs. Re-running `init` resumes a
matching durable session; it must never replace an active session.
Before acting on every returned official directive, save that exact JSON and run
`host-session-cli.ts checkpoint`; stop unless it returns `continue`. Then follow
the embedded directive using the ordinary `/aidlc` forwarding loop: the Claude
host performs the real stage body, report, reviewer, sensors, and approval. The
controller never simulates stage execution. After completing the inclusive
boundary's normal report/review/sensor/approval path, stop. A human-gate stop
retains and renews the session claim; every terminal stop releases it. `status` is read-only;
`stop` writes a flag consumed by the next checkpoint, so it can stop an active
host session between official moves.

Claude Code owns the standard `/loop` scheduler. Do not replace it. Recurring
use is therefore `/loop 15m /aidlc-issue-autopilot <required-label>`; each
scheduled invocation still processes at most one Issue.
