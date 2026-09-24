<script setup lang="ts">
import type { Container, Graphics, Text, Texture } from 'pixi.js'
import type { ReelSet } from 'pixi-reels'
import type { FireBonusDrop, FireBonusResult, FireBonusValueEvent, FireCell, FireCascadeStep, FireInTheHoleResult, FireSymbol } from '#shared/utils/gamelogic/fireinthehole'
import { FITH_BUY_BONUS_COST, FITH_COLS, FITH_FREE_SPINS, FITH_MAX_CASCADES, FITH_MAX_LINES, FITH_ROWS, FITH_SCATTERS_FOR_BONUS, FITH_STARTING_LINES, playFireInTheHole } from '#shared/utils/gamelogic/fireinthehole'
import { initSlotPixiApp, safeDestroy } from '~/utils/slot-pixi'
import { FithFx } from '~/utils/fireinthehole-fx'
import { FITH_BET_STEPS, fithChainMultiplier, fithWinTier } from '~/utils/fireinthehole-paytable'
import { FITH_BONUS_SPRITE_SRC, FITH_BONUS_SYMBOL_META, FITH_SPRITE_SRC, FITH_SYMBOL_META } from '~/utils/fireinthehole-sprite'
import FithAutoSpinModal from '~/components/games/fireinthehole/FithAutoSpinModal.vue'
import FithBonusBanner from '~/components/games/fireinthehole/FithBonusBanner.vue'
import FithInfoPanel from '~/components/games/fireinthehole/FithInfoPanel.vue'
import FithSymbolIcon from '~/components/games/fireinthehole/FithSymbolIcon.vue'
import FithWinOverlay from '~/components/games/fireinthehole/FithWinOverlay.vue'

const canvasHost = ref<HTMLDivElement | null>(null)
const cabinet = ref<HTMLDivElement | null>(null)
const winOverlay = ref<InstanceType<typeof FithWinOverlay> | null>(null)
const bonusBanner = ref<InstanceType<typeof FithBonusBanner> | null>(null)

const { bet, isSpinning: isPlaying, errorMsg, balance, setBalance, history, pushHistory, spin: requestSpin } = useSlotGame<FireInTheHoleResult, { payout: number, bet: number, bonus: boolean }>('fireinthehole')
const sound = useFireInTheHoleSound()
const { soundEnabled, soundVolume } = sound

const isReady = ref(false)
const activeLines = ref(FITH_STARTING_LINES)
/** Index of the cascade being paid (-1 before the first). */
const chainIndex = ref(-1)
/** Win meter value; eases toward the round's running total. */
const winMeter = ref(0)
const winFlash = ref(0)
const isBonus = ref(false)
const bonusSpin = ref(0)
const bonusTotal = ref(0)
const message = ref('')
const showInfo = ref(false)
const showAuto = ref(false)
const showSound = ref(false)
const turbo = ref(false)
const cabinetShake = ref(false)

const MIN_BET = 1
const MAX_BET = FITH_BET_STEPS.at(-1)!

const autoSpinsLeft = ref(0)
const autoStopOnBonus = ref(false)
const isAuto = computed(() => autoSpinsLeft.value > 0)

const betDraft = ref(bet.value)
const betText = useAmountInput(betDraft, { integer: true, shorthand: true })
const buyCost = computed(() => bet.value * FITH_BUY_BONUS_COST)
const canSpin = computed(() => isReady.value && !isPlaying.value && balance.value >= bet.value)
const canBuy = computed(() => isReady.value && !isPlaying.value && !isAuto.value && balance.value >= buyCost.value)
const chainLadder = Array.from({ length: FITH_MAX_CASCADES }, (_, i) => fithChainMultiplier(i))

const IDLE_MESSAGES = [
    'Connect 5 or more matching symbols',
    'Dynamite is wild and blasts its neighbours',
    'Blast the bottom 2 rows to dig deeper',
    `${FITH_SCATTERS_FOR_BONUS} lanterns start ${FITH_FREE_SPINS} free spins`,
    'Every cascade raises the multiplier'
]
let idleIndex = 0
let idleTimer: ReturnType<typeof setInterval> | null = null

// Cosmetic embers drifting up the page background.
const embers = Array.from({ length: 22 }, () => ({
    left: Math.random() * 100,
    delay: Math.random() * 12,
    duration: 9 + Math.random() * 10,
    size: 2 + Math.random() * 3,
    drift: (Math.random() - 0.5) * 120
}))

// Reel geometry. The canvas is square; everything inside is laid out in
// design pixels and scaled with the canvas.
const SYMBOL_SIZE = 108
const SYMBOL_GAP = 8
const REEL_MARGIN = 14
const REEL_CONTENT = FITH_COLS * SYMBOL_SIZE + (FITH_COLS - 1) * SYMBOL_GAP
const DESIGN_SIZE = REEL_CONTENT + REEL_MARGIN * 2

type PixiModule = typeof import('pixi.js')
type GsapModule = typeof import('gsap')['gsap']

let PIXI: PixiModule | null = null
let gsap: GsapModule | null = null
let pixiApp: import('pixi.js').Application | null = null
let reelSet: ReelSet | null = null
let world: Container | null = null
let socketLayer: Graphics | null = null
let lockLayer: Graphics | null = null
let lockLabel: Text | null = null
let glowLayer: Container | null = null
let anticipationLayer: Graphics | null = null
let bonusValueLayer: Container | null = null
let popupLayer: Container | null = null
let fx: FithFx | null = null
let glowTexture: Texture | null = null
let resizeObserver: ResizeObserver | null = null
let boundaryLines = FITH_STARTING_LINES
let boundaryTween: { kill: () => void } | null = null
let anticipationTween: { kill: () => void } | null = null
let pendingBonusDrops: FireBonusDrop[] = []
let currentStep: FireCascadeStep | undefined
let latestResult: FireInTheHoleResult | null = null
let scattersSeen = 0
let countScattersOnLand = false
/** Column after which the drop teases, one column at a time, or -1. */
let teaseAfter = -1
let destroyed = false
let winRun = 0

const TEX: Partial<Record<FireSymbol, Texture>> = {}
const ALL_SYMBOL_IDS = [...Object.keys(FITH_SYMBOL_META), ...Object.keys(FITH_BONUS_SYMBOL_META)] as FireSymbol[]

/** Crumble debris tint per symbol. */
const CRUMBLE_TINT: Partial<Record<FireSymbol, number[]>> = {
    coal: [0x3a3531, 0x55504a, 0xff8a2a],
    ore: [0xc9ccd2, 0x6b6f76, 0xffffff],
    ruby: [0xe23a4a, 0x7a1f28, 0xff8a9a],
    sapphire: [0x3b82f6, 0x1e3a8a, 0x9cc7ff],
    emerald: [0xf2c14e, 0x8a5a12, 0xffe28a],
    scatter: [0xffc857, 0x6b5d50]
}

// Bet ------------------------------------------------------------------------

watch(bet, (value) => {
    betDraft.value = value
})

function clampBet(value: number) {
    if (!Number.isFinite(value) || value < MIN_BET) return MIN_BET
    return Math.min(MAX_BET, Math.floor(value))
}

const betLocked = computed(() => isPlaying.value || isAuto.value)

function setBet(value: number) {
    if (betLocked.value) return
    bet.value = clampBet(value)
    betDraft.value = bet.value
}

function commitBet() {
    setBet(betDraft.value || MIN_BET)
}

function betStep(dir: 1 | -1) {
    if (betLocked.value) return
    const current = bet.value
    const next = dir > 0
        ? FITH_BET_STEPS.find(step => step > current) ?? MAX_BET
        : [...FITH_BET_STEPS].reverse().find(step => step < current) ?? MIN_BET
    if (next === current) return
    setBet(next)
    sound.play(dir > 0 ? 'bet-up' : 'bet-down')
}

function maxBet() {
    if (betLocked.value) return
    const affordable = [...FITH_BET_STEPS].reverse().find(step => step <= balance.value) ?? MIN_BET
    setBet(affordable)
    sound.play('bet-max')
}

// Helpers --------------------------------------------------------------------

function sleep(ms: number) {
    return new Promise(resolve => window.setTimeout(resolve, ms))
}

function speed(ms: number) {
    return turbo.value ? Math.round(ms * 0.5) : ms
}

function cellKey(cell: FireCell) {
    return `${cell.col}:${cell.row}`
}

function gridToTargets(grid: FireSymbol[][]) {
    return grid.map(visible => ({ visible }))
}

function cellSize() {
    return SYMBOL_SIZE * (reelSet?.scale.x ?? 1)
}

function cellCenter(cell: FireCell) {
    if (!reelSet) return { x: 0, y: 0 }
    const b = reelSet.getCellBounds(cell.col, cell.row)
    const s = reelSet.scale.x
    return { x: reelSet.x + (b.x + b.width / 2) * s, y: reelSet.y + (b.y + b.height / 2) * s }
}

function symbolAt(cell: FireCell) {
    try {
        return reelSet?.getReel(cell.col).getSymbolAt(cell.row) ?? null
    } catch {
        return null
    }
}

function setMessage(text: string) {
    message.value = text
}

function tickWinTo(to: number, ms = 450) {
    const run = ++winRun
    const from = winMeter.value
    if (to <= from) {
        winMeter.value = to
        return
    }
    const start = performance.now()
    const d = speed(ms)
    let lastTick = 0
    const frame = (now: number) => {
        if (run !== winRun) return
        const t = Math.min(1, (now - start) / d)
        winMeter.value = from + (to - from) * (1 - (1 - t) ** 3)
        if (now - lastTick > 60 && t < 1) {
            lastTick = now
            sound.play('tick', { intensity: t })
        }
        if (t < 1) requestAnimationFrame(frame)
        else winMeter.value = to
    }
    requestAnimationFrame(frame)
    winFlash.value++
}

function shakeCabinet() {
    cabinetShake.value = false
    requestAnimationFrame(() => {
        cabinetShake.value = true
        window.setTimeout(() => {
            cabinetShake.value = false
        }, 500)
    })
}

function formatMult(value: number) {
    return `${formatNumber(value, false, value < 10 ? 2 : 0)}x`
}

// Pixi setup -----------------------------------------------------------------

function makeGlowTexture(P: PixiModule) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')!
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    return P.Texture.from(canvas)
}

async function initPixi() {
    if (!canvasHost.value || pixiApp) return

    const [pixiModule, reels, gsapModule] = await Promise.all([
        import('pixi.js'),
        import('pixi-reels'),
        import('gsap')
    ])
    if (destroyed) return
    PIXI = pixiModule
    gsap = gsapModule.gsap
    const P = pixiModule
    const G = gsapModule.gsap

    await Promise.all([
        document.fonts.load('24px "Alfa Slab One"').catch(() => {}),
        document.fonts.load('24px "Rye"').catch(() => {})
    ])

    const [baseSheet, bonusSheet] = await Promise.all([
        P.Assets.load(FITH_SPRITE_SRC),
        P.Assets.load(FITH_BONUS_SPRITE_SRC)
    ])
    if (destroyed) return
    for (const [id, meta] of Object.entries(FITH_SYMBOL_META)) {
        TEX[id as FireSymbol] = new P.Texture({ source: baseSheet.source, frame: new P.Rectangle(...meta.rect) })
    }
    for (const [id, meta] of Object.entries(FITH_BONUS_SYMBOL_META)) {
        TEX[id as FireSymbol] = new P.Texture({ source: bonusSheet.source, frame: new P.Rectangle(...meta.rect) })
    }
    const glowTex = makeGlowTexture(P)
    glowTexture = glowTex

    class MineSymbol extends reels.ReelSymbol {
        private readonly glow = new P.Sprite(glowTex)
        private readonly sprite = new P.Sprite()
        private readonly spark = new P.Sprite(glowTex)
        private readonly label = new P.Text({
            text: '',
            style: {
                fill: 0xfff4d6,
                fontFamily: '"Alfa Slab One", Georgia, serif',
                fontSize: 24,
                stroke: { color: 0x2b1405, width: 5 },
                dropShadow: { color: 0x000000, blur: 3, distance: 2, alpha: 0.6 }
            }
        })

        private symbol: FireSymbol = 'coal'
        private w = SYMBOL_SIZE
        private h = SYMBOL_SIZE

        constructor() {
            super()
            this.glow.anchor.set(0.5)
            this.glow.blendMode = 'add'
            this.glow.visible = false
            this.sprite.anchor.set(0.5)
            this.spark.anchor.set(0.5)
            this.spark.blendMode = 'add'
            this.spark.tint = 0xffb238
            this.spark.visible = false
            this.label.anchor.set(0.5)
            this.label.visible = false
            this.view.addChild(this.glow, this.sprite, this.spark, this.label)
        }

        protected onActivate(symbolId: string): void {
            this.symbol = symbolId as FireSymbol
            this.label.visible = false
            this.draw()
            G.killTweensOf([this.glow, this.spark, this.spark.scale])
            if (this.symbol === 'scatter') {
                this.glow.visible = true
                this.glow.tint = 0xffb84a
                this.glow.alpha = 0.35
                G.to(this.glow, { alpha: 0.7, duration: 0.9 + Math.random() * 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut' })
            } else {
                this.glow.visible = false
            }
            if (this.symbol === 'bomb') {
                this.spark.visible = true
                this.spark.alpha = 0.8
                G.to(this.spark, { alpha: 0.25, duration: 0.08 + Math.random() * 0.06, yoyo: true, repeat: -1, ease: 'none' })
            } else {
                this.spark.visible = false
            }
        }

        protected onDeactivate(): void {
            G.killTweensOf([this.view.scale, this.view, this.glow, this.spark, this.spark.scale, this.sprite.scale])
            this.glow.visible = false
            this.spark.visible = false
        }

        /** Gold glow and a bounce on a winning symbol. */
        async playWin(): Promise<void> {
            this.glow.visible = true
            this.glow.tint = this.symbol === 'bomb' ? 0xff7a2a : 0xffd66b
            G.killTweensOf(this.glow)
            G.fromTo(this.glow, { alpha: 0 }, { alpha: 1, duration: 0.12 })
            await G.to(this.sprite.scale, { x: this.sprite.scale.x * 1.12, y: this.sprite.scale.y * 1.12, duration: 0.14, yoyo: true, repeat: 1, ease: 'power2.out' })
        }

        stopAnimation(): void {
            G.killTweensOf(this.view.scale)
            this.view.scale.set(1)
        }

        resize(width: number, height: number): void {
            this.w = width
            this.h = height
            this.draw()
        }

        setBonusDrop(drop?: FireBonusDrop): void {
            if (!drop || drop.symbol === 'double') {
                this.label.visible = false
                return
            }
            this.label.text = drop.symbol === 'boost' ? `+${formatMult(drop.multiplier)}` : formatMult(drop.multiplier)
            this.label.visible = drop.symbol !== 'collector'
            this.draw()
        }

        private draw() {
            const tex = TEX[this.symbol]
            const cx = this.w / 2
            const cy = this.h / 2
            if (tex) {
                const inset = this.symbol === 'empty' ? 0.8 : this.symbol === 'rock' ? 0.94 : 0.92
                const max = Math.min(this.w, this.h) * inset
                const scale = Math.min(max / tex.width, max / tex.height)
                this.sprite.texture = tex
                this.sprite.scale.set(scale)
                this.sprite.position.set(cx, cy)
                this.sprite.alpha = this.symbol === 'empty' ? 0.55 : 1
                this.sprite.visible = true
            } else {
                this.sprite.visible = false
            }
            this.glow.position.set(cx, cy)
            this.glow.scale.set(this.w * 1.25 / 128)
            this.spark.position.set(cx - this.w * 0.12, cy - this.h * 0.36)
            this.spark.scale.set(this.w * 0.3 / 128)
            this.label.position.set(cx, cy + 2)
            this.label.style.fontSize = this.label.text.length > 6 ? 19 : 24
        }
    }

    pixiApp = await initSlotPixiApp(P.Application, { width: DESIGN_SIZE, height: DESIGN_SIZE }, () => destroyed)
    if (!pixiApp) return
    pixiApp.canvas.classList.add('fith-canvas')
    canvasHost.value.appendChild(pixiApp.canvas)

    latestResult = playFireInTheHole(1)
    const initialGrid = latestResult.steps[0]?.grid ?? latestResult.grid

    reelSet = new reels.ReelSetBuilder()
        .reels(FITH_COLS)
        .visibleRows(FITH_ROWS)
        .symbolSize(SYMBOL_SIZE, SYMBOL_SIZE)
        .symbolGap(SYMBOL_GAP, SYMBOL_GAP)
        .bufferSymbols(1)
        .symbols((registry) => {
            for (const id of ALL_SYMBOL_IDS) registry.register(id, MineSymbol, {})
        })
        .weights({ coal: 34, ore: 28, ruby: 18, sapphire: 13, emerald: 9, bomb: 9, scatter: 5, coin: 1, boost: 1, double: 1, collector: 1, empty: 1, rock: 0 })
        .symbolData({ bomb: { zIndex: 10 }, rock: { zIndex: -1 } })
        .tumble({
            fall: { duration: 280, ease: 'power2.in', rowStagger: 28, rowOrder: 'bottomToTop' },
            // Rocks fall and stop dead: accelerate in, no bounce or squash on landing.
            dropIn: { duration: 400, ease: 'power2.in', rowStagger: 34, distance: 'perHole' }
        })
        .speed('mine', {
            ...reels.SpeedPresets.NORMAL,
            name: 'mine',
            minimumSpinTime: 520,
            tumble: { fall: { duration: 240, rowStagger: 22 }, dropIn: { duration: 400, rowStagger: 30 } }
        })
        .speed('mineTurbo', {
            ...reels.SpeedPresets.TURBO,
            name: 'mineTurbo',
            minimumSpinTime: 220,
            tumble: { fall: { duration: 140, rowStagger: 10 }, dropIn: { duration: 260, rowStagger: 12 } }
        })
        .initialSpeed('mine')
        .initialFrame(gridToTargets(initialGrid))
        .ticker(pixiApp.ticker)
        .build()

    world = new P.Container()
    socketLayer = new P.Graphics()
    lockLayer = new P.Graphics()
    lockLabel = new P.Text({
        text: 'DYNAMITE IN THE BOTTOM 2 ROWS DIGS DEEPER',
        style: { fill: 0xf3d3a0, fontFamily: '"Alfa Slab One", Georgia, serif', fontSize: 15, letterSpacing: 1.5, stroke: { color: 0x1a0f07, width: 4 } }
    })
    lockLabel.anchor.set(0.5)
    glowLayer = new P.Container()
    anticipationLayer = new P.Graphics()
    anticipationLayer.blendMode = 'add'
    anticipationLayer.alpha = 0
    bonusValueLayer = new P.Container()
    popupLayer = new P.Container()
    const fxParent = new P.Container()

    world.addChild(socketLayer, anticipationLayer, reelSet, lockLayer, lockLabel, glowLayer, bonusValueLayer, fxParent, popupLayer)
    pixiApp.stage.addChild(world)
    fx = new FithFx(P, pixiApp, fxParent, world)
    fx.glintSource = randomGlintPoint

    reelSet.events.on('cascade:dropIn:end', ({ reelIndex }) => onColumnLanded(reelIndex))

    reelSet.events.on('cascade:place:end', ({ reelIndex, placedSymbols }) => {
        for (const drop of pendingBonusDrops) {
            if (drop.col !== reelIndex) continue
            const symbol = placedSymbols[drop.row]
            if (symbol instanceof MineSymbol) symbol.setBonusDrop(drop)
        }
    })

    reelSet.events.on('cascade:destroy:start', ({ cells }) => onCellsDestroyed(cells))

    resizeObserver = new ResizeObserver(resizePixi)
    resizeObserver.observe(canvasHost.value)
    resizePixi()

    activeLines.value = latestResult.steps[0]?.activeLinesBefore ?? latestResult.activeLines
    boundaryLines = activeLines.value
    drawLock()
    isReady.value = true
}

function resizePixi() {
    if (!pixiApp || !reelSet || !canvasHost.value) return
    const size = Math.max(280, Math.floor(canvasHost.value.clientWidth))
    pixiApp.renderer.resize(size, size)
    const scale = size / DESIGN_SIZE
    reelSet.scale.set(scale)
    reelSet.position.set(REEL_MARGIN * scale, REEL_MARGIN * scale)
    if (fx) fx.bounds = { x: 0, y: 0, w: size, h: size }
    drawSockets()
    drawLock()
}

function drawSockets() {
    if (!socketLayer || !reelSet) return
    const g = socketLayer
    const s = reelSet.scale.x
    g.clear()
    for (let col = 0; col < FITH_COLS; col++) {
        for (let row = 0; row < FITH_ROWS; row++) {
            const b = reelSet.getCellBounds(col, row)
            const x = reelSet.x + b.x * s
            const y = reelSet.y + b.y * s
            const w = b.width * s
            const h = b.height * s
            g.roundRect(x + 2 * s, y + 2 * s, w - 4 * s, h - 4 * s, 14 * s).fill({ color: 0x000000, alpha: 0.42 })
            g.roundRect(x + 2 * s, y + 2 * s, w - 4 * s, h - 4 * s, 14 * s).stroke({ color: 0xffc680, alpha: 0.07, width: Math.max(1, 1.5 * s) })
        }
    }
}

/** Rock wall, planks and the support beam over the rows that are still sealed. */
function drawLock() {
    if (!lockLayer || !reelSet || !lockLabel) return
    const g = lockLayer
    const s = reelSet.scale.x
    g.clear()
    lockLabel.visible = false
    if (boundaryLines >= FITH_ROWS - 0.001) return

    const first = reelSet.getCellBounds(0, 0)
    const last = reelSet.getCellBounds(FITH_COLS - 1, FITH_ROWS - 1)
    const pitch = (SYMBOL_SIZE + SYMBOL_GAP) * s
    const left = reelSet.x + first.x * s - 6 * s
    const right = reelSet.x + (last.x + last.width) * s + 6 * s
    const bottom = reelSet.y + (last.y + last.height) * s + 6 * s
    const top = reelSet.y + first.y * s + boundaryLines * pitch - (SYMBOL_GAP / 2) * s
    const width = right - left

    g.rect(left, top, width, bottom - top).fill({ color: 0x0b0704, alpha: 0.8 })

    // Two planks nailed across each sealed row.
    const firstSealed = Math.ceil(boundaryLines - 0.001)
    for (let row = firstSealed; row < FITH_ROWS; row++) {
        const rowTop = reelSet.y + first.y * s + row * pitch
        const rowMid = rowTop + (SYMBOL_SIZE * s) / 2
        if (rowMid < top + 10 * s) continue
        for (const [offset, tone] of [[-0.24, 0x5d3b1f], [0.12, 0x4f321a]] as const) {
            const py = rowMid + offset * SYMBOL_SIZE * s
            const ph = SYMBOL_SIZE * 0.2 * s
            g.rect(left + 4 * s, py, width - 8 * s, ph).fill({ color: tone, alpha: 0.95 })
            g.rect(left + 4 * s, py, width - 8 * s, 2 * s).fill({ color: 0x8a5f36, alpha: 0.9 })
            g.rect(left + 4 * s, py + ph - 2 * s, width - 8 * s, 2 * s).fill({ color: 0x1e1209, alpha: 0.9 })
            for (let n = 0; n <= FITH_COLS; n++) {
                const nx = left + 12 * s + (width - 24 * s) * (n / FITH_COLS)
                g.circle(nx, py + ph / 2, 2.4 * s).fill({ color: 0x9aa0a6, alpha: 0.8 })
            }
        }
        if (row === firstSealed) {
            lockLabel.visible = true
            // Keep the hint readable on small screens, but inside the planks.
            const natural = lockLabel.width / Math.max(lockLabel.scale.x, 0.001)
            lockLabel.scale.set(Math.min(Math.max(s, 0.72), (width - 24 * s) / Math.max(1, natural)))
            lockLabel.position.set(left + width / 2, rowMid + 0.02 * SYMBOL_SIZE * s)
        }
    }

    // Support beam with a hazard band along the boundary.
    const beamH = 16 * s
    const by = top - beamH / 2
    g.rect(left - 2 * s, by, width + 4 * s, beamH).fill({ color: 0x6b4424 })
    g.rect(left - 2 * s, by, width + 4 * s, 3 * s).fill({ color: 0xa0703e })
    g.rect(left - 2 * s, by + beamH - 3 * s, width + 4 * s, 3 * s).fill({ color: 0x2a190c })
    const bandY = by + beamH * 0.3
    const bandH = beamH * 0.4
    g.rect(left, bandY, width, bandH).fill({ color: 0x1a1208 })
    const stripe = 14 * s
    for (let x = left - stripe; x < right; x += stripe * 2) {
        const x0 = Math.max(left, x)
        const x1 = Math.min(right, x + stripe)
        const x2 = Math.min(right, x + stripe + bandH)
        const x3 = Math.max(left, x + bandH)
        if (x1 <= left || x3 >= right) continue
        g.poly([x0, bandY + bandH, x1, bandY + bandH, x2, bandY, x3, bandY]).fill({ color: 0xf2b418, alpha: 0.85 })
    }
    for (const bx of [left + 6 * s, right - 6 * s]) g.circle(bx, by + beamH / 2, 3 * s).fill({ color: 0xc9c9c9 })
}

function animateBoundary(lines: number) {
    if (!gsap) return
    boundaryTween?.kill()
    const state = { value: boundaryLines }
    boundaryTween = gsap.to(state, {
        value: lines,
        duration: Math.min(0.7, Math.max(0.3, Math.abs(lines - boundaryLines) * 0.28)),
        ease: 'power2.inOut',
        onUpdate: () => {
            boundaryLines = state.value
            drawLock()
        },
        onComplete: () => {
            boundaryLines = lines
            drawLock()
            boundaryTween = null
        }
    })
}

function randomGlintPoint() {
    if (!reelSet || isBonus.value) return null
    const col = Math.floor(Math.random() * FITH_COLS)
    const row = Math.floor(Math.random() * Math.max(1, Math.floor(boundaryLines)))
    let id: string | undefined
    try {
        id = reelSet.getReel(col).getVisibleSymbols()[row]
    } catch {
        return null
    }
    if (id !== 'ruby' && id !== 'sapphire' && id !== 'emerald' && id !== 'ore') return null
    const c = cellCenter({ col, row })
    const size = cellSize()
    return { x: c.x + (Math.random() - 0.5) * size * 0.5, y: c.y + (Math.random() - 0.5) * size * 0.5, size }
}

// Landing, winning and blasting ------------------------------------------------

function visibleScatterCount() {
    if (!reelSet) return 0
    let count = 0
    const grid = reelSet.getVisibleGrid()
    for (let col = 0; col < FITH_COLS; col++) {
        for (let row = 0; row < activeLines.value; row++) {
            if (grid[col]?.[row] === 'scatter') count++
        }
    }
    return count
}

function onColumnLanded(col: number) {
    if (destroyed || !reelSet) return
    sound.play('land', { col, intensity: col / (FITH_COLS - 1) })
    const bottom = cellCenter({ col, row: Math.max(0, activeLines.value - 1) })
    fx?.landingDust(bottom.x, bottom.y + cellSize() * 0.45, cellSize())
    // The tease follows the drop: light the next column as each one lands.
    if (teaseAfter >= 0 && col >= teaseAfter) {
        if (col + 1 < FITH_COLS) showAnticipation(col + 1)
        else hideAnticipation()
    }

    if (!countScattersOnLand) return
    const count = visibleScatterCount()
    if (count > scattersSeen) {
        scattersSeen = count
        sound.play('scatter', { intensity: count, col })
        const grid = reelSet.getVisibleGrid()
        for (let row = 0; row < activeLines.value; row++) {
            if (grid[col]?.[row] === 'scatter') {
                const c = cellCenter({ col, row })
                fx?.sparkle(c.x, c.y, cellSize(), [0xffd27a, 0xffb238], 12)
            }
        }
        if (count === FITH_SCATTERS_FOR_BONUS - 1) setMessage('Two lanterns. One more for free spins!')
    }
}

function onCellsDestroyed(cells: readonly { reel: number, row: number }[]) {
    if (destroyed || !fx) return
    const step = currentStep
    const grid = step?.grid
    const bombs = new Set(step?.bombCells.map(cellKey) ?? [])
    const size = cellSize()
    let bombIndex = 0
    for (const cell of cells) {
        const c = cellCenter({ col: cell.reel, row: cell.row })
        const key = `${cell.reel}:${cell.row}`
        if (bombs.has(key)) {
            const delay = speed(bombIndex * 90)
            bombIndex++
            window.setTimeout(() => {
                if (destroyed || !fx) return
                fx.blast(c.x, c.y, size)
                sound.play('explosion', { col: cell.reel, intensity: bombIndex })
            }, delay)
        } else {
            const symbol = grid?.[cell.reel]?.[cell.row] ?? 'coal'
            fx.crumble(c.x, c.y, size, CRUMBLE_TINT[symbol] ?? [0x6b5d50, 0x4a4038])
        }
    }
    if (bombIndex > 0) {
        fx.shake(Math.min(22, 7 + bombIndex * 3) * (size / 100), 0.35 + Math.min(0.3, bombIndex * 0.06))
        if (bombIndex >= 3) shakeCabinet()
    }
    sound.play('crumble', { intensity: Math.min(2, cells.length / 8) })
}

async function highlightWinners(step: FireCascadeStep, chain: number) {
    const bombs = new Set(step.bombCells.map(cellKey))
    const waits: Promise<void>[] = []
    for (const cell of step.winCells) {
        const symbol = symbolAt(cell) as unknown as { playWin?: () => Promise<void> } | null
        if (symbol?.playWin) waits.push(symbol.playWin())
        if (bombs.has(cellKey(cell))) {
            const c = cellCenter(cell)
            const size = cellSize()
            fx?.fuse(c.x - size * 0.12, c.y - size * 0.36, size)
        }
    }
    sound.play('gem-win', { intensity: chain })
    if (step.bombCells.length > 0) sound.play('fuse')
    await Promise.race([Promise.all(waits), sleep(700)])
    if (step.bombCells.length > 0) await sleep(speed(220))
}

async function moneyPopup(amount: number, cells: FireCell[], chain: number) {
    if (!popupLayer || !PIXI || !gsap || cells.length === 0 || amount <= 0) return
    const sum = cells.reduce((acc, cell) => {
        const c = cellCenter(cell)
        return { x: acc.x + c.x, y: acc.y + c.y }
    }, { x: 0, y: 0 })
    const s = reelSet?.scale.x ?? 1
    const label = new PIXI.Text({
        text: `+${formatNumber(amount)}`,
        style: {
            fill: 0xfff1b8,
            fontFamily: '"Alfa Slab One", Georgia, serif',
            fontSize: 40,
            stroke: { color: 0x3d1a03, width: 7 },
            dropShadow: { color: 0xffa726, blur: 12, distance: 0, alpha: 0.9 }
        }
    })
    label.anchor.set(0.5)
    label.position.set(sum.x / cells.length, sum.y / cells.length)
    label.scale.set(0.2 * s)
    popupLayer.addChild(label)
    const target = s * (chain > 0 ? 1.12 : 1)
    gsap.to(label.scale, { x: target, y: target, duration: 0.3, ease: 'back.out(3)' })
    gsap.to(label.position, { y: label.y - 70 * s, duration: speed(1100) / 1000, ease: 'power2.out' })
    gsap.to(label, { alpha: 0, duration: 0.25, delay: speed(850) / 1000, onComplete: () => label.destroy() })
    fx?.coinFountain(label.x, label.y, cellSize(), Math.min(22, 6 + cells.length))
}

async function unlockRows(rows: number[], lines: number) {
    if (!reelSet) return
    const s = reelSet.scale.x
    const first = reelSet.getCellBounds(0, 0)
    const last = reelSet.getCellBounds(FITH_COLS - 1, 0)
    const left = reelSet.x + first.x * s
    const right = reelSet.x + (last.x + last.width) * s
    const pitch = (SYMBOL_SIZE + SYMBOL_GAP) * s
    sound.play('row-unlock')
    fx?.shake(16 * (cellSize() / 100), 0.55)
    shakeCabinet()
    for (const row of rows) {
        const y = reelSet.y + first.y * s + row * pitch + (SYMBOL_SIZE * s) / 2
        fx?.splinters(left, right, y, cellSize())
        fx?.flash((left + right) / 2, y, cellSize() * 1.2, 0xffc46b, false)
    }
    setMessage(rows.length > 1 ? `Rows ${rows.map(r => r + 1).join(' & ')} blasted open!` : `Row ${rows[0]! + 1} blasted open!`)
    activeLines.value = lines
    animateBoundary(lines)
    await sleep(speed(420))
}

// Anticipation ---------------------------------------------------------------

/** Column after which two lanterns are showing in the dropped grid, or -1. */
function anticipationColumn(grid: FireSymbol[][], rows: number) {
    let count = 0
    for (let col = 0; col < FITH_COLS - 1; col++) {
        for (let row = 0; row < rows; row++) if (grid[col]?.[row] === 'scatter') count++
        if (count >= FITH_SCATTERS_FOR_BONUS - 1) return col
    }
    return -1
}

function showAnticipation(col: number) {
    if (!anticipationLayer || !reelSet || !gsap) return
    const g = anticipationLayer
    const s = reelSet.scale.x
    g.clear()
    const top = reelSet.getCellBounds(col, 0)
    const x = reelSet.x + top.x * s
    const h = (SYMBOL_SIZE + SYMBOL_GAP) * s * activeLines.value
    g.roundRect(x - 3 * s, reelSet.y + top.y * s - 3 * s, top.width * s + 6 * s, h, 16 * s).fill({ color: 0xff8a1a, alpha: 0.22 })
    g.roundRect(x - 3 * s, reelSet.y + top.y * s - 3 * s, top.width * s + 6 * s, h, 16 * s).stroke({ color: 0xffc04a, alpha: 0.9, width: 3 * s })
    anticipationTween?.kill()
    g.alpha = 0
    anticipationTween = gsap.to(g, { alpha: 1, duration: 0.25, yoyo: true, repeat: -1, ease: 'sine.inOut' })
    sound.play('anticipation')
}

function hideAnticipation() {
    anticipationTween?.kill()
    anticipationTween = null
    if (anticipationLayer) {
        anticipationLayer.alpha = 0
        anticipationLayer.clear()
    }
}

// Base game round ------------------------------------------------------------

async function dropGrid(grid: FireSymbol[][], opts: { anticipate: boolean }) {
    if (!reelSet) return
    reelSet.setSpeed(turbo.value ? 'mineTurbo' : 'mine')
    const step = turbo.value ? 40 : 95
    const antCol = opts.anticipate ? anticipationColumn(grid, FITH_STARTING_LINES) : -1
    const delays = Array.from({ length: FITH_COLS }, (_, col) => {
        const extra = antCol >= 0 && col > antCol ? (col - antCol) * (turbo.value ? 380 : 750) : 0
        return col * step + extra
    })
    reelSet.setDropOrder(delays)
    teaseAfter = antCol
    const done = reelSet.spin({ mode: 'cascade', timeoutMs: 12000 })
    await sleep(speed(140))
    reelSet.setResult(gridToTargets(grid))
    try {
        await done
    } finally {
        teaseAfter = -1
        hideAnticipation()
    }
    reelSet.setDropOrder('ltr', turbo.value ? 12 : 30)
}

async function animateBase(result: FireInTheHoleResult) {
    if (!reelSet) return
    latestResult = result
    activeLines.value = result.steps[0]?.activeLinesBefore ?? FITH_STARTING_LINES
    if (Math.abs(boundaryLines - activeLines.value) > 0.01) animateBoundary(activeLines.value)
    scattersSeen = 0
    countScattersOnLand = true
    pendingBonusDrops = []
    setMessage(result.bonus && result.steps.length === 0 ? 'Lighting the fuse' : 'Good luck')

    await dropGrid(result.grid, { anticipate: true })

    let stepIndex = 0
    await reelSet.runCascade({
        detectWinners: async () => {
            // Unmounting mid-cascade destroys the reel symbols while this chain
            // is still awaiting; reporting no winners ends the cascade cleanly.
            if (destroyed) return []
            currentStep = latestResult?.steps[stepIndex]
            if (!currentStep) return []
            chainIndex.value = stepIndex
            setMessage(stepIndex === 0 ? 'Connection!' : `Cascade ${stepIndex + 1} · x${fithChainMultiplier(stepIndex).toFixed(2)}`)
            await highlightWinners(currentStep, stepIndex)
            return currentStep.winCells.map(cell => ({ reel: cell.col, row: cell.row }))
        },
        nextGrid: async () => {
            const next = latestResult?.steps[stepIndex + 1]?.grid ?? latestResult?.restGrid ?? []
            stepIndex += 1
            return gridToTargets(next)
        },
        onCascade: async () => {
            const step = currentStep
            if (!step) return
            moneyPopup(step.stepPay, step.winCells, stepIndex)
            tickWinTo(step.totalPay)
            if (step.unlockedRows.length > 0) await unlockRows(step.unlockedRows, step.activeLinesAfter)
        },
        pauseAfterDestroyMs: turbo.value ? 80 : 200,
        refillMode: 'gravity-then-drop',
        gravityHoldMs: turbo.value ? 60 : 160,
        maxChain: FITH_MAX_CASCADES + 2
    })
    currentStep = undefined
    countScattersOnLand = false
    activeLines.value = result.activeLines
    if (Math.abs(boundaryLines - result.activeLines) > 0.01) animateBoundary(result.activeLines)
    winMeter.value = result.basePayout
}

async function celebrateScatters(cells: FireCell[]) {
    const size = cellSize()
    for (const cell of cells) {
        const symbol = symbolAt(cell) as unknown as { playWin?: () => Promise<void> } | null
        void symbol?.playWin?.()
        const c = cellCenter(cell)
        fx?.flash(c.x, c.y, size * 0.9, 0xffc46b)
        fx?.sparkle(c.x, c.y, size, [0xffe28a, 0xffb238], 16)
    }
    sound.play('bonus-trigger')
    fx?.shake(12 * (size / 100), 0.5)
    shakeCabinet()
    setMessage('Fire in the hole! Free spins!')
    await sleep(speed(1100))
}

// Free spins -----------------------------------------------------------------

function clearBonusValues() {
    bonusValueLayer?.removeChildren().forEach(child => child.destroy({ children: true }))
}

function drawBonusValues(coins: FireBonusDrop[]) {
    if (!bonusValueLayer || !reelSet || !PIXI) return
    const s = reelSet.scale.x
    clearBonusValues()
    for (const coin of coins) {
        const b = reelSet.getCellBounds(coin.col, coin.row)
        const tex = TEX[coin.symbol]
        const holder = new PIXI.Container()
        const w = b.width * s
        const h = b.height * s
        if (glowTexture) {
            const glow = new PIXI.Sprite(glowTexture)
            glow.anchor.set(0.5)
            glow.blendMode = 'add'
            glow.tint = coin.symbol === 'collector' ? 0xff6a4a : coin.symbol === 'boost' ? 0x7dffb0 : 0xffc84a
            glow.alpha = 0.45
            glow.scale.set(w * 1.1 / 128)
            glow.position.set(w / 2, h / 2)
            holder.addChild(glow)
        }
        if (tex) {
            const sprite = new PIXI.Sprite(tex)
            const max = Math.min(w, h) * 0.92
            sprite.anchor.set(0.5)
            sprite.scale.set(Math.min(max / tex.width, max / tex.height))
            sprite.position.set(w / 2, h / 2)
            holder.addChild(sprite)
        }
        const text = coin.symbol === 'boost' ? `+${formatMult(coin.multiplier)}` : formatMult(coin.multiplier)
        const label = new PIXI.Text({
            text,
            style: {
                fill: coin.symbol === 'boost' ? 0xd9ffe8 : 0xfff4d6,
                fontFamily: '"Alfa Slab One", Georgia, serif',
                fontSize: (text.length > 6 ? 19 : 24) * s,
                stroke: { color: coin.symbol === 'collector' ? 0x5a0f0a : coin.symbol === 'boost' ? 0x053d24 : 0x3d1a03, width: 5 * s },
                dropShadow: { color: 0x000000, blur: 3 * s, distance: 2 * s, alpha: 0.6 }
            }
        })
        label.anchor.set(0.5)
        label.position.set(w / 2, h / 2 + (coin.symbol === 'collector' ? h * 0.02 : 0))
        holder.addChild(label)
        holder.position.set(reelSet.x + b.x * s, reelSet.y + b.y * s)
        bonusValueLayer.addChild(holder)
    }
}

const DROP_TINT: Record<FireBonusDrop['symbol'], number[]> = {
    coin: [0xffe28a, 0xffb238],
    boost: [0x7dffb0, 0x34d399],
    double: [0xffe28a, 0xff9a3c],
    collector: [0xff8a6a, 0xff4a3a]
}

function dropEffects(drop: FireBonusDrop) {
    const c = cellCenter(drop)
    const size = cellSize()
    fx?.sparkle(c.x, c.y, size, DROP_TINT[drop.symbol], drop.symbol === 'coin' ? 8 : 16)
    if (drop.symbol === 'coin') sound.play('coin', { intensity: drop.multiplier, col: drop.col })
    else sound.play(drop.symbol, { col: drop.col })
    if (drop.symbol === 'double') {
        fx?.flash(c.x, c.y, size * 1.4, 0xffd66b)
        fx?.shake(8 * (size / 100), 0.3)
    }
    if (drop.symbol === 'collector') fx?.flash(c.x, c.y, size, 0xff6a4a)
}

async function transferValue(event: FireBonusValueEvent, index: number) {
    if (!popupLayer || !PIXI || !gsap) return
    const from = event.type === 'collect' ? cellCenter(event.target) : cellCenter(event.source)
    const to = event.type === 'collect' ? cellCenter(event.source) : cellCenter(event.target)
    const s = reelSet?.scale.x ?? 1
    const factor = Math.max(0.4, 0.9 - index * 0.06) * (turbo.value ? 0.6 : 1)
    const color = event.type === 'double' ? 0xffd66b : event.type === 'collect' ? 0xff8a6a : 0x7dffb0
    const label = new PIXI.Text({
        text: event.type === 'double' ? 'x2' : `+${formatMult(event.amount)}`,
        style: {
            fill: 0xffffff,
            fontFamily: '"Alfa Slab One", Georgia, serif',
            fontSize: 26,
            stroke: { color: 0x1a0c03, width: 5 },
            dropShadow: { color, blur: 10, distance: 0, alpha: 1 }
        }
    })
    label.anchor.set(0.5)
    label.position.set(from.x, from.y)
    label.scale.set(0.5 * s)
    popupLayer.addChild(label)
    sound.play('transfer', { intensity: index })
    const peakY = Math.min(from.y, to.y) - 50 * s
    await gsap.to(label.scale, { x: s, y: s, duration: 0.1 * factor, ease: 'back.out(2)' })
    await gsap.to(label, {
        keyframes: { '50%': { x: (from.x + to.x) / 2, y: peakY }, '100%': { x: to.x, y: to.y } },
        duration: 0.34 * factor,
        ease: 'power2.inOut'
    })
    fx?.sparkle(to.x, to.y, cellSize(), color, 6)
    label.destroy()
}

async function playBonus(bonus: FireBonusResult, bought: boolean) {
    if (!reelSet) return
    isBonus.value = true
    bonusSpin.value = 0
    bonusTotal.value = 0
    sound.setHeat(1)
    if (fx) fx.emberRate = 2.2
    activeLines.value = bonus.activeLines
    animateBoundary(bonus.activeLines)

    await bonusBanner.value?.intro(bonus.activeLines, { bought, autoMs: isAuto.value ? 1800 : 6000 })
    if (destroyed) return

    clearBonusValues()
    const locked = new Map<string, FireBonusDrop>()
    const bet = latestResult?.bet ?? 1
    const base = latestResult?.basePayout ?? 0
    const syncTotals = (mult: number) => {
        bonusTotal.value = mult
        tickWinTo(Number((base + mult * bet).toFixed(2)), 260)
    }

    for (const step of bonus.steps) {
        if (destroyed) return
        bonusSpin.value = step.spin
        setMessage(step.spin === bonus.freeSpins ? 'Last free spin!' : `Free spin ${step.spin} of ${bonus.freeSpins}`)
        sound.play('bonus-spin')
        reelSet.setSpeed(turbo.value ? 'mineTurbo' : 'mine')
        reelSet.setDropOrder('ltr', turbo.value ? 25 : 60)
        const done = reelSet.spin({ timeoutMs: turbo.value ? 3000 : 4500 })
        await sleep(speed(110))
        pendingBonusDrops = step.drops
        reelSet.setResult(gridToTargets(step.grid))
        await done

        for (const drop of step.drops) {
            if (drop.symbol === 'coin' || drop.symbol === 'boost' || drop.symbol === 'collector') locked.set(cellKey(drop), { ...drop })
        }
        const ordered = [...step.drops].sort((a, b) => a.col - b.col || a.row - b.row)
        for (let i = 0; i < ordered.length; i++) {
            dropEffects(ordered[i]!)
            await sleep(speed(Math.max(60, 150 - i * 15)))
        }
        drawBonusValues([...locked.values()])
        syncTotals([...locked.values()].reduce((sum, v) => v.symbol === 'boost' ? sum : sum + v.multiplier, 0))

        // Events from one boost, double or collector fly out together.
        const groups: FireBonusValueEvent[][] = []
        for (const event of step.valueEvents) {
            const last = groups.at(-1)
            if (last && last[0]!.type === event.type && cellKey(last[0]!.source) === cellKey(event.source)) last.push(event)
            else groups.push([event])
        }
        for (let g = 0; g < groups.length; g++) {
            const group = groups[g]!
            await Promise.all(group.map((event, i) => sleep(speed(i * 45)).then(() => transferValue(event, g))))
            for (const event of group) {
                if (event.type === 'collect') {
                    locked.delete(cellKey(event.target))
                    locked.set(cellKey(event.source), { ...event.source, multiplier: event.after })
                } else {
                    locked.set(cellKey(event.target), { ...event.target, multiplier: event.after })
                }
            }
            drawBonusValues([...locked.values()])
            syncTotals([...locked.values()].reduce((sum, v) => v.symbol === 'boost' ? sum : sum + v.multiplier, 0))
            await sleep(speed(120))
        }

        locked.clear()
        for (const coin of step.coins) locked.set(cellKey(coin), { ...coin })
        drawBonusValues([...locked.values()])
        syncTotals(step.totalMultiplier)
        await sleep(speed(step.drops.length > 0 ? 380 : 220))
    }

    sound.setHeat(0)
    if (fx) fx.emberRate = 1
}

// Round orchestration --------------------------------------------------------

async function play(buy = false) {
    if (!reelSet || destroyed) return
    const cost = buy ? buyCost.value : bet.value
    const balanceBefore = balance.value
    let debited = false

    const data = await requestSpin(cost, buy ? { buyBonus: true } : undefined, () => {
        sound.play(buy ? 'buy-bonus' : 'spin')
        chainIndex.value = -1
        winRun++
        winMeter.value = 0
        isBonus.value = false
        bonusSpin.value = 0
        bonusTotal.value = 0
        clearBonusValues()
        fx?.clear()
        setBalance(balanceBefore - cost)
        debited = true
    })

    if (!data) {
        if (debited) {
            setMessage('Spin failed')
            setBalance(balanceBefore)
        }
        autoSpinsLeft.value = 0
        return
    }

    const result = data.gameData
    try {
        await animateBase(result)
        if (result.bonus) {
            if (autoStopOnBonus.value) autoSpinsLeft.value = 0
            await celebrateScatters(result.scatterCells)
            await playBonus(result.bonus, buy)
        }
        // Reveal first: the win overlay counts up, then the meter settles.
        await celebrate(result, buy)
        winMeter.value = result.payout
        pushHistory({ payout: result.payout, bet: result.cost, bonus: Boolean(result.bonus) })
    } catch (error) {
        errorMsg.value = error instanceof Error ? error.message : 'Animation error'
        autoSpinsLeft.value = 0
    } finally {
        setBalance(data.balance)
        isBonus.value = false
        isPlaying.value = false
        chainIndex.value = -1
    }

    if (autoSpinsLeft.value > 0 && !destroyed) {
        autoSpinsLeft.value--
        if (autoSpinsLeft.value > 0 && balance.value >= bet.value) {
            await sleep(speed(350))
            if (autoSpinsLeft.value > 0 && !isPlaying.value) play()
        } else {
            autoSpinsLeft.value = 0
        }
    }
}

async function celebrate(result: FireInTheHoleResult, bought: boolean) {
    const multiple = result.payout / result.bet
    const tier = fithWinTier(multiple)
    if (result.bonus && !tier) {
        sound.play('bonus-end')
        await bonusBanner.value?.outro(result.bonus.totalMultiplier, result.payout, isAuto.value ? 1800 : 3200)
    } else if (tier) {
        await winOverlay.value?.show(result.payout, result.bet, result.bonus ? `Free spins · ${formatMult(result.bonus.totalMultiplier)}` : '')
    } else if (result.payout > 0) {
        sound.play('win-small', { intensity: Math.min(4, Math.floor(multiple)) })
    }
    const spent = bought ? result.cost : result.bet
    if (result.payout > 0) setMessage(`You won ${formatNumber(result.payout)}${result.payout > spent ? '!' : ''}`)
    else setMessage(result.scatterCells.length === FITH_SCATTERS_FOR_BONUS - 1 ? 'So close. Two lanterns.' : 'No luck this time')
}

function onTier(tier: { id: string }) {
    const size = cellSize()
    fx?.shake((tier.id === 'big' ? 6 : tier.id === 'mega' ? 10 : 14) * (size / 100), 0.4)
    if (tier.id !== 'big') shakeCabinet()
}

function spinPressed() {
    sound.unlock()
    if (isAuto.value) {
        autoSpinsLeft.value = 0
        sound.play('click')
        return
    }
    if (isPlaying.value) {
        slam()
        return
    }
    if (canSpin.value) play()
}

function slam() {
    if (!reelSet?.isSpinning) return
    try {
        reelSet.skipSpin()
    } catch {
        reelSet.requestSkip()
    }
}

const buyArmed = ref(false)
let buyArmTimer: ReturnType<typeof setTimeout> | null = null

/** First press arms the button, the second one within 3s buys. */
function buyBonus() {
    sound.unlock()
    if (!canBuy.value) return
    if (!buyArmed.value) {
        buyArmed.value = true
        sound.play('click')
        if (buyArmTimer) clearTimeout(buyArmTimer)
        buyArmTimer = setTimeout(() => {
            buyArmed.value = false
        }, 3000)
        return
    }
    buyArmed.value = false
    if (buyArmTimer) clearTimeout(buyArmTimer)
    play(true)
}

function startAuto(count: number) {
    sound.unlock()
    autoSpinsLeft.value = count
    sound.play('toggle')
    if (!isPlaying.value && canSpin.value) play()
}

function toggleTurbo() {
    turbo.value = !turbo.value
    sound.play('toggle')
}

function toggleSound() {
    soundEnabled.value = !soundEnabled.value
    if (soundEnabled.value) {
        sound.unlock()
        sound.startAmbience()
        sound.play('click')
    }
}

function onKeydown(e: KeyboardEvent) {
    if (e.code !== 'Space' || e.repeat) return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
    if (showInfo.value || showAuto.value) return
    e.preventDefault()
    // A focused control button would also fire its own click on keyup.
    if (target?.tagName === 'BUTTON') target.blur()
    spinPressed()
}

function onFirstGesture() {
    sound.unlock()
    sound.startAmbience()
}

watch(turbo, (value) => {
    try {
        localStorage.setItem('fireinthehole-turbo', String(value))
    } catch { /* storage blocked */ }
})

watch(isPlaying, (playing) => {
    if (!playing && !message.value) setMessage(IDLE_MESSAGES[0]!)
})

onMounted(() => {
    try {
        turbo.value = localStorage.getItem('fireinthehole-turbo') === 'true'
    } catch { /* storage blocked */ }
    setMessage(IDLE_MESSAGES[0]!)
    idleTimer = setInterval(() => {
        if (isPlaying.value) return
        idleIndex = (idleIndex + 1) % IDLE_MESSAGES.length
        setMessage(IDLE_MESSAGES[idleIndex]!)
    }, 6000)
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('pointerdown', onFirstGesture, { once: true })
    window.addEventListener('keydown', onFirstGesture, { once: true })
    sound.startAmbience()
    initPixi()
})

onBeforeUnmount(() => {
    destroyed = true
    autoSpinsLeft.value = 0
    if (idleTimer) clearInterval(idleTimer)
    if (buyArmTimer) clearTimeout(buyArmTimer)
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('pointerdown', onFirstGesture)
    window.removeEventListener('keydown', onFirstGesture)
    sound.stopAmbience()
    sound.stopEffects()
    resizeObserver?.disconnect()
    boundaryTween?.kill()
    anticipationTween?.kill()
    safeDestroy(() => fx?.destroy())
    safeDestroy(() => reelSet?.destroy())
    safeDestroy(() => pixiApp?.destroy(true, { children: true }))
    safeDestroy(() => glowTexture?.destroy(true))
    for (const tex of Object.values(TEX)) safeDestroy(() => tex?.destroy())
    fx = null
    reelSet = null
    pixiApp = null
    world = null
    socketLayer = null
    lockLayer = null
    lockLabel = null
    glowLayer = null
    anticipationLayer = null
    bonusValueLayer = null
    popupLayer = null
    glowTexture = null
})
</script>

<template>
  <div class="fith-root">
    <div class="fith-bg" />
    <div class="fith-vignette" />
    <div
      class="fith-embers"
      aria-hidden="true"
    >
      <span
        v-for="(e, i) in embers"
        :key="i"
        :style="{ 'left': `${e.left}%`, 'width': `${e.size}px`, 'height': `${e.size}px`, 'animationDelay': `-${e.delay}s`, 'animationDuration': `${e.duration}s`, '--drift': `${e.drift}px` }"
      />
    </div>

    <div class="fith-stage">
      <header class="fith-marquee">
        <div class="fith-sign">
          <span class="fith-sign-chain left" />
          <span class="fith-sign-chain right" />
          <h1>
            <span class="fire">Fire</span>
            <span class="small">in the</span>
            <span class="hole">Hole</span>
          </h1>
        </div>
      </header>

      <div
        ref="cabinet"
        class="fith-cabinet"
        :class="{ 'is-bonus': isBonus, 'is-shaking': cabinetShake }"
      >
        <aside class="fith-rail fith-rail-left">
          <button
            class="fith-buy"
            :class="{ armed: buyArmed }"
            data-fith="buy"
            :disabled="!canBuy"
            @click="buyBonus"
          >
            <span class="fith-buy-art">
              <FithSymbolIcon
                symbol="scatter"
                :size="58"
              />
            </span>
            <span class="fith-buy-title">Buy free spins</span>
            <span class="fith-buy-cost">{{ formatNumber(buyCost) }}</span>
            <span class="fith-buy-note">{{ buyArmed ? 'Tap again to buy' : `${FITH_BUY_BONUS_COST}x bet · ${FITH_FREE_SPINS} spins` }}</span>
          </button>

          <div class="fith-plate">
            <p class="fith-plate-title">
              Depth
            </p>
            <ol class="fith-depth">
              <li
                v-for="r in FITH_MAX_LINES"
                :key="r"
                :class="{ open: r <= activeLines, fresh: r > FITH_STARTING_LINES && r <= activeLines }"
              >
                <span class="lamp" />
                <span class="row-label">Row {{ r }}</span>
                <UIcon
                  v-if="r > activeLines"
                  name="i-lucide-lock"
                  class="size-3.5 lock"
                />
              </li>
            </ol>
          </div>
        </aside>

        <div class="fith-frame">
          <div class="fith-beam fith-beam-top">
            <div class="fith-plaque">
              <template v-if="isBonus">
                <span class="k">Free spin</span>
                <b>{{ bonusSpin }}<small>/{{ FITH_FREE_SPINS }}</small></b>
                <span class="sep" />
                <span class="k">Total</span>
                <b class="gold">{{ formatMult(bonusTotal) }}</b>
              </template>
              <template v-else>
                <span class="k">Rows open</span>
                <b>{{ activeLines }}<small>/{{ FITH_MAX_LINES }}</small></b>
              </template>
            </div>
          </div>
          <span class="fith-post left" />
          <span class="fith-post right" />
          <span class="fith-lamp left" />
          <span class="fith-lamp right" />

          <div
            class="fith-window"
            @click="isPlaying && slam()"
          >
            <div
              ref="canvasHost"
              class="fith-canvas-host"
            />
            <div
              v-if="!isReady"
              class="fith-loading"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-10 animate-spin"
              />
            </div>
            <FithBonusBanner ref="bonusBanner" />
            <FithWinOverlay
              ref="winOverlay"
              :turbo="turbo"
              @tier="onTier"
            />
          </div>
          <div class="fith-beam fith-beam-bottom" />
        </div>

        <aside class="fith-rail fith-rail-right">
          <div class="fith-plate">
            <p class="fith-plate-title">
              Cascade multiplier
            </p>
            <ol class="fith-chain">
              <li
                v-for="(m, i) in chainLadder"
                :key="i"
                :class="{ lit: i <= chainIndex, current: i === chainIndex }"
              >
                x{{ m.toFixed(2) }}
              </li>
            </ol>
          </div>
          <div class="fith-plate">
            <p class="fith-plate-title">
              Last spins
            </p>
            <ul
              v-if="history.length"
              class="fith-history"
            >
              <li
                v-for="(h, i) in history.slice(0, 6)"
                :key="i"
                :class="{ win: h.payout > 0, bonus: h.bonus }"
              >
                <UIcon
                  :name="h.bonus ? 'i-lucide-flame' : 'i-lucide-pickaxe'"
                  class="size-3.5"
                />
                <span>{{ h.payout > 0 ? formatNumber(h.payout) : 'No win' }}</span>
              </li>
            </ul>
            <p
              v-else
              class="fith-empty"
            >
              Your spins show up here
            </p>
          </div>
        </aside>
      </div>

      <div
        class="fith-ticker"
        :class="{ error: errorMsg }"
      >
        <span
          :key="errorMsg || message"
          class="fith-ticker-text"
        >{{ errorMsg || message }}</span>
      </div>

      <div class="fith-deck">
        <div class="fith-meter fith-meter-balance">
          <span class="fith-meter-label">Balance</span>
          <span class="fith-meter-value">{{ formatNumber(balance) }}</span>
        </div>

        <div class="fith-bet">
          <span class="fith-meter-label">Bet</span>
          <div class="fith-bet-row">
            <button
              class="fith-round-btn"
              aria-label="Lower bet"
              :disabled="betLocked || bet <= MIN_BET"
              @click="betStep(-1)"
            >
              <UIcon
                name="i-lucide-minus"
                class="size-5"
              />
            </button>
            <label class="fith-bet-value">
              <input
                v-model="betText"
                inputmode="decimal"
                aria-label="Bet amount"
                :disabled="betLocked"
                @blur="commitBet"
                @keydown.enter="($event.target as HTMLInputElement).blur()"
              >
              <output v-if="amountPreview(betText, true)">{{ amountPreview(betText, true) }}</output>
            </label>
            <button
              class="fith-round-btn"
              aria-label="Raise bet"
              :disabled="betLocked || bet >= MAX_BET"
              @click="betStep(1)"
            >
              <UIcon
                name="i-lucide-plus"
                class="size-5"
              />
            </button>
          </div>
          <button
            class="fith-max"
            :disabled="betLocked"
            @click="maxBet"
          >
            Max bet
          </button>
        </div>

        <div
          class="fith-meter fith-meter-win"
          :class="{ active: winMeter > 0 }"
          :data-fith-lastwin="isPlaying ? 0 : winMeter"
        >
          <span class="fith-meter-label">{{ isBonus ? 'Bonus win' : 'Win' }}</span>
          <span
            :key="winFlash"
            class="fith-meter-value"
          >{{ formatNumber(winMeter) }}</span>
        </div>

        <div class="fith-spin-wrap">
          <button
            class="fith-spin"
            :class="{ spinning: isPlaying, auto: isAuto }"
            :disabled="!isAuto && !isPlaying && !canSpin"
            :data-fith-spinning="isPlaying"
            :aria-label="isAuto ? 'Stop auto spin' : 'Spin'"
            @click="spinPressed"
          >
            <span class="fith-spin-ring" />
            <span
              v-if="isAuto"
              class="fith-spin-label"
            >
              <b>{{ autoSpinsLeft }}</b>
              <small>Stop</small>
            </span>
            <UIcon
              v-else
              name="i-lucide-rotate-cw"
              class="fith-spin-icon"
            />
          </button>
        </div>

        <div class="fith-tools">
          <button
            class="fith-tool"
            data-fith="auto"
            :class="{ on: isAuto }"
            :disabled="!isAuto && (isPlaying || !canSpin)"
            @click="isAuto ? (autoSpinsLeft = 0) : (showAuto = true, sound.play('click'))"
          >
            <UIcon
              name="i-lucide-repeat"
              class="size-4"
            />
            <span>Auto</span>
          </button>
          <button
            class="fith-tool"
            data-fith="turbo"
            :class="{ on: turbo }"
            :aria-pressed="turbo"
            @click="toggleTurbo"
          >
            <UIcon
              name="i-lucide-zap"
              class="size-4"
            />
            <span>Turbo</span>
          </button>
          <button
            class="fith-tool"
            data-fith="info"
            @click="showInfo = true; sound.play('click')"
          >
            <UIcon
              name="i-lucide-book-open"
              class="size-4"
            />
            <span>Rules</span>
          </button>
          <div class="fith-sound">
            <button
              class="fith-tool"
              :class="{ on: soundEnabled }"
              :aria-label="soundEnabled ? 'Sound settings' : 'Sound off'"
              @click="showSound = !showSound"
            >
              <UIcon
                :name="!soundEnabled || soundVolume === 0 ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
                class="size-4"
              />
              <span>Sound</span>
            </button>
            <Transition name="fith-tick">
              <div
                v-if="showSound"
                class="fith-sound-pop"
              >
                <button
                  class="fith-sound-toggle"
                  @click="toggleSound"
                >
                  {{ soundEnabled ? 'Mute' : 'Unmute' }}
                </button>
                <input
                  v-model.number="soundVolume"
                  type="range"
                  min="0"
                  max="100"
                  aria-label="Volume"
                  :disabled="!soundEnabled"
                >
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </div>

    <FithInfoPanel
      v-model:open="showInfo"
      :bet="bet"
    />
    <FithAutoSpinModal
      v-model:open="showAuto"
      v-model:stop-on-bonus="autoStopOnBonus"
      :bet="bet"
      :balance="balance"
      @pick="startAuto"
    />
  </div>
</template>

<style scoped>
.fith-root {
  --wood-1: #7a4a22;
  --wood-2: #5a3417;
  --wood-3: #3a200c;
  --gold-1: #fff3b0;
  --gold-2: #ffc83d;
  --gold-3: #c2740c;
  --ember: #ff8a2a;
  --ink: #140b05;
  position: relative;
  min-height: 100%;
  overflow: hidden;
  background: #0b0604;
  color: #f1e3cb;
  isolation: isolate;
}

.fith-bg {
  position: absolute;
  inset: 0;
  z-index: -3;
  background: url('/slots/fireinthehole/background.png') center 40% / cover no-repeat;
  filter: saturate(1.1);
}

.fith-vignette {
  position: absolute;
  inset: 0;
  z-index: -2;
  background:
    radial-gradient(ellipse 60% 55% at 50% 45%, rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.72) 75%, rgba(0, 0, 0, 0.92)),
    linear-gradient(180deg, rgba(0, 0, 0, 0.55), transparent 22%, transparent 70%, rgba(0, 0, 0, 0.8));
}

.fith-embers {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
}

.fith-embers span {
  position: absolute;
  bottom: -10px;
  border-radius: 999px;
  background: #ffb347;
  box-shadow: 0 0 8px 2px rgba(255, 140, 40, 0.8);
  animation: fith-ember-rise linear infinite;
  opacity: 0;
}

@keyframes fith-ember-rise {
  0% {
    transform: translate(0, 0);
    opacity: 0;
  }
  10% {
    opacity: 0.9;
  }
  80% {
    opacity: 0.5;
  }
  100% {
    transform: translate(var(--drift), -105vh);
    opacity: 0;
  }
}

.fith-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 1240px;
  margin: 0 auto;
  padding: 14px 16px 22px;
}

/* Marquee sign */

.fith-marquee {
  display: flex;
  justify-content: center;
  width: 100%;
}

.fith-sign {
  position: relative;
  padding: 8px 34px 10px;
  border: 3px solid #2a1607;
  border-radius: 10px;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.12) 0 2px, transparent 2px 38px),
    repeating-linear-gradient(0deg, rgba(255, 220, 170, 0.05) 0 1px, transparent 1px 6px),
    linear-gradient(180deg, #8a5629, #5e3517 60%, #472610);
  box-shadow: inset 0 2px 0 rgba(255, 210, 150, 0.35), inset 0 -3px 0 rgba(0, 0, 0, 0.4), 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 60px rgba(255, 120, 30, 0.18);
}

.fith-sign::before,
.fith-sign::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-top: -5px;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 35%, #e8e8e8, #6b6b6b);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

.fith-sign::before {
  left: 12px;
}

.fith-sign::after {
  right: 12px;
}

.fith-sign-chain {
  position: absolute;
  bottom: 100%;
  width: 4px;
  height: 20px;
  background: repeating-linear-gradient(180deg, #8d8d8d 0 5px, #4b4b4b 5px 7px);
}

.fith-sign-chain.left {
  left: 22%;
}

.fith-sign-chain.right {
  right: 22%;
}

.fith-sign h1 {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0;
  font-family: 'Rye', Georgia, serif;
  font-weight: 400;
  line-height: 1;
  white-space: nowrap;
}

.fith-sign h1 .fire,
.fith-sign h1 .hole {
  font-size: clamp(30px, 4.4vw, 50px);
  background: linear-gradient(180deg, #fff6c9 8%, #ffc238 48%, #e2530f 88%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 3px 0 #2a0f02) drop-shadow(0 0 14px rgba(255, 120, 30, 0.55));
}

.fith-sign h1 .small {
  font-size: clamp(14px, 1.8vw, 20px);
  color: #f5d7a1;
  text-shadow: 0 2px 0 #2a0f02;
}

/* Cabinet */

.fith-cabinet {
  display: grid;
  grid-template-columns: 190px auto 190px;
  align-items: center;
  gap: 18px;
  width: 100%;
  justify-content: center;
}

.fith-cabinet.is-shaking .fith-frame {
  animation: fith-cabinet-shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97);
}

@keyframes fith-cabinet-shake {
  10%,
  90% {
    transform: translate(-1px, 1px);
  }
  20%,
  80% {
    transform: translate(3px, -2px);
  }
  30%,
  50%,
  70% {
    transform: translate(-4px, 2px);
  }
  40%,
  60% {
    transform: translate(4px, -1px);
  }
}

.fith-frame {
  position: relative;
  padding: 34px 26px 22px;
  border-radius: 10px;
  background:
    repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.14) 0 2px, transparent 2px 9px),
    linear-gradient(90deg, var(--wood-3), var(--wood-2) 8%, var(--wood-1) 50%, var(--wood-2) 92%, var(--wood-3));
  box-shadow: inset 0 0 0 3px #231105, inset 0 0 30px rgba(0, 0, 0, 0.6), 0 24px 60px rgba(0, 0, 0, 0.75), 0 0 80px rgba(255, 110, 20, 0.15);
  transition: box-shadow 400ms ease;
}

.is-bonus .fith-frame {
  box-shadow: inset 0 0 0 3px #231105, inset 0 0 30px rgba(0, 0, 0, 0.6), 0 24px 60px rgba(0, 0, 0, 0.75), 0 0 110px rgba(255, 150, 30, 0.45);
}

.fith-beam {
  position: absolute;
  left: -14px;
  right: -14px;
  z-index: 2;
  border-radius: 6px;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.16) 0 2px, transparent 2px 13px, rgba(255, 220, 170, 0.05) 13px 14px, transparent 14px 29px),
    linear-gradient(180deg, #96602f, #6b3f1b 55%, #4a2a10);
  box-shadow: inset 0 2px 0 rgba(255, 210, 150, 0.35), inset 0 -3px 0 rgba(0, 0, 0, 0.45), 0 6px 16px rgba(0, 0, 0, 0.6);
}

.fith-beam-top {
  top: -8px;
  height: 36px;
  display: flex;
  justify-content: center;
}

.fith-beam-bottom {
  bottom: -6px;
  height: 22px;
}

.fith-beam::before,
.fith-beam::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-top: -5px;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 35%, #e8e8e8, #5f5f5f);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
}

.fith-beam::before {
  left: 10px;
}

.fith-beam::after {
  right: 10px;
}

.fith-plaque {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  margin-top: 3px;
  padding: 0 16px;
  border: 2px solid #a8762c;
  border-radius: 6px;
  background: linear-gradient(180deg, #2a1809, #150b04);
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.8), 0 0 14px rgba(255, 160, 40, 0.2);
  font-size: 12px;
  white-space: nowrap;
}

.fith-plaque .k {
  color: #b99a6d;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 10.5px;
}

.fith-plaque b {
  font-family: 'Alfa Slab One', Georgia, serif;
  font-weight: 400;
  font-size: 16px;
  color: #fff0c8;
}

.fith-plaque b small {
  font-size: 11px;
  color: #b99a6d;
}

.fith-plaque b.gold {
  color: var(--gold-2);
  text-shadow: 0 0 10px rgba(255, 180, 50, 0.6);
}

.fith-plaque .sep {
  width: 1px;
  height: 16px;
  background: rgba(255, 200, 120, 0.25);
}

.fith-post {
  position: absolute;
  top: 18px;
  bottom: 6px;
  width: 22px;
  border-radius: 4px;
  background:
    repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.18) 0 2px, transparent 2px 11px),
    linear-gradient(90deg, #4a2a10, #8a5629 45%, #5a3417);
  box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.35), 0 4px 12px rgba(0, 0, 0, 0.5);
}

.fith-post.left {
  left: 2px;
}

.fith-post.right {
  right: 2px;
}

.fith-lamp {
  position: absolute;
  top: 40px;
  z-index: 3;
  width: 16px;
  height: 22px;
  border-radius: 6px 6px 8px 8px;
  background: radial-gradient(circle at 50% 60%, #fff4c0, #ffb238 45%, #a64b0b);
  box-shadow: 0 0 18px 6px rgba(255, 160, 40, 0.55), 0 0 60px 18px rgba(255, 120, 20, 0.25);
  animation: fith-flicker 3.2s infinite;
}

.fith-lamp::before {
  content: '';
  position: absolute;
  left: 50%;
  top: -8px;
  width: 10px;
  height: 8px;
  margin-left: -5px;
  border: 2px solid #3a3a3a;
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
}

.fith-lamp.left {
  left: 5px;
}

.fith-lamp.right {
  right: 5px;
  animation-delay: -1.3s;
}

@keyframes fith-flicker {
  0%,
  100% {
    opacity: 1;
  }
  42% {
    opacity: 0.92;
  }
  44% {
    opacity: 0.7;
  }
  46% {
    opacity: 1;
  }
  73% {
    opacity: 0.85;
  }
}

.fith-window {
  position: relative;
  overflow: hidden;
  width: min(calc(100vw - 32px - 52px), max(300px, calc(100dvh - 350px)), 700px);
  aspect-ratio: 1;
  border-radius: 8px;
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255, 140, 40, 0.12), transparent 70%),
    radial-gradient(ellipse 70% 70% at 50% 50%, #1f150e, #0d0805);
  box-shadow: inset 0 0 0 2px #1a0d04, inset 0 0 40px rgba(0, 0, 0, 0.9), 0 0 0 4px #2a1607, 0 0 0 5px rgba(255, 190, 110, 0.25);
}

.is-bonus .fith-window {
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255, 170, 50, 0.24), transparent 70%),
    radial-gradient(ellipse 70% 70% at 50% 50%, #2a1a0c, #110a05);
}

.fith-canvas-host {
  position: absolute;
  inset: 0;
}

.fith-canvas-host :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.fith-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--gold-2);
}

/* Rails */

.fith-rail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.fith-plate {
  padding: 12px 12px 14px;
  border: 2px solid #5a3417;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(34, 21, 11, 0.94), rgba(18, 10, 5, 0.94));
  box-shadow: inset 0 1px 0 rgba(255, 210, 150, 0.12), 0 12px 30px rgba(0, 0, 0, 0.55);
}

.fith-plate-title {
  margin: 0 0 8px;
  font-family: 'Rye', Georgia, serif;
  font-size: 14px;
  color: #ffc857;
  text-align: center;
  text-shadow: 0 2px 0 #2a0f02;
}

.fith-depth {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fith-depth li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  color: #7d6a55;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition: color 300ms ease, background 300ms ease;
}

.fith-depth li.open {
  color: #f6e2bf;
  background: rgba(255, 150, 40, 0.08);
}

.fith-depth li.fresh {
  background: rgba(255, 150, 40, 0.2);
}

.fith-depth .lamp {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #2a1d12;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.8);
  transition: background 300ms ease, box-shadow 300ms ease;
}

.fith-depth li.open .lamp {
  background: radial-gradient(circle at 35% 35%, #fff4c0, #ffb238 60%, #c2560c);
  box-shadow: 0 0 8px 2px rgba(255, 170, 50, 0.7);
}

.fith-depth .lock {
  margin-left: auto;
  color: #6b5a47;
}

.fith-buy {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 10px 12px;
  border: 2px solid #b37a2c;
  border-radius: 12px;
  background:
    radial-gradient(ellipse 80% 60% at 50% 20%, rgba(255, 170, 50, 0.3), transparent 70%),
    linear-gradient(180deg, #7a1d10, #4a0f07);
  box-shadow: inset 0 1px 0 rgba(255, 220, 170, 0.3), 0 0 0 3px #2a0f05, 0 14px 34px rgba(0, 0, 0, 0.6), 0 0 30px rgba(255, 90, 30, 0.25);
  transition: transform 150ms ease, box-shadow 150ms ease, filter 150ms ease;
}

.fith-buy:not(:disabled):hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow: inset 0 1px 0 rgba(255, 220, 170, 0.3), 0 0 0 3px #2a0f05, 0 18px 40px rgba(0, 0, 0, 0.6), 0 0 44px rgba(255, 120, 30, 0.5);
}

.fith-buy.armed {
  border-color: #ffd66b;
  animation: fith-armed 0.7s ease-in-out infinite;
}

.fith-buy.armed .fith-buy-note {
  color: #fff4d6;
}

@keyframes fith-armed {
  50% {
    box-shadow: inset 0 1px 0 rgba(255, 220, 170, 0.3), 0 0 0 3px #2a0f05, 0 14px 34px rgba(0, 0, 0, 0.6), 0 0 50px rgba(255, 170, 50, 0.7);
  }
}

.fith-buy:disabled {
  filter: grayscale(0.7) brightness(0.7);
  cursor: not-allowed;
}

.fith-buy-art {
  filter: drop-shadow(0 0 12px rgba(255, 180, 60, 0.7));
}

.fith-buy-title {
  margin-top: 4px;
  font-family: 'Rye', Georgia, serif;
  font-size: 16px;
  color: #ffe2a0;
  text-shadow: 0 2px 0 #2a0602;
}

.fith-buy-cost {
  margin-top: 2px;
  font-family: 'Alfa Slab One', Georgia, serif;
  font-size: 24px;
  color: #fff4d6;
  text-shadow: 0 2px 0 #2a0602, 0 0 14px rgba(255, 180, 60, 0.6);
}

.fith-buy-note {
  color: #f0b98a;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fith-chain {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fith-chain li {
  padding: 5px 0;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.4);
  color: #6f5d49;
  font-family: 'Alfa Slab One', Georgia, serif;
  font-size: 13px;
  text-align: center;
  transition: all 250ms ease;
}

.fith-chain li.lit {
  background: linear-gradient(180deg, rgba(255, 190, 70, 0.35), rgba(200, 90, 10, 0.3));
  color: #ffe9b8;
}

.fith-chain li.current {
  background: linear-gradient(180deg, #ffd66b, #e0780f);
  color: #2b1405;
  box-shadow: 0 0 16px rgba(255, 170, 50, 0.8);
  transform: scale(1.06);
}

.fith-history {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fith-history li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  color: #8a7660;
  font-size: 13px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.fith-history li.win {
  color: #ffe2a0;
}

.fith-history li.bonus {
  background: rgba(255, 120, 30, 0.16);
}

.fith-empty {
  margin: 0;
  color: #7d6a55;
  font-size: 12px;
  text-align: center;
}

/* Ticker */

.fith-ticker {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: min(560px, 100%);
  height: 34px;
  padding: 0 18px;
  border: 1px solid rgba(255, 180, 80, 0.25);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(10, 5, 2, 0.9), rgba(30, 16, 6, 0.9));
  box-shadow: inset 0 0 14px rgba(0, 0, 0, 0.8);
  color: #ffd98a;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: center;
  text-shadow: 0 0 10px rgba(255, 170, 50, 0.5);
}

.fith-ticker-text {
  animation: fith-ticker-in 220ms ease both;
}

@keyframes fith-ticker-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

.fith-ticker.error {
  color: #ff9a8a;
}

.fith-tick-enter-active,
.fith-tick-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.fith-tick-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.fith-tick-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* Control deck */

.fith-deck {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) auto minmax(170px, 1.2fr) auto auto;
  grid-template-areas: 'balance bet win spin tools';
  align-items: center;
  gap: 16px;
  width: min(1120px, 100%);
  padding: 12px 18px;
  border: 2px solid #5a3417;
  border-radius: 18px;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.1) 0 2px, transparent 2px 40px),
    linear-gradient(180deg, #3a2211, #1f1108 60%, #150b05);
  box-shadow: inset 0 2px 0 rgba(255, 210, 150, 0.18), 0 18px 40px rgba(0, 0, 0, 0.7);
}

.fith-meter {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  height: 62px;
  padding: 0 14px;
  border: 2px solid #120904;
  border-radius: 10px;
  background: linear-gradient(180deg, #070403, #1a0f07);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 210, 150, 0.15);
}

.fith-meter-balance {
  grid-area: balance;
}

.fith-meter-win {
  grid-area: win;
  align-items: center;
}

.fith-meter-label {
  color: #a48462;
  font-size: 10.5px;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.fith-meter-value {
  overflow: hidden;
  font-family: 'Alfa Slab One', Georgia, serif;
  font-size: 22px;
  line-height: 1.2;
  color: #f7e6c6;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fith-meter-win .fith-meter-value {
  font-size: 28px;
  color: #6f5d49;
}

.fith-meter-win.active .fith-meter-value {
  color: var(--gold-2);
  text-shadow: 0 0 16px rgba(255, 170, 50, 0.7);
  animation: fith-win-pop 0.35s ease;
}

.fith-meter-win.active {
  border-color: #6b3a10;
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.9), 0 0 22px rgba(255, 150, 40, 0.3);
}

@keyframes fith-win-pop {
  0% {
    transform: scale(1.18);
  }
  100% {
    transform: scale(1);
  }
}

.fith-bet {
  grid-area: bet;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.fith-bet-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fith-round-btn {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: radial-gradient(circle at 40% 30%, #ffe08a, #d98b1a 55%, #8a4a08);
  color: #2b1405;
  box-shadow: 0 3px 0 #4a2505, 0 6px 12px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  transition: transform 100ms ease, filter 100ms ease;
}

.fith-round-btn:not(:disabled):hover {
  filter: brightness(1.1);
}

.fith-round-btn:not(:disabled):active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #4a2505, 0 3px 8px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.fith-round-btn:disabled,
.fith-max:disabled,
.fith-tool:disabled {
  filter: grayscale(0.8) brightness(0.6);
  cursor: not-allowed;
}

.fith-bet-value {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 118px;
  padding: 4px 6px;
  border: 2px solid #120904;
  border-radius: 8px;
  background: linear-gradient(180deg, #070403, #1a0f07);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.9);
}

.fith-bet-value input {
  width: 100%;
  border: 0;
  background: transparent;
  color: #fff0c8;
  font-family: 'Alfa Slab One', Georgia, serif;
  font-size: 20px;
  text-align: center;
  outline: none;
}

.fith-bet-value output {
  color: #a48462;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.fith-max {
  padding: 2px 12px;
  border: 1px solid rgba(255, 190, 90, 0.35);
  border-radius: 999px;
  background: rgba(255, 150, 40, 0.1);
  color: #ffcf7a;
  font-size: 10.5px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.fith-max:not(:disabled):hover {
  background: rgba(255, 150, 40, 0.22);
}

.fith-spin-wrap {
  grid-area: spin;
  display: flex;
  justify-content: center;
}

.fith-spin {
  position: relative;
  display: grid;
  place-items: center;
  width: 96px;
  height: 96px;
  margin: -24px 0;
  border-radius: 999px;
  background: radial-gradient(circle at 42% 32%, #ff9a5a, #e2361a 45%, #8c1206 80%);
  color: #fff4e0;
  box-shadow: 0 0 0 5px #2a0f05, 0 0 0 8px #b37a2c, 0 0 0 10px #2a0f05, 0 10px 0 6px #1a0602, 0 18px 40px rgba(0, 0, 0, 0.7), 0 0 40px rgba(255, 90, 30, 0.45), inset 0 3px 0 rgba(255, 255, 255, 0.35), inset 0 -6px 14px rgba(0, 0, 0, 0.4);
  transition: transform 110ms ease, filter 150ms ease;
}

.fith-spin:not(:disabled):hover {
  filter: brightness(1.1);
  transform: scale(1.03);
}

.fith-spin:not(:disabled):active {
  transform: scale(0.96) translateY(3px);
}

.fith-spin:disabled {
  filter: grayscale(0.6) brightness(0.6);
  cursor: not-allowed;
}

.fith-spin-ring {
  position: absolute;
  inset: 8px;
  border: 2px dashed rgba(255, 230, 190, 0.35);
  border-radius: 999px;
}

.fith-spin.spinning .fith-spin-ring {
  animation: fith-spin-rot 0.9s linear infinite;
}

.fith-spin-icon {
  width: 44px;
  height: 44px;
  filter: drop-shadow(0 2px 0 rgba(60, 10, 0, 0.8));
  transition: transform 300ms ease;
}

.fith-spin.spinning .fith-spin-icon {
  animation: fith-spin-rot 0.6s linear infinite;
}

.fith-spin-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
}

.fith-spin-label b {
  font-family: 'Alfa Slab One', Georgia, serif;
  font-weight: 400;
  font-size: 28px;
}

.fith-spin-label small {
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

@keyframes fith-spin-rot {
  to {
    transform: rotate(360deg);
  }
}

.fith-tools {
  grid-area: tools;
  display: flex;
  gap: 6px;
}

.fith-tool {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 52px;
  padding: 7px 0 5px;
  border: 1px solid rgba(255, 190, 90, 0.2);
  border-radius: 10px;
  background: linear-gradient(180deg, #2c1a0d, #170c05);
  color: #cdb08a;
  font-size: 9.5px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  transition: all 140ms ease;
}

.fith-tool:not(:disabled):hover {
  border-color: rgba(255, 190, 90, 0.5);
  color: #ffe2a0;
}

.fith-tool.on {
  border-color: #ffb238;
  background: linear-gradient(180deg, #5a3208, #2c1604);
  color: #ffd66b;
  box-shadow: 0 0 14px rgba(255, 170, 50, 0.35);
}

.fith-sound {
  position: relative;
}

.fith-sound-pop {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 170px;
  padding: 12px;
  border: 2px solid #5a3417;
  border-radius: 10px;
  background: #1c1008;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.7);
}

.fith-sound-toggle {
  padding: 6px;
  border-radius: 6px;
  background: rgba(255, 150, 40, 0.14);
  color: #ffd66b;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fith-sound-pop input[type='range'] {
  accent-color: #ffb238;
}

/* Responsive */

@media (max-width: 1180px) {
  .fith-cabinet {
    display: contents;
  }

  .fith-marquee {
    order: 1;
  }

  .fith-frame {
    order: 2;
  }

  .fith-ticker {
    order: 3;
  }

  .fith-deck {
    order: 4;
  }

  .fith-rail {
    flex-direction: row;
    justify-content: center;
    width: min(700px, 100%);
  }

  .fith-rail-left {
    order: 5;
  }

  .fith-rail-right {
    order: 6;
  }

  .fith-rail .fith-plate,
  .fith-buy {
    flex: 1;
  }

  .fith-depth {
    flex-direction: row;
  }

  .fith-depth .row-label {
    display: none;
  }

  .fith-depth li {
    flex: 1;
    justify-content: center;
    padding: 6px 0;
  }

  .fith-depth .lock {
    margin: 0;
  }

  .fith-chain {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (max-width: 760px) {
  .fith-stage {
    padding: 10px 10px 18px;
  }

  .fith-sign {
    padding: 6px 22px 8px;
  }

  .fith-frame {
    padding: 28px 14px 16px;
  }

  .fith-post,
  .fith-lamp {
    display: none;
  }

  .fith-window {
    width: min(calc(100vw - 20px - 28px), 700px);
  }

  .fith-deck {
    grid-template-columns: 1fr 1fr;
    grid-template-areas:
      'balance win'
      'bet spin'
      'tools tools';
    gap: 10px;
    padding: 12px;
  }

  .fith-spin {
    width: 84px;
    height: 84px;
    margin: 0;
  }

  .fith-tools {
    justify-content: space-between;
  }

  .fith-tool {
    flex: 1;
  }

  .fith-meter {
    height: 54px;
  }

  .fith-meter-win .fith-meter-value {
    font-size: 22px;
  }

  .fith-rail {
    flex-direction: column;
    align-items: stretch;
  }

  .fith-rail .fith-plate,
  .fith-buy {
    max-width: none;
  }

  .fith-buy {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    column-gap: 10px;
  }

  .fith-buy-art {
    display: none;
  }

  .fith-ticker {
    min-width: 0;
    width: 100%;
    font-size: 11px;
  }
}
</style>
