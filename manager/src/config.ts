import os from 'node:os'
import path from 'node:path'

// Where the sandboxes live on the host (what Docker bind-mounts) and where the
// same directory is mounted inside the manager container (what we read).
// Running outside Docker, both are ~/Sandboxes.
const defaultDir = path.join(os.homedir(), 'Sandboxes')

export const config = {
	port: Number(process.env.PORT ?? 8787),
	hostDir: process.env.SANDBOXES_HOST_DIR ?? defaultDir,
	dataDir: process.env.SANDBOXES_DATA_DIR ?? process.env.SANDBOXES_HOST_DIR ?? defaultDir,
	image: process.env.SANDBOX_IMAGE ?? 'ghcr.io/filipchalupa/dev-sandbox:latest',
	firstPort: Number(process.env.SANDBOX_FIRST_PORT ?? 3001),
	// The host's name on the local network (Bonjour name on a Mac), set by the
	// installer. Phones on the same Wi-Fi resolve it. Empty = LAN link hidden.
	hostLanName: process.env.HOST_LAN_NAME ?? '',
	containerPrefix: 'sandbox-',
	label: 'dev-sandbox.name',
}

export const managerDir = (...p: string[]) => path.join(config.dataDir, '.manager', ...p)
export const hostManagerDir = (...p: string[]) => path.posix.join(config.hostDir, '.manager', ...p)
