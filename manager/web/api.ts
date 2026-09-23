export type Sandbox = {
	name: string
	repoUrl: string
	branch: string
	hostPort: number
	autosaveMinutes: number
	hasToken: boolean
	container: { exists: boolean; running: boolean; status: string; image: string }
	status: null | {
		git: { branch: string; remote: string; dirty: number; ahead: number; lastCommit: string }
		claude: { loggedIn: boolean; email: string; serverRunning: boolean; sessionUrl: string }
		preview: { url: string; upstreamPort: number; tunnelUrl: string; user: string; password: string }
		updatedAt: string
	}
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
	const res = await fetch(url, {
		method,
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	})
	const text = await res.text()
	const data = text ? JSON.parse(text) : null
	if (!res.ok) throw new Error(data?.error ?? res.statusText)
	return data
}

export const api = {
	list: () => call<Sandbox[]>('GET', '/api/sandboxes'),
	create: (body: object) => call<Sandbox>('POST', '/api/sandboxes', body),
	update: (name: string, body: object) => call<Sandbox>('PATCH', `/api/sandboxes/${name}`, body),
	start: (name: string) => call<Sandbox>('POST', `/api/sandboxes/${name}/start`),
	stop: (name: string) => call<Sandbox>('POST', `/api/sandboxes/${name}/stop`),
	remove: (name: string, files: boolean) => call<unknown>('DELETE', `/api/sandboxes/${name}?files=${files ? 1 : 0}`),
	logs: (name: string) => fetch(`/api/sandboxes/${name}/logs`).then((r) => r.text()),
	update_image: () => call<{ log: string[] }>('POST', '/api/update'),
	info: () => call<{ image: string; hostDir: string }>('GET', '/api/info'),
}
