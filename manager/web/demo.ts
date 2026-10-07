// Demo mode (?demo=1): the UI runs on made-up data instead of the API, for
// screenshots and a quick look without Docker. Nothing here is real.
import { api, type Sandbox } from './api'

const now = Date.now()
const ago = (min: number) => new Date(now - min * 60_000).toISOString()

const ready: Sandbox = {
	name: 'my-site',
	repoUrl: 'https://bitbucket.org/example-studio/my-site.git',
	branch: 'sandbox/my-site',
	hostPort: 3001,
	autosaveMinutes: 10,
	gitUsername: 'x-token-auth',
	instructions: 'Work only inside the web/ folder.',
	order: 0,
	autostart: true,
	memoryGb: 4,
	cpus: 2,
	idleStopHours: 4,
	lanPreview: true,
	hostFolder: false,
	lanPort: 13001,
	hasToken: true,
	container: { exists: true, running: true, status: 'running', image: 'ghcr.io/example/dev-sandbox:latest', imageId: 'sha256:demo', exitCode: 0, finishedAt: '' },
	failure: '',
	outdated: false,
	settingsPending: false,
	stoppedReason: null,
	status: {
		git: {
			branch: 'sandbox/my-site',
			remote: 'https://bitbucket.org/example-studio/my-site.git',
			dirty: 0,
			ahead: 0,
			lastCommit: 'a1b2c3d Homepage hero with the new photo',
			today: ['a1b2c3d Homepage hero with the new photo', '9f8e7d6 Larger buttons in the header', '5c4b3a2 wip: autosave 09:40'],
			changed: [],
			shortstat: '',
			sends: [{ at: ago(35), count: 2, sha: 'a1b2c3d', subject: 'Homepage hero with the new photo' }],
			remoteCheck: { ok: true, at: ago(120), error: '' },
			push: { ok: true, reason: 'pushed', at: ago(35), detail: '' },
			behind: 0,
		},
		claude: { loggedIn: true, email: 'designer@example.com', serverRunning: true, supervisorRunning: true, sessionUrl: 'https://claude.ai/code?environment=env_demo' },
		preview: { url: 'http://localhost:3001', upstreamPort: 5173, devServerUp: true, proxyUp: true, lanEnabled: true, imageAt: ago(3), tunnelUrl: 'https://quiet-meadow-example.trycloudflare.com', user: 'preview', password: 'kfm4tcqph7xe' },
		visits: { last: { at: ago(48), via: 'tunnel', mobile: true, path: '/' }, today: 6 },
		usage: { today: { messages: 41, input: 900, output: 18_400, cacheRead: 1_150_000, cacheWrite: 62_000 }, week: { messages: 233, input: 5_100, output: 96_000, cacheRead: 7_900_000, cacheWrite: 410_000 }, updatedAt: ago(2) },
		lastActivity: ago(12),
		updatedAt: ago(0),
	},
}

const stopped: Sandbox = {
	...ready,
	name: 'landing-page',
	repoUrl: 'https://github.com/example-studio/landing-page.git',
	branch: 'sandbox/landing-page',
	hostPort: 3002,
	lanPort: 13002,
	order: 1,
	autostart: false,
	instructions: '',
	container: { ...ready.container, running: false, status: 'exited' },
	stoppedReason: { reason: 'idle', hours: 4, at: ago(600) },
	status: null,
}

export function enableDemo() {
	const list = [ready, stopped]
	Object.assign(api, {
		list: async () => list,
		info: async () => ({ image: 'ghcr.io/example/dev-sandbox:latest', hostDir: '/Users/designer/Sandboxes', helper: true, lanHost: '192.168.1.23', lanHosts: [{ host: '192.168.1.23', label: 'Wi-Fi' }], manager: { version: '0.1.0', build: 'demo' } }),
		readiness: async () => ({ docker: { ok: true, detail: 'Docker 29' }, helper: { ok: true, detail: '192.168.1.23' }, image: { ok: true, detail: '2374 MB' }, login: { ok: true, detail: 'designer@example.com' }, sandboxes: 2 }),
		updates: async () => ({ sandbox: { image: '', local: '', remote: '', updateAvailable: false }, manager: null }),
		stats: async () => ({ 'my-site': { cpuPercent: 3, memMb: 812, memLimitMb: 4096 } }),
		settings: async () => ({ timeZone: 'Europe/Prague' }),
		saveSettings: async () => ({ timeZone: 'Europe/Prague' }),
		checkRepo: async () => ({ ok: true, branches: ['main'], error: '' }),
	})
	// The thumbnail comes from a static demo image instead of the sandbox.
	;(window as any).__demoThumb = '/demo-preview.png'
}
