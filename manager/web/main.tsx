import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import QRCode from 'qrcode'
import { Loading, SharedLoadingIndicatorContextProvider, SharedProgressLoadingIndicator, useLocalLoading, useMirrorLoading } from 'shared-loading-indicator'
import { api, type LoginState, type Sandbox, type UpdateCheck, type UpdateProgress } from './api'
import { LangContext, detectLang, languages, saveLang, useT, type Lang } from './i18n'
import { Terminal } from './Terminal'
import { Icon, Menu, Modal, Pill, Rel, Skeleton, Spinner, ToastProvider, humanizeError, isRecent, useToast } from './ui'
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
	| { kind: 'reset'; s: Sandbox }
	| { kind: 'devmsg'; name: string }
	| { kind: 'doctor'; name: string }
	| { kind: 'diagnostics' }
	| { kind: 'changes'; name: string }
	| { kind: 'qr'; text: string; title: string }
	| { kind: 'logout' }
	| { kind: 'sendAnyway'; name: string; output: string }
	| { kind: 'devlog'; name: string }

// Which of the three steps a sandbox is on, and whether the person has to act.
function stageOf(s: Sandbox) {
	if (!s.container.running && s.failure) return { step: 1, tone: 'error' as const, attention: true }
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
	const [host, setHost] = useState<{ hostDir: string; helper: boolean }>({ hostDir: '', helper: false })
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
	const [stats, setStats] = useState<Record<string, { cpuPercent: number; memMb: number; memLimitMb: number } | null>>({})
	useEffect(() => {
		const load = () => api.stats().then(setStats).catch(() => {})
		load()
		const id = setInterval(load, 5000)
		return () => clearInterval(id)
	}, [])
	const close = () => setModal(null)

	useEffect(() => {
		const load = () => {
			api.info().then((i) => { setLanHosts(i.lanHosts ?? []); setHost({ hostDir: i.hostDir, helper: i.helper }) }).catch(() => {})
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
		setModal({ kind: 'create', initial: { name: q.get('name') ?? '', repoUrl: q.get('repo') ?? '', branch: q.get('branch') ?? '', token: q.get('token') ?? '', instructions: q.get('inst') ?? '' } })
		history.replaceState(null, '', location.pathname)
	}, [])

	// Browser notifications when something starts waiting for the person and
	// the page is not in front. Opt-in through the gear menu.
	const [notify, setNotify] = useState(() => {
		try {
			return localStorage.getItem('sandbox-manager.notify') === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted'
		} catch {
			return false
		}
	})
	const toggleNotify = async () => {
		if (notify) {
			setNotify(false)
			try { localStorage.setItem('sandbox-manager.notify', '0') } catch {}
			return
		}
		if (typeof Notification === 'undefined') return
		const perm = await Notification.requestPermission()
		if (perm === 'granted') {
			setNotify(true)
			try { localStorage.setItem('sandbox-manager.notify', '1') } catch {}
			toast('ok', t('notificationsOn'))
		} else toast('error', t('notificationsDenied'))
	}
	const seen = useMemo(() => new Map<string, string>(), [])
	useEffect(() => {
		if (!list) return
		for (const s of list) {
			const state = s.failure ? 'failed' : s.container.running && s.status && !s.status.claude.loggedIn ? 'login' : ''
			const prev = seen.get(s.name)
			seen.set(s.name, state)
			if (!notify || !state || prev === undefined || prev === state || document.visibilityState === 'visible') continue
			try {
				new Notification(t('title'), { body: state === 'failed' ? t('notifyFailed', { name: s.name }) : t('notifyLogin', { name: s.name }), icon: '/icon.svg' })
			} catch {}
		}
	}, [list, notify])

	// Tell the manager the person's time zone (sandboxes get it as TZ).
	useEffect(() => {
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
		if (!tz) return
		api.settings().then((s) => { if (s.timeZone !== tz) api.saveSettings({ timeZone: tz }).catch(() => {}) }).catch(() => {})
	}, [])

	// Keyboard: N opens the new sandbox form (Escape closes dialogs elsewhere).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const el = document.activeElement as HTMLElement | null
			const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
			if (typing || modal || e.metaKey || e.ctrlKey || e.altKey) return
			if (e.key === 'n' || e.key === 'N') {
				e.preventDefault()
				setModal({ kind: 'create' })
			}
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [modal])

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

	// Order is the person's (drag and drop); new sandboxes go last.
	const sorted = useMemo(() => (list ? [...list].sort((a, b) => a.order - b.order) : null), [list])
	const [dragging, setDragging] = useState<string | null>(null)
	const dropOn = async (target: string) => {
		if (!dragging || dragging === target || !sorted) return
		const names = sorted.map((x) => x.name).filter((n) => n !== dragging)
		names.splice(names.indexOf(target), 0, dragging)
		setDragging(null)
		await run(() => api.order(names))
	}

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
							{ label: t('prune'), icon: 'trash', onClick: () => run(async () => { const r = await api.prune(); toast('ok', r.removed ? t('pruned', { mb: r.freedMb, n: r.removed }) : t('prunedNothing')) }) },
							'sep',
							{ label: t('backup'), icon: 'log', onClick: async () => {
								try {
									const data = await api.backup()
									const blob = new Blob([JSON.stringify(data, null, '\t')], { type: 'application/json' })
									const a = document.createElement('a')
									a.href = URL.createObjectURL(blob)
									a.download = `sandboxes-backup-${new Date().toISOString().slice(0, 10)}.json`
									a.click()
									URL.revokeObjectURL(a.href)
								} catch (e) { toast('error', String(e)) }
							} },
							{ label: t('restore'), icon: 'restart', onClick: () => {
								const input = document.createElement('input')
								input.type = 'file'
								input.accept = 'application/json'
								input.onchange = async () => {
									const f = input.files?.[0]
									if (!f) return
									await run(async () => {
										const r = await api.restore(JSON.parse(await f.text()))
										toast('ok', t('restored', { added: r.added, skipped: r.skipped.join(', ') || '-' }))
									})
								}
								input.click()
							} },
							'sep',
							{ label: `${t('notifications')}${notify ? ' ✓' : ''}`, icon: 'alert', onClick: toggleNotify },
							{ label: t('installApp'), icon: 'phone', onClick: () => toast('info', t('installAppHint')) },
							'sep',
							{ label: t('logoutClaude'), icon: 'login', danger: true, onClick: () => setModal({ kind: 'logout' }) },
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
					<button className="primary" title={t('shortcutNew')} onClick={() => setModal({ kind: 'create' })}><Icon name="plus" /> <span className="btn-text">{t('newSandbox')}</span></button>
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
						<SandboxCard
							key={s.name}
							s={s}
							focus={sorted.length === 1}
							usage={stats[s.name] ?? null}
							host={host}
							lang={lang}
							lanHost={lanHost}
							lanHosts={lanHosts}
							onLanHost={chooseLan}
							run={run}
							setModal={setModal}
							drag={{ active: dragging === s.name, onStart: () => setDragging(s.name), onDrop: () => dropOn(s.name), onEnd: () => setDragging(null) }}
						/>
					))}
				</ul>
			)}

			{modal?.kind === 'create' && (
				<SandboxForm
					initial={modal.initial}
					onCancel={close}
					onSubmit={async (body) => {
						const { startNow, ...rest } = body as { startNow?: boolean; name: string }
						await run(async () => {
							const created = await api.create(rest)
							if (startNow) await api.start(created.name)
						})
						close()
					}}
				/>
			)}
			{modal?.kind === 'edit' && (
				<SandboxForm existing={modal.s} onCancel={close} onSubmit={async (body) => { await run(async () => { const { newName, ...rest } = body as { newName?: string }; const r = (await api.update(modal.s.name, rest)) as Sandbox & { pendingNote?: string }; if (r.pendingNote === 'branch') toast('info', t('branchDeferred')); if (newName) await api.rename(modal.s.name, newName) }); close() }} />
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
				<Modal title={modal.title} onClose={close} className="qr-modal">
					<Qr text={modal.text} size={640} />
					<p className="muted small">{/claude\.ai/.test(modal.text) ? t('sessionQrHint') : t('qrContains')}</p>
					<div className="access-row"><span className="k" /><code className="v">{modal.text}</code><Copy text={modal.text} /></div>
				</Modal>
			)}
			{modal?.kind === 'devlog' && <DevLog name={modal.name} onClose={close} />}
			{modal?.kind === 'logout' && (
				<Modal title={<><Icon name="login" /> {t('logoutClaude')}</>} onClose={close}>
					<p>{t('logoutConfirm')}</p>
					<div className="actions">
						<button onClick={close}>{t('cancel')}</button>
						<button className="danger-btn" onClick={async () => { await run(() => api.logoutClaude(), t('loggedOut')); close() }}>{t('logoutClaude')}</button>
					</div>
				</Modal>
			)}
			{modal?.kind === 'sendAnyway' && (
				<Modal title={<><Icon name="alert" /> {t('checksFailed')}</>} onClose={close}>
					<p>{t('askClaudeToFix')}</p>
					<pre className="logs small">{modal.output}</pre>
					<div className="actions">
						<button onClick={close}>{t('cancel')}</button>
						<button className="primary" onClick={async () => { close(); await run(async () => { const r = await api.save(modal.name, true); toast('ok', `${t('sent')} (${r.output.split('\n').pop()})`) }) }}><Icon name="send" /> {t('sendAnyway')}</button>
					</div>
				</Modal>
			)}
			{modal?.kind === 'doctor' && <Doctor name={modal.name} onClose={close} />}
			{modal?.kind === 'devmsg' && <DevMessage s={list?.find((x) => x.name === modal.name)} name={modal.name} onClose={close} />}
			{modal?.kind === 'reset' && (
				<Modal title={<><Icon name="restart" /> {t('resetTitle')}</>} onClose={close}>
					<p>{t('resetText', { name: modal.s.name })}</p>
					{(() => {
						const g = list?.find((x) => x.name === modal.s.name)?.status?.git
						const loss = g && (g.dirty > 0 || g.ahead > 0)
						return <p className={loss ? 'warn-text' : 'ok-text'}>{loss ? t('resetLoss', { dirty: g.dirty, ahead: g.ahead }) : t('resetSafe')}</p>
					})()}
					<div className="actions">
						<button onClick={close}>{t('cancel')}</button>
						<button className="danger-btn" onClick={async () => { close(); await run(() => api.reset(modal.s.name), t('resetDone')) }}><Icon name="restart" /> {t('reset')}</button>
					</div>
				</Modal>
			)}
			{modal?.kind === 'delete' && (
				<DeleteDialog s={list?.find((x) => x.name === modal.s.name) ?? modal.s} onCancel={close} onConfirm={async (files) => { await run(() => api.remove(modal.s.name, files)); close() }} />
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
	return <img className={`qr${onClick ? ' clickable' : ''}${size > 200 ? ' big' : ''}`} src={src} alt={text} title={onClick ? t('enlargeQr') : t('qrHint')} onClick={onClick} />
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

function Prompts() {
	const t = useT()
	const { toast } = useToast()
	const copy = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text)
			toast('ok', t('copied'))
		} catch {}
	}
	return (
		<div className="prompts">
			<div className="prompts-title"><Icon name="bolt" /> {t('promptsTitle')} <span className="muted small">{t('promptsHint')}</span></div>
			<div className="prompts-list">
				{(['prompt1', 'prompt2', 'prompt3', 'prompt4', 'prompt5'] as const).map((k) => (
					<button key={k} className="prompt" onClick={() => copy(t(k))} title={t('copy')}>„{t(k)}“</button>
				))}
			</div>
		</div>
	)
}

function DevLog({ name, onClose }: { name: string; onClose: () => void }) {
	const t = useT()
	const [text, setText] = useState<string | null>(null)
	useEffect(() => {
		const load = () => api.devLog(name).then(setText).catch(() => setText(''))
		load()
		const id = setInterval(load, 2000)
		return () => clearInterval(id)
	}, [name])
	return (
		<Modal title={<><Icon name="log" /> {t('devLog')}: {name}</>} onClose={onClose} wide>
			{text === null ? <p>{t('loading')}</p> : text.trim() ? <pre className="logs">{text}</pre> : <p className="muted">{t('devLogEmpty')}</p>}
		</Modal>
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

// Where the project lives on the host, shown the way the OS shows paths.
function folderPath(hostDir: string, name: string) {
	if (!hostDir) return `~/Sandboxes/${name}`
	const win = hostDir.includes('\\')
	const full = win ? `${hostDir.replace(/\\$/, '')}\\${name}` : `${hostDir.replace(/\/$/, '')}/${name}`
	return win ? full : full.replace(/^\/(Users|home)\/[^/]+/, '~')
}

// Web links for a repository, its branch and a commit, by hosting provider.
function repoLinks(repoUrl: string, branch: string, sha: string) {
	let url = repoUrl.trim()
	url = url.replace(/^git@([^:]+):(.+)$/, 'https://$1/$2').replace(/^ssh:\/\/git@([^/]+)\/(.+)$/, 'https://$1/$2')
	try {
		const u = new URL(url)
		u.username = ''
		u.password = ''
		const base = `${u.protocol}//${u.host}${u.pathname.replace(/\.git$/, '').replace(/\/$/, '')}`
		const b = encodeURIComponent(branch)
		if (u.host === 'github.com') return { repo: base, branch: `${base}/tree/${b}`, commit: sha ? `${base}/commit/${sha}` : '' }
		if (u.host === 'bitbucket.org') return { repo: base, branch: `${base}/branch/${b}`, commit: sha ? `${base}/commits/${sha}` : '' }
		if (u.host === 'gitlab.com') return { repo: base, branch: `${base}/-/tree/${b}`, commit: sha ? `${base}/-/commit/${sha}` : '' }
		return { repo: base, branch: '', commit: '' }
	} catch {
		return { repo: '', branch: '', commit: '' }
	}
}

// "https://bitbucket.org/ws/my-site.git" → "my-site"
function nameFromRepo(url: string) {
	const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? ''
	return last.replace(/\.git$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

// Which desktop OS the browser runs on (for wording such as Finder vs Explorer).
function detectPlatform(): 'mac' | 'win' | 'other' {
	const hint = ((navigator as any).userAgentData?.platform as string | undefined) ?? ''
	const ua = navigator.userAgent
	if (/mac/i.test(hint) || /Macintosh|Mac OS X/i.test(ua)) return 'mac'
	if (/win/i.test(hint) || /Windows/i.test(ua)) return 'win'
	return 'other'
}
const platform = detectPlatform()

function SandboxCard({ s, focus, usage, host, lang, lanHost, lanHosts, onLanHost, run, setModal, drag }: {
	s: Sandbox
	focus?: boolean
	drag: { active: boolean; onStart: () => void; onDrop: () => void; onEnd: () => void }
	usage: { cpuPercent: number; memMb: number; memLimitMb: number } | null
	host: { hostDir: string; helper: boolean }
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
	const [busy, setBusy] = useState<'share' | 'save' | 'dev' | ''>('')
	// After an action returns, keep the button busy until the sandbox status
	// shows the result (or 45 s pass), polling faster meanwhile.
	const [pending, setPending] = useState<{ check: (s: Sandbox) => boolean; until: number } | null>(null)
	useEffect(() => {
		if (!pending) return
		if (pending.check(s) || Date.now() > pending.until) {
			setPending(null)
			return
		}
		const id = setTimeout(() => run(async () => {}), 1500)
		return () => clearTimeout(id)
	}, [pending, s])
	const waiting = busy !== '' || pending !== null
	useMirrorLoading(waiting)
	const [expanded, setExpanded] = useState<boolean | null>(null)
	const open = expanded ?? (running || Boolean(s.failure))
	const working = Boolean(st && isRecent(st.lastActivity, 60_000))

	const action = async (what: 'share' | 'unshare' | 'save' | 'restart-claude' | 'dev-start' | 'dev-stop') => {
		setBusy(what === 'unshare' ? 'share' : what === 'dev-start' ? 'dev' : what === 'restart-claude' || what === 'dev-stop' ? '' : what)
		try {
			if (what === 'save') {
				try {
					const r = await api.save(s.name, false)
					toast('ok', `${t('sent')} (${r.output.split('\n').pop()})`)
					if (/pushed/.test(r.output)) setModal({ kind: 'devmsg', name: s.name })
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e)
					if (/CHECK FAILED/.test(msg)) setModal({ kind: 'sendAnyway', name: s.name, output: msg })
					else throw e
				}
				return
			}
			const r = await api.action(s.name, what)
			if (what === 'restart-claude' || what === 'dev-stop') toast('ok', r.output)
			if (what === 'dev-start') toast('ok', `${t('devStarted')} ${r.output.split('\n').pop() ?? ''}`)
			const until = Date.now() + 45_000
			if (what === 'share') setPending({ check: (x) => Boolean(x.status?.preview.tunnelUrl), until })
			if (what === 'unshare') setPending({ check: (x) => !x.status?.preview.tunnelUrl, until })
			if (what === 'dev-start') setPending({ check: (x) => Boolean(x.status?.preview.devServerUp), until })
			if (what === 'dev-stop') setPending({ check: (x) => !x.status?.preview.devServerUp, until })
		} catch (e) {
			toast('error', humanizeError(e instanceof Error ? e.message : String(e), t))
		} finally {
			setBusy('')
			await run(async () => {})
		}
	}

	const links = repoLinks(s.repoUrl, st?.git.branch || s.branch, st?.git.lastCommit?.split(' ')[0] ?? '')

	const statusPill =
		!running && s.failure ? <Pill tone="error">{t('failed')}</Pill>
		: !running && s.stoppedReason ? <Pill tone="off">{t('stoppedIdle', { hours: s.stoppedReason.hours })}</Pill>
		: !running ? <Pill tone="off">{t('stopped')}</Pill>
		: stage.starting ? <Pill tone="warn" pulse>{t('starting')}</Pill>
		: stage.attention ? <Pill tone="warn">{t('needsLogin')}</Pill>
		: working ? <Pill tone="work" pulse>{t('claudeWorking')}</Pill>
		: <Pill tone="on">{t('running')}</Pill>

	const primary =
		!running ? <button className="primary" autoFocus={focus} onClick={() => run(async () => { const r = await api.start(s.name); if (r.portNote) toast('info', t('portMoved', r.portNote)) })}><Icon name="play" /> {t('start')}</button>
		: stage.attention ? <button className="primary" autoFocus={focus} onClick={() => setModal({ kind: 'login', name: s.name })}><Icon name="login" /> {t('loginClaude')}</button>
		: st && st.claude.sessionUrl ? (
			<>
				<a className="button primary" autoFocus={focus} href={st.claude.sessionUrl} target="_blank" rel="noreferrer"><Icon name="external" /> {t('openClaude')}</a>
				<button className="icon-btn" title={t('sessionQr')} onClick={() => setModal({ kind: 'qr', text: st.claude.sessionUrl, title: t('sessionQr') })}><Icon name="qr" /></button>
			</>
		)
		: st ? <button className="primary" disabled><Spinner /> {t('connecting')}</button>
		: null

	const menuItems = [
		...(running ? [{ label: t('stop'), icon: 'stop', onClick: () => run(() => api.stop(s.name)) }] : []),
		{ label: t('edit'), icon: 'settings', onClick: () => setModal({ kind: 'edit', s }) },
		{ label: t('changesToday'), icon: 'history', onClick: () => setModal({ kind: 'changes', name: s.name }), disabled: !running },
		{ label: t('devMessage'), icon: 'send', onClick: () => setModal({ kind: 'devmsg', name: s.name }), disabled: !s.repoUrl },
		{ label: t('devStop'), icon: 'stop', onClick: () => action('dev-stop'), disabled: !(running && st?.preview.devServerUp) },
		{ label: t('devLog'), icon: 'log', onClick: () => setModal({ kind: 'devlog', name: s.name }), disabled: !running },
		{ label: t('doctor'), icon: 'stethoscope', onClick: () => setModal({ kind: 'doctor', name: s.name }), disabled: !running },
		'sep' as const,
		{ label: t('terminal'), icon: 'terminal', onClick: () => setModal({ kind: 'terminal', name: s.name, cmd: 'shell' }), disabled: !running },
		{ label: t('restartClaude'), icon: 'restart', onClick: () => action('restart-claude'), disabled: !running },
		{ label: t('logs'), icon: 'log', onClick: () => setModal({ kind: 'logs', name: s.name }) },
		'sep' as const,
		...(s.repoUrl ? [{ label: t('reset'), icon: 'restart', onClick: () => setModal({ kind: 'reset', s }), danger: true }] : []),
		{ label: t('delete'), icon: 'trash', onClick: () => setModal({ kind: 'delete', s }), danger: true },
	]

	return (
		<li
			className={`card ${stage.tone}${open ? '' : ' collapsed'}${drag.active ? ' dragging' : ''}`}
			onDragOver={(e) => e.preventDefault()}
			onDrop={(e) => { e.preventDefault(); drag.onDrop() }}
		>
			<div className="card-head">
				<span className="grip" draggable title={t('dragHint')} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; drag.onStart() }} onDragEnd={drag.onEnd}>⋮⋮</span>
				<button className="icon-btn chevron" onClick={() => setExpanded(!open)} aria-label={open ? t('collapse') : t('expand')} aria-expanded={open}>
					<Icon name="chevron" />
				</button>
				<h2>{s.name}</h2>
				{statusPill}
				<span className="grow" />
				{primary}
				<Menu icon="more" label={undefined} items={menuItems} />
			</div>
			{running && st && (stage.step === 3 || st.preview.proxyUp === false || s.outdated || s.settingsPending) && (
				<div className="card-pills">
					{stage.step === 3 && (
						st.preview.devServerUp ? (
							<Pill tone="on">{t('devServerUp')}</Pill>
						) : busy === 'dev' || pending ? (
							<Pill tone="work"><Spinner /> {t('devStarting')}</Pill>
						) : (
							<Pill tone="off">{t('devServerDown')} · <button className="pill-link" onClick={() => action('dev-start')}>{t('devStart')}</button> · <button className="pill-link" onClick={() => setModal({ kind: 'devlog', name: s.name })}>log</button></Pill>
						)
					)}
					{!st.claude.serverRunning && stage.step === 3 && <Pill tone="error">{t('claudeOffline')}</Pill>}
					{st.preview.proxyUp === false && <Pill tone="error">{t('proxyDown')}</Pill>}
					{s.outdated && <Pill tone="warn">{t('outdated')} · <button className="pill-link" onClick={() => run(() => api.start(s.name))}>{t('restart')}</button></Pill>}
					{s.settingsPending && !s.outdated && <Pill tone="warn">{t('settingsPending')} · <button className="pill-link" onClick={() => run(() => api.start(s.name))}>{t('restart')}</button></Pill>}
				</div>
			)}

			{open && (
				<>
					<div className="meta">
						<span><Icon name="git" size={13} /> {s.repoUrl ? (links.repo ? <a className="meta-link" href={links.repo} target="_blank" rel="noreferrer">{s.repoUrl.replace(/^https?:\/\//, '')}</a> : s.repoUrl) : t('noRemote')}</span>
						<span>{t('branch')}: {links.branch ? <a href={links.branch} target="_blank" rel="noreferrer"><code>{st?.git.branch || s.branch}</code></a> : <code>{st?.git.branch || s.branch}</code>}</span>
						<button
							className="meta-link"
							title={host.helper ? t('openFolder', { app: platform === 'mac' ? t('appFinder') : platform === 'win' ? t('appExplorer') : t('appFiles') }) : t('copyFolder')}
							onClick={async () => {
								try {
									const r = host.helper ? await api.openFolder(s.name) : { opened: false, path: folderPath(host.hostDir, s.name) }
									if (!r.opened) {
										await navigator.clipboard.writeText(r.path).catch(() => {})
										toast('info', platform === 'mac' ? t('folderCopiedMac') : platform === 'win' ? t('folderCopiedWin') : t('folderCopied'))
									}
								} catch (e) {
									toast('error', humanizeError(e instanceof Error ? e.message : String(e), t))
								}
							}}
						>
							<Icon name="folder" size={13} /> {folderPath(host.hostDir, s.name)}
						</button>
						{running && usage && <span title={t('memoryLimits')}>{t('usage', { cpu: usage.cpuPercent, mem: (usage.memMb / 1024).toFixed(1), limit: (usage.memLimitMb / 1024).toFixed(0) })}</span>}
					</div>

					{!running && !s.failure && s.stoppedReason && (
						<p className="hint">{t('stoppedIdleText', { hours: s.stoppedReason.hours, when: new Date(s.stoppedReason.at).toLocaleString(lang) })}</p>
					)}
					{!running && s.failure && (
						<div className="failure">
							<div className="failure-title"><Icon name="alert" /> {t('failureReason')}</div>
							<div>{humanizeError(s.failure, t)}</div>
							<pre className="logs small">{s.failure}</pre>
						</div>
					)}
					{stage.step < 3 && (
						<ol className="steps">
							<li className={stage.step > 1 ? 'done' : 'now'}>{t('stepStart')}</li>
							<li className={stage.step === 2 ? 'now' : ''}>{t('stepLogin')}{stage.starting && <span className="muted"> · {t('startingHint')}</span>}</li>
							<li>{t('stepOpen')}</li>
						</ol>
					)}

					{stage.step === 3 && st && (
						<>
							{st.preview.imageAt && (
								<a className="thumb" href={st.preview.url} target="_blank" rel="noreferrer" title={t('previewThumb')}>
									<img src={`/api/sandboxes/${s.name}/preview.png?t=${encodeURIComponent(st.preview.imageAt)}`} alt={t('previewThumb')} />
								</a>
							)}
							<div className="links">
								<a className="button" href={st.preview.url} target="_blank" rel="noreferrer"><Icon name="globe" /> {t('openPreview')}</a>
								{st.preview.tunnelUrl ? (
									<button onClick={() => action('unshare')} disabled={waiting}>{busy === 'share' || pending ? <Spinner /> : <Icon name="x" />} {t('unshare')}</button>
								) : (
									<button onClick={() => action('share')} disabled={waiting} className={busy === 'share' || pending ? 'busy' : ''}>{busy === 'share' || pending ? <Spinner /> : <Icon name="share" />} {busy === 'share' || pending ? t('sharing') : t('share')}</button>
								)}
								<button onClick={() => action('save')} disabled={waiting} className={busy === 'save' ? 'busy' : ''}>{busy === 'save' ? <Spinner /> : <Icon name="send" />} {busy === 'save' ? t('sending') : t('sendToDev')}</button>
							</div>
							{st.preview.tunnelUrl && (
								<Access title={t('shared')} icon="globe" url={st.preview.tunnelUrl} user={st.preview.user} password={st.preview.password} onQr={(text) => setModal({ kind: 'qr', text, title: t('shared') })} />
							)}
							{s.lanPreview && lanHost && st.preview.lanEnabled !== false && (
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
							{!st.lastActivity && <Prompts />}
							<div className="git">
								{st.git.dirty > 0 && <span className="warn-text">{t('uncommitted', { n: st.git.dirty })}</span>}
								{st.git.ahead > 0 && <span className="warn-text">{t('unpushed', { n: st.git.ahead })}</span>}
								{st.git.dirty === 0 && st.git.ahead === 0 && <span className="ok-text"><Icon name="check" size={13} /> {t('clean')}</span>}
								{st.git.lastCommit && (
									<span className="muted">
										{t('lastCommit')}:{' '}
										{links.commit ? <a className="meta-link" href={links.commit} target="_blank" rel="noreferrer">{st.git.lastCommit}</a> : st.git.lastCommit}
									</span>
								)}
							</div>
							{st.lastActivity && <div className="git"><span className="muted">{t('lastActivity')}: <Rel iso={st.lastActivity} lang={lang} /></span></div>}
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

function Doctor({ name, onClose }: { name: string; onClose: () => void }) {
	const t = useT()
	const [checks, setChecks] = useState<{ check: string; ok: boolean; detail: string }[] | null>(null)
	const [err, setErr] = useState('')
	useMirrorLoading(!checks && !err)
	useEffect(() => {
		api.doctor(name).then((r) => setChecks(r.checks)).catch((e) => setErr(humanizeError(String(e), t)))
	}, [name])
	const label = (c: string) => {
		const key = `check${c[0].toUpperCase()}${c.slice(1)}` as Parameters<typeof t>[0]
		try { return t(key) } catch { return c }
	}
	return (
		<Modal title={<><Icon name="stethoscope" /> {t('doctorTitle')}: {name}</>} onClose={onClose}>
			{err && <p className="error">{err}</p>}
			{!checks && !err && <p>{t('loading')}</p>}
			{checks && (
				<ul className="checks">
					{checks.map((c) => (
						<li key={c.check} className={c.ok ? 'ok' : 'bad'}>
							<Icon name={c.ok ? 'check' : 'alert'} />
							<span className="k">{label(c.check)}</span>
							<span className="muted">{c.detail}</span>
						</li>
					))}
				</ul>
			)}
		</Modal>
	)
}

function DevMessage({ s, name, onClose }: { s?: Sandbox; name: string; onClose: () => void }) {
	const t = useT()
	const g = s?.status?.git
	const branch = g?.branch || s?.branch || ''
	const links = repoLinks(s?.repoUrl ?? '', branch, g?.lastCommit?.split(' ')[0] ?? '')
	const [text, setText] = useState(() =>
		t('devMessageText', { name, branch, link: links.branch ? ` (${links.branch})` : '', commit: g?.lastCommit || '-' }),
	)
	return (
		<Modal title={<><Icon name="send" /> {t('devMessage')}</>} onClose={onClose}>
			<p className="muted small">{t('devMessageHint')}</p>
			<textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
			<div className="actions">
				<button onClick={onClose}>{t('close')}</button>
				<Copy text={text} label={t('copy')} />
			</div>
		</Modal>
	)
}

function Changes({ s, name, onClose }: { s?: Sandbox; name: string; onClose: () => void }) {
	const t = useT()
	const g = s?.status?.git
	const links = repoLinks(s?.repoUrl ?? '', g?.branch || s?.branch || '', '')
	const commitUrl = (sha: string) => (links.commit || links.repo ? repoLinks(s?.repoUrl ?? '', g?.branch || '', sha).commit : '')
	const sends = g?.sends ?? []
	const empty = !g || (g.today.length === 0 && g.changed.length === 0 && sends.length === 0)
	return (
		<Modal title={<><Icon name="history" /> {t('changesToday')}: {name}</>} onClose={onClose}>
			{sends.length > 0 && (
				<div>
					<h3>{t('sendsTitle')}</h3>
					<ul className="plain">
						{sends.map((x, i) => (
							<li key={i}>
								<span className="muted">{new Date(x.at).toLocaleString()}</span> · {t('sendsCommits', { n: x.count })} · {commitUrl(x.sha) ? <a href={commitUrl(x.sha)} target="_blank" rel="noreferrer"><code>{x.sha}</code></a> : <code>{x.sha}</code>} {x.subject}
							</li>
						))}
					</ul>
				</div>
			)}
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
					{d.memory && d.docker.docker && d.memory.limitsGb > d.docker.docker.memoryGb && (
						<p className="failure"><Icon name="alert" /> {t('memoryWarning', { limits: d.memory.limitsGb, total: d.docker.docker.memoryGb })}</p>
					)}
					<section>
						<h3>{t('diagHost')}</h3>
						<dl>
							<dt>{t('lanIp')}</dt><dd>{d.host.lanIp || t('unknown')} {d.host.hostName && <span className="muted">({d.host.hostName})</span>}</dd>
							<dt></dt><dd className={d.host.helper ? 'ok-text' : 'warn-text'}>{d.host.helper ? t('helperOk') : t('helperMissing')}</dd>
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
					<div className="actions">
						<Copy
							label={t('copyReport')}
							text={[
								`Sandbox manager ${d.manager.version} (${String(d.manager.build).slice(0, 7)}), ${new Date().toISOString()}`,
								`Docker: ${d.docker.error ?? `${d.docker.docker?.version} on ${d.docker.docker?.os} ${d.docker.docker?.arch}, ${d.docker.docker?.cpus} CPU, ${d.docker.docker?.memoryGb} GB`}`,
								`Host: ${d.host.lanIp || '-'} (${d.host.hostName || '-'}), helper ${d.host.helper ? 'running' : 'missing'}, tz ${d.settings?.timeZone || '-'}`,
								d.disk ? `Disk: ${d.disk.freeGb} GB free of ${d.disk.totalGb} GB` : '',
								`Images: ${Object.entries(d.docker.images ?? {}).map(([n, i]: [string, any]) => `${n} ${i.missing ? 'missing' : `${i.sizeMb} MB ${String(i.digest).slice(7, 19)}`}`).join('; ')}`,
								`Sandboxes: ${d.sandboxes.map((x: any) => `${x.name}=${x.container.status}${x.loggedIn === false ? ' (not logged in)' : ''}${x.claudeVersion ? ` claude ${x.claudeVersion}` : ''}`).join('; ')}`,
								...Object.entries(d.failures ?? {}).map(([n, f]) => `Failure ${n}: ${String(f).replace(/\n/g, ' | ')}`),
							].filter(Boolean).join('\n')}
						/>
					</div>
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
	const g = s.status?.git
	const loss = g && (g.dirty > 0 || g.ahead > 0)
	return (
		<Modal title={<><Icon name="trash" /> {t('deleteTitle')}</>} onClose={onCancel}>
			<p>{t('deleteText', { name: s.name })}</p>
			{s.repoUrl && (
				g ? (
					<p className={loss ? 'warn-text' : 'ok-text'}>{loss ? t('resetLoss', { dirty: g.dirty, ahead: g.ahead }) : t('resetSafe')}</p>
				) : (
					<p className="warn-text">{t('deleteUnknown')}</p>
				)
			)}
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
	const [name, setName] = useState(existing?.name ?? (initial?.name || nameFromRepo(initial?.repoUrl ?? '')))
	const [nameTouched, setNameTouched] = useState(Boolean(existing || initial?.name))
	// The name follows the repository until the person edits it.
	const onRepoUrl = (v: string) => {
		setRepoUrl(v)
		if (!nameTouched) setName(nameFromRepo(v))
	}
	const [repoUrl, setRepoUrl] = useState(existing?.repoUrl ?? initial?.repoUrl ?? '')
	const [token, setToken] = useState(initial?.token ?? '')
	const [branch, setBranch] = useState(existing?.branch ?? initial?.branch ?? '')
	const [autostart, setAutostart] = useState(existing?.autostart ?? false)
	const [memoryGb, setMemoryGb] = useState(existing?.memoryGb ?? 4)
	const [cpus, setCpus] = useState(existing?.cpus ?? 2)
	const [idleStopHours, setIdleStopHours] = useState(existing?.idleStopHours ?? 4)
	const [lanPreview, setLanPreview] = useState(existing?.lanPreview ?? true)
	const [instructions, setInstructions] = useState(existing?.instructions ?? initial?.instructions ?? '')
	const [startNow, setStartNow] = useState(true)
	const [busy, setBusy] = useLocalLoading()
	const [check, setCheck] = useState<{ state: 'idle' | 'busy' | 'ok' | 'fail'; branches: string[]; error: string }>({ state: 'idle', branches: [], error: '' })
	// Check access on its own once both fields have settled.
	useEffect(() => {
		if (!repoUrl || (!token && !existing?.hasToken && !/@/.test(repoUrl))) return
		const id = setTimeout(doCheck, 900)
		return () => clearTimeout(id)
	}, [repoUrl, token])
	const doCheck = async () => {
		if (!repoUrl) return
		setCheck({ state: 'busy', branches: [], error: '' })
		try {
			const r = await api.checkRepo({ repoUrl, token: token || (existing?.hasToken ? '' : ''), username: existing?.gitUsername })
			setCheck({ state: r.ok ? 'ok' : 'fail', branches: r.branches, error: r.error })
		} catch (e) {
			setCheck({ state: 'fail', branches: [], error: e instanceof Error ? e.message : String(e) })
		}
	}
	const branchName = branch || `sandbox/${name || 'name'}`
	const nameOk = /^[a-z0-9][a-z0-9-]*$/.test(name)
	const inviteLink = () => {
		const q = new URLSearchParams()
		if (name) q.set('name', name)
		if (repoUrl) q.set('repo', repoUrl)
		if (branch) q.set('branch', branch)
		if (token) q.set('token', token)
		if (instructions) q.set('inst', instructions)
		return `${location.origin}${location.pathname}#new?${q.toString()}`
	}
	const submit = async (e: FormEvent) => {
		e.preventDefault()
		setBusy(true)
		const body: Record<string, unknown> = { repoUrl, branch: branch || undefined, autostart, memoryGb, cpus, idleStopHours, lanPreview, instructions }
		if (!existing) {
			body.name = name
			body.startNow = startNow
		} else if (name !== existing.name) {
			body.newName = name
		}
		if (token) body.token = token
		await onSubmit(body)
		setBusy(false)
	}
	return (
		<Modal title={existing ? <><Icon name="settings" /> {t('edit')}: {existing.name}</> : <><Icon name="plus" /> {t('newSandbox')}</>} onClose={onCancel}>
			<form onSubmit={submit} className="form">
				<label>
					{t('repoUrl')}
					<input value={repoUrl} onChange={(e) => onRepoUrl(e.target.value)} placeholder="https://bitbucket.org/workspace/repo.git" autoFocus={!existing} />
					<small>{t('repoHint')} {t('repoHintToken')}</small>
				</label>
				<label>
					{t('token')}
					<input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder={existing?.hasToken ? '••••••••' : ''} />
					<small>{existing?.hasToken ? t('tokenSet') : t('tokenHint')}</small>
				</label>
				<label>
					{t('name')}
					<input value={name} onChange={(e) => { setName(e.target.value.toLowerCase()); setNameTouched(true) }} required pattern="[a-z0-9][a-z0-9-]*" className={name && !nameOk ? 'invalid' : ''} />
					<small>{existing ? t('renameHint') : t('nameHint')}</small>
				</label>
				<label>
					{t('branch')}
					<input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={`sandbox/${name || 'name'}`} />
				</label>
				{repoUrl && (
					<div className="check-row">
						<button type="button" onClick={doCheck} disabled={check.state === 'busy'}>{check.state === 'busy' ? <Spinner /> : <Icon name="git" />} {check.state === 'busy' ? t('checking') : t('checkRepo')}</button>
						{check.state === 'ok' && (
							<span className="ok-text"><Icon name="check" size={14} /> {t('repoOk')}, {check.branches.includes(branchName) ? t('repoOkBranch', { branch: branchName }) : t('repoOkNewBranch', { branch: branchName })}</span>
						)}
						{check.state === 'fail' && <span className="error"><Icon name="alert" size={14} /> {t('repoFail')}: {humanizeError(check.error, t)}</span>}
					</div>
				)}
				<label>
					{t('instructions')}
					<textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} />
					<small>{t('instructionsHint')}</small>
				</label>
				{!existing && (
					<label className="check">
						<input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} /> {t('startNow')}
					</label>
				)}
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
					<button type="submit" className="primary" disabled={busy || !nameOk}>{existing ? t('save') : t('create')}</button>
				</div>
			</form>
		</Modal>
	)
}

createRoot(document.getElementById('root')!).render(<Root />)
