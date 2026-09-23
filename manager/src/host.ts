// Facts about the host machine that a container cannot find out on its own.
// The installer sets up a small launchd job on the Mac that writes host.json
// (LAN address, name) every minute into the mounted .manager directory.
import fs from 'node:fs/promises'
import { config, managerDir } from './config.js'

export type LanAddress = { iface: string; label: string; ip: string }
export type HostInfo = { lanIp: string; lanIps: LanAddress[]; hostName: string; updatedAt: string }

export async function hostInfo(): Promise<HostInfo> {
	try {
		const h = JSON.parse(await fs.readFile(managerDir('host.json'), 'utf8')) as Partial<HostInfo>
		const lanIps = Array.isArray(h.lanIps) ? h.lanIps : h.lanIp ? [{ iface: '', label: '', ip: h.lanIp }] : []
		return { lanIp: h.lanIp ?? lanIps[0]?.ip ?? '', lanIps, hostName: h.hostName ?? config.hostLanName, updatedAt: h.updatedAt ?? '' }
	} catch {
		return { lanIp: '', lanIps: [], hostName: config.hostLanName, updatedAt: '' }
	}
}

// Candidate hosts for the phone link, best first; the Bonjour name last as a fallback.
export async function lanHosts(): Promise<{ host: string; label: string }[]> {
	const h = await hostInfo()
	const list = h.lanIps.map((a) => ({ host: a.ip, label: a.label || a.iface || a.ip }))
	if (h.hostName) list.push({ host: h.hostName, label: h.hostName })
	return list
}
