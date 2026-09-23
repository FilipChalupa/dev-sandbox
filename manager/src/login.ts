// Claude login without a terminal: run `claude auth login` in the sandbox,
// show the person the OAuth link, and pass the code they paste back in.
import { exec } from './docker.js'

type Session = {
	url: string
	output: string
	done: boolean
	error: string
	stream?: Awaited<ReturnType<typeof exec>>
	startedAt: number
}

const sessions = new Map<string, Session>()

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '')

export function status(name: string) {
	const s = sessions.get(name)
	if (!s) return null
	const tail = s.output.slice(-300)
	return { url: s.url, done: s.done, error: s.error, invalidCode: /Invalid code/i.test(tail), output: s.output.slice(-2000) }
}

export async function start(name: string) {
	const old = sessions.get(name)
	if (old && !old.done && Date.now() - old.startedAt < 10 * 60_000) return status(name)
	old?.stream?.stream.end()
	const s: Session = { url: '', output: '', done: false, error: '', startedAt: Date.now() }
	sessions.set(name, s)
	try {
		s.stream = await exec(name, ['claude', 'auth', 'login', '--claudeai'], 120, 40)
	} catch (e) {
		s.done = true
		s.error = e instanceof Error ? e.message : String(e)
		return status(name)
	}
	s.stream.stream.on('data', (chunk: Buffer) => {
		s.output += stripAnsi(chunk.toString('utf8'))
		if (!s.url) {
			// The link is long and may be wrapped by the terminal: join lines first.
			const flat = s.output.replace(/\n/g, '')
			const m = flat.match(/https:\/\/[^\s"'<>]*oauth[^\s"'<>]*/)
			if (m) s.url = m[0]
		}
		if (/logged in|login successful|successfully/i.test(s.output.slice(-400))) s.done = true
	})
	s.stream.stream.on('end', () => {
		s.done = true
	})
	// Give the CLI a moment to print the link.
	for (let i = 0; i < 60 && !s.url && !s.done; i++) await new Promise((r) => setTimeout(r, 250))
	return status(name)
}

export function code(name: string, value: string) {
	const s = sessions.get(name)
	if (!s?.stream || s.done) throw new Error('No login in progress')
	s.stream.stream.write(value.trim() + '\r')
	return status(name)
}

export function cancel(name: string) {
	const s = sessions.get(name)
	s?.stream?.stream.end()
	sessions.delete(name)
}
