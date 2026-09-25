#!/usr/bin/env bash
# Removes the manager and all sandbox containers. Keeps ~/Sandboxes (your
# projects) unless you pass --purge.
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
if [ "${1:-}" = "--purge" ]; then rm -rf "$DIR"; echo "Removed $DIR"; else echo "Kept $DIR"; fi
echo "Done."
