import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')
const ctx = await esbuild.context({
	entryPoints: { app: 'web/main.tsx' },
	bundle: true,
	outdir: 'public',
	format: 'esm',
	sourcemap: true,
	minify: !watch,
	loader: { '.css': 'css' },
	charset: 'utf8',
	logLevel: 'info',
})
if (watch) await ctx.watch()
else { await ctx.rebuild(); await ctx.dispose() }
