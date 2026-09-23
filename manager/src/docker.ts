import Docker from 'dockerode'
import { config, hostManagerDir } from './config.js'
import type { SandboxConfig } from './store.js'
import path from 'node:path'
import os from 'node:os'

export const docker = new Docker()

const containerName = (name: string) => config.containerPrefix + name

export async function containerState(name: string) {
	try {
		const info = await docker.getContainer(containerName(name)).inspect()
		return { exists: true, running: info.State.Running, status: info.State.Status, image: info.Config.Image }
	} catch {
		return { exists: false, running: false, status: 'missing', image: '' }
	}
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
			`SANDBOX_AUTOSAVE_MINUTES=${sandbox.autosaveMinutes}`,
			`SANDBOX_PREVIEW_URL=http://localhost:${sandbox.hostPort}`,
		],
		ExposedPorts: { '8080/tcp': {} },
		HostConfig: {
			Binds: [
				`${hostWorkspace}:/workspace/${sandbox.name}`,
				`${hostManagerDir(sandbox.name)}:/state`,
				`${hostManagerDir('claude')}:/home/node/.claude`,
			],
			PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(sandbox.hostPort) }] },
			// unless-stopped survives a reboot but respects an explicit Stop.
			RestartPolicy: { Name: sandbox.autostart ? 'unless-stopped' : 'no' },
			Init: true,
		},
	})
	await container.start()
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

export async function pullImage(onProgress: (line: string) => void) {
	if (isLocalImage()) throw new Error(`"${config.image}" is a local image, there is nothing to download. Rebuild it instead.`)
	const stream = await docker.pull(config.image)
	await new Promise<void>((resolve, reject) => {
		docker.modem.followProgress(
			stream,
			(err) => (err ? reject(err) : resolve()),
			(ev) => onProgress(`${ev.status ?? ''} ${ev.progress ?? ''}`.trim()),
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
