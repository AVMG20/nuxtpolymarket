/*
 * World dressing on top of the tiled floor: rune circles that pulse, glowing
 * crystal clusters with light pools, bones and rubble. Placed per world
 * chunk from a hash of the chunk coordinates, so the same spot always looks
 * the same, and recycled as the camera moves. Purely cosmetic.
 */
import { Sprite } from 'pixi.js'
import type { Container } from 'pixi.js'
import type { AtlasBaker } from './atlas'
import type { BiomeDef } from './biomes'

const CHUNK = 640

interface Item {
    s: Sprite
    add: boolean
    a: number
    ph: number
    spin: number
    pulse: number
}

function hash(cx: number, cy: number, salt: number): () => number {
    let h = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(salt, 83492791)) >>> 0
    return () => {
        h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0
        h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296
    }
}

export class FloorDecor {
    private readonly chunks = new Map<string, Item[]>()
    private readonly freeN: Sprite[] = []
    private readonly freeA: Sprite[] = []
    private biome: BiomeDef | null = null
    private salt = 7

    constructor(private readonly atlas: AtlasBaker, private readonly norm: Container, private readonly add: Container) {}

    /** Switch the dressing set; every chunk is rebuilt for the new biome */
    setBiome(b: BiomeDef, salt: number): void {
        this.biome = b
        this.salt = salt
        for (const items of this.chunks.values()) {
            for (const it of items) {
                it.s.visible = false
                ;(it.add ? this.freeA : this.freeN).push(it.s)
            }
        }
        this.chunks.clear()
    }

    private sprite(tex: string, add: boolean): Sprite {
        const free = add ? this.freeA : this.freeN
        let s = free.pop()
        if (!s) {
            s = new Sprite()
            s.anchor.set(0.5)
            ;(add ? this.add : this.norm).addChild(s)
        }
        s.texture = this.atlas.get(tex)
        s.visible = true
        s.rotation = 0
        s.scale.set(1)
        s.alpha = 1
        s.tint = 0xffffff
        return s
    }

    private glow(items: Item[], x: number, y: number, col: number, sx: number, sy: number, a: number, pulse: number, ph: number): void {
        const g = this.sprite('glow', true)
        g.position.set(x, y)
        g.tint = col
        g.scale.set(sx, sy)
        items.push({ s: g, add: true, a, ph, spin: 0, pulse })
    }

    private build(cx: number, cy: number): Item[] {
        const r = hash(cx, cy, this.salt)
        const items: Item[] = []
        const list = this.biome?.decor ?? []
        const total = list.reduce((t, d) => t + d.w, 0)
        if (!total) return items
        const n = r() < 0.2 ? 0 : 1 + Math.floor(r() * 3)
        for (let i = 0; i < n; i++) {
            const x = (cx + 0.1 + r() * 0.8) * CHUNK
            const y = (cy + 0.1 + r() * 0.8) * CHUNK
            let roll = r() * total
            let d = list[0]!
            for (const it of list) {
                roll -= it.w
                if (roll <= 0) {
                    d = it
                    break
                }
            }
            const col = d.tint[Math.floor(r() * d.tint.length)]!
            const flip = r() < 0.5 ? -1 : 1
            const ph = r() * 6.28
            switch (d.kind) {
                case 'rune': {
                    const s = this.sprite('deco.circle', true)
                    s.position.set(x, y)
                    s.tint = col
                    s.scale.set(0.9 + r() * 0.9, (0.9 + r() * 0.9) * 0.62)
                    items.push({ s, add: true, a: 0.16 + r() * 0.1, ph, spin: 0, pulse: 1 })
                    this.glow(items, x, y, col, 2.2, 1.4, 0.07, 1, ph)
                    break
                }
                case 'crystal': {
                    this.glow(items, x, y + 14, col, 2.8, 1.9, 0.14, 0.5, ph)
                    const s = this.sprite('deco.crystal', false)
                    s.position.set(x, y)
                    s.tint = col
                    const sc = 0.7 + r() * 0.6
                    s.scale.set(flip * sc, sc)
                    items.push({ s, add: false, a: 0.85, ph: 0, spin: 0, pulse: 0 })
                    this.glow(items, x, y - 10 * sc, col, 0.6 * sc, 0.6 * sc, 0.35, 1, ph)
                    break
                }
                case 'lava': {
                    this.glow(items, x, y, col, 3.4, 2.1, 0.3, 0.6, ph)
                    const s = this.sprite('deco.lava', false)
                    s.position.set(x, y)
                    const sc = 0.8 + r() * 0.9
                    s.scale.set(flip * sc, sc)
                    s.rotation = (r() - 0.5) * 0.5
                    items.push({ s, add: false, a: 1, ph: 0, spin: 0, pulse: 0 })
                    this.glow(items, x, y, 0xffc060, 1.2 * sc, 0.7 * sc, 0.5, 0.8, ph)
                    break
                }
                case 'vent': {
                    this.glow(items, x, y - 6, col, 1.6, 1.2, 0.28, 1, ph)
                    const s = this.sprite('deco.vent', false)
                    s.position.set(x, y)
                    s.scale.set(flip * (0.9 + r() * 0.4), 0.9 + r() * 0.4)
                    items.push({ s, add: false, a: 1, ph: 0, spin: 0, pulse: 0 })
                    break
                }
                case 'ice': {
                    this.glow(items, x, y + 20, col, 3, 1.6, 0.16, 0.4, ph)
                    const s = this.sprite('deco.ice', false)
                    s.position.set(x, y)
                    s.tint = col | 0x404040
                    const sc = 0.7 + r() * 0.8
                    s.scale.set(flip * sc, sc)
                    items.push({ s, add: false, a: 0.95, ph: 0, spin: 0, pulse: 0 })
                    break
                }
                case 'snow': {
                    const s = this.sprite('deco.snow', false)
                    s.position.set(x, y)
                    const sc = 0.8 + r() * 1.1
                    s.scale.set(flip * sc, sc * 0.9)
                    items.push({ s, add: false, a: 0.85, ph: 0, spin: 0, pulse: 0 })
                    break
                }
                case 'shroom': {
                    this.glow(items, x, y, col, 3.2, 2.2, 0.2, 0.7, ph)
                    const sc = 0.7 + r() * 0.9
                    const s = this.sprite('deco.shroom', false)
                    s.position.set(x, y)
                    s.scale.set(flip * sc, sc)
                    items.push({ s, add: false, a: 1, ph: 0, spin: 0, pulse: 0 })
                    const c = this.sprite('deco.shroomCap', true)
                    c.position.set(x, y)
                    c.tint = col
                    c.scale.set(flip * sc, sc)
                    items.push({ s: c, add: true, a: 0.9, ph, spin: 0, pulse: 0.6 })
                    break
                }
                case 'pylon': {
                    this.glow(items, x, y + 50, col, 2.4, 1.2, 0.12, 0.5, ph)
                    const s = this.sprite('deco.pylon', false)
                    s.position.set(x, y)
                    const sc = 0.9 + r() * 0.4
                    s.scale.set(sc)
                    items.push({ s, add: false, a: 1, ph: 0, spin: 0, pulse: 0 })
                    this.glow(items, x, y - 48 * sc, col, 1.1, 1.1, 0.6, 1, ph)
                    break
                }
                case 'tear': {
                    this.glow(items, x, y, col, 2.6, 3.4, 0.22, 1, ph)
                    const s = this.sprite('deco.tear', true)
                    s.position.set(x, y)
                    s.tint = col
                    const sc = 0.7 + r() * 0.8
                    s.scale.set(flip * sc, sc)
                    s.rotation = (r() - 0.5) * 0.6
                    items.push({ s, add: true, a: 0.85, ph, spin: 0, pulse: 0.5 })
                    break
                }
                case 'rubble': {
                    const s = this.sprite('deco.rubble', false)
                    s.position.set(x, y)
                    s.tint = col
                    const sc = 0.8 + r() * 0.6
                    s.scale.set(flip * sc, sc)
                    items.push({ s, add: false, a: 0.9, ph: 0, spin: 0, pulse: 0 })
                    break
                }
                case 'bones': {
                    const s = this.sprite('deco.bones', false)
                    s.position.set(x, y)
                    s.tint = col
                    s.rotation = (r() - 0.5) * 0.8
                    s.scale.set(0.8 + r() * 0.4)
                    items.push({ s, add: false, a: 0.75, ph: 0, spin: 0, pulse: 0 })
                    break
                }
                default: {
                    const s = this.sprite('decal.crack', false)
                    s.position.set(x, y)
                    s.tint = col
                    s.rotation = r() * 6.28
                    s.scale.set(1.2 + r() * 1.2)
                    items.push({ s, add: false, a: 0.45, ph: 0, spin: 0, pulse: 0 })
                }
            }
        }
        return items
    }

    update(camX: number, camY: number, halfW: number, halfH: number, time: number): void {
        const x0 = Math.floor((camX - halfW - 120) / CHUNK)
        const x1 = Math.floor((camX + halfW + 120) / CHUNK)
        const y0 = Math.floor((camY - halfH - 120) / CHUNK)
        const y1 = Math.floor((camY + halfH + 120) / CHUNK)
        for (const [key, items] of this.chunks) {
            const [cx, cy] = key.split(',').map(Number) as [number, number]
            if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) continue
            for (const it of items) {
                it.s.visible = false
                ;(it.add ? this.freeA : this.freeN).push(it.s)
            }
            this.chunks.delete(key)
        }
        for (let cx = x0; cx <= x1; cx++) {
            for (let cy = y0; cy <= y1; cy++) {
                const key = `${cx},${cy}`
                if (!this.chunks.has(key)) this.chunks.set(key, this.build(cx, cy))
            }
        }
        for (const items of this.chunks.values()) {
            for (const it of items) {
                it.s.alpha = it.pulse ? it.a * (1 - it.pulse * 0.45 + it.pulse * 0.45 * Math.sin(time * 1.6 + it.ph)) : it.a
            }
        }
    }
}
