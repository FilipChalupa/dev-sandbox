// Small building blocks for the manager UI: icons, pills, a dropdown menu,
// toasts, relative time, skeletons and keyboard helpers.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from './i18n'

// Inline SVG icons (Lucide shapes), so the page needs no icon font.
const paths: Record<string, string> = {
	play: 'M6 4l14 8-14 8z',
	stop: 'M6 6h12v12H6z',
	settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
	trash: 'M3 6h18M8 6V4h8v2m-9 0v14h10V6M10 11v6M14 11v6',
	terminal: 'M4 17l6-5-6-5M12 19h8',
	log: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
	refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
	external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
	share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13',
	send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
	copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
	check: 'M20 6L9 17l-5-5',
	more: 'M5 12h.01M12 12h.01M19 12h.01',
	plus: 'M12 5v14M5 12h14',
	globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
	phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01',
	alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
	x: 'M18 6L6 18M6 6l12 12',
	chevron: 'M6 9l6 6 6-6',
	login: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
	stethoscope: 'M4 4v6a6 6 0 0 0 12 0V4M8 2v4M12 2v4M16 14v3a4 4 0 0 0 8 0v-1M20 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
	git: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
	folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
	restart: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
	history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3',
	bolt: 'M13 2L3 14h9l-1 8 10-12h-9z',
	language: 'M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6',
	qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM14 21h1M21 14h-1',
}

export function Icon({ name, size = 16 }: { name: keyof typeof paths | string; size?: number }) {
	return (
		<svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d={paths[name] ?? ''} />
		</svg>
	)
}

export type Tone = 'on' | 'off' | 'warn' | 'error' | 'info' | 'work'

export function Pill({ tone, children, pulse }: { tone: Tone; children: ReactNode; pulse?: boolean }) {
	return (
		<span className={`pill ${tone}`}>
			<span className={`dot ${tone}${pulse ? ' pulse' : ''}`} />
			{children}
		</span>
	)
}

// Dropdown opened by a button; closes on outside click and Escape.
export function Menu({ label, icon, items, align = 'right', badge }: {
	label?: string
	icon?: string
	badge?: boolean
	align?: 'left' | 'right'
	items: ({ label: string; icon?: string; onClick: () => void; danger?: boolean; badge?: boolean; disabled?: boolean } | 'sep' | { custom: ReactNode })[]
}) {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!open) return
		const onDown = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false)
		}
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
		document.addEventListener('mousedown', onDown)
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('mousedown', onDown)
			document.removeEventListener('keydown', onKey)
		}
	}, [open])
	return (
		<div className="menu" ref={ref}>
			<button className={label ? '' : 'icon-btn'} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={label}>
				{icon && <Icon name={icon} />}
				{label}
				{badge && <span className="badge-dot" />}
			</button>
			{open && (
				<div className={`menu-list ${align}`} role="menu">
					{items.map((it, i) =>
						it === 'sep' ? (
							<hr key={i} />
						) : 'custom' in it ? (
							<div key={i} className="menu-custom">{it.custom}</div>
						) : (
							<button
								key={i}
								role="menuitem"
								className={`menu-item${it.danger ? ' danger' : ''}`}
								disabled={it.disabled}
								onClick={() => {
									setOpen(false)
									it.onClick()
								}}
							>
								{it.icon && <Icon name={it.icon} />}
								<span>{it.label}</span>
								{it.badge && <span className="badge">•</span>}
							</button>
						),
					)}
				</div>
			)}
		</div>
	)
}

// Toasts: short confirmations vanish, errors stay until closed.
type Toast = { id: number; tone: 'ok' | 'error' | 'info'; text: string }
const ToastContext = createContext<{ toast: (tone: Toast['tone'], text: string) => void }>({ toast: () => {} })
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
	const [list, setList] = useState<Toast[]>([])
	const remove = (id: number) => setList((l) => l.filter((t) => t.id !== id))
	const toast = (tone: Toast['tone'], text: string) => {
		const id = Date.now() + Math.random()
		setList((l) => [...l.slice(-4), { id, tone, text }])
		if (tone !== 'error') setTimeout(() => remove(id), 4000)
	}
	return (
		<ToastContext.Provider value={{ toast }}>
			{children}
			<div className="toasts" aria-live="polite">
				{list.map((t) => (
					<div key={t.id} className={`toast ${t.tone}`}>
						<Icon name={t.tone === 'ok' ? 'check' : t.tone === 'error' ? 'alert' : 'bolt'} />
						<span>{t.text}</span>
						<button className="icon-btn" onClick={() => remove(t.id)} aria-label="close"><Icon name="x" size={14} /></button>
					</div>
				))}
			</div>
		</ToastContext.Provider>
	)
}

// "3 min ago" with the absolute time on hover; re-renders every 30 s.
export function Rel({ iso, lang }: { iso: string; lang: string }) {
	const t = useT()
	const [, tick] = useState(0)
	useEffect(() => {
		const id = setInterval(() => tick((n) => n + 1), 30_000)
		return () => clearInterval(id)
	}, [])
	if (!iso) return null
	const ms = Date.parse(iso) - Date.now()
	const abs = Math.abs(ms)
	const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
	const text =
		abs < 60_000 ? t('justNow')
		: abs < 3600_000 ? rtf.format(Math.round(ms / 60_000), 'minute')
		: abs < 86400_000 ? rtf.format(Math.round(ms / 3600_000), 'hour')
		: rtf.format(Math.round(ms / 86400_000), 'day')
	return <time dateTime={iso} title={new Date(iso).toLocaleString(lang)}>{text}</time>
}

export const isRecent = (iso: string, ms: number) => Boolean(iso) && Date.now() - Date.parse(iso) < ms

export function Spinner() {
	return <span className="spinner" aria-hidden="true" />
}

export function Skeleton() {
	return (
		<ul className="cards" aria-hidden="true">
			{[0, 1].map((i) => (
				<li key={i} className="card skeleton">
					<div className="sk sk-title" />
					<div className="sk sk-line" />
					<div className="sk sk-line short" />
				</li>
			))}
		</ul>
	)
}

export function useEscape(onEscape: () => void) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onEscape()
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [onEscape])
}

// Modal shell: backdrop click and Escape close it.
export function Modal({ title, onClose, children, wide, className = '' }: { title?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
	useEscape(onClose)
	const t = useT()
	return (
		<div className="modal" onClick={onClose}>
			<div className={`modal-body${wide ? ' wide' : ''} ${className}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
				{title !== undefined && (
					<div className="modal-head">
						<h2>{title}</h2>
						<button className="icon-btn" onClick={onClose} aria-label={t('close')}><Icon name="x" /></button>
					</div>
				)}
				{children}
			</div>
		</div>
	)
}

// Turns Docker's and the sandbox's error strings into something a person can act on.
export function humanizeError(msg: string, t: ReturnType<typeof useT>): string {
	const port = /Bind for [\d.]+:(\d+) failed|port is already allocated/i.exec(msg)
	if (port) return t('errPort', { port: port[1] ?? '' })
	if (/No such image|pull access denied|manifest unknown/i.test(msg)) return t('errImage')
	if (/docker\.sock|ECONNREFUSED|ENOENT.*docker|connect EACCES/i.test(msg)) return t('errDocker')
	if (/timed out|timeout/i.test(msg)) return t('errTimeout')
	if (/is not running/i.test(msg)) return t('errNotRunning')
	if (/no git identity/i.test(msg)) return t('errNoIdentity')
	if (/push failed|rejected/i.test(msg)) return t('errPush', { detail: msg.split('\n').pop() ?? '' })
	if (/no remote configured/i.test(msg)) return t('errNoRemote')
	return msg
}
