export type Sandbox = {
	name: string
	repoUrl: string
	branch: string
	hostPort: number
	autosaveMinutes: number
	gitUsername: string
	instructions: string
	order: number
	autostart: boolean
	memoryGb: number
	cpus: number
	idleStopHours: number
	lanPreview: boolean
	lanPort: number
	hasToken: boolean
	container: { exists: boolean; running: boolean; status: string; image: string; imageId: string; exitCode: number; finishedAt: string }
	failure: string
	outdated: boolean
	settingsPending: boolean
	stoppedReason: { reason: 'idle'; hours: number; at: string } | null
	status: null | {
		git: { branch: string; remote: string; dirty: number; ahead: number; lastCommit: string; today: string[]; changed: string[]; shortstat: string; sends: { at: string; count: number; sha: string; subject: string }[] }
		claude: { loggedIn: boolean; email: string; serverRunning: boolean; supervisorRunning: boolean; sessionUrl: string }
		preview: { url: string; upstreamPort: number; devServerUp: boolean; proxyUp: boolean; lanEnabled: boolean; imageAt: string; tunnelUrl: string; user: string; password: string }
		lastActivity: string
		updatedAt: string
	}
}

export type UpdateProgress = { running: boolean; done: boolean; error: string; percent: number; lines: string[] }

export type UpdateCheck = { image: string; local: string; remote: string; updateAvailable: boolean; error?: string }

export type LoginState = { url: string; done: boolean; success: boolean; error: string; invalidCode: boolean; output: string }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
	const res = await fetch(url, {
		method,
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	})
	const text = await res.text()
	const data = text ? JSON.parse(text) : null
	if (!res.ok) throw new Error(data?.error ?? data?.output ?? res.statusText)
	return data
}

export const api = {
	list: () => call<Sandbox[]>('GET', '/api/sandboxes'),
	create: (body: object) => call<Sandbox>('POST', '/api/sandboxes', body),
	update: (name: string, body: object) => call<Sandbox>('PATCH', `/api/sandboxes/${name}`, body),
	start: (name: string) => call<Sandbox & { portNote?: { from: number; to: number } | null }>('POST', `/api/sandboxes/${name}/start`),
	stop: (name: string) => call<Sandbox>('POST', `/api/sandboxes/${name}/stop`),
	reset: (name: string) => call<Sandbox>('POST', `/api/sandboxes/${name}/reset`),
	rename: (name: string, newName: string) => call<Sandbox>('POST', `/api/sandboxes/${name}/rename`, { newName }),
	order: (names: string[]) => call<{ ok: boolean }>('POST', '/api/order', { names }),
	settings: () => call<{ timeZone: string }>('GET', '/api/settings'),
	saveSettings: (body: { timeZone: string }) => call<{ timeZone: string }>('POST', '/api/settings', body),
	remove: (name: string, files: boolean) => call<unknown>('DELETE', `/api/sandboxes/${name}?files=${files ? 1 : 0}`),
	logs: (name: string) => fetch(`/api/sandboxes/${name}/logs`).then((r) => r.text()),
	update_image: () => call<UpdateProgress>('POST', '/api/update'),
	update_progress: () => call<UpdateProgress>('GET', '/api/update'),
	self_update: () => call<{ ok: boolean }>('POST', '/api/self-update'),
	action: (name: string, what: 'share' | 'unshare' | 'save' | 'restart-claude' | 'dev-start' | 'dev-stop') =>
		call<{ ok: boolean; output: string }>('POST', `/api/sandboxes/${name}/${what}`),
	save: (name: string, force: boolean) => call<{ ok: boolean; checksFailed?: boolean; output: string }>('POST', `/api/sandboxes/${name}/save?force=${force ? 1 : 0}`),
	checkRepo: (body: { repoUrl: string; token: string; username?: string }) => call<{ ok: boolean; branches: string[]; error: string }>('POST', '/api/check-repo', body),
	logoutClaude: () => call<{ ok: boolean }>('POST', '/api/claude/logout'),
	devLog: (name: string) => fetch(`/api/sandboxes/${name}/dev-log`).then((r) => r.text()),
	stats: () => call<Record<string, { cpuPercent: number; memMb: number; memLimitMb: number } | null>>('GET', '/api/stats'),
	prune: () => call<{ removed: number; freedMb: number }>('POST', '/api/prune'),
	openFolder: (name: string) => call<{ opened: boolean; path: string }>('POST', `/api/sandboxes/${name}/open-folder`),
	login: {
		status: (name: string) => call<LoginState | null>('GET', `/api/sandboxes/${name}/login`),
		start: (name: string) => call<LoginState>('POST', `/api/sandboxes/${name}/login`),
		code: (name: string, code: string) => call<LoginState>('POST', `/api/sandboxes/${name}/login/code`, { code }),
		cancel: (name: string) => call<unknown>('DELETE', `/api/sandboxes/${name}/login`),
	},
	info: () => call<{ image: string; hostDir: string; helper: boolean; lanHost: string; lanHosts: { host: string; label: string }[]; manager: { version: string; build: string } }>('GET', '/api/info'),
	updates: () => call<{ sandbox: UpdateCheck; manager: UpdateCheck | null }>('GET', '/api/updates'),
	diagnostics: () => call<any>('GET', '/api/diagnostics'),
}
