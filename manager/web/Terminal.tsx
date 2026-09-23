import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Icon, useEscape } from './ui'
import { useT } from './i18n'

export function Terminal({ name, cmd, onClose }: { name: string; cmd: 'shell' | 'login' | 'claude'; onClose: () => void }) {
	const t = useT()
	const ref = useRef<HTMLDivElement>(null)
	useEscape(onClose)
	useEffect(() => {
		const el = ref.current!
		const term = new XTerm({
			cursorBlink: true,
			fontSize: 13,
			fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
			theme: { background: '#0b0d12' },
			convertEol: false,
		})
		const fit = new FitAddon()
		term.loadAddon(fit)
		term.open(el)
		fit.fit()
		const proto = location.protocol === 'https:' ? 'wss' : 'ws'
		const ws = new WebSocket(`${proto}://${location.host}/api/sandboxes/${name}/terminal?cmd=${cmd}`)
		ws.binaryType = 'arraybuffer'
		ws.onopen = () => ws.send(`\u0001resize:${term.cols}x${term.rows}`)
		ws.onmessage = (ev) => term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data))
		ws.onclose = () => term.write('\r\n[closed]\r\n')
		term.onData((d) => ws.readyState === 1 && ws.send(d))
		const onResize = () => {
			fit.fit()
			if (ws.readyState === 1) ws.send(`\u0001resize:${term.cols}x${term.rows}`)
		}
		window.addEventListener('resize', onResize)
		term.focus()
		return () => {
			window.removeEventListener('resize', onResize)
			ws.close()
			term.dispose()
		}
	}, [name, cmd])
	return (
		<div className="modal" onClick={onClose}>
			<div className="modal-body terminal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
				<div className="term-bar">
					<Icon name="terminal" />
					<span>{t('terminal')}: <strong>{name}</strong>{cmd !== 'shell' && <span className="muted"> · {cmd}</span>}</span>
					<span className="grow" />
					<button className="icon-btn" onClick={onClose} aria-label={t('close')}><Icon name="x" /></button>
				</div>
				<div ref={ref} className="xterm-host" />
			</div>
		</div>
	)
}
