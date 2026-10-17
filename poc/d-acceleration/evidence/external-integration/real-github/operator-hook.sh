#!/usr/bin/env bash
# Operator automation used for the recorded real-GitHub sandbox run
# (AIDLC_SANDBOX_HOOK). It edits sandbox configuration and seeds synthetic,
# non-confidential data only. It deliberately does NOT record a human turn:
# the decision-summary permission checkpoint is skipped, so publication must
# stop fail-closed.
set -euo pipefail
P="$AIDLC_SANDBOX_PRODUCT"
CFG="$P/.claude/d-acceleration.json"
merge() { bun -e 'const [, path, patch] = process.argv; const fs = require("node:fs"); const cur = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {}; const next = { ...cur }; for (const [k, v] of Object.entries(JSON.parse(patch))) next[k] = { ...(cur[k] ?? {}), ...v }; fs.writeFileSync(path, JSON.stringify(next, null, 2) + "\n");' "$CFG" "$1"; }
case "$1" in
  enable-autopilot)
    merge "{\"auto\":{\"enabled\":true,\"sessionOnly\":true,\"ambiguityPolicy\":\"assume\",\"assumptionLedger\":true,\"labelAllowlist\":[\"$LABEL\"]},\"issueAutopilot\":{\"enabled\":true}}" ;;
  summary-config)
    merge "{\"decisionIssueSummary\":{\"enabled\":true,\"repository\":\"$AIDLC_SANDBOX_REPO\",\"send\":true}}"
    space="$(cat "$P/aidlc/active-space")"; intent="$(cat "$P/aidlc/spaces/$space/intents/active-intent")"
    dir="$P/aidlc/spaces/$space/intents/$intent"; mkdir -p "$dir/decisions"
    printf '{"schemaVersion":1,"decisionId":"%s","stage":"requirements-analysis","outcome":"approve","reason":"Sandbox: synthetic decision for publication gating","evidence":[{"path":"aidlc/spaces/%s/intents/%s/aidlc-state.md","sha256":"%s"}],"uncertainties":[]}\n' \
      "$(printf 'sandbox-decision-1' | shasum -a 256 | cut -d' ' -f1)" "$space" "$intent" "$(shasum -a 256 "$dir/aidlc-state.md" | cut -d' ' -f1)" > "$dir/decisions/ai-approval-decisions.jsonl" ;;
  summary-permission)
    echo "skipped: no host-recorded human turn is ever produced by automation" ;;
  persistence-config)
    merge "{\"gitPersistence\":{\"enabled\":true,\"push\":true,\"remote\":\"origin\",\"branch\":\"$BRANCH\"}}"
    printf 'sandbox result v1\n' > "$P/aidlc/sandbox-result.md" ;;
  persistence-offline)
    git -C "$P" config --get remote.origin.url > "$EVIDENCE/.origin-url"
    git -C "$P" remote set-url origin /nonexistent/aidlc-offline-remote.git
    printf 'sandbox result v2\n' > "$P/aidlc/sandbox-result.md" ;;
  persistence-online)
    git -C "$P" remote set-url origin "$(cat "$EVIDENCE/.origin-url")" ;;
  persistence-foreign)
    other="$EVIDENCE/.foreign-clone"; rm -rf "$other"
    git clone -q --branch "$BRANCH" "$(git -C "$P" config --get remote.origin.url)" "$other"
    git -C "$other" -c user.name=aidlc-sandbox-other -c user.email=other@example.invalid commit -q --allow-empty -m "sandbox: unrelated concurrent commit"
    git -C "$other" push -q origin "$BRANCH"
    rm -rf "$other"
    printf 'sandbox result v3\n' > "$P/aidlc/sandbox-result.md" ;;
  *) echo "unknown checkpoint $1" >&2; exit 2 ;;
esac
