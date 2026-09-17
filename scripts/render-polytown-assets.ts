// Regenerate maintained building portraits from the real game models.
// Run with bun, open the printed local URL, then click Render all portraits.
// The temporary browser bundle stays outside the repository.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { TOWN_BUILDINGS } from '../shared/utils/gamelogic/town'

const root = dirname(import.meta.dirname)
const temp = await mkdtemp(join(tmpdir(), 'polytown-assets-'))
const result = await Bun.build({
    entrypoints: [join(root, 'scripts/lib/polytown-asset-studio.ts')],
    outdir: temp,
    target: 'browser'
})
if (!result.success) throw new Error(result.logs.join('\n'))
const allowed = new Set(TOWN_BUILDINGS.filter(b => b.kind !== 'road').flatMap(b => Array.from({ length: 20 }, (_, i) => `${b.id}${i ? `-${i + 1}` : ''}.png`)))
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Polytown · Building progression</title><style>
*{box-sizing:border-box}body{margin:0;padding:28px;background:#193b3d;color:#f4e9ce;font:14px system-ui}header{position:sticky;top:0;z-index:1;background:#193b3df5;padding:14px 0;border-bottom:1px solid #54776b}h1{font:32px Georgia;margin:0 0 8px}h2{font:22px Georgia;margin:25px 0 10px}p,small{color:#a9c9be}button{padding:9px 14px;background:#e8c77d;color:#203f3b;border:0;border-radius:8px;cursor:pointer;margin-right:20px}.variants{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}figure{margin:0;padding:6px 6px 12px;background:radial-gradient(ellipse at 50% 35%,#497568,#2d504b);border:1px solid #63847955;border-radius:14px;text-align:center}img{width:100%;aspect-ratio:1;object-fit:contain}figcaption{font-weight:650}small{font-size:10px}.intermediate{display:none}.all-levels .intermediate{display:block}
</style></head><body><header><h1>Polytown · A town that grows</h1><p id="status">15 families · 20 levels · 5 architectural stages</p><button>Render all portraits</button><label><input type="checkbox"> Show every level</label></header><main></main><script type="module" src="/studio.js"></script></body></html>`
const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
        const path = new URL(req.url).pathname
        if (req.method === 'GET' && path === '/') return new Response(html, { headers: { 'content-type': 'text/html' } })
        if (req.method === 'GET' && path === '/studio.js') return new Response(Bun.file(result.outputs[0]!.path))
        const name = path.slice('/save/'.length)
        if (req.method === 'POST' && path.startsWith('/save/') && allowed.has(name)) {
            const data = new Uint8Array(await req.arrayBuffer())
            if (data.length > 1_000_000 || data[0] !== 137 || data[1] !== 80 || data[2] !== 78 || data[3] !== 71) return new Response('Expected PNG', { status: 400 })
            await Bun.write(join(root, 'public/town/buildings', name), data)
            return new Response('Saved')
        }
        return new Response('Not found', { status: 404 })
    }
})
console.log(`Polytown asset studio: ${server.url}`)
