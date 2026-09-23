// Facts about the host machine that a container cannot find out on its own.
// The installer sets up a small launchd job on the Mac that writes host.json
// (LAN address, name) every minute into the mounted .manager directory.
import fs from 'node:fs/promises'
import { config, managerDir } from './config.js'

export type HostInfo = { lanIp: string; hostName: string; updatedAt: string }

export async function hostInfo(): Promise<HostInfo> {
	try {
		const h = JSON.parse(await fs.readFile(managerDir('host.json'), 'utf8')) as Partial<HostInfo>
		return { lanIp: h.lanIp ?? '', hostName: h.hostName ?? config.hostLanName, updatedAt: h.updatedAt ?? '' }
	} catch {
		return { lanIp: '', hostName: config.hostLanName, updatedAt: '' }
	}
}
