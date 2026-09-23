# Sandbox image: one container per project, with Claude Code in Remote Control
# server mode, a reverse proxy for the preview and a Cloudflare quick tunnel
# for sharing. Runs as the unprivileged `node` user.

FROM node:24-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates curl gnupg git ffmpeg tmux jq less procps \
		openssh-client vim-tiny gettext-base \
	&& rm -rf /var/lib/apt/lists/*

# Caddy: reverse proxy in front of the project's dev server, basic auth for
# the shared tunnel. Official apt repository, multi-arch.
RUN curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
		| gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
	&& curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
		> /etc/apt/sources.list.d/caddy-stable.list \
	&& apt-get update && apt-get install -y --no-install-recommends caddy \
	&& rm -rf /var/lib/apt/lists/*

# cloudflared: quick tunnels (no account needed).
RUN curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
		> /usr/share/keyrings/cloudflare-main.gpg \
	&& echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main' \
		> /etc/apt/sources.list.d/cloudflared.list \
	&& apt-get update && apt-get install -y --no-install-recommends cloudflared \
	&& rm -rf /var/lib/apt/lists/*

# pnpm through corepack, so projects with a `packageManager` field get the
# version they ask for. A default pnpm is prepared so it works offline too.
RUN npm install -g corepack@latest \
	&& corepack enable \
	&& corepack install -g pnpm@latest yarn@stable

# Everything below runs as the sandbox user.
USER node
ENV HOME=/home/node \
	PATH=/home/node/.local/bin:$PATH \
	CLAUDE_CONFIG_DIR=/home/node/.claude \
	DISABLE_AUTOUPDATER=1 \
	SANDBOX_STATE_DIR=/state \
	TZ=Europe/Prague

# Claude Code, native installer. Updates come with a new image.
RUN curl -fsSL https://claude.ai/install.sh | bash \
	&& claude --version

# Scripts last, so that editing them does not reinstall anything above.
COPY --chmod=755 bin/ /usr/local/bin/
COPY templates/ /opt/sandbox/templates/

# Mounted at runtime: /workspace/<name> (repository), /state (per-sandbox
# state) and /home/node/.claude (shared Claude login).
VOLUME ["/state", "/home/node/.claude"]
WORKDIR /workspace

# 8080: preview without auth (publish on 127.0.0.1 only).
# 8081: preview with basic auth, reached through the tunnel.
EXPOSE 8080 8081

# The entrypoint starts as root only to fix the ownership of the mounted
# directories, then drops to `node` for everything else.
USER root
ENTRYPOINT ["sandbox-init"]
