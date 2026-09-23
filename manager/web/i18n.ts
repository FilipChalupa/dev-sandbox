import { createContext, useContext } from 'react'

export type Dictionary = typeof cs
const cs = {
	title: 'Sandboxy',
	newSandbox: 'Nový sandbox',
	name: 'Název',
	nameHint: 'malá písmena, číslice a pomlčky, např. muj-web',
	repoUrl: 'Adresa git repozitáře',
	repoHint: 'může zůstat prázdné, doplníš později',
	token: 'Token pro git',
	tokenHint: 'dostaneš od vývojáře; má právo číst a pushovat',
	tokenSet: 'token je nastavený',
	branch: 'Větev',
	create: 'Vytvořit',
	cancel: 'Zrušit',
	save: 'Uložit',
	start: 'Spustit',
	stop: 'Zastavit',
	restart: 'Restartovat',
	delete: 'Smazat',
	deleteConfirm: 'Smazat sandbox „{name}“? Soubory projektu ve složce zůstanou, pokud nezvolíš i jejich smazání.',
	deleteFiles: 'Smazat i soubory projektu',
	edit: 'Nastavení',
	logs: 'Log',
	terminal: 'Terminál',
	loginClaude: 'Přihlásit Claude',
	openClaude: 'Otevřít v claude.ai',
	openPreview: 'Otevřít náhled',
	shared: 'Sdílený náhled',
	password: 'heslo',
	running: 'běží',
	stopped: 'zastaveno',
	starting: 'startuje…',
	needsLogin: 'čeká na přihlášení Claude',
	notLoggedInHint: 'Claude ještě není přihlášený. Klikni na „Přihlásit Claude“, v terminálu otevři odkaz, přihlas se a vlož kód.',
	uncommitted: '{n} neuložených změn',
	unpushed: '{n} neodeslaných commitů',
	clean: 'vše uložené a odeslané',
	lastCommit: 'poslední commit',
	update: 'Aktualizovat',
	updating: 'Stahuji novou verzi…',
	updated: 'Hotovo. Restartuj sandboxy, aby použily novou verzi.',
	empty: 'Zatím žádný sandbox. Vytvoř první.',
	loading: 'Načítám…',
	error: 'Chyba',
	noRemote: 'bez git repozitáře',
	folder: 'složka',
	close: 'Zavřít',
	language: 'Jazyk',
}
const en: Dictionary = {
	title: 'Sandboxes',
	newSandbox: 'New sandbox',
	name: 'Name',
	nameHint: 'lowercase letters, digits and dashes, e.g. my-site',
	repoUrl: 'Git repository URL',
	repoHint: 'can stay empty and be added later',
	token: 'Git token',
	tokenHint: 'from your developer; needs read and push rights',
	tokenSet: 'token is set',
	branch: 'Branch',
	create: 'Create',
	cancel: 'Cancel',
	save: 'Save',
	start: 'Start',
	stop: 'Stop',
	restart: 'Restart',
	delete: 'Delete',
	deleteConfirm: 'Delete sandbox "{name}"? The project files stay in their folder unless you choose to delete them too.',
	deleteFiles: 'Also delete the project files',
	edit: 'Settings',
	logs: 'Log',
	terminal: 'Terminal',
	loginClaude: 'Log in to Claude',
	openClaude: 'Open in claude.ai',
	openPreview: 'Open preview',
	shared: 'Shared preview',
	password: 'password',
	running: 'running',
	stopped: 'stopped',
	starting: 'starting…',
	needsLogin: 'waiting for Claude login',
	notLoggedInHint: 'Claude is not logged in yet. Click "Log in to Claude", open the link shown in the terminal, sign in and paste the code.',
	uncommitted: '{n} unsaved changes',
	unpushed: '{n} commits not pushed',
	clean: 'everything saved and pushed',
	lastCommit: 'last commit',
	update: 'Update',
	updating: 'Downloading the new version…',
	updated: 'Done. Restart the sandboxes to use the new version.',
	empty: 'No sandboxes yet. Create the first one.',
	loading: 'Loading…',
	error: 'Error',
	noRemote: 'no git repository',
	folder: 'folder',
	close: 'Close',
	language: 'Language',
}

// Add a language: a new dictionary above and one line here.
export const languages: Record<string, { name: string; dict: Dictionary }> = {
	en: { name: 'English', dict: en },
	cs: { name: 'Čeština', dict: cs },
}
export type Lang = keyof typeof languages

const STORAGE_KEY = 'sandbox-manager.lang'

export function detectLang(): Lang {
	try {
		const saved = localStorage.getItem(STORAGE_KEY)
		if (saved && saved in languages) return saved
	} catch {}
	const wanted = navigator.languages ?? [navigator.language]
	for (const l of wanted) {
		const short = l.toLowerCase().split('-')[0]
		if (short in languages) return short
	}
	return 'en'
}

export function saveLang(lang: Lang) {
	try {
		localStorage.setItem(STORAGE_KEY, lang)
	} catch {}
}

export const LangContext = createContext<Lang>('en')

export type Translate = (key: keyof Dictionary, vars?: Record<string, string | number>) => string

export function useT(): Translate {
	const lang = useContext(LangContext)
	const dict = languages[lang]?.dict ?? en
	return (key, vars = {}) => dict[key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}
