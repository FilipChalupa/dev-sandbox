#!/usr/bin/env bash
# Tests for the sandbox scripts that do not need Docker: library helpers and
# the pre-push guard. Run: bash sandbox/test/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$here/bin:$PATH"
export SANDBOX_NAME=t SANDBOX_STATE_DIR="$(mktemp -d)" SANDBOX_WORKSPACE="$(mktemp -d)" CLAUDE_CONFIG_DIR="$(mktemp -d)"
fails=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected '$3', got '$2'"; fails=$((fails + 1)); fi; }

source sandbox-lib

check "ssh url to https" "$(to_https_url git@bitbucket.org:ws/repo.git)" "https://bitbucket.org/ws/repo.git"
check "ssh:// url to https" "$(to_https_url ssh://git@github.com/o/r.git)" "https://github.com/o/r.git"
check "https url unchanged" "$(to_https_url https://gitlab.com/g/p.git)" "https://gitlab.com/g/p.git"
check "bitbucket token user" "$(git_username_for bitbucket.org)" "x-token-auth"
check "github token user" "$(git_username_for github.com)" "x-access-token"
check "other host token user" "$(git_username_for git.example.com)" "token"
check "generated password length" "$(preview_password | wc -c | tr -d ' ')" "12"
check "password avoids look-alike characters" "$(preview_password | tr -d 'acdefhjkmnpqrtuvwxy347' | wc -c | tr -d ' ')" "0"
check "default upstream port" "$(upstream_port)" "3000"
write_state upstream-port 5173
check "stored upstream port" "$(upstream_port)" "5173"

pm="$(cd "$(mktemp -d)" && touch pnpm-lock.yaml && package_manager)"
check "pnpm from lockfile" "$pm" "pnpm"
pm="$(cd "$(mktemp -d)" && package_manager)"
check "npm by default" "$pm" "npm"

# pre-push guard against a local bare remote
export SANDBOX_BRANCH=sandbox/t
work="$(mktemp -d)"; remote="$(mktemp -d)"
git init -q --bare "$remote"
cd "$work"
git init -q -b sandbox/t .
git config user.email t@example.com; git config user.name t
git config core.hooksPath "$here/hooks"
mkdir -p /state 2>/dev/null || true
echo "$SANDBOX_BRANCH" > "$SANDBOX_STATE_DIR/branch"
# the hook reads /state/branch first; point it at our state dir through the env fallback
sed "s#/state/branch#$SANDBOX_STATE_DIR/branch#" "$here/hooks/pre-push" > "$SANDBOX_STATE_DIR/pre-push"
chmod +x "$SANDBOX_STATE_DIR/pre-push"
mkdir -p "$SANDBOX_STATE_DIR/hooks" && mv "$SANDBOX_STATE_DIR/pre-push" "$SANDBOX_STATE_DIR/hooks/pre-push"
git config core.hooksPath "$SANDBOX_STATE_DIR/hooks"
git commit -q --allow-empty -m a
git remote add origin "$remote"
if git push -q origin sandbox/t 2>/dev/null; then r=ok; else r=rejected; fi
check "push own branch allowed" "$r" "ok"
if git push -q origin HEAD:refs/heads/main 2>/dev/null; then r=ok; else r=rejected; fi
check "push to other branch rejected" "$r" "rejected"
git commit -q --allow-empty -m b && git push -q origin sandbox/t
git reset -q --hard HEAD~1 && git commit -q --allow-empty -m c
if git push -q --force origin sandbox/t 2>/dev/null; then r=ok; else r=rejected; fi
check "force push rejected" "$r" "rejected"
if git push -q origin :sandbox/t 2>/dev/null; then r=ok; else r=rejected; fi
check "branch delete rejected" "$r" "rejected"

# sandbox-save: merges what the server has before pushing, stops on conflict
export SANDBOX_NAME=t SANDBOX_BRANCH=sandbox/t SANDBOX_WORKSPACE="$(mktemp -d)" SANDBOX_STATE_DIR="$(mktemp -d)"
remote="$(mktemp -d)"; git init -q --bare "$remote" && git --git-dir="$remote" symbolic-ref HEAD refs/heads/sandbox/t
dev="$(mktemp -d)"
# push-status.json is written with jq (present in the image and in CI)
if command -v jq >/dev/null; then jqr() { jq -r "$1" "$2"; }; else jqr() { echo "skipped"; }; fi
cd "$SANDBOX_WORKSPACE" && git init -q -b sandbox/t . && git config user.email s@x && git config user.name s && git config core.hooksPath "$here/hooks" && git config pull.rebase false
echo "$SANDBOX_BRANCH" > "$SANDBOX_STATE_DIR/branch"
echo a > a.txt && git add -A && git commit -qm a && git remote add origin "$remote" && git push -q -u origin sandbox/t
git clone -q "$remote" "$dev" && (cd "$dev" && git config user.email d@x && git config user.name d && git checkout -q sandbox/t && echo b > b.txt && git add -A && git commit -qm "developer merged main" && git push -q)
echo c > c.txt
rc=0; out="$(sandbox-save --skip-checks "sandbox work" 2>&1)" || rc=$?
check "save merges the server's commits" "$rc" "0"
check "save pushed after merging" "$(grep -c 'pushed sandbox/t' <<<"$out")" "1"
check "merged file present" "$([ -f b.txt ] && echo yes)" "yes"
[ "$(jqr .ok x)" = skipped ] || check "push status ok" "$(jqr .ok "$SANDBOX_STATE_DIR/push-status.json")" "true"
(cd "$dev" && git pull -q && echo conflict-dev > c.txt && git add -A && git commit -qm "dev edits c" && git push -q)
echo conflict-sandbox > c.txt
rc=0; out="$(sandbox-save --skip-checks "conflicting" 2>&1)" || rc=$?
check "conflict exits 6" "$rc" "6"
check "conflict keeps the commit local" "$(git log --oneline -1 | grep -c conflicting)" "1"
check "conflict leaves no merge in progress" "$([ -f .git/MERGE_HEAD ] && echo yes || echo no)" "no"
[ "$(jqr .ok x)" = skipped ] || check "push status says conflict" "$(jqr .reason "$SANDBOX_STATE_DIR/push-status.json")" "conflict"
cd /

echo
if [ "$fails" = 0 ]; then echo "all sandbox tests passed"; else echo "$fails sandbox test(s) failed"; exit 1; fi
