import fs from 'node:fs/promises'
import path from 'node:path'
import { config, managerDir } from './config.js'

export type SandboxConfig = {
	name: string
	repoUrl: string
	branch: string
	hostPort: number
	autosaveMinutes: number
	createdAt: string
}

const file = () => managerDir('sandboxes.json')

export async function readAll(): Promise<SandboxConfig[]> {
	try {
		return JSON.parse(await fs.readFile(file(), 'utf8'))
	} catch {
		return []
	}
}

async function writeAll(list: SandboxConfig[]) {
	await fs.mkdir(managerDir(), { recursive: true })
	await fs.writeFile(file(), JSON.stringify(list, null, '\t') + '\n')
}

export const validName = (name: string) => /^[a-z0-9][a-z0-9-]{0,40}$/.test(name)

export async function create(input: Partial<SandboxConfig> & { name: string; token?: string }) {
	const list = await readAll()
	if (!validName(input.name)) throw new Error('Name: lowercase letters, digits and dashes only')
	if (list.some((s) => s.name === input.name)) throw new Error('A sandbox with this name exists')
	const used = new Set(list.map((s) => s.hostPort))
	let port = config.firstPort
	while (used.has(port)) port++
	const sandbox: SandboxConfig = {
		name: input.name,
		repoUrl: input.repoUrl ?? '',
		branch: input.branch || `sandbox/${input.name}`,
		hostPort: port,
		autosaveMinutes: input.autosaveMinutes ?? 10,
		createdAt: new Date().toISOString(),
	}
	await fs.mkdir(path.join(config.dataDir, sandbox.name), { recursive: true })
	await fs.mkdir(managerDir(sandbox.name), { recursive: true })
	await fs.mkdir(managerDir('claude'), { recursive: true })
	if (input.token) await setToken(sandbox.name, input.token)
	await writeAll([...list, sandbox])
	return sandbox
}

export async function update(name: string, patch: Partial<SandboxConfig> & { token?: string }) {
	const list = await readAll()
	const sandbox = list.find((s) => s.name === name)
	if (!sandbox) throw new Error('Unknown sandbox')
	if (patch.repoUrl !== undefined) sandbox.repoUrl = patch.repoUrl
	if (patch.branch) sandbox.branch = patch.branch
	if (patch.autosaveMinutes !== undefined) sandbox.autosaveMinutes = patch.autosaveMinutes
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

export async function readStatus(name: string): Promise<unknown | null> {
	try {
		return JSON.parse(await fs.readFile(managerDir(name, 'status.json'), 'utf8'))
	} catch {
		return null
	}
}
