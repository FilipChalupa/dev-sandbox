// "Is there a newer image?" Compares the digest of :latest in the registry
// with the digest of the image Docker has locally. Anonymous pull tokens are
// enough for public GHCR packages. Results are cached for ten minutes.
import { docker } from './docker.js'

type Check = { image: string; local: string; remote: string; updateAvailable: boolean; error?: string }
const cache = new Map<string, { at: number; value: Check }>()
const TTL = 10 * 60_000

const ACCEPT = [
	'application/vnd.oci.image.index.v1+json',
	'application/vnd.docker.distribution.manifest.list.v2+json',
	'application/vnd.oci.image.manifest.v1+json',
	'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

export function parse(image: string) {
	const [repoTag] = image.split('@')
	const slash = repoTag.indexOf('/')
	const registry = slash > 0 && repoTag.slice(0, slash).includes('.') ? repoTag.slice(0, slash) : 'registry-1.docker.io'
	let rest = registry === 'registry-1.docker.io' ? repoTag : repoTag.slice(slash + 1)
	let tag = 'latest'
	const colon = rest.lastIndexOf(':')
	if (colon > 0) {
		tag = rest.slice(colon + 1)
		rest = rest.slice(0, colon)
	}
	if (registry === 'registry-1.docker.io' && !rest.includes('/')) rest = `library/${rest}`
	return { registry, repo: rest, tag }
}

async function remoteDigest(image: string) {
	const { registry, repo, tag } = parse(image)
	const url = `https://${registry}/v2/${repo}/manifests/${tag}`
	let res = await fetch(url, { method: 'HEAD', headers: { Accept: ACCEPT } })
	if (res.status === 401) {
		const challenge = res.headers.get('www-authenticate') ?? ''
		const realm = /realm="([^"]+)"/.exec(challenge)?.[1]
		const service = /service="([^"]+)"/.exec(challenge)?.[1]
		if (!realm) throw new Error('registry requires authentication')
		const t = await fetch(`${realm}?service=${encodeURIComponent(service ?? '')}&scope=repository:${repo}:pull`)
		const { token } = (await t.json()) as { token?: string }
		res = await fetch(url, { method: 'HEAD', headers: { Accept: ACCEPT, Authorization: `Bearer ${token}` } })
	}
	if (!res.ok) throw new Error(`registry answered ${res.status}`)
	return res.headers.get('docker-content-digest') ?? ''
}

async function localDigest(image: string) {
	try {
		const info = await docker.getImage(image).inspect()
		const d = (info.RepoDigests ?? []).find((x) => x.startsWith(parse(image).repo) || x.includes('@'))
		return d ? d.split('@')[1] : ''
	} catch {
		return ''
	}
}

export async function check(image: string): Promise<Check> {
	const hit = cache.get(image)
	if (hit && Date.now() - hit.at < TTL) return hit.value
	let value: Check
	if (!image.includes('/')) {
		value = { image, local: '', remote: '', updateAvailable: false, error: 'local image' }
	} else {
		try {
			const [local, remote] = await Promise.all([localDigest(image), remoteDigest(image)])
			value = { image, local, remote, updateAvailable: Boolean(remote) && local !== remote }
		} catch (e) {
			value = { image, local: '', remote: '', updateAvailable: false, error: e instanceof Error ? e.message : String(e) }
		}
	}
	cache.set(image, { at: Date.now(), value })
	return value
}

export function forget(image: string) {
	cache.delete(image)
}
