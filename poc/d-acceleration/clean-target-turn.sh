#!/usr/bin/env bash
# One headless real-host turn in a clean D target.
#
#   clean-target-turn.sh PRODUCT LOG_DIR NAME MODE PROMPT [KILL_AFTER_SECONDS]
#
# MODE is "new:<uuid>" (start session <uuid>) or "resume:<uuid>".
# The workspace has never been through Claude Code's interactive trust dialog,
# so project permission rules are ignored by the CLI. Instead of changing the
# user's global ~/.claude.json, this passes exactly the installed
# .claude/settings.json allow list with --allowedTools, which is the same
# authority a trusted workspace would grant. User settings are excluded
# (--setting-sources project,local) to prove no global plugin or user hook is
# needed. With KILL_AFTER_SECONDS the CLI process group is killed with SIGKILL
# after that many seconds (crash injection).
set -euo pipefail
PRODUCT=$1 LOG_DIR=$2 NAME=$3 MODE=$4 PROMPT=$5 KILL_AFTER=${6:-}
MODEL=${CLEAN_TARGET_MODEL:-sonnet}
BUDGET=${CLEAN_TARGET_BUDGET_USD:-3}
mkdir -p "$LOG_DIR"
ALLOW=()
while IFS= read -r rule; do ALLOW+=("$rule"); done < <(bun -e '
  const s = JSON.parse(await Bun.file(process.argv[1]).text());
  console.log(s.permissions.allow.join("\n"));' "$PRODUCT/.claude/settings.json")
case "$MODE" in
  new:*) SESSION=(--session-id "${MODE#new:}") ;;
  resume:*) SESSION=(--resume "${MODE#resume:}") ;;
  *) echo "MODE must be new:<uuid> or resume:<uuid>" >&2; exit 2 ;;
esac
cd "$PRODUCT"
set +e
claude -p "$PROMPT" "${SESSION[@]}" --setting-sources project,local --model "$MODEL" \
  --output-format stream-json --verbose --max-budget-usd "$BUDGET" \
  --allowedTools "${ALLOW[@]}" </dev/null >"$LOG_DIR/$NAME.jsonl" 2>"$LOG_DIR/$NAME.err" &
PID=$!
if [[ -n "$KILL_AFTER" ]]; then
  ( sleep "$KILL_AFTER"; if kill -0 "$PID" 2>/dev/null; then
      pkill -KILL -P "$PID" 2>/dev/null; kill -KILL "$PID" 2>/dev/null; echo "killed $PID after ${KILL_AFTER}s" >>"$LOG_DIR/$NAME.err"; fi ) &
  WATCH=$!
fi
wait "$PID"; STATUS=$?
[[ -n "${WATCH:-}" ]] && kill "$WATCH" 2>/dev/null || true
echo "$NAME exit=$STATUS"
exit 0
