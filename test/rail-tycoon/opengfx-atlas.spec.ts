import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import {
    DIRECTIONS,
    INDUSTRY_LAYOUTS,
    OPENGFX_COMMIT,
    SCRIPT_PATH,
    SLOPES,
    blockSprites,
    createPnml,
    defaultSourceDir,
    evaluate,
    extractOpenGfx,
    parsePnml
} from '../../scripts/rail-tycoon/extract-opengfx'

const outDir = resolve(import.meta.dirname, '../../public/rail-tycoon/opengfx')
const read = (name: string) => readFileSync(join(outDir, name))
const atlasJson = () => JSON.parse(read('atlas.json').toString('utf8')) as {
    meta: { commit: string, size: { w: number, h: number } }
    sprites: Record<string, { x: number, y: number, w: number, h: number, ox: number, oy: number }>
}

/** Every name the renderer asks for. */
function requiredNames(): string[] {
    const names: string[] = []
    const facings = ['to-sw', 'to-ne', 'to-se', 'to-nw', 'to-e', 'to-w', 'to-s', 'to-n']
    const sides = ['ne', 'se', 'sw', 'nw']
    for (const s of SLOPES) names.push(`terrain.grass.${s.name}`, `terrain.rough.${s.name}`)
    for (let f = 0; f < 8; f++) {
        names.push(`water.${f}`)
        for (const s of SLOPES.slice(1)) {
            if (s.name !== 'flat') names.push(`coast.${s.name}.${f}`)
        }
    }
    for (let t = 0; t < 12; t++) for (let g = 0; g < 7; g++) names.push(`tree.${t}.${g}`)
    for (const p of ['x', 'y', 'n', 's', 'e', 'w']) names.push(`rail.flat.${p}`, `rail.overlay.${p}`)
    for (const s of sides) names.push(`rail.slope.${s}`, `road.grass.slope-${s}`, `road.town.slope-${s}`)
    for (const a of ['x', 'y']) {
        names.push(`crossing.grass.${a}`, `crossing.grass.${a}-closed`, `crossing.town.${a}`, `crossing.town.${a}-closed`)
        for (const kind of ['plain', 'building']) names.push(`station.rail.${a}.${kind}.rear`, `station.rail.${a}.${kind}.front`)
    }
    for (const type of ['block', 'path', 'path-oneway']) {
        for (const f of facings) names.push(`signal.${type}.${f}.red`, `signal.${type}.${f}.green`)
    }
    for (let bits = 1; bits < 16; bits++) {
        const parts = [[8, 'ne'], [4, 'se'], [2, 'sw'], [1, 'nw']].filter(([b]) => bits & (b as number)).map(([, n]) => n)
        names.push(`road.grass.${parts.join('-')}`, `road.town.${parts.join('-')}`)
    }
    for (const s of sides) {
        for (const kind of ['bus', 'truck']) for (const part of ['ground', 'a', 'b', 'c']) names.push(`roadstop.${kind}.${s}.${part}`)
        names.push(`depot.rail.${s}.ground`, `depot.rail.${s}.building`, `depot.road.${s}.ground`, `depot.road.${s}.building`)
    }
    for (const size of ['small', 'medium', 'large']) names.push(`house.${size}.0`)
    for (const [industry, layout] of Object.entries(INDUSTRY_LAYOUTS)) {
        for (const [, , tile] of layout) names.push(`industry.${industry}.${tile}`)
    }
    for (const d of DIRECTIONS) {
        names.push(`vehicle.train.steam.${d}`, `vehicle.train.diesel.${d}`)
        for (const c of ['passengers', 'mail', 'coal', 'coal-full', 'wood', 'wood-full', 'goods']) names.push(`vehicle.wagon.${c}.${d}`)
        for (const c of ['bus', 'mail', 'coal', 'coal-full', 'wood', 'wood-full', 'goods']) names.push(`vehicle.road.${c}.${d}`)
    }
    return names
}

describe('rail tycoon opengfx atlas', () => {
    describe('template evaluator', () => {
        it('evaluates integer arithmetic with parameters', () => {
            expect(evaluate('2 * (3 + 4) - -1')).toBe(15)
            expect(evaluate('x + 240', { x: 10 })).toBe(250)
            expect(evaluate('-12 -z+oy2', { z: 6, oy2: 1 })).toBe(-17)
            expect(evaluate('n*88', { n: 3 })).toBe(264)
            expect(evaluate('7 / 2')).toBe(3)
            expect(evaluate('-7 / 2')).toBe(-3)
            expect(() => evaluate('y + 1')).toThrow(/Unknown identifier/)
        })

        it('expands nested templates, flags, file parameters and #defines', () => {
            const pnml = parsePnml([
                '#define WIDE 40',
                '/* a comment [ 1, 2 ] */',
                'template inner(x, y, z, FLAG, file) { [ x, y, 8, 18+z, -3, -12-z, FLAG, file ] }',
                'template outer(x, y) {',
                '    inner(x, y, 0, NOCROP, "b.png") // trailing comment',
                '    [ x + WIDE, y, 20, 16, -14, -9 ]',
                '}',
                'alternative_sprites (spr100, ZOOM_LEVEL_IN_2X, BIT_DEPTH_8BPP, "c.png") { outer(0, 0) }',
                'base_graphics spr100(100, "a.png") { outer(6, 2) outer(6 + 128, 2) }',
                'if (climate == CLIMATE_TEMPERATE) { replacenew(LABEL, "d.png", 4) { [ 1, 1, 64, 31, -31, 0, ANIM ] } }'
            ].join('\n'), createPnml())
            const base = pnml.blocks.find(b => b.kind === 'base_graphics')
            expect(base?.base).toBe(100)
            const sprites = blockSprites(base!, pnml)
            expect(sprites.map(s => [s.x, s.y, s.w, s.h, s.xoff, s.yoff, s.file, s.flags.join()])).toEqual([
                [6, 2, 8, 18, -3, -12, 'b.png', 'NOCROP'],
                [46, 2, 20, 16, -14, -9, 'a.png', ''],
                [134, 2, 8, 18, -3, -12, 'b.png', 'NOCROP'],
                [174, 2, 20, 16, -14, -9, 'a.png', '']
            ])
            const replaced = pnml.blocks.find(b => b.kind === 'replacenew')
            expect(replaced).toMatchObject({ label: 'LABEL', offset: 4, condition: 'climate == CLIMATE_TEMPERATE' })
            expect(blockSprites(replaced!, pnml)[0]).toMatchObject({ x: 1, w: 64, file: 'd.png', flags: ['ANIM'] })
        })

        const sourceDir = defaultSourceDir()
        const atCommit = (() => {
            try {
                return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === OPENGFX_COMMIT
            } catch {
                return false
            }
        })()

        it.runIf(atCommit)('reads known OpenGFX entries through their templates', () => {
            const pnml = createPnml()
            for (const file of [
                'sprites/templates/sprite_templates.pnml',
                'sprites/templates/tmpl_trains.nml',
                'sprites/base/base-1005-rail-infra.pnml',
                'sprites/base/base-2733-rail-vehicles-wagons.pnml',
                'sprites/base/base-2905-rail-vehicles-engines.pnml',
                'sprites/base/base-3924-terrain.pnml'
            ]) parsePnml(readFileSync(join(sourceDir, file), 'utf8'), pnml, file)
            const block = (n: number) => blockSprites(pnml.blocks.find(b => b.kind === 'base_graphics' && b.base === n)!, pnml)
            const tuple = (s: { x: number, y: number, w: number, h: number, xoff: number, yoff: number }) => [s.x, s.y, s.w, s.h, s.xoff, s.yoff]
            // Kirby Paul: tmpl_pikka_8view_88length_29px_plus6height(111, 6)
            expect(block(2921).map(tuple)).toEqual([
                [111, 6, 8, 28, -3, -18], [127, 6, 20, 22, -14, -15], [159, 6, 29, 18, -16, -14], [207, 6, 20, 22, -6, -15],
                [239, 6, 8, 28, -3, -18], [255, 6, 20, 22, -14, -15], [287, 6, 29, 18, -16, -14], [335, 6, 20, 22, -6, -15]
            ])
            // passenger wagon: tmpl_train_4view_88length_29px(6, 2) through the width/height/offset template
            expect(block(2733).map(tuple)).toEqual([[6, 2, 8, 22, -3, -12], [22, 2, 20, 16, -14, -9], [54, 2, 29, 12, -16, -8], [102, 2, 20, 16, -6, -9]])
            // block signals: tmpl_signals(10, 50), the e-w pair sits after w-e in the image
            const signals = block(1275)
            expect(signals).toHaveLength(16)
            expect(tuple(signals[8]!)).toEqual([310, 50, 20, 30, -9, -28])
            expect(tuple(signals[10]!)).toEqual([250, 50, 20, 30, -9, -28])
            // grass: tmpl_groundtiles(1, 1), steep north is the 16th tile
            const grass = block(3981)
            expect(grass).toHaveLength(19)
            expect(tuple(grass[15]!)).toEqual([1197, 1, 64, 47, -31, -16])
            // rail 1011 is a literal tuple
            expect(tuple(block(1011)[0]!)).toEqual([82, 40, 64, 31, -31, 0])
        })

        it.runIf(atCommit)('rebuilds the committed files exactly from the pinned commit', () => {
            const commitDate = execFileSync('git', ['show', '-s', '--format=%cI', OPENGFX_COMMIT], { cwd: sourceDir, encoding: 'utf8' }).trim()
            const result = extractOpenGfx(sourceDir, { commit: OPENGFX_COMMIT, commitDate })
            for (const name of ['atlas.json', 'README.md', 'COPYING']) expect(result.files[name]!.equals(read(name)), name).toBe(true)
            // compare pixels, not deflate output, so another zlib build cannot fail this
            for (const name of ['atlas.png', 'mask.png']) {
                const fresh = PNG.sync.read(result.files[name]!)
                const committed = PNG.sync.read(read(name))
                expect(fresh.data.equals(committed.data), name).toBe(true)
            }
        }, 120_000)
    })

    describe('committed atlas', () => {
        it('holds every sprite the renderer draws, inside the image', () => {
            const json = atlasJson()
            const missing = requiredNames().filter(n => !json.sprites[n])
            expect(missing).toEqual([])
            for (const [name, s] of Object.entries(json.sprites)) {
                expect(s.x >= 0 && s.y >= 0 && s.x + s.w <= json.meta.size.w && s.y + s.h <= json.meta.size.h, name).toBe(true)
            }
        })

        it('has no opaque pure-blue pixel and transparent padding', () => {
            const png = PNG.sync.read(read('atlas.png'))
            let blue = 0
            for (let i = 0; i < png.data.length; i += 4) {
                if (png.data[i + 3] !== 0 && png.data[i] === 0 && png.data[i + 1] === 0 && png.data[i + 2] === 255) blue++
            }
            expect(blue).toBe(0)
            expect(png.data[3]).toBe(0)
        })

        it('animates water and keeps the mask to company-colour shades', () => {
            const json = atlasJson()
            const png = PNG.sync.read(read('atlas.png'))
            const pixels = (name: string) => {
                const s = json.sprites[name]!
                const out: number[] = []
                for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) out.push(png.data.readUInt32BE(((s.y + y) * png.width + s.x + x) * 4))
                return out
            }
            expect(pixels('water.0')).not.toEqual(pixels('water.3'))
            const mask = PNG.sync.read(read('mask.png'))
            const allowed = new Set([0, 31, 63, 95, 127, 159, 191, 223, 255])
            const seen = new Set<number>()
            for (let i = 0; i < mask.data.length; i += 4) seen.add(mask.data[i]!)
            expect([...seen].filter(v => !allowed.has(v))).toEqual([])
            expect(seen.size).toBeGreaterThan(2)
        })

        it('credits OpenGFX with the modification notice, the commit and the script', () => {
            const readme = read('README.md').toString('utf8')
            expect(readme).toContain('These files are modified from OpenGFX')
            expect(readme).toContain(OPENGFX_COMMIT)
            expect(readme).toContain(SCRIPT_PATH)
            expect(readme).toContain('GPL-2.0')
            expect(readme).toContain('MIT')
            expect(readme).toContain('Zephyris')
            expect(atlasJson().meta.commit).toBe(OPENGFX_COMMIT)
            expect(read('COPYING').toString('utf8')).toContain('GNU GENERAL PUBLIC LICENSE')
        })
    })
})
