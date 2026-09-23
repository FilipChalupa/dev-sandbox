import { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { api, type Sandbox } from './api'
import { t } from './i18n'
import { Terminal } from './Terminal'
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
		const id = setInterval(refresh, 5000)
		return () => clearInterval(id)
	}, [])
	return { list, error, refresh, setError }
}

function App() {
	const { list, error, refresh, setError } = useSandboxes()
	const [creating, setCreating] = useState(false)
	const [editing, setEditing] = useState<Sandbox | null>(null)
	const [term, setTerm] = useState<{ name: string; cmd: 'shell' | 'login' | 'claude' } | null>(null)
	const [logs, setLogs] = useState<{ name: string; text: string } | null>(null)
	const [updateMsg, setUpdateMsg] = useState('')

	const run = async (fn: () => Promise<unknown>) => {
		try {
			await fn()
			await refresh()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}

	const updateImage = async () => {
		setUpdateMsg(t('updating'))
		try {
			await api.update_image()
			setUpdateMsg(t('updated'))
		} catch (e) {
			setUpdateMsg(`${t('error')}: ${e instanceof Error ? e.message : e}`)
		}
	}

	return (
		<main>
			<header>
				<h1>{t('title')}</h1>
				<div className="actions">
					<button onClick={updateImage}>{t('update')}</button>
					<button className="primary" onClick={() => setCreating(true)}>{t('newSandbox')}</button>
				</div>
			</header>
			{updateMsg && <p className="note">{updateMsg}</p>}
			{error && <p className="error">{t('error')}: {error}</p>}
			{list === null ? (
				<p>{t('loading')}</p>
			) : list.length === 0 ? (
				<p className="empty">{t('empty')}</p>
			) : (
				<ul className="cards">
					{list.map((s) => (
						<SandboxCard
							key={s.name}
							s={s}
							onStart={() => run(() => api.start(s.name))}
							onStop={() => run(() => api.stop(s.name))}
							onDelete={() => {
								if (!confirm(t('deleteConfirm', { name: s.name }))) return
								const files = confirm(t('deleteFiles'))
								run(() => api.remove(s.name, files))
							}}
							onEdit={() => setEditing(s)}
							onTerminal={(cmd) => setTerm({ name: s.name, cmd })}
							onLogs={async () => setLogs({ name: s.name, text: await api.logs(s.name) })}
						/>
					))}
				</ul>
			)}
			{creating && (
				<SandboxForm
					onCancel={() => setCreating(false)}
					onSubmit={async (body) => {
						await run(() => api.create(body))
						setCreating(false)
					}}
				/>
			)}
			{editing && (
				<SandboxForm
					existing={editing}
					onCancel={() => setEditing(null)}
					onSubmit={async (body) => {
						await run(() => api.update(editing.name, body))
						setEditing(null)
					}}
				/>
			)}
			{term && <Terminal name={term.name} cmd={term.cmd} onClose={() => setTerm(null)} />}
			{logs && (
				<div className="modal" onClick={() => setLogs(null)}>
					<div className="modal-body" onClick={(e) => e.stopPropagation()}>
						<h2>{t('logs')}: {logs.name}</h2>
						<pre className="logs">{logs.text || '…'}</pre>
						<div className="actions"><button onClick={() => setLogs(null)}>{t('close')}</button></div>
					</div>
				</div>
			)}
		</main>
	)
}

function SandboxCard(props: {
	s: Sandbox
	onStart: () => void
	onStop: () => void
	onDelete: () => void
	onEdit: () => void
	onTerminal: (cmd: 'shell' | 'login' | 'claude') => void
	onLogs: () => void
}) {
	const { s } = props
	const running = s.container.running
	const st = s.status
	const needsLogin = running && st && !st.claude.loggedIn
	const state = !running ? t('stopped') : !st ? t('starting') : needsLogin ? t('needsLogin') : t('running')
	const cls = !running ? 'off' : needsLogin || !st ? 'warn' : 'on'
	return (
		<li className={`card ${cls}`}>
			<div className="card-head">
				<span className={`dot ${cls}`} />
				<h2>{s.name}</h2>
				<span className="state">{state}</span>
				<span className="grow" />
				{running ? (
					<button onClick={props.onStop}>{t('stop')}</button>
				) : (
					<button className="primary" onClick={props.onStart}>{t('start')}</button>
				)}
				<button onClick={props.onEdit}>{t('edit')}</button>
			</div>
			<div className="meta">
				<span>{s.repoUrl ? s.repoUrl.replace(/^https?:\/\//, '') : t('noRemote')}</span>
				<span>{t('branch')}: {st?.git.branch || s.branch}</span>
				<span>{t('folder')}: ~/Sandboxes/{s.name}</span>
			</div>
			{running && st && (
				<>
					{needsLogin && <p className="hint">{t('notLoggedInHint')}</p>}
					<div className="links">
						{needsLogin ? (
							<button className="primary" onClick={() => props.onTerminal('login')}>{t('loginClaude')}</button>
						) : st.claude.sessionUrl ? (
							<a className="button primary" href={st.claude.sessionUrl} target="_blank" rel="noreferrer">{t('openClaude')}</a>
						) : (
							<a className="button primary" href="https://claude.ai/code" target="_blank" rel="noreferrer">{t('openClaude')}</a>
						)}
						<a className="button" href={st.preview.url} target="_blank" rel="noreferrer">{t('openPreview')}</a>
						{st.preview.tunnelUrl && (
							<span className="shared">
								{t('shared')}: <a href={st.preview.tunnelUrl} target="_blank" rel="noreferrer">{st.preview.tunnelUrl}</a>
								{' '}({st.preview.user} / {t('password')}: <code>{st.preview.password}</code>)
							</span>
						)}
					</div>
					<div className="git">
						{st.git.dirty > 0 && <span className="warn-text">{t('uncommitted', { n: st.git.dirty })}</span>}
						{st.git.ahead > 0 && <span className="warn-text">{t('unpushed', { n: st.git.ahead })}</span>}
						{st.git.dirty === 0 && st.git.ahead === 0 && <span>{t('clean')}</span>}
						{st.git.lastCommit && <span className="muted">{t('lastCommit')}: {st.git.lastCommit}</span>}
					</div>
				</>
			)}
			<div className="tools">
				{running && <button className="link" onClick={() => props.onTerminal('shell')}>{t('terminal')}</button>}
				<button className="link" onClick={props.onLogs}>{t('logs')}</button>
				<button className="link danger" onClick={props.onDelete}>{t('delete')}</button>
			</div>
		</li>
	)
}

function SandboxForm({ existing, onSubmit, onCancel }: { existing?: Sandbox; onSubmit: (body: object) => Promise<void>; onCancel: () => void }) {
	const [name, setName] = useState(existing?.name ?? '')
	const [repoUrl, setRepoUrl] = useState(existing?.repoUrl ?? '')
	const [token, setToken] = useState('')
	const [branch, setBranch] = useState(existing?.branch ?? '')
	const [busy, setBusy] = useState(false)
	const submit = async (e: FormEvent) => {
		e.preventDefault()
		setBusy(true)
		const body: Record<string, unknown> = { repoUrl, branch: branch || undefined }
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
				<div className="actions">
					<button type="button" onClick={onCancel}>{t('cancel')}</button>
					<button type="submit" className="primary" disabled={busy}>{existing ? t('save') : t('create')}</button>
				</div>
			</form>
		</div>
	)
}

createRoot(document.getElementById('root')!).render(<App />)
