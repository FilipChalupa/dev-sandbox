#!/usr/bin/env bash
# Screenshots of the manager UI, taken with the Chromium inside the sandbox
# image, in light and dark mode, desktop and phone width. Needs the manager
# running as container "sandbox-manager". Output: ./screenshots/*.png
#
#   scripts/screenshots.sh [docker-cli] [image]
set -euo pipefail
DOCKER="${1:-docker}"
IMAGE="${2:-dev-sandbox}"
NET=sandbox-shots
OUT="$(pwd)/screenshots"
mkdir -p "$OUT"
$DOCKER network create "$NET" >/dev/null 2>&1 || true
$DOCKER network connect "$NET" sandbox-manager >/dev/null 2>&1 || true
$DOCKER rm -f shots >/dev/null 2>&1 || true
$DOCKER run -d --name shots --network "$NET" -e SANDBOX_NAME=shots --entrypoint sleep "$IMAGE" 600 >/dev/null
shot() { # name url width height dark(0/1)
	local dark=()
	[ "$5" = 1 ] && dark=(--force-dark-mode --enable-features=WebUIDarkMode)
	$DOCKER exec shots chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
		--window-size="$3,$4" --virtual-time-budget=6000 "${dark[@]}" \
		--screenshot="/tmp/$1.png" "$2" >/dev/null 2>&1 || echo "failed: $1"
	$DOCKER cp "shots:/tmp/$1.png" "$OUT/$1.png" >/dev/null
	echo "$OUT/$1.png"
}
base="http://sandbox-manager:8787/"
for theme in light dark; do
	d=0; [ $theme = dark ] && d=1
	shot "list-desktop-$theme" "$base" 1280 900 $d
	shot "list-phone-$theme" "$base" 390 1200 $d
	shot "new-desktop-$theme" "$base#new?name=my-site&repo=https://bitbucket.org/ws/repo.git" 1280 900 $d
done
$DOCKER rm -f shots >/dev/null
