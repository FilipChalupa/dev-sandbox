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

# The machine's name and address on the local network, for the phone preview
# links. A container cannot see them, so a tiny job on the host writes them to
# .manager/host.json every minute (launchd on a Mac).
if [ "$(uname)" = "Darwin" ]; then
	LAN_NAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
	mkdir -p "$DIR/.manager/bin" "$HOME/Library/LaunchAgents"
	cat > "$DIR/.manager/bin/host-info.sh" <<'SH'
#!/bin/bash
# Writes the Mac's current LAN address for the sandbox manager.
dir="$(cd "$(dirname "$0")/.." && pwd)"
ip=""
for iface in $(route -n get default 2>/dev/null | awk '/interface:/ {print $2}') en0 en1; do
	ip="$(ipconfig getifaddr "$iface" 2>/dev/null)" && [ -n "$ip" ] && break
done
name="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
printf '{"lanIp":"%s","hostName":"%s","updatedAt":"%s"}\n' "$ip" "$name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dir/host.json.tmp" \
	&& mv "$dir/host.json.tmp" "$dir/host.json"
SH
	chmod +x "$DIR/.manager/bin/host-info.sh"
	PLIST="$HOME/Library/LaunchAgents/com.dev-sandbox.host-info.plist"
	cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>Label</key><string>com.dev-sandbox.host-info</string>
	<key>ProgramArguments</key><array><string>$DIR/.manager/bin/host-info.sh</string></array>
	<key>RunAtLoad</key><true/>
	<key>StartInterval</key><integer>60</integer>
</dict></plist>
PL
	launchctl unload "$PLIST" >/dev/null 2>&1 || true
	launchctl load "$PLIST"
	"$DIR/.manager/bin/host-info.sh"
else
	LAN_NAME="$(hostname -s).local"
fi

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
	-e "HOST_LAN_NAME=$LAN_NAME" \
	"$MANAGER_IMAGE" >/dev/null

for _ in $(seq 1 30); do
	if curl -fs "http://localhost:$PORT/api/info" >/dev/null 2>&1; then break; fi
	sleep 1
done

say "Done. The manager runs at http://localhost:$PORT and starts with Docker Desktop."
if [ "$(uname)" = "Darwin" ]; then open "http://localhost:$PORT"; fi
