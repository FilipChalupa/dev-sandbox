// Facts about the host machine that a container cannot find out on its own.
// The installer sets up a small launchd job on the Mac that writes host.json
// (LAN address, name) every minute into the mounted .manager directory.
import fs from 'node:fs/promises'
import { config, managerDir } from './config.js'

export type LanAddress = { iface: string; label: string; ip: string }
export type HostInfo = { lanIp: string; lanIps: LanAddress[]; hostName: string; updatedAt: string; helper: boolean }

export async function hostInfo(): Promise<HostInfo> {
	try {
		const h = JSON.parse(await fs.readFile(managerDir('host.json'), 'utf8')) as Partial<HostInfo>
		const lanIps = Array.isArray(h.lanIps) ? h.lanIps : h.lanIp ? [{ iface: '', label: '', ip: h.lanIp }] : []
		// The helper rewrites host.json every minute; an old file means it is gone.
		const fresh = Boolean(h.helper) && Date.now() - Date.parse(h.updatedAt ?? '') < 3 * 60_000
		return { lanIp: h.lanIp ?? lanIps[0]?.ip ?? '', lanIps, hostName: h.hostName ?? config.hostLanName, updatedAt: h.updatedAt ?? '', helper: fresh }
	} catch {
		return { lanIp: '', lanIps: [], hostName: config.hostLanName, updatedAt: '', helper: false }
	}
}

// Ask the host helper to open a path or URL on the Mac. Returns false when
// no helper is running (the UI then falls back to copying the path).
export async function openOnHost(target: string) {
	if (!(await hostInfo()).helper) return false
	await fs.mkdir(managerDir('open'), { recursive: true })
	await fs.writeFile(managerDir('open', `${Date.now()}-${Math.random().toString(36).slice(2)}`), target + '\n')
	return true
}

// Candidate hosts for the phone link, best first; the Bonjour name last as a fallback.
export async function lanHosts(): Promise<{ host: string; label: string }[]> {
	const h = await hostInfo()
	const list = h.lanIps.map((a) => ({ host: a.ip, label: a.label || a.iface || a.ip }))
	if (h.hostName) list.push({ host: h.hostName, label: h.hostName })
	return list
}
