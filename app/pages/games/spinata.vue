<script lang="ts" setup>
import type { Cell, LineWin, SpinataResult, SpinSymbol, SpinPaySymbol } from '#shared/utils/gamelogic/spinata'
import {
    BONUS_PAY,
    PAY_KEYS,
    PAYTABLE,
    PINATA_POT_PRIZES,
    PINATA_POT_WEIGHTS,
    SCATTER_PAY,
    SYMBOL_WEIGHTS,
    SPN_BUY_BONUS_COST,
    SPN_COLS,
    SPN_FREE_SPINS,
    SPN_LINES,
    SPN_ROWS,
    SPN_SCATTER_TRIGGER,
    SPN_TRACK_CAP,
    SPN_TRACK_START,
    SPN_BONUS_TRIGGER,
    PAYLINES
} from '#shared/utils/gamelogic/spinata'

const { user, setBalance } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))
watch(() => user.value?.balance, (v) => {
    if (v != null) balance.value = parseFloat(v)
})

// --- bet ─────────────────────────────────────────────────────────────────────
const MIN_BET = 1
const MAX_BET = 1_000_000
const bet = ref(10)
const betInput = ref('10')

function clampBet(v: number): number {
    if (!Number.isFinite(v) || v < MIN_BET) return MIN_BET
    return Math.min(MAX_BET, Math.floor(v))
}

function setBet(v: number) {
    if (isSpinning.value || autoSpinEnabled.value) return
    bet.value = clampBet(v)
}

watch(bet, (v) => { betInput.value = String(v) }, { immediate: true })

function commitBetInput() {
    setBet(parseInt(betInput.value.replace(/[^\d]/g, ''), 10) || MIN_BET)
    betInput.value = String(bet.value)
}

function betDown() { setBet(Math.floor(bet.value / 2)) }
function betUp() { setBet(bet.value * 2) }

const buyBonusCost = computed(() => bet.value * SPN_BUY_BONUS_COST)

// --- round state ─────────────────────────────────────────────────────────────
const turbo = ref(false)
const isSpinning = ref(false)
const errorMsg = ref('')
const showHelp = ref(false)
const ready = ref(false)

const lastWin = ref(0)
const winFlash = ref(false)

// track (multiplier rail)
const trackLevel = ref(SPN_TRACK_START)
const trackPulse = ref(false)

// bonus HUD
const inBonus = ref(false)
const bonusBanner = ref(false)
const bonusSpinsLeft = ref(0)
const bonusTotal = ref(0)
const bonusStatus = ref('')
const pinataPot = ref(0)          // accumulated piñata pot during free spins
const pinataPotFlash = ref(false) // pulses when pot increases

// piñata bonus prize overlay
const bonusCelebrating = ref(false)
const lastBonusPrize = ref(0)

// big win popup
const bigWinAmount = ref(0)
const bigWinLabel = ref('')
const showBigWin = ref(false)

function triggerBigWin(amount: number, betAmt: number) {
    const mult = amount / betAmt
    bigWinLabel.value = mult >= 100 ? 'EPIC WIN' : mult >= 40 ? 'MEGA WIN' : 'BIG WIN'
    bigWinAmount.value = amount
    showBigWin.value = true
    playSfx(mult >= 40 ? 'sp_sfx_into_megawin_transition' : 'sp_sfx_into_bigwin_transition')
    setTimeout(() => { showBigWin.value = false }, 4000)
}

// scatter/bonus counters for this spin
const spinScatterCount = ref(0)
const spinBonusCount = ref(0)

const history = ref<{ payout: number, bet: number, bonus: boolean }[]>([])

const sessionWagered = ref(0)
const sessionReturned = ref(0)
const sessionNet = computed(() => sessionReturned.value - sessionWagered.value)
const sessionWinPct = computed(() => {
    if (sessionWagered.value === 0) return 50
    return Math.min(100, Math.max(0, (sessionReturned.value / sessionWagered.value) * 100))
})

// --- auto-spin ───────────────────────────────────────────────────────────────
const autoSpinEnabled = ref(false)
const autoSpinsLeft = ref(0)
const autoSpinPaused = ref(false)
const showAutoSpinModal = ref(false)
const AUTO_SPIN_OPTIONS = [25, 50, 100, 250, 500]

let _resumeAutoSpin: (() => void) | null = null

function startAutoSpin(count: number) {
    autoSpinsLeft.value = count
    autoSpinEnabled.value = true
    autoSpinPaused.value = false
    showAutoSpinModal.value = false
    if (!isSpinning.value) spin()
}

function stopAutoSpin() {
    autoSpinEnabled.value = false
    autoSpinsLeft.value = 0
    autoSpinPaused.value = false
    _resumeAutoSpin?.()
    _resumeAutoSpin = null
}

function onCanvasClick() {
    if (autoSpinPaused.value) {
        autoSpinPaused.value = false
        _resumeAutoSpin?.()
        _resumeAutoSpin = null
    }
}

// Binomial odds of landing SPN_SCATTER_TRIGGER+ scatters on one grid
const bonusOdds = (() => {
    const total = Object.values(SYMBOL_WEIGHTS).reduce((a, b) => a + b, 0)
    const p = SYMBOL_WEIGHTS.scatter / total
    const q = 1 - p
    const cells = SPN_COLS * SPN_ROWS
    const choose = (n: number, k: number) => {
        let r = 1
        for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1)
        return r
    }
    let pLess = 0
    for (let k = 0; k < SPN_SCATTER_TRIGGER; k++) pLess += choose(cells, k) * p ** k * q ** (cells - k)
    return (1 - pLess) > 0 ? Math.round(1 / (1 - pLess)) : 0
})()

// --- sounds ──────────────────────────────────────────────────────────────────
const SOUND_BASE = '/slots/spinata/sound'
const volume = ref(0.8)
let prevVolume = 0.8
let audioCtx: AudioContext | null = null
let masterGain: GainNode | null = null
const soundBuffers = new Map<string, Promise<AudioBuffer | null>>()
let currentMusicNode: AudioBufferSourceNode | null = null
let currentMusicName = 'sp_main_music'
let spinSoundNode: AudioBufferSourceNode | null = null

function ensureAudio(): AudioContext | null {
    if (volume.value === 0 || !import.meta.client) return null
    if (!audioCtx) {
        const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
        if (!Ctx) return null
        audioCtx = new Ctx()
        masterGain = audioCtx.createGain()
        masterGain.gain.value = volume.value
        masterGain.connect(audioCtx.destination)
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
    return audioCtx
}

function loadBuffer(name: string): Promise<AudioBuffer | null> {
    const c = audioCtx
    if (!c) return Promise.resolve(null)
    let pending = soundBuffers.get(name)
    if (!pending) {
        pending = (async () => {
            try {
                const res = await fetch(`${SOUND_BASE}/${name}.mp3`)
                const ab = await res.arrayBuffer()
                return await c.decodeAudioData(ab)
            } catch {
                soundBuffers.delete(name)
                return null
            }
        })()
        soundBuffers.set(name, pending)
    }
    return pending
}

function spawnBuffer(buf: AudioBuffer, loop = false): AudioBufferSourceNode | null {
    if (!audioCtx || !masterGain) return null
    const src = audioCtx.createBufferSource()
    src.buffer = buf
    src.loop = loop
    src.connect(masterGain)
    src.start()
    return src
}

async function playSfx(name: string) {
    const c = ensureAudio()
    if (!c || !masterGain) return
    const buf = await loadBuffer(name)
    if (buf) spawnBuffer(buf)
}

async function playMusic(name: string) {
    if (!import.meta.client) return
    const c = ensureAudio()
    if (!c || !masterGain) return
    currentMusicName = name
    try { currentMusicNode?.stop() } catch {}
    currentMusicNode = null
    const buf = await loadBuffer(name)
    if (!buf || !audioCtx || !masterGain) return
    currentMusicNode = spawnBuffer(buf, true)
}

function setVolume(v: number) {
    const wasZero = volume.value === 0
    volume.value = Math.max(0, Math.min(1, v))
    if (import.meta.client) localStorage.setItem('spn_volume', String(volume.value))
    if (masterGain) masterGain.gain.value = volume.value
    if (volume.value === 0) {
        stopSpinSound()
    } else if (wasZero && !currentMusicNode) {
        playMusic(currentMusicName)
    }
}

function toggleMute() {
    if (volume.value > 0) {
        prevVolume = volume.value
        setVolume(0)
    } else {
        setVolume(prevVolume || 0.8)
    }
}

async function startSpinSound() {
    const c = ensureAudio()
    if (!c || !masterGain) return
    try { spinSoundNode?.stop() } catch {}
    const buf = await loadBuffer('sp_sfx_reel_spin')
    if (!buf) return
    spinSoundNode = spawnBuffer(buf, true)
}

function stopSpinSound() {
    try { spinSoundNode?.stop() } catch {}
    spinSoundNode = null
}

function scheduleReelStops(grid: SpinSymbol[][]) {
    const delays = turbo.value ? [250, 330, 410, 490, 570] : [900, 1200, 1500, 1800, 2100]
    let scatterIdx = 0
    for (let i = 0; i < SPN_COLS; i++) {
        const hasScatter = grid[i]?.some(s => s === 'scatter')
        const sIdx = hasScatter ? ++scatterIdx : 0
        setTimeout(() => {
            if (hasScatter) playSfx(`sp_sfx_scatter_stop_${sIdx}`)
            else playSfx('sp_sfx_reel_stop')
        }, delays[i])
    }
}

const sfx = {
    scatter:     () => playSfx('sp_sfx_scatter_win'),
    bonus:       () => playSfx('sp_sfx_bonus_stop'),
    bonusSymbol: () => playSfx('sp_sfx_bonus_symbol'),
    wild:        () => playSfx('sp_sfx_wild'),
    win:         () => playSfx('sp_sfx_low_symbol_win'),
    bigWin:      () => playSfx('sp_sfx_into_bigwin_transition'),
    festival:    () => {
        playSfx('sp_sfx_free_spins_popup')
        playMusic('sp_free_spins_music')
    },
    pop:         () => playSfx('sp_sfx_particle_release'),
    meter:       () => playSfx('sp_sfx_meter_count'),
    click:       () => playSfx('sfx_generic_all_other_clicks'),
    notEnough:   () => playSfx('sfx_notEnoughCredits'),
}

onMounted(() => {
    if (import.meta.client) {
        const saved = localStorage.getItem('spn_volume')
        if (saved !== null) volume.value = Math.max(0, Math.min(1, parseFloat(saved)))
        if (volume.value > 0) playMusic('sp_main_music')
    }
})

// --- pixi ────────────────────────────────────────────────────────────────────
const canvasWrap = ref<HTMLDivElement>()
const medallionEl = ref<HTMLElement>()
let app: any = null
let reelSet: any = null
let PIXI: any = null
let GSAP: any = null
let REELS: any = null
let lineLayer: any = null    // win-line overlay
let floatLayer: any = null   // floating win text
let destroyed = false

const CELL = 120
const GAP = 8
const REEL_W = SPN_COLS * CELL + (SPN_COLS - 1) * GAP
const REEL_H = SPN_ROWS * CELL + (SPN_ROWS - 1) * GAP
const APP_W = REEL_W + 20
const APP_H = REEL_H + 20
const OFFSET_X = (APP_W - REEL_W) / 2
const OFFSET_Y = (APP_H - REEL_H) / 2

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

const SYMBOL_IDS: SpinSymbol[] = [...PAY_KEYS, 'wild', 'scatter', 'bonus']
const TEX: Record<string, any> = {}

const GLYPH: Record<SpinSymbol, string> = {
    ten: '10', jack: 'J', queen: 'Q', king: 'K', ace: 'A',
    maracas: '🪇', cactus: '🌵', sombrero: '👒', flower: '🌺',
    wild: '🌈', scatter: '🌟', bonus: '🪅'
}

const SYMBOL_LABEL: Record<SpinSymbol, string> = {
    ten: '10', jack: 'J', queen: 'Q', king: 'K', ace: 'A',
    maracas: 'Maracas', cactus: 'Cactus', sombrero: 'Sombrero', flower: 'Flower',
    wild: 'Wild', scatter: 'Scatter', bonus: 'Piñata'
}

const LETTER_FACE: Partial<Record<SpinSymbol, string>> = {
    ten: '#4caf2e', jack: '#3b82f6', queen: '#a855f7', king: '#f0921a', ace: '#e2392a'
}

function makeLetterTexture(text: string, face: string) {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    const r = size * 0.16, m = size * 0.08
    ctx.beginPath()
    ctx.roundRect(m, m, size - 2 * m, size - 2 * m, r)
    ctx.fillStyle = face; ctx.fill()
    ctx.lineWidth = size * 0.05; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke()
    ctx.font = `900 ${Math.floor(size * (text.length > 1 ? 0.5 : 0.62))}px system-ui, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineWidth = size * 0.045; ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.strokeText(text, size / 2, size / 2 + size * 0.02)
    ctx.fillStyle = '#fff'; ctx.fillText(text, size / 2, size / 2 + size * 0.02)
    return PIXI.Texture.from(canvas)
}

function makeEmojiTexture(emoji: string) {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.font = `${Math.floor(size * 0.78)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(emoji, size / 2, size / 2 + size * 0.04)
    return PIXI.Texture.from(canvas)
}

function fallbackTexture(id: SpinSymbol) {
    const face = LETTER_FACE[id]
    return face ? makeLetterTexture(GLYPH[id], face) : makeEmojiTexture(GLYPH[id])
}

async function loadTexture(id: SpinSymbol) {
    // 'bonus' reuses the donkey piñata PNG
    const file = id === 'bonus' ? 'pinata' : id
    try {
        return await PIXI.Assets.load({ src: `/slots/spinata/${file}.png`, loadParser: 'loadTextures' })
    } catch {
        return fallbackTexture(id)
    }
}

function makeSymbolClass() {
    const { Sprite } = PIXI
    const Base = REELS.ReelSymbol

    class SpinTile extends Base {
        sprite = new Sprite()
        w = CELL; h = CELL; _tween: any = null

        constructor() {
            super()
            this.sprite.anchor.set(0.5)
            this.view.addChild(this.sprite)
        }

        _render(id: string) {
            const t = TEX[id]
            if (!t) return
            this.sprite.texture = t
            const max = Math.min(this.w, this.h) * 0.88
            const s = Math.min(max / t.width, max / t.height)
            this.sprite.scale.set(s)
            this.sprite.x = this.w / 2
            this.sprite.y = this.h / 2
        }

        onActivate(id: string) { this.view.alpha = 1; this._render(id) }
        onDeactivate() { this._kill() }
        resize(w: number, h: number) { this.w = w; this.h = h; if (this.symbolId) this._render(this.symbolId) }
        stopAnimation() { this._kill(); this.view.scale.set(1, 1) }
        _kill() { if (this._tween) { this._tween.kill(); this._tween = null } this.view.scale.set(1, 1) }

        playWin() {
            this._kill()
            return new Promise<void>((res) => {
                this._tween = GSAP.to(this.view.scale, {
                    x: 1.2, y: 1.2, duration: 0.14, yoyo: true, repeat: 1, ease: 'sine.inOut', onComplete: res
                })
            })
        }
    }

    return SpinTile
}

// --- win line drawing ────────────────────────────────────────────────────────
// Red polylines connecting winning cell centres, drawn on a Pixi overlay.

function cellCenter(col: number, row: number) {
    return { x: col * (CELL + GAP) + CELL / 2, y: row * (CELL + GAP) + CELL / 2 }
}

const LINE_PALETTE = [
    0xffd700, 0x00e5ff, 0xff4d88, 0x66ff66, 0xff7c1f,
    0xc77dff, 0x00ffb0, 0xffec44, 0xff6b6b, 0x44cfff,
]

function drawWinLine(w: LineWin, idx: number) {
    if (!lineLayer || !PIXI || !GSAP) return
    const { Graphics } = PIXI
    const col = LINE_PALETTE[idx % LINE_PALETTE.length]!
    const glow = new Graphics()
    glow.setStrokeStyle({ width: 10, color: col, alpha: 0.22, cap: 'round', join: 'round' })
    const core = new Graphics()
    core.setStrokeStyle({ width: 3, color: col, alpha: 0.95, cap: 'round', join: 'round' })
    // draw the full 5-column payline path so overlapping wins look visually distinct
    const payline = PAYLINES[w.line]!
    for (let reelIdx = 0; reelIdx < SPN_COLS; reelIdx++) {
        const p = cellCenter(reelIdx, payline[reelIdx]!)
        if (reelIdx === 0) { glow.moveTo(p.x, p.y); core.moveTo(p.x, p.y) }
        else { glow.lineTo(p.x, p.y); core.lineTo(p.x, p.y) }
    }
    glow.stroke(); core.stroke()
    lineLayer.addChild(glow); lineLayer.addChild(core)
    GSAP.fromTo([glow, core], { alpha: 0 }, { alpha: 1, duration: 0.18, ease: 'power1.out' })
}

function clearWinLines() {
    if (!lineLayer) return
    try { lineLayer.removeChildren() } catch { /* ignore */ }
}

// --- floating win text ───────────────────────────────────────────────────────
function floatText(cx: number, cy: number, text: string, fill: number, stroke: number, size = 26) {
    if (!floatLayer || !PIXI || !GSAP) return
    const { Text } = PIXI
    const t = new Text({
        text, style: {
            fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: '900', fill, align: 'center',
            stroke: { color: stroke, width: 5, join: 'round' },
            dropShadow: { color: 0x000000, blur: 4, distance: 2, alpha: 0.5, angle: Math.PI / 2 }
        }
    })
    t.anchor.set(0.5)
    t.position.set(cx, cy)
    floatLayer.addChild(t)
    const dur = turbo.value ? 0.9 : 1.6
    GSAP.fromTo(t.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.28, ease: 'back.out(2.6)' })
    GSAP.to(t, { y: cy - 52, duration: dur, ease: 'power1.out' })
    GSAP.to(t, {
        alpha: 0, duration: dur * 0.38, delay: dur * 0.62, ease: 'power1.in', onComplete: () => {
            try { t.destroy() } catch { /* ignore */ }
        }
    })
}


// --- bonus fly animation ─────────────────────────────────────────────────────
// prizes[i] is the pot contribution for cell[i] (in coins, bet-denominated).
// Pass undefined/empty to fly without showing prizes (base-game piñatas).
async function flyBonusToMedallion(cells: Cell[], prizes?: number[]) {
    if (!import.meta.client || !canvasWrap.value || !medallionEl.value || !GSAP || cells.length === 0) return

    const canvasRect = canvasWrap.value.getBoundingClientRect()
    const medalRect = medallionEl.value.getBoundingClientRect()
    const medalCX = medalRect.left + medalRect.width / 2
    const medalCY = medalRect.top + medalRect.height / 2

    const scaleX = canvasRect.width / APP_W
    const scaleY = canvasRect.height / APP_H
    const dur = turbo.value ? 0.28 : 0.58

    const arrivals = cells.map((cell, i) => {
        const logicalX = OFFSET_X + cell.col * (CELL + GAP) + CELL / 2
        const logicalY = OFFSET_Y + cell.row * (CELL + GAP) + CELL / 2
        const startX = canvasRect.left + logicalX * scaleX
        const startY = canvasRect.top + logicalY * scaleY

        const el = document.createElement('div')
        Object.assign(el.style, {
            position: 'fixed',
            left: `${startX}px`,
            top: `${startY}px`,
            width: '64px',
            height: '64px',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: '9999',
        })
        const img = document.createElement('img')
        img.src = '/slots/spinata/pinata.png'
        img.style.cssText = 'width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 0 10px rgba(249,168,37,0.9))'
        el.appendChild(img)
        document.body.appendChild(el)

        const dx = medalCX - startX
        const dy = medalCY - startY
        const prize = prizes?.[i]

        return new Promise<void>(resolve => {
            GSAP.timeline({
                delay: i * (turbo.value ? 0.07 : 0.14),
                onComplete: () => {
                    el.remove()
                    spinBonusCount.value++
                    sfx.pop()
                    // If this piñata has a pot prize, add it and flash the pot display
                    if (prize !== undefined) {
                        pinataPot.value += prize
                        pinataPotFlash.value = true
                        setTimeout(() => { pinataPotFlash.value = false }, 400)
                    }
                    if (medallionEl.value) {
                        GSAP.fromTo(medallionEl.value,
                            { scale: 1.35 },
                            { scale: 1, duration: 0.22, ease: 'back.out(2.5)' }
                        )
                    }
                    resolve()
                }
            })
            .fromTo(el,
                { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
                {
                    x: dx, y: dy,
                    scale: 0.25,
                    rotation: (Math.random() > 0.5 ? 1 : -1) * (270 + Math.random() * 90),
                    opacity: 0.6,
                    duration: dur,
                    ease: 'power2.in'
                }
            )
        })
    })

    await Promise.all(arrivals)
}

// --- pixi bootstrap ──────────────────────────────────────────────────────────
onMounted(async () => {
    try {
        const [pixi, reels, gsapMod] = await Promise.all([
            import('pixi.js'), import('pixi-reels'), import('gsap')
        ])
        if (destroyed) return
        PIXI = pixi; REELS = reels; GSAP = gsapMod.gsap ?? gsapMod.default

        app = new PIXI.Application()
        await app.init({ width: APP_W, height: APP_H, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) })
        if (destroyed) { app.destroy(true); return }
        canvasWrap.value?.appendChild(app.canvas)

        await Promise.all(SYMBOL_IDS.map(async (id) => { TEX[id] = await loadTexture(id) }))
        if (destroyed) { app.destroy(true); return }

        const SpinTile = makeSymbolClass()
        const weights: Record<string, number> = {}
        for (const k of SYMBOL_IDS) weights[k] = SYMBOL_WEIGHTS[k as SpinSymbol]

        reelSet = new REELS.ReelSetBuilder()
            .reels(SPN_COLS).visibleRows(SPN_ROWS).symbolSize(CELL, CELL).symbolGap(GAP, GAP)
            .symbols((r: any) => { for (const id of SYMBOL_IDS) r.register(id, SpinTile, {}) })
            .weights(weights)
            .speed('normal', REELS.SpeedPresets.NORMAL)
            .speed('turbo', REELS.SpeedPresets.TURBO)
            .ticker(app.ticker).build()

        reelSet.x = OFFSET_X
        reelSet.y = OFFSET_Y
        app.stage.addChild(reelSet)

        lineLayer = new PIXI.Container()
        lineLayer.x = OFFSET_X; lineLayer.y = OFFSET_Y; lineLayer.eventMode = 'none'
        app.stage.addChild(lineLayer)

        floatLayer = new PIXI.Container()
        floatLayer.x = OFFSET_X; floatLayer.y = OFFSET_Y; floatLayer.eventMode = 'none'
        app.stage.addChild(floatLayer)

        const idle = Array.from({ length: SPN_COLS }, () => ({
            visible: Array.from({ length: SPN_ROWS }, () => PAY_KEYS[Math.floor(Math.random() * PAY_KEYS.length)]!)
        }))
        reelSet.setResult(idle)
        ready.value = true
    } catch (e) {
        errorMsg.value = e instanceof Error ? e.message : 'Failed to load the slot engine'
    }
})

onUnmounted(() => {
    destroyed = true
    try { currentMusicNode?.stop(); currentMusicNode = null } catch { /* ignore */ }
    try { spinSoundNode?.stop(); spinSoundNode = null } catch { /* ignore */ }
    try { audioCtx?.close() } catch { /* ignore */ }
    audioCtx = null; masterGain = null; soundBuffers.clear()
    try { lineLayer?.destroy?.({ children: true }) } catch { /* ignore */ }
    try { floatLayer?.destroy?.({ children: true }) } catch { /* ignore */ }
    try { reelSet?.destroy?.() } catch { /* ignore */ }
    try { app?.destroy?.(true) } catch { /* ignore */ }
})

// --- spin helpers ────────────────────────────────────────────────────────────
async function spinReels(grid: SpinSymbol[][], wins: LineWin[], betAmt: number, trackMult = 1) {
    clearWinLines()
    reelSet.setSpeed?.(turbo.value ? 'turbo' : 'normal')
    startSpinSound()
    scheduleReelStops(grid)
    const spinPromise = reelSet.spin()
    reelSet.setResult(grid.map(col => ({ visible: col })))
    await spinPromise
    stopSpinSound()

    if (wins.length) {
        const lineBet = betAmt / SPN_LINES
        for (let i = 0; i < wins.length; i++) {
            const w = wins[i]!
            clearWinLines()
            drawWinLine(w, i)
            reelSet.spotlight.show(w.cells.map((c: Cell) => ({ reelIndex: c.col, rowIndex: c.row })))
            const money = w.pay * lineBet * trackMult
            if (money > 0) {
                let sx = 0, sy = 0
                for (const c of w.cells) { sx += c.col * (CELL + GAP) + CELL / 2; sy += c.row * (CELL + GAP) + CELL / 2 }
                floatText(sx / w.cells.length, sy / w.cells.length, `+${formatNumber(money, false)}`, 0xfde047, 0x7a1296)
                playSfx('sfx_generic_click_coin')
            }
            await wait(turbo.value ? 200 : 420)
        }
        clearWinLines()
    }
}

// --- main spin flow ──────────────────────────────────────────────────────────
async function spin(feature?: 'buyBonus') {
    const cost = feature === 'buyBonus' ? buyBonusCost.value : bet.value
    if (!ready.value || isSpinning.value || balance.value < cost) return
    isSpinning.value = true
    errorMsg.value = ''
    lastWin.value = 0
    winFlash.value = false
    spinScatterCount.value = 0
    spinBonusCount.value = 0

    let data: { gameData: SpinataResult, balance: number }
    try {
        data = await $fetch('/api/games/play-game', {
            method: 'POST',
            body: { bet: bet.value, game: 'spinata', options: feature ? { feature } : undefined }
        }) as { gameData: SpinataResult, balance: number }
    } catch (e: unknown) {
        errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
        isSpinning.value = false
        stopAutoSpin()
        return
    }

    const result = data.gameData

    try {
        trackLevel.value = SPN_TRACK_START

        // Base spin
        await spinReels(result.grid, result.lines, result.bet)
        spinScatterCount.value = result.scatterCount
        // spinBonusCount increments one-by-one as each piñata flies to the medallion

        // Fly bonus piñatas into the medallion (any count, not just triggered)
        if (result.bonusSymbolCount > 0) {
            await flyBonusToMedallion(result.bonusSymbolCells)
        }

        // Scatter highlight + sound
        if (result.scatterCount >= SPN_SCATTER_TRIGGER) {
            sfx.scatter()
            await reelSet.spotlight.show(
                result.scatterCells.map((c: Cell) => ({ reelIndex: c.col, rowIndex: c.row }))
            )
            await wait(700)
        }

        // Bonus symbol prize
        if (result.bonusPrizeTriggered) {
            sfx.bonus()
            await reelSet.spotlight.show(
                result.bonusSymbolCells.map((c: Cell) => ({ reelIndex: c.col, rowIndex: c.row }))
            )
            await wait(500)
            lastBonusPrize.value = result.bonusPrizePayout
            bonusCelebrating.value = true
            await wait(2200)
            bonusCelebrating.value = false
        }

        // Free spins feature
        if (result.freeSpinsTriggered && result.freeSpins) {
            if (autoSpinEnabled.value) {
                autoSpinPaused.value = true
                await new Promise<void>(res => { _resumeAutoSpin = res })
            }
            await runFreeSpins(result)
        }

        lastWin.value = result.payout
        winFlash.value = result.payout > 0
        if (result.payout > 0) {
            if (result.payout >= result.bet * 15) triggerBigWin(result.payout, result.bet)
            else sfx.win()
        }
        balance.value = data.balance
        setBalance(data.balance)
        sessionWagered.value += result.cost
        sessionReturned.value += result.payout
        history.value.unshift({ payout: result.payout, bet: result.cost, bonus: result.freeSpinsTriggered })
        if (history.value.length > 10) history.value.pop()
    } catch (e) {
        errorMsg.value = e instanceof Error ? e.message : 'Animation error'
        balance.value = data.balance
        setBalance(data.balance)
        stopAutoSpin()
    } finally {
        isSpinning.value = false
        spinScatterCount.value = 0
        if (autoSpinEnabled.value) {
            if (autoSpinPaused.value) await new Promise<void>(res => { _resumeAutoSpin = res })
            if (autoSpinEnabled.value) {
                autoSpinsLeft.value--
                if (autoSpinsLeft.value > 0 && balance.value >= bet.value) spin()
                else stopAutoSpin()
            }
        }
    }
}

async function runFreeSpins(result: SpinataResult) {
    const spins = result.freeSpins!
    inBonus.value = true
    bonusBanner.value = true
    bonusTotal.value = 0
    pinataPot.value = 0
    bonusSpinsLeft.value = SPN_FREE_SPINS
    trackLevel.value = SPN_TRACK_START
    sfx.festival()
    await wait(1600)
    bonusBanner.value = false

    try {
        for (const fs of spins) {
            bonusSpinsLeft.value = SPN_FREE_SPINS - fs.round + 1
            bonusStatus.value = `Spin ${fs.round} / ${SPN_FREE_SPINS}`
            trackLevel.value = fs.trackBefore
            await spinReels(fs.grid, fs.lines, result.bet, fs.trackAfter)

            // Fly bonus piñatas — pass their pre-computed prizes so the pot accumulates
            const freeBonusCells: Cell[] = fs.grid.flatMap((col: SpinSymbol[], c: number) =>
                col.flatMap((sym: SpinSymbol, r: number) => sym === 'bonus' ? [{ col: c, row: r }] : [])
            )
            if (freeBonusCells.length > 0) {
                const prizeCoins = fs.pinataPrizes.map(p => p * result.bet)
                await flyBonusToMedallion(freeBonusCells, prizeCoins)
            }

            // Update track display after spin
            if (fs.trackAfter > fs.trackBefore) {
                trackPulse.value = true
                trackLevel.value = fs.trackAfter
                await wait(300)
                trackPulse.value = false
            }
            bonusTotal.value += fs.spinPayout
            await wait(turbo.value ? 130 : 320)
        }
        bonusSpinsLeft.value = 0
        bonusStatus.value = '¡Fiesta! Bonus complete'
        if (bonusTotal.value >= result.bet * 10) triggerBigWin(bonusTotal.value, result.bet)
        await wait(turbo.value ? 600 : 1400)
    } finally {
        inBonus.value = false
        trackLevel.value = SPN_TRACK_START
        pinataPot.value = 0
        playMusic('sp_main_music')
    }
}

function onKeydown(e: KeyboardEvent) {
    if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        if (!autoSpinEnabled.value) spin()
    }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// --- paytable for help modal ─────────────────────────────────────────────────
const paytableDisplay = (['wild', ...PAY_KEYS].reverse() as (SpinPaySymbol | 'wild')[]).map(sym => ({
    sym,
    pays: PAYTABLE[sym]
}))

// track colour steps
const TRACK_COLORS = [
    '#6b7280','#9ca3af','#4ade80','#34d399','#22d3ee','#38bdf8',
    '#3b82f6','#818cf8','#a78bfa','#c084fc','#e879f9','#f0abfc',
    '#f59e0b','#fbbf24','#f97316','#fb923c','#ef4444','#f87171',
    '#e11d48','#fde047'
]
</script>

<template>
  <div class="page-root">
    <div class="page-bg" />
    <div class="page-vignette" />

    <!-- Title -->
    <div class="spn-title z-1 text-center">
      <img src="/slots/spinata/logo.png" alt="Spiñata Slots" class="spn-title__logo" />
      <div class="mt-2 flex flex-wrap items-center justify-center gap-2">
        <span class="spn-badge spn-badge--rtp">94.5% RTP</span>
        <span class="spn-badge spn-badge--vol">High Volatility</span>
        <span class="spn-badge spn-badge--lines">{{ SPN_LINES }} Paylines</span>
      </div>
    </div>

    <!-- Machine wrapper -->
    <div class="machine z-1">

      <!-- ── Board row: track | reels | info ── -->
      <div class="machine__board">

        <!-- LEFT: multiplier track x1–x8 -->
        <div class="track-panel">
          <div class="track-panel__title">×MULT</div>
          <div class="track-stops">
            <div
              v-for="lvl in SPN_TRACK_CAP"
              :key="lvl"
              class="track-stop"
              :class="{
                'track-stop--active': trackLevel >= (SPN_TRACK_CAP + 1 - lvl),
                'track-stop--pulse': trackPulse && trackLevel === (SPN_TRACK_CAP + 1 - lvl)
              }"
              :style="{ '--stop-color': TRACK_COLORS[SPN_TRACK_CAP - lvl] }"
            >
              <span class="track-stop__label">×{{ SPN_TRACK_CAP + 1 - lvl }}</span>
            </div>
          </div>
        </div>

        <!-- CENTER: reel frame + canvas -->
        <div class="reel-frame" @click="onCanvasClick">
          <div class="reel-area">
            <div class="reel-sheen" />

            <!-- Festival of Spins banner -->
            <Transition name="pop">
              <div v-if="bonusBanner" class="reel-overlay z-30 flex items-center justify-center pointer-events-none">
                <div class="festival-banner text-center">
                  <p class="text-4xl font-black text-white tracking-tight drop-shadow-lg">FESTIVAL OF SPINS</p>
                  <p class="text-base font-bold mt-2 text-amber-100">
                    {{ SPN_FREE_SPINS }} free spins — Piñata Track grows with every Wild!
                  </p>
                </div>
              </div>
            </Transition>

            <!-- Piñata bonus prize overlay -->
            <Transition name="pop">
              <div v-if="bonusCelebrating" class="reel-overlay z-30 flex items-center justify-center pointer-events-none">
                <div class="bonus-prize-card text-center">
                  <img src="/slots/spinata/pinata.png" alt="" class="bonus-prize-img">
                  <p class="bonus-prize-title">PIÑATA BONUS!</p>
                  <p class="bonus-prize-amount">+{{ formatNumber(lastBonusPrize, false) }}</p>
                </div>
              </div>
            </Transition>

            <!-- Auto-spin bonus pause -->
            <Transition name="pop">
              <div
                v-if="autoSpinPaused"
                class="reel-overlay z-20 flex items-center justify-center cursor-pointer"
                style="background: rgba(20,4,30,0.78); backdrop-filter: blur(3px);"
              >
                <div class="pause-card text-center px-8 py-5">
                  <p class="font-black text-white text-lg">🪅 Bonus! Tap to play</p>
                  <p class="text-sm mt-1 text-amber-100/60">{{ autoSpinsLeft }} spin{{ autoSpinsLeft !== 1 ? 's' : '' }} remaining</p>
                </div>
              </div>
            </Transition>

            <div ref="canvasWrap" class="relative z-10 w-full [&>canvas]:w-full! [&>canvas]:h-auto! [&>canvas]:block" />

            <div v-if="!ready && !errorMsg" class="reel-overlay z-40 flex items-center justify-center">
              <UIcon class="size-14 animate-spin text-amber-400" name="i-lucide-loader-circle" />
            </div>

            <!-- Free spins / win strip overlaid at bottom of reels -->
            <div v-if="inBonus" class="reel-hud">
              <span class="reel-hud__item">FREE SPINS: {{ bonusSpinsLeft }} / {{ SPN_FREE_SPINS }}</span>
              <span class="reel-hud__item reel-hud__item--win">WINS: {{ formatNumber(bonusTotal, false) }}</span>
              <span class="reel-hud__item" :class="pinataPotFlash ? 'reel-hud__item--pot-flash' : 'reel-hud__item--pot'">
                🪅 {{ formatNumber(pinataPot, false) }}
              </span>
            </div>
          </div>
        </div>

        <!-- RIGHT: bonus counter + scatter count + paytable -->
        <div class="info-panel">
          <!-- Bonus counter (piñata medallion) -->
          <div ref="medallionEl" class="medallion" :class="{ 'medallion--glow': spinBonusCount >= SPN_BONUS_TRIGGER }">
            <img src="/slots/spinata/pinata.png" alt="" class="medallion__img">
            <div class="medallion__badge" :class="spinBonusCount >= SPN_BONUS_TRIGGER ? 'medallion__badge--win' : ''">
              {{ spinBonusCount }}
            </div>
            <p class="medallion__label">BONUS</p>
          </div>

          <!-- Scatter counter -->
          <div class="info-chip">
            <span class="info-chip__icon">🌟</span>
            <span class="info-chip__val">{{ spinScatterCount }}</span>
            <span class="info-chip__sub">/ {{ SPN_SCATTER_TRIGGER }}</span>
          </div>

          <!-- Free spins indicator (not in bonus) -->
          <div v-if="!inBonus" class="info-chip">
            <span class="info-chip__icon">🎊</span>
            <span class="info-chip__val" style="font-size:11px">FREE<br>SPINS</span>
          </div>
          <div v-else class="info-chip info-chip--bonus">
            <span class="info-chip__icon">🎊</span>
            <span class="info-chip__val">{{ bonusSpinsLeft }}</span>
          </div>

          <button class="paytable-btn" @click="showHelp = true">
            <UIcon class="size-4" name="i-lucide-list" />
            <span>Pay<br>Table</span>
          </button>
        </div>
      </div>

      <!-- ── Control bar ── -->
      <div class="ctrl-bar">
        <div class="ctrl-left">
          <button class="icon-btn" title="Help" @click="showHelp = true"><UIcon class="size-4" name="i-lucide-info" /></button>
          <button :class="{ 'icon-btn--active': turbo }" class="icon-btn" title="Turbo" @click="turbo = !turbo"><UIcon class="size-4" name="i-lucide-zap" /></button>
          <div class="flex items-center gap-1.5">
            <button class="icon-btn" :title="volume === 0 ? 'Unmute' : 'Mute'" @click="toggleMute">
              <UIcon class="size-4" :name="volume === 0 ? 'i-lucide-volume-x' : volume < 0.5 ? 'i-lucide-volume-1' : 'i-lucide-volume-2'" />
            </button>
            <input
              type="range" min="0" max="1" step="0.01"
              :value="volume"
              @input="(e: Event) => setVolume(+((e.target as HTMLInputElement).value))"
              class="w-20 h-1 cursor-pointer accent-primary"
            />
          </div>
        </div>

        <!-- Balance / Bet readouts -->
        <div class="ctrl-readouts">
          <div class="readout">
            <span class="readout__label">Balance</span>
            <span class="readout__val"><CoinBalance :compact="false" :value="balance" /></span>
          </div>
          <div class="readout">
            <span class="readout__label">Bet</span>
            <input
              v-model="betInput"
              :disabled="isSpinning || autoSpinEnabled"
              aria-label="Bet amount"
              class="bet-input readout__val"
              inputmode="numeric"
              @blur="commitBetInput"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            >
          </div>
        </div>

        <!-- Spin controls -->
        <div class="ctrl-spin">
          <button :disabled="isSpinning || autoSpinEnabled || bet <= MIN_BET" class="adj-btn" @click="betDown">½</button>

          <div class="spin-stack">
            <button
              :disabled="!ready || balance < bet || isSpinning"
              class="spin-btn"
              @click="autoSpinEnabled ? stopAutoSpin() : spin()"
            >
              <span class="spin-btn__ring" />
              <UIcon v-if="isSpinning" class="size-8 animate-spin" name="i-lucide-loader-circle" />
              <span v-else-if="autoSpinEnabled" class="flex flex-col items-center leading-none">
                <span class="text-xs tracking-wider opacity-80">{{ autoSpinsLeft }}×</span>
                <span class="text-sm font-black">STOP</span>
              </span>
              <span v-else class="text-sm font-black tracking-wider">SPIN</span>
            </button>
            <button v-if="!autoSpinEnabled" :disabled="!ready || balance < bet || isSpinning" class="auto-btn" @click="showAutoSpinModal = true">AUTO</button>
            <button v-else class="auto-btn auto-btn--stop" @click="stopAutoSpin">STOP</button>
          </div>

          <button :disabled="isSpinning || autoSpinEnabled || bet >= MAX_BET" class="adj-btn" @click="betUp">2×</button>
        </div>

        <!-- Win display -->
        <div class="ctrl-win">
          <div v-if="inBonus" class="text-center">
            <p class="readout__label mb-1">{{ bonusStatus }}</p>
            <p class="win-amount win-amount--bonus">{{ formatNumber(bonusTotal, false) }}</p>
          </div>
          <template v-else>
            <span class="readout__label">Win</span>
            <Transition mode="out-in" name="pop">
              <span v-if="winFlash && lastWin > 0" key="win" class="win-amount">{{ formatNumber(lastWin, false) }}</span>
              <span v-else key="idle" class="win-idle">0.00</span>
            </Transition>
          </template>
        </div>
      </div>

      <!-- Session win-loss bar -->
      <div v-if="sessionWagered > 0" class="session-bar">
        <span class="session-bar__label" :class="sessionNet >= 0 ? 'session-bar__label--up' : 'session-bar__label--down'">
          {{ sessionNet >= 0 ? '+' : '' }}{{ formatNumber(sessionNet, false) }}
        </span>
        <div class="session-bar__track">
          <div class="session-bar__fill" :style="{ width: sessionWinPct + '%' }" />
        </div>
        <span class="session-bar__label session-bar__label--muted">{{ formatNumber(sessionWagered, false) }} wagered</span>
      </div>

      <Transition name="fade-up">
        <div v-if="errorMsg" class="error-strip">
          <p class="text-sm text-red-400">{{ errorMsg }}</p>
          <button class="text-red-400/50 hover:text-red-300 text-base" @click="errorMsg = ''">✕</button>
        </div>
      </Transition>
    </div>

    <!-- Buy Free Spins card -->
    <div class="z-1 mt-4 flex justify-center">
      <button :disabled="!ready || autoSpinEnabled || balance < buyBonusCost" class="buy-card" @click="spin('buyBonus')">
        <span class="buy-card__glow" />
        <span class="relative flex items-center gap-2">
          <span class="text-2xl">🎊</span>
          <span class="font-black uppercase tracking-wide text-lg">Buy Free Spins</span>
        </span>
        <span class="relative text-sm text-amber-100/70">
          {{ SPN_FREE_SPINS }} free spins with live Piñata Multiplier Track (×1→×{{ SPN_TRACK_CAP }})
        </span>
        <span class="buy-card__cost"><CoinBalance :compact="false" :value="buyBonusCost" /></span>
      </button>
    </div>

    <!-- History -->
    <div class="z-1 mt-3 flex gap-1.5 flex-wrap justify-center">
      <span
        v-for="(h, i) in history"
        :key="i"
        :class="h.payout > h.bet
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
          : h.payout > 0
            ? 'bg-amber-500/10 text-amber-300/70 border-amber-500/20'
            : 'bg-white/5 text-white/30 border-white/10'"
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold border"
      >
        <UIcon v-if="h.bonus" class="size-3" name="i-lucide-gift" />
        {{ h.payout > 0 ? formatNumber(h.payout) : '—' }}
      </span>
    </div>

    <!-- Big win popup -->
    <Transition name="bigwin">
      <div v-if="showBigWin" class="bigwin-overlay" @click="showBigWin = false">
        <div class="bigwin-box">
          <p class="bigwin-label">{{ bigWinLabel }}</p>
          <p class="bigwin-amount"><CoinBalance :compact="false" :value="bigWinAmount" /></p>
          <p class="bigwin-tap">tap to continue</p>
        </div>
      </div>
    </Transition>

    <!-- Auto-spin modal -->
    <UModal v-model:open="showAutoSpinModal" title="Auto Spin">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-muted">Auto-spin pauses before the Festival so you can watch.</p>
          <div class="grid grid-cols-5 gap-2">
            <UButton v-for="count in AUTO_SPIN_OPTIONS" :key="count" block class="font-bold" color="neutral" variant="soft" @click="startAutoSpin(count)">{{ count }}</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Help / Paytable modal -->
    <UModal v-model:open="showHelp" title="Spiñata Slots — How to play" size="xl">
      <template #body>
        <div class="space-y-6 text-sm text-muted">

          <!-- Core mechanics -->
          <section class="space-y-3">
            <h3 class="text-xs font-bold uppercase tracking-wider text-default">Basics</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div class="help-card">
                <p class="help-card__title">5 reels × 3 rows · {{ SPN_LINES }} paylines</p>
                <p>Wins pay left-to-right: 3, 4, or 5 matching symbols from reel 1. Line bet = total bet ÷ {{ SPN_LINES }}.</p>
              </div>
              <div class="help-card">
                <div class="flex items-center gap-2 mb-1">
                  <img src="/slots/spinata/wild.png" alt="Wild" class="size-8 object-contain">
                  <p class="help-card__title">Wild</p>
                </div>
                <p>Substitutes for any pay symbol on any payline. Also pays its own line wins.</p>
              </div>
            </div>
          </section>

          <!-- Special symbols -->
          <section class="space-y-3">
            <h3 class="text-xs font-bold uppercase tracking-wider text-default">Special Symbols</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">

              <div class="help-card help-card--scatter">
                <div class="flex items-center gap-2 mb-1">
                  <img src="/slots/spinata/scatter.png" alt="Scatter" class="size-10 object-contain">
                  <p class="help-card__title text-amber-300">Scatter — Festival of Spins</p>
                </div>
                <p>Land <strong class="text-default">{{ SPN_SCATTER_TRIGGER }}+</strong> anywhere to trigger <strong class="text-default">{{ SPN_FREE_SPINS }} free spins</strong>.</p>
                <div class="mt-2 text-xs space-y-0.5">
                  <p>3 Scatters → ×{{ SCATTER_PAY[3] }} bet &nbsp;|&nbsp; 4 → ×{{ SCATTER_PAY[4] }} bet &nbsp;|&nbsp; 5 → ×{{ SCATTER_PAY[5] }} bet</p>
                  <p class="text-amber-200/70">Trigger frequency: ~1 in {{ formatNumber(bonusOdds, true, 0) }} spins</p>
                </div>
              </div>

              <div class="help-card help-card--bonus">
                <div class="flex items-center gap-2 mb-1">
                  <img src="/slots/spinata/pinata.png" alt="Bonus" class="size-10 object-contain">
                  <p class="help-card__title text-emerald-300">Bonus — Piñata Prize</p>
                </div>
                <p>Land <strong class="text-default">{{ SPN_BONUS_TRIGGER }}+</strong> anywhere on a regular spin for an instant cash prize — piñatas don't need to line up on a payline.</p>
                <div class="mt-2 text-xs space-y-0.5">
                  <p>3 Piñatas → ×{{ BONUS_PAY[3] }} bet &nbsp;|&nbsp; 4 → ×{{ BONUS_PAY[4] }} bet &nbsp;|&nbsp; 5 → ×{{ BONUS_PAY[5] }} bet</p>
                  <p class="text-emerald-200/70">During free spins piñatas work differently: each one feeds the Piñata Pot instead (see below).</p>
                </div>
              </div>
            </div>
          </section>

          <!-- Free spins mechanics -->
          <section class="space-y-3">
            <h3 class="text-xs font-bold uppercase tracking-wider text-default">Festival of Spins</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div class="help-card">
                <p class="help-card__title">Piñata Multiplier Track (×1 → ×{{ SPN_TRACK_CAP }})</p>
                <p>The left rail starts at ×1. Every <strong class="text-default">Wild</strong> that lands advances it by 1, up to ×{{ SPN_TRACK_CAP }}. The multiplier applies to all line wins and carries through all {{ SPN_FREE_SPINS }} spins.</p>
              </div>
              <div class="help-card help-card--pot">
                <div class="flex items-center gap-2 mb-1">
                  <img src="/slots/spinata/pinata.png" alt="Piñata Pot" class="size-8 object-contain">
                  <p class="help-card__title text-amber-300">Piñata Pot</p>
                </div>
                <p>Every single <strong class="text-default">piñata</strong> that lands during free spins — no minimum count — flies to the medallion and adds a random prize (×{{ PINATA_POT_PRIZES[0] }}–×{{ PINATA_POT_PRIZES[PINATA_POT_PRIZES.length - 1] }} bet) to the pot.</p>
                <p class="mt-1 text-xs text-amber-200/70">The full pot is paid out on top of your line wins when the free spins finish. Prize odds are listed under "Piñata Pot Prize Distribution" below.</p>
              </div>
            </div>
          </section>

          <!-- Paytable -->
          <section>
            <h3 class="text-xs font-bold uppercase tracking-wider text-default mb-3">Paytable — ×line bet &nbsp;<span class="font-normal text-muted">(line bet = total bet ÷ {{ SPN_LINES }})</span></h3>
            <div class="rounded-xl border border-default overflow-hidden">
              <div class="grid grid-cols-[56px_1fr] text-xs bg-elevated border-b border-default">
                <div class="p-2" />
                <div class="p-2 pr-4 flex justify-end gap-4 font-semibold text-muted">
                  <span class="w-16 text-right">3-of-a-kind</span>
                  <span class="w-16 text-right">4-of-a-kind</span>
                  <span class="w-16 text-right text-default">5-of-a-kind</span>
                </div>
              </div>
              <template v-for="(row, i) in paytableDisplay" :key="row.sym">
                <div :class="i % 2 === 0 ? '' : 'bg-elevated/30'" class="grid grid-cols-[72px_1fr] items-center border-b border-default/30 last:border-0">
                  <div class="p-2 flex flex-col items-center gap-1">
                    <img
                      :src="`/slots/spinata/${row.sym}.png`"
                      :alt="SYMBOL_LABEL[row.sym as SpinSymbol]"
                      class="size-9 object-contain"
                    >
                    <span class="text-[10px] text-muted font-semibold leading-none">{{ SYMBOL_LABEL[row.sym as SpinSymbol] }}</span>
                  </div>
                  <div class="p-2 pr-4 font-mono tabular-nums flex justify-end gap-4">
                    <span class="w-16 text-right text-muted">{{ row.pays[0] }}×</span>
                    <span class="w-16 text-right text-muted">{{ row.pays[1] }}×</span>
                    <span class="w-16 text-right font-bold text-default">{{ row.pays[2] }}×</span>
                  </div>
                </div>
              </template>
            </div>
          </section>

          <!-- Piñata prize table -->
          <section>
            <h3 class="text-xs font-bold uppercase tracking-wider text-default mb-2">Piñata Pot Prize Distribution</h3>
            <div class="flex flex-wrap gap-2">
              <div v-for="(prize, i) in PINATA_POT_PRIZES" :key="prize" class="help-pill">
                ×{{ prize }} bet
                <span class="text-muted/60 text-[10px]">({{ PINATA_POT_WEIGHTS[i] }}%)</span>
              </div>
            </div>
          </section>

        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
/* ── Page ────────────────────────────────────────────────────────────────── */
.page-root {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 16px 12px 24px;
  position: relative;
  overflow: hidden;
}

.page-bg {
  position: absolute; inset: 0; z-index: 0;
  background: url('/slots/spinata/bg.jpg') center / cover no-repeat;
}

.page-vignette {
  position: absolute; inset: 0; z-index: 0;
  background: radial-gradient(ellipse 88% 70% at 50% 46%, rgba(10,4,24,0.08) 0%, rgba(10,4,24,0.52) 72%, rgba(6,2,16,0.88) 100%);
}

/* ── Title ───────────────────────────────────────────────────────────────── */
.spn-title {
  position: relative; margin-bottom: 14px;
}

.spn-title__logo {
  display: block; margin: 0 auto -195px;
  width: min(90%, 700px); height: auto;
  filter: drop-shadow(0 4px 18px rgba(249,115,22,0.55));
}

.spn-badge {
  display: inline-flex; align-items: center; padding: 3px 10px;
  border-radius: 999px; font-size: 11px; font-weight: 800;
  text-transform: uppercase; letter-spacing: 0.07em;
  background: rgba(20,6,30,0.55); border: 1px solid rgba(249,168,37,0.3);
  backdrop-filter: blur(2px);
}
.spn-badge--rtp   { color: #bbf7d0; border-color: rgba(52,211,153,0.5); }
.spn-badge--vol   { color: #fed7aa; border-color: rgba(249,115,22,0.5); }
.spn-badge--lines { color: #fbcfe8; border-color: rgba(236,72,153,0.5); }

/* ── Machine shell ───────────────────────────────────────────────────────── */
.machine {
  position: relative; z-index: 1; width: 100%; max-width: 1100px;
  border-radius: 28px; padding: 10px;
  background: linear-gradient(180deg, #c9841a 0%, #8a4e12 50%, #6b3a0e 100%);
  box-shadow:
    inset 0 0 0 2px rgba(255,214,130,0.55),
    inset 0 2px 0 rgba(255,236,190,0.6),
    inset 0 -3px 6px rgba(0,0,0,0.5),
    0 0 0 2px rgba(120,60,12,0.9),
    0 0 80px rgba(249,168,37,0.25),
    0 40px 100px rgba(0,0,0,0.9);
}

.machine__board {
  display: flex; gap: 10px; align-items: stretch;
  border-radius: 22px;
  background: linear-gradient(160deg, rgba(46,18,60,0.98), rgba(20,6,34,0.99));
  box-shadow: inset 0 0 0 2px rgba(120,60,12,0.6), inset 0 2px 18px rgba(0,0,0,0.6);
  padding: 10px;
}

/* ── Multiplier track panel ──────────────────────────────────────────────── */
.track-panel {
  width: 72px; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px;
}

.track-panel__title {
  text-align: center; font-size: 9px; font-weight: 900; letter-spacing: 0.14em;
  text-transform: uppercase; color: rgba(255,214,130,0.6); padding: 4px 0;
}

.track-stops {
  flex: 1; display: flex; flex-direction: column; gap: 4px;
}

.track-stop {
  flex: 1; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);
  background: rgba(0,0,0,0.35);
  transition: background 0.25s, border-color 0.25s, box-shadow 0.25s;
}

.track-stop--active {
  background: rgba(0,0,0,0.2);
  border-color: var(--stop-color, #fde047);
  box-shadow: 0 0 12px var(--stop-color, #fde047), inset 0 0 8px rgba(255,255,255,0.06);
}

.track-stop--pulse {
  animation: track-pulse 0.35s ease-in-out;
}
@keyframes track-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.12); }
  100% { transform: scale(1); }
}

.track-stop__label {
  font-size: 13px; font-weight: 900; color: rgba(255,255,255,0.35);
  transition: color 0.25s;
}
.track-stop--active .track-stop__label {
  color: var(--stop-color, #fde047);
  text-shadow: 0 0 10px var(--stop-color, #fde047);
}

/* ── Reel area ───────────────────────────────────────────────────────────── */
.reel-frame {
  flex: 1; padding: 8px; border-radius: 18px; cursor: default;
  background:
    repeating-linear-gradient(90deg, transparent 0 10px, rgba(236,72,153,0.5) 10px 13px, transparent 13px 16px, rgba(59,130,246,0.5) 16px 19px, transparent 19px 26px),
    linear-gradient(180deg, #ffe59a 0%, #edb23e 42%, #c8871f 100%);
  box-shadow:
    inset 0 0 0 2px rgba(120,60,12,0.85),
    inset 0 2px 0 rgba(255,245,210,0.7),
    0 0 0 2px rgba(90,45,8,0.9),
    0 6px 24px rgba(0,0,0,0.5);
}

.reel-area {
  position: relative; height: 100%;
  background: radial-gradient(ellipse 120% 80% at 50% 0%, #3f1663 0%, #2a0e50 38%, #1a0838 100%);
  border-radius: 12px; overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.5), inset 0 2px 20px rgba(0,0,0,0.6);
}

.reel-sheen {
  position: absolute; inset: 0; z-index: 15; pointer-events: none;
  background:
    radial-gradient(ellipse 80% 55% at 50% 110%, rgba(0,0,0,0.45) 0%, transparent 60%),
    linear-gradient(180deg, rgba(255,255,255,0.07) 0%, transparent 16%);
}

.reel-overlay {
  position: absolute; inset: 0;
}

/* In-reel HUD (free spins progress) */
.reel-hud {
  position: absolute; bottom: 0; left: 0; right: 0; z-index: 20;
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 16px;
  background: rgba(0,0,0,0.65); border-top: 1px solid rgba(255,214,130,0.2);
}

.reel-hud__item {
  font-size: 12px; font-weight: 800; text-transform: uppercase;
  letter-spacing: 0.08em; color: rgba(255,255,255,0.7);
}

.reel-hud__item--win { color: #fde047; }

/* ── Right info panel ────────────────────────────────────────────────────── */
.info-panel {
  width: 88px; flex-shrink: 0; display: flex; flex-direction: column;
  gap: 8px; align-items: center;
}

.medallion {
  width: 80px; height: 80px; position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  border-radius: 50%; border: 3px solid rgba(255,214,130,0.35);
  background: radial-gradient(circle, rgba(74,10,30,0.9), rgba(40,4,16,0.95));
  box-shadow: 0 0 18px rgba(0,0,0,0.5); transition: box-shadow 0.3s, border-color 0.3s;
}
.medallion--glow {
  border-color: rgba(52,211,153,0.8);
  box-shadow: 0 0 24px rgba(52,211,153,0.5), 0 0 48px rgba(52,211,153,0.25);
}
.medallion__img { width: 44px; height: 44px; object-fit: contain; }
.medallion__badge {
  position: absolute; bottom: -4px; right: -4px;
  width: 24px; height: 24px; border-radius: 50%;
  background: rgba(30,8,50,0.95); border: 2px solid rgba(255,214,130,0.4);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 900; color: rgba(255,255,255,0.8);
}
.medallion__badge--win { background: #059669; border-color: #34d399; color: #fff; }
.medallion__label { position: absolute; bottom: -18px; font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,214,130,0.6); }

.info-chip {
  width: 100%; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 2px; padding: 6px 4px;
  border-radius: 10px; background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,214,130,0.15);
}
.info-chip--bonus { border-color: rgba(249,168,37,0.45); background: rgba(20,8,4,0.5); }
.info-chip__icon { font-size: 18px; line-height: 1; }
.info-chip__val  { font-size: 18px; font-weight: 900; color: #fff; line-height: 1; text-align: center; }
.info-chip__sub  { font-size: 10px; color: rgba(255,255,255,0.4); font-weight: 600; }

.paytable-btn {
  width: 100%; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 4px; padding: 7px 4px;
  border-radius: 8px; font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em; text-align: center;
  color: rgba(255,214,130,0.8); background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,214,130,0.18); cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.paytable-btn:hover { background: rgba(255,214,130,0.1); border-color: rgba(255,214,130,0.4); }

/* ── Control bar ─────────────────────────────────────────────────────────── */
.ctrl-bar {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border-top: 1px solid rgba(120,60,12,0.5);
  background: linear-gradient(180deg, rgba(58,22,8,0.88) 0%, rgba(30,10,4,0.95) 100%);
  border-radius: 0 0 22px 22px;
  flex-wrap: wrap;
}

.ctrl-left { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }

.icon-btn {
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  border-radius: 7px; background: rgba(0,0,0,0.3);
  border: 1px solid rgba(120,60,12,0.4); color: rgba(255,214,130,0.6);
  cursor: pointer; transition: background 0.15s, color 0.15s;
}
.icon-btn:hover { background: rgba(255,214,130,0.12); color: #fde047; }
.icon-btn--active { background: rgba(255,214,130,0.15); color: #fde047; border-color: rgba(255,214,130,0.4); }

.ctrl-readouts { display: flex; gap: 10px; flex: 1; min-width: 0; }

.readout {
  display: flex; flex-direction: column; gap: 2px; padding: 6px 10px;
  border-radius: 8px; background: rgba(0,0,0,0.3);
  border: 1px solid rgba(120,60,12,0.4); min-width: 90px;
}
.readout__label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,214,130,0.5); }
.readout__val   { font-size: 14px; font-weight: 700; color: #fff; }
.bet-input { background: transparent; border: none; outline: none; font-size: 14px; font-weight: 700; color: #fff; width: 100%; }

.ctrl-spin { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.adj-btn {
  width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
  border-radius: 10px; background: rgba(0,0,0,0.3);
  border: 1px solid rgba(120,60,12,0.5); color: rgba(255,214,130,0.7);
  font-weight: 900; font-size: 13px; cursor: pointer; transition: background 0.15s;
}
.adj-btn:hover:not(:disabled) { background: rgba(255,214,130,0.12); color: #fde047; }
.adj-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.spin-stack { display: flex; flex-direction: column; align-items: center; gap: 5px; }

.spin-btn {
  position: relative; width: 80px; height: 80px; border-radius: 50%;
  background: radial-gradient(circle at 50% 28%, #86efac 0%, #22c55e 40%, #15803d 80%, #14532d 100%);
  box-shadow: 0 0 0 3px #15803d, 0 6px 22px rgba(34,197,94,0.55), inset 0 2px 0 rgba(255,255,255,0.3);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: #052e16; transition: transform 0.1s, box-shadow 0.1s;
}
.spin-btn:hover:not(:disabled) { transform: scale(1.05); box-shadow: 0 0 0 3px #15803d, 0 8px 28px rgba(34,197,94,0.7), inset 0 2px 0 rgba(255,255,255,0.3); }
.spin-btn:active:not(:disabled) { transform: scale(0.96); }
.spin-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.spin-btn__ring { position: absolute; inset: -6px; border-radius: 50%; border: 2px solid rgba(134,239,172,0.4); pointer-events: none; }

.auto-btn {
  font-size: 9px; font-weight: 900; letter-spacing: 0.1em; color: rgba(255,214,130,0.6);
  background: rgba(0,0,0,0.25); border: 1px solid rgba(120,60,12,0.4); border-radius: 5px;
  padding: 3px 12px; cursor: pointer; transition: background 0.15s;
}
.auto-btn:hover:not(:disabled) { background: rgba(255,214,130,0.1); color: #fde047; }
.auto-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.auto-btn--stop { color: #f87171; border-color: rgba(248,113,113,0.35); }

.ctrl-win { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 2px; flex-shrink: 0; min-width: 100px; }

.win-amount { font-size: 22px; font-weight: 900; color: #fde047; text-shadow: 0 0 18px rgba(250,204,21,0.7); }
.win-amount--bonus { color: #4ade80; text-shadow: 0 0 18px rgba(74,222,128,0.7); }
.win-idle { font-size: 22px; font-weight: 700; color: rgba(255,255,255,0.2); }

/* ── Buy card ────────────────────────────────────────────────────────────── */
.buy-card {
  position: relative; display: flex; flex-direction: column; gap: 4px;
  padding: 14px 20px 16px; border-radius: 18px; overflow: hidden; cursor: pointer;
  text-align: left; max-width: 420px; width: 100%;
  background: linear-gradient(135deg, rgba(120,40,10,0.88), rgba(60,15,4,0.92));
  border: 1px solid rgba(249,168,37,0.35);
  box-shadow: 0 0 30px rgba(249,168,37,0.14), inset 0 1px 0 rgba(255,255,255,0.1);
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.1s;
}
.buy-card:hover:not(:disabled) { border-color: rgba(249,168,37,0.7); transform: translateY(-1px); }
.buy-card:disabled { opacity: 0.45; cursor: not-allowed; }
.buy-card__glow { position: absolute; inset: 0; background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(249,168,37,0.18), transparent 70%); pointer-events: none; }
.buy-card__cost { display: flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 900; color: #fde047; margin-top: 4px; }

/* ── Overlays ────────────────────────────────────────────────────────────── */
.festival-banner {
  padding: 20px 32px; border-radius: 20px;
  background: linear-gradient(135deg, rgba(122,18,48,0.97), rgba(74,10,30,0.98));
  border: 2px solid rgba(253,224,71,0.55);
  box-shadow: 0 0 60px rgba(253,224,71,0.35), inset 0 1px 0 rgba(255,255,255,0.15);
}

.bonus-prize-card {
  padding: 24px 36px; border-radius: 20px; text-align: center;
  background: linear-gradient(135deg, rgba(20,80,40,0.97), rgba(4,40,16,0.98));
  border: 2px solid rgba(52,211,153,0.6);
  box-shadow: 0 0 60px rgba(52,211,153,0.4);
}
.bonus-prize-img { width: 80px; height: 80px; object-fit: contain; margin: 0 auto 8px; filter: drop-shadow(0 0 16px rgba(52,211,153,0.6)); }
.bonus-prize-title { font-size: 22px; font-weight: 900; color: #fff; letter-spacing: 0.05em; }
.bonus-prize-amount { font-size: 34px; font-weight: 900; color: #4ade80; text-shadow: 0 0 20px rgba(74,222,128,0.6); }

.pause-card {
  border-radius: 16px;
  background: rgba(24,8,38,0.95);
  border: 1px solid rgba(255,214,130,0.25);
}

.session-bar {
  display: flex; align-items: center; gap: 10px; padding: 6px 16px 8px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.session-bar__track {
  flex: 1; height: 5px; border-radius: 3px; background: rgba(239,68,68,0.35); overflow: hidden;
}
.session-bar__fill {
  height: 100%; border-radius: 3px; background: #22c55e; transition: width 0.4s ease;
}
.session-bar__label {
  font-size: 11px; font-weight: 700; white-space: nowrap; min-width: 52px;
}
.session-bar__label--up { color: #4ade80; text-align: left; }
.session-bar__label--down { color: #f87171; text-align: left; }
.session-bar__label--muted { color: rgba(255,255,255,0.35); text-align: right; min-width: 80px; }

.error-strip {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 8px 16px;
  border-top: 1px solid rgba(239,68,68,0.3);
  background: rgba(127,29,29,0.25);
  border-radius: 0 0 22px 22px;
}

/* ── Reel HUD pot classes ────────────────────────────────────────────────── */
.reel-hud__item--pot { color: #fde047; }
.reel-hud__item--pot-flash { color: #fff; text-shadow: 0 0 14px #fde047; animation: pot-flash 0.4s ease-out; }
@keyframes pot-flash { 0% { transform: scale(1.3); } 100% { transform: scale(1); } }

/* ── Help modal cards ────────────────────────────────────────────────────── */
.help-card {
  padding: 12px 14px; border-radius: 12px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
}
.help-card__title { font-weight: 700; color: #fff; margin-bottom: 4px; }
.help-card--scatter { border-color: rgba(249,168,37,0.25); background: rgba(249,168,37,0.05); }
.help-card--bonus   { border-color: rgba(52,211,153,0.25);  background: rgba(52,211,153,0.05); }
.help-card--pot     { border-color: rgba(251,191,36,0.3);   background: rgba(120,53,15,0.25); }

.help-pill {
  display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px;
  border-radius: 999px; font-size: 12px; font-weight: 700;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,214,130,0.2);
  color: #fde047;
}

/* ── Transitions ─────────────────────────────────────────────────────────── */
.pop-enter-active { animation: pop-in 0.28s cubic-bezier(0.34,1.56,0.64,1); }
.pop-leave-active { animation: pop-in 0.18s ease-in reverse; }
@keyframes pop-in { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }

.fade-up-enter-active { animation: fade-up-in 0.2s ease-out; }
.fade-up-leave-active { animation: fade-up-in 0.15s ease-in reverse; }
@keyframes fade-up-in { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

/* big win overlay */
.bigwin-overlay {
  position: fixed; inset: 0; z-index: 200;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.72); cursor: pointer;
}
.bigwin-box {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 48px 64px; border-radius: 24px;
  background: radial-gradient(ellipse at 50% 0%, rgba(255,215,0,0.18) 0%, rgba(0,0,0,0) 70%),
              rgba(20,10,0,0.9);
  border: 2px solid rgba(255,215,0,0.4);
  box-shadow: 0 0 60px rgba(255,180,0,0.25), 0 0 0 1px rgba(255,215,0,0.15);
}
.bigwin-label {
  font-size: 42px; font-weight: 900; letter-spacing: 0.06em;
  text-transform: uppercase;
  background: linear-gradient(135deg, #ffe066 0%, #ff9900 50%, #ffe066 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  text-shadow: none; animation: bigwin-pulse 0.7s ease-in-out infinite alternate;
}
.bigwin-amount {
  font-size: 32px; font-weight: 800; color: #fff;
  text-shadow: 0 0 20px rgba(255,200,0,0.6);
}
.bigwin-tap { font-size: 12px; color: rgba(255,255,255,0.35); letter-spacing: 0.1em; text-transform: uppercase; }
@keyframes bigwin-pulse { from { transform: scale(1); } to { transform: scale(1.06); } }
.bigwin-enter-active { animation: bigwin-in 0.35s cubic-bezier(0.34,1.56,0.64,1); }
.bigwin-leave-active { animation: bigwin-in 0.2s ease-in reverse; }
@keyframes bigwin-in { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
</style>
