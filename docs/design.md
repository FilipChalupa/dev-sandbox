# Design

## Goal

Let a non-developer colleague (typically working on graphics and content)
contribute to web projects with Claude Code, without installing a development
toolchain on their machine and without being able to break anything outside a
sandbox. The developer on the team reviews and merges what comes out.

## Decisions

| Topic | Decision |
| --- | --- |
| Host | The colleague's own Mac with Docker Desktop. Nothing else is installed on the host. |
| Sandbox unit | One sandbox per project. Projects differ in Node version, ports and env, and a Remote Control server is bound to one directory anyway. |
| Isolation | Docker container. No Docker-in-Docker in v1; projects that need a database are out of scope for now. |
| Claude Code | Runs inside the container as `claude remote-control`, permission mode `bypassPermissions`. The colleague cannot judge permission prompts, so the container is the safety boundary. |
| Claude account | The colleague's own account on a Team plan. The org owner must enable Remote Control in the Claude Code admin settings. Login is shared between sandboxes through a shared config directory. |
| UI for the colleague | claude.ai/code or the Claude mobile app for talking to Claude. A small local web UI (the manager) for creating, starting and stopping sandboxes. No terminal. |
| Git hosting | Any HTTPS remote with a token (Bitbucket repository access tokens, GitHub fine-grained tokens). Fetch and push only, no pull request API. |
| Branching | One long-lived working branch per sandbox. No automatic pulls of a base branch: a merge conflict has nobody to resolve it. The developer merges the branch when asked. |
| Commits | Claude commits and pushes after each finished change (instructed through CLAUDE.md). An optional autosave timer commits and pushes `wip` commits when the tree is dirty, as a safety net. |
| Git identity | Taken from the logged-in Claude account (`oauthAccount` in `.claude.json`), overridable. |
| `.env` | The colleague fills it in with Claude's help. Never committed. |
| Preview | The container's dev server is reachable on `http://localhost:<port>` through a Caddy reverse proxy. Sharing with others starts a Cloudflare quick tunnel in front of a second Caddy listener with basic auth. No custom domain; the URL changes every time. |
| How to run the project | Claude reads it from the repository (README, package.json). The sandbox only provides the way out (`sandbox-preview`, `sandbox-share`). |
| Node | Node 24 preinstalled as the default. |
| Distribution | Public GitHub repository, public container images on GHCR built by GitHub Actions. |

## Verified facts about Claude Code (September 2026)

- `claude remote-control` (server mode) runs headless in tmux, and new sessions are created on demand from claude.ai/code or the mobile app. Flags of interest: `--name`, `--permission-mode` (`bypassPermissions` accepted), `--spawn same-dir|worktree|session`, `--capacity`.
- A crashed session is served again when the app sends it another message. After a network outage of about 10 minutes the server process exits, so it needs a supervisor loop.
- The first run asks `Enable Remote Control? (y/n)` once.
- Files and images can be attached from the browser and the mobile app.
- Supported plans: Pro, Max, Team, Enterprise. API keys are not supported for Remote Control. `DISABLE_TELEMETRY`, `DO_NOT_TRACK` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` must not be set.
- Login without a browser on the machine: the CLI prints an OAuth URL, the user signs in elsewhere and pastes the code. Credentials live in `$CLAUDE_CONFIG_DIR/.credentials.json`. `claude setup-token` cannot do Remote Control, so a real OAuth login is required.
- Claude Code on the web (Anthropic's cloud sandboxes) supports GitHub only for pushing and has no dev server preview, so it is not an alternative.

## Architecture

```
Mac
├── Docker Desktop (starts at login)
│   ├── manager    (container, restart: unless-stopped, /var/run/docker.sock)
│   │     http://localhost:8787
│   ├── sandbox "site-a"   (container from the dev-sandbox image)
│   ├── sandbox "site-b"
│   └── ...
└── ~/Sandboxes/
    ├── site-a/          bind mount, the repository, visible in Finder
    ├── site-b/
    └── .manager/
        ├── claude/      shared Claude config dir (login, transcripts)
        ├── site-a/      config.json, status.json, logs, git credentials
        └── site-b/
```

### Manager

A container with the Docker socket mounted. Through the Docker API it creates
sandbox containers with the right mounts, ports and environment. State is a few
JSON files under `~/Sandboxes/.manager`.

UI:

- list of sandboxes with status (running, stopped, waiting for Claude login),
  and a three-step guide on each card until it is ready: start, log in, open,
- Start, Stop, Delete (dialog with an option to delete the files), New,
- Claude login without a terminal: the manager runs `claude auth login` in
  the sandbox, shows the OAuth link and passes the pasted code back,
- "Open in claude.ai/code" (session URL read from the Remote Control server output),
- preview link `http://localhost:<port>` with "project server is running / not
  running", Share / Stop sharing with the tunnel URL and password and copy buttons,
- "Send to developer": commit everything and push the working branch,
- "Restart Claude" when the Remote Control server is offline,
- repository URL, token, branch and "start automatically with Docker",
  editable later (a project can start with no remote),
- git status: uncommitted changes, unpushed commits, last commit,
- an embedded terminal (xterm.js) into the sandbox as a fallback,
- a live log, "Update" (pulls the sandbox image) and "Update manager" (the
  manager pulls its image and a helper container swaps it out),
- QR codes for the shared URL and, when enabled, a LAN preview link
  (`http://<mac-ip>:<port>`, basic auth) for a phone on the same Wi-Fi; the
  Mac's address comes from a launchd job the installer sets up, which writes
  `.manager/host.json` every minute (a container cannot see the host's address),
- "What changed today": today's commits and the files being worked on,
- a "new version" badge on the update buttons, from comparing the local image
  digest with the registry,
- a diagnostics page: manager version and build, Docker version and
  resources, host address, disk space, images, sandboxes with uptime, last
  activity and Claude version,
- per sandbox memory and CPU limits, and an idle stop (hours without Claude
  activity, git commits or server changes),
- a stopped sandbox that exited with an error shows why (last log lines,
  translated: bad token, missing repository, …),
- "Check access" in the form runs `git ls-remote` with the token before the
  sandbox is ever started,
- per sandbox instructions from the developer, appended to Claude's rules
  (also carried by the invite link),
- "new sandbox version, restart" when a running container is on an older
  image than the one downloaded,
- "Send to developer" runs the project's `lint` and `typecheck` scripts
  first; on failure the commit stays local and the UI offers "send anyway",
- log out of Claude for all sandboxes,
- "start right after creating" in the new sandbox form, starter prompts on a
  sandbox that has never been used, the dev server's own log,
- CPU and memory per running sandbox, a warning in diagnostics when the sum
  of sandbox memory limits exceeds Docker's memory,
- cleanup of old images of ours that no container uses (also runs after each
  successful update),
- English and Czech, switchable.

### Sandbox container

Image: Debian based, Node 24 (corepack/pnpm enabled) with fnm for other Node
versions, git, ffmpeg, tmux, Caddy, cloudflared, Chromium, Claude Code. Runs as an
unprivileged user. Empty projects get a default `.gitignore`.

Processes inside (the entrypoint restarts any of them that dies):

- `claude remote-control --name <sandbox> --permission-mode bypassPermissions`
  in tmux, wrapped in a supervisor loop that restarts it,
- Caddy with two listeners: `:8080` without auth (published on `127.0.0.1:<hostPort>`)
  and `:8081` with basic auth (only reached through cloudflared),
- `sandbox-preview <port>` points Caddy at the dev server port; `sandbox-share` starts a quick
  tunnel, writes the URL to `status.json` and prints it so Claude can pass it on.
  `sandbox-unshare` stops the tunnel,
- optional autosave loop,
- a `pre-push` git hook (via `core.hooksPath`) that only allows fast-forward
  pushes to the sandbox's own branch: no other branches, no force, no delete,
- `sandbox-screenshot`: headless Chromium render of the preview (desktop or
  phone viewport) so Claude can look at its own changes,
- the Playwright MCP server (`playwright-mcp`, driving the system Chromium),
  registered in the shared Claude config, so Claude can navigate, click and
  read pages,
- `sandbox-port-watch`: follows whatever port the dev server listens on and
  points Caddy at it, so nothing has to be configured per project,
- `sandbox-save`: commit everything and push (used by autosave and the UI),
- `sandbox-status` writing `status.json` (session URL, tunnel URL, upstream
  port, git state, logged-in account) for the manager.

At start the entrypoint clones the repository if the workspace is empty (or
`git init`s it when there is no remote yet), checks out the working branch,
configures the credential helper, sets the git identity from the Claude login,
and writes `CLAUDE.local.md` into the repository (excluded through
`.git/info/exclude`) with the rules for Claude: work only on this branch, commit
and push after each finished change, where to put attachments, how to share
the preview.

Each sandbox mounts its workspace at `/workspace/<name>` so that transcripts
and Remote Control records in the shared Claude config dir do not collide.

Caddy rewrites the `Host` header to the upstream so dev servers with host
checks (Vite `server.allowedHosts`, Next `allowedDevOrigins`) accept requests
coming through the tunnel.

### Installation for the colleague

1. Install Docker Desktop and enable "start when you sign in".
2. Download `Install sandbox.command` from the releases and double-click it.
   It creates `~/Sandboxes`, starts the manager with `--restart unless-stopped`
   and opens `http://localhost:8787`.
3. In the UI: New sandbox, paste the repository URL and token, Start, log in to
   Claude in the embedded terminal, click "Open in claude.ai/code".

## Tests

`manager`: `pnpm test` (vitest) covers credential splitting, registry name
parsing, port allocation and the instructions file. `sandbox/test/run.sh`
covers the library helpers and the pre-push guard against a bare repository.
CI runs both before building images.

## Findings from the prototype

- Two sandboxes sharing one Claude config dir both connect to Remote Control,
  each with its own environment id, without any prompts. Long-term behaviour
  of the shared token refresh is still unverified in practice.
- The `Enable Remote Control?` consent is `remoteDialogSeen: true` in
  `.claude.json`; workspace trust is `projects[<dir>].hasTrustDialogAccepted`.
  The entrypoint sets both, otherwise the server refuses to start with
  "Workspace not trusted".
- `claude remote-control` needs `oauthAccount` in `.claude.json` (it says
  "Unable to determine your organization" without it), so a login has to be a
  real `claude auth login`, not just a copied credentials file.
- The session link printed by the server has the form
  `https://claude.ai/code?environment=env_…`.
- Caddy's `handle_errors` must be limited to 502/503, otherwise it swallows
  the 401 challenge of basic auth.
- Anything that polls `git status` next to Claude must use
  `--no-optional-locks`, otherwise Claude's own git commands hit
  `index.lock: File exists`.
- `host.docker.internal` resolves to Docker Desktop's internal gateway, not
  the Mac's LAN address, so LAN links use the Bonjour name instead.

## Milestones

1. Done: sandbox image; login, Remote Control from claude.ai, preview and
   tunnel sharing verified by hand.
2. Done: manager with list, new, start/stop, claude.ai link, preview link.
3. Done: embedded terminal, editing repository/token, autosave, image update.
4. Done: installer (with launchd host-info job and uninstall script), GitHub
   Actions for the images. Open: a real end-to-end run on a Mac with a Team
   account, and a user guide with screenshots.
