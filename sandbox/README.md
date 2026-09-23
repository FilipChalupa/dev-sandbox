# Sandbox image

One container per project. Runs Claude Code in Remote Control server mode,
a Caddy reverse proxy for the preview and cloudflared for sharing.

## Build

```sh
docker build -t dev-sandbox sandbox/
```

## Run by hand

```sh
docker volume create claude-config     # shared Claude login
docker run -d --name sb-myproject \
  -e SANDBOX_NAME=myproject \
  -e SANDBOX_REPO_URL=https://bitbucket.org/workspace/repo.git \
  -e SANDBOX_GIT_TOKEN=... \
  -e SANDBOX_BRANCH=sandbox/myproject \
  -e SANDBOX_PREVIEW_URL=http://localhost:3001 \
  -p 127.0.0.1:3001:8080 \
  -v "$HOME/Sandboxes/myproject:/workspace/myproject" \
  -v "$HOME/Sandboxes/.manager/myproject:/state" \
  -v claude-config:/home/node/.claude \
  dev-sandbox
```

First time only, log in to Claude:

```sh
docker exec -it -u node sb-myproject claude auth login
```

Then open claude.ai/code: a server named `myproject` is listed there and you
can start sessions in it. Status for the manager is in `/state/status.json`.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `SANDBOX_NAME` | required | Name, also the workspace path `/workspace/<name>` and the Remote Control server name |
| `SANDBOX_REPO_URL` | empty | HTTPS (or ssh style, converted) remote. Empty = start an empty project |
| `SANDBOX_GIT_TOKEN` | empty | Token for fetch and push (or put it in `/state/git-token`) |
| `SANDBOX_GIT_USERNAME` | by host | User name for the token: `x-token-auth` on Bitbucket, `x-access-token` on GitHub, `oauth2` on GitLab |
| `SANDBOX_BRANCH` | `sandbox/<name>` | The working branch |
| `SANDBOX_GIT_NAME`, `SANDBOX_GIT_EMAIL` | from the Claude login | Commit identity |
| `SANDBOX_PREVIEW_URL` | `http://localhost:8080` | What the person opens on the host; shown to Claude |
| `SANDBOX_PREVIEW_USER` | `preview` | Basic auth user for the shared tunnel |
| `SANDBOX_PREVIEW_PASSWORD` | generated once | Basic auth password, kept in `/state/preview-password` |
| `SANDBOX_AUTOSAVE_MINUTES` | `10` | `0` disables the wip autosave commits |
| `SANDBOX_PRESERVE_HOST` | `0` | `1` keeps the original `Host` header instead of rewriting it to the upstream |

## Scripts inside the container

- `sandbox-preview <port>`: point the preview at the dev server's port.
- `sandbox-share [<port>]`: start the public tunnel, print URL and credentials.
- `sandbox-unshare`: stop the tunnel.
- `sandbox-save [message]`: commit everything and push the working branch.
- `sandbox-status`: print the status JSON.
- `sandbox-claude-start`: restart the Claude Remote Control server.
- `sandbox-ports`: list the ports something listens on (the preview follows
  them automatically; `sandbox-preview` pins one).
- `sandbox-git-identity`: set the commit identity from the Claude login.
