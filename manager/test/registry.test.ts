import { describe, expect, it } from 'vitest'
import { parse } from '../src/registry.js'

describe('registry image name parsing', () => {
	it('handles GHCR names', () => {
		expect(parse('ghcr.io/filipchalupa/dev-sandbox:latest')).toEqual({ registry: 'ghcr.io', repo: 'filipchalupa/dev-sandbox', tag: 'latest' })
	})
	it('defaults to latest and Docker Hub library', () => {
		expect(parse('node')).toEqual({ registry: 'registry-1.docker.io', repo: 'library/node', tag: 'latest' })
		expect(parse('someone/app:1.2')).toEqual({ registry: 'registry-1.docker.io', repo: 'someone/app', tag: '1.2' })
	})
	it('ignores a digest suffix', () => {
		expect(parse('ghcr.io/o/i:v1@sha256:abc').tag).toBe('v1')
	})
})
