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
# Optional:
#   AIDLC_D_DIR            D tools directory (default: the product's installed
#                          .claude/tools/d-acceleration, else this script's ../)
#   AIDLC_SANDBOX_CONFIRM  must equal AIDLC_SANDBOX_REPO for --execute
#   AIDLC_SANDBOX_LABEL    autopilot label (default aidlc-auto)
#   AIDLC_SANDBOX_EVIDENCE evidence directory (default ./sandbox-evidence-<utc>)
#   AIDLC_SANDBOX_AUTOPILOT_ARGS extra autopilot flags, e.g. "--claude-judgment haiku"
#                          to keep the ambiguity-assessor model run small
#   AIDLC_SANDBOX_HOOK     operator automation: an executable called as
#                          `<hook> <checkpoint>` at every HUMAN checkpoint instead of
#                          waiting for Enter (config edits, seeding a synthetic
#                          decision ledger). It must NOT record a human turn: the
#                          decision-summary permission is only ever typed by the
#                          person in the host session. Without that turn, steps
#                          16/17 are expected to stop fail-closed.
#   AIDLC_SANDBOX_ISSUES   "A,B,U" Issue numbers from an earlier run to reuse
#   AIDLC_SANDBOX_CLEANUP=1 close the disposable Issues at the end
#
# Account check: verify `gh api user -q .login` is the intended account before
# running. Persistence pushes use git's credential helper, not gh; if the
# keychain holds a different github.com account, export for this run only
#   GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=
#   GIT_CONFIG_KEY_1=credential.helper GIT_CONFIG_VALUE_1='!gh auth git-credential'
# (no global git config or keychain change). A wrong account only defers the
# push (pending refspec), it never forces.
#
# Usage: real-github-sandbox-runbook.sh [--execute]
set -euo pipefail

MODE=dry-run
[[ "${1:-}" == "--execute" ]] && MODE=execute

REPO="${AIDLC_SANDBOX_REPO:?set AIDLC_SANDBOX_REPO to the disposable sandbox repository}"
PRODUCT="${AIDLC_SANDBOX_PRODUCT:?set AIDLC_SANDBOX_PRODUCT to the sandbox product checkout}"
if [[ -n "${AIDLC_D_DIR:-}" ]]; then D_DIR="$AIDLC_D_DIR"
elif [[ -f "$PRODUCT/.claude/tools/d-acceleration/issue-autopilot-cli.ts" ]]; then D_DIR="$PRODUCT/.claude/tools/d-acceleration"
else D_DIR="$(cd "$(dirname "$0")/.." && pwd)"; fi
LABEL="${AIDLC_SANDBOX_LABEL:-aidlc-auto}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE="${AIDLC_SANDBOX_EVIDENCE:-$PWD/sandbox-evidence-$STAMP}"
BRANCH="aidlc-sandbox/$STAMP"
# shellcheck disable=SC2206 # intentional word splitting of operator flags
AP_ARGS=(${AIDLC_SANDBOX_AUTOPILOT_ARGS:-})

case "$REPO" in *sandbox*) ;; *) echo "refused: repository name must contain 'sandbox': $REPO" >&2; exit 2 ;; esac
HOST=github.com
[[ "$(awk -F/ '{print NF}' <<<"$REPO")" == 3 ]] && HOST="${REPO%%/*}"

if [[ "$MODE" == execute && "${AIDLC_SANDBOX_CONFIRM:-}" != "$REPO" ]]; then
  echo "refused: --execute requires AIDLC_SANDBOX_CONFIRM=$REPO" >&2; exit 2
fi
export AIDLC_SANDBOX_REPO AIDLC_SANDBOX_PRODUCT BRANCH LABEL EVIDENCE

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
# need_human <checkpoint> <instruction>
need_human() {
  printf '>> HUMAN [%s]: %s\n' "$1" "$2"
  [[ "$MODE" == execute ]] || return 0
  if [[ -n "${AIDLC_SANDBOX_HOOK:-}" ]]; then "$AIDLC_SANDBOX_HOOK" "$1"; else read -r -p ">> press Enter when done " _; fi
}
issue_number() { [[ "$MODE" == execute ]] || return 0; sed -n 's#.*/issues/\([0-9][0-9]*\)$#\1#p' "$EVIDENCE/$1.out" | tail -1; }
autopilot() { run "$1" bun "$D_DIR/issue-autopilot-cli.ts" ${AP_ARGS[@]+"${AP_ARGS[@]}"} --project-dir "$PRODUCT" --repo "$REPO" "${@:2}"; }
persist() {
  # Library-level crossing (the production trigger is the PostToolUse hook after
  # a real stage approval); exercises the same persistCrossing commit/push path.
  run "$1" bun -e 'const [, persistence, config, project, receipt] = process.argv; const { persistCrossing } = await import(persistence); const { resolveDGitPersistence } = await import(config);
console.log(JSON.stringify(persistCrossing(project, resolveDGitPersistence(project), { receipt, events: [{ event: "STAGE_COMPLETED", stage: "intent-capture" }], manifest: ["aidlc/sandbox-result.md"] })));' \
    "$D_DIR/d-persistence.ts" "$D_DIR/d-config.ts" "$PRODUCT" "$2"
}

echo "mode=$MODE repo=$REPO host=$HOST product=$PRODUCT d_dir=$D_DIR branch=$BRANCH evidence=$EVIDENCE"

say "Preflight (read-only): exact-host gh auth, repo identity, origin host"
run 01-auth gh auth status --hostname "$HOST"
run 02-repo gh repo view "$REPO" --json nameWithOwner,visibility,isArchived,defaultBranchRef
run 03-origin git -C "$PRODUCT" config --get remote.origin.url

say "Autopilot before any write (read-only): status while OFF; OFF run never reaches GitHub"
autopilot 04-status-off status
autopilot 05-run-off "$LABEL"

if [[ -n "${AIDLC_SANDBOX_ISSUES:-}" ]]; then
  # Re-run against Issues created by an earlier run (A,B,U); never duplicates them.
  IFS=, read -r N_A N_B N_U <<<"$AIDLC_SANDBOX_ISSUES"
  say "Reusing disposable Issues $N_A,$N_B (labelled) and $N_U (unlabelled)"
  run 06-issues-reused gh issue list --repo "$REPO" --state all --json number,title,labels,state
else
  say "WRITE: label + disposable Issues (labelled x2, unlabelled x1)"
  run 06-label gh label create "$LABEL" --repo "$REPO" --description "AI-DLC sandbox autopilot" --force
  run 07-issue-labelled-a gh issue create --repo "$REPO" --title "[aidlc-sandbox $STAMP] labelled task A" --body "Disposable sandbox task. Add a GET /hello endpoint that returns the plain text hello." --label "$LABEL"
  run 08-issue-labelled-b gh issue create --repo "$REPO" --title "[aidlc-sandbox $STAMP] labelled task B" --body "Disposable sandbox task. Add a GET /health endpoint that returns HTTP 200 with body ok." --label "$LABEL"
  run 09-issue-unlabelled gh issue create --repo "$REPO" --title "[aidlc-sandbox $STAMP] unlabelled task" --body "Disposable sandbox task without the label."
  N_A="$(issue_number 07-issue-labelled-a)"; N_B="$(issue_number 08-issue-labelled-b)"; N_U="$(issue_number 09-issue-unlabelled)"
  echo "issues: labelled=${N_A:-<A>},${N_B:-<B>} unlabelled=${N_U:-<U>}"
fi
need_human enable-autopilot "set auto.enabled=true, auto.sessionOnly=true, auto.labelAllowlist=[\"$LABEL\"], issueAutopilot.enabled=true in $PRODUCT/.claude/d-acceleration.jsonc"

say "Exact-host auth: an unauthenticated host fails closed with the login command (no network)"
run 10-auth-other-host bun "$D_DIR/issue-autopilot-cli.ts" ${AP_ARGS[@]+"${AP_ARGS[@]}"} --project-dir "$PRODUCT" --repo "unauthenticated.invalid/${REPO#github.com/}" "${N_A:-<A>}"

say "from-issue: discovery list, label poll (continue, continue, terminate), explicit numbers, rerun"
autopilot 11-list list
autopilot 12-poll-1 "$LABEL"
autopilot 13-poll-2 "$LABEL"
autopilot 14-poll-3-terminates "$LABEL"
autopilot 15-explicit-unlabelled "${N_U:-<U>}"
autopilot 16-explicit-rerun-no-duplicate "${N_A:-<A>}"
autopilot 17-stop stop

say "Decision summary: generate, publish without a host-recorded permission (must stop)"
need_human summary-config "set decisionIssueSummary {enabled:true, repository:\"$REPO\", send:true}; the active Intent must hold settled delegated answers in decisions/ai-question-answers.jsonl; AIDLC_GH_EXECUTABLE_PATH/AIDLC_GH_EXECUTABLE_SHA256 must name the native gh"
INTENT_DIR="$PRODUCT/aidlc/spaces/$(cat "$PRODUCT/aidlc/active-space" 2>/dev/null || echo default)/intents/$(cat "$PRODUCT/aidlc/spaces/$(cat "$PRODUCT/aidlc/active-space" 2>/dev/null || echo default)/intents/active-intent" 2>/dev/null || echo '<intent>')"
LEDGER="$INTENT_DIR/decisions/ai-question-answers.jsonl"
run 18-summary-generate bun "$D_DIR/decision-issue-summary.ts" generate --project-dir "$PRODUCT" --intent-dir "$INTENT_DIR" --decisions-file "$LEDGER"
run 19-summary-publish-unauthorized bun "$D_DIR/decision-issue-summary.ts" publish --project-dir "$PRODUCT" --intent-dir "$INTENT_DIR" --decisions-file "$LEDGER"
need_human summary-permission "ONLY the person types, in the host session: AI-DLC authorize-decision-summary --repository $REPO --intent <relative intent> --payload-sha256 <sha256 of the payload JSON from 18>. Skip to leave 20/21 fail-closed."
run 20-summary-publish bun "$D_DIR/decision-issue-summary.ts" publish --project-dir "$PRODUCT" --intent-dir "$INTENT_DIR" --decisions-file "$LEDGER"
run 21-summary-republish bun "$D_DIR/decision-issue-summary.ts" publish --project-dir "$PRODUCT" --intent-dir "$INTENT_DIR" --decisions-file "$LEDGER"
run 22-summary-count gh issue list --repo "$REPO" --state all --search "aidlc-decision-summary in:body" --json number,title,url

say "WRITE: git persistence to a disposable branch: commit+push, offline pending refspec retry, no force"
run 23-branch git -C "$PRODUCT" switch -c "$BRANCH"
need_human persistence-config "set gitPersistence {enabled:true, push:true, remote:\"origin\", branch:\"$BRANCH\"}; write aidlc/sandbox-result.md (v1)"
persist 24-persist-push sandbox-receipt-1
run 25-remote-after-push git -C "$PRODUCT" ls-remote origin "refs/heads/$BRANCH"
need_human persistence-offline "point origin at an unreachable URL and write aidlc/sandbox-result.md (v2)"
persist 26-persist-offline-deferred sandbox-receipt-2
run 27-pending-journal cat "$PRODUCT/.git/aidlc-d-persistence/pending-push.json"
need_human persistence-online "restore the origin URL"
persist 28-persist-retry-pending sandbox-receipt-3
run 29-remote-after-retry git -C "$PRODUCT" ls-remote origin "refs/heads/$BRANCH"
need_human persistence-foreign "push an unrelated commit to $BRANCH from another clone; write aidlc/sandbox-result.md (v3)"
persist 30-persist-non-fast-forward sandbox-receipt-4
run 31-remote-unchanged git -C "$PRODUCT" ls-remote origin "refs/heads/$BRANCH"
run 32-remote-branches git -C "$PRODUCT" ls-remote --heads origin

say "CI evidence for the pushed branch (read-only)"
run 33-checks gh run list --repo "$REPO" --branch "$BRANCH" --json name,status,conclusion,headSha,url
run 34-issues-final gh issue list --repo "$REPO" --state all --json number,title,labels,state,url

if [[ "${AIDLC_SANDBOX_CLEANUP:-0}" == 1 ]]; then
  say "Cleanup (WRITE): close the disposable Issues"
  for n in "${N_A:-<A>}" "${N_B:-<B>}" "${N_U:-<U>}"; do run "35-close-$n" gh issue close "$n" --repo "$REPO" --comment "aidlc sandbox run $STAMP finished"; done
fi

echo
echo "done (mode=$MODE). Evidence: $EVIDENCE"
