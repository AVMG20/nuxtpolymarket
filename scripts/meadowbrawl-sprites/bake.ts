// Bakes Meadowbrawl's character sprite sheets from CC0 KayKit glTF packs.
//
//   bun scripts/meadowbrawl-sprites/bake.ts <dir-with-extracted-packs>
//
// Needs playwright-core resolvable from the packs directory (the baker runs
// three.js inside headless Chromium so the WebGL output is what you get in a
// browser). Writes public/meadowbrawl/sprites/<sheet>.webp and atlas.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SHEETS } from './spec'

const packs = resolve(process.argv[2] ?? '.')
const outDir = resolve(import.meta.dir, '../../public/meadowbrawl/sprites')
mkdirSync(outDir, { recursive: true })
const { chromium } = await import(resolve(packs, 'node_modules/playwright-core'))

const bundle = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'bake-entry.ts')], target: 'browser' })
if (!bundle.success) throw new Error(bundle.logs.map(l => String(l)).join('\n'))
const js = await bundle.outputs[0]!.text()

const server = Bun.serve({
    port: 4181,
    fetch(req) {
        const p = decodeURIComponent(new URL(req.url).pathname)
        if (p === '/') return new Response('<script type=module src="/bake.js"></script>', { headers: { 'content-type': 'text/html' } })
        if (p === '/bake.js') return new Response(js, { headers: { 'content-type': 'text/javascript' } })
        return new Response(Bun.file(packs + p))
    }
})
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage()
page.on('pageerror', e => console.log('PAGEERROR', e.message))
await page.goto('http://localhost:4181/')
await page.waitForFunction(() => (window as any).ready, null, { timeout: 60000 })

const atlas: Record<string, unknown> = {}
const only = process.argv[3]
for (const spec of SHEETS) {
    if (only && spec.name !== only) continue
    const t0 = performance.now()
    const r = await page.evaluate((s) => (window as any).bake(s), spec)
    const bytes = Buffer.from(r.png, 'base64')
    writeFileSync(resolve(outDir, `${spec.name}.webp`), bytes)
    atlas[spec.name] = r.atlas
    console.log(`${spec.name}: ${(bytes.length / 1024).toFixed(0)} KB, ${Object.keys(r.atlas.anims).length} anims, ${((performance.now() - t0) / 1000).toFixed(1)}s`)
}
if (!only) writeFileSync(resolve(outDir, 'atlas.json'), JSON.stringify(atlas))
else {
    const existing = await Bun.file(resolve(outDir, 'atlas.json')).json().catch(() => ({}))
    writeFileSync(resolve(outDir, 'atlas.json'), JSON.stringify({ ...existing, ...atlas }))
}
await browser.close()
server.stop()
