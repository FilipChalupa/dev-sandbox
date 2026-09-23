#!/usr/bin/env bash
# Installs or updates the sandbox manager on this machine.
# Needs Docker Desktop. Safe to run again: it replaces the manager container
# and keeps everything in ~/Sandboxes.
set -euo pipefail

OWNER="${DEV_SANDBOX_OWNER:-filipchalupa}"
MANAGER_IMAGE="${DEV_SANDBOX_MANAGER_IMAGE:-ghcr.io/$OWNER/dev-sandbox-manager:latest}"
SANDBOX_IMAGE="${DEV_SANDBOX_IMAGE:-ghcr.io/$OWNER/dev-sandbox:latest}"
DIR="${DEV_SANDBOX_DIR:-$HOME/Sandboxes}"
PORT="${DEV_SANDBOX_PORT:-8787}"

say() { printf '\n==> %s\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
	say "Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and run this again."
	exit 1
fi
if ! docker info >/dev/null 2>&1; then
	say "Docker Desktop is not running. Start it (and enable 'Start Docker Desktop when you sign in'), then run this again."
	if [ "$(uname)" = "Darwin" ]; then open -a Docker 2>/dev/null || true; fi
	exit 1
fi

mkdir -p "$DIR/.manager"

say "Downloading the manager and the sandbox image (this can take a few minutes the first time)…"
docker pull "$MANAGER_IMAGE"
docker pull "$SANDBOX_IMAGE"

say "Starting the manager…"
docker rm -f sandbox-manager >/dev/null 2>&1 || true
docker run -d \
	--name sandbox-manager \
	--restart unless-stopped \
	-p "127.0.0.1:$PORT:8787" \
	-v /var/run/docker.sock:/var/run/docker.sock \
	-v "$DIR:/sandboxes" \
	-e "SANDBOXES_HOST_DIR=$DIR" \
	-e "SANDBOX_IMAGE=$SANDBOX_IMAGE" \
	"$MANAGER_IMAGE" >/dev/null

for _ in $(seq 1 30); do
	if curl -fs "http://localhost:$PORT/api/info" >/dev/null 2>&1; then break; fi
	sleep 1
done

say "Done. The manager runs at http://localhost:$PORT and starts with Docker Desktop."
if [ "$(uname)" = "Darwin" ]; then open "http://localhost:$PORT"; fi
