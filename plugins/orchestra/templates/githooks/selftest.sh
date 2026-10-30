#!/usr/bin/env bash
# Self-check for the pre-push branch guard, against throwaway bare remotes.
set -euo pipefail
hook_dir=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
refused() { # push must fail with the guard's message
  local err; if err=$(git push -q "$@" 2>&1); then fail "allowed: git push $*"; fi
  [[ $err == *"orchestra: direct push"* ]] || fail "failed for another reason: $err"
}
git init -q --bare "$tmp/remote.git"; git init -q --bare "$tmp/fork.git"
git init -q "$tmp/work" && cd "$tmp/work"
git symbolic-ref HEAD refs/heads/main
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git remote add origin "$tmp/remote.git"; git remote add fork "$tmp/fork.git"
git config core.hooksPath "$hook_dir"
out=$(git push -q origin main 2>&1); [[ $out == *"not set"* ]] || fail "no warning when unset"
git config orchestra.protectedBranches "develop main"
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m change
refused origin main
refused origin main:develop
refused origin :main
refused origin main:feature-y main:develop                # one protected ref in a multi-ref push
git push -q origin main:feature-x                         # any other branch: allowed
git push -q fork main                                     # another remote: allowed
echo "branch guard: ok"
