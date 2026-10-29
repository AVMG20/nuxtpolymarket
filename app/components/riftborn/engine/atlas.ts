/*
 * Bakes vector drawings into a few shared atlas pages so the whole scene
 * batches into a handful of draw calls. Entries are drawn centred on 0,0.
 */
import { Container, Graphics, Rectangle, Texture } from 'pixi.js'
import type { Renderer } from 'pixi.js'

interface Entry {
    key: string
    w: number
    h: number
    draw: (g: Graphics) => void
    x: number
    y: number
    page: number
}

const PAGE = 2048
const PAD = 4

class Group {
    entries: Entry[] = []
    constructor(readonly resolution: number) {}
}

export class AtlasBaker {
    private readonly hi: Group
    private readonly lo: Group
    readonly textures = new Map<string, Texture>()
    readonly pages: Texture[] = []

    constructor(resolution: number) {
        this.hi = new Group(resolution)
        this.lo = new Group(Math.min(resolution, 1.25))
    }

    add(key: string, w: number, h: number, draw: (g: Graphics) => void): void {
        const group = Math.max(w, h) > 170 ? this.lo : this.hi
        group.entries.push({ key, w: Math.ceil(w), h: Math.ceil(h), draw, x: 0, y: 0, page: 0 })
    }

    build(renderer: Renderer): void {
        this.buildGroup(renderer, this.hi)
        this.buildGroup(renderer, this.lo)
    }

    get(key: string): Texture {
        return this.textures.get(key) ?? Texture.WHITE
    }

    private buildGroup(renderer: Renderer, group: Group): void {
        if (group.entries.length === 0) return
        // Shelf pack in insertion order (first page holds the particle textures)
        let page = 0
        let x = PAD
        let y = PAD
        let shelf = 0
        const heights: number[] = [0]
        for (const e of group.entries) {
            if (x + e.w + PAD > PAGE) {
                x = PAD
                y += shelf + PAD
                shelf = 0
            }
            if (y + e.h + PAD > PAGE) {
                page++
                heights.push(0)
                x = PAD
                y = PAD
                shelf = 0
            }
            e.x = x
            e.y = y
            e.page = page
            x += e.w + PAD
            shelf = Math.max(shelf, e.h)
            heights[page] = Math.max(heights[page]!, y + e.h + PAD)
        }
        for (let p = 0; p <= page; p++) {
            const root = new Container()
            const gs: Graphics[] = []
            for (const e of group.entries) {
                if (e.page !== p) continue
                const g = new Graphics()
                try {
                    e.draw(g)
                } catch {
                    g.clear()
                }
                g.position.set(e.x + e.w / 2, e.y + e.h / 2)
                root.addChild(g)
                gs.push(g)
            }
            const rt = renderer.generateTexture({
                target: root,
                frame: new Rectangle(0, 0, PAGE, Math.min(PAGE, Math.ceil(heights[p]!))),
                resolution: group.resolution,
                antialias: true
            })
            this.pages.push(rt)
            for (const e of group.entries) {
                if (e.page !== p) continue
                this.textures.set(e.key, new Texture({ source: rt.source, frame: new Rectangle(e.x, e.y, e.w, e.h) }))
            }
            root.destroy({ children: true })
        }
        group.entries = []
    }

    destroy(): void {
        for (const t of this.textures.values()) t.destroy(false)
        this.textures.clear()
        for (const p of this.pages) p.destroy(true)
        this.pages.length = 0
    }
}
