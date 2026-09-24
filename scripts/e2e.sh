#!/usr/bin/env bash
# End-to-end test against real Docker: starts a manager from the local
# images, creates a sandbox, starts it, starts a static dev server in it,
# waits for the thumbnail, checks CSRF protection, stops and deletes.
#
#   scripts/e2e.sh [docker-cli] [sandbox-image] [manager-image] [host-dir]
#
# host-dir is the directory the manager bind-mounts as the sandboxes folder,
# in the form Docker on this host understands (a Windows path with docker.exe).
set -euo pipefail
DOCKER="${1:-docker}"
SANDBOX_IMAGE="${2:-dev-sandbox}"
MANAGER_IMAGE="${3:-dev-sandbox-manager}"
HOST_DIR="${4:-$(mktemp -d)}"
NAME=e2e-manager
PORT=8799
H='x-sandbox-manager: 1'

cleanup() {
	$DOCKER exec $NAME node -e "fetch('http://localhost:8787/api/sandboxes/e2e?files=1',{method:'DELETE',headers:{'x-sandbox-manager':'1'}}).catch(()=>{})" >/dev/null 2>&1 || true
	$DOCKER rm -f $NAME sandbox-e2e >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; $DOCKER logs $NAME 2>&1 | tail -20 >&2; $DOCKER logs sandbox-e2e 2>&1 | tail -20 >&2 || true; exit 1; }
api() { # method path [json]
	$DOCKER exec $NAME node -e "
const [m,p,b]=process.argv.slice(1);
fetch('http://localhost:8787/api'+p,{method:m,headers:{'x-sandbox-manager':'1','content-type':'application/json'},body:b||undefined})
 .then(async r=>{process.stdout.write(String(r.status)+' '+await r.text())})" -- "$1" "$2" "${3:-}"
}
status_of() { api GET /sandboxes | cut -d' ' -f2- | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d).find(x=>x.name==='e2e');console.log(JSON.stringify({running:s?.container.running,exit:s?.container.exitCode,proxy:s?.status?.preview.proxyUp,dev:s?.status?.preview.devServerUp,thumb:!!s?.status?.preview.imageAt,login:s?.status?.claude.loggedIn,failure:s?.failure}))})"; }

echo "== manager"
cleanup
$DOCKER run -d --name $NAME -p 127.0.0.1:$PORT:8787 -v /var/run/docker.sock:/var/run/docker.sock -v "$HOST_DIR:/sandboxes" -e "SANDBOXES_HOST_DIR=$HOST_DIR" -e SANDBOX_IMAGE="$SANDBOX_IMAGE" -e SANDBOX_FIRST_PORT=3301 "$MANAGER_IMAGE" >/dev/null
for _ in $(seq 1 30); do api GET /info 2>/dev/null | grep -q '^200' && break; sleep 1; done
api GET /info | grep -q '^200' || fail "manager did not come up"

echo "== csrf"
r="$($DOCKER exec $NAME node -e "fetch('http://localhost:8787/api/sandboxes/x/stop',{method:'POST'}).then(r=>console.log(r.status))")"
[ "$r" = 403 ] || fail "POST without header should be 403, got $r"
r="$($DOCKER exec $NAME node -e "fetch('http://localhost:8787/api/info',{headers:{origin:'http://evil.example'}}).then(r=>console.log(r.status))")"
[ "$r" = 403 ] || fail "foreign Origin should be 403, got $r"

echo "== create + start"
api POST /sandboxes '{"name":"e2e","idleStopHours":0}' | grep -q '^201' || fail "create"
api POST /sandboxes/e2e/start | grep -q '^200' || fail "start"
for _ in $(seq 1 40); do st="$(status_of)"; grep -q '"proxy":true' <<<"$st" && break; sleep 3; done
grep -q '"running":true' <<<"$st" || fail "not running: $st"
grep -q '"proxy":true' <<<"$st" || fail "proxy not up: $st"
echo "   $st"

echo "== dev server + thumbnail"
$DOCKER exec $NAME node -e "require('fs').writeFileSync('/sandboxes/e2e/index.html','<h1>e2e</h1>')"
api POST /sandboxes/e2e/dev-start | grep -q '^200' || fail "dev-start"
for _ in $(seq 1 30); do st="$(status_of)"; grep -q '"thumb":true' <<<"$st" && break; sleep 3; done
grep -q '"dev":true' <<<"$st" || fail "dev server not detected: $st"
grep -q '"thumb":true' <<<"$st" || fail "no thumbnail: $st"
api GET /sandboxes/e2e/preview.png | grep -q '^200' || fail "thumbnail not served"
echo "   $st"

echo "== doctor"
api POST /sandboxes/e2e/doctor | grep -q '"check":"proxy","ok":true' || fail "doctor"

echo "== backup"
api GET /backup | grep -q '"name":"e2e"' || fail "backup does not list the sandbox"

echo "== stop + delete"
api POST /sandboxes/e2e/stop | grep -q '^200' || fail "stop"
sleep 2
grep -q '"running":false' <<<"$(status_of)" || fail "still running"
api DELETE '/sandboxes/e2e?files=1' | grep -q '^200' || fail "delete"
echo "all e2e checks passed"
