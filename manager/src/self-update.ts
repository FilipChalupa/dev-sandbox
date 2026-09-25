// Runs in a helper container: replaces the manager container with a new one
// of the same configuration, from the image that is now current locally.
import Docker from 'dockerode'

const docker = new Docker()
const spec = JSON.parse(process.env.SPEC ?? '{}')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

await wait(1500) // let the HTTP response reach the browser
try {
	await docker.getContainer(spec.name).remove({ force: true })
} catch (e: any) {
	if (e?.statusCode !== 404) throw e
}
// The spec may come from an older manager that passed the whole environment;
// keep only what was given at `docker run` so the image's own ENV applies.
const keep = new Set(['SANDBOXES_HOST_DIR', 'SANDBOXES_DATA_DIR', 'SANDBOX_IMAGE', 'SANDBOX_FIRST_PORT', 'HOST_LAN_NAME', 'PORT'])
const env = (spec.env as string[] ?? []).filter((e) => keep.has(e.split('=')[0]))
const c = await docker.createContainer({
	name: spec.name,
	Image: spec.image,
	Env: env,
	ExposedPorts: spec.exposed,
	HostConfig: { Binds: spec.binds, PortBindings: spec.ports, RestartPolicy: spec.restart },
})
await c.start()
console.log('manager replaced')
