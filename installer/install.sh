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
# Host helper for the sandbox manager (runs under launchd, keeps running):
#  - every minute writes the Mac's addresses on the local network to
#    host.json, so phone preview links can be shown,
#  - every second executes "open" requests the manager puts into
#    .manager/open/ (a file holding a path or URL), so a click in the UI can
#    open a project folder in Finder.
# It skips tunnels (VPN, WireGuard, Tailscale), link-local and Docker ranges.
dir="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$dir/open"

write_host_json() {
	local default_if names entries="" iface ip label rank json first name
	default_if="$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')"
	names="$(networksetup -listallhardwareports 2>/dev/null)"
	for iface in $(ifconfig -l 2>/dev/null); do
		case "$iface" in lo*|utun*|tun*|tap*|wg*|ipsec*|bridge*|vmnet*|docker*|awdl*|llw*|gif*|stf*|ap*|anpi*|feth*) continue ;; esac
		ip="$(ipconfig getifaddr "$iface" 2>/dev/null)" || continue
		[ -n "$ip" ] || continue
		case "$ip" in 169.254.*|192.168.65.*|127.*) continue ;; esac
		case "$ip" in 100.*) o="${ip#100.}"; o="${o%%.*}"; [ "$o" -ge 64 ] && [ "$o" -le 127 ] && continue ;; esac
		label="$(printf '%s\n' "$names" | awk -v dev="$iface" '/^Hardware Port:/ {p=$0; sub(/^Hardware Port: /, "", p)} /^Device:/ && $2 == dev {print p}')"
		[ -n "$label" ] || label="$iface"
		rank=2; [ "$iface" = "$default_if" ] && rank=0; case "$label" in Wi-Fi|Ethernet*|*LAN*) [ $rank = 2 ] && rank=1 ;; esac
		entries="$entries$rank|$iface|$label|$ip\n"
	done
	json="$(printf "$entries" | sort | awk -F'|' 'NF==4 {printf "%s{\"iface\":\"%s\",\"label\":\"%s\",\"ip\":\"%s\"}", (n++ ? "," : ""), $2, $3, $4}')"
	first="$(printf "$entries" | sort | head -n 1 | cut -d'|' -f4)"
	name="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
	printf '{"lanIp":"%s","lanIps":[%s],"hostName":"%s","helper":true,"updatedAt":"%s"}\n' "$first" "$json" "$name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dir/host.json.tmp" \
		&& mv "$dir/host.json.tmp" "$dir/host.json"
}

tick=60
while true; do
	if [ "$tick" -ge 60 ]; then write_host_json; tick=0; fi
	for req in "$dir"/open/*; do
		[ -f "$req" ] || continue
		target="$(head -n 1 "$req")"
		rm -f "$req"
		# Only paths inside the sandboxes directory or http(s) links.
		case "$target" in
			"$(dirname "$dir")"/*|http://*|https://*) open "$target" ;;
		esac
	done
	sleep 1
	tick=$((tick + 1))
done
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
	<key>KeepAlive</key><true/>
</dict></plist>
PL
	launchctl unload "$PLIST" >/dev/null 2>&1 || true
	launchctl load "$PLIST"
elif [ "$(uname)" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
	LAN_NAME="$(hostname -s).local"
	mkdir -p "$DIR/.manager/bin" "$HOME/.config/systemd/user"
	cat > "$DIR/.manager/bin/host-info.sh" <<'SH'
#!/bin/bash
# Host helper for the sandbox manager on Linux (runs as a systemd user
# service): writes the machine's addresses on the local network to host.json
# every minute and executes "open" requests from .manager/open/ with xdg-open.
dir="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$dir/open"
write_host_json() {
	local default_if entries="" json first name
	default_if="$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')"
	while read -r _ iface _ cidr _; do
		local ip="${cidr%/*}"
		case "$iface" in lo|docker*|br-*|veth*|virbr*|tun*|tap*|wg*|tailscale*|ipsec*|vmnet*) continue ;; esac
		case "$ip" in 169.254.*|192.168.65.*|127.*) continue ;; esac
		case "$ip" in 100.*) o="${ip#100.}"; o="${o%%.*}"; [ "$o" -ge 64 ] && [ "$o" -le 127 ] && continue ;; esac
		local rank=2; [ "$iface" = "$default_if" ] && rank=0; case "$iface" in en*|eth*|wl*) [ $rank = 2 ] && rank=1 ;; esac
		entries="$entries$rank|$iface|$iface|$ip\n"
	done < <(ip -4 -o addr show 2>/dev/null)
	json="$(printf "$entries" | sort | awk -F'|' 'NF==4 {printf "%s{\"iface\":\"%s\",\"label\":\"%s\",\"ip\":\"%s\"}", (n++ ? "," : ""), $2, $3, $4}')"
	first="$(printf "$entries" | sort | head -n 1 | cut -d'|' -f4)"
	name="$(hostname -s).local"
	printf '{"lanIp":"%s","lanIps":[%s],"hostName":"%s","helper":true,"updatedAt":"%s"}\n' "$first" "$json" "$name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dir/host.json.tmp" \
		&& mv "$dir/host.json.tmp" "$dir/host.json"
}
tick=60
while true; do
	if [ "$tick" -ge 60 ]; then write_host_json; tick=0; fi
	for req in "$dir"/open/*; do
		[ -f "$req" ] || continue
		target="$(head -n 1 "$req")"
		rm -f "$req"
		case "$target" in
			"$(dirname "$dir")"/*|http://*|https://*) xdg-open "$target" >/dev/null 2>&1 & ;;
		esac
	done
	sleep 1
	tick=$((tick + 1))
done
SH
	chmod +x "$DIR/.manager/bin/host-info.sh"
	cat > "$HOME/.config/systemd/user/dev-sandbox-host-info.service" <<UNIT
[Unit]
Description=Sandbox manager host helper (network addresses, open requests)

[Service]
ExecStart=$DIR/.manager/bin/host-info.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
	systemctl --user daemon-reload
	systemctl --user enable --now dev-sandbox-host-info.service >/dev/null 2>&1 || true
else
	LAN_NAME="$(hostname -s).local"
fi

# Docker Desktop on Linux keeps its socket under the home directory.
SOCK=/var/run/docker.sock
[ -S "$SOCK" ] || { [ -S "$HOME/.docker/desktop/docker.sock" ] && SOCK="$HOME/.docker/desktop/docker.sock"; }

say "Downloading the manager and the sandbox image (this can take a few minutes the first time)…"
docker pull "$MANAGER_IMAGE"
docker pull "$SANDBOX_IMAGE"

say "Starting the manager…"
docker rm -f sandbox-manager >/dev/null 2>&1 || true
docker run -d \
	--name sandbox-manager \
	--restart unless-stopped \
	-p "127.0.0.1:$PORT:8787" \
	-v "$SOCK:/var/run/docker.sock" \
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
