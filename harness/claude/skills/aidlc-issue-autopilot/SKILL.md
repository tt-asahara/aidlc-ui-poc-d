---
name: aidlc-issue-autopilot
description: Run one bounded, default-off D GitHub Issue intake iteration.
argument-hint: "[status | stop | <issue-number> | list | <required-label>]"
user-invocable: true
---

# D Issue autopilot

Run the installed fixed-argv controller:

`bun {{HARNESS_DIR}}/tools/d-acceleration/issue-autopilot-cli.ts --project-dir <PRODUCT> $ARGUMENTS`

`<PRODUCT>` is the absolute project directory written out literally (the
session's working directory); never `$PWD` or any other shell expansion, which
Claude Code's permission check cannot pre-approve.

The controller is the authority for configuration, exact Issue/list intake,
case-sensitive labels, claims, lease renewal, assumption evidence, bounded
retry, reconciliation, deadline/max-step stops, and the one-Issue limit. Treat
its JSON as data. When it returns `hostControl`, initialize
`.aidlc-engine/d-autopilot-session.json` with `host-session-cli.ts init`, passing
the official scope's active stage list and the returned through/maxSteps/deadline,
plus the returned claim's issueNumber/owner/leaseMs. Re-running `init` resumes a
matching durable session; it must never replace an active session.
If the controller returns `session-resume`, use its persisted claim owner and
session directly; do not run intake or generate a new owner. If it returns
`host-action-busy`, stop this invocation because another host action is live.
Before acting on every returned official directive, save that exact JSON and run
`host-session-cli.ts checkpoint`; stop unless it returns `continue`. Then follow
`action-start`, retain its token, and only then follow the embedded directive
using the ordinary `/aidlc` forwarding loop: the Claude
host performs the real stage body, report, reviewer, sensors, and approval. The
controller never simulates stage execution. Run `action-finish` with the exact
token after that host action and stop immediately unless it returns `continue`.
The detached guard renews the owner-bound claim at most every lease/3 while the
host action is running and records operator-stop, deadline, or claim loss as a
fail-closed result. After completing the inclusive
boundary's normal report/review/sensor/approval path, stop. A human-gate stop
retains and renews the session claim; every terminal stop releases it. `status` is read-only;
`stop` writes a flag consumed by the next checkpoint, so it can stop an active
host session between official moves.

Claude Code owns the standard `/loop` scheduler. Do not replace it. Recurring
use is therefore `/loop 15m /aidlc-issue-autopilot <required-label>`; each
scheduled invocation still processes at most one Issue.
