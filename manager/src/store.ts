import fs from 'node:fs/promises'
import path from 'node:path'
import { config, managerDir } from './config.js'

export type SandboxConfig = {
	name: string
	repoUrl: string
	branch: string
	hostPort: number
	autosaveMinutes: number
	gitUsername: string
	instructions: string
	autostart: boolean
	memoryGb: number
	cpus: number
	idleStopHours: number
	lanPreview: boolean
	createdAt: string
}

export const defaults = { memoryGb: 4, cpus: 2, idleStopHours: 4, lanPreview: true }

const file = () => managerDir('sandboxes.json')

export async function readAll(): Promise<SandboxConfig[]> {
	try {
		const list = JSON.parse(await fs.readFile(file(), 'utf8')) as Partial<SandboxConfig>[]
		return list.map((s) => ({ ...defaults, autostart: false, gitUsername: '', instructions: '', ...s }) as SandboxConfig)
	} catch {
		return []
	}
}

export const lanPort = (s: SandboxConfig) => s.hostPort + 10000

async function writeAll(list: SandboxConfig[]) {
	await fs.mkdir(managerDir(), { recursive: true })
	await fs.writeFile(file(), JSON.stringify(list, null, '\t') + '\n')
}

// A pasted URL may carry credentials (https://x-token-auth:TOKEN@bitbucket.org/…).
// Keep them out of the stored URL: the token goes to the token file instead.
export function splitCredentials(url: string): { url: string; username: string; token: string } {
	try {
		const u = new URL(url)
		if (!u.username && !u.password) return { url, username: '', token: '' }
		const username = decodeURIComponent(u.username)
		const token = decodeURIComponent(u.password || u.username) // "TOKEN@host" without a user
		if (!u.password) return { url: `${u.protocol}//${u.host}${u.pathname}`, username: '', token }
		u.username = ''
		u.password = ''
		return { url: u.toString(), username, token }
	} catch {
		return { url, username: '', token: '' }
	}
}

export const validName = (name: string) => /^[a-z0-9][a-z0-9-]{0,40}$/.test(name)

export async function create(input: Partial<SandboxConfig> & { name: string; token?: string }) {
	const list = await readAll()
	if (!validName(input.name)) throw new Error('Name: lowercase letters, digits and dashes only')
	if (list.some((s) => s.name === input.name)) throw new Error('A sandbox with this name exists')
	const creds = splitCredentials(input.repoUrl ?? '')
	if (creds.token) {
		input.repoUrl = creds.url
		input.token = input.token || creds.token
		input.gitUsername = input.gitUsername || creds.username
	}
	const used = new Set(list.map((s) => s.hostPort))
	let port = config.firstPort
	while (used.has(port)) port++
	const sandbox: SandboxConfig = {
		name: input.name,
		repoUrl: input.repoUrl ?? '',
		branch: input.branch || `sandbox/${input.name}`,
		hostPort: port,
		autosaveMinutes: input.autosaveMinutes ?? 10,
		gitUsername: input.gitUsername ?? '',
		instructions: input.instructions ?? '',
		autostart: input.autostart ?? false,
		memoryGb: input.memoryGb ?? defaults.memoryGb,
		cpus: input.cpus ?? defaults.cpus,
		idleStopHours: input.idleStopHours ?? defaults.idleStopHours,
		lanPreview: input.lanPreview ?? defaults.lanPreview,
		createdAt: new Date().toISOString(),
	}
	await fs.mkdir(path.join(config.dataDir, sandbox.name), { recursive: true })
	await fs.mkdir(managerDir(sandbox.name), { recursive: true })
	await fs.mkdir(managerDir('claude'), { recursive: true })
	if (input.token) await setToken(sandbox.name, input.token)
	await writeInstructions(sandbox.name, sandbox.instructions)
	await writeAll([...list, sandbox])
	return sandbox
}

export async function update(name: string, patch: Partial<SandboxConfig> & { token?: string }) {
	const list = await readAll()
	const sandbox = list.find((s) => s.name === name)
	if (!sandbox) throw new Error('Unknown sandbox')
	if (patch.repoUrl !== undefined) {
		const creds = splitCredentials(patch.repoUrl)
		sandbox.repoUrl = creds.url
		if (creds.token) {
			patch.token = patch.token || creds.token
			if (creds.username) sandbox.gitUsername = creds.username
		}
	}
	if (patch.gitUsername !== undefined) sandbox.gitUsername = patch.gitUsername
	if (patch.instructions !== undefined) {
		sandbox.instructions = patch.instructions
		await writeInstructions(name, patch.instructions)
	}
	if (patch.branch) sandbox.branch = patch.branch
	if (patch.autosaveMinutes !== undefined) sandbox.autosaveMinutes = patch.autosaveMinutes
	if (patch.autostart !== undefined) sandbox.autostart = Boolean(patch.autostart)
	if (patch.memoryGb !== undefined) sandbox.memoryGb = Math.max(1, Number(patch.memoryGb) || defaults.memoryGb)
	if (patch.cpus !== undefined) sandbox.cpus = Math.max(0.5, Number(patch.cpus) || defaults.cpus)
	if (patch.idleStopHours !== undefined) sandbox.idleStopHours = Math.max(0, Number(patch.idleStopHours) || 0)
	if (patch.lanPreview !== undefined) sandbox.lanPreview = Boolean(patch.lanPreview)
	if (patch.token !== undefined) await setToken(name, patch.token)
	await writeAll(list)
	return sandbox
}

export async function remove(name: string, deleteFiles: boolean) {
	const list = await readAll()
	await writeAll(list.filter((s) => s.name !== name))
	await fs.rm(managerDir(name), { recursive: true, force: true })
	if (deleteFiles) await fs.rm(path.join(config.dataDir, name), { recursive: true, force: true })
}

// The sandbox appends this file to the rules Claude reads (CLAUDE.local.md).
export async function writeInstructions(name: string, text: string) {
	await fs.mkdir(managerDir(name), { recursive: true })
	const f = managerDir(name, 'instructions.md')
	if (text.trim()) await fs.writeFile(f, text.trim() + '\n')
	else await fs.rm(f, { force: true })
}

// Back to the state right after "New sandbox": the project folder, the
// runtime state and Claude's session history go; the configuration, the token
// and the developer's instructions stay.
export async function resetFiles(name: string) {
	const keep = new Set(['git-token', 'instructions.md'])
	await fs.rm(path.join(config.dataDir, name), { recursive: true, force: true })
	const state = managerDir(name)
	try {
		for (const f of await fs.readdir(state)) if (!keep.has(f)) await fs.rm(path.join(state, f), { recursive: true, force: true })
	} catch {}
	await fs.rm(managerDir('claude', 'projects', `-workspace-${name}`), { recursive: true, force: true })
}

export async function setToken(name: string, token: string) {
	await fs.mkdir(managerDir(name), { recursive: true })
	const f = managerDir(name, 'git-token')
	if (token) await fs.writeFile(f, token, { mode: 0o600 })
	else await fs.rm(f, { force: true })
}

export async function hasToken(name: string) {
	try {
		return (await fs.stat(managerDir(name, 'git-token'))).size > 0
	} catch {
		return false
	}
}

export type StoppedReason = { reason: 'idle'; hours: number; at: string }
export async function setStoppedReason(name: string, r: StoppedReason | null) {
	const f = managerDir(name, 'stopped-reason.json')
	if (r) await fs.writeFile(f, JSON.stringify(r))
	else await fs.rm(f, { force: true })
}
export async function readStoppedReason(name: string): Promise<StoppedReason | null> {
	try {
		return JSON.parse(await fs.readFile(managerDir(name, 'stopped-reason.json'), 'utf8'))
	} catch {
		return null
	}
}

export async function readStatus(name: string): Promise<unknown | null> {
	try {
		return JSON.parse(await fs.readFile(managerDir(name, 'status.json'), 'utf8'))
	} catch {
		return null
	}
}
