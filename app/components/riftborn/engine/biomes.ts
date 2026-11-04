/*
 * Biomes: each stage of a run has its own floor, palette, decor, light,
 * fog and ambient weather. A run starts in the Crypt, moves to a new biome
 * after each boss kill and ends in the Rift Core, where the Rift Heart
 * waits. Floors are painted on a canvas (seamless tile) when a biome loads.
 */
import { randomPick } from '#shared/utils/random'

export type DecorKind = 'rune' | 'crystal' | 'rubble' | 'bones' | 'crack' | 'lava' | 'ice' | 'snow' | 'shroom' | 'pylon' | 'tear' | 'vent'
export type Ambient = 'dust' | 'embers' | 'snow' | 'spores' | 'storm' | 'void'

export interface BiomeDef {
    id: string
    name: string
    /** Banner and portal colour */
    color: number
    /** Renderer clear colour */
    bg: number
    floor: {
        base: string
        /** Slab base rgb and per-slab variance */
        slab: [number, number, number]
        vary: number
        /** Glowing veins: 'r,g,b' strings */
        veins: string[]
        veinCount: number
        veinWidth: number
        runes: string[]
        moss: string[]
        mossCount: number
        /** Light speckles, 'r,g,b' */
        speck: string
        rows: number
        frost?: boolean
        stars?: boolean
        rivets?: boolean
    }
    patch: string[]
    vignette: string
    fog: [number, number]
    fogAlpha: number
    motes: [number, number]
    /** Hero light pool tint */
    light: number
    decor: { kind: DecorKind, w: number, tint: number[] }[]
    ambient: Ambient
    /** Enemy ids the director favours here */
    favor: string[]
}

export const BIOMES: Record<string, BiomeDef> = {
    crypt: {
        id: 'crypt',
        name: 'The Crypt',
        color: 0xb08aff,
        bg: 0x07060c,
        floor: { base: '#100d18', slab: [24, 21, 34], vary: 12, veins: ['150,90,255', '255,70,170'], veinCount: 3, veinWidth: 1, runes: ['140,90,255', '90,200,255', '255,80,170'], moss: ['40,90,80', '70,40,100'], mossCount: 40, speck: '220,200,255', rows: 8 },
        patch: ['0,0,0', '90,40,160', '30,90,140'],
        vignette: '2,0,6',
        fog: [0x1a0e2e, 0x2a1440],
        fogAlpha: 1,
        motes: [0xc8a8ff, 0x8fb8ff],
        light: 0xb08aff,
        decor: [
            { kind: 'rune', w: 3, tint: [0x8a5aff, 0x5ac8ff, 0xff4fae] },
            { kind: 'crystal', w: 2, tint: [0xb08aff, 0x6ad0ff] },
            { kind: 'rubble', w: 3, tint: [0xffffff] },
            { kind: 'bones', w: 2.5, tint: [0xffffff] },
            { kind: 'crack', w: 1.5, tint: [0x000000] }
        ],
        ambient: 'dust',
        favor: ['ghoul', 'bat', 'archer', 'ghost', 'skull', 'knight']
    },
    ember: {
        id: 'ember',
        name: 'Ember Wastes',
        color: 0xff7a2a,
        bg: 0x0c0504,
        floor: { base: '#140806', slab: [40, 22, 18], vary: 14, veins: ['255,110,30', '255,60,20'], veinCount: 9, veinWidth: 2.2, runes: ['255,140,40'], moss: ['60,20,10', '30,10,8'], mossCount: 50, speck: '255,170,90', rows: 7 },
        patch: ['0,0,0', '120,30,0', '160,60,10'],
        vignette: '10,2,0',
        fog: [0x2a0a04, 0x3a1406],
        fogAlpha: 1,
        motes: [0xffa040, 0xff6a20],
        light: 0xff8a3a,
        decor: [
            { kind: 'lava', w: 3.5, tint: [0xff6a1a, 0xff9a2a] },
            { kind: 'vent', w: 2, tint: [0xff7a20] },
            { kind: 'rubble', w: 3, tint: [0xa07060] },
            { kind: 'bones', w: 1.5, tint: [0xd0a090] },
            { kind: 'crack', w: 2, tint: [0x000000] }
        ],
        ambient: 'embers',
        favor: ['imp', 'bomber', 'beetle', 'skull', 'charger', 'brute']
    },
    frozen: {
        id: 'frozen',
        name: 'Frozen Abyss',
        color: 0x9fe0ff,
        bg: 0x050a10,
        floor: { base: '#0c1620', slab: [44, 62, 82], vary: 16, veins: ['150,230,255', '200,240,255'], veinCount: 5, veinWidth: 1.2, runes: ['160,230,255'], moss: ['220,240,255', '150,200,230'], mossCount: 46, speck: '230,250,255', rows: 6, frost: true },
        patch: ['0,10,30', '140,200,255', '255,255,255'],
        vignette: '0,4,12',
        fog: [0x9fc8e8, 0x5a7a9a],
        fogAlpha: 0.55,
        motes: [0xffffff, 0xbfe8ff],
        light: 0x9fe0ff,
        decor: [
            { kind: 'ice', w: 3.5, tint: [0x9fe0ff, 0xc8f0ff] },
            { kind: 'snow', w: 3, tint: [0xffffff] },
            { kind: 'crystal', w: 2, tint: [0x7fd0ff] },
            { kind: 'rubble', w: 1.5, tint: [0xa0c0e0] },
            { kind: 'crack', w: 1.5, tint: [0x203040] }
        ],
        ambient: 'snow',
        favor: ['wisp', 'golem', 'crystal', 'crystalShard', 'shieldbearer', 'spider']
    },
    fungal: {
        id: 'fungal',
        name: 'Fungal Hollow',
        color: 0x5affb0,
        bg: 0x040a08,
        floor: { base: '#0a120e', slab: [22, 34, 30], vary: 10, veins: ['80,255,180', '120,200,255'], veinCount: 6, veinWidth: 1.4, runes: ['90,255,170', '180,120,255'], moss: ['30,110,70', '60,40,110', '20,80,90'], mossCount: 110, speck: '160,255,210', rows: 9 },
        patch: ['0,0,0', '20,120,80', '90,40,140'],
        vignette: '0,6,4',
        fog: [0x0c2a20, 0x1a1a3a],
        fogAlpha: 1,
        motes: [0x8affc8, 0xc89aff],
        light: 0x5affb0,
        decor: [
            { kind: 'shroom', w: 4.5, tint: [0x5affb0, 0x7ad8ff, 0xd08aff] },
            { kind: 'crystal', w: 1, tint: [0x5affb0] },
            { kind: 'rubble', w: 2, tint: [0x7a9a8a] },
            { kind: 'bones', w: 1.5, tint: [0xc8d8c0] }
        ],
        ambient: 'spores',
        favor: ['slime', 'spider', 'worm', 'lurker', 'cultist', 'mite']
    },
    storm: {
        id: 'storm',
        name: 'Storm Spire',
        color: 0x7fc8ff,
        bg: 0x04060c,
        floor: { base: '#0c1018', slab: [30, 36, 50], vary: 10, veins: ['100,190,255', '180,220,255'], veinCount: 7, veinWidth: 1.3, runes: ['120,200,255'], moss: ['20,30,50'], mossCount: 20, speck: '190,220,255', rows: 6, rivets: true },
        patch: ['0,0,0', '40,80,160', '120,160,220'],
        vignette: '0,2,10',
        fog: [0x101a30, 0x1a2440],
        fogAlpha: 1,
        motes: [0x9fd8ff, 0xffffff],
        light: 0x7fc8ff,
        decor: [
            { kind: 'pylon', w: 3, tint: [0x7fc8ff, 0xfff27a] },
            { kind: 'rune', w: 2, tint: [0x63c7ff] },
            { kind: 'rubble', w: 2.5, tint: [0x8090b0] },
            { kind: 'crack', w: 2, tint: [0x000000] }
        ],
        ambient: 'storm',
        favor: ['drone', 'gazer', 'hoplite', 'charger', 'herald', 'stalker']
    },
    rift: {
        id: 'rift',
        name: 'Rift Core',
        color: 0xff3fa4,
        bg: 0x030108,
        floor: { base: '#06030c', slab: [16, 10, 26], vary: 8, veins: ['255,60,170', '170,90,255'], veinCount: 8, veinWidth: 1.6, runes: ['255,80,180', '160,100,255'], moss: ['40,0,40'], mossCount: 16, speck: '255,220,255', rows: 8, stars: true },
        patch: ['0,0,0', '140,20,120', '60,20,160'],
        vignette: '4,0,8',
        fog: [0x2a0624, 0x14062a],
        fogAlpha: 1,
        motes: [0xff7ad0, 0xb08aff],
        light: 0xff3fa4,
        decor: [
            { kind: 'tear', w: 3, tint: [0xff3fa4, 0xb06bff] },
            { kind: 'rune', w: 2.5, tint: [0xff4fae, 0xa06bff] },
            { kind: 'crystal', w: 2, tint: [0xff6ad5, 0xa06bff] },
            { kind: 'rubble', w: 1.5, tint: [0x806080] }
        ],
        ambient: 'void',
        favor: ['cultist', 'ghost', 'gazer', 'herald', 'stalker', 'knight']
    }
}

/** A run starts in one of these */
export const START_BIOMES = ['crypt', 'ember', 'frozen']
/** Biomes a run can travel through before the Rift Core */
export const STAGE_BIOMES = ['crypt', 'ember', 'frozen', 'fungal', 'storm']
export const FINAL_BIOME = 'rift'

export function startBiome(): BiomeDef {
    return BIOMES[randomPick(START_BIOMES)]!
}

/** Next stage after a boss kill: a biome not yet visited, or the Rift Core once the final boss is next */
export function nextBiome(visited: readonly string[], final: boolean): BiomeDef {
    const left = STAGE_BIOMES.filter(id => !visited.includes(id))
    if (final || !left.length) return BIOMES[FINAL_BIOME]!
    return BIOMES[randomPick(left)]!
}

function lcg(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 4294967296
    }
}

/** Seamless floor tile for a biome */
export function makeBiomeFloor(b: BiomeDef, size = 512): HTMLCanvasElement {
    const cv = document.createElement('canvas')
    cv.width = size
    cv.height = size
    const ctx = cv.getContext('2d')!
    const f = b.floor
    const rnd = lcg(1337 + b.id.length * 97 + b.id.charCodeAt(0))
    ctx.fillStyle = f.base
    ctx.fillRect(0, 0, size, size)
    const wrap = (fn: (ox: number, oy: number) => void) => {
        for (const ox of [-size, 0, size]) {
            for (const oy of [-size, 0, size]) fn(ox, oy)
        }
    }
    const rows = f.rows
    const rowH = size / rows
    const [sr, sg, sb] = f.slab
    for (let r = 0; r < rows; r++) {
        const cols = Math.max(2, Math.round(rows / 2) + Math.floor(rnd() * 3))
        const colW = size / cols
        const shift = rnd() * colW
        for (let c = 0; c < cols; c++) {
            const x = c * colW + shift
            const y = r * rowH
            const v = Math.floor((rnd() - 0.5) * f.vary)
            const w = colW - 3
            const h = rowH - 3
            const c0 = `rgb(${sr + v + 8},${sg + v + 6},${sb + v + 10})`
            const c1 = `rgb(${sr + v},${sg + v},${sb + v})`
            wrap((ox, oy) => {
                const X = x + ox + 1.5
                const Y = y + oy + 1.5
                const grad = ctx.createLinearGradient(X, Y, X + w, Y + h)
                grad.addColorStop(0, c0)
                grad.addColorStop(1, c1)
                ctx.fillStyle = grad
                ctx.fillRect(X, Y, w, h)
                ctx.fillStyle = `rgba(${f.speck},0.07)`
                ctx.fillRect(X, Y, w, 2)
                ctx.fillRect(X, Y, 2, h)
                ctx.fillStyle = 'rgba(0,0,0,0.35)'
                ctx.fillRect(X, Y + h - 2, w, 2.5)
                ctx.fillRect(X + w - 2, Y, 2.5, h)
                if (f.rivets) {
                    ctx.fillStyle = `rgba(${f.speck},0.25)`
                    for (const [px, py] of [[X + 5, Y + 5], [X + w - 7, Y + 5], [X + 5, Y + h - 7], [X + w - 7, Y + h - 7]]) ctx.fillRect(px!, py!, 2, 2)
                }
            })
            for (let k = 0; k < 10; k++) {
                const px = x + rnd() * w
                const py = y + rnd() * h
                const light = rnd() < 0.4
                const sw = 1.5 + rnd() * 2
                const sh = 1.5 + rnd() * 2
                wrap((ox, oy) => {
                    ctx.fillStyle = light ? `rgba(${f.speck},0.07)` : 'rgba(0,0,0,0.22)'
                    ctx.fillRect(px + ox, py + oy, sw, sh)
                })
            }
            for (let k = 0; k < 2; k++) {
                const bx = x + rnd() * w
                const by = y + rnd() * h
                const br = 6 + rnd() * 16
                const dark = rnd() < 0.6
                wrap((ox, oy) => {
                    const grad = ctx.createRadialGradient(bx + ox, by + oy, 0, bx + ox, by + oy, br)
                    grad.addColorStop(0, dark ? 'rgba(0,0,0,0.2)' : `rgba(${f.speck},0.05)`)
                    grad.addColorStop(1, 'rgba(0,0,0,0)')
                    ctx.fillStyle = grad
                    ctx.fillRect(bx + ox - br, by + oy - br, br * 2, br * 2)
                })
            }
        }
    }
    // Cracks
    ctx.lineCap = 'round'
    for (let i = 0; i < 14; i++) {
        let x = rnd() * size
        let y = rnd() * size
        let a = rnd() * Math.PI * 2
        const pts: [number, number][] = [[x, y]]
        const n = 3 + Math.floor(rnd() * 5)
        for (let k = 0; k < n; k++) {
            a += (rnd() - 0.5) * 1.4
            const l = 6 + rnd() * 14
            x += Math.cos(a) * l
            y += Math.sin(a) * l
            pts.push([x, y])
        }
        wrap((ox, oy) => {
            ctx.strokeStyle = 'rgba(0,0,0,0.55)'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            pts.forEach(([px, py], j) => j === 0 ? ctx.moveTo(px + ox, py + oy) : ctx.lineTo(px + ox, py + oy))
            ctx.stroke()
        })
    }
    // Moss, frost or ash patches
    for (let i = 0; i < f.mossCount; i++) {
        const mx = rnd() * size
        const my = rnd() < 0.6 ? Math.round(rnd() * rows) * rowH + (rnd() - 0.5) * 4 : rnd() * size
        const mr = 3 + rnd() * (f.frost ? 16 : 9)
        const col = f.moss[Math.floor(rnd() * f.moss.length)]!
        wrap((ox, oy) => {
            const grad = ctx.createRadialGradient(mx + ox, my + oy, 0, mx + ox, my + oy, mr)
            grad.addColorStop(0, `rgba(${col},${f.frost ? 0.3 : 0.5})`)
            grad.addColorStop(1, `rgba(${col},0)`)
            ctx.fillStyle = grad
            ctx.fillRect(mx + ox - mr, my + oy - mr, mr * 2, mr * 2)
        })
    }
    // Glowing veins (lava, ice light, bioluminescence, rift energy)
    for (let i = 0; i < f.veinCount; i++) {
        let x = rnd() * size
        let y = rnd() * size
        let a = rnd() * Math.PI * 2
        const pts: [number, number][] = [[x, y]]
        const n = 6 + Math.floor(rnd() * 6)
        for (let k = 0; k < n; k++) {
            a += (rnd() - 0.5) * 1.1
            x += Math.cos(a) * (8 + rnd() * 12)
            y += Math.sin(a) * (8 + rnd() * 12)
            pts.push([x, y])
        }
        const col = f.veins[Math.floor(rnd() * f.veins.length)]!
        const wd = f.veinWidth
        wrap((ox, oy) => {
            for (const [lw, al] of [[7 * wd, 0.05], [3 * wd, 0.12], [1.1 * wd, 0.4]] as const) {
                ctx.strokeStyle = `rgba(${col},${al})`
                ctx.lineWidth = Math.max(1.5, lw)
                ctx.beginPath()
                pts.forEach(([px, py], j) => j === 0 ? ctx.moveTo(px + ox, py + oy) : ctx.lineTo(px + ox, py + oy))
                ctx.stroke()
            }
        })
    }
    // Runes
    for (let i = 0; i < 6; i++) {
        const cx = rnd() * size
        const cy = rnd() * size
        const rr = 7 + rnd() * 9
        const col = f.runes[Math.floor(rnd() * f.runes.length)]!
        const strokes: [number, number, number, number][] = []
        const m = 2 + Math.floor(rnd() * 3)
        for (let k = 0; k < m; k++) {
            const a1 = rnd() * Math.PI * 2
            const a2 = a1 + Math.PI * (0.5 + rnd())
            strokes.push([Math.cos(a1) * rr, Math.sin(a1) * rr, Math.cos(a2) * rr * 0.6, Math.sin(a2) * rr * 0.6])
        }
        const circle = rnd() < 0.6
        wrap((ox, oy) => {
            ctx.strokeStyle = `rgba(${col},0.35)`
            ctx.lineWidth = 1.5
            if (circle) {
                ctx.beginPath()
                ctx.arc(cx + ox, cy + oy, rr, 0, Math.PI * 2)
                ctx.stroke()
            }
            for (const [x1, y1, x2, y2] of strokes) {
                ctx.beginPath()
                ctx.moveTo(cx + ox + x1, cy + oy + y1)
                ctx.lineTo(cx + ox + x2, cy + oy + y2)
                ctx.stroke()
            }
        })
    }
    if (f.stars) {
        for (let i = 0; i < 140; i++) {
            const x = rnd() * size
            const y = rnd() * size
            const s = rnd() < 0.85 ? 1 : 2
            const a = 0.25 + rnd() * 0.6
            ctx.fillStyle = `rgba(255,${200 + Math.floor(rnd() * 55)},255,${a})`
            ctx.fillRect(x, y, s, s)
        }
    }
    // Grain
    const img = ctx.getImageData(0, 0, size, size)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
        const n = (rnd() - 0.5) * 10
        d[i] = Math.max(0, Math.min(255, d[i]! + n))
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n))
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n))
    }
    ctx.putImageData(img, 0, 0)
    return cv
}

/** Low-frequency tinted patches over the floor to hide the repeat */
export function makeBiomePatch(b: BiomeDef, size = 256): HTMLCanvasElement {
    const cv = document.createElement('canvas')
    cv.width = size
    cv.height = size
    const ctx = cv.getContext('2d')!
    const rnd = lcg(4242 + b.id.charCodeAt(0))
    for (let i = 0; i < 26; i++) {
        const x = rnd() * size
        const y = rnd() * size
        const r = 20 + rnd() * 60
        const k = rnd()
        const col = k < 0.6 ? b.patch[0]! : k < 0.8 ? b.patch[1]! : b.patch[2]!
        const a = k < 0.6 ? 0.35 : 0.12
        for (const ox of [-size, 0, size]) {
            for (const oy of [-size, 0, size]) {
                const grad = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r)
                grad.addColorStop(0, `rgba(${col},${a})`)
                grad.addColorStop(1, `rgba(${col},0)`)
                ctx.fillStyle = grad
                ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2)
            }
        }
    }
    return cv
}
