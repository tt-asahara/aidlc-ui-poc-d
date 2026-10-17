---
target: build-and-test
plugin: pr-lens-review
fragments:
  - anchor: before-step:11
    order: 900
---

## fragment: before-step:11

### PR Lens supplemental review (optional, D switch `features.prLensReview`)

Only when application implementation exists, run `bun {{HARNESS_DIR}}/tools/d-acceleration/pr-lens-gate.ts` once before anything PR Lens related, and act on its result exactly:

- `"status":"skipped-by-config"` (exit 0, the default): stop this section here. Do not run PR Lens, do not create `.pr-lens/` or any review file, and do not mention PR Lens in this stage's artifacts. The skip is recorded only in D's own evidence.
- Exit 2 (`not-ready`): the switch is ON but the pinned PR Lens or this plugin is not installed. Report its one-line next step to the person as a limitation of this stage. Never present it as a passed or completed PR Lens review, and never install or fetch anything yourself.
- `"status":"ready"`: follow `{{HARNESS_DIR}}/tools/pr-lens-review/SKILL.md`.

The PR Lens diagram and report supplement this stage's source, requirement, and test review. They never change sensor results, reviewer decisions, test verdicts, approval state, or gate outcomes, and they never decide a gate. A missing application diff is an explicit unavailable result, not a reason to diagram AI-DLC setup files. A PR Lens validation or render failure, or a diagram/source disagreement, is recorded as a limitation and never as review success.
