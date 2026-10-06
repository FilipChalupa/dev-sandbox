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
check "conflict still exits 0 (server replaced)" "$rc" "0"
check "sandbox commit kept" "$(git log --oneline -1 | grep -c conflicting)" "1"
check "no merge in progress" "$([ -f .git/MERGE_HEAD ] && echo yes || echo no)" "no"
check "server now equals the sandbox" "$(git --git-dir="$remote" rev-parse sandbox/t)" "$(git rev-parse HEAD)"
check "overwrite reported" "$(grep -c 'replaced' <<<"$out")" "1"
[ "$(jqr .ok x)" = skipped ] || check "push status says overwrote" "$(jqr .reason "$SANDBOX_STATE_DIR/push-status.json")" "overwrote"
# a plain force push by hand is still refused
git commit -q --allow-empty -m x && git push -q origin sandbox/t && git reset -q --hard HEAD~1 && git commit -q --allow-empty -m y
if git push -q --force origin sandbox/t 2>/dev/null; then r=ok; else r=rejected; fi
check "manual force push still rejected" "$r" "rejected"
cd /

# sandbox-deps: installs only when the manifests change, per package manager
export SANDBOX_STATE_DIR="$(mktemp -d)" SANDBOX_WORKSPACE="$(mktemp -d)"
shims="$(mktemp -d)"; calls="$shims/calls"
for m in pnpm npm; do
	# A fake manager: records how it was called and creates node_modules;
	# FAIL_EXACT makes the exact install (ci / --frozen-lockfile) fail.
	printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\ncase "$*" in *ci*|*frozen*) [ -n "${FAIL_EXACT:-}" ] && exit 1 ;; esac\nmkdir -p node_modules\n' "$m" "$calls" > "$shims/$m"
	chmod +x "$shims/$m"
done
deps() { PATH="$shims:$PATH" sandbox-deps "$@" >/dev/null 2>&1; }
ncalls() { [ -f "$calls" ] && wc -l < "$calls" | tr -d ' ' || echo 0; }
cd "$SANDBOX_WORKSPACE"
deps; check "no package.json: nothing to do" "$(ncalls)" "0"
echo '{"name":"p"}' > package.json && echo 'lock: 1' > pnpm-lock.yaml
deps; check "pnpm: first install is exact" "$(tail -n 1 "$calls")" "pnpm install --frozen-lockfile --prefer-offline"
deps; check "unchanged: no second install" "$(ncalls)" "1"
echo 'lock: 2' > pnpm-lock.yaml
deps; check "changed lockfile: install again" "$(ncalls)" "2"
rm -rf node_modules
deps; check "missing node_modules: install again" "$(ncalls)" "3"
rm pnpm-lock.yaml node_modules -rf && echo '{}' > package-lock.json && : > "$calls"
deps; check "npm with lockfile: npm ci" "$(tail -n 1 "$calls")" "npm ci --no-audit --no-fund"
echo '{"name":"p","dependencies":{"x":"1"}}' > package.json
FAIL_EXACT=1 PATH="$shims:$PATH" sandbox-deps >/dev/null 2>&1; rc=$?
check "lockfile out of sync: falls back to a plain install" "$(tail -n 1 "$calls")" "npm install --no-audit --no-fund"
check "fallback install succeeds" "$rc" "0"
deps; check "after the fallback: up to date (ci + install, nothing more)" "$(ncalls)" "3"
cd /

echo
if [ "$fails" = 0 ]; then echo "all sandbox tests passed"; else echo "$fails sandbox test(s) failed"; exit 1; fi
