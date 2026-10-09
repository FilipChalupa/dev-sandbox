# Sandbox image: one container per project, with Claude Code in Remote Control
# server mode, a reverse proxy for the preview and a Cloudflare quick tunnel
# for sharing. Runs as the unprivileged `node` user.

FROM node:24-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates curl gnupg git ffmpeg tmux jq less procps \
		openssh-client vim-tiny gettext-base \
		chromium fonts-liberation fonts-noto-color-emoji \
	&& rm -rf /var/lib/apt/lists/*

# Caddy: reverse proxy in front of the project's dev server, basic auth for
# the shared tunnel. The official release binary with its published SHA-512,
# pinned: the apt repository on Cloudsmith started answering 402 Payment
# Required (9. 10. 2026) and every image build failed on it.
ARG CADDY_VERSION=2.11.7
ARG CADDY_SHA512_AMD64=a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7
ARG CADDY_SHA512_ARM64=3db36ba90c7a6e8dda40ee3dd71fa08844c76b5fb08f61b31e5e78d2ed38e71c51dc7baed875e50d1ca1279196e84302967237386ae87c91ae9f2aaceada682e
RUN arch="$(dpkg --print-architecture)" \
	&& case "$arch" in \
		amd64) sum="$CADDY_SHA512_AMD64" ;; \
		arm64) sum="$CADDY_SHA512_ARM64" ;; \
		*) echo "no Caddy build for $arch" >&2; exit 1 ;; \
	esac \
	&& curl -fsSL -o /tmp/caddy.tar.gz \
		"https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_${arch}.tar.gz" \
	&& echo "$sum  /tmp/caddy.tar.gz" | sha512sum -c - \
	&& tar -xzf /tmp/caddy.tar.gz -C /usr/local/bin caddy \
	&& rm /tmp/caddy.tar.gz \
	&& caddy version

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

# Playwright MCP server: gives Claude a browser (the system Chromium) to
# navigate, click and read the page, not just screenshots.
RUN npm install -g @playwright/mcp@latest

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

# fnm: other Node versions on demand (`fnm install 20`). Every bash, even a
# non-interactive one from Claude, sources ~/.fnm-env.sh and picks the version
# from .nvmrc / .node-version in the current directory when there is one.
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell --install-dir /home/node/.local/share/fnm \
	&& printf '%s\n' \
		'export FNM_DIR=/home/node/.local/share/fnm' \
		'export PATH="$FNM_DIR:$PATH"' \
		'eval "$(fnm env --use-on-cd --version-file-strategy=local --shell bash 2>/dev/null)"' \
		'fnm use --silent-if-unchanged --install-if-missing >/dev/null 2>&1 || true' \
		> /home/node/.fnm-env.sh \
	&& echo 'source ~/.fnm-env.sh' >> /home/node/.bashrc
ENV BASH_ENV=/home/node/.fnm-env.sh

# Scripts last, so that editing them does not reinstall anything above.
COPY --chmod=755 bin/ /usr/local/bin/
COPY --chmod=755 hooks/ /opt/sandbox/hooks/
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
