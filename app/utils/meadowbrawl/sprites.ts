// Pre-rendered character sprites. The sheets are baked from CC0 KayKit glTF
// packs by scripts/meadowbrawl-sprites (see public/meadowbrawl/sprites/
// ATTRIBUTION.md). Each sheet holds one row per animation; each row holds
// `frames` × 5 cells — five baked facings (E, NE, N, SE, S), the west-side
// facings are mirrored at draw time.

export interface AtlasAnim {
    row: number
    frames: number
    loop: boolean
}

export interface AtlasSheet {
    cell: number
    anchorX: number
    anchorY: number
    cols: number
    dirs: number
    anims: Record<string, AtlasAnim>
}

export interface Sheet {
    img: HTMLImageElement
    atlas: AtlasSheet
}

export type SheetName = 'knight' | 'berserker' | 'lancer' | 'assassin' | 'juggernaut' | 'reaper'
    | 'grunt' | 'swarmer' | 'charger' | 'shield' | 'ranged' | 'ogre' | 'warlord'

const BASE = '/meadowbrawl/sprites'

export class SpriteLibrary {
    private sheets = new Map<string, Sheet>()
    private scratch: HTMLCanvasElement | null = null
    loaded = false
    failed = false

    async load(): Promise<void> {
        try {
            const atlas: Record<string, AtlasSheet> = await (await fetch(`${BASE}/atlas.json`)).json()
            await Promise.all(Object.entries(atlas).map(([name, a]) => new Promise<void>((res, rej) => {
                const img = new Image()
                img.onload = () => {
                    this.sheets.set(name, { img, atlas: a })
                    res()
                }
                img.onerror = () => rej(new Error(`sprite sheet ${name} failed to load`))
                img.src = `${BASE}/${name}.webp`
            })))
            this.loaded = true
        } catch {
            this.failed = true
        }
    }

    has(name: string): boolean {
        return this.sheets.has(name)
    }

    /**
     * Draw one frame. `angle` is the facing in logic space (0 = east, π/2 =
     * south); `t` is the animation phase in [0, 1). The sprite's feet land on
     * (x, y) and `scale` maps cell pixels to view pixels.
     */
    draw(ctx: CanvasRenderingContext2D, name: string, anim: string, angle: number, t: number, x: number, y: number, scale: number, tint?: { color: string, alpha: number }) {
        const sheet = this.sheets.get(name)
        if (!sheet) return false
        const a = sheet.atlas.anims[anim] ?? sheet.atlas.anims.idle
        if (!a) return false
        const { cell, anchorX, anchorY } = sheet.atlas
        // 8-way facing from the angle; baked facings are E, NE, N, SE, S.
        let dir8 = Math.round(angle / (Math.PI / 4))
        dir8 = ((dir8 % 8) + 8) % 8
        // 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE  (y grows southward)
        const baked = [0, 3, 4, 3, 0, 1, 2, 1][dir8]!
        const mirror = dir8 === 3 || dir8 === 4 || dir8 === 5
        const k = Math.max(0, Math.min(0.9999, t))
        const frame = a.loop ? Math.floor(k * a.frames) : Math.min(a.frames - 1, Math.floor(k * a.frames))
        const sx = (frame * sheet.atlas.dirs + baked) * cell
        const sy = a.row * cell
        ctx.save()
        ctx.translate(x, y)
        if (mirror) ctx.scale(-1, 1)
        if (tint && tint.alpha > 0) {
            const s = this.scratchCanvas(cell)
            const sc = s.getContext('2d')!
            sc.clearRect(0, 0, cell, cell)
            sc.globalCompositeOperation = 'source-over'
            sc.drawImage(sheet.img, sx, sy, cell, cell, 0, 0, cell, cell)
            sc.globalCompositeOperation = 'source-atop'
            sc.globalAlpha = tint.alpha
            sc.fillStyle = tint.color
            sc.fillRect(0, 0, cell, cell)
            sc.globalAlpha = 1
            ctx.drawImage(s, 0, 0, cell, cell, -anchorX * scale, -anchorY * scale, cell * scale, cell * scale)
        } else {
            ctx.drawImage(sheet.img, sx, sy, cell, cell, -anchorX * scale, -anchorY * scale, cell * scale, cell * scale)
        }
        ctx.restore()
        return true
    }

    private scratchCanvas(size: number): HTMLCanvasElement {
        if (!this.scratch) this.scratch = document.createElement('canvas')
        if (this.scratch.width < size) {
            this.scratch.width = size
            this.scratch.height = size
        }
        return this.scratch
    }
}
