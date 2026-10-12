// Hero Quest art exporter.
//
//   bun run art:hero-quest                         export every asset to public/hero-quest/sprites/
//   bun run art:hero-quest --out <dir>             …somewhere else
//   bun run art:hero-quest sheet <out.png> <group> [id-prefix…] [--scale N] [--max N]
//                                                  one review contact sheet: a row per asset
//
// Each asset exports as one horizontal strip, `<id>.png` (frames left to right at the frame
// size), written as an indexed PNG on the game palette. `manifest.json` lists every strip
// with its frame size, count, fps and loop flag — what a Pixi loader needs to slice it.
//
// The art is procedural (app/utils/hero-quest-art); these files are a rendering of it, so
// regenerate rather than hand-edit.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Surface, rect } from '../app/utils/hero-quest-art/surface'
import { C, PALETTE_RGB } from '../app/utils/hero-quest-art/palette'
import { allArt, type ArtAsset } from '../app/utils/hero-quest-art/catalog'
import { encodeIndexedPng } from './lib/png'

const args = process.argv.slice(2)

function flag(name: string, fallback: string): string {
    const i = args.indexOf(name)
    if (i < 0) return fallback
    const v = args[i + 1]!
    args.splice(i, 2)
    return v
}

function strip(a: ArtAsset, maxFrames = Infinity, pick: number[] | null = null, preview = false): Surface {
    const list = pick ? pick.filter(f => f < a.frames) : Array.from({ length: Math.min(a.frames, maxFrames) }, (_, i) => i)
    const n = list.length
    const out = new Surface(a.w * Math.max(1, n), a.h, 0, 0)
    const frame = new Surface(a.w, a.h, 0, 0)
    for (let f = 0; f < n; f++) {
        frame.clear()
        if (preview && a.underlay) a.underlay(frame)
        a.render(frame, list[f]!)
        for (let y = 0; y < a.h; y++) out.data.set(frame.data.subarray(y * a.w, (y + 1) * a.w), y * out.w + f * a.w)
    }
    return out
}

if (args[0] === 'sheet') {
    const scale = Number(flag('--scale', '3'))
    const max = Number(flag('--max', '16'))
    const pickArg = flag('--pick', '')
    const pick = pickArg ? pickArg.split(',').map(Number) : null
    const grid = Number(flag('--grid', '0'))
    const [, out, group, ...prefixes] = args
    const assets = allArt().filter(a => a.group === group && (prefixes.length === 0 || prefixes.some(p => a.id.startsWith(p))))
    if (!assets.length) throw new Error(`no assets in ${group} ${prefixes.join(' ')}`)
    const cols = (a: ArtAsset) => pick ? pick.filter(f => f < a.frames).length : Math.min(a.frames, max)
    if (grid > 0) {
        const cw = Math.max(...assets.map(a => a.w)) + 4
        const ch = Math.max(...assets.map(a => a.h)) + 4
        const rows = Math.ceil(assets.length / grid)
        const sheet = new Surface(cw * grid, ch * rows, 0, 0)
        rect(sheet, 0, 0, sheet.w, sheet.h, C.night1)
        assets.forEach((a, i) => {
            const gx = (i % grid) * cw
            const gy = Math.floor(i / grid) * ch
            if (((i % grid) + Math.floor(i / grid)) & 1) rect(sheet, gx, gy, cw, ch, C.night2)
            const s = strip(a, 1, pick ?? [0], true)
            for (let yy = 0; yy < a.h; yy++) for (let xx = 0; xx < a.w; xx++) {
                const c = s.data[yy * s.w + xx]!
                if (c) sheet.data[(gy + 2 + yy) * sheet.w + gx + 2 + xx] = c
            }
        })
        writeFileSync(out!, encodeIndexedPng(sheet.w, sheet.h, sheet.data, PALETTE_RGB, scale))
        console.log(`${assets.length} assets → ${out} grid`)
        process.exit(0)
    }
    const W = Math.max(...assets.map(a => a.w * cols(a)))
    const H = assets.reduce((h, a) => h + a.h, 0)
    const sheet = new Surface(W, H, 0, 0)
    rect(sheet, 0, 0, W, H, C.night1)
    let y = 0
    assets.forEach((a, r) => {
        const n = cols(a)
        for (let f = 0; f < n; f++) if ((r + f) & 1) rect(sheet, f * a.w, y, a.w, a.h, C.night2)
        const s = strip(a, max, pick, true)
        for (let yy = 0; yy < a.h; yy++) {
            for (let xx = 0; xx < s.w; xx++) {
                const c = s.data[yy * s.w + xx]!
                if (c) sheet.data[(y + yy) * W + xx] = c
            }
        }
        y += a.h
    })
    writeFileSync(out!, encodeIndexedPng(sheet.w, sheet.h, sheet.data, PALETTE_RGB, scale))
    console.log(`${assets.length} assets → ${out} (${W}×${H} @${scale}x)`)
} else {
    const outDir = flag('--out', 'public/hero-quest/sprites')
    const manifest: Record<string, { w: number, h: number, frames: number, fps: number, loop: boolean, group: string, section: string, label: string }> = {}
    const t0 = Date.now()
    for (const a of allArt()) {
        const s = strip(a)
        const file = join(outDir, `${a.id}.png`)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, encodeIndexedPng(s.w, s.h, s.data, PALETTE_RGB))
        manifest[a.id] = { w: a.w, h: a.h, frames: a.frames, fps: a.fps, loop: a.loop, group: a.group, section: a.section, label: a.label }
    }
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1))
    console.log(`${Object.keys(manifest).length} assets → ${outDir} in ${Date.now() - t0} ms`)
}
