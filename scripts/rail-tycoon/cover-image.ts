/**
 * Draws Rail Tycoon's home page cover, public/images/games/rail-tycoon.jpg, from the committed
 * OpenGFX atlas (public/rail-tycoon/opengfx): a small hand-placed scene of two towns joined by a
 * railway with a passenger train, a road with a bus, a coal mine, a forest and a lake, drawn at
 * 1:1 in the game's own projection and scaled 2x with nearest-neighbour, like the game at zoom 2.
 *
 *   bun scripts/rail-tycoon/cover-image.ts [--out <file.jpg>]
 *
 * The output shows OpenGFX graphics, so it is GPL-2.0 like them; public/rail-tycoon/opengfx/README.md
 * lists it as a derived file. The JPEG is written by macOS sips (no image library in the repo
 * encodes JPEG); elsewhere pass --png to keep the PNG and convert it with another tool.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ATLAS_DIR = join(ROOT, 'public/rail-tycoon/opengfx')

/** The neighbouring covers are 960x540; the scene is drawn at half that and doubled. */
const OUT_W = 960
const OUT_H = 540
const SCALE = 2
const W = OUT_W / SCALE
const H = OUT_H / SCALE
const HALF_W = 32
const HALF_H = 16
/** The company colour the train, bus and station wear (a catalog colour, red). */
const COMPANY_RGB = 0xc23a2b
/** sips quality that writes the same quantization tables as dead-front.jpg and colony.jpg. */
const JPEG_QUALITY = 75

interface Entry { x: number, y: number, w: number, h: number, ox: number, oy: number }

const atlasJson = JSON.parse(readFileSync(join(ATLAS_DIR, 'atlas.json'), 'utf8')) as { sprites: Record<string, Entry> }
const atlas = PNG.sync.read(readFileSync(join(ATLAS_DIR, 'atlas.png')))
const mask = PNG.sync.read(readFileSync(join(ATLAS_DIR, 'mask.png')))

const canvas = new Uint8Array(W * H * 4)

/** Deterministic, cosmetic only: tree placement. */
let seed = 0x5eed
function jitter(): number {
    seed = (seed * 1103515245 + 12345) >>> 0
    return (seed >>> 16) / 65536
}

/** The 8-shade ramp of the company colour, dark to light. */
function ramp(shade: number): [number, number, number] {
    const f = 0.42 + shade * 0.12
    const c = (shift: number) => Math.max(0, Math.min(255, Math.round(((COMPANY_RGB >> shift) & 0xff) * f + (f > 1 ? (f - 1) * 120 : 0))))
    return [c(16), c(8), c(0)]
}

function maskValue(x: number, y: number): number {
    const i = (y * mask.width + x) * (mask.data.length / (mask.width * mask.height))
    return mask.data[i]!
}

/** Draws a sprite with its anchor at (ax, ay) on the canvas, company pixels recoloured. */
function draw(name: string, ax: number, ay: number): void {
    const e = atlasJson.sprites[name]
    if (!e) throw new Error(`no sprite ${name}`)
    for (let sy = 0; sy < e.h; sy++) {
        for (let sx = 0; sx < e.w; sx++) {
            const dx = Math.round(ax + e.ox + sx)
            const dy = Math.round(ay + e.oy + sy)
            if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue
            const si = ((e.y + sy) * atlas.width + e.x + sx) * 4
            if (atlas.data[si + 3]! < 128) continue
            let r = atlas.data[si]!
            let g = atlas.data[si + 1]!
            let b = atlas.data[si + 2]!
            const m = maskValue(e.x + sx, e.y + sy)
            if (m > 0) [r, g, b] = ramp(Math.max(0, Math.min(7, Math.round((m + 1) / 32) - 1)))
            const di = (dy * W + dx) * 4
            canvas[di] = r
            canvas[di + 1] = g
            canvas[di + 2] = b
            canvas[di + 3] = 255
        }
    }
}

// ─── The scene ───────────────────────────────────────────────────────────

/** Screen position of world point (wx, wy) in tiles, the view centred on tile CX, CY. */
const CX = 10
const CY = 10
function screen(wx: number, wy: number): { x: number, y: number } {
    return { x: W / 2 + (wy - wx) * HALF_W, y: H / 2 - 40 + (wx + wy - CX - CY) * HALF_H }
}

type Ground = 'grass' | 'rough' | 'water' | 'town'
const SIDE = 22
const ground: Ground[][] = Array.from({ length: SIDE }, () => Array.from({ length: SIDE }, () => 'grass' as Ground))
/** Ground overlays (rail, road), drawn in the ground pass. */
const overlay = new Map<string, string>()
/** Objects with a depth: drawn after every ground tile, back to front. */
const objects: { depth: number, name: string, wx: number, wy: number }[] = []

const key = (x: number, y: number) => `${x},${y}`
function tileObject(x: number, y: number, name: string, bias = 0) {
    objects.push({ depth: x + y + 1 + bias, name, wx: x, wy: y })
}

// the lake, top left
for (let x = 0; x < SIDE; x++) {
    for (let y = 0; y < SIDE; y++) {
        if ((x - 3) * (x - 3) + (y - 15) * (y - 15) < 12) ground[x]![y] = 'water'
    }
}
// rough ground patches
for (const [x, y] of [[14, 3], [15, 4], [4, 6], [17, 15]] as const) ground[x]![y] = 'rough'

// the railway along the x axis on row y = 9, through both towns
const RAIL_Y = 9
for (let x = 2; x < SIDE - 1; x++) overlay.set(key(x, RAIL_Y), 'rail.flat.x')

// a road along the y axis on column x = 13 crossing the railway
const ROAD_X = 13
for (let y = 4; y < SIDE - 2; y++) {
    if (y === RAIL_Y) overlay.set(key(ROAD_X, y), 'crossing.town.y')
    else overlay.set(key(ROAD_X, y), y > 6 && y < 13 ? 'road.town.se-nw' : 'road.grass.se-nw')
}

// stations: one in each town
for (const x of [6, 7]) {
    tileObject(x, RAIL_Y, 'station.rail.x.building.rear', -0.02)
    tileObject(x, RAIL_Y, 'station.rail.x.building.front', 0.02)
}
for (const x of [16, 17]) {
    tileObject(x, RAIL_Y, 'station.rail.x.plain.rear', -0.02)
    tileObject(x, RAIL_Y, 'station.rail.x.plain.front', 0.02)
}

// towns: houses on both sides of the line
const houses: [number, number, string][] = [
    [5, 7, 'house.medium.0'], [6, 7, 'house.small.2'], [7, 7, 'house.large.1'], [8, 7, 'house.small.4'],
    [5, 11, 'house.small.1'], [6, 11, 'house.medium.2'], [7, 11, 'house.small.5'], [8, 11, 'house.large.3'],
    [4, 8, 'house.small.6'], [9, 11, 'house.small.0'],
    [12, 6, 'house.large.0'], [12, 7, 'house.small.3'], [14, 7, 'house.medium.1'], [14, 6, 'house.small.7'],
    [12, 12, 'house.medium.0'], [15, 11, 'house.small.2'], [15, 6, 'house.large.2'], [14, 12, 'house.small.1'], [12, 11, 'house.small.5']
]
for (const [x, y, name] of houses) {
    ground[x]![y] = 'town'
    tileObject(x, y, name)
}

// a coal mine to the south east
const MINE = [[1, 1, 0], [1, 2, 2], [0, 0, 5], [1, 0, 6], [2, 0, 3], [2, 2, 3]] as const
for (const [dx, dy, part] of MINE) {
    ground[16 + dx]![12 + dy] = 'rough'
    tileObject(16 + dx, 12 + dy, `industry.coalMine.${part}`)
}

// a forest to the north east, and scattered trees
const TREE_TYPES = [0, 1, 2, 3, 4, 6, 7, 8]
for (let x = 1; x < SIDE; x++) {
    for (let y = 0; y < SIDE; y++) {
        const inForest = x >= 15 && x <= 20 && y >= 1 && y <= 6
        const scattered = !inForest && jitter() < 0.08
        if (!inForest && !scattered) continue
        if (ground[x]![y] !== 'grass' && ground[x]![y] !== 'rough') continue
        if (overlay.has(key(x, y)) || Math.abs(y - RAIL_Y) < 1) continue
        const count = inForest ? 3 : 1
        for (let i = 0; i < count; i++) {
            // stage 3 is fully grown; later stages wither
            const type = TREE_TYPES[Math.floor(jitter() * TREE_TYPES.length)]!
            objects.push({ depth: x + y + 1 + i * 0.01, name: `tree.${type}.3`, wx: x + 0.2 + jitter() * 0.6, wy: y + 0.2 + jitter() * 0.6 })
        }
    }
}

// the train: a steam engine, coaches and a mail van heading north east (towards -x) between the towns
const TRAIN_HEAD = 9.6
const consist = ['vehicle.train.steam.ne', 'vehicle.wagon.passengers.ne', 'vehicle.wagon.passengers.ne', 'vehicle.wagon.passengers.ne', 'vehicle.wagon.mail.ne']
consist.forEach((name, i) => {
    const wx = TRAIN_HEAD + i * 0.5
    objects.push({ depth: wx + RAIL_Y + 0.5 + 0.03, name, wx, wy: RAIL_Y + 0.5 })
})

// a bus coming down the road
objects.push({ depth: ROAD_X + 0.5 + 12.4 + 0.03, name: 'vehicle.road.bus.se', wx: ROAD_X + 0.5, wy: 12.4 })
objects.push({ depth: ROAD_X + 0.5 + 5.6 + 0.03, name: 'vehicle.road.coal-full.nw', wx: ROAD_X + 0.5, wy: 5.6 })

// ─── Draw ────────────────────────────────────────────────────────────────

// sky-less: fill with grass-dark so any uncovered corner reads as distant land
for (let i = 0; i < W * H; i++) {
    canvas[i * 4] = 0x3c
    canvas[i * 4 + 1] = 0x5c
    canvas[i * 4 + 2] = 0x24
    canvas[i * 4 + 3] = 255
}

for (let d = 0; d < SIDE * 2; d++) {
    for (let x = 0; x < SIDE; x++) {
        const y = d - x
        if (y < 0 || y >= SIDE) continue
        const p = screen(x, y)
        const g = ground[x]![y]!
        if (g === 'water') draw('water.0', p.x, p.y)
        else if (g === 'rough') draw('terrain.rough.flat', p.x, p.y)
        else draw('terrain.grass.flat', p.x, p.y)
        const o = overlay.get(key(x, y))
        if (o) draw(o, p.x, p.y)
    }
}

objects.sort((a, b) => a.depth - b.depth)
for (const o of objects) {
    const isVehicle = o.name.startsWith('vehicle.') || o.name.startsWith('tree.')
    const p = isVehicle ? screen(o.wx, o.wy) : screen(o.wx, o.wy)
    draw(o.name, p.x, p.y)
}

// ─── Scale 2x nearest and write ──────────────────────────────────────────

const out = new PNG({ width: OUT_W, height: OUT_H })
for (let y = 0; y < OUT_H; y++) {
    for (let x = 0; x < OUT_W; x++) {
        const si = (Math.floor(y / SCALE) * W + Math.floor(x / SCALE)) * 4
        const di = (y * OUT_W + x) * 4
        out.data[di] = canvas[si]!
        out.data[di + 1] = canvas[si + 1]!
        out.data[di + 2] = canvas[si + 2]!
        out.data[di + 3] = 255
    }
}

const args = process.argv.slice(2)
const outArg = args.indexOf('--out')
const target = outArg >= 0 && args[outArg + 1] ? resolve(args[outArg + 1]!) : join(ROOT, 'public/images/games/rail-tycoon.jpg')
const pngBytes = PNG.sync.write(out)

if (args.includes('--png')) {
    const pngPath = target.replace(/\.jpe?g$/i, '') + '.png'
    writeFileSync(pngPath, pngBytes)
    console.log(`wrote ${pngPath}`)
} else {
    const scratch = join(process.env.TMPDIR ?? tmpdir(), `rail-tycoon-cover-${process.pid}`)
    mkdirSync(scratch, { recursive: true })
    const pngPath = join(scratch, 'cover.png')
    writeFileSync(pngPath, pngBytes)
    try {
        execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(JPEG_QUALITY), pngPath, '--out', target], { stdio: 'ignore' })
    } finally {
        rmSync(scratch, { recursive: true, force: true })
    }
    console.log(`wrote ${target}`)
}
