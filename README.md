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
2. Either download [`Install sandbox.command`](installer/Install%20sandbox.command)
   and double-click it, or paste this into Terminal:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/FilipChalupa/dev-sandbox/main/installer/install.sh | bash
   ```

   Both do the same: pull the images, start the manager, set up the small
   host helper, and open the UI.
3. The manager opens at <http://localhost:8787>. Create a sandbox, start it,
   log in to Claude the first time (the card walks you through it), then
   "Open in claude.ai".

"Update" in the UI pulls the newest sandbox image (restart a sandbox to use
it), "Update manager" replaces the manager itself. Running the installer
again does the same as "Update manager".

Requirements on the Claude side: a Pro, Max, Team or Enterprise account. On
Team and Enterprise plans an owner has to enable Remote Control in the Claude
Code admin settings.

## Layout

- `sandbox/` – the sandbox container image and the scripts that run inside it
  ([README](sandbox/README.md)).
- `manager/` – the web UI that creates, starts and stops sandboxes through the
  Docker API.
- `installer/` – the one-shot installer for the colleague's machine (and
  `uninstall.sh`).
- `docs/` – design notes.

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
