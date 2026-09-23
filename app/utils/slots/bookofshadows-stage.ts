// Book of Shadows reel stage (Pixi + pixi-reels).
//
// Owns the reel window and every effect drawn inside it: reel wells and
// curvature shading, symbol auras, anticipation beams, book sigils, traced
// win threads with rune rings, wild-column pillars, embers and popups. The
// game component drives it through the async methods below and gets reel
// events back through `BosStageHooks` (used for sound).
//
// Everything random in here is cosmetic, so it uses Math.random.

import type { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { ReelSet } from 'pixi-reels'
import { BOS_COLS, BOS_ROWS, SYMBOL_WEIGHTS, type Cell, type ConnectionWin, type SlotSymbol } from '#shared/utils/gamelogic/bookofshadows'
import { BOS_BONUS_SPRITE_SRC, BOS_SPRITE_SRC, bosSpriteCrop } from '~/utils/bookofshadows-sprite'
import formatNumber from '~/utils/format-number'
import { initSlotPixiApp, safeDestroy } from '~/utils/slot-pixi'

type Pixi = typeof import('pixi.js')
type Gsap = typeof import('gsap').gsap

export const BOS_CELL = 116
const GAP_X = 10
const GAP_Y = 4
const PAD = 14
const REEL_W = BOS_COLS * BOS_CELL + (BOS_COLS - 1) * GAP_X
const REEL_H = BOS_ROWS * BOS_CELL + (BOS_ROWS - 1) * GAP_Y
export const BOS_STAGE_W = REEL_W + PAD * 2
export const BOS_STAGE_H = REEL_H + PAD * 2

const GOLD = 0xffc65a
const GOLD_CORE = 0xfff1c2
const BLOOD = 0xff3b2f
const BLOOD_CORE = 0xffd9cf
const ARCANE = 0x9dff6a

// Aura colour behind each premium symbol; royals get none.
const AURA: Partial<Record<SlotSymbol, { color: number, alpha: number }>> = {
    sword: { color: 0xff5a4a, alpha: 0.22 },
    orb: { color: 0xff2d55, alpha: 0.3 },
    scythe: { color: 0xa78bfa, alpha: 0.26 },
    hood: { color: 0x34d399, alpha: 0.24 },
    book: { color: ARCANE, alpha: 0.42 },
    bonuswild: { color: 0xff5a2a, alpha: 0.55 }
}

export interface BosStageHooks {
    onReelStart?: (col: number) => void
    /** `booksSoFar` counts books on every landed reel this spin. */
    onReelLanded?: (col: number, booksSoFar: number, booksOnReel: number) => void
    onAnticipate?: (col: number) => void
    onThreadStep?: (step: number) => void
    onWildCell?: () => void
}

export interface BosSpinOptions {
    turbo: boolean
    holdReels?: number[]
    /** Slow the reels after the second book has landed. */
    anticipate?: boolean
}

export interface BosWinOptions {
    turbo: boolean
    /** What each connection pays, in the same order as `wins`. */
    amounts: number[]
    /** Wins drawn in blood red (wild runs during the feature). */
    bloodWins?: boolean[]
    hold?: number
}

interface Particle {
    s: Sprite
    vx: number
    vy: number
    life: number
    max: number
    g: number
    drag: number
    s0: number
    s1: number
    a0: number
    spin: number
    stretch: number
}

interface ThreadEdge { ax: number, ay: number, bx: number, by: number, step: number }

interface Thread {
    edges: ThreadEdge[]
    steps: number
    progress: number
    color: number
    core: number
    alpha: number
}

interface RuneFx { s: Sprite, spin: number, base: number, phase: number }

interface ShadowSymbolApi {
    readonly id: SlotSymbol
    readonly view: Container
    tick(t: number): void
    relayout(): void
    setHighlight(on: boolean, color?: number): void
    pop(strength?: number): void
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// --- canvas-drawn textures ----------------------------------------------------

function canvas(w: number, h: number) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return { c, g: c.getContext('2d')! }
}

function glowCanvas() {
    const { c, g } = canvas(128, 128)
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)')
    grad.addColorStop(0.6, 'rgba(255,255,255,0.12)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
    return c
}

function beamCanvas() {
    const { c, g } = canvas(64, 256)
    const h = g.createLinearGradient(0, 0, 64, 0)
    h.addColorStop(0, 'rgba(255,255,255,0)')
    h.addColorStop(0.5, 'rgba(255,255,255,1)')
    h.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = h
    g.fillRect(0, 0, 64, 256)
    g.globalCompositeOperation = 'destination-in'
    const v = g.createLinearGradient(0, 0, 0, 256)
    v.addColorStop(0, 'rgba(0,0,0,0)')
    v.addColorStop(0.15, 'rgba(0,0,0,1)')
    v.addColorStop(0.85, 'rgba(0,0,0,1)')
    v.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = v
    g.fillRect(0, 0, 64, 256)
    return c
}

/** Top and bottom darkening so a reel reads as a turning drum. */
function shadeCanvas() {
    const { c, g } = canvas(4, 256)
    const v = g.createLinearGradient(0, 0, 0, 256)
    v.addColorStop(0, 'rgba(6,3,2,0.78)')
    v.addColorStop(0.14, 'rgba(6,3,2,0.12)')
    v.addColorStop(0.5, 'rgba(6,3,2,0)')
    v.addColorStop(0.86, 'rgba(6,3,2,0.12)')
    v.addColorStop(1, 'rgba(6,3,2,0.82)')
    g.fillStyle = v
    g.fillRect(0, 0, 4, 256)
    return c
}

/** A stave with a couple of branches: reads as a rune without needing a runic font. */
function drawRune(g: CanvasRenderingContext2D, seed: number, size: number) {
    const h = size
    const w = size * 0.55
    g.beginPath()
    g.moveTo(0, -h / 2)
    g.lineTo(0, h / 2)
    const kinds = [
        [[0, -0.5, 0.5, -0.2], [0, -0.1, 0.5, 0.2]],
        [[0, -0.5, 0.5, -0.1], [0.5, -0.1, 0, 0.2]],
        [[-0.5, -0.3, 0.5, 0.3]],
        [[0, -0.1, 0.5, -0.4], [0, -0.1, -0.5, -0.4]],
        [[0, 0.1, 0.5, 0.4], [0, -0.3, 0.5, 0]],
        [[0, -0.5, -0.5, -0.2], [0, 0, 0.5, 0.3]],
        [[-0.5, -0.5, 0.5, 0.5], [0.5, -0.5, -0.5, 0.5]],
        [[0, -0.2, 0.5, -0.5], [0, 0.2, 0.5, 0.5]]
    ]
    for (const [x1, y1, x2, y2] of kinds[seed % kinds.length]!) {
        g.moveTo(x1! * w, y1! * h)
        g.lineTo(x2! * w, y2! * h)
    }
    g.stroke()
}

function runeRingCanvas() {
    const size = 256
    const { c, g } = canvas(size, size)
    const r = size / 2
    g.translate(r, r)
    g.strokeStyle = 'rgba(255,255,255,0.95)'
    g.lineCap = 'round'
    g.lineWidth = 3
    g.beginPath()
    g.arc(0, 0, r - 6, 0, Math.PI * 2)
    g.stroke()
    g.lineWidth = 1.5
    g.beginPath()
    g.arc(0, 0, r - 40, 0, Math.PI * 2)
    g.stroke()
    // tick marks between the rings
    for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2
        const inner = i % 4 === 0 ? r - 16 : r - 11
        g.beginPath()
        g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner)
        g.lineTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6))
        g.stroke()
    }
    g.lineWidth = 2.4
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        g.save()
        g.rotate(a)
        g.translate(0, -(r - 27))
        drawRune(g, i * 5 + 3, 15)
        g.restore()
    }
    return c
}

function sigilCanvas() {
    const size = 256
    const { c, g } = canvas(size, size)
    const r = size / 2
    g.translate(r, r)
    g.strokeStyle = 'rgba(255,255,255,1)'
    g.lineWidth = 4
    g.lineJoin = 'round'
    g.beginPath()
    g.arc(0, 0, r - 8, 0, Math.PI * 2)
    g.stroke()
    g.lineWidth = 2
    g.beginPath()
    g.arc(0, 0, r - 22, 0, Math.PI * 2)
    g.stroke()
    const pr = r - 24
    g.lineWidth = 3.5
    g.beginPath()
    for (let i = 0; i <= 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * (Math.PI * 2)) / 5
        const x = Math.cos(a) * pr
        const y = Math.sin(a) * pr
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
    }
    g.stroke()
    return c
}

// --- stage ----------------------------------------------------------------------

export class BosStage {
    private app: Application | null = null
    private pixi!: Pixi
    private gsap!: Gsap
    private reelSet: ReelSet | null = null
    private root!: Container
    private backLayer!: Container
    private shadeLayer!: Container
    private runeLayer!: Container
    private lines!: Graphics
    private particleLayer!: Container
    private popupLayer!: Container
    private flashSprite!: Sprite
    private readonly tex: Record<string, Texture> = {}
    private readonly symbolTex: { base: Partial<Record<SlotSymbol, Texture>>, bonus: Partial<Record<SlotSymbol, Texture>> } = { base: {}, bonus: {} }
    private readonly symbols = new Set<ShadowSymbolApi>()
    private particles: Particle[] = []
    private readonly spritePool: Sprite[] = []
    private threads: Thread[] = []
    private runes: RuneFx[] = []
    private anticipationGlow: Sprite[] = []
    private lockGlow: Sprite[] = []
    private readonly anticipating = new Set<number>()
    private readonly locked = new Set<number>()
    private time = 0
    private shakeAmp = 0
    private moteTimer = 0
    private resizeObserver: ResizeObserver | null = null
    private resultGrid: SlotSymbol[][] | null = null
    private booksSeen = 0
    private anticipationQueue: number[] = []
    private destroyed = false
    bonusSymbol: SlotSymbol | null = null

    private constructor(private readonly host: HTMLElement, private readonly hooks: BosStageHooks) {}

    static async create(host: HTMLElement, hooks: BosStageHooks, initialGrid: SlotSymbol[][], isGone: () => boolean): Promise<BosStage | null> {
        const stage = new BosStage(host, hooks)
        const ok = await stage.init(initialGrid, isGone)
        if (!ok) {
            stage.destroy()
            return null
        }
        return stage
    }

    private async init(initialGrid: SlotSymbol[][], isGone: () => boolean): Promise<boolean> {
        const [pixi, reels, gsapMod] = await Promise.all([import('pixi.js'), import('pixi-reels'), import('gsap')])
        if (isGone()) return false
        this.pixi = pixi
        this.gsap = gsapMod.gsap ?? gsapMod.default
        const { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture } = pixi
        const { ReelSetBuilder, ReelSymbol, SpeedPresets } = reels

        const [baseSheet, bonusSheet] = await Promise.all([Assets.load(BOS_SPRITE_SRC), Assets.load(BOS_BONUS_SPRITE_SRC)])
        if (isGone()) return false
        const ids = [...Object.keys(SYMBOL_WEIGHTS), 'bonuswild'] as SlotSymbol[]
        for (const id of ids) {
            if (id !== 'bonuswild') {
                const [x, y, w, h] = bosSpriteCrop(id).rect
                this.symbolTex.base[id] = new Texture({ source: baseSheet.source, frame: new Rectangle(x, y, w, h) })
            }
            if (id !== 'ten') {
                const [x, y, w, h] = bosSpriteCrop(id, true).rect
                this.symbolTex.bonus[id] = new Texture({ source: bonusSheet.source, frame: new Rectangle(x, y, w, h) })
            }
        }

        this.tex.glow = Texture.from(glowCanvas())
        this.tex.beam = Texture.from(beamCanvas())
        this.tex.shade = Texture.from(shadeCanvas())
        this.tex.ring = Texture.from(runeRingCanvas())
        this.tex.sigil = Texture.from(sigilCanvas())

        try {
            await document.fonts?.load('900 32px Cinzel')
        } catch { /* fall back to Georgia */ }

        const app = await initSlotPixiApp(Application, { width: BOS_STAGE_W, height: BOS_STAGE_H }, isGone)
        if (!app) return false
        this.app = app
        this.host.appendChild(app.canvas)

        this.root = new Container()
        app.stage.addChild(this.root)

        // Reel wells, anticipation beams and locked-column glow sit behind the symbols.
        this.backLayer = new Container()
        this.root.addChild(this.backLayer)
        const wells = new Graphics()
        for (let col = 0; col < BOS_COLS; col++) {
            const x = PAD + col * (BOS_CELL + GAP_X)
            wells.roundRect(x - 3, PAD - 6, BOS_CELL + 6, REEL_H + 12, 10).fill({ color: 0x0d0907, alpha: 0.9 })
            wells.roundRect(x - 3, PAD - 6, BOS_CELL + 6, REEL_H + 12, 10).stroke({ color: 0x6b4a22, width: 1.5, alpha: 0.55 })
            wells.roundRect(x + 2, PAD, BOS_CELL - 4, REEL_H, 8).fill({ color: 0x1b130d, alpha: 0.55 })
        }
        this.backLayer.addChild(wells)
        for (let col = 0; col < BOS_COLS; col++) {
            const x = PAD + col * (BOS_CELL + GAP_X) + BOS_CELL / 2
            const lock = new Sprite(this.tex.beam)
            lock.anchor.set(0.5)
            lock.position.set(x, PAD + REEL_H / 2)
            lock.width = BOS_CELL * 1.9
            lock.height = REEL_H * 1.08
            lock.tint = BLOOD
            lock.alpha = 0
            lock.blendMode = 'add'
            this.backLayer.addChild(lock)
            this.lockGlow.push(lock)
        }

        const speedNormal = { ...SpeedPresets.NORMAL, anticipationDelay: 950, bounceDistance: 26, bounceDuration: 360, minimumSpinTime: 450 }
        const speedTurbo = { ...SpeedPresets.TURBO, anticipationDelay: 600, bounceDistance: 16, bounceDuration: 180 }

        // What the symbol class needs from the stage (no `this` alias inside the nested class).
        const stage = { symbols: this.symbols, tex: this.tex, symbolTex: this.symbolTex, bonusSymbol: () => this.bonusSymbol }
        const gsap = this.gsap

        class ShadowSymbol extends ReelSymbol implements ShadowSymbolApi {
            private readonly body = new Container()
            private readonly aura = new Sprite(stage.tex.glow)
            private readonly art = new Sprite()
            private readonly frame = new Graphics()
            private symbol: SlotSymbol = 'ten'
            private w = BOS_CELL
            private h = BOS_CELL
            private highlighted = false
            private phase = Math.random() * Math.PI * 2

            constructor() {
                super()
                this.aura.anchor.set(0.5)
                this.aura.blendMode = 'add'
                this.art.anchor.set(0.5)
                this.frame.visible = false
                this.body.addChild(this.aura, this.art, this.frame)
                this.view.addChild(this.body)
                stage.symbols.add(this)
            }

            get id() {
                return this.symbol
            }

            protected onActivate(symbolId: string): void {
                this.symbol = symbolId as SlotSymbol
                this.view.alpha = 1
                this.body.scale.set(1)
                this.setHighlight(false)
                this.relayout()
            }

            protected onDeactivate(): void {
                gsap.killTweensOf(this.body.scale)
                gsap.killTweensOf(this.view)
                this.setHighlight(false)
            }

            protected override onDestroy(): void {
                stage.symbols.delete(this)
            }

            async playWin(): Promise<void> {
                this.pop()
            }

            stopAnimation(): void {
                gsap.killTweensOf(this.body.scale)
                this.body.scale.set(1)
            }

            resize(width: number, height: number): void {
                this.w = width
                this.h = height
                this.relayout()
            }

            pop(strength = 1) {
                gsap.killTweensOf(this.body.scale)
                this.body.scale.set(1)
                gsap.to(this.body.scale, { x: 1 + 0.14 * strength, y: 1 + 0.14 * strength, duration: 0.13, yoyo: true, repeat: 1, ease: 'power2.out' })
            }

            setHighlight(on: boolean, color = GOLD) {
                this.highlighted = on
                this.frame.visible = on
                this.frame.tint = color
            }

            relayout() {
                const { w, h } = this
                this.body.position.set(w / 2, h / 2)
                const isWild = this.symbol === 'bonuswild'
                const texture = isWild
                    ? stage.symbolTex.bonus[stage.bonusSymbol() ?? 'book']
                    : stage.symbolTex.base[this.symbol]
                if (texture) {
                    const royal = ['ten', 'jack', 'queen', 'king', 'ace'].includes(this.symbol)
                    const pad = isWild ? 2 : royal ? 16 : this.symbol === 'book' ? 6 : 10
                    const s = Math.min((w - pad) / texture.width, (h - pad) / texture.height)
                    this.art.texture = texture
                    this.art.scale.set(s)
                    this.art.visible = true
                } else {
                    this.art.visible = false
                }
                const aura = AURA[this.symbol]
                this.aura.visible = Boolean(aura)
                if (aura) {
                    this.aura.tint = aura.color
                    this.aura.alpha = aura.alpha
                    this.aura.width = w * 1.25
                    this.aura.height = h * 1.25
                }
                this.frame.clear()
                this.frame.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 12).stroke({ color: 0xffffff, width: 9, alpha: 0.18 })
                this.frame.roundRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 11).stroke({ color: 0xffffff, width: 2.5, alpha: 0.95 })
            }

            tick(t: number) {
                const aura = AURA[this.symbol]
                if (aura && (this.symbol === 'book' || this.symbol === 'bonuswild')) {
                    this.aura.alpha = aura.alpha * (0.75 + 0.35 * Math.sin(t * 2.6 + this.phase))
                }
                if (this.highlighted) this.frame.alpha = 0.7 + 0.3 * Math.sin(t * 7 + this.phase)
            }
        }

        const reelSet = new ReelSetBuilder()
            .reels(BOS_COLS)
            .visibleRows(BOS_ROWS)
            .symbolSize(BOS_CELL, BOS_CELL)
            .symbolGap(GAP_X, GAP_Y)
            .symbols((registry) => {
                for (const id of Object.keys(SYMBOL_WEIGHTS)) registry.register(id, ShadowSymbol, {})
                registry.register('bonuswild', ShadowSymbol, {})
            })
            // bonuswild must be listed at 0: unlisted symbols default to weight 10 in random fill.
            .weights({ ...SYMBOL_WEIGHTS, bonuswild: 0 })
            .speed('normal', speedNormal)
            .speed('turbo', speedTurbo)
            .initialSpeed('normal')
            .initialFrame(initialGrid.map(col => ({ visible: col })))
            .ticker(app.ticker)
            .build()
        reelSet.position.set(PAD, PAD)
        this.root.addChild(reelSet)
        this.reelSet = reelSet

        for (let i = 0; i < BOS_COLS; i++) {
            reelSet.getReel(i).events.on('phase:enter', (phase: string) => {
                if (phase === 'spin') this.hooks.onReelStart?.(i)
            })
        }
        reelSet.events.on('spin:reelLanded', (col: number) => this.onReelLanded(col))
        reelSet.events.on('spin:stopping', (col: number) => {
            if (this.anticipationQueue[0] === col) this.startAnticipation(col)
        })

        // Curvature shading and the anticipation beams in front of the symbols.
        this.shadeLayer = new Container()
        this.root.addChild(this.shadeLayer)
        for (let col = 0; col < BOS_COLS; col++) {
            const x = PAD + col * (BOS_CELL + GAP_X)
            const shade = new Sprite(this.tex.shade)
            shade.position.set(x - 3, PAD - 6)
            shade.width = BOS_CELL + 6
            shade.height = REEL_H + 12
            this.shadeLayer.addChild(shade)
            const beam = new Sprite(this.tex.beam)
            beam.anchor.set(0.5)
            beam.position.set(x + BOS_CELL / 2, PAD + REEL_H / 2)
            beam.width = BOS_CELL * 1.6
            beam.height = REEL_H * 1.1
            beam.tint = GOLD
            beam.alpha = 0
            beam.blendMode = 'add'
            this.shadeLayer.addChild(beam)
            this.anticipationGlow.push(beam)
        }
        const frameLines = new Graphics()
        for (let col = 1; col < BOS_COLS; col++) {
            const x = PAD + col * (BOS_CELL + GAP_X) - GAP_X / 2
            frameLines.moveTo(x, PAD + 6).lineTo(x, PAD + REEL_H - 6).stroke({ color: 0xc9953f, width: 1, alpha: 0.35 })
            frameLines.circle(x, PAD - 2, 2.2).fill({ color: 0xe8b659, alpha: 0.8 })
            frameLines.circle(x, PAD + REEL_H + 2, 2.2).fill({ color: 0xe8b659, alpha: 0.8 })
        }
        this.shadeLayer.addChild(frameLines)

        this.runeLayer = new Container()
        this.root.addChild(this.runeLayer)
        this.lines = new Graphics()
        this.lines.blendMode = 'add'
        this.root.addChild(this.lines)
        this.particleLayer = new Container()
        this.root.addChild(this.particleLayer)
        this.popupLayer = new Container()
        this.root.addChild(this.popupLayer)

        this.flashSprite = new Sprite(Texture.WHITE)
        this.flashSprite.width = BOS_STAGE_W
        this.flashSprite.height = BOS_STAGE_H
        this.flashSprite.alpha = 0
        this.flashSprite.blendMode = 'add'
        this.root.addChild(this.flashSprite)

        app.ticker.add(ticker => this.update(ticker.deltaMS))

        this.resizeObserver = new ResizeObserver(() => this.resize())
        this.resizeObserver.observe(this.host)
        this.resize()
        return true
    }

    // --- frame loop ---------------------------------------------------------------

    private update(deltaMs: number) {
        if (this.destroyed) return
        const dt = Math.min(0.05, deltaMs / 1000)
        this.time += dt
        const t = this.time

        for (const sym of this.symbols) sym.tick(t)

        // particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i]!
            p.life += dt
            const k = p.life / p.max
            if (k >= 1) {
                this.releaseSprite(p.s)
                this.particles.splice(i, 1)
                continue
            }
            p.vy += p.g * dt
            p.vx *= 1 - p.drag * dt
            p.vy *= 1 - p.drag * dt
            p.s.x += p.vx * dt
            p.s.y += p.vy * dt
            const scale = p.s0 + (p.s1 - p.s0) * k
            if (p.stretch > 0) {
                const speed = Math.hypot(p.vx, p.vy)
                p.s.rotation = Math.atan2(p.vy, p.vx)
                p.s.scale.set(scale * (1 + Math.min(4, speed * p.stretch)), scale)
            } else {
                p.s.scale.set(scale)
                p.s.rotation += p.spin * dt
            }
            p.s.alpha = p.a0 * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85)
        }

        // threads and runes
        if (this.threads.length) this.drawThreads(t)
        for (const r of this.runes) {
            r.s.rotation += r.spin * dt
            r.s.alpha = Math.min(r.s.alpha + dt * 4, r.base * (0.75 + 0.25 * Math.sin(t * 5 + r.phase)))
        }

        // anticipation beams
        for (let col = 0; col < BOS_COLS; col++) {
            const beam = this.anticipationGlow[col]!
            const on = this.anticipating.has(col)
            const target = on ? 0.55 + 0.25 * Math.sin(t * 11) : 0
            beam.alpha += (target - beam.alpha) * Math.min(1, dt * 10)
            if (on && Math.random() < dt * 40) this.anticipationSpark(col)
            const lock = this.lockGlow[col]!
            const lockTarget = this.locked.has(col) ? 0.3 + 0.12 * Math.sin(t * 2.2 + col) : 0
            lock.alpha += (lockTarget - lock.alpha) * Math.min(1, dt * 4)
            if (this.locked.has(col) && Math.random() < dt * 6) this.ember(col)
        }

        // ambient dust
        this.moteTimer -= dt
        if (this.moteTimer <= 0) {
            this.moteTimer = 0.18 + Math.random() * 0.25
            this.mote()
        }

        // shake
        if (this.shakeAmp > 0.05) {
            this.root.position.set((Math.random() - 0.5) * this.shakeAmp, (Math.random() - 0.5) * this.shakeAmp)
            this.shakeAmp *= Math.pow(0.004, dt)
        } else if (this.root.x !== 0 || this.root.y !== 0) {
            this.root.position.set(0, 0)
            this.shakeAmp = 0
        }

        if (this.flashSprite.alpha > 0) this.flashSprite.alpha = Math.max(0, this.flashSprite.alpha - dt * 1.8)
    }

    private resize() {
        if (!this.app || this.destroyed) return
        const w = this.host.clientWidth
        const h = this.host.clientHeight
        if (w <= 0) return
        const s = h > 0 ? Math.min(w / BOS_STAGE_W, h / BOS_STAGE_H) : w / BOS_STAGE_W
        this.app.renderer.resize(Math.round(BOS_STAGE_W * s), Math.round(BOS_STAGE_H * s))
        this.app.stage.scale.set(s)
    }

    // --- particles -------------------------------------------------------------------

    private takeSprite(): Sprite {
        const s = this.spritePool.pop() ?? new this.pixi.Sprite(this.tex.glow)
        s.anchor.set(0.5)
        s.blendMode = 'add'
        s.rotation = 0
        s.visible = true
        this.particleLayer.addChild(s)
        return s
    }

    private releaseSprite(s: Sprite) {
        s.visible = false
        this.particleLayer.removeChild(s)
        if (this.spritePool.length < 400) this.spritePool.push(s)
        else s.destroy()
    }

    private emit(x: number, y: number, o: Partial<Omit<Particle, 's'>> & { color: number, size?: number }) {
        if (this.particles.length > 700) return
        const s = this.takeSprite()
        s.position.set(x, y)
        s.tint = o.color
        const size = (o.size ?? 10) / 128
        this.particles.push({
            s,
            vx: o.vx ?? 0,
            vy: o.vy ?? 0,
            life: 0,
            max: o.max ?? 0.8,
            g: o.g ?? 0,
            drag: o.drag ?? 1,
            s0: size * (o.s0 ?? 1),
            s1: size * (o.s1 ?? 0.2),
            a0: o.a0 ?? 1,
            spin: o.spin ?? 0,
            stretch: o.stretch ?? 0
        })
    }

    private burst(x: number, y: number, count: number, colors: number[], speed = 260, size = 12) {
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2
            const v = speed * (0.35 + Math.random() * 0.8)
            this.emit(x, y, {
                color: colors[i % colors.length]!,
                vx: Math.cos(a) * v,
                vy: Math.sin(a) * v,
                g: 220,
                drag: 2.2,
                max: 0.5 + Math.random() * 0.5,
                size: size * (0.5 + Math.random()),
                s1: 0.1,
                stretch: 0.004
            })
        }
    }

    private mote() {
        const x = PAD + Math.random() * REEL_W
        const y = PAD + REEL_H * (0.4 + Math.random() * 0.6)
        this.emit(x, y, { color: 0xffcf8a, vx: (Math.random() - 0.5) * 12, vy: -12 - Math.random() * 18, drag: 0, max: 3 + Math.random() * 3, size: 5 + Math.random() * 6, s0: 1, s1: 0.6, a0: 0.28 })
    }

    private anticipationSpark(col: number) {
        const x = PAD + col * (BOS_CELL + GAP_X) + Math.random() * BOS_CELL
        const y = PAD + REEL_H * (0.55 + Math.random() * 0.45)
        this.emit(x, y, { color: Math.random() < 0.5 ? GOLD : ARCANE, vy: -160 - Math.random() * 220, vx: (Math.random() - 0.5) * 30, drag: 0.4, max: 0.9, size: 9 + Math.random() * 8, stretch: 0.006 })
    }

    private ember(col: number) {
        const x = PAD + col * (BOS_CELL + GAP_X) + Math.random() * BOS_CELL
        const y = PAD + REEL_H * (0.7 + Math.random() * 0.3)
        this.emit(x, y, { color: Math.random() < 0.6 ? 0xff6a2a : 0xffc05a, vy: -60 - Math.random() * 90, vx: (Math.random() - 0.5) * 24, drag: 0.2, max: 1.6 + Math.random(), size: 6 + Math.random() * 6, s1: 0.3, a0: 0.8 })
    }

    // --- geometry ------------------------------------------------------------------

    cellCenter(col: number, row: number) {
        if (!this.reelSet) return { x: 0, y: 0 }
        const b = this.reelSet.getCellBounds(col, row)
        return { x: PAD + b.x + b.width / 2, y: PAD + b.y + b.height / 2 }
    }

    private symbolAt(col: number, row: number): ShadowSymbolApi | null {
        if (!this.reelSet) return null
        try {
            return this.reelSet.getReel(col).getSymbolAt(row) as unknown as ShadowSymbolApi
        } catch {
            return null
        }
    }

    // --- spinning --------------------------------------------------------------------

    /** Reels (in stop order) that should hang because two books are already showing. */
    private anticipationFor(grid: SlotSymbol[][], hold: number[]): number[] {
        const out: number[] = []
        let books = 0
        for (let col = 0; col < BOS_COLS; col++) {
            if (!hold.includes(col) && books >= 2) out.push(col)
            books += grid[col]!.filter(s => s === 'book').length
        }
        return out
    }

    async spin(grid: SlotSymbol[][], opts: BosSpinOptions) {
        const reelSet = this.reelSet
        if (!reelSet || this.destroyed) return
        this.clearWins(true)
        const hold = opts.holdReels ?? []
        reelSet.setSpeed(opts.turbo ? 'turbo' : 'normal')
        this.resultGrid = grid
        this.booksSeen = 0
        const promise = reelSet.spin({ holdReels: hold })
        reelSet.setResult(grid.map(col => ({ visible: col })))

        const anticipation = opts.anticipate ? this.anticipationFor(grid, hold) : []
        this.anticipationQueue = [...anticipation]
        const step = opts.turbo ? 0 : 120
        const hang = opts.turbo ? 600 : 950
        const delays: number[] = []
        let k = 0
        for (let col = 0; col < BOS_COLS; col++) {
            if (anticipation.includes(col)) {
                delays.push(col * step + k * hang)
                k++
            } else {
                delays.push(col * step)
            }
        }
        reelSet.setStopDelays(delays)
        reelSet.setAnticipation(anticipation)
        try {
            await promise
        } finally {
            this.anticipating.clear()
            this.anticipationQueue = []
        }
    }

    /** Slam the reels to their result (second press on spin). */
    quickStop() {
        const reelSet = this.reelSet
        if (!reelSet?.isSpinning) return
        try {
            reelSet.requestSkip()
        } catch { /* not spinning anymore */ }
    }

    private startAnticipation(col: number) {
        this.anticipating.add(col)
        this.hooks.onAnticipate?.(col)
    }

    private onReelLanded(col: number) {
        if (this.anticipating.delete(col) || this.anticipationQueue[0] === col) {
            this.anticipationQueue.shift()
            const next = this.anticipationQueue[0]
            if (next !== undefined) this.startAnticipation(next)
        }
        const column = this.resultGrid?.[col] ?? []
        let books = 0
        column.forEach((s, row) => {
            if (s !== 'book') return
            books++
            const c = this.cellCenter(col, row)
            this.sigil(c.x, c.y, ARCANE, 0.85)
            this.burst(c.x, c.y, 14, [ARCANE, GOLD, 0xffffff], 220, 11)
            this.symbolAt(col, row)?.pop(1.3)
        })
        this.booksSeen += books
        this.hooks.onReelLanded?.(col, this.booksSeen, books)
    }

    // --- sigils, flashes ---------------------------------------------------------------

    private sigil(x: number, y: number, color: number, scale = 1, hold = 0.2) {
        const s = new this.pixi.Sprite(this.tex.sigil)
        s.anchor.set(0.5)
        s.position.set(x, y)
        s.tint = color
        s.blendMode = 'add'
        s.alpha = 0
        const size = (BOS_CELL * 1.25 * scale) / 256
        s.scale.set(size * 0.4)
        this.popupLayer.addChild(s)
        const tl = this.gsap.timeline({ onComplete: () => s.destroy() })
        tl.to(s, { alpha: 0.95, duration: 0.12 })
        tl.to(s.scale, { x: size, y: size, duration: 0.45, ease: 'back.out(2)' }, 0)
        tl.to(s, { rotation: 0.9, duration: 1.1, ease: 'power1.out' }, 0)
        tl.to(s, { alpha: 0, duration: 0.45 }, 0.45 + hold)
    }

    flash(color = 0xffffff, alpha = 0.35) {
        this.flashSprite.tint = color
        this.flashSprite.alpha = alpha
    }

    shake(amount = 10) {
        this.shakeAmp = Math.max(this.shakeAmp, amount)
    }

    // --- wins ------------------------------------------------------------------------

    private edgesFor(win: ConnectionWin): ThreadEdge[] {
        const edges: ThreadEdge[] = []
        for (const a of win.cells) {
            for (const b of win.cells) {
                if (b.col === a.col + 1 && Math.abs(b.row - a.row) <= 1) {
                    const pa = this.cellCenter(a.col, a.row)
                    const pb = this.cellCenter(b.col, b.row)
                    edges.push({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, step: a.col })
                }
            }
        }
        return edges
    }

    private drawThreads(t: number) {
        const g = this.lines
        g.clear()
        for (const th of this.threads) {
            const breathe = th.progress >= th.steps ? 0.8 + 0.2 * Math.sin(t * 6) : 1
            const a = th.alpha * breathe
            if (a <= 0.01) continue
            for (const e of th.edges) {
                const f = Math.max(0, Math.min(1, th.progress - e.step))
                if (f <= 0) continue
                const x = e.ax + (e.bx - e.ax) * f
                const y = e.ay + (e.by - e.ay) * f
                g.moveTo(e.ax, e.ay).lineTo(x, y).stroke({ width: 20, color: th.color, alpha: 0.1 * a, cap: 'round' })
                g.moveTo(e.ax, e.ay).lineTo(x, y).stroke({ width: 8, color: th.color, alpha: 0.35 * a, cap: 'round' })
                g.moveTo(e.ax, e.ay).lineTo(x, y).stroke({ width: 2.6, color: th.core, alpha: 0.95 * a, cap: 'round' })
            }
        }
    }

    private addRune(x: number, y: number, color: number) {
        const s = new this.pixi.Sprite(this.tex.ring)
        s.anchor.set(0.5)
        s.position.set(x, y)
        s.tint = color
        s.blendMode = 'add'
        s.alpha = 0
        const size = (BOS_CELL * 1.02) / 256
        s.scale.set(size * 0.35)
        this.gsap.to(s.scale, { x: size, y: size, duration: 0.35, ease: 'back.out(2.2)' })
        this.runeLayer.addChild(s)
        this.runes.push({ s, spin: (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.3), base: 0.8, phase: Math.random() * 6 })
    }

    private popup(text: string, x: number, y: number, size: number, color: number, glow: number) {
        const label = new this.pixi.Text({
            text,
            style: {
                fontFamily: 'Cinzel, Georgia, serif',
                fontSize: size,
                fontWeight: '900',
                fill: color,
                stroke: { color: 0x1a0a03, width: Math.max(4, size * 0.16), join: 'round' },
                dropShadow: { color: glow, blur: size * 0.45, distance: 0, alpha: 0.95 },
                letterSpacing: 1
            }
        })
        label.anchor.set(0.5)
        label.position.set(Math.max(90, Math.min(BOS_STAGE_W - 90, x)), y)
        label.scale.set(0.4)
        this.popupLayer.addChild(label)
        return label
    }

    private floatPopup(label: Text, holdSec: number) {
        const tl = this.gsap.timeline({ onComplete: () => label.destroy() })
        tl.to(label.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2.6)' })
        tl.to(label, { y: label.y - 26, duration: holdSec + 0.3, ease: 'sine.out' }, 0)
        tl.to(label, { alpha: 0, duration: 0.25 }, holdSec + 0.1)
    }

    /**
     * Trace every connection with a glowing thread, ring each winning cell
     * with runes and float what it paid. Resolves once the wins have been on
     * screen for `hold` ms; they stay until clearWins().
     */
    async showWins(wins: ConnectionWin[], opts: BosWinOptions) {
        if (!this.reelSet || this.destroyed || !wins.length) return
        const keep = new Set(wins.flatMap(w => w.cells.map(c => `${c.col}:${c.row}`)))
        for (let col = 0; col < BOS_COLS; col++) {
            for (let row = 0; row < BOS_ROWS; row++) {
                const sym = this.symbolAt(col, row)
                if (!sym) continue
                this.gsap.to(sym.view, { alpha: keep.has(`${col}:${row}`) ? 1 : 0.32, duration: 0.25 })
            }
        }

        const stepDur = opts.turbo ? 0.06 : 0.12
        const ringed = new Set<string>()
        const together = opts.turbo || wins.length > 4
        const labelEach = wins.length <= 3

        const traceOne = (win: ConnectionWin, index: number) => new Promise<void>((resolve) => {
            const blood = opts.bloodWins?.[index] ?? false
            const color = blood ? BLOOD : GOLD
            const thread: Thread = { edges: this.edgesFor(win), steps: win.length - 1, progress: 0, color, core: blood ? BLOOD_CORE : GOLD_CORE, alpha: 1 }
            this.threads.push(thread)
            let lastStep = -1
            const ringColumn = (col: number) => {
                for (const c of win.cells) {
                    if (c.col !== col) continue
                    const key = `${c.col}:${c.row}`
                    const sym = this.symbolAt(c.col, c.row)
                    sym?.setHighlight(true, color)
                    if (ringed.has(key)) continue
                    ringed.add(key)
                    const p = this.cellCenter(c.col, c.row)
                    this.addRune(p.x, p.y, color)
                    sym?.pop()
                    this.burst(p.x, p.y, 6, [color, 0xffffff], 160, 8)
                }
            }
            ringColumn(0)
            this.gsap.to(thread, {
                progress: thread.steps,
                duration: stepDur * thread.steps,
                ease: 'none',
                onUpdate: () => {
                    const step = Math.floor(thread.progress)
                    if (step !== lastStep) {
                        lastStep = step
                        this.hooks.onThreadStep?.(step)
                    }
                    // sparks along the growing tip
                    for (const e of thread.edges) {
                        const f = thread.progress - e.step
                        if (f <= 0 || f >= 1) continue
                        this.emit(e.ax + (e.bx - e.ax) * f, e.ay + (e.by - e.ay) * f, { color: Math.random() < 0.5 ? color : 0xffffff, vx: (Math.random() - 0.5) * 140, vy: (Math.random() - 0.5) * 140, drag: 3, max: 0.4, size: 9, s1: 0.1 })
                    }
                    for (let col = 1; col <= Math.min(win.length - 1, Math.floor(thread.progress + 0.001)); col++) ringColumn(col)
                },
                onComplete: () => {
                    for (let col = 0; col < win.length; col++) ringColumn(col)
                    if (labelEach) {
                        const last = win.cells.filter(c => c.col === win.length - 1)
                        const p = last.reduce((acc, c) => {
                            const q = this.cellCenter(c.col, c.row)
                            return { x: acc.x + q.x / last.length, y: acc.y + q.y / last.length }
                        }, { x: 0, y: 0 })
                        const amount = opts.amounts[index] ?? win.amount
                        this.floatPopup(this.popup(formatNumber(amount), p.x, p.y, 34, blood ? 0xffe1d8 : 0xffeab0, blood ? 0xff2a1a : 0xff9a1a), opts.turbo ? 0.6 : 1.1)
                    }
                    resolve()
                }
            })
        })

        if (together) await Promise.all(wins.map((w, i) => traceOne(w, i)))
        else for (let i = 0; i < wins.length; i++) await traceOne(wins[i]!, i)

        if (!labelEach) {
            const total = opts.amounts.reduce((a, b) => a + b, 0)
            this.floatPopup(this.popup(formatNumber(total), BOS_STAGE_W / 2, BOS_STAGE_H / 2, 54, 0xffeab0, 0xff9a1a), opts.turbo ? 0.7 : 1.2)
        }
        await wait(opts.hold ?? (opts.turbo ? 350 : 750))
    }

    clearWins(instant = false) {
        this.gsap.killTweensOf(this.threads)
        const threads = this.threads
        const runes = this.runes
        this.runes = []
        if (instant) {
            this.threads = []
            this.lines.clear()
            for (const r of runes) r.s.destroy()
        } else {
            for (const th of threads) {
                th.progress = th.steps
                this.gsap.to(th, { alpha: 0, duration: 0.25, onComplete: () => {
                    this.threads = this.threads.filter(x => x !== th)
                    if (!this.threads.length) this.lines.clear()
                } })
            }
            for (const r of runes) {
                this.gsap.to(r.s, { alpha: 0, duration: 0.25, onComplete: () => r.s.destroy() })
            }
        }
        if (!this.reelSet) return
        for (let col = 0; col < BOS_COLS; col++) {
            for (let row = 0; row < BOS_ROWS; row++) {
                const sym = this.symbolAt(col, row)
                if (!sym) continue
                sym.setHighlight(false)
                this.gsap.killTweensOf(sym.view)
                if (instant) sym.view.alpha = 1
                else this.gsap.to(sym.view, { alpha: 1, duration: 0.2 })
            }
        }
    }

    // --- feature ------------------------------------------------------------------------

    /** Books light up and link before the feature intro. */
    async celebrateBooks(cells: Cell[], turbo: boolean) {
        if (!this.reelSet) return
        this.clearWins(true)
        const sorted = [...cells].sort((a, b) => a.col - b.col || a.row - b.row)
        for (const c of sorted) {
            const p = this.cellCenter(c.col, c.row)
            this.sigil(p.x, p.y, ARCANE, 1, 0.8)
            this.burst(p.x, p.y, 26, [ARCANE, GOLD, 0xffffff], 320, 13)
            this.symbolAt(c.col, c.row)?.pop(1.6)
            this.symbolAt(c.col, c.row)?.setHighlight(true, ARCANE)
            await wait(turbo ? 90 : 170)
        }
        const edges: ThreadEdge[] = []
        for (let i = 0; i + 1 < sorted.length; i++) {
            const a = this.cellCenter(sorted[i]!.col, sorted[i]!.row)
            const b = this.cellCenter(sorted[i + 1]!.col, sorted[i + 1]!.row)
            edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, step: i })
        }
        const thread: Thread = { edges, steps: edges.length, progress: 0, color: ARCANE, core: 0xeaffd8, alpha: 1 }
        this.threads.push(thread)
        await new Promise<void>(resolve => this.gsap.to(thread, { progress: thread.steps, duration: (turbo ? 0.08 : 0.16) * thread.steps, ease: 'none', onComplete: () => resolve() }))
        this.flash(ARCANE, 0.28)
        this.shake(12)
        await wait(turbo ? 400 : 900)
    }

    setBonusSymbol(symbol: SlotSymbol | null) {
        this.bonusSymbol = symbol
        for (const sym of this.symbols) if (sym.id === 'bonuswild') sym.relayout()
    }

    setLocked(cols: number[]) {
        this.locked.clear()
        for (const c of cols) this.locked.add(c)
    }

    /** A wild seal landed: blast a pillar up the reel and fill it outward from the landing row. */
    async expandColumn(col: number, triggerRow: number, turbo: boolean) {
        const reelSet = this.reelSet
        if (!reelSet) return
        const origin = this.cellCenter(col, triggerRow)
        const pillar = new this.pixi.Sprite(this.tex.beam)
        pillar.anchor.set(0.5)
        pillar.blendMode = 'add'
        pillar.tint = 0xff5a2a
        pillar.position.set(origin.x, PAD + REEL_H / 2)
        pillar.width = BOS_CELL * 2.2
        pillar.height = 1
        pillar.alpha = 1
        this.popupLayer.addChild(pillar)
        this.gsap.to(pillar, { height: REEL_H * 1.25, duration: 0.3, ease: 'power3.out' })
        this.gsap.to(pillar, { alpha: 0, duration: 0.6, delay: 0.35, onComplete: () => pillar.destroy() })
        this.sigil(origin.x, origin.y, BLOOD, 1.1, 0.3)
        this.burst(origin.x, origin.y, 30, [BLOOD, 0xff9a3a, 0xffe0c0], 360, 14)
        this.shake(turbo ? 8 : 14)
        this.flash(0xff4a2a, 0.18)

        const order: number[] = [triggerRow]
        for (let d = 1; d < BOS_ROWS; d++) {
            if (triggerRow - d >= 0) order.push(triggerRow - d)
            if (triggerRow + d < BOS_ROWS) order.push(triggerRow + d)
        }
        for (const row of order) {
            reelSet.setSymbolAt(col, row, 'bonuswild')
            const sym = this.symbolAt(col, row)
            sym?.relayout()
            sym?.pop(1.4)
            const p = this.cellCenter(col, row)
            this.burst(p.x, p.y, 8, [0xff6a2a, 0xffd08a], 180, 9)
            this.hooks.onWildCell?.()
            await wait(turbo ? 30 : 55)
        }
        this.locked.add(col)
    }

    destroy() {
        if (this.destroyed) return
        this.destroyed = true
        this.resizeObserver?.disconnect()
        this.resizeObserver = null
        if (this.gsap) {
            this.gsap.killTweensOf(this.threads)
            for (const r of this.runes) this.gsap.killTweensOf([r.s, r.s.scale])
        }
        safeDestroy(() => this.reelSet?.destroy())
        this.reelSet = null
        safeDestroy(() => this.app?.destroy(true, { children: true }))
        this.app = null
        for (const s of this.spritePool) safeDestroy(() => s.destroy())
        this.spritePool.length = 0
        this.particles = []
        for (const t of Object.values(this.tex)) safeDestroy(() => t.destroy(true))
        for (const t of [...Object.values(this.symbolTex.base), ...Object.values(this.symbolTex.bonus)]) safeDestroy(() => t?.destroy(false))
        this.symbols.clear()
    }
}
