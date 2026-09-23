import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import * as dk from './docker.js'
import * as store from './store.js'
import * as login from './login.js'
import * as registry from './registry.js'
import { hostInfo } from './host.js'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const managerVersion = { version: pkg.version, build: process.env.BUILD_SHA ?? 'dev' }

const action = (cmd: string[]) => async (c: any) => {
	try {
		const r = await dk.run(c.req.param('name'), cmd)
		return json({ ok: r.code === 0, output: r.output }, r.code === 0 ? 200 : 400)
	} catch (e) {
		return fail(e)
	}
}

const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')

const json = (data: unknown, status = 200) => Response.json(data, { status })
const fail = (e: unknown) => json({ error: e instanceof Error ? e.message : String(e) }, 400)

// Stop sandboxes nobody has used for a while.
async function idleSweep() {
	for (const s of await store.readAll()) {
		if (!s.idleStopHours) continue
		const started = await dk.startedAt(s.name)
		if (!started) continue
		const st = (await store.readStatus(s.name)) as { lastActivity?: string } | null
		const last = Math.max(started, Date.parse(st?.lastActivity ?? '') || 0)
		if (Date.now() - last > s.idleStopHours * 3600_000) {
			console.log(`stopping idle sandbox ${s.name}`)
			await dk.stop(s.name).catch(() => {})
		}
	}
}
setInterval(() => idleSweep().catch(() => {}), 60_000)

async function describe(s: store.SandboxConfig) {
	const [container, status, hasToken] = await Promise.all([
		dk.containerState(s.name),
		store.readStatus(s.name),
		store.hasToken(s.name),
	])
	return { ...s, lanPort: store.lanPort(s), hasToken, container, status: container.running ? status : null }
}

app.get('/api/sandboxes', async () => json(await Promise.all((await store.readAll()).map(describe))))

app.post('/api/sandboxes', async (c) => {
	try {
		const body = await c.req.json()
		const s = await store.create(body)
		return json(await describe(s), 201)
	} catch (e) {
		return fail(e)
	}
})

app.patch('/api/sandboxes/:name', async (c) => {
	try {
		const s = await store.update(c.req.param('name'), await c.req.json())
		return json(await describe(s))
	} catch (e) {
		return fail(e)
	}
})

app.post('/api/sandboxes/:name/start', async (c) => {
	try {
		const s = (await store.readAll()).find((x) => x.name === c.req.param('name'))
		if (!s) return json({ error: 'Unknown sandbox' }, 404)
		await dk.start(s)
		return json(await describe(s))
	} catch (e) {
		return fail(e)
	}
})

app.post('/api/sandboxes/:name/stop', async (c) => {
	try {
		await dk.stop(c.req.param('name'))
		const s = (await store.readAll()).find((x) => x.name === c.req.param('name'))
		return json(s ? await describe(s) : null)
	} catch (e) {
		return fail(e)
	}
})

app.delete('/api/sandboxes/:name', async (c) => {
	try {
		const name = c.req.param('name') ?? ''
		await dk.removeContainer(name)
		await store.remove(name, c.req.query('files') === '1')
		return json({ ok: true })
	} catch (e) {
		return fail(e)
	}
})

app.get('/api/sandboxes/:name/logs', async (c) => c.text(await dk.logs(c.req.param('name'))))

app.post('/api/sandboxes/:name/share', action(['sandbox-share']))
app.post('/api/sandboxes/:name/unshare', action(['sandbox-unshare']))
app.post('/api/sandboxes/:name/save', action(['sandbox-save', 'Changes from the sandbox']))
app.post('/api/sandboxes/:name/restart-claude', action(['sandbox-claude-start']))

app.get('/api/sandboxes/:name/login', (c) => json(login.status(c.req.param('name'))))
app.post('/api/sandboxes/:name/login', async (c) => {
	try {
		return json(await login.start(c.req.param('name')))
	} catch (e) {
		return fail(e)
	}
})
app.post('/api/sandboxes/:name/login/code', async (c) => {
	try {
		const { code } = await c.req.json()
		return json(login.code(c.req.param('name'), String(code ?? '')))
	} catch (e) {
		return fail(e)
	}
})
app.delete('/api/sandboxes/:name/login', (c) => {
	login.cancel(c.req.param('name'))
	return json({ ok: true })
})

app.post('/api/self-update', async () => {
	try {
		await dk.selfUpdate()
		return json({ ok: true })
	} catch (e) {
		return fail(e)
	}
})

// Live container log over a WebSocket.
app.get(
	'/api/sandboxes/:name/logs/stream',
	upgradeWebSocket((c) => {
		const name = c.req.param('name') ?? ''
		let stop: (() => void) | undefined
		return {
			async onOpen(_ev, ws) {
				try {
					stop = await dk.followLogs(name, (text) => ws.send(text))
				} catch (e) {
					ws.send(`[cannot read log: ${e instanceof Error ? e.message : e}]`)
				}
			},
			onClose() {
				stop?.()
			},
		}
	}),
)

app.post('/api/update', async () => {
	const lines: string[] = []
	try {
		await dk.pullImage((l) => lines.push(l))
		registry.forget(config.image)
		return json({ ok: true, log: lines.slice(-20) })
	} catch (e) {
		return fail(e)
	}
})

app.get('/api/info', async () => {
	const host = await hostInfo()
	return json({ image: config.image, hostDir: config.hostDir, lanHost: host.lanIp || host.hostName, manager: managerVersion })
})

app.get('/api/updates', async () => {
	const self = await dk.selfImage()
	const [sandbox, manager] = await Promise.all([registry.check(config.image), self ? registry.check(self) : null])
	return json({ sandbox, manager })
})

app.get('/api/diagnostics', async () => {
	const [docker, host, sandboxes] = await Promise.all([
		dk.diagnostics().catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
		hostInfo(),
		store.readAll(),
	])
	let disk: unknown = null
	try {
		const st = await fs.statfs(config.dataDir)
		disk = { freeGb: Math.round((st.bavail * st.bsize) / 1024 ** 3), totalGb: Math.round((st.blocks * st.bsize) / 1024 ** 3) }
	} catch {}
	const list = []
	for (const s of sandboxes) {
		const c = await dk.containerState(s.name)
		const st = (await store.readStatus(s.name)) as any
		let claudeVersion = ''
		if (c.running) claudeVersion = (await dk.run(s.name, ['claude', '--version'], 15_000).catch(() => ({ output: '' }))).output
		list.push({ name: s.name, container: c, startedAt: c.running ? new Date(await dk.startedAt(s.name)).toISOString() : '', lastActivity: st?.lastActivity ?? '', loggedIn: st?.claude?.loggedIn ?? null, claudeVersion, image: c.image })
	}
	return json({ manager: managerVersion, docker, host, disk, dataDir: config.dataDir, hostDir: config.hostDir, image: config.image, sandboxes: list })
})

// Browser terminal: ?cmd=shell | login | claude
app.get(
	'/api/sandboxes/:name/terminal',
	upgradeWebSocket((c) => {
		const name = c.req.param('name') ?? ''
		const which = c.req.query('cmd') ?? 'shell'
		const cmd =
			which === 'login' ? ['claude', 'auth', 'login']
			: which === 'claude' ? ['tmux', 'attach', '-t', 'claude']
			: ['bash', '-l']
		let session: Awaited<ReturnType<typeof dk.exec>> | undefined
		return {
			async onOpen(_ev, ws) {
				try {
					session = await dk.exec(name, cmd, 80, 24)
					session.stream.on('data', (chunk: Buffer) => ws.send(new Uint8Array(chunk)))
					session.stream.on('end', () => ws.close())
				} catch (e) {
					ws.send(`\r\n[cannot open terminal: ${e instanceof Error ? e.message : e}]\r\n`)
					ws.close()
				}
			},
			onMessage(ev) {
				const data = ev.data
				if (typeof data === 'string' && data.startsWith('\u0001resize:')) {
					const [w, h] = data.slice(8).split('x').map(Number)
					session?.resize(w, h).catch(() => {})
				} else {
					session?.stream.write(typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer))
				}
			},
			onClose() {
				session?.stream.end()
			},
		}
	}),
)

app.use('/*', serveStatic({ root: path.relative(process.cwd(), publicDir) || '.' }))

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, () =>
	console.log(`manager on http://localhost:${config.port} (sandboxes in ${config.hostDir}, image ${config.image})`),
)
injectWebSocket(server)
