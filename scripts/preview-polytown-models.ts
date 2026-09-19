// Look at every Polytown building, at every stage, outside the game.
// Run with bun and open the printed URL. Query: tx, tz, dist, yaw, pitch.
// The temporary browser bundle stays outside the repository.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const root = dirname(import.meta.dirname)
const temp = await mkdtemp(join(tmpdir(), 'polytown-preview-'))
const result = await Bun.build({
    entrypoints: [join(root, 'scripts/lib/polytown-model-preview.ts')],
    outdir: temp,
    target: 'browser',
    // Nuxt's #shared alias, for the game rules the models import.
    plugins: [{
        name: 'shared-alias',
        setup(build) {
            build.onResolve({ filter: /^#shared\// }, args => ({ path: `${join(root, 'shared', args.path.slice('#shared/'.length))}.ts` }))
        }
    }]
})
if (!result.success) throw new Error(result.logs.join('\n'))
const html = '<!doctype html><html><head><meta charset="utf-8"><title>Polytown models</title><style>html,body{margin:0;overflow:hidden}canvas{display:block}</style></head><body><script type="module" src="/preview.js"></script></body></html>'
const server = Bun.serve({
    hostname: '127.0.0.1',
    port: Number(process.env.PORT ?? 0),
    fetch(req) {
        const path = new URL(req.url).pathname
        if (path === '/') return new Response(html, { headers: { 'content-type': 'text/html' } })
        if (path === '/preview.js') return new Response(Bun.file(result.outputs[0]!.path))
        return new Response('Not found', { status: 404 })
    }
})
console.log(`Polytown model preview: ${server.url}`)
