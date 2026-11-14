// Gridworks textures: the SVG sprites rasterised at a fixed density, plus belts
// drawn procedurally (8 animation frames per Mk and shape).
import { Graphics, Texture, type Renderer } from 'pixi.js'
import { BUILDINGS, ITEM_IDS, type ItemId, type Kind } from '#shared/utils/gridworks/defs'

export const TILE = 64
/** Texture pixels per world unit. */
const RES = 2
export const BELT_FRAMES = 8
/** Chevron spacing along a belt, in world units; 8 frames cover one period. */
export const BELT_PERIOD = 32

export type BeltShape = 'straight' | 'curveL' | 'curveR'

export interface GridTextures {
    building: Partial<Record<Kind, Texture>>
    spin: Partial<Record<Kind, Texture>>
    item: Record<ItemId, Texture>
    /** belt[mk - 1][shape][frame] */
    belt: Record<BeltShape, Texture[]>[]
    white: Texture
}

async function rasterSvg(url: string, w: number, h: number): Promise<Texture> {
    const text = await (await fetch(url)).text()
    const blob = new Blob([text], { type: 'image/svg+xml' })
    const src = URL.createObjectURL(blob)
    try {
        const img = new Image(w, h)
        img.decoding = 'async'
        img.src = src
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        const tex = Texture.from(canvas)
        tex.source.scaleMode = 'linear'
        tex.source.autoGenerateMipmaps = true
        return tex
    } finally {
        URL.revokeObjectURL(src)
    }
}

const BELT_MK_COLOR = [0x9aa3ae, 0xf2b83a, 0xe5484d, 0x3b82f6]
const OUTLINE = 0x2b3038
const BAND = 0x5d6570
const CHEVRON = 0xd9dee5

function drawChevron(g: Graphics, x: number, y: number, angle: number, color: number, alpha: number) {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const pt = (dx: number, dy: number): [number, number] => [x + dx * c - dy * s, y + dx * s + dy * c]
    const a = pt(-4, -7)
    const b = pt(4, 0)
    const d = pt(-4, 7)
    g.moveTo(a[0], a[1]).lineTo(b[0], b[1]).lineTo(d[0], d[1])
        .stroke({ width: 3.2, color, alpha, cap: 'round', join: 'round' })
}

/** One belt frame in the east-facing frame of reference. */
function beltGraphic(shape: BeltShape, mk: number, frame: number): Graphics {
    const g = new Graphics()
    const rim = BELT_MK_COLOR[mk - 1]!
    const offset = (frame / BELT_FRAMES) * BELT_PERIOD
    // Transparent padding keeps the texture exactly one tile.
    g.rect(0, 0, TILE, TILE).fill({ color: 0, alpha: 0 })
    if (shape === 'straight') {
        g.rect(0, 12, TILE, 40).fill(BAND)
        g.rect(0, 12, TILE, 5).fill(rim)
        g.rect(0, 47, TILE, 5).fill(rim)
        g.moveTo(0, 12).lineTo(TILE, 12).stroke({ width: 2.5, color: OUTLINE })
        g.moveTo(0, 52).lineTo(TILE, 52).stroke({ width: 2.5, color: OUTLINE })
        for (let x = offset - BELT_PERIOD; x < TILE + BELT_PERIOD; x += BELT_PERIOD) {
            if (x < 3 || x > TILE - 3) continue
            drawChevron(g, x, 32, 0, CHEVRON, 0.75)
        }
        return g
    }
    // Curves: fed from the left side (north when facing east) or the right
    // (south), turning into the east edge. Centre on the shared corner.
    const fromTop = shape === 'curveL'
    const cx = TILE
    const cy = fromTop ? 0 : TILE
    const a0 = Math.PI
    const a1 = fromTop ? Math.PI / 2 : Math.PI * 1.5
    const ccw = fromTop
    const band = (r0: number, r1: number, color: number) => {
        g.moveTo(cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1)
        g.arc(cx, cy, r1, a0, a1, ccw)
        g.lineTo(cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0)
        g.arc(cx, cy, r0, a1, a0, !ccw)
        g.closePath().fill(color)
    }
    band(12, 52, BAND)
    band(12, 17, rim)
    band(47, 52, rim)
    g.moveTo(cx + Math.cos(a0) * 12, cy + Math.sin(a0) * 12)
    g.arc(cx, cy, 12, a0, a1, ccw).stroke({ width: 2.5, color: OUTLINE })
    g.moveTo(cx + Math.cos(a0) * 52, cy + Math.sin(a0) * 52)
    g.arc(cx, cy, 52, a0, a1, ccw).stroke({ width: 2.5, color: OUTLINE })
    // Two chevrons along the 50-unit midline arc.
    const len = (Math.PI / 2) * 32
    for (let s = offset * (len / TILE) - len / 2; s < len + len / 2; s += len / 2) {
        if (s < 4 || s > len - 4) continue
        const t = s / len
        const ang = fromTop ? Math.PI - t * Math.PI / 2 : Math.PI + t * Math.PI / 2
        const px = cx + Math.cos(ang) * 32
        const py = cy + Math.sin(ang) * 32
        const heading = fromTop ? ang - Math.PI / 2 : ang + Math.PI / 2
        drawChevron(g, px, py, heading, CHEVRON, 0.75)
    }
    return g
}

export async function loadTextures(renderer: Renderer): Promise<GridTextures> {
    const building: Partial<Record<Kind, Texture>> = {}
    const spin: Partial<Record<Kind, Texture>> = {}
    const item = {} as Record<ItemId, Texture>
    const jobs: Promise<void>[] = []
    for (const [k, def] of Object.entries(BUILDINGS) as [Kind, typeof BUILDINGS[Kind]][]) {
        if (!def.sprite) continue
        const url = `/gridworks/sprites/${def.sprite}`
        jobs.push(rasterSvg(url, def.w * TILE * RES, def.h * TILE * RES).then((t) => { building[k] = t }))
        if (k === 'miner' || k === 'grinder' || k === 'crystal-drill') {
            jobs.push(rasterSvg(url.replace('.svg', '.spin.svg'), TILE * RES, TILE * RES).then((t) => { spin[k] = t }))
        }
    }
    for (const id of ITEM_IDS) {
        jobs.push(rasterSvg(`/gridworks/sprites/items/${id}.svg`, 64, 64).then((t) => { item[id] = t }))
    }
    await Promise.all(jobs)

    const belt: Record<BeltShape, Texture[]>[] = []
    for (let mk = 1; mk <= 4; mk++) {
        const set = { straight: [], curveL: [], curveR: [] } as Record<BeltShape, Texture[]>
        for (const shape of ['straight', 'curveL', 'curveR'] as BeltShape[]) {
            for (let f = 0; f < BELT_FRAMES; f++) {
                const g = beltGraphic(shape, mk, f)
                set[shape].push(renderer.generateTexture({ target: g, resolution: RES, antialias: true }))
                g.destroy()
            }
        }
        belt.push(set)
    }
    return { building, spin, item, belt, white: Texture.WHITE }
}
