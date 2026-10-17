#!/usr/bin/env bash
# Reproduce the A/B/C/D lineage comparison recorded in lineage.md.
#
# Read-only with respect to every existing checkout: arms A/B/C are cloned
# bare into WORK (default: a fresh mktemp dir); D is read from the git
# repository this script lives in. Nothing is fetched into, or written to,
# any other checkout.
#
# Usage: bash poc/d-acceleration/audit/lineage.sh [WORK_DIR]
set -euo pipefail

D_REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WORK="${1:-$(mktemp -d)}"
UPSTREAM=6a378b53c0a4fe0641ed7d8de8dfff94264d5b6a   # awslabs/aidlc-workflows v2.11.0
mkdir -p "$WORK"

echo "# lineage.sh  date=$(date -u +%FT%TZ)  D_REPO_HEAD=$(git -C "$D_REPO" rev-parse HEAD)"

echo
echo "## remote heads (git ls-remote, pull refs omitted)"
for arm in a b c d; do
  echo "### aidlc-ui-poc-$arm"
  git ls-remote "https://github.com/tt-asahara/aidlc-ui-poc-$arm.git" | grep -v 'refs/pull/' || true
done

for arm in a b c; do
  [ -d "$WORK/$arm.git" ] || git clone -q --bare "https://github.com/tt-asahara/aidlc-ui-poc-$arm.git" "$WORK/$arm.git"
done

echo
echo "## per-branch divergence from upstream v2.11.0 ($UPSTREAM)"
for arm in a b c; do
  for ref in $(git -C "$WORK/$arm.git" for-each-ref --format='%(refname:short)' refs/heads); do
    mb=$(git -C "$WORK/$arm.git" merge-base "$ref" "$UPSTREAM" 2>/dev/null || echo none)
    ahead=$(git -C "$WORK/$arm.git" rev-list --count "$ref" ^"$UPSTREAM" 2>/dev/null || echo n/a)
    echo "$arm $ref tip=$(git -C "$WORK/$arm.git" rev-parse "$ref") merge-base=$mb ahead=$ahead"
  done
done
for ref in $(git -C "$D_REPO" for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v HEAD); do
  echo "d $ref tip=$(git -C "$D_REPO" rev-parse "$ref") merge-base=$(git -C "$D_REPO" merge-base "$ref" "$UPSTREAM") ahead=$(git -C "$D_REPO" rev-list --count "$ref" ^"$UPSTREAM") ancestor-of-29f4820d=$(git -C "$D_REPO" merge-base --is-ancestor "$ref" 29f4820d && echo yes || echo no)"
done

echo
echo "## diff vs upstream (shortstat) at each arm's most complete published tip"
git -C "$WORK/a.git" diff --shortstat "$UPSTREAM" e7a685538878e1cf66743f6aca934a9199a983a3 | sed 's/^/A e7a68553 /'
git -C "$WORK/b.git" diff --shortstat "$UPSTREAM" dd88c39f348b169236ec331ae0052e289a0de99c | sed 's/^/B dd88c39f /'
git -C "$WORK/c.git" diff --shortstat "$UPSTREAM" c738518615c91bb5968f2fea4e1c670f4eefdac8 | sed 's/^/C c7385186 /'
git -C "$D_REPO" diff --shortstat "$UPSTREAM" 29f4820d | sed 's/^/D 29f4820d /'
echo "D paths changed outside poc/ and .agents/:"
git -C "$D_REPO" diff --name-status "$UPSTREAM" 29f4820d -- . ':!poc' ':!.agents'

echo
echo "## shared-commit identity (same SHA => byte-identical history)"
for s in 3ecaba40 442b44d0 e0a522a2 c7385186; do
  echo "$s in C=$(git -C "$WORK/c.git" cat-file -t $s 2>/dev/null || echo absent) in D=$(git -C "$D_REPO" cat-file -t $s 2>/dev/null || echo absent) in B=$(git -C "$WORK/b.git" cat-file -t $s 2>/dev/null || echo absent) in A=$(git -C "$WORK/a.git" cat-file -t $s 2>/dev/null || echo absent)"
done

echo
echo "## C payload / plugin tree parity (C pin c7385186 vs D 29f4820d)"
echo ".agents       C=$(git -C "$D_REPO" rev-parse c7385186:.agents) D=$(git -C "$D_REPO" rev-parse 29f4820d:.agents)"
echo "poc/ui-poc    C=$(git -C "$D_REPO" rev-parse c7385186:poc/ui-poc) D=$(git -C "$D_REPO" rev-parse 29f4820d:poc/ui-poc)"
git -C "$D_REPO" diff --shortstat c7385186 29f4820d -- poc/ui-poc
echo "D commits touching poc/ui-poc or .agents after the C pin:"
git -C "$D_REPO" log --format='%h %s' c7385186..29f4820d -- poc/ui-poc .agents

echo
echo "## main / develop / PR #4 identity"
for r in origin/main origin/develop 29f4820d origin/fix/inherit-c-ui-layer 3c90e025; do
  echo "$r commit=$(git -C "$D_REPO" rev-parse "$r") tree=$(git -C "$D_REPO" rev-parse "$r^{tree}")"
done
