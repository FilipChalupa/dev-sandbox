import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { api, type LoginState, type Sandbox } from './api'
import { LangContext, detectLang, languages, saveLang, useT, type Lang } from './i18n'
import { Terminal } from './Terminal'
import QRCode from 'qrcode'
import './style.css'

function useSandboxes() {
	const [list, setList] = useState<Sandbox[] | null>(null)
	const [error, setError] = useState('')
	const refresh = async () => {
		try {
			setList(await api.list())
			setError('')
		} catch (e) {
			setError(String(e))
		}
	}
	useEffect(() => {
		refresh()
		const id = setInterval(refresh, 4000)
		return () => clearInterval(id)
	}, [])
	return { list, error, refresh, setError }
}

function Root() {
	const [lang, setLang] = useState<Lang>(detectLang)
	useEffect(() => {
		document.documentElement.lang = lang
	}, [lang])
	const choose = (l: Lang) => {
		saveLang(l)
		setLang(l)
	}
	return (
		<LangContext.Provider value={lang}>
			<App lang={lang} onLang={choose} />
		</LangContext.Provider>
	)
}

type Modal =
	| { kind: 'create' }
	| { kind: 'edit'; s: Sandbox }
	| { kind: 'terminal'; name: string; cmd: 'shell' | 'login' | 'claude' }
	| { kind: 'logs'; name: string }
	| { kind: 'login'; name: string }
	| { kind: 'delete'; s: Sandbox }

function App({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
	const t = useT()
	const { list, error, refresh, setError } = useSandboxes()
	const [modal, setModal] = useState<Modal | null>(null)
	const [note, setNote] = useState('')
	const [lanHost, setLanHost] = useState('')
	useEffect(() => {
		api.info().then((i) => setLanHost(i.lanHost)).catch(() => {})
	}, [])
	const close = () => setModal(null)

	const run = async (fn: () => Promise<unknown>) => {
		try {
			await fn()
			await refresh()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}

	const updateImage = async () => {
		setNote(t('updating'))
		try {
			await api.update_image()
			setNote(t('updated'))
		} catch (e) {
			setNote(`${t('error')}: ${e instanceof Error ? e.message : e}`)
		}
	}

	const updateManager = async () => {
		setNote(t('updatingManager'))
		try {
			await api.self_update()
			// The manager goes away and comes back; reload once it answers again.
			const poll = setInterval(async () => {
				try {
					await api.info()
					clearInterval(poll)
					location.reload()
				} catch {}
			}, 2000)
			setTimeout(() => clearInterval(poll), 120_000)
		} catch (e) {
			setNote(`${t('error')}: ${e instanceof Error ? e.message : e}`)
		}
	}

	return (
		<main>
			<header>
				<h1>{t('title')}</h1>
				<div className="actions">
					<select className="lang" aria-label={t('language')} value={lang} onChange={(e) => onLang(e.target.value)}>
						{Object.entries(languages).map(([code, l]) => (
							<option key={code} value={code}>{l.name}</option>
						))}
					</select>
					<button onClick={updateImage}>{t('update')}</button>
					<button onClick={updateManager}>{t('updateManager')}</button>
					<button className="primary" onClick={() => setModal({ kind: 'create' })}>{t('newSandbox')}</button>
				</div>
			</header>
			{note && <p className="note">{note}</p>}
			{error && <p className="error">{t('error')}: {error}</p>}
			{list === null ? (
				<p>{t('loading')}</p>
			) : list.length === 0 ? (
				<p className="empty">{t('empty')}</p>
			) : (
				<ul className="cards">
					{list.map((s) => (
						<SandboxCard key={s.name} s={s} lanHost={lanHost} run={run} setModal={setModal} setError={setError} />
					))}
				</ul>
			)}
			{modal?.kind === 'create' && (
				<SandboxForm onCancel={close} onSubmit={async (body) => { await run(() => api.create(body)); close() }} />
			)}
			{modal?.kind === 'edit' && (
				<SandboxForm existing={modal.s} onCancel={close} onSubmit={async (body) => { await run(() => api.update(modal.s.name, body)); close() }} />
			)}
			{modal?.kind === 'terminal' && <Terminal name={modal.name} cmd={modal.cmd} onClose={close} />}
			{modal?.kind === 'logs' && <Logs name={modal.name} onClose={close} />}
			{modal?.kind === 'login' && (
				<Login
					name={modal.name}
					loggedIn={list?.find((s) => s.name === modal.name)?.status?.claude.loggedIn ?? false}
					onClose={close}
					onTerminal={() => setModal({ kind: 'terminal', name: modal.name, cmd: 'login' })}
				/>
			)}
			{modal?.kind === 'delete' && (
				<DeleteDialog s={modal.s} onCancel={close} onConfirm={async (files) => { await run(() => api.remove(modal.s.name, files)); close() }} />
			)}
		</main>
	)
}

function Qr({ text }: { text: string }) {
	const t = useT()
	const [src, setSrc] = useState('')
	useEffect(() => {
		QRCode.toDataURL(text, { margin: 1, width: 160 }).then(setSrc).catch(() => setSrc(''))
	}, [text])
	return src ? <img className="qr" src={src} alt={text} title={t('qrHint')} /> : null
}

// Basic auth in the URL, so a phone opens it without typing the password.
const withAuth = (url: string, user: string, pw: string) => url.replace(/^(https?:\/\/)/, `$1${encodeURIComponent(user)}:${encodeURIComponent(pw)}@`)

function Copy({ text }: { text: string }) {
	const t = useT()
	const [ok, setOk] = useState(false)
	return (
		<button
			className="link"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(text)
					setOk(true)
					setTimeout(() => setOk(false), 1500)
				} catch {}
			}}
		>
			{ok ? t('copied') : t('copy')}
		</button>
	)
}

function SandboxCard({ s, lanHost, run, setModal, setError }: {
	s: Sandbox
	lanHost: string
	run: (fn: () => Promise<unknown>) => Promise<void>
	setModal: (m: Modal) => void
	setError: (e: string) => void
}) {
	const t = useT()
	const [busy, setBusy] = useState<'share' | 'save' | ''>('')
	const [saved, setSaved] = useState('')
	const running = s.container.running
	const st = s.status
	const needsLogin = running && st && !st.claude.loggedIn
	const ready = running && st && st.claude.loggedIn
	const state = !running ? t('stopped') : !st ? t('starting') : needsLogin ? t('needsLogin') : t('running')
	const cls = !running ? 'off' : needsLogin || !st ? 'warn' : 'on'
	const step = !running ? 1 : needsLogin || !st ? 2 : 3

	const action = async (what: 'share' | 'unshare' | 'save' | 'restart-claude') => {
		setBusy(what === 'unshare' ? 'share' : what === 'restart-claude' ? '' : what)
		try {
			const r = await api.action(s.name, what)
			if (what === 'save') {
				setSaved(t('sent') + (r.output ? ` (${r.output.split('\n').pop()})` : ''))
				setTimeout(() => setSaved(''), 6000)
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy('')
			await run(async () => {})
		}
	}

	return (
		<li className={`card ${cls}`}>
			<div className="card-head">
				<span className={`dot ${cls}`} />
				<h2>{s.name}</h2>
				<span className="state">{state}</span>
				<span className="grow" />
				{running ? (
					<button onClick={() => run(() => api.stop(s.name))}>{t('stop')}</button>
				) : (
					<button className="primary" onClick={() => run(() => api.start(s.name))}>{t('start')}</button>
				)}
				<button onClick={() => setModal({ kind: 'edit', s })}>{t('edit')}</button>
			</div>
			<div className="meta">
				<span>{s.repoUrl ? s.repoUrl.replace(/^https?:\/\//, '') : t('noRemote')}</span>
				<span>{t('branch')}: {st?.git.branch || s.branch}</span>
				<span>{t('folder')}: ~/Sandboxes/{s.name}</span>
			</div>

			{!ready && (
				<ol className="steps">
					<li className={step > 1 ? 'done' : 'now'}>
						{step === 1 ? <button className="primary" onClick={() => run(() => api.start(s.name))}>{t('stepStart')}</button> : t('stepStart')}
					</li>
					<li className={step > 2 ? 'done' : step === 2 ? 'now' : ''}>
						{step === 2 ? <button className="primary" onClick={() => setModal({ kind: 'login', name: s.name })}>{t('stepLogin')}</button> : t('stepLogin')}
					</li>
					<li className={step === 3 ? 'now' : ''}>{t('stepOpen')}</li>
				</ol>
			)}

			{ready && st && (
				<>
					<div className="links">
						<a className="button primary" href={st.claude.sessionUrl || 'https://claude.ai/code'} target="_blank" rel="noreferrer">{t('openClaude')}</a>
						<a className="button" href={st.preview.url} target="_blank" rel="noreferrer">{t('openPreview')}</a>
						{st.preview.tunnelUrl ? (
							<button onClick={() => action('unshare')} disabled={busy === 'share'}>{t('unshare')}</button>
						) : (
							<button onClick={() => action('share')} disabled={busy === 'share'}>{busy === 'share' ? t('sharing') : t('share')}</button>
						)}
						<button onClick={() => action('save')} disabled={busy === 'save'}>{busy === 'save' ? t('sending') : t('sendToDev')}</button>
					</div>
					<div className="git">
						<span className={st.preview.devServerUp ? '' : 'muted'}>{st.preview.devServerUp ? t('devServerUp') : t('devServerDown')}</span>
						{!st.claude.serverRunning && <span className="warn-text">{t('claudeOffline')}</span>}
					</div>
					{st.preview.tunnelUrl && (
						<div className="shared">
							<Qr text={withAuth(st.preview.tunnelUrl, st.preview.user, st.preview.password)} />
							<div>
								{t('shared')}: <a href={st.preview.tunnelUrl} target="_blank" rel="noreferrer">{st.preview.tunnelUrl}</a> <Copy text={st.preview.tunnelUrl} />
								<br />
								{st.preview.user} / {t('password')}: <code>{st.preview.password}</code> <Copy text={st.preview.password} />
							</div>
						</div>
					)}
					{s.lanPreview && lanHost && (
						<div className="shared">
							<Qr text={withAuth(`http://${lanHost}:${s.lanPort}/`, st.preview.user, st.preview.password)} />
							<div>
								{t('lanUrl')}: <a href={`http://${lanHost}:${s.lanPort}/`} target="_blank" rel="noreferrer">http://{lanHost}:{s.lanPort}/</a>
								<br />
								{st.preview.user} / {t('password')}: <code>{st.preview.password}</code>
							</div>
						</div>
					)}
					<div className="git">
						{st.git.dirty > 0 && <span className="warn-text">{t('uncommitted', { n: st.git.dirty })}</span>}
						{st.git.ahead > 0 && <span className="warn-text">{t('unpushed', { n: st.git.ahead })}</span>}
						{st.git.dirty === 0 && st.git.ahead === 0 && <span>{t('clean')}</span>}
						{saved && <span className="ok-text">{saved}</span>}
						{st.git.lastCommit && <span className="muted">{t('lastCommit')}: {st.git.lastCommit}</span>}
					</div>
				</>
			)}
			<div className="tools">
				{running && <button className="link" onClick={() => setModal({ kind: 'terminal', name: s.name, cmd: 'shell' })}>{t('terminal')}</button>}
				{running && st?.claude.loggedIn && <button className="link" onClick={() => action('restart-claude')}>{t('restartClaude')}</button>}
				<button className="link" onClick={() => setModal({ kind: 'logs', name: s.name })}>{t('logs')}</button>
				<button className="link danger" onClick={() => setModal({ kind: 'delete', s })}>{t('delete')}</button>
			</div>
		</li>
	)
}

function Login({ name, loggedIn, onClose, onTerminal }: { name: string; loggedIn: boolean; onClose: () => void; onTerminal: () => void }) {
	const t = useT()
	const [state, setState] = useState<LoginState | null>(null)
	const [code, setCode] = useState('')
	const [error, setError] = useState('')
	useEffect(() => {
		let alive = true
		api.login.start(name).then((s) => alive && setState(s)).catch((e) => setError(String(e)))
		const id = setInterval(async () => {
			try {
				const s = await api.login.status(name)
				if (alive && s) setState(s)
			} catch {}
		}, 2000)
		return () => {
			alive = false
			clearInterval(id)
		}
	}, [name])
	useEffect(() => {
		if (loggedIn) {
			api.login.cancel(name).catch(() => {})
			const id = setTimeout(onClose, 1200)
			return () => clearTimeout(id)
		}
	}, [loggedIn])
	const send = async (e: FormEvent) => {
		e.preventDefault()
		try {
			setState(await api.login.code(name, code))
			setCode('')
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}
	const success = loggedIn || Boolean(state?.success)
	const failed = state?.done && !success
	useEffect(() => {
		if (state?.success && !loggedIn) {
			const id = setTimeout(onClose, 4000)
			return () => clearTimeout(id)
		}
	}, [state?.success, loggedIn])
	return (
		<div className="modal" onClick={onClose}>
			<div className="modal-body" onClick={(e) => e.stopPropagation()}>
				<h2>{t('loginTitle')}</h2>
				{success ? (
					<p className="ok-text">{loggedIn ? t('loginDone') : t('loginSuccess')}</p>
				) : failed || error ? (
					<>
						<p className="error">{t('loginFailed')} {error}</p>
						<pre className="logs small">{state?.output}</pre>
					</>
				) : !state?.url ? (
					<p>{t('loginWaiting')}</p>
				) : (
					<>
						<p>{t('loginIntro')}</p>
						<a className="button primary" href={state.url} target="_blank" rel="noreferrer">{t('loginOpen')}</a>
						{state.invalidCode && <p className="error">{t('loginInvalidCode')}</p>}
						<form onSubmit={send} className="row">
							<input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('loginCode')} autoFocus />
							<button type="submit" className="primary" disabled={!code.trim()}>{t('loginSend')}</button>
						</form>
					</>
				)}
				<div className="actions">
					<button className="link" onClick={onTerminal}>{t('terminal')}</button>
					<button onClick={onClose}>{t('close')}</button>
				</div>
			</div>
		</div>
	)
}

function Logs({ name, onClose }: { name: string; onClose: () => void }) {
	const t = useT()
	const [text, setText] = useState('')
	const pre = useRef<HTMLPreElement>(null)
	useEffect(() => {
		const proto = location.protocol === 'https:' ? 'wss' : 'ws'
		const ws = new WebSocket(`${proto}://${location.host}/api/sandboxes/${name}/logs/stream`)
		ws.onmessage = (ev) => setText((old) => (old + ev.data).slice(-200_000))
		return () => ws.close()
	}, [name])
	useEffect(() => {
		pre.current?.scrollTo(0, pre.current.scrollHeight)
	}, [text])
	return (
		<div className="modal" onClick={onClose}>
			<div className="modal-body wide" onClick={(e) => e.stopPropagation()}>
				<h2>{t('logs')}: {name} <span className="muted small">({t('logLive')})</span></h2>
				<pre ref={pre} className="logs">{text || '…'}</pre>
				<div className="actions"><button onClick={onClose}>{t('close')}</button></div>
			</div>
		</div>
	)
}

function DeleteDialog({ s, onCancel, onConfirm }: { s: Sandbox; onCancel: () => void; onConfirm: (files: boolean) => Promise<void> }) {
	const t = useT()
	const [files, setFiles] = useState(false)
	return (
		<div className="modal" onClick={onCancel}>
			<div className="modal-body" onClick={(e) => e.stopPropagation()}>
				<h2>{t('deleteTitle')}</h2>
				<p>{t('deleteText', { name: s.name })}</p>
				<label className="check">
					<input type="checkbox" checked={files} onChange={(e) => setFiles(e.target.checked)} /> {t('deleteFiles')}
				</label>
				<div className="actions">
					<button onClick={onCancel}>{t('cancel')}</button>
					<button className="danger-btn" onClick={() => onConfirm(files)}>{t('delete')}</button>
				</div>
			</div>
		</div>
	)
}

function SandboxForm({ existing, onSubmit, onCancel }: { existing?: Sandbox; onSubmit: (body: object) => Promise<void>; onCancel: () => void }) {
	const t = useT()
	const [name, setName] = useState(existing?.name ?? '')
	const [repoUrl, setRepoUrl] = useState(existing?.repoUrl ?? '')
	const [token, setToken] = useState('')
	const [branch, setBranch] = useState(existing?.branch ?? '')
	const [autostart, setAutostart] = useState(existing?.autostart ?? false)
	const [memoryGb, setMemoryGb] = useState(existing?.memoryGb ?? 4)
	const [cpus, setCpus] = useState(existing?.cpus ?? 2)
	const [idleStopHours, setIdleStopHours] = useState(existing?.idleStopHours ?? 4)
	const [lanPreview, setLanPreview] = useState(existing?.lanPreview ?? false)
	const [busy, setBusy] = useState(false)
	const submit = async (e: FormEvent) => {
		e.preventDefault()
		setBusy(true)
		const body: Record<string, unknown> = { repoUrl, branch: branch || undefined, autostart, memoryGb, cpus, idleStopHours, lanPreview }
		if (!existing) body.name = name
		if (token) body.token = token
		await onSubmit(body)
		setBusy(false)
	}
	return (
		<div className="modal" onClick={onCancel}>
			<form className="modal-body" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
				<h2>{existing ? `${t('edit')}: ${existing.name}` : t('newSandbox')}</h2>
				{!existing && (
					<label>
						{t('name')}
						<input value={name} onChange={(e) => setName(e.target.value)} required pattern="[a-z0-9][a-z0-9-]*" autoFocus />
						<small>{t('nameHint')}</small>
					</label>
				)}
				<label>
					{t('repoUrl')}
					<input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://bitbucket.org/workspace/repo.git" />
					<small>{t('repoHint')}</small>
				</label>
				<label>
					{t('token')}
					<input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder={existing?.hasToken ? '••••••••' : ''} />
					<small>{existing?.hasToken ? t('tokenSet') : t('tokenHint')}</small>
				</label>
				<label>
					{t('branch')}
					<input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={`sandbox/${name || 'name'}`} />
				</label>
				<label className="check">
					<input type="checkbox" checked={autostart} onChange={(e) => setAutostart(e.target.checked)} /> {t('autostart')}
				</label>
				<label className="check">
					<input type="checkbox" checked={lanPreview} onChange={(e) => setLanPreview(e.target.checked)} /> {t('lanPreview')}
				</label>
				<div className="grid3">
					<label>
						{t('memory')}
						<input type="number" min={1} step={1} value={memoryGb} onChange={(e) => setMemoryGb(Number(e.target.value))} />
					</label>
					<label>
						{t('cpus')}
						<input type="number" min={0.5} step={0.5} value={cpus} onChange={(e) => setCpus(Number(e.target.value))} />
					</label>
					<label>
						{t('idleStop')}
						<input type="number" min={0} step={1} value={idleStopHours} onChange={(e) => setIdleStopHours(Number(e.target.value))} />
					</label>
				</div>
				<div className="actions">
					<button type="button" onClick={onCancel}>{t('cancel')}</button>
					<button type="submit" className="primary" disabled={busy}>{existing ? t('save') : t('create')}</button>
				</div>
			</form>
		</div>
	)
}

createRoot(document.getElementById('root')!).render(<Root />)
