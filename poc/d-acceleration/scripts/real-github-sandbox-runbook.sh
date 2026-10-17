#!/usr/bin/env bash
# Real-GitHub sandbox runbook for issue #8 (and #6 "external integration").
#
# DRY-RUN BY DEFAULT: prints every command and executes nothing. It contacts
# GitHub only with BOTH `--execute` and AIDLC_SANDBOX_CONFIRM set to the exact
# sandbox repository. Every external write is a separately printed step; the
# human authorizes the run as a whole and the decision-summary publication
# additionally needs the payload-bound host-recorded permission (step 5).
#
# The local equivalent (fake gh + bare remote, no network) is
#   bun test poc/d-acceleration/tests/external-sandbox.integration.test.ts
# This script exists for what a fake cannot prove: real gh authentication on the
# real host, real Issue/label/search semantics, real push credentials, and CI.
#
# Required environment:
#   AIDLC_SANDBOX_REPO     HOST/owner/name or owner/name of a DISPOSABLE repo
#                          whose name contains "sandbox" (refused otherwise)
#   AIDLC_SANDBOX_PRODUCT  absolute path of a product with the Claude package
#                          installed (.claude/tools present) and origin = that repo
#   AIDLC_D_DIR            directory holding the D tools (default: this script's ../)
# Optional:
#   AIDLC_SANDBOX_CONFIRM  must equal AIDLC_SANDBOX_REPO for --execute
#   AIDLC_SANDBOX_LABEL    autopilot label (default aidlc-auto)
#   AIDLC_SANDBOX_EVIDENCE evidence directory (default ./sandbox-evidence-<utc>)
#
# Usage: real-github-sandbox-runbook.sh [--execute]
set -euo pipefail

MODE=dry-run
[[ "${1:-}" == "--execute" ]] && MODE=execute

REPO="${AIDLC_SANDBOX_REPO:?set AIDLC_SANDBOX_REPO to the disposable sandbox repository}"
PRODUCT="${AIDLC_SANDBOX_PRODUCT:?set AIDLC_SANDBOX_PRODUCT to the sandbox product checkout}"
D_DIR="${AIDLC_D_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
LABEL="${AIDLC_SANDBOX_LABEL:-aidlc-auto}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE="${AIDLC_SANDBOX_EVIDENCE:-$PWD/sandbox-evidence-$STAMP}"
BRANCH="aidlc-sandbox/$STAMP"

case "$REPO" in *sandbox*) ;; *) echo "refused: repository name must contain 'sandbox': $REPO" >&2; exit 2 ;; esac
HOST=github.com
[[ "$(awk -F/ '{print NF}' <<<"$REPO")" == 3 ]] && HOST="${REPO%%/*}"

if [[ "$MODE" == execute && "${AIDLC_SANDBOX_CONFIRM:-}" != "$REPO" ]]; then
  echo "refused: --execute requires AIDLC_SANDBOX_CONFIRM=$REPO" >&2; exit 2
fi

step=0
say() { step=$((step + 1)); printf '\n## %02d %s\n' "$step" "$1"; }
# run <evidence-name> <argv...>: fixed argv, no shell evaluation of arguments.
run() {
  local name="$1"; shift
  printf '$'; printf ' %q' "$@"; printf '\n'
  [[ "$MODE" == execute ]] || return 0
  mkdir -p "$EVIDENCE"
  printf '%q ' "$@" >"$EVIDENCE/$name.argv"
  set +e; "$@" >"$EVIDENCE/$name.out" 2>"$EVIDENCE/$name.err"; local status=$?; set -e
  echo "$status" >"$EVIDENCE/$name.status"
  cat "$EVIDENCE/$name.out"
  return 0
}
need_human() { printf '>> HUMAN: %s\n' "$1"; [[ "$MODE" == execute ]] && read -r -p ">> press Enter when done " _; return 0; }
# ask_var NAME prompt: the human types a value this run needs (execute mode only).
ask_var() { printf '>> HUMAN: %s\n' "$2"; if [[ "$MODE" == execute ]]; then read -r -p ">> $1=" "$1"; fi; return 0; }

echo "mode=$MODE repo=$REPO host=$HOST product=$PRODUCT branch=$BRANCH evidence=$EVIDENCE"

say "Preflight (read-only): exact-host gh auth, repo identity, origin host"
run 01-auth gh auth status --hostname "$HOST"
run 02-repo gh repo view "$REPO" --json nameWithOwner,visibility,isArchived,defaultBranchRef
run 03-origin git -C "$PRODUCT" config --get remote.origin.url

say "Autopilot status before any write (read-only; expect disabled while config is OFF)"
run 04-autopilot-off bun "$D_DIR/issue-autopilot-cli.ts" --project-dir "$PRODUCT" --repo "$REPO" status

say "WRITE: label + two disposable Issues (one labelled, one not)"
run 05-label gh label create "$LABEL" --repo "$REPO" --description "AI-DLC sandbox autopilot" --force
run 06-issue-labelled gh issue create --repo "$REPO" --title "[aidlc-sandbox $STAMP] labelled task" --body "Disposable sandbox task. Build a hello endpoint." --label "$LABEL"
run 07-issue-unlabelled gh issue create --repo "$REPO" --title "[aidlc-sandbox $STAMP] unlabelled task" --body "Disposable sandbox task without the label."
need_human "set auto.enabled=true, issueAutopilot.enabled=true, auto.labelAllowlist=[\"$LABEL\"] in $PRODUCT/.claude/d-acceleration.jsonc"

say "from-issue: discovery list, label poll, explicit numbers (labelled / unlabelled), rerun idempotency"
run 08-list bun "$D_DIR/issue-autopilot-cli.ts" --project-dir "$PRODUCT" --repo "$REPO" list
run 09-label-poll bun "$D_DIR/issue-autopilot-cli.ts" --project-dir "$PRODUCT" --repo "$REPO" "$LABEL"
ask_var N_LABELLED "Issue number printed by step 06 (labelled)"
ask_var N_UNLABELLED "Issue number printed by step 07 (unlabelled)"
run 10-explicit-unlabelled bun "$D_DIR/issue-autopilot-cli.ts" --project-dir "$PRODUCT" --repo "$REPO" "${N_UNLABELLED:-<N_UNLABELLED>}"
run 11-explicit-rerun bun "$D_DIR/issue-autopilot-cli.ts" --project-dir "$PRODUCT" --repo "$REPO" "${N_LABELLED:-<N_LABELLED>}"
run 12-stop bun "$D_DIR/issue-autopilot-cli.ts" --project-dir "$PRODUCT" --repo "$REPO" stop

say "Decision summary: generate locally, then the human authorizes the exact payload hash"
need_human "set decisionIssueSummary {enabled:true, repository:\"$REPO\", send:true}; AIDLC_GH_EXECUTABLE_PATH (realpath of the native gh) and AIDLC_GH_EXECUTABLE_SHA256 must be exported before starting this script"
ask_var INTENT_DIR "absolute path of the active Intent directory"
run 13-summary-generate bun "$D_DIR/decision-issue-summary.ts" generate --project-dir "$PRODUCT" --intent-dir "${INTENT_DIR:-<INTENT_DIR>}" --decisions-file "${INTENT_DIR:-<INTENT_DIR>}/decisions/ai-approval-decisions.jsonl"
need_human "compute sha256 of the JSON payload from 13 and type in the host session exactly: AI-DLC authorize-decision-summary --repository $REPO --intent <relative intent> --payload-sha256 <hash>"

say "WRITE: publish, publish again (must update the same Issue), verify exactly one marker Issue"
run 14-summary-publish bun "$D_DIR/decision-issue-summary.ts" publish --project-dir "$PRODUCT" --intent-dir "${INTENT_DIR:-<INTENT_DIR>}" --decisions-file "${INTENT_DIR:-<INTENT_DIR>}/decisions/ai-approval-decisions.jsonl"
run 15-summary-republish bun "$D_DIR/decision-issue-summary.ts" publish --project-dir "$PRODUCT" --intent-dir "${INTENT_DIR:-<INTENT_DIR>}" --decisions-file "${INTENT_DIR:-<INTENT_DIR>}/decisions/ai-approval-decisions.jsonl"
run 16-summary-count gh issue list --repo "$REPO" --state all --search "aidlc-decision-summary in:body" --json number,title,url

say "WRITE: git persistence push to a disposable branch (opt-in, fixed refspec, never forced)"
run 17-branch git -C "$PRODUCT" switch -c "$BRANCH"
need_human "set gitPersistence {enabled:true, push:true, remote:\"origin\", branch:\"$BRANCH\"}; approve one stage in the host session so the PostToolUse hook persists the crossing"
run 18-pending cat "$PRODUCT/.git/aidlc-d-persistence/pending-push.json"
run 19-remote-ref git -C "$PRODUCT" ls-remote origin "refs/heads/$BRANCH"

say "CI evidence for the pushed branch (read-only)"
run 20-checks gh run list --repo "$REPO" --branch "$BRANCH" --json name,status,conclusion,headSha,url

say "Cleanup (WRITE, separately confirmed): close disposable Issues, delete the branch"
need_human "confirm cleanup"
run 21-close-labelled gh issue close "${N_LABELLED:-<N_LABELLED>}" --repo "$REPO" --comment "aidlc sandbox run $STAMP finished"
run 22-close-unlabelled gh issue close "${N_UNLABELLED:-<N_UNLABELLED>}" --repo "$REPO" --comment "aidlc sandbox run $STAMP finished"
run 23-delete-branch git -C "$PRODUCT" push origin --delete "$BRANCH"

echo
echo "done (mode=$MODE). Evidence: $EVIDENCE"
