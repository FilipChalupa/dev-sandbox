#!/usr/bin/env bash
# Removes the manager and all sandbox containers. Keeps ~/Sandboxes and the
# Docker volumes (your projects) unless you pass --purge.
set -euo pipefail
DIR="${DEV_SANDBOX_DIR:-$HOME/Sandboxes}"
docker rm -f sandbox-manager >/dev/null 2>&1 || true
for c in $(docker ps -aq --filter label=dev-sandbox.name); do docker rm -f "$c" >/dev/null; done
if [ "$(uname)" = "Darwin" ]; then
	PLIST="$HOME/Library/LaunchAgents/com.dev-sandbox.host-info.plist"
	launchctl unload "$PLIST" >/dev/null 2>&1 || true
	rm -f "$PLIST"
elif command -v systemctl >/dev/null 2>&1; then
	systemctl --user disable --now dev-sandbox-host-info.service >/dev/null 2>&1 || true
	rm -f "$HOME/.config/systemd/user/dev-sandbox-host-info.service"
	systemctl --user daemon-reload >/dev/null 2>&1 || true
fi
if [ "${1:-}" = "--purge" ]; then
	rm -rf "$DIR"
	# Projects kept inside Docker, their packages and the shared package cache.
	for v in $(docker volume ls -q --filter label=dev-sandbox.volume); do docker volume rm -f "$v" >/dev/null; done
	echo "Removed $DIR and the projects kept inside Docker"
else
	echo "Kept $DIR and the projects kept inside Docker (docker volume ls)"
fi
echo "Done."
