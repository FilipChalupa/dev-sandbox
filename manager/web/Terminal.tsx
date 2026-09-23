import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export function Terminal({ name, cmd, onClose }: { name: string; cmd: 'shell' | 'login' | 'claude'; onClose: () => void }) {
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const el = ref.current!
		const term = new XTerm({ cursorBlink: true, fontSize: 14, convertEol: false })
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
			<div className="modal-body terminal" onClick={(e) => e.stopPropagation()}>
				<div ref={ref} className="xterm-host" />
			</div>
		</div>
	)
}
