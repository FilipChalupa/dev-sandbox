# dev-sandbox

Isolated, Claude Code powered development sandboxes for people who are not
developers.

The idea: a designer or content person gets a small web UI on their Mac where
they create a sandbox per project. Each sandbox is a Docker container with its
own filesystem, a clone of the project's git repository, and Claude Code running
in [Remote Control](https://code.claude.com/docs/en/remote-control) server mode.
They then talk to Claude from claude.ai/code or the Claude mobile app, look at
the running dev server on `localhost`, share it with someone through a
Cloudflare quick tunnel protected by basic auth, and Claude commits and pushes
their work to a branch that a developer merges later.

Status: **working prototype.** The sandbox image and the manager UI run;
what is left is real-world use. See [docs/design.md](docs/design.md) for the
architecture and decisions.

## Install (Mac)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   and turn on "Start Docker Desktop when you sign in".
2. Download [`Install sandbox.command`](installer/Install%20sandbox.command)
   and double-click it (or run `installer/install.sh` in a terminal).
3. The manager opens at <http://localhost:8787>. Create a sandbox, start it,
   click "Log in to Claude" the first time, then "Open in claude.ai".

Running the installer again updates the manager. The "Update" button in the
UI updates the sandbox image; restart a sandbox to use it.

Requirements on the Claude side: a Pro, Max, Team or Enterprise account. On
Team and Enterprise plans an owner has to enable Remote Control in the Claude
Code admin settings.

## Layout

- `sandbox/` – the sandbox container image and the scripts that run inside it
  ([README](sandbox/README.md)).
- `manager/` – the web UI that creates, starts and stops sandboxes through the
  Docker API.
- `installer/` – the one-shot installer for the colleague's machine.
- `docs/` – design notes.

## Development

```sh
cd manager && pnpm install && pnpm dev      # UI on http://localhost:8787, needs a local Docker socket
docker build -t dev-sandbox sandbox/        # the sandbox image
```

Point the manager at a locally built image with `SANDBOX_IMAGE=dev-sandbox`.

## License

MIT
