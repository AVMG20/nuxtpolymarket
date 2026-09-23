// Spiñata Slots reel scene (Pixi + pixi-reels). Owns the reel window: column
// backings, the reels, spin blur, landing pops, anticipation frames, payline
// drawing, win glows and confetti particles. Game flow, sound and DOM overlays
// stay in SpinataGame.client.vue; this module only draws what it is told.
//
// Randomness here is cosmetic only (particle spread, idle grid).

import type { Application, BlurFilter, Container, Graphics, Sprite, Text, Texture, Ticker } from 'pixi.js'
import type { ReelSet, SpeedProfile } from 'pixi-reels'
import type { Cell, SpinSymbol } from '#shared/utils/gamelogic/spinata'
import { SYMBOL_WEIGHTS } from '#shared/utils/gamelogic/spinata'
import { initSlotPixiApp, safeDestroy } from '~/utils/slot-pixi'
import { suspenseStopDelays, teaseReelSpeed } from '~/utils/slots/reel-suspense'
import type { SuspenseTiming } from '~/utils/slots/reel-suspense'

type PixiModule = typeof import('pixi.js')
type ReelsModule = typeof import('pixi-reels')
type Gsap = typeof import('gsap').gsap

export const SPN_CELL = 150
export const SPN_GAP = 6
export const SPN_PAD = 12

const COLS = 5
const ROWS = 3
const REEL_W = COLS * SPN_CELL + (COLS - 1) * SPN_GAP
const REEL_H = ROWS * SPN_CELL + (ROWS - 1) * SPN_GAP
export const SPN_APP_W = REEL_W + SPN_PAD * 2
export const SPN_APP_H = REEL_H + SPN_PAD * 2

const SYMBOLS: SpinSymbol[] = ['ten', 'jack', 'queen', 'king', 'ace', 'maracas', 'cactus', 'sombrero', 'flower', 'wild', 'scatter', 'bonus']
const SPECIAL = new Set<string>(['wild', 'scatter', 'bonus'])
const HIGH = new Set<string>(['maracas', 'cactus', 'sombrero', 'flower', 'wild', 'scatter', 'bonus'])

/** Fiesta palette for paylines, glows and confetti. */
export const SPN_LINE_COLORS = [0xffc93c, 0xff3d7f, 0x2ee6c9, 0xb86bff, 0xff8a1f, 0x5cc8ff, 0x9dff4a, 0xff5a5a, 0xffe066, 0xff7ad9]
const CONFETTI_COLORS = [0xff2d6f, 0xffb400, 0x00c2a8, 0x7b3cff, 0xff6a00, 0x2ec5ff, 0x7ed321, 0xffe066]

export function spinataCellCenter(col: number, row: number) {
    return { x: col * (SPN_CELL + SPN_GAP) + SPN_CELL / 2, y: row * (SPN_CELL + SPN_GAP) + SPN_CELL / 2 }
}

interface Particle {
    s: Sprite
    vx: number
    vy: number
    vr: number
    life: number
    max: number
    g: number
    drag: number
    flutter: number
    phase: number
    baseScale: number
}

interface DrawnLine {
    g: Graphics
    points: { x: number, y: number }[]
    color: number
    progress: number
    speed: number
    width: number
    spark: Sprite | null
}

interface WinTile {
    col: number
    row: number
}

export interface SpinataSceneEvents {
    onReelStopping?: (reel: number) => void
    /** A reel starts its suspense tease (the reel before it just landed). */
    onAnticipate?: (reel: number) => void
    onReelLanded?: (reel: number, symbols: string[]) => void
}

interface TileApi {
    view: Container
    symbolId: string
    land: () => void
    startWin: (strong: boolean) => void
    stopWin: () => void
    setDim: (dim: boolean) => void
    breathe: (t: number) => void
    shake: (strength: number) => void
}

export class SpinataScene {
    private PIXI!: PixiModule
    private gsap!: Gsap
    private app: Application | null = null
    private reelSet: ReelSet | null = null
    private board: Container | null = null
    private backing: Sprite | null = null
    private glowLayer: Container | null = null
    private frameLayer: Container | null = null
    private lineLayer: Container | null = null
    private fxLayer: Container | null = null
    private textLayer: Container | null = null
    private anticipation = new Map<number, { g: Graphics, t: number }>()
    private blurs: BlurFilter[] = []
    private particles: Particle[] = []
    private lines: DrawnLine[] = []
    private winTiles: WinTile[] = []
    private tex: Record<string, Texture> = {}
    private fx: Record<'glow' | 'rays' | 'spark' | 'confetti' | 'dot' | 'flag', Texture> | null = null
    private destroyed = false
    private time = 0
    private tick = (ticker: Ticker) => this.update(ticker)
    fiesta = false
    turbo = false
    events: SpinataSceneEvents = {}

    get canvas(): HTMLCanvasElement | null {
        return this.app?.canvas ?? null
    }

    async init(host: HTMLElement): Promise<boolean> {
        const [pixi, reels, gsapMod] = await Promise.all([import('pixi.js'), import('pixi-reels'), import('gsap')])
        if (this.destroyed) return false
        this.PIXI = pixi
        this.gsap = gsapMod.gsap ?? gsapMod.default

        const app = await initSlotPixiApp(pixi.Application, { width: SPN_APP_W, height: SPN_APP_H }, () => this.destroyed)
        if (!app) return false
        this.app = app
        host.appendChild(app.canvas)
        this.fitResolution(host.clientWidth || SPN_APP_W)

        await Promise.all(SYMBOLS.map(async (id) => {
            const file = id === 'bonus' ? 'pinata' : id
            this.tex[id] = await pixi.Assets.load<Texture>(`/slots/spinata/${file}.png`)
        }))
        try {
            await document.fonts.load('32px "Lilita One"')
        } catch {
            // Font blocked: Pixi falls back to the next family.
        }
        if (this.destroyed) return false

        this.fx = this.makeFxTextures()
        this.buildStage(reels)
        app.ticker.add(this.tick)
        return true
    }

    /** Keep the backing store at or above the canvas's on-screen size (never upscaled on dpr 1). */
    fitResolution(cssWidth: number) {
        if (!this.app) return
        const dpr = window.devicePixelRatio || 1
        const res = Math.max(1, Math.min(3, (dpr * cssWidth) / SPN_APP_W))
        if (Math.abs(this.app.renderer.resolution - res) < 0.02) return
        this.app.renderer.resize(SPN_APP_W, SPN_APP_H, res)
    }

    // --- building --------------------------------------------------------------

    private makeCanvas(w: number, h: number) {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        return { c, g: c.getContext('2d')! }
    }

    private makeFxTextures() {
        const { Texture } = this.PIXI
        const glow = this.makeCanvas(256, 256)
        const rg = glow.g.createRadialGradient(128, 128, 0, 128, 128, 128)
        rg.addColorStop(0, 'rgba(255,255,255,1)')
        rg.addColorStop(0.25, 'rgba(255,255,255,0.55)')
        rg.addColorStop(0.6, 'rgba(255,255,255,0.12)')
        rg.addColorStop(1, 'rgba(255,255,255,0)')
        glow.g.fillStyle = rg
        glow.g.fillRect(0, 0, 256, 256)

        const rays = this.makeCanvas(256, 256)
        rays.g.translate(128, 128)
        for (let i = 0; i < 14; i++) {
            rays.g.rotate((Math.PI * 2) / 14)
            const lg = rays.g.createLinearGradient(0, 0, 0, -128)
            lg.addColorStop(0, 'rgba(255,255,255,0.9)')
            lg.addColorStop(1, 'rgba(255,255,255,0)')
            rays.g.fillStyle = lg
            rays.g.beginPath()
            rays.g.moveTo(-5, 0)
            rays.g.lineTo(-16, -128)
            rays.g.lineTo(16, -128)
            rays.g.lineTo(5, 0)
            rays.g.fill()
        }

        const spark = this.makeCanvas(64, 64)
        const sg = spark.g.createRadialGradient(32, 32, 0, 32, 32, 32)
        sg.addColorStop(0, 'rgba(255,255,255,1)')
        sg.addColorStop(0.2, 'rgba(255,255,255,0.7)')
        sg.addColorStop(1, 'rgba(255,255,255,0)')
        spark.g.fillStyle = sg
        spark.g.fillRect(0, 0, 64, 64)
        spark.g.fillStyle = '#fff'
        spark.g.beginPath()
        spark.g.moveTo(32, 0)
        spark.g.quadraticCurveTo(35, 29, 64, 32)
        spark.g.quadraticCurveTo(35, 35, 32, 64)
        spark.g.quadraticCurveTo(29, 35, 0, 32)
        spark.g.quadraticCurveTo(29, 29, 32, 0)
        spark.g.fill()

        const confetti = this.makeCanvas(16, 10)
        confetti.g.fillStyle = '#fff'
        confetti.g.fillRect(0, 0, 16, 10)

        const dot = this.makeCanvas(16, 16)
        dot.g.fillStyle = '#fff'
        dot.g.beginPath()
        dot.g.arc(8, 8, 7, 0, Math.PI * 2)
        dot.g.fill()

        // Tiny papel picado flag: a square with a zig-zag hem and cut-outs.
        const flag = this.makeCanvas(24, 28)
        flag.g.fillStyle = '#fff'
        flag.g.beginPath()
        flag.g.moveTo(0, 0)
        flag.g.lineTo(24, 0)
        flag.g.lineTo(24, 22)
        for (let x = 24; x >= 0; x -= 4) flag.g.lineTo(x, (x / 4) % 2 === 0 ? 22 : 28)
        flag.g.closePath()
        flag.g.fill()
        flag.g.globalCompositeOperation = 'destination-out'
        flag.g.beginPath()
        flag.g.arc(12, 11, 4, 0, Math.PI * 2)
        flag.g.fill()
        flag.g.fillRect(4, 4, 3, 3)
        flag.g.fillRect(17, 4, 3, 3)
        flag.g.fillRect(4, 16, 3, 3)
        flag.g.fillRect(17, 16, 3, 3)

        return {
            glow: Texture.from(glow.c),
            rays: Texture.from(rays.c),
            spark: Texture.from(spark.c),
            confetti: Texture.from(confetti.c),
            dot: Texture.from(dot.c),
            flag: Texture.from(flag.c)
        }
    }

    /** The reel window backing: five lacquered columns with a warm inner light. */
    private makeBackingTexture(): Texture {
        const scale = 2
        const { c, g } = this.makeCanvas(REEL_W * scale, REEL_H * scale)
        g.scale(scale, scale)
        for (let col = 0; col < COLS; col++) {
            const x = col * (SPN_CELL + SPN_GAP)
            const lg = g.createLinearGradient(0, 0, 0, REEL_H)
            lg.addColorStop(0, '#2a0b3d')
            lg.addColorStop(0.5, '#3d1257')
            lg.addColorStop(1, '#22072f')
            g.fillStyle = lg
            g.beginPath()
            g.roundRect(x, 0, SPN_CELL, REEL_H, 12)
            g.fill()
            // Warm centre light.
            const rg = g.createRadialGradient(x + SPN_CELL / 2, REEL_H / 2, 10, x + SPN_CELL / 2, REEL_H / 2, REEL_H * 0.6)
            rg.addColorStop(0, 'rgba(255,150,90,0.16)')
            rg.addColorStop(1, 'rgba(255,150,90,0)')
            g.fillStyle = rg
            g.fillRect(x, 0, SPN_CELL, REEL_H)
            // Faint talavera diamonds.
            g.save()
            g.beginPath()
            g.roundRect(x, 0, SPN_CELL, REEL_H, 12)
            g.clip()
            g.strokeStyle = 'rgba(255,210,150,0.05)'
            g.lineWidth = 1
            for (let yy = -SPN_CELL; yy < REEL_H + SPN_CELL; yy += 30) {
                for (let xx = x - 30; xx < x + SPN_CELL + 30; xx += 30) {
                    g.beginPath()
                    g.moveTo(xx + 15, yy)
                    g.lineTo(xx + 30, yy + 15)
                    g.lineTo(xx + 15, yy + 30)
                    g.lineTo(xx, yy + 15)
                    g.closePath()
                    g.stroke()
                }
            }
            // Inner edge shadow top and bottom (reel curvature).
            const sh = g.createLinearGradient(0, 0, 0, REEL_H)
            sh.addColorStop(0, 'rgba(8,0,16,0.55)')
            sh.addColorStop(0.12, 'rgba(8,0,16,0)')
            sh.addColorStop(0.88, 'rgba(8,0,16,0)')
            sh.addColorStop(1, 'rgba(8,0,16,0.6)')
            g.fillStyle = sh
            g.fillRect(x, 0, SPN_CELL, REEL_H)
            g.restore()
            g.strokeStyle = 'rgba(255,196,120,0.18)'
            g.lineWidth = 1.2
            g.beginPath()
            g.roundRect(x + 0.6, 0.6, SPN_CELL - 1.2, REEL_H - 1.2, 12)
            g.stroke()
        }
        return this.PIXI.Texture.from(c)
    }

    private buildStage(reels: ReelsModule) {
        const { Container, Sprite, BlurFilter } = this.PIXI
        const app = this.app!
        const board = new Container()
        board.position.set(SPN_PAD, SPN_PAD)
        app.stage.addChild(board)
        this.board = board

        this.backing = new Sprite(this.makeBackingTexture())
        this.backing.width = REEL_W
        this.backing.height = REEL_H
        board.addChild(this.backing)

        this.glowLayer = new Container()
        board.addChild(this.glowLayer)

        const Tile = this.makeTileClass(reels)
        const weights: Record<string, number> = { ...SYMBOL_WEIGHTS }
        const speed = (base: SpeedProfile, overrides: Partial<SpeedProfile>): SpeedProfile => ({ ...base, ...overrides })
        this.reelSet = new reels.ReelSetBuilder()
            .reels(COLS)
            .visibleRows(ROWS)
            .symbolSize(SPN_CELL, SPN_CELL)
            .symbolGap(SPN_GAP, SPN_GAP)
            .symbols((r) => {
                for (const id of SYMBOLS) r.register(id, Tile, {})
            })
            .weights(weights)
            .speed('normal', speed(reels.SpeedPresets.NORMAL, { name: 'normal', spinSpeed: 34, stopDelay: 190, anticipationDelay: 1500, bounceDistance: 34, bounceDuration: 420, minimumSpinTime: 650 }))
            .speed('turbo', speed(reels.SpeedPresets.TURBO, { name: 'turbo', stopDelay: 45, anticipationDelay: 650, bounceDistance: 24 }))
            .ticker(app.ticker)
            .build()
        board.addChild(this.reelSet)

        this.blurs = this.reelSet.reels.map((reel) => {
            const blur = new BlurFilter({ strengthX: 0, strengthY: 0, quality: 2 })
            blur.padding = 0
            reel.container.filters = null
            return blur
        })

        this.frameLayer = new Container()
        this.lineLayer = new Container()
        this.fxLayer = new Container()
        this.textLayer = new Container()
        for (const layer of [this.frameLayer, this.lineLayer, this.fxLayer, this.textLayer]) {
            layer.eventMode = 'none'
            board.addChild(layer)
        }

        this.reelSet.events.on('spin:stopping', (i: number) => {
            this.events.onReelStopping?.(i)
            // A teased first reel has no reel before it to hand the tease over.
            if (i === 0 && this.anticipationSet.has(0)) this.beginTease(0)
        })
        // Slam: stop teasing so a running slow-down tween can't move landed reels.
        this.reelSet.events.on('skip:requested', () => {
            this.slammed = true
            for (const reel of this.reelSet?.reels ?? []) this.gsap.killTweensOf(reel)
        })
        this.reelSet.events.on('spin:reelLanded', (i: number, symbols: string[]) => {
            this.stopAnticipation(i)
            if (this.anticipationSet.has(i + 1)) this.beginTease(i + 1)
            for (let row = 0; row < ROWS; row++) {
                if (SPECIAL.has(symbols[row] ?? '')) this.tileAt(i, row)?.land()
            }
            this.events.onReelLanded?.(i, symbols)
        })

        const idle = Array.from({ length: COLS }, (_, c) => ({
            visible: Array.from({ length: ROWS }, (_, r) => (['ace', 'flower', 'king', 'sombrero', 'queen', 'maracas', 'cactus', 'wild', 'jack', 'ten'] as const)[(c * 3 + r * 7) % 10]!)
        }))
        this.reelSet.setResult(idle)
    }

    private makeTileClass(reels: ReelsModule) {
        const { Sprite, Container } = this.PIXI
        const tex = this.tex
        const gsap = this.gsap

        class Tile extends reels.ReelSymbol implements TileApi {
            private holder = new Container()
            private shadow = new Sprite()
            private sprite = new Sprite()
            private w = SPN_CELL
            private h = SPN_CELL
            private loop: ReturnType<Gsap['timeline']> | null = null
            private pop: ReturnType<Gsap['to']> | null = null

            constructor() {
                super()
                this.shadow.anchor.set(0.5)
                this.shadow.tint = 0x0a0010
                this.shadow.alpha = 0.4
                this.sprite.anchor.set(0.5)
                this.holder.addChild(this.shadow, this.sprite)
                this.view.addChild(this.holder)
            }

            private render(id: string) {
                const t = tex[id]
                if (!t) return
                this.sprite.texture = t
                this.shadow.texture = t
                const fill = SPECIAL.has(id) ? 0.96 : HIGH.has(id) ? 0.9 : 0.84
                const max = Math.min(this.w, this.h) * fill
                const s = Math.min(max / t.width, max / t.height)
                this.sprite.scale.set(s)
                this.shadow.scale.set(s)
                this.shadow.position.set(3, 6)
                this.holder.position.set(this.w / 2, this.h / 2)
            }

            protected onActivate(id: string) {
                this.view.alpha = 1
                this.sprite.tint = 0xffffff
                this.render(id)
            }

            protected onDeactivate() {
                this.reset0()
            }

            resize(w: number, h: number) {
                this.w = w
                this.h = h
                if (this.symbolId) this.render(this.symbolId)
            }

            private reset0() {
                this.loop?.kill()
                this.loop = null
                this.pop?.kill()
                this.pop = null
                this.holder.scale.set(1)
                this.holder.rotation = 0
                this.holder.position.set(this.w / 2, this.h / 2)
                this.view.alpha = 1
                this.sprite.tint = 0xffffff
            }

            stopAnimation() {
                this.reset0()
            }

            playWin() {
                this.startWin(HIGH.has(this.symbolId))
                return new Promise<void>(resolve => setTimeout(resolve, 500))
            }

            land() {
                this.pop?.kill()
                this.holder.scale.set(1.28)
                this.pop = gsap.to(this.holder.scale, { x: 1, y: 1, duration: 0.55, ease: 'elastic.out(1.1, 0.45)' })
            }

            startWin(strong: boolean) {
                this.loop?.kill()
                this.view.alpha = 1
                this.sprite.tint = 0xffffff
                const tl = gsap.timeline({ repeat: -1 })
                const up = strong ? 1.16 : 1.1
                tl.to(this.holder.scale, { x: up, y: up, duration: 0.22, ease: 'back.out(3)' })
                if (strong) {
                    tl.to(this.holder, { rotation: 0.09, duration: 0.09, ease: 'sine.inOut' }, '<')
                    tl.to(this.holder, { rotation: -0.09, duration: 0.14, ease: 'sine.inOut' })
                    tl.to(this.holder, { rotation: 0, duration: 0.09, ease: 'sine.inOut' })
                }
                tl.to(this.holder.scale, { x: 1, y: 1, duration: 0.32, ease: 'sine.inOut' })
                tl.to({}, { duration: 0.18 })
                this.loop = tl
            }

            stopWin() {
                this.loop?.kill()
                this.loop = null
                gsap.to(this.holder.scale, { x: 1, y: 1, duration: 0.15 })
                this.holder.rotation = 0
            }

            setDim(dim: boolean) {
                this.view.alpha = dim ? 0.42 : 1
                this.sprite.tint = dim ? 0x8a7a9a : 0xffffff
            }

            breathe(t: number) {
                if (this.loop || this.pop?.isActive()) return
                const id = this.symbolId
                if (id === 'scatter') this.holder.rotation = Math.sin(t * 1.6) * 0.05
                else if (id === 'bonus') this.holder.rotation = Math.sin(t * 2.2 + this.w) * 0.07
                else if (id === 'wild') this.holder.scale.set(1 + Math.sin(t * 2.4) * 0.025)
            }

            shake(strength: number) {
                gsap.fromTo(this.holder, { rotation: -0.12 * strength }, { rotation: 0, duration: 0.5, ease: 'elastic.out(1.4, 0.2)' })
                gsap.fromTo(this.holder.position, { x: this.w / 2 + 5 * strength }, { x: this.w / 2, duration: 0.4, ease: 'elastic.out(1.4, 0.2)' })
            }
        }
        return Tile
    }

    private tileAt(col: number, row: number): TileApi | null {
        try {
            return (this.reelSet?.reels[col]?.getSymbolAt(row) as unknown as TileApi) ?? null
        } catch {
            return null
        }
    }

    // --- spinning --------------------------------------------------------------

    private anticipationSet = new Set<number>()
    private spinPromise: Promise<unknown> | null = null
    private slammed = false

    /** Suspense per speed mode: plain reels land `step` ms apart, teased ones `tease` ms. */
    private suspenseTiming(): SuspenseTiming {
        return { step: this.reelSet?.speed.active.stopDelay ?? 0, tease: this.turbo ? 650 : 1300 }
    }

    private beginTease(reel: number) {
        if (this.slammed || !this.reelSet) return
        this.startAnticipation(reel)
        this.events.onAnticipate?.(reel)
        teaseReelSpeed(this.gsap, this.reelSet.reels[reel], this.reelSet.speed.active.spinSpeed, this.suspenseTiming().tease)
    }

    /** Start the reels; land them later with land(). */
    startSpin() {
        if (!this.reelSet) return
        this.clearWins()
        this.reelSet.setSpeed(this.turbo ? 'turbo' : 'normal')
        this.anticipationSet.clear()
        this.slammed = false
        // pixi-reels' own anticipation runs every teased reel at once, so the
        // tease is timed with stop delays instead (see reel-suspense.ts).
        this.reelSet.setAnticipation([])
        this.reelSet.setStopDelays(suspenseStopDelays(COLS, [], this.suspenseTiming()))
        this.spinPromise = this.reelSet.spin()
    }

    /** Land the spinning reels on `grid`, slowing down on `anticipate` reels. */
    async land(grid: SpinSymbol[][], anticipate: number[] = []) {
        if (!this.reelSet) return
        if (!this.spinPromise) this.startSpin()
        this.anticipationSet = new Set(anticipate)
        this.reelSet.setStopDelays(suspenseStopDelays(COLS, anticipate, this.suspenseTiming()))
        this.reelSet.setResult(grid.map(col => ({ visible: col })))
        await this.spinPromise
        this.spinPromise = null
        for (const i of [...this.anticipation.keys()]) this.stopAnticipation(i)
    }

    /** Slam the reels (player pressed spin/space again). */
    slam() {
        try {
            this.reelSet?.requestSkip()
        } catch {
            // Nothing spinning.
        }
    }

    get spinning() {
        return this.spinPromise !== null
    }

    private startAnticipation(reel: number) {
        if (!this.frameLayer || this.anticipation.has(reel)) return
        const g = new this.PIXI.Graphics()
        g.blendMode = 'add'
        this.frameLayer.addChild(g)
        this.anticipation.set(reel, { g, t: 0 })
    }

    private stopAnticipation(reel: number) {
        const a = this.anticipation.get(reel)
        if (!a) return
        this.anticipation.delete(reel)
        this.gsap.to(a.g, { alpha: 0, duration: 0.25, onComplete: () => safeDestroy(() => a.g.destroy()) })
    }

    // --- wins -----------------------------------------------------------------

    /** Dim everything except `cells`, pulse the winners and put a glow under them. */
    highlight(cells: Cell[], color = 0xffc93c, strong = false) {
        this.clearHighlight()
        const keep = new Set(cells.map(c => `${c.col}:${c.row}`))
        for (let col = 0; col < COLS; col++) {
            for (let row = 0; row < ROWS; row++) {
                const tile = this.tileAt(col, row)
                if (!tile) continue
                if (keep.has(`${col}:${row}`)) {
                    tile.setDim(false)
                    tile.startWin(strong || HIGH.has(tile.symbolId))
                } else {
                    tile.setDim(true)
                }
            }
        }
        this.winTiles = cells.map(c => ({ col: c.col, row: c.row }))
        const { Sprite, Graphics } = this.PIXI
        const frames = new Graphics()
        for (const c of cells) {
            const p = spinataCellCenter(c.col, c.row)
            const glow = new Sprite(this.fx!.glow)
            glow.anchor.set(0.5)
            glow.tint = color
            glow.blendMode = 'add'
            glow.alpha = 0
            glow.scale.set(SPN_CELL / 150)
            glow.position.set(p.x, p.y)
            this.glowLayer!.addChild(glow)
            this.gsap.to(glow, { alpha: 0.85, duration: 0.2 })
            if (strong || HIGH.has(this.tileAt(c.col, c.row)?.symbolId ?? '')) {
                const rays = new Sprite(this.fx!.rays)
                rays.anchor.set(0.5)
                rays.tint = color
                rays.blendMode = 'add'
                rays.alpha = 0
                rays.scale.set(SPN_CELL / 200)
                rays.position.set(p.x, p.y)
                rays.label = 'rays'
                this.glowLayer!.addChild(rays)
                this.gsap.to(rays, { alpha: 0.5, duration: 0.3 })
            }
            const x = p.x - SPN_CELL / 2 + 3
            const y = p.y - SPN_CELL / 2 + 3
            frames.roundRect(x, y, SPN_CELL - 6, SPN_CELL - 6, 14)
        }
        frames.stroke({ width: 9, color, alpha: 0.22 })
        for (const c of cells) {
            const p = spinataCellCenter(c.col, c.row)
            frames.roundRect(p.x - SPN_CELL / 2 + 3, p.y - SPN_CELL / 2 + 3, SPN_CELL - 6, SPN_CELL - 6, 14)
        }
        frames.stroke({ width: 3, color, alpha: 0.95 })
        this.frameLayer!.addChild(frames)
        frames.alpha = 0
        this.gsap.to(frames, { alpha: 1, duration: 0.18 })
    }

    clearHighlight() {
        for (let col = 0; col < COLS; col++) {
            for (let row = 0; row < ROWS; row++) {
                const tile = this.tileAt(col, row)
                tile?.stopWin()
                tile?.setDim(false)
            }
        }
        this.winTiles = []
        this.glowLayer?.removeChildren().forEach(c => safeDestroy(() => c.destroy()))
        // Keep anticipation frames; they're tracked separately.
        const keep = new Set([...this.anticipation.values()].map(a => a.g))
        this.frameLayer?.children.slice().forEach((c) => {
            if (!keep.has(c as Graphics)) safeDestroy(() => c.destroy())
        })
    }

    /** Draw paylines (row per reel) with a draw-on animation and a travelling spark. */
    drawLines(lines: { rows: number[], color: number }[], spark = true, width = 5) {
        this.clearLines()
        const { Graphics, Sprite } = this.PIXI
        for (const line of lines) {
            const points = line.rows.map((row, col) => spinataCellCenter(col, row))
            const first = points[0]!
            const last = points[points.length - 1]!
            points.unshift({ x: first.x - SPN_CELL / 2 - 4, y: first.y })
            points.push({ x: last.x + SPN_CELL / 2 + 4, y: last.y })
            const g = new Graphics()
            this.lineLayer!.addChild(g)
            let s: Sprite | null = null
            if (spark) {
                s = new Sprite(this.fx!.spark)
                s.anchor.set(0.5)
                s.blendMode = 'add'
                s.scale.set(0.9)
                this.lineLayer!.addChild(s)
            }
            this.lines.push({ g, points, color: line.color, progress: 0, speed: this.turbo ? 5 : 3.2, width, spark: s })
        }
    }

    clearLines() {
        for (const l of this.lines) {
            safeDestroy(() => l.g.destroy())
            if (l.spark) safeDestroy(() => l.spark!.destroy())
        }
        this.lines = []
    }

    private drawLine(l: DrawnLine) {
        const pts = l.points
        let total = 0
        const segs: number[] = []
        for (let i = 1; i < pts.length; i++) {
            const d = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
            segs.push(d)
            total += d
        }
        const target = total * Math.min(1, l.progress)
        const g = l.g
        g.clear()
        const path: { x: number, y: number }[] = [pts[0]!]
        let run = 0
        let head = pts[0]!
        for (let i = 1; i < pts.length; i++) {
            const d = segs[i - 1]!
            if (run + d >= target) {
                const k = (target - run) / d
                head = { x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * k, y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * k }
                path.push(head)
                break
            }
            run += d
            path.push(pts[i]!)
            head = pts[i]!
        }
        const stroke = (width: number, color: number, alpha: number) => {
            g.moveTo(path[0]!.x, path[0]!.y)
            for (let i = 1; i < path.length; i++) g.lineTo(path[i]!.x, path[i]!.y)
            g.stroke({ width, color, alpha, cap: 'round', join: 'round' })
        }
        stroke(l.width * 4.2, l.color, 0.16)
        stroke(l.width * 2.2, l.color, 0.3)
        stroke(l.width + 3, 0x2a0636, 0.9)
        stroke(l.width, l.color, 1)
        stroke(Math.max(1.5, l.width * 0.35), 0xffffff, 0.8)
        if (l.spark) {
            l.spark.position.set(head.x, head.y)
            l.spark.tint = l.progress >= 1 ? 0xffffff : l.color
            if (l.progress >= 1) l.spark.alpha = Math.max(0, l.spark.alpha - 0.06)
        }
    }

    clearWins() {
        this.clearHighlight()
        this.clearLines()
        this.textLayer?.removeChildren().forEach(c => safeDestroy(() => c.destroy({ children: true })))
    }

    /** Pop a win amount over the winning cells. */
    floatAmount(cells: Cell[], text: string, color = 0xffe066, big = false) {
        if (!this.textLayer || cells.length === 0) return
        const { Text } = this.PIXI
        let sx = 0, sy = 0
        for (const c of cells) {
            const p = spinataCellCenter(c.col, c.row)
            sx += p.x
            sy += p.y
        }
        const x = sx / cells.length
        const y = Math.min(REEL_H - 40, Math.max(40, sy / cells.length))
        const t: Text = new Text({
            text,
            style: {
                fontFamily: '"Lilita One", "Arial Black", system-ui, sans-serif',
                fontSize: big ? 50 : 38,
                fill: color,
                stroke: { color: 0x3a0a2e, width: 8, join: 'round' },
                dropShadow: { color: 0x000000, blur: 6, distance: 3, alpha: 0.55, angle: Math.PI / 2 },
                letterSpacing: 1
            },
            resolution: Math.max(2, this.app?.renderer.resolution ?? 1)
        })
        t.anchor.set(0.5)
        const pill = new this.PIXI.Graphics()
        const pw = t.width + 34
        const ph = t.height + 4
        pill.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2)
            .fill({ color: 0x24061f, alpha: 0.9 })
            .stroke({ width: 3, color, alpha: 1 })
        const group = new this.PIXI.Container()
        group.addChild(pill, t)
        group.position.set(x, y)
        this.textLayer.removeChildren().forEach(c => safeDestroy(() => c.destroy({ children: true })))
        this.textLayer.addChild(group)
        this.gsap.fromTo(group.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.38, ease: 'back.out(2.4)' })
    }

    // --- piñata / pickups -----------------------------------------------------

    /** Shake the given cells (stick hits). */
    shake(cells: Cell[], strength = 1) {
        for (const c of cells) this.tileAt(c.col, c.row)?.shake(strength)
    }

    /** Burst confetti out of cells (a piñata breaking, a big symbol win). */
    burst(cells: Cell[], count = 40, power = 1) {
        for (const c of cells) {
            const p = spinataCellCenter(c.col, c.row)
            this.emit(p.x, p.y, count, power)
        }
    }

    /** Sparkle shower along a column (landing a scatter, anticipation). */
    sparkle(col: number, row: number, count = 14) {
        const p = spinataCellCenter(col, row)
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2
            const sp = 1.5 + Math.random() * 3.5
            this.spawn(this.fx!.spark, p.x, p.y, Math.cos(a) * sp, Math.sin(a) * sp - 1, 0xfff1a8, 0.35 + Math.random() * 0.35, 0.02, 0.97, 40 + Math.random() * 25, 0, true)
        }
    }

    private emit(x: number, y: number, count: number, power: number) {
        const kinds = [this.fx!.confetti, this.fx!.confetti, this.fx!.flag, this.fx!.dot]
        for (let i = 0; i < count; i++) {
            const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6
            const sp = (3 + Math.random() * 7) * power
            const tex = kinds[Math.floor(Math.random() * kinds.length)]!
            const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]!
            const scale = tex === this.fx!.flag ? 0.55 + Math.random() * 0.3 : tex === this.fx!.dot ? 0.4 + Math.random() * 0.3 : 0.6 + Math.random() * 0.5
            this.spawn(tex, x, y, Math.cos(a) * sp, Math.sin(a) * sp, color, scale, 0.22, 0.985, 70 + Math.random() * 50, 0.18, false)
        }
        for (let i = 0; i < Math.round(count / 3); i++) {
            const a = Math.random() * Math.PI * 2
            const sp = 2 + Math.random() * 5 * power
            this.spawn(this.fx!.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0xffffff, 0.3 + Math.random() * 0.4, 0.05, 0.95, 30 + Math.random() * 20, 0, true)
        }
    }

    private spawn(tex: Texture, x: number, y: number, vx: number, vy: number, color: number, scale: number, g: number, drag: number, life: number, flutter: number, additive: boolean) {
        if (!this.fxLayer || this.particles.length > 600) return
        const s = new this.PIXI.Sprite(tex)
        s.anchor.set(0.5)
        s.tint = color
        s.position.set(x, y)
        s.scale.set(scale)
        s.rotation = Math.random() * Math.PI * 2
        if (additive) s.blendMode = 'add'
        this.fxLayer.addChild(s)
        this.particles.push({ s, vx, vy, vr: (Math.random() - 0.5) * 0.3, life, max: life, g, drag, flutter, phase: Math.random() * 6, baseScale: scale })
    }

    // --- modes -----------------------------------------------------------------

    setFiesta(on: boolean) {
        this.fiesta = on
        if (this.backing) this.backing.tint = on ? 0xffb0d8 : 0xffffff
    }

    // --- frame loop -------------------------------------------------------------

    private update(ticker: Ticker) {
        const dt = Math.min(3, ticker.deltaTime)
        this.time += ticker.deltaMS / 1000
        const t = this.time

        // Vertical motion blur while a reel scrolls fast.
        const reels = this.reelSet?.reels ?? []
        for (let i = 0; i < reels.length; i++) {
            const reel = reels[i]!
            const blur = this.blurs[i]!
            const speed = Math.abs(reel.speed)
            const strength = speed > 6 ? Math.min(10, speed * 0.3) : 0
            if (strength > 0) {
                blur.strengthY = strength
                if (!reel.container.filters) reel.container.filters = [blur]
            } else if (reel.container.filters) {
                reel.container.filters = null
            }
        }

        // Idle life on special symbols.
        if (!this.spinPromise) {
            for (let col = 0; col < COLS; col++) {
                for (let row = 0; row < ROWS; row++) this.tileAt(col, row)?.breathe(t + col * 0.7 + row * 0.3)
            }
        }

        // Rays turn slowly under strong wins.
        for (const c of this.glowLayer?.children ?? []) {
            if (c.label === 'rays') c.rotation += 0.012 * dt
        }

        // Anticipation frames: a pulsing gold/pink column border with rising sparks.
        for (const [reel, a] of this.anticipation) {
            a.t += ticker.deltaMS / 1000
            const x = reel * (SPN_CELL + SPN_GAP)
            const pulse = 0.55 + Math.sin(a.t * 10) * 0.45
            a.g.clear()
            a.g.roundRect(x - 2, -2, SPN_CELL + 4, REEL_H + 4, 14).stroke({ width: 16, color: 0xff3d7f, alpha: 0.18 * pulse })
            a.g.roundRect(x, 0, SPN_CELL, REEL_H, 12).stroke({ width: 6, color: 0xffc93c, alpha: 0.5 + 0.5 * pulse })
            a.g.roundRect(x + 2, 2, SPN_CELL - 4, REEL_H - 4, 11).stroke({ width: 2, color: 0xffffff, alpha: 0.7 * pulse })
            if (Math.random() < 0.5 * dt) {
                this.spawn(this.fx!.spark, x + Math.random() * SPN_CELL, REEL_H, (Math.random() - 0.5) * 0.6, -3 - Math.random() * 3, Math.random() < 0.5 ? 0xffc93c : 0xff7ad9, 0.3 + Math.random() * 0.3, -0.02, 0.99, 50, 0, true)
            }
        }

        // Paylines draw on.
        for (const l of this.lines) {
            if (l.progress < 1.6) {
                l.progress += (ticker.deltaMS / 1000) * l.speed
                this.drawLine(l)
            }
        }

        // Particles.
        const ps = this.particles
        for (let i = ps.length - 1; i >= 0; i--) {
            const p = ps[i]!
            p.vx *= Math.pow(p.drag, dt)
            p.vy = p.vy * Math.pow(p.drag, dt) + p.g * dt
            if (p.flutter > 0 && p.vy > 1.2) {
                p.vy = Math.min(p.vy, 2.6)
                p.vx += Math.sin(t * 6 + p.phase) * p.flutter * 0.3 * dt
            }
            p.s.x += p.vx * dt
            p.s.y += p.vy * dt
            p.s.rotation += p.vr * dt
            if (p.flutter > 0) p.s.scale.x = p.baseScale * Math.cos(t * 9 + p.phase)
            p.life -= dt
            const k = p.life / p.max
            p.s.alpha = k < 0.3 ? k / 0.3 : 1
            if (p.life <= 0 || p.s.y > REEL_H + 60) {
                safeDestroy(() => p.s.destroy())
                ps[i] = ps[ps.length - 1]!
                ps.pop()
            }
        }
    }

    destroy() {
        this.destroyed = true
        this.app?.ticker.remove(this.tick)
        for (const p of this.particles) safeDestroy(() => p.s.destroy())
        this.particles = []
        this.clearLines()
        safeDestroy(() => this.reelSet?.destroy())
        for (const b of this.blurs) safeDestroy(() => b.destroy())
        if (this.fx) for (const t of Object.values(this.fx)) safeDestroy(() => t.destroy(true))
        this.fx = null
        safeDestroy(() => this.backing?.texture.destroy(true))
        safeDestroy(() => this.app?.destroy(true, { children: true }))
        this.app = null
        this.reelSet = null
    }
}
