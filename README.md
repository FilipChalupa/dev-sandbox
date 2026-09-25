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

## Install

Needs Docker and one paid Claude account (Pro, Max, or a seat on a Team or
Enterprise plan; on Team and Enterprise an owner has to enable Remote Control
in the Claude Code admin settings). The colleague logs in once, inside the
manager.

### macOS

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   and turn on "Start Docker Desktop when you sign in".
2. Either download [`Install sandbox.command`](installer/Install%20sandbox.command)
   and double-click it, or paste this into Terminal:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/FilipChalupa/dev-sandbox/main/installer/install.sh | bash
   ```

3. The manager opens at <http://localhost:8787>.

The installer also sets up a small helper (a launchd job) that provides the
phone preview links and opening a project folder in Finder.

### Linux (Ubuntu and others)

1. Install Docker: either [Docker Engine](https://docs.docker.com/engine/install/ubuntu/)
   with your user in the `docker` group, or Docker Desktop for Linux.
2. Run the same installer:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/FilipChalupa/dev-sandbox/main/installer/install.sh | bash
   ```

3. Open <http://localhost:8787>.

The helper runs as a systemd user service (`dev-sandbox-host-info`); folders
open with `xdg-open`. With Docker Desktop for Linux the installer finds its
socket under `~/.docker/desktop/`. Files in `~/Sandboxes` are written by the
sandbox user (uid 1000); on a desktop where your user has another uid, change
their owner with `sudo chown -R $USER ~/Sandboxes` when you need to edit them.

### Windows

Install Docker Desktop, then run this in PowerShell (the installer script is
for macOS and Linux):

```powershell
mkdir $HOME\Sandboxes -Force
docker run -d --name sandbox-manager --restart unless-stopped `
  -p 127.0.0.1:8787:8787 -v /var/run/docker.sock:/var/run/docker.sock `
  -v "$HOME\Sandboxes:/sandboxes" -e "SANDBOXES_HOST_DIR=$HOME\Sandboxes" `
  ghcr.io/filipchalupa/dev-sandbox-manager:latest
```

There is no helper on Windows: the phone preview links and opening the
folder from the UI are unavailable, everything else works.

### First steps in the UI

Create a sandbox (or click the link from your developer), start it, log in
to Claude the first time (the card walks you through it), then
"Open in claude.ai".

### Update and uninstall

"Update manager" in the gear menu replaces the manager itself; "Update
sandboxes" pulls the newest sandbox image (restart a sandbox to use it).
Running the installer again does the same as "Update manager" and is the way
to update a manager older than September 2026 (which could not update itself).
`installer/uninstall.sh` removes everything; add `--purge` to delete
`~/Sandboxes` too.

### Without the installer

The manager is one container, so Docker Desktop's own UI can start it:
search for `ghcr.io/filipchalupa/dev-sandbox-manager:latest` in **Images**,
pull it, click **Run** and fill in the optional settings:

| Field | Value |
| --- | --- |
| Container name | `sandbox-manager` |
| Host port | `8787` (container port 8787) |
| Volume 1 | host `/var/run/docker.sock` → container `/var/run/docker.sock` |
| Volume 2 | host `/Users/<you>/Sandboxes` → container `/sandboxes` |
| Environment | `SANDBOXES_HOST_DIR` = `/Users/<you>/Sandboxes` |

The manager sets its own restart policy on first start, so it comes back
with Docker either way.

## Handing a project to the colleague

1. In Bitbucket open the repository, **Repository settings → Access tokens →
   Create**, scope *Repositories: read and write*. Copy the token.
2. Run the manager yourself, click **New sandbox**, fill in the name, the
   repository URL and the token (or paste the URL with the token inside:
   `https://x-token-auth:TOKEN@bitbucket.org/workspace/repo.git`), click
   **Check access** to be sure the token works, optionally write
   instructions for Claude ("work only in `web/`"), and click
   **Copy as a link for a colleague**. Do not click Create unless you want the
   sandbox on your own machine too.
3. Send the link through a safe channel (a password manager share, a
   self-destructing note). It looks like
   `http://localhost:8787/#new?name=site&repo=…&token=…` and opens the
   colleague's manager with the form pre-filled; the token never leaves their
   browser except into their own manager.
4. Optional but recommended: in Bitbucket **Branch permissions**, protect the
   main branches so the token can only push to `sandbox/*`. The sandbox has
   its own guard too, but this one is enforced server side.

The colleague clicks the link, clicks Create, then Start, logs in to Claude
once, and opens claude.ai.

## Languages

The manager UI is in English and Czech, chosen from the browser language and
switchable in the header. Adding a language is one dictionary in
`manager/web/i18n.ts` plus one line in its `languages` table.

## Development

```sh
cd manager && pnpm install && pnpm dev      # UI on http://localhost:8787, needs a local Docker socket
docker build -t dev-sandbox sandbox/        # the sandbox image
```

Point the manager at a locally built image with `SANDBOX_IMAGE=dev-sandbox`.

## License

MIT
