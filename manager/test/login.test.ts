import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { account } from '../src/login.js'

async function claudeDir(credentials: unknown, email = 'a@example.com') {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-test-'))
	await fs.writeFile(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: email } }))
	if (credentials !== undefined) await fs.writeFile(path.join(dir, '.credentials.json'), JSON.stringify(credentials))
	return dir
}

describe('account', () => {
	it('is logged in with a token', async () => {
		const dir = await claudeDir({ claudeAiOauth: { accessToken: 'sk-a', refreshToken: 'sk-r', expiresAt: 1 } })
		expect(await account(dir)).toEqual({ ok: true, detail: 'a@example.com' })
	})
	it('is not logged in when the CLI emptied the tokens of an expired login', async () => {
		const dir = await claudeDir({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0 } })
		expect(await account(dir)).toEqual({ ok: false, detail: 'a@example.com' })
	})
	it('is not logged in without credentials', async () => {
		expect((await account(await claudeDir(undefined))).ok).toBe(false)
		expect((await account(path.join(os.tmpdir(), 'no-such-claude-dir'))).ok).toBe(false)
	})
})
