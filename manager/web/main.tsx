import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import QRCode from 'qrcode'
import { Loading, SharedLoadingIndicatorContextProvider, SharedProgressLoadingIndicator, useLocalLoading, useMirrorLoading } from 'shared-loading-indicator'
import { api, type LoginState, type Sandbox, type UpdateCheck, type UpdateProgress } from './api'
import { LangContext, detectLang, languages, saveLang, useT, type Lang } from './i18n'
import { Terminal } from './Terminal'
import { Icon, Menu, Modal, Pill, Rel, Skeleton, ToastProvider, humanizeError, isRecent, useToast } from './ui'
import './style.css'

// ---------------------------------------------------------------- data

function useSandboxes() {
	const [list, setList] = useState<Sandbox[] | null>(null)
	const [offline, setOffline] = useState(false)
	const refresh = async () => {
		try {
			setList(await api.list())
			setOffline(false)
		} catch {
			setOffline(true)
		}
	}
	useEffect(() => {
		refresh()
		const id = setInterval(refresh, 4000)
		return () => clearInterval(id)
	}, [])
	return { list, offline, refresh }
}

type Modal =
	| { kind: 'create'; initial?: Partial<Sandbox> & { token?: string } }
	| { kind: 'edit'; s: Sandbox }
	| { kind: 'terminal'; name: string; cmd: 'shell' | 'login' | 'claude' }
	| { kind: 'logs'; name: string }
	| { kind: 'login'; name: string }
	| { kind: 'delete'; s: Sandbox }
	| { kind: 'diagnostics' }
	| { kind: 'changes'; name: string }
	| { kind: 'qr'; text: string; title: string }

// Which of the three steps a sandbox is on, and whether the person has to act.
function stageOf(s: Sandbox) {
	if (!s.container.running) return { step: 1, tone: 'off' as const, attention: false }
	if (!s.status) return { step: 2, tone: 'warn' as const, attention: false, starting: true }
	if (!s.status.claude.loggedIn) return { step: 2, tone: 'warn' as const, attention: true }
	return { step: 3, tone: 'on' as const, attention: false }
}

// ---------------------------------------------------------------- root

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
			<SharedLoadingIndicatorContextProvider>
				<ToastProvider>
					<SharedProgressLoadingIndicator />
					<App lang={lang} onLang={choose} />
				</ToastProvider>
			</SharedLoadingIndicatorContextProvider>
		</LangContext.Provider>
	)
}

function App({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
	const t = useT()
	const { toast } = useToast()
	const { list, offline, refresh } = useSandboxes()
	const [modal, setModal] = useState<Modal | null>(null)
	const [, setBusy] = useLocalLoading()
	const [lanHosts, setLanHosts] = useState<{ host: string; label: string }[]>([])
	const [lanChoice, setLanChoice] = useState(() => {
		try {
			return localStorage.getItem('sandbox-manager.lanHost') ?? ''
		} catch {
			return ''
		}
	})
	const lanHost = lanHosts.find((h) => h.host === lanChoice)?.host ?? lanHosts[0]?.host ?? ''
	const chooseLan = (host: string) => {
		setLanChoice(host)
		try {
			localStorage.setItem('sandbox-manager.lanHost', host)
		} catch {}
	}
	const [updates, setUpdates] = useState<{ sandbox: UpdateCheck; manager: UpdateCheck | null } | null>(null)
	const [progress, setProgress] = useState<UpdateProgress | null>(null)
	const close = () => setModal(null)

	useEffect(() => {
		const load = () => {
			api.info().then((i) => setLanHosts(i.lanHosts ?? [])).catch(() => {})
			api.updates().then(setUpdates).catch(() => {})
		}
		load()
		const id = setInterval(load, 10 * 60_000)
		return () => clearInterval(id)
	}, [])

	// Invite link: #new?name=…&repo=…&token=…&branch=… pre-fills the form.
	useEffect(() => {
		if (!location.hash.startsWith('#new')) return
		const q = new URLSearchParams(location.hash.replace(/^#new\??/, ''))
		setModal({ kind: 'create', initial: { name: q.get('name') ?? '', repoUrl: q.get('repo') ?? '', branch: q.get('branch') ?? '', token: q.get('token') ?? '' } })
		history.replaceState(null, '', location.pathname)
	}, [])

	// Title and favicon say when something waits for the person.
	const attention = useMemo(() => (list ?? []).some((s) => stageOf(s).attention), [list])
	useEffect(() => {
		document.title = (attention ? '● ' : '') + t('title')
		setFavicon(attention ? '#d97706' : list?.some((s) => s.container.running) ? '#16a34a' : '#9ca3af')
	}, [attention, list, lang])

	const run = async (fn: () => Promise<unknown>, okText?: string) => {
		setBusy(true)
		try {
			await fn()
			await refresh()
			if (okText) toast('ok', okText)
		} catch (e) {
			toast('error', humanizeError(e instanceof Error ? e.message : String(e), t))
		} finally {
			setBusy(false)
		}
	}

	const updateImage = async () => {
		setBusy(true)
		try {
			let p = await api.update_image()
			setProgress(p)
			while (!p.done) {
				await new Promise((r) => setTimeout(r, 1000))
				p = await api.update_progress()
				setProgress(p)
			}
			if (p.error) toast('error', humanizeError(p.error, t))
			else toast('ok', t('updated'))
			api.updates().then(setUpdates).catch(() => {})
		} catch (e) {
			toast('error', humanizeError(e instanceof Error ? e.message : String(e), t))
		} finally {
			setBusy(false)
			setTimeout(() => setProgress(null), 1500)
		}
	}

	const updateManager = async () => {
		setBusy(true)
		toast('info', t('updatingManager'))
		try {
			await api.self_update()
			const poll = setInterval(async () => {
				try {
					await api.info()
					clearInterval(poll)
					location.reload()
				} catch {}
			}, 2000)
			setTimeout(() => {
				clearInterval(poll)
				setBusy(false)
			}, 120_000)
		} catch (e) {
			toast('error', humanizeError(e instanceof Error ? e.message : String(e), t))
			setBusy(false)
		}
	}

	const sorted = useMemo(
		() => (list ? [...list].sort((a, b) => Number(b.container.running) - Number(a.container.running) || a.name.localeCompare(b.name)) : null),
		[list],
	)

	return (
		<main>
			<header>
				<h1><Icon name="bolt" size={22} /> {t('title')}</h1>
				<div className="actions">
					<Menu
						icon="settings"
						badge={Boolean(updates?.sandbox.updateAvailable || updates?.manager?.updateAvailable)}
						items={[
							{ label: t('update'), icon: 'refresh', onClick: updateImage, badge: updates?.sandbox.updateAvailable },
							{ label: t('updateManager'), icon: 'restart', onClick: updateManager, badge: updates?.manager?.updateAvailable },
							{ label: t('diagnostics'), icon: 'stethoscope', onClick: () => setModal({ kind: 'diagnostics' }) },
							'sep',
							{
								custom: (
									<label className="menu-lang">
										<Icon name="language" />
										<select value={lang} onChange={(e) => onLang(e.target.value)} aria-label={t('language')}>
											{Object.entries(languages).map(([code, l]) => <option key={code} value={code}>{l.name}</option>)}
										</select>
									</label>
								),
							},
						]}
					/>
					<button className="primary" onClick={() => setModal({ kind: 'create' })}><Icon name="plus" /> {t('newSandbox')}</button>
				</div>
			</header>

			{progress && (
				<div className="progress-box">
					<div className="progress-bar"><div style={{ width: `${progress.percent}%` }} /></div>
					<div className="muted small">{t('updateProgress')} {progress.percent}% · {progress.lines[progress.lines.length - 1] ?? ''}</div>
				</div>
			)}
			{offline && <p className="offline"><Icon name="alert" /> {t('errDocker')}</p>}

			{sorted === null ? (
				<>
					<Loading />
					<Skeleton />
				</>
			) : sorted.length === 0 ? (
				<Welcome onCreate={() => setModal({ kind: 'create' })} />
			) : (
				<ul className="cards">
					{sorted.map((s) => (
						<SandboxCard key={s.name} s={s} lang={lang} lanHost={lanHost} lanHosts={lanHosts} onLanHost={chooseLan} run={run} setModal={setModal} />
					))}
				</ul>
			)}

			{modal?.kind === 'create' && (
				<SandboxForm initial={modal.initial} onCancel={close} onSubmit={async (body) => { await run(() => api.create(body)); close() }} />
			)}
			{modal?.kind === 'edit' && (
				<SandboxForm existing={modal.s} onCancel={close} onSubmit={async (body) => { await run(() => api.update(modal.s.name, body), t('sent')); close() }} />
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
			{modal?.kind === 'diagnostics' && <Diagnostics lang={lang} onClose={close} />}
			{modal?.kind === 'changes' && <Changes s={list?.find((x) => x.name === modal.name)} name={modal.name} onClose={close} />}
			{modal?.kind === 'qr' && (
				<Modal title={modal.title} onClose={close}>
					<Qr text={modal.text} size={360} />
				</Modal>
			)}
			{modal?.kind === 'delete' && (
				<DeleteDialog s={modal.s} onCancel={close} onConfirm={async (files) => { await run(() => api.remove(modal.s.name, files)); close() }} />
			)}
		</main>
	)
}

function setFavicon(color: string) {
	const c = document.createElement('canvas')
	c.width = c.height = 32
	const ctx = c.getContext('2d')!
	ctx.beginPath()
	ctx.arc(16, 16, 12, 0, Math.PI * 2)
	ctx.fillStyle = color
	ctx.fill()
	let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
	if (!link) {
		link = document.createElement('link')
		link.rel = 'icon'
		document.head.appendChild(link)
	}
	link.href = c.toDataURL('image/png')
}

// ---------------------------------------------------------------- pieces

function Qr({ text, size = 160, onClick }: { text: string; size?: number; onClick?: () => void }) {
	const t = useT()
	const [src, setSrc] = useState('')
	useEffect(() => {
		QRCode.toDataURL(text, { margin: 1, width: size }).then(setSrc).catch(() => setSrc(''))
	}, [text, size])
	if (!src) return null
	return <img className={`qr${onClick ? ' clickable' : ''}`} src={src} alt={text} title={onClick ? t('enlargeQr') : t('qrHint')} onClick={onClick} style={{ width: size > 200 ? size : undefined, height: size > 200 ? size : undefined }} />
}

const withAuth = (url: string, user: string, pw: string) => url.replace(/^(https?:\/\/)/, `$1${encodeURIComponent(user)}:${encodeURIComponent(pw)}@`)

function Copy({ text, label, icon = true }: { text: string; label?: string; icon?: boolean }) {
	const t = useT()
	const { toast } = useToast()
	const [ok, setOk] = useState(false)
	return (
		<button
			className="link"
			title={t('copy')}
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(text)
					setOk(true)
					toast('ok', t('copied'))
					setTimeout(() => setOk(false), 1500)
				} catch {}
			}}
		>
			{icon && <Icon name={ok ? 'check' : 'copy'} size={14} />}
			{label ?? (icon ? '' : t('copy'))}
		</button>
	)
}

function Access({ title, icon, url, user, password, extra, onQr }: { title: string; icon: string; url: string; user: string; password: string; extra?: ReactNode; onQr: (text: string) => void }) {
	const t = useT()
	const full = withAuth(url, user, password)
	return (
		<div className="access">
			<Qr text={full} size={112} onClick={() => onQr(full)} />
			<div className="access-rows">
				<div className="access-title"><Icon name={icon} /> {title}{extra}</div>
				<div className="access-row"><span className="k">{t('address')}</span><a className="v" href={url} target="_blank" rel="noreferrer">{url}</a><Copy text={url} /></div>
				<div className="access-row"><span className="k">{t('user')}</span><code className="v">{user}</code><Copy text={user} /></div>
				<div className="access-row"><span className="k">{t('passwordLabel')}</span><code className="v">{password}</code><Copy text={password} /></div>
				<div className="access-row"><span className="k" /><Copy text={full} label={t('copyLinkWithPassword')} /></div>
			</div>
		</div>
	)
}

function Welcome({ onCreate }: { onCreate: () => void }) {
	const t = useT()
	return (
		<section className="welcome">
			<Icon name="bolt" size={40} />
			<h2>{t('welcomeTitle')}</h2>
			<p>{t('welcomeText')}</p>
			<ol>
				<li>{t('welcomeStep1')}</li>
				<li>{t('welcomeStep2')}</li>
				<li>{t('welcomeStep3')}</li>
			</ol>
			<button className="primary big" onClick={onCreate}><Icon name="plus" /> {t('newSandbox')}</button>
			<p className="muted small">{t('dockerHint')}</p>
		</section>
	)
}

// ---------------------------------------------------------------- card

function SandboxCard({ s, lang, lanHost, lanHosts, onLanHost, run, setModal }: {
	s: Sandbox
	lang: string
	lanHost: string
	lanHosts: { host: string; label: string }[]
	onLanHost: (host: string) => void
	run: (fn: () => Promise<unknown>, okText?: string) => Promise<void>
	setModal: (m: Modal) => void
}) {
	const t = useT()
	const { toast } = useToast()
	const st = s.status
	const stage = stageOf(s)
	const running = s.container.running
	const [busy, setBusy] = useState<'share' | 'save' | ''>('')
	useMirrorLoading(busy !== '')
	const [expanded, setExpanded] = useState<boolean | null>(null)
	const open = expanded ?? running
	const working = Boolean(st && isRecent(st.lastActivity, 60_000))

	const action = async (what: 'share' | 'unshare' | 'save' | 'restart-claude') => {
		setBusy(what === 'unshare' ? 'share' : what === 'restart-claude' ? '' : what)
		try {
			const r = await api.action(s.name, what)
			if (what === 'save') toast('ok', `${t('sent')} (${r.output.split('\n').pop()})`)
			if (what === 'restart-claude') toast('ok', r.output)
		} catch (e) {
			toast('error', humanizeError(e instanceof Error ? e.message : String(e), t))
		} finally {
			setBusy('')
			await run(async () => {})
		}
	}

	const statusPill =
		!running ? <Pill tone="off">{t('stopped')}</Pill>
		: stage.starting ? <Pill tone="warn" pulse>{t('starting')}</Pill>
		: stage.attention ? <Pill tone="warn">{t('needsLogin')}</Pill>
		: working ? <Pill tone="work" pulse>{t('claudeWorking')}</Pill>
		: <Pill tone="on">{t('running')}</Pill>

	const primary =
		!running ? <button className="primary" onClick={() => run(() => api.start(s.name))}><Icon name="play" /> {t('start')}</button>
		: stage.attention ? <button className="primary" onClick={() => setModal({ kind: 'login', name: s.name })}><Icon name="login" /> {t('loginClaude')}</button>
		: st ? <a className="button primary" href={st.claude.sessionUrl || 'https://claude.ai/code'} target="_blank" rel="noreferrer"><Icon name="external" /> {t('openClaude')}</a>
		: null

	const menuItems = [
		...(running ? [{ label: t('stop'), icon: 'stop', onClick: () => run(() => api.stop(s.name)) }] : []),
		{ label: t('edit'), icon: 'settings', onClick: () => setModal({ kind: 'edit', s }) },
		{ label: t('changesToday'), icon: 'history', onClick: () => setModal({ kind: 'changes', name: s.name }), disabled: !running },
		'sep' as const,
		{ label: t('terminal'), icon: 'terminal', onClick: () => setModal({ kind: 'terminal', name: s.name, cmd: 'shell' }), disabled: !running },
		{ label: t('restartClaude'), icon: 'restart', onClick: () => action('restart-claude'), disabled: !running },
		{ label: t('logs'), icon: 'log', onClick: () => setModal({ kind: 'logs', name: s.name }) },
		'sep' as const,
		{ label: t('delete'), icon: 'trash', onClick: () => setModal({ kind: 'delete', s }), danger: true },
	]

	return (
		<li className={`card ${stage.tone}${open ? '' : ' collapsed'}`}>
			<div className="card-head">
				<button className="icon-btn chevron" onClick={() => setExpanded(!open)} aria-label={open ? t('collapse') : t('expand')} aria-expanded={open}>
					<Icon name="chevron" />
				</button>
				<h2>{s.name}</h2>
				{statusPill}
				{running && st && stage.step === 3 && (
					<Pill tone={st.preview.devServerUp ? 'on' : 'off'}>{st.preview.devServerUp ? t('devServerUp') : t('devServerDown')}</Pill>
				)}
				{running && st && !st.claude.serverRunning && stage.step === 3 && <Pill tone="error">{t('claudeOffline')}</Pill>}
				<span className="grow" />
				{primary}
				<Menu icon="more" label={undefined} items={menuItems} />
			</div>

			{open && (
				<>
					<div className="meta">
						<span><Icon name="git" size={13} /> {s.repoUrl ? s.repoUrl.replace(/^https?:\/\//, '') : t('noRemote')}</span>
						<span>{t('branch')}: <code>{st?.git.branch || s.branch}</code></span>
						<span><Icon name="folder" size={13} /> ~/Sandboxes/{s.name}</span>
					</div>

					{stage.step < 3 && (
						<ol className="steps">
							<li className={stage.step > 1 ? 'done' : 'now'}>{t('stepStart')}</li>
							<li className={stage.step === 2 ? 'now' : ''}>{t('stepLogin')}{stage.starting && <span className="muted"> · {t('startingHint')}</span>}</li>
							<li>{t('stepOpen')}</li>
						</ol>
					)}

					{stage.step === 3 && st && (
						<>
							<div className="links">
								<a className="button" href={st.preview.url} target="_blank" rel="noreferrer"><Icon name="globe" /> {t('openPreview')}</a>
								{st.preview.tunnelUrl ? (
									<button onClick={() => action('unshare')} disabled={busy === 'share'}><Icon name="x" /> {t('unshare')}</button>
								) : (
									<button onClick={() => action('share')} disabled={busy === 'share'}><Icon name="share" /> {busy === 'share' ? t('sharing') : t('share')}</button>
								)}
								<button onClick={() => action('save')} disabled={busy === 'save'}><Icon name="send" /> {busy === 'save' ? t('sending') : t('sendToDev')}</button>
							</div>
							{st.preview.tunnelUrl && (
								<Access title={t('shared')} icon="globe" url={st.preview.tunnelUrl} user={st.preview.user} password={st.preview.password} onQr={(text) => setModal({ kind: 'qr', text, title: t('shared') })} />
							)}
							{s.lanPreview && lanHost && (
								<Access
									title={t('lanUrl')}
									icon="phone"
									url={`http://${lanHost}:${s.lanPort}/`}
									user={st.preview.user}
									password={st.preview.password}
									onQr={(text) => setModal({ kind: 'qr', text, title: t('lanUrl') })}
									extra={lanHosts.length > 1 && (
										<select className="inline" value={lanHost} onChange={(e) => onLanHost(e.target.value)} aria-label={t('lanIp')}>
											{lanHosts.map((h) => <option key={h.host} value={h.host}>{h.label === h.host ? h.host : `${h.label} (${h.host})`}</option>)}
										</select>
									)}
								/>
							)}
							<div className="git">
								{st.git.dirty > 0 && <span className="warn-text">{t('uncommitted', { n: st.git.dirty })}</span>}
								{st.git.ahead > 0 && <span className="warn-text">{t('unpushed', { n: st.git.ahead })}</span>}
								{st.git.dirty === 0 && st.git.ahead === 0 && <span className="ok-text"><Icon name="check" size={13} /> {t('clean')}</span>}
								{st.git.lastCommit && <span className="muted">{t('lastCommit')}: {st.git.lastCommit}</span>}
								{st.lastActivity && <span className="muted">{t('lastActivity')}: <Rel iso={st.lastActivity} lang={lang} /></span>}
							</div>
						</>
					)}
				</>
			)}
		</li>
	)
}

// ---------------------------------------------------------------- dialogs

function Login({ name, loggedIn, onClose, onTerminal }: { name: string; loggedIn: boolean; onClose: () => void; onTerminal: () => void }) {
	const t = useT()
	const [state, setState] = useState<LoginState | null>(null)
	const [code, setCode] = useState('')
	const [error, setError] = useState('')
	const [sentAt, setSentAt] = useState(0)
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
	const success = loggedIn || Boolean(state?.success)
	const failed = state?.done && !success
	useMirrorLoading(!success && !failed && !error && (!state?.url || (sentAt > 0 && Date.now() - sentAt < 15_000 && !state?.invalidCode)))
	useEffect(() => {
		if (success) {
			if (loggedIn) api.login.cancel(name).catch(() => {})
			const id = setTimeout(onClose, loggedIn ? 1200 : 4000)
			return () => clearTimeout(id)
		}
	}, [success, loggedIn])
	const send = async (e: FormEvent) => {
		e.preventDefault()
		try {
			setSentAt(Date.now())
			setState(await api.login.code(name, code))
			setCode('')
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}
	return (
		<Modal title={<><Icon name="login" /> {t('loginTitle')}</>} onClose={onClose}>
			{success ? (
				<p className="ok-text big-note"><Icon name="check" /> {loggedIn ? t('loginDone') : t('loginSuccess')}</p>
			) : failed || error ? (
				<>
					<p className="error">{t('loginFailed')} {error}</p>
					<pre className="logs small">{state?.output}</pre>
				</>
			) : (
				<ol className="login-steps">
					<li>
						<span className="n">1</span>
						<div>
							<div>{t('loginStep1')}</div>
							{state?.url ? (
								<a className="button primary" href={state.url} target="_blank" rel="noreferrer"><Icon name="external" /> {t('loginOpen')}</a>
							) : (
								<span className="muted">{t('loginWaiting')}</span>
							)}
						</div>
					</li>
					<li><span className="n">2</span><div>{t('loginStep2')}</div></li>
					<li>
						<span className="n">3</span>
						<div>
							<div>{t('loginStep3')}</div>
							{state?.invalidCode && <p className="error">{t('loginInvalidCode')}</p>}
							<form onSubmit={send} className="row">
								<input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('loginCode')} disabled={!state?.url} />
								<button type="submit" className="primary" disabled={!code.trim() || !state?.url}>{t('loginSend')}</button>
							</form>
						</div>
					</li>
				</ol>
			)}
			<div className="actions">
				<button className="link" onClick={onTerminal}><Icon name="terminal" size={14} /> {t('terminal')}</button>
				<button onClick={onClose}>{t('close')}</button>
			</div>
		</Modal>
	)
}

function Logs({ name, onClose }: { name: string; onClose: () => void }) {
	const t = useT()
	const [text, setText] = useState('')
	const [el, setEl] = useState<HTMLPreElement | null>(null)
	useEffect(() => {
		const proto = location.protocol === 'https:' ? 'wss' : 'ws'
		const ws = new WebSocket(`${proto}://${location.host}/api/sandboxes/${name}/logs/stream`)
		ws.onmessage = (ev) => setText((old) => (old + ev.data).slice(-200_000))
		return () => ws.close()
	}, [name])
	useEffect(() => {
		el?.scrollTo(0, el.scrollHeight)
	}, [text, el])
	return (
		<Modal title={<><Icon name="log" /> {t('logs')}: {name} <span className="muted small">({t('logLive')})</span></>} onClose={onClose} wide>
			<pre ref={setEl} className="logs">{text || '…'}</pre>
		</Modal>
	)
}

function Changes({ s, name, onClose }: { s?: Sandbox; name: string; onClose: () => void }) {
	const t = useT()
	const g = s?.status?.git
	const empty = !g || (g.today.length === 0 && g.changed.length === 0)
	return (
		<Modal title={<><Icon name="history" /> {t('changesToday')}: {name}</>} onClose={onClose}>
			{empty ? (
				<p className="muted">{t('nothingToday')}</p>
			) : (
				<>
					{g.today.length > 0 && (
						<div>
							<h3>{t('commitsToday')}</h3>
							<ul className="plain">{g.today.map((c, i) => <li key={i}><code>{c.slice(0, 7)}</code> {c.slice(8)}</li>)}</ul>
						</div>
					)}
					{g.changed.length > 0 && (
						<div>
							<h3>{t('changedFiles')} {g.shortstat && <span className="muted small">({g.shortstat})</span>}</h3>
							<ul className="plain">{g.changed.map((f, i) => <li key={i}><code>{f}</code></li>)}</ul>
						</div>
					)}
				</>
			)}
		</Modal>
	)
}

function Diagnostics({ lang, onClose }: { lang: string; onClose: () => void }) {
	const t = useT()
	const [d, setD] = useState<any>(null)
	const [err, setErr] = useState('')
	useMirrorLoading(!d && !err)
	useEffect(() => {
		api.diagnostics().then(setD).catch((e) => setErr(String(e)))
	}, [])
	const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString(lang) : t('unknown'))
	return (
		<Modal title={<><Icon name="stethoscope" /> {t('diagnostics')}</>} onClose={onClose} wide>
			{err && <p className="error">{err}</p>}
			{!d && !err && <p>{t('loading')}</p>}
			{d && (
				<div className="diag">
					<section>
						<h3>{t('diagManager')}</h3>
						<dl>
							<dt>{t('version')}</dt><dd>{d.manager.version} ({t('build')} {String(d.manager.build).slice(0, 7)})</dd>
							<dt>{t('folder')}</dt><dd><code>{d.hostDir}</code></dd>
						</dl>
					</section>
					<section>
						<h3>{t('diagDocker')}</h3>
						{d.docker.error ? <p className="error">{humanizeError(d.docker.error, t)}</p> : (
							<dl>
								<dt>{t('version')}</dt><dd>{d.docker.docker.version} (API {d.docker.docker.apiVersion})</dd>
								<dt>OS</dt><dd>{d.docker.docker.os}, {d.docker.docker.arch}, {d.docker.docker.cpus} CPU, {d.docker.docker.memoryGb} GB</dd>
							</dl>
						)}
					</section>
					<section>
						<h3>{t('diagHost')}</h3>
						<dl>
							<dt>{t('lanIp')}</dt><dd>{d.host.lanIp || t('unknown')} {d.host.hostName && <span className="muted">({d.host.hostName})</span>}</dd>
							{d.disk && <><dt>{t('diagDisk')}</dt><dd>{d.disk.freeGb} GB {t('free')} {t('of')} {d.disk.totalGb} GB</dd></>}
						</dl>
					</section>
					<section>
						<h3>{t('diagImages')}</h3>
						<dl>
							{Object.entries(d.docker.images ?? {}).map(([name, i]: [string, any]) => (
								<div key={name}>
									<dt><code>{name}</code></dt>
									<dd>{i.missing ? t('unknown') : `${i.sizeMb} MB, ${fmt(i.created)}`} {i.digest && <span className="muted small">{String(i.digest).slice(7, 19)}</span>}</dd>
								</div>
							))}
						</dl>
					</section>
					<section>
						<h3>{t('diagSandboxes')}</h3>
						<table className="table">
							<thead><tr><th>{t('name')}</th><th></th><th>{t('uptime')}</th><th>{t('lastActivity')}</th><th>Claude</th></tr></thead>
							<tbody>
								{d.sandboxes.map((s: any) => (
									<tr key={s.name}>
										<td>{s.name}</td>
										<td>{s.container.running ? <Pill tone="on">{t('running')}</Pill> : <Pill tone="off">{t('stopped')}</Pill>}</td>
										<td>{s.startedAt ? <Rel iso={s.startedAt} lang={lang} /> : ''}</td>
										<td>{s.lastActivity ? <Rel iso={s.lastActivity} lang={lang} /> : ''}</td>
										<td>{s.claudeVersion || (s.container.running ? '…' : '')} {s.loggedIn === false && <span className="warn-text">({t('needsLogin')})</span>}</td>
									</tr>
								))}
							</tbody>
						</table>
					</section>
				</div>
			)}
		</Modal>
	)
}

function DeleteDialog({ s, onCancel, onConfirm }: { s: Sandbox; onCancel: () => void; onConfirm: (files: boolean) => Promise<void> }) {
	const t = useT()
	const [files, setFiles] = useState(false)
	return (
		<Modal title={<><Icon name="trash" /> {t('deleteTitle')}</>} onClose={onCancel}>
			<p>{t('deleteText', { name: s.name })}</p>
			<label className="check">
				<input type="checkbox" checked={files} onChange={(e) => setFiles(e.target.checked)} /> {t('deleteFiles')}
			</label>
			<div className="actions">
				<button onClick={onCancel}>{t('cancel')}</button>
				<button className="danger-btn" onClick={() => onConfirm(files)}><Icon name="trash" /> {t('delete')}</button>
			</div>
		</Modal>
	)
}

function SandboxForm({ existing, initial, onSubmit, onCancel }: { existing?: Sandbox; initial?: Partial<Sandbox> & { token?: string }; onSubmit: (body: object) => Promise<void>; onCancel: () => void }) {
	const t = useT()
	const [name, setName] = useState(existing?.name ?? initial?.name ?? '')
	const [repoUrl, setRepoUrl] = useState(existing?.repoUrl ?? initial?.repoUrl ?? '')
	const [token, setToken] = useState(initial?.token ?? '')
	const [branch, setBranch] = useState(existing?.branch ?? initial?.branch ?? '')
	const [autostart, setAutostart] = useState(existing?.autostart ?? false)
	const [memoryGb, setMemoryGb] = useState(existing?.memoryGb ?? 4)
	const [cpus, setCpus] = useState(existing?.cpus ?? 2)
	const [idleStopHours, setIdleStopHours] = useState(existing?.idleStopHours ?? 4)
	const [lanPreview, setLanPreview] = useState(existing?.lanPreview ?? false)
	const [busy, setBusy] = useLocalLoading()
	const nameOk = /^[a-z0-9][a-z0-9-]*$/.test(name)
	const inviteLink = () => {
		const q = new URLSearchParams()
		if (name) q.set('name', name)
		if (repoUrl) q.set('repo', repoUrl)
		if (branch) q.set('branch', branch)
		if (token) q.set('token', token)
		return `${location.origin}${location.pathname}#new?${q.toString()}`
	}
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
		<Modal title={existing ? <><Icon name="settings" /> {t('edit')}: {existing.name}</> : <><Icon name="plus" /> {t('newSandbox')}</>} onClose={onCancel}>
			<form onSubmit={submit} className="form">
				{!existing && (
					<label>
						{t('name')}
						<input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} required pattern="[a-z0-9][a-z0-9-]*" autoFocus className={name && !nameOk ? 'invalid' : ''} />
						<small>{t('nameHint')}</small>
					</label>
				)}
				<label>
					{t('repoUrl')}
					<input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://bitbucket.org/workspace/repo.git" />
					<small>{t('repoHint')} {t('repoHintToken')}</small>
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
					<label>{t('memory')}<input type="number" min={1} step={1} value={memoryGb} onChange={(e) => setMemoryGb(Number(e.target.value))} /></label>
					<label>{t('cpus')}<input type="number" min={0.5} step={0.5} value={cpus} onChange={(e) => setCpus(Number(e.target.value))} /></label>
					<label>{t('idleStop')}<input type="number" min={0} step={1} value={idleStopHours} onChange={(e) => setIdleStopHours(Number(e.target.value))} /></label>
				</div>
				{!existing && (repoUrl || token) && (
					<div className="invite">
						<Copy text={inviteLink()} label={t('inviteLink')} />
						<small>{t('inviteHint')}</small>
					</div>
				)}
				<div className="actions">
					<button type="button" onClick={onCancel}>{t('cancel')}</button>
					<button type="submit" className="primary" disabled={busy || (!existing && !nameOk)}>{existing ? t('save') : t('create')}</button>
				</div>
			</form>
		</Modal>
	)
}

createRoot(document.getElementById('root')!).render(<Root />)
