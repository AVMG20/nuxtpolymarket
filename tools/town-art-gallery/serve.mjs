// Local-only model review: no account, database writes, or gameplay API calls.
import { resolve } from 'node:path'
const root = import.meta.dir
const port = Number(process.env.TOWN_ART_PORT ?? 5176)
const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/' || url.pathname === '/index.html') return new Response(Bun.file(resolve(root, 'index.html')))
        if (url.pathname === '/gallery.js') {
            const result = await Bun.build({ entrypoints: [resolve(root, 'main.ts')], target: 'browser', minify: false, plugins: [{ name: 'nuxt-shared', setup(build) { build.onResolve({ filter: /^#shared\// }, args => ({ path: resolve(root, '../../shared', args.path.slice(8) + '.ts') })) } }], throw: false })
            if (!result.success) return new Response(result.logs.map(log => log.message).join('\n'), { status: 500 })
            return new Response(result.outputs[0], { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' } })
        }
        return new Response('Not found', { status: 404 })
    }
})
console.log(`Polytown model workshop: ${server.url}`)
