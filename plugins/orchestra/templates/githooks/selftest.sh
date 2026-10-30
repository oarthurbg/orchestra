#!/usr/bin/env bash
# Self-check for the pre-push branch guard: pushes to a throwaway bare remote.
set -euo pipefail
hook_dir=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
git init -q --bare "$tmp/remote.git"
git init -q -b main "$tmp/work" && cd "$tmp/work"
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git remote add origin "$tmp/remote.git"
git push -q origin main                                   # no guard configured yet: allowed
git config core.hooksPath "$hook_dir"
git config orchestra.protectedBranches "develop main"
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m change
if git push -q origin main 2>/dev/null; then echo "FAIL: push to main allowed" >&2; exit 1; fi
if git push -q origin main:develop 2>/dev/null; then echo "FAIL: push to develop allowed" >&2; exit 1; fi
if git push -q origin :main 2>/dev/null; then echo "FAIL: deleting main allowed" >&2; exit 1; fi
git push -q origin main:feature-x                         # any other branch: allowed
echo "branch guard: ok"
