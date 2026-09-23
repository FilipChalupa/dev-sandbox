import Docker from 'dockerode'
import { config, hostManagerDir } from './config.js'
import { lanPort, type SandboxConfig } from './store.js'
import path from 'node:path'
import os from 'node:os'

export const docker = new Docker()

const containerName = (name: string) => config.containerPrefix + name

export async function containerState(name: string) {
	try {
		const info = await docker.getContainer(containerName(name)).inspect()
		return {
			exists: true,
			running: info.State.Running,
			status: info.State.Status,
			image: info.Config.Image,
			imageId: info.Image,
			exitCode: info.State.Running ? 0 : info.State.ExitCode,
			finishedAt: info.State.Running ? '' : info.State.FinishedAt,
		}
	} catch {
		return { exists: false, running: false, status: 'missing', image: '', imageId: '', exitCode: 0, finishedAt: '' }
	}
}

// Id of the sandbox image Docker has locally, to spot containers on an old one.
let imageIdCache = { at: 0, id: '' }
export async function currentImageId() {
	if (Date.now() - imageIdCache.at < 30_000) return imageIdCache.id
	try {
		imageIdCache = { at: Date.now(), id: (await docker.getImage(config.image).inspect()).Id }
	} catch {
		imageIdCache = { at: Date.now(), id: '' }
	}
	return imageIdCache.id
}

// Why a stopped container stopped: the last meaningful log lines.
export async function failureReason(name: string) {
	const text = await logs(name, 40)
	const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
	const marked = lines.filter((l) => /CLONE FAILED|fatal:|error|Error|denied|not found/i.test(l))
	return (marked.length ? marked : lines).slice(-3).join('\n')
}

// Can this URL be reached with this token? Uses git from the manager image.
export async function checkRepo(repoUrl: string, token: string, username: string) {
	const { execFile } = await import('node:child_process')
	const { promisify } = await import('node:util')
	const run = promisify(execFile)
	let url = repoUrl
	if (/^git@([^:]+):(.+)$/.test(url)) url = url.replace(/^git@([^:]+):(.+)$/, 'https://$1/$2')
	if (/^ssh:\/\/git@([^/]+)\/(.+)$/.test(url)) url = url.replace(/^ssh:\/\/git@([^/]+)\/(.+)$/, 'https://$1/$2')
	try {
		const u = new URL(url)
		if (token) {
			const host = u.host
			const user = username || (host === 'bitbucket.org' ? 'x-token-auth' : host === 'github.com' ? 'x-access-token' : host === 'gitlab.com' ? 'oauth2' : 'token')
			u.username = user
			u.password = token
		}
		const { stdout } = await run('git', ['ls-remote', '--heads', u.toString()], { timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
		const branches = stdout.split('\n').map((l) => l.split('\t')[1]?.replace('refs/heads/', '')).filter(Boolean) as string[]
		return { ok: true, branches, error: '' }
	} catch (e: any) {
		const msg = String(e?.stderr || e?.message || e).split('\n').filter(Boolean).slice(-2).join(' ')
		return { ok: false, branches: [] as string[], error: msg }
	}
}

// Log out of Claude for all sandboxes (the login is shared).
export async function claudeLogout(runningSandbox: string | undefined, credentialsFile: string) {
	if (runningSandbox) {
		await run(runningSandbox, ['claude', 'auth', 'logout'], 30_000).catch(() => {})
	}
	const fs = await import('node:fs/promises')
	await fs.rm(credentialsFile, { force: true })
}

// Containers are disposable: state lives in the mounts, so starting always
// recreates the container from the current config and image.
export async function start(sandbox: SandboxConfig) {
	await ensureImage()
	await removeContainer(sandbox.name)
	const hostWorkspace = path.posix.join(config.hostDir, sandbox.name)
	const container = await docker.createContainer({
		name: containerName(sandbox.name),
		Image: config.image,
		Labels: { [config.label]: sandbox.name },
		Env: [
			`SANDBOX_NAME=${sandbox.name}`,
			`SANDBOX_REPO_URL=${sandbox.repoUrl}`,
			`SANDBOX_BRANCH=${sandbox.branch}`,
			`SANDBOX_GIT_USERNAME=${sandbox.gitUsername ?? ''}`,
			`SANDBOX_AUTOSAVE_MINUTES=${sandbox.autosaveMinutes}`,
			`SANDBOX_PREVIEW_URL=http://localhost:${sandbox.hostPort}`,
		],
		ExposedPorts: { '8080/tcp': {}, '8081/tcp': {} },
		HostConfig: {
			Binds: [
				`${hostWorkspace}:/workspace/${sandbox.name}`,
				`${hostManagerDir(sandbox.name)}:/state`,
				`${hostManagerDir('claude')}:/home/node/.claude`,
			],
			PortBindings: {
				'8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(sandbox.hostPort) }],
				// The basic-auth listener on all interfaces, for phones on the same network.
				...(sandbox.lanPreview ? { '8081/tcp': [{ HostIp: '0.0.0.0', HostPort: String(lanPort(sandbox)) }] } : {}),
			},
			Memory: Math.round(sandbox.memoryGb * 1024 ** 3),
			MemorySwap: Math.round(sandbox.memoryGb * 1024 ** 3),
			NanoCpus: Math.round(sandbox.cpus * 1e9),
			PidsLimit: 4096,
			// unless-stopped survives a reboot but respects an explicit Stop.
			RestartPolicy: { Name: sandbox.autostart ? 'unless-stopped' : 'no' },
			Init: true,
		},
	})
	await container.start()
}

export async function startedAt(name: string) {
	try {
		const info = await docker.getContainer(containerName(name)).inspect()
		return info.State.Running ? Date.parse(info.State.StartedAt) : 0
	} catch {
		return 0
	}
}

export async function stop(name: string) {
	try {
		await docker.getContainer(containerName(name)).stop({ t: 15 })
	} catch (e: any) {
		if (e?.statusCode !== 304 && e?.statusCode !== 404) throw e
	}
}

export async function removeContainer(name: string) {
	try {
		await docker.getContainer(containerName(name)).remove({ force: true })
	} catch (e: any) {
		if (e?.statusCode !== 404) throw e
	}
}

export async function logs(name: string, tail = 200) {
	try {
		const buf = await docker.getContainer(containerName(name)).logs({ stdout: true, stderr: true, tail })
		return demux(buf as unknown as Buffer)
	} catch {
		return ''
	}
}

// Docker multiplexes stdout/stderr with 8 byte frame headers when no TTY.
function demux(buf: Buffer) {
	let out = ''
	let i = 0
	while (i + 8 <= buf.length) {
		const len = buf.readUInt32BE(i + 4)
		out += buf.subarray(i + 8, i + 8 + len).toString('utf8')
		i += 8 + len
	}
	return out || buf.toString('utf8')
}

async function ensureImage() {
	try {
		await docker.getImage(config.image).inspect()
	} catch {
		await pullImage(() => {})
	}
}

// An image name without a registry or namespace (like a local `docker build`
// tag) cannot be pulled; say so instead of failing with a confusing 404.
export const isLocalImage = () => !config.image.includes('/')

type PullEvent = { status?: string; id?: string; progress?: string; progressDetail?: { current?: number; total?: number } }
export async function pullImage(onProgress: (line: string, ev?: PullEvent) => void) {
	if (isLocalImage()) throw new Error(`"${config.image}" is a local image, there is nothing to download. Rebuild it instead.`)
	const stream = await docker.pull(config.image)
	await new Promise<void>((resolve, reject) => {
		docker.modem.followProgress(
			stream,
			(err) => (err ? reject(err) : resolve()),
			(ev: PullEvent) => onProgress(`${ev.status ?? ''} ${ev.progress ?? ''}`.trim(), ev),
		)
	})
}

// Run a command in the sandbox as the sandbox user and collect its output.
export async function run(name: string, cmd: string[], timeoutMs = 90_000): Promise<{ code: number; output: string }> {
	const container = docker.getContainer(containerName(name))
	const e = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, User: 'node', WorkingDir: `/workspace/${name}` })
	const stream = await e.start({})
	const chunks: Buffer[] = []
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${cmd[0]} timed out`)), timeoutMs)
		stream.on('data', (c: Buffer) => chunks.push(c))
		stream.on('end', () => { clearTimeout(timer); resolve() })
		stream.on('error', (err) => { clearTimeout(timer); reject(err) })
	})
	const { ExitCode } = await e.inspect()
	return { code: ExitCode ?? 0, output: demux(Buffer.concat(chunks)).trim() }
}

// Follow the container log; each chunk is already demultiplexed text.
export async function followLogs(name: string, onLine: (text: string) => void, tail = 200) {
	const container = docker.getContainer(containerName(name))
	const stream = (await container.logs({ follow: true, stdout: true, stderr: true, tail })) as NodeJS.ReadableStream
	stream.on('data', (chunk: Buffer) => onLine(demux(chunk)))
	return () => (stream as any).destroy?.()
}

// Replace the running manager with a fresh container from the newest image.
// The manager cannot replace itself while running, so it pulls the image and
// hands the swap to a short-lived helper container started from that image.
export async function selfImage() {
	try {
		return (await docker.getContainer(os.hostname()).inspect()).Config.Image
	} catch {
		return ''
	}
}

export async function selfUpdate() {
	const self = await docker.getContainer(os.hostname()).inspect()
	const image = self.Config.Image
	if (image.includes('/')) await pullImage(() => {})
	const spec = {
		name: self.Name.replace(/^\//, ''),
		image,
		env: self.Config.Env ?? [],
		binds: self.HostConfig.Binds ?? [],
		ports: self.HostConfig.PortBindings ?? {},
		exposed: self.Config.ExposedPorts ?? {},
		restart: self.HostConfig.RestartPolicy ?? { Name: 'unless-stopped' },
	}
	const helper = await docker.createContainer({
		Image: image,
		Cmd: ['node', '--import', 'tsx', 'src/self-update.ts'],
		Env: [`SPEC=${JSON.stringify(spec)}`],
		HostConfig: { Binds: ['/var/run/docker.sock:/var/run/docker.sock'], AutoRemove: true },
	})
	await helper.start()
}

export async function diagnostics() {
	const [version, info] = await Promise.all([docker.version(), docker.info()])
	const images: Record<string, unknown> = {}
	for (const name of [config.image, await selfImage()].filter(Boolean)) {
		try {
			const i = await docker.getImage(name).inspect()
			images[name] = { created: i.Created, sizeMb: Math.round(i.Size / 1e6), digest: (i.RepoDigests ?? [])[0]?.split('@')[1] ?? '' }
		} catch {
			images[name] = { missing: true }
		}
	}
	return {
		docker: { version: version.Version, apiVersion: version.ApiVersion, os: info.OperatingSystem, arch: info.Architecture, cpus: info.NCPU, memoryGb: Math.round((info.MemTotal / 1024 ** 3) * 10) / 10 },
		images,
	}
}

// Interactive exec for the browser terminal.
export async function exec(name: string, cmd: string[], cols: number, rows: number) {
	const container = docker.getContainer(containerName(name))
	const e = await container.exec({
		Cmd: cmd,
		AttachStdin: true,
		AttachStdout: true,
		AttachStderr: true,
		Tty: true,
		Env: ['TERM=xterm-256color'],
		User: 'node',
		WorkingDir: `/workspace/${name}`,
	})
	const stream = await e.start({ hijack: true, stdin: true, Tty: true })
	await e.resize({ w: cols, h: rows })
	return { stream, resize: (w: number, h: number) => e.resize({ w, h }) }
}
