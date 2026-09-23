import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import * as dk from './docker.js'
import * as store from './store.js'

const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')

const json = (data: unknown, status = 200) => Response.json(data, { status })
const fail = (e: unknown) => json({ error: e instanceof Error ? e.message : String(e) }, 400)

async function describe(s: store.SandboxConfig) {
	const [container, status, hasToken] = await Promise.all([
		dk.containerState(s.name),
		store.readStatus(s.name),
		store.hasToken(s.name),
	])
	return { ...s, hasToken, container, status: container.running ? status : null }
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

app.post('/api/update', async () => {
	const lines: string[] = []
	try {
		await dk.pullImage((l) => lines.push(l))
		return json({ ok: true, log: lines.slice(-20) })
	} catch (e) {
		return fail(e)
	}
})

app.get('/api/info', () => json({ image: config.image, hostDir: config.hostDir }))

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
