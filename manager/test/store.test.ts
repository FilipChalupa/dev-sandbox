import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-test-'))
process.env.SANDBOXES_DATA_DIR = dir
process.env.SANDBOXES_HOST_DIR = dir
const store = await import('../src/store.js')

describe('splitCredentials', () => {
	it('separates user and token from an https URL', () => {
		expect(store.splitCredentials('https://x-token-auth:ATC123@bitbucket.org/ws/repo.git')).toEqual({
			url: 'https://bitbucket.org/ws/repo.git',
			username: 'x-token-auth',
			token: 'ATC123',
		})
	})
	it('treats a lone user part as the token', () => {
		expect(store.splitCredentials('https://TOKEN@github.com/o/r.git')).toEqual({ url: 'https://github.com/o/r.git', username: '', token: 'TOKEN' })
	})
	it('leaves clean and ssh URLs alone', () => {
		expect(store.splitCredentials('https://bitbucket.org/ws/repo.git').token).toBe('')
		expect(store.splitCredentials('git@bitbucket.org:ws/repo.git')).toEqual({ url: 'git@bitbucket.org:ws/repo.git', username: '', token: '' })
	})
	it('decodes percent-encoded tokens', () => {
		expect(store.splitCredentials('https://u:a%2Fb@host/r.git').token).toBe('a/b')
	})
})

describe('sandbox store', () => {
	beforeEach(async () => {
		await fs.rm(path.join(dir, '.manager'), { recursive: true, force: true })
	})
	it('validates names', () => {
		expect(store.validName('my-site')).toBe(true)
		expect(store.validName('My Site')).toBe(false)
		expect(store.validName('-x')).toBe(false)
	})
	it('allocates distinct host ports and keeps tokens out of the config', async () => {
		const a = await store.create({ name: 'a', repoUrl: 'https://x:T1@bitbucket.org/w/a.git' })
		const b = await store.create({ name: 'b' })
		expect(a.hostPort).toBe(3001)
		expect(b.hostPort).toBe(3002)
		expect(a.repoUrl).toBe('https://bitbucket.org/w/a.git')
		expect(a.gitUsername).toBe('x')
		expect(await store.hasToken('a')).toBe(true)
		expect(await store.hasToken('b')).toBe(false)
		const raw = await fs.readFile(path.join(dir, '.manager', 'sandboxes.json'), 'utf8')
		expect(raw).not.toContain('T1')
		expect(store.lanPort(a)).toBe(13001)
	})
	it('rejects duplicates and bad names', async () => {
		await store.create({ name: 'dup' })
		await expect(store.create({ name: 'dup' })).rejects.toThrow()
		await expect(store.create({ name: 'Bad Name' })).rejects.toThrow()
	})
	it('writes developer instructions next to the state', async () => {
		await store.create({ name: 'i', instructions: 'Only touch web/.' })
		expect(await fs.readFile(path.join(dir, '.manager', 'i', 'instructions.md'), 'utf8')).toBe('Only touch web/.\n')
		await store.update('i', { instructions: '' })
		await expect(fs.stat(path.join(dir, '.manager', 'i', 'instructions.md'))).rejects.toThrow()
	})
})
