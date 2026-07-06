<script setup lang="ts">
import type { BonusResult, BonusSpinResult, BonusTier, BookOfShadowsResult, Cell, ConnectionWin, SlotSymbol } from '#shared/utils/gamelogic/bookofshadows'
import { BONUS_TIERS, BOS_BUY_BONUS_COST, BOS_COLS, BOS_MAX_WIN_MULT, BOS_MIN_CONNECTION, BOS_ROWS, BONUS_SPINS, BONUS_RETRIGGER_BOOKS, BONUS_RETRIGGER_SPINS, BONUS_TRIGGER_COUNT, PAYTABLE, SYMBOL_WEIGHTS, playBookOfShadows } from '#shared/utils/gamelogic/bookofshadows'
import { BOS_BONUS_SHEET_H, BOS_BONUS_SHEET_W, BOS_BONUS_SPRITE_SRC, BOS_BONUS_SYMBOL_META, BOS_SHEET_H, BOS_SHEET_W, BOS_SPRITE_SRC, BOS_SYMBOL_META } from '~/utils/bookofshadows-sprite'

definePageMeta({
  title: 'Book of Shadows'
})

const { user, setBalance, fetchSession } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))

watch(() => user.value?.balance, (value) => {
  if (value !== undefined) balance.value = parseFloat(value ?? '0')
})

// --- bet / controls ----------------------------------------------------------

const MIN_BET = 1
const MAX_BET = 1_000_000
const bet = ref(10)
const betInput = ref('10')
const buyBonusCost = computed(() => Math.round(bet.value * BOS_BUY_BONUS_COST * 100) / 100)
const turbo = ref(false)
const showHelp = ref(false)

const autoSpinEnabled = ref(false)
const autoSpinsLeft = ref(0)
const autoSpinPaused = ref(false)
const showAutoSpinModal = ref(false)
const AUTO_SPIN_OPTIONS = [10, 25, 50, 100, 250]
let resumeAutoSpin: (() => void) | null = null

watch(bet, (value) => {
  betInput.value = String(value)
}, { immediate: true })

function clampBet(value: number): number {
  if (!Number.isFinite(value) || value < MIN_BET) return MIN_BET
  return Math.min(MAX_BET, Math.floor(value))
}

function locked() {
  return isSpinning.value || showBonusPick.value || bonusRunning.value || autoSpinEnabled.value
}

function setBet(value: number) {
  if (locked()) return
  bet.value = clampBet(value)
}

function commitBetInput() {
  setBet(parseInt(betInput.value.replace(/[^\d]/g, ''), 10) || MIN_BET)
  betInput.value = String(bet.value)
}

function betDown() {
  setBet(Math.floor(bet.value / 2))
}

function betUp() {
  setBet(bet.value * 2)
}

function startAutoSpin(count: number) {
  autoSpinsLeft.value = count
  autoSpinEnabled.value = true
  autoSpinPaused.value = false
  showAutoSpinModal.value = false
  if (!isSpinning.value) void spin()
}

function stopAutoSpin() {
  autoSpinEnabled.value = false
  autoSpinsLeft.value = 0
  autoSpinPaused.value = false
  resumeAutoSpin?.()
  resumeAutoSpin = null
}

// --- game state ----------------------------------------------------------------

const isSpinning = ref(false)
const ready = ref(false)
const errorMsg = ref('')
const status = ref('Ready')
const lastWin = ref(0)
const totalWin = ref(0)
const totalWinPulse = ref(false)
const history = ref<{ payout: number, bet: number, bonus: boolean }[]>([])

const bonusData = ref<BonusResult | null>(null)
const showBonusPick = ref(false)
const rolling = ref(false)
const rolledTier = ref<BonusTier | null>(null)
const bonusRunning = ref(false)
const bonusSpinIndex = ref(0)
const bonusSpinTotal = ref(BONUS_SPINS)
const bonusTotal = ref(0)
const skullColumns = ref(0)

const bigWinBanner = ref(false)
const bigWinLabel = ref('')
const bigWinAmount = ref(0)
const bigWinGradient = ref('')
const bigWinGlow = ref('')

// Realistic display cap; the configured hard cap is enforced server-side.
const BOS_DISPLAY_MAX_WIN = BOS_MAX_WIN_MULT
const BOS_VOLATILITY = 5

// --- pixi layout ---------------------------------------------------------------

const canvasHost = ref<HTMLDivElement | null>(null)
const CELL = 108
const GAP = 9
const MARGIN = 18
const REEL_W = BOS_COLS * CELL + (BOS_COLS - 1) * GAP
const REEL_H = BOS_ROWS * CELL + (BOS_ROWS - 1) * GAP
const APP_W = REEL_W + MARGIN * 2
const APP_H = REEL_H + MARGIN * 2

let pixiApp: import('pixi.js').Application | null = null
let reelSet: import('pixi-reels').ReelSet | null = null
let linesLayer: import('pixi.js').Graphics | null = null
let effectsLayer: import('pixi.js').Container | null = null
let resizeObserver: ResizeObserver | null = null
let GSAP: typeof import('gsap').gsap | null = null
let destroyed = false

// While a bonus is running, locked "bonuswild" cells render as an upgraded
// version of the rolled bonus symbol (blood frame, same sprite) instead of a
// generic skull.
let bonusSymbolOverride: SlotSymbol | null = null

// Symbol textures cropped from sprite.png (base grid) and bonus.png (the
// bonus-tier reveal / locked-column art). Crop rects live in
// app/utils/bookofshadows-sprite.ts — tune them via /games/bookofshadows-sprite-debug.
const TEX_BASE: Partial<Record<SlotSymbol, import('pixi.js').Texture>> = {}
const TEX_BONUS: Partial<Record<SlotSymbol, import('pixi.js').Texture>> = {}

// --- theme: dark grimoire, bone gray, blood red ---------------------------------

interface SymbolVisual {
  glyph: string
  glyphSize: number
  serif: boolean
  glyphColor: number
  fill: number
  rim: number
  rimAlpha: number
  label?: string
}

interface SymbolIconStyle {
  width: string
  height: string
  backgroundImage: string
  backgroundSize: string
  backgroundPosition: string
}

const SYMBOL_VISUAL: Record<SlotSymbol, SymbolVisual> = {
  ten: { glyph: '10', glyphSize: 38, serif: true, glyphColor: 0x6b7280, fill: 0x121417, rim: 0x2b2f36, rimAlpha: 0.9 },
  jack: { glyph: 'J', glyphSize: 46, serif: true, glyphColor: 0x7d8694, fill: 0x121417, rim: 0x2b2f36, rimAlpha: 0.9 },
  queen: { glyph: 'Q', glyphSize: 46, serif: true, glyphColor: 0x94a3b8, fill: 0x131519, rim: 0x323843, rimAlpha: 0.9 },
  king: { glyph: 'K', glyphSize: 46, serif: true, glyphColor: 0xb6bec9, fill: 0x14161a, rim: 0x3a414d, rimAlpha: 0.9 },
  ace: { glyph: 'A', glyphSize: 46, serif: true, glyphColor: 0xe2e8f0, fill: 0x15171c, rim: 0x4b5563, rimAlpha: 0.95 },
  sword: { glyph: 'S', glyphSize: 44, serif: false, glyphColor: 0xffffff, fill: 0x15141a, rim: 0x52525b, rimAlpha: 1, label: 'SWORD' },
  orb: { glyph: 'O', glyphSize: 48, serif: false, glyphColor: 0xffffff, fill: 0x161320, rim: 0x5b4a8a, rimAlpha: 1, label: 'ORB' },
  scythe: { glyph: 'Y', glyphSize: 48, serif: false, glyphColor: 0xffffff, fill: 0x0f1a14, rim: 0x2f6b4f, rimAlpha: 1, label: 'SCYTHE' },
  hood: { glyph: 'H', glyphSize: 48, serif: false, glyphColor: 0xffffff, fill: 0x1c1114, rim: 0x8a3a3a, rimAlpha: 1, label: 'HOOD' },
  book: { glyph: 'B', glyphSize: 50, serif: false, glyphColor: 0xffffff, fill: 0x1f0d0d, rim: 0xb91c1c, rimAlpha: 1, label: 'BOOK' },
  bonuswild: { glyph: 'W', glyphSize: 52, serif: false, glyphColor: 0xffffff, fill: 0x230607, rim: 0xef4444, rimAlpha: 1, label: 'WILD' }
}

const SYMBOL_NAME: Record<SlotSymbol, string> = {
  ten: 'Ten',
  jack: 'Jack',
  queen: 'Queen',
  king: 'King',
  ace: 'Ace',
  sword: 'Sword',
  orb: 'Orb',
  scythe: 'Scythe',
  hood: 'Hood',
  book: 'The Book (wild + scatter)',
  bonuswild: 'Bonus Symbol (bonus only)'
}

const PAYTABLE_ROWS = (Object.keys(PAYTABLE) as SlotSymbol[]).map(id => ({
  id,
  name: SYMBOL_NAME[id],
  pays: PAYTABLE[id]
})).reverse()

// Blood-and-bone big win tiers, in × bet of the full round payout.
const WIN_TIERS = [
  { threshold: 500, label: 'UNHOLY WIN', from: '#fecaca', to: '#7f1d1d', glow: 'rgba(239,68,68,0.85)' },
  { threshold: 150, label: 'CURSED WIN', from: '#fca5a5', to: '#991b1b', glow: 'rgba(220,38,38,0.75)' },
  { threshold: 60, label: 'MEGA WIN', from: '#f87171', to: '#b91c1c', glow: 'rgba(220,38,38,0.65)' },
  { threshold: 25, label: 'BIG WIN', from: '#e4e4e7', to: '#71717a', glow: 'rgba(228,228,231,0.5)' },
  { threshold: 10, label: 'DARK WIN', from: '#a1a1aa', to: '#3f3f46', glow: 'rgba(161,161,170,0.45)' }
] as const

// --- helpers -------------------------------------------------------------------

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const stepDelay = (ms: number) => wait(turbo.value ? Math.round(ms * 0.55) : ms)
const cellKey = (c: Cell) => `${c.col}:${c.row}`

// A bonus tier's multiplier shown as a money value at the current bet — e.g.
// a ×2 tier on a 10 bet reads as "20", which lands harder than "×2".
const tierValue = (multiplier: number) => formatNumber(multiplier * bet.value, false)

function symbolIconStyle(symbol: SlotSymbol, bonus = false, size = 30): SymbolIconStyle {
  const useBonusSheet = (bonus && symbol !== 'ten') || symbol === 'bonuswild'
  const meta = useBonusSheet
    ? BOS_BONUS_SYMBOL_META[symbol === 'bonuswild' ? 'book' : symbol as BonusTier['symbol']]
    : BOS_SYMBOL_META[symbol as Exclude<SlotSymbol, 'bonuswild'>]
  const src = useBonusSheet ? BOS_BONUS_SPRITE_SRC : BOS_SPRITE_SRC
  const sheetW = useBonusSheet ? BOS_BONUS_SHEET_W : BOS_SHEET_W
  const sheetH = useBonusSheet ? BOS_BONUS_SHEET_H : BOS_SHEET_H
  const [x, y, w, h] = meta.rect
  const scale = size / Math.max(w, h)

  return {
    width: `${Math.round(w * scale)}px`,
    height: `${Math.round(h * scale)}px`,
    backgroundImage: `url(${src})`,
    backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
    backgroundPosition: `${-x * scale}px ${-y * scale}px`
  }
}

function scaledRect(rect: [number, number, number, number], sourceW: number, sourceH: number, sheetW: number, sheetH: number) {
  const [x, y, w, h] = rect
  const sx = sourceW / sheetW
  const sy = sourceH / sheetH

  return [x * sx, y * sy, w * sx, h * sy] as [number, number, number, number]
}

function pulseWin() {
  totalWinPulse.value = true
  window.setTimeout(() => {
    totalWinPulse.value = false
  }, 320)
}

const tickRuns = new WeakMap<Ref<number>, number>()

function tickNumber(target: Ref<number>, to: number, duration = 320, respectTurbo = true) {
  const run = (tickRuns.get(target) ?? 0) + 1
  tickRuns.set(target, run)
  const from = target.value
  const start = performance.now()
  const d = respectTurbo && turbo.value ? Math.round(duration * 0.5) : duration
  const frame = (now: number) => {
    if (tickRuns.get(target) !== run) return
    const t = Math.min(1, (now - start) / d)
    const eased = 1 - (1 - t) ** 3
    target.value = Number((from + (to - from) * eased).toFixed(2))
    if (t < 1) requestAnimationFrame(frame)
    else target.value = to
  }
  requestAnimationFrame(frame)
}

// The tier multiplier only scales the skull-wild portion; this is exactly what
// the server pays, so the running total always adds up to the final win.
function scaledSpinPayout(sp: BonusSpinResult, tier: BonusTier) {
  return sp.ordinaryPayout + sp.wildPayout * tier.multiplier
}

// --- audio -----------------------------------------------------------------------

const AUDIO_SRC = {
  music: '/slots/bookofshadows/background-music.mp3',
  reel: '/slots/bookofshadows/reel.mp3',
  button: '/slots/bookofshadows/button.mp3',
  bonus: '/slots/bookofshadows/bonus.mp3',
  bigWin: '/slots/bookofshadows/big-win.mp3',
  drawLine: '/slots/bookofshadows/draw-line-4-sounds.mp3',
  wildSpawn: '/slots/bookofshadows/wild-spawn.mp3'
} as const

type SfxKey = keyof typeof AUDIO_SRC

const muted = ref(false)
const volume = ref(70)
const MUSIC_VOLUME = 0.4

function applyVolume() {
  const v = volume.value / 100
  if (musicGain) musicGain.gain.value = v * MUSIC_VOLUME
  if (sfxGain) sfxGain.gain.value = v
}

watch(volume, (value) => {
  if (import.meta.client) localStorage.setItem('bos_volume', String(value))
  applyVolume()
})

let audioCtx: AudioContext | null = null
let musicGain: GainNode | null = null
let sfxGain: GainNode | null = null
let musicSource: AudioBufferSourceNode | null = null
const buffers: Partial<Record<SfxKey, AudioBuffer>> = {}
// draw-line-4-sounds.mp3 is four short "line trace" hits back-to-back; sliced
// into equal offsets so each connection line draws with a random one.
let drawLineSlices: { offset: number, duration: number }[] = []

async function loadAudio() {
  if (!import.meta.client) return
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  audioCtx = new Ctx()
  musicGain = audioCtx.createGain()
  musicGain.connect(audioCtx.destination)
  sfxGain = audioCtx.createGain()
  sfxGain.connect(audioCtx.destination)
  applyVolume()

  await Promise.all(Object.entries(AUDIO_SRC).map(async ([key, url]) => {
    try {
      const res = await fetch(url)
      const arr = await res.arrayBuffer()
      buffers[key as SfxKey] = await audioCtx!.decodeAudioData(arr)
    } catch { /* missing/broken asset — that cue just stays silent */ }
  }))

  const drawBuf = buffers.drawLine
  if (drawBuf) {
    const segDuration = drawBuf.duration / 4
    drawLineSlices = Array.from({ length: 4 }, (_, i) => ({ offset: i * segDuration, duration: segDuration }))
  }
}

// The context can only be created/resumed after a user gesture; spin, roll,
// and the buy-bonus button all qualify.
function ensureAudio(): AudioContext | null {
  if (!audioCtx) return null
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  if (!musicSource && !muted.value) startMusic()
  return audioCtx
}

function startMusic() {
  if (!audioCtx || !musicGain || !buffers.music || musicSource) return
  musicSource = audioCtx.createBufferSource()
  musicSource.buffer = buffers.music
  musicSource.loop = true
  musicSource.connect(musicGain)
  musicSource.start()
}

function playSfx(key: Exclude<SfxKey, 'music' | 'drawLine'>) {
  const ctx = ensureAudio()
  if (!ctx || !sfxGain || muted.value) return
  const buf = buffers[key]
  if (!buf) return
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(sfxGain)
  src.start()
}

function playDrawLineSfx() {
  const ctx = ensureAudio()
  if (!ctx || !sfxGain || muted.value || !buffers.drawLine || !drawLineSlices.length) return
  const slice = drawLineSlices[Math.floor(Math.random() * drawLineSlices.length)]!
  const src = ctx.createBufferSource()
  src.buffer = buffers.drawLine
  const gain = ctx.createGain()
  gain.gain.value = 0.7
  src.connect(gain)
  gain.connect(sfxGain)
  src.start(0, slice.offset, slice.duration)
}

function toggleMuted() {
  muted.value = !muted.value
  if (import.meta.client) localStorage.setItem('bos_muted', muted.value ? '1' : '0')
  if (muted.value) {
    musicSource?.stop()
    musicSource = null
  } else {
    ensureAudio()
  }
}

// --- pixi setup ------------------------------------------------------------------

async function initPixi() {
  if (!canvasHost.value || pixiApp) return

  const [pixi, reels, gsapMod] = await Promise.all([
    import('pixi.js'),
    import('pixi-reels'),
    import('gsap')
  ])
  if (destroyed) return
  const { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } = pixi
  const { ReelSetBuilder, ReelSymbol, SpeedPresets } = reels
  GSAP = gsapMod.gsap ?? gsapMod.default

  const [baseSheet, bonusSheet] = await Promise.all([
    Assets.load(BOS_SPRITE_SRC),
    Assets.load(BOS_BONUS_SPRITE_SRC)
  ])
  for (const [id, meta] of Object.entries(BOS_SYMBOL_META)) {
    TEX_BASE[id as SlotSymbol] = new Texture({
      source: baseSheet.source,
      frame: new Rectangle(...scaledRect(meta.rect, baseSheet.source.width, baseSheet.source.height, BOS_SHEET_W, BOS_SHEET_H))
    })
  }
  for (const [id, meta] of Object.entries(BOS_BONUS_SYMBOL_META)) {
    TEX_BONUS[id as SlotSymbol] = new Texture({
      source: bonusSheet.source,
      frame: new Rectangle(...scaledRect(meta.rect, bonusSheet.source.width, bonusSheet.source.height, BOS_BONUS_SHEET_W, BOS_BONUS_SHEET_H))
    })
  }

  class ShadowSymbol extends ReelSymbol {
    private readonly tile = new Graphics()
    private readonly sprite = new Sprite()

    private readonly glyph = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 42, fontWeight: '900', fill: 0xffffff, align: 'center' }
    })

    private readonly caption = new Text({
      text: '',
      style: { fontFamily: 'Inter, ui-sans-serif, system-ui', fontSize: 10, fontWeight: '900', fill: 0x8b8f99, align: 'center', letterSpacing: 2 }
    })

    private symbol: SlotSymbol = 'ten'
    private w = CELL
    private h = CELL

    constructor() {
      super()
      this.sprite.anchor.set(0.5)
      this.glyph.anchor.set(0.5)
      this.caption.anchor.set(0.5)
      this.view.addChild(this.tile, this.sprite, this.glyph, this.caption)
    }

    protected onActivate(symbolId: string): void {
      this.symbol = symbolId as SlotSymbol
      this.view.alpha = 1
      this.view.scale.set(1)
      this.draw()
    }

    protected onDeactivate(): void {
      GSAP?.killTweensOf([this.view, this.view.scale])
    }

    async playWin(): Promise<void> {
      if (!GSAP) return
      await GSAP.to(this.view.scale, { x: 1.1, y: 1.1, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.out' })
    }

    stopAnimation(): void {
      GSAP?.killTweensOf(this.view.scale)
      this.view.scale.set(1)
    }

    resize(width: number, height: number): void {
      this.w = width
      this.h = height
      this.draw()
    }

    private draw() {
      const isBonusCell = this.symbol === 'bonuswild'
      const frame = SYMBOL_VISUAL[this.symbol] ?? SYMBOL_VISUAL.ten
      // Bonus cells wear the blood frame of `bonuswild` but show the rolled
      // bonus symbol itself — the orb pays, so the orb is what you see.
      const face = isBonusCell && bonusSymbolOverride ? SYMBOL_VISUAL[bonusSymbolOverride] : frame
      const texture = isBonusCell && bonusSymbolOverride ? TEX_BONUS[bonusSymbolOverride] : TEX_BASE[this.symbol]
      const pad = 3
      const isSpecial = this.symbol === 'book' || isBonusCell

      this.tile.clear()
      this.tile.roundRect(pad, pad, this.w - pad * 2, this.h - pad * 2, 12)
      this.tile.fill({ color: frame.fill })
      this.tile.stroke({ color: frame.rim, width: isSpecial ? 2.5 : 1.5, alpha: frame.rimAlpha })
      // faint top sheen so tiles read as carved slabs, not flat rects
      this.tile.roundRect(pad + 3, pad + 3, this.w - pad * 2 - 6, (this.h - pad * 2) * 0.3, 9)
      this.tile.fill({ color: 0xffffff, alpha: 0.03 })
      if (isSpecial) {
        // inner blood glow ring
        this.tile.roundRect(pad + 2, pad + 2, this.w - pad * 2 - 4, this.h - pad * 2 - 4, 10)
        this.tile.stroke({ color: frame.rim, width: 4, alpha: 0.18 })
      }

      if (texture) {
        const labelReserve = !isBonusCell && frame.label ? 18 : 0
        const texPad = isBonusCell ? 0 : pad * 6
        const maxW = this.w - texPad
        const maxH = this.h - texPad - labelReserve
        const scale = Math.min(maxW / texture.width, maxH / texture.height)
        this.sprite.texture = texture
        this.sprite.scale.set(scale)
        this.sprite.position.set(this.w / 2, this.h / 2 - (labelReserve ? 7 : 0))
        this.sprite.visible = true
        this.glyph.visible = false
      } else {
        this.sprite.visible = false
        this.glyph.visible = true
        this.glyph.style.fontFamily = face.serif ? 'Georgia, "Times New Roman", serif' : 'system-ui, sans-serif'
        this.glyph.style.fontSize = face.glyphSize
        // Royals get a blood-tinted letter in their upgraded bonus form.
        this.glyph.style.fill = isBonusCell && bonusSymbolOverride && face.serif ? 0xfca5a5 : face.glyphColor
        this.glyph.text = face.glyph
      }

      const label = isBonusCell ? undefined : frame.label
      this.glyph.position.set(this.w / 2, this.h / 2 - (label ? 6 : 0))

      this.caption.text = label ?? ''
      this.caption.visible = Boolean(label)
      this.caption.style.fill = isSpecial ? 0xf87171 : 0x8b8f99
      this.caption.position.set(this.w / 2, this.h - 17)
    }
  }

  pixiApp = new Application()
  await pixiApp.init({
    width: APP_W,
    height: APP_H,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2)
  })
  if (destroyed) {
    pixiApp.destroy(true)
    pixiApp = null
    return
  }
  canvasHost.value.appendChild(pixiApp.canvas)

  const initialGrid = playBookOfShadows(1).grid

  reelSet = new ReelSetBuilder()
    .reels(BOS_COLS)
    .visibleRows(BOS_ROWS)
    .symbolSize(CELL, CELL)
    .symbolGap(GAP, GAP)
    .symbols((registry) => {
      for (const id of Object.keys(SYMBOL_WEIGHTS)) registry.register(id, ShadowSymbol, {})
      registry.register('bonuswild', ShadowSymbol, {}) // bonus-only, placed via setSymbolAt
    })
    .weights(SYMBOL_WEIGHTS)
    .speed('normal', SpeedPresets.NORMAL)
    .speed('turbo', SpeedPresets.TURBO)
    .initialSpeed('normal')
    .initialFrame(initialGrid.map(col => ({ visible: col })))
    .ticker(pixiApp.ticker)
    .build()

  reelSet.position.set(MARGIN, MARGIN)
  pixiApp.stage.addChild(reelSet)

  // Each reel kicks off its own spin slightly staggered, so hook the sound to
  // the reel's own 'spin' phase rather than the shared spin() call — held
  // reels during the bonus never enter 'spin' and so stay silent.
  for (let i = 0; i < BOS_COLS; i++) {
    reelSet.getReel(i).events.on('phase:enter', (phase: string) => {
      if (phase === 'spin') playSfx('reel')
    })
  }

  linesLayer = new Graphics()
  pixiApp.stage.addChild(linesLayer)

  effectsLayer = new Container()
  pixiApp.stage.addChild(effectsLayer)

  resizeObserver = new ResizeObserver(resizePixi)
  resizeObserver.observe(canvasHost.value)
  resizePixi()

  ready.value = true
}

function resizePixi() {
  if (!pixiApp || !reelSet || !canvasHost.value) return

  const width = Math.max(300, Math.min(canvasHost.value.clientWidth, APP_W))
  const height = width * (APP_H / APP_W)
  pixiApp.renderer.resize(width, height)

  const scale = width / APP_W
  reelSet.scale.set(scale)
  reelSet.position.set(MARGIN * scale, MARGIN * scale)
}

function cellCenter(col: number, row: number) {
  if (!reelSet) return { x: 0, y: 0 }
  const bounds = reelSet.getCellBounds(col, row)
  const s = reelSet.scale.x
  return {
    x: reelSet.x + (bounds.x + bounds.width / 2) * s,
    y: reelSet.y + (bounds.y + bounds.height / 2) * s
  }
}

// --- cell dim / restore -----------------------------------------------------------

function allCells(): Cell[] {
  const cells: Cell[] = []
  for (let col = 0; col < BOS_COLS; col++) {
    for (let row = 0; row < BOS_ROWS; row++) cells.push({ col, row })
  }
  return cells
}

function resetCellLooks() {
  if (!reelSet || !GSAP) return
  for (const { col, row } of allCells()) {
    const view = reelSet.getReel(col).getSymbolAt(row).view
    GSAP.killTweensOf(view)
    view.alpha = 1
  }
  linesLayer?.clear()
  completedSegments = []
  activePartials = new Map()
}

async function dimAllExcept(keepKeys: Set<string>) {
  if (!reelSet || !GSAP) return
  await Promise.all(allCells().map(cell => new Promise<void>((res) => {
    const sym = reelSet!.getReel(cell.col).getSymbolAt(cell.row)
    GSAP!.to(sym.view, { alpha: keepKeys.has(cellKey(cell)) ? 1 : 0.28, duration: 0.25, onComplete: () => res() })
  })))
}

async function restoreAlpha() {
  if (!reelSet || !GSAP) return
  await Promise.all(allCells().map(cell => new Promise<void>((res) => {
    const sym = reelSet!.getReel(cell.col).getSymbolAt(cell.row)
    GSAP!.to(sym.view, { alpha: 1, duration: 0.2, onComplete: () => res() })
  })))
}

// --- blood-red connection tracing ---------------------------------------------------

let completedSegments: { from: { x: number, y: number }, to: { x: number, y: number } }[] = []
let activePartials = new Map<string, { from: { x: number, y: number }, to: { x: number, y: number }, t: number }>()
let drawnEdgeKeys = new Set<string>()

function winEdges(win: ConnectionWin): [Cell, Cell][] {
  const edges: [Cell, Cell][] = []
  for (const a of win.cells) {
    for (const b of win.cells) {
      if (b.col === a.col + 1 && Math.abs(b.row - a.row) <= 1) edges.push([a, b])
    }
  }
  return edges
}

function redrawLines() {
  if (!linesLayer || !reelSet) return
  const s = reelSet.scale.x
  linesLayer.clear()
  const strokeGlow = { width: 9 * s, color: 0x7f1d1d, alpha: 0.5 }
  const strokeCore = { width: 3.5 * s, color: 0xef4444, alpha: 0.95 }
  for (const seg of completedSegments) {
    linesLayer.moveTo(seg.from.x, seg.from.y).lineTo(seg.to.x, seg.to.y).stroke(strokeGlow)
    linesLayer.moveTo(seg.from.x, seg.from.y).lineTo(seg.to.x, seg.to.y).stroke(strokeCore)
  }
  for (const p of activePartials.values()) {
    const x = p.from.x + (p.to.x - p.from.x) * p.t
    const y = p.from.y + (p.to.y - p.from.y) * p.t
    linesLayer.moveTo(p.from.x, p.from.y).lineTo(x, y).stroke(strokeGlow)
    linesLayer.moveTo(p.from.x, p.from.y).lineTo(x, y).stroke(strokeCore)
  }
}

function drawEdge(a: Cell, b: Cell): Promise<void> {
  const key = `${a.col}:${a.row}-${b.col}:${b.row}`
  const from = cellCenter(a.col, a.row)
  const to = cellCenter(b.col, b.row)

  playDrawLineSfx()

  return new Promise((resolve) => {
    if (!GSAP) return resolve()
    const obj = { t: 0 }
    activePartials.set(key, { from, to, t: 0 })
    GSAP.to(obj, {
      t: 1,
      duration: turbo.value ? 0.07 : 0.12,
      ease: 'power1.out',
      onUpdate: () => {
        const p = activePartials.get(key)
        if (p) p.t = obj.t
        redrawLines()
      },
      onComplete: () => {
        activePartials.delete(key)
        completedSegments.push({ from, to })
        redrawLines()
        resolve()
      }
    })
  })
}

// Traces the connection path column-step by column-step, whole fan at once.
async function drawConnectionLines(win: ConnectionWin) {
  const byStartCol = new Map<number, [Cell, Cell][]>()
  for (const edge of winEdges(win)) {
    const key = `${edge[0].col}:${edge[0].row}-${edge[1].col}:${edge[1].row}`
    if (drawnEdgeKeys.has(key)) continue
    drawnEdgeKeys.add(key)
    if (!byStartCol.has(edge[0].col)) byStartCol.set(edge[0].col, [])
    byStartCol.get(edge[0].col)!.push(edge)
  }

  for (const col of [...byStartCol.keys()].sort((x, y) => x - y)) {
    await Promise.all(byStartCol.get(col)!.map(([a, b]) => drawEdge(a, b)))
  }
}

function clearLines() {
  linesLayer?.clear()
  completedSegments = []
  activePartials = new Map()
  drawnEdgeKeys = new Set()
}

// --- effects ----------------------------------------------------------------------

async function screenShake(intensity = 8, duration = 0.3) {
  if (!reelSet || !GSAP) return

  const target = reelSet
  const baseX = target.position.x
  const baseY = target.position.y
  const steps = 5
  const tl = GSAP.timeline({ onComplete: () => target.position.set(baseX, baseY) })

  for (let i = 0; i < steps; i++) {
    const decay = 1 - i / steps
    tl.to(target.position, {
      x: baseX + (Math.random() - 0.5) * intensity * decay,
      y: baseY + (Math.random() - 0.5) * intensity * decay,
      duration: duration / steps,
      ease: 'sine.inOut'
    })
  }
  tl.to(target.position, { x: baseX, y: baseY, duration: duration / steps })
}

async function spawnMoneyPopup(amount: number, cells: Cell[]) {
  if (!effectsLayer || cells.length === 0 || amount <= 0 || !GSAP) return

  const { Text } = await import('pixi.js')
  const center = cells.reduce((point, cell) => {
    const next = cellCenter(cell.col, cell.row)
    return { x: point.x + next.x, y: point.y + next.y }
  }, { x: 0, y: 0 })
  const label = new Text({
    text: `+${formatNumber(amount, false)}`,
    style: {
      fill: 0xfee2e2,
      fontFamily: 'Inter, ui-sans-serif, system-ui',
      fontSize: 34,
      fontWeight: '900',
      stroke: { color: 0x18181b, width: 6 },
      dropShadow: { color: 0xdc2626, blur: 12, distance: 0, alpha: 0.9 }
    }
  })

  label.anchor.set(0.5)
  label.position.set(center.x / cells.length, center.y / cells.length)
  label.scale.set(0.45, 1.35)
  effectsLayer.addChild(label)

  const drift = (Math.random() - 0.5) * 30

  GSAP.to(label.scale, { x: 1, y: 1, duration: 0.2, ease: 'back.out(2.8)' })
  GSAP.to(label.position, { x: label.x + drift, y: label.y - 74, duration: 0.9, ease: 'power2.out' })
  GSAP.to(label, {
    alpha: 0,
    duration: 0.22,
    delay: 0.66,
    ease: 'power2.in',
    onComplete: () => label.destroy()
  })
}

// Ember-like blood motes bursting from a cell — used when a skull column locks.
async function spawnBloodBurst(col: number, row: number) {
  if (!effectsLayer || !GSAP) return

  const { Graphics } = await import('pixi.js')
  const center = cellCenter(col, row)
  const colors = [0xef4444, 0x991b1b, 0xfecaca, 0x7f1d1d]

  for (let i = 0; i < 18; i++) {
    const particle = new Graphics()
    const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.4
    const distance = 42 + Math.random() * 58
    const size = 2 + Math.random() * 4
    const duration = 0.4 + Math.random() * 0.25

    particle.circle(0, 0, size)
    particle.fill({ color: colors[i % colors.length]!, alpha: 0.95 })
    particle.blendMode = 'add'
    particle.position.set(center.x, center.y)
    effectsLayer.addChild(particle)

    GSAP.to(particle.position, {
      x: center.x + Math.cos(angle) * distance,
      y: center.y + Math.sin(angle) * distance,
      duration,
      ease: 'power3.out'
    })
    GSAP.to(particle.scale, { x: 0.2, y: 0.2, duration, ease: 'power2.in' })
    GSAP.to(particle, { alpha: 0, duration: duration + 0.05, ease: 'power2.in', onComplete: () => particle.destroy() })
  }
}

async function showBigWinPopup(totalMultiplier: number, amount: number) {
  const tier = WIN_TIERS.find(t => totalMultiplier >= t.threshold)
  if (!tier) return

  bigWinLabel.value = tier.label
  bigWinGradient.value = `linear-gradient(180deg, ${tier.from}, ${tier.to})`
  bigWinGlow.value = tier.glow
  bigWinAmount.value = 0
  bigWinBanner.value = true
  playSfx('bigWin')

  tickNumber(bigWinAmount, amount, 1400, false)
  await wait(2200)
  bigWinBanner.value = false
}

// --- base game presentation ---------------------------------------------------------

async function celebrateWins(wins: ConnectionWin[], payout: number) {
  if (!wins.length || payout <= 0) return

  const winKeys = new Set(wins.flatMap(w => w.cells.map(cellKey)))
  await dimAllExcept(winKeys)

  clearLines()
  for (const win of wins) {
    await drawConnectionLines(win)
  }

  await spawnMoneyPopup(payout, wins.flatMap(w => w.cells))
  pulseWin()
  await stepDelay(650)

  clearLines()
  await restoreAlpha()
}

// --- bonus flow ----------------------------------------------------------------------

// Reveals a newly-locked column's skulls outward from the landing cell.
async function expandColumn(col: number, triggerRow: number) {
  if (!reelSet) return

  void spawnBloodBurst(col, triggerRow)
  void screenShake(turbo.value ? 5 : 9, turbo.value ? 0.18 : 0.3)

  const order: number[] = [triggerRow]
  for (let d = 1; d < BOS_ROWS; d++) {
    const up = triggerRow - d
    const down = triggerRow + d
    if (up >= 0) order.push(up)
    if (down < BOS_ROWS) order.push(down)
  }

  for (const row of order) {
    reelSet.setSymbolAt(col, row, 'bonuswild')
    const sym = reelSet.getReel(col).getSymbolAt(row)
    GSAP?.fromTo(sym.view.scale, { x: 1.3, y: 1.3 }, { x: 1, y: 1, duration: 0.18, ease: 'back.out(2)' })
    playSfx('wildSpawn')
    await stepDelay(45)
  }

  skullColumns.value++
}

async function celebrateBonusSpin(spinResult: BonusSpinResult, tier: BonusTier) {
  if (!spinResult.wins.length) return

  const winKeys = new Set(spinResult.wins.flatMap(w => w.cells.map(cellKey)))
  await dimAllExcept(winKeys)

  clearLines()
  for (const win of spinResult.wins) {
    await drawConnectionLines(win)
  }

  const spinPay = scaledSpinPayout(spinResult, tier)
  await spawnMoneyPopup(spinPay, spinResult.wins.flatMap(w => w.cells))
  pulseWin()
  await stepDelay(spinPay > bet.value * 5 ? 700 : 420)

  clearLines()
  await restoreAlpha()
}

async function playBonusSpin(bonusSpin: BonusSpinResult, tier: BonusTier) {
  if (!reelSet) return

  // Fully-locked columns stay put instead of spinning through symbols
  // they're just going to show again.
  const holdReels = bonusSpin.landedGrid
    .map((col: SlotSymbol[], i: number) => (col.every(s => s === 'bonuswild') && !bonusSpin.newlyLocked.includes(i) ? i : -1))
    .filter((i: number) => i >= 0)

  reelSet.setSpeed(turbo.value ? 'turbo' : 'normal')
  const spinPromise = reelSet.spin({ holdReels })
  reelSet.setResult(bonusSpin.landedGrid.map((col: SlotSymbol[]) => ({ visible: col })))
  await spinPromise

  for (const col of bonusSpin.newlyLocked) {
    const triggerRow = bonusSpin.landedGrid[col]!.findIndex(s => s === 'bonuswild')
    await expandColumn(col, triggerRow)
  }

  await celebrateBonusSpin(bonusSpin, tier)
}

async function runBonus(bonus: BonusResult) {
  const tier = bonus.tier
  bonusSymbolOverride = tier.symbol
  bonusRunning.value = true
  bonusTotal.value = 0
  bonusSpinIndex.value = 0
  bonusSpinTotal.value = bonus.totalSpins ?? bonus.spins.length
  skullColumns.value = 0

  let collected = 0
  for (const bonusSpin of bonus.spins) {
    bonusSpinIndex.value++
    status.value = `Bonus spin ${bonusSpinIndex.value}/${bonusSpinTotal.value}`
    await playBonusSpin(bonusSpin, tier)
    collected = Number((collected + scaledSpinPayout(bonusSpin, tier)).toFixed(2))
    tickNumber(bonusTotal, collected, 300)
    // BOOK retrigger: this spin awarded extra spins — announce it before moving on.
    if (bonusSpin.retriggered) {
      status.value = `+${BONUS_RETRIGGER_SPINS} spins — books awakened!`
      await stepDelay(900)
    }
    await stepDelay(120)
  }

  // The server settled everything on the triggering call — bonus.totalWin is
  // exactly what was paid for the bonus, and it matches the collected total.
  bonusTotal.value = bonus.totalWin
  status.value = `Bonus over — ${formatNumber(bonus.totalWin, false)}`

  await showBigWinPopup(bonus.totalWin / bet.value, bonus.totalWin)

  bonusRunning.value = false
}

// Purely cosmetic: the tier was already decided (and paid) server-side.
async function rollTier() {
  if (rolling.value || !bonusData.value) return
  rolling.value = true

  for (let i = 0; i < 12; i++) {
    rolledTier.value = BONUS_TIERS[Math.floor(Math.random() * BONUS_TIERS.length)]!
    playSfx('reel')
    await stepDelay(60 + i * 8)
  }
  rolledTier.value = bonusData.value.tier
  rolling.value = false

  await stepDelay(700)
  showBonusPick.value = false
}

// --- spin ------------------------------------------------------------------------------

async function spin(buy = false) {
  if (!ready.value || isSpinning.value || showBonusPick.value || bonusRunning.value) return
  const cost = buy ? buyBonusCost.value : bet.value
  if (balance.value < cost) return

  isSpinning.value = true
  errorMsg.value = ''
  status.value = buy ? 'Summoning bonus' : 'Spinning'
  totalWin.value = 0
  lastWin.value = 0
  bonusSymbolOverride = null
  resetCellLooks()

  const balanceBeforeSpin = balance.value
  balance.value = balanceBeforeSpin - cost
  setBalance(balance.value)

  let data: { gameData: BookOfShadowsResult, balance: number }
  try {
    data = await $fetch('/api/games/play-game', {
      method: 'POST',
      body: { bet: bet.value, game: 'bookofshadows', options: buy ? { buyBonus: true } : undefined }
    }) as { gameData: BookOfShadowsResult, balance: number }
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
    status.value = 'Spin failed'
    balance.value = balanceBeforeSpin
    setBalance(balanceBeforeSpin)
    isSpinning.value = false
    stopAutoSpin()
    return
  }

  const result = data.gameData

  try {
    if (reelSet) {
      reelSet.setSpeed(turbo.value ? 'turbo' : 'normal')
      const spinPromise = reelSet.spin()
      reelSet.setResult(result.grid.map((col: SlotSymbol[]) => ({ visible: col })))
      await spinPromise
    }

    tickNumber(totalWin, result.basePayout, 300)
    await celebrateWins(result.wins, result.basePayout)

    if (result.bonusTriggered && result.bonus) {
      // Hold the visible balance at "bet taken" until the bonus plays out —
      // the win is already settled server-side, revealing it now spoils it.
      bonusData.value = result.bonus
      rolledTier.value = null
      rolling.value = false
      showBonusPick.value = true
      status.value = 'The book awakens'
      playSfx('bonus')

      await new Promise<void>((resolve) => {
        const stopWatch = watch(showBonusPick, (open) => {
          if (!open) {
            stopWatch()
            resolve()
          }
        })
      })

      await runBonus(result.bonus)
    } else if (result.basePayout > 0) {
      await showBigWinPopup(result.basePayout / bet.value, result.basePayout)
    }

    totalWin.value = result.payout
    lastWin.value = result.payout
    if (result.payout > 0) pulseWin()
    if (!result.bonusTriggered) status.value = result.payout > 0 ? 'Paid out' : 'No connection'

    history.value.unshift({ payout: result.payout, bet: cost, bonus: Boolean(result.bonusTriggered) })
    if (history.value.length > 10) history.value.pop()

    balance.value = data.balance
    setBalance(data.balance)
    await fetchSession()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    balance.value = data.balance
    setBalance(data.balance)
    stopAutoSpin()
  }

  isSpinning.value = false

  if (autoSpinEnabled.value) {
    autoSpinsLeft.value--
    if (autoSpinsLeft.value > 0 && balance.value >= bet.value) void spin()
    else stopAutoSpin()
  }
}

onMounted(() => {
  if (import.meta.client) {
    if (localStorage.getItem('bos_muted') === '1') muted.value = true
    const storedVolume = Number(localStorage.getItem('bos_volume'))
    if (Number.isFinite(storedVolume) && storedVolume >= 0 && storedVolume <= 100) volume.value = storedVolume
  }
  void loadAudio()
  initPixi()
})

onBeforeUnmount(() => {
  destroyed = true
  resizeObserver?.disconnect()
  try {
    reelSet?.destroy()
  } catch { /* ignore */ }
  try {
    pixiApp?.destroy(true)
  } catch { /* ignore */ }
  reelSet = null
  pixiApp = null
  linesLayer = null
  effectsLayer = null
  try {
    musicSource?.stop()
    void audioCtx?.close()
  } catch { /* ignore */ }
})
</script>

<template>
  <div class="bos-shell relative min-h-full overflow-hidden px-2 py-6 text-default sm:px-3">
    <div class="bos-bg absolute inset-0" />
    <div class="bos-fog absolute inset-0" />
    <div class="bos-vignette absolute inset-0" />

    <div class="relative z-[1] mx-auto w-full max-w-7xl">
      <header class="mb-5 text-center">
        <p class="bos-eyebrow mb-1.5 text-[11px] font-bold tracking-[0.5em] uppercase">
          ✦ Open the forbidden pages ✦
        </p>
        <h1 class="bos-title text-[42px] leading-none sm:text-[60px]">
          Book of Shadows
        </h1>
        <div class="mt-2.5 flex items-center justify-center gap-2.5">
          <span class="bos-seam-line" />
          <UIcon
            name="i-lucide-skull"
            class="size-4 shrink-0 text-[#991b1b] drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]"
          />
          <span class="bos-seam-line bos-seam-line-flip" />
        </div>
        <div class="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span class="bos-badge bos-badge-blood">
            <UIcon
              name="i-lucide-droplets"
              class="size-3"
            />
            {{ formatNumber(BOS_DISPLAY_MAX_WIN, false, 0) }}x max win
          </span>
          <span class="bos-badge">
            <UIcon
              name="i-lucide-book-open"
              class="size-3"
            />
            {{ BONUS_TRIGGER_COUNT }} books awaken the bonus
          </span>
          <span class="bos-badge">
            <SlotVolatility :level="BOS_VOLATILITY" />
          </span>
        </div>
      </header>

      <div class="grid gap-4 xl:grid-cols-[250px_minmax(0,700px)_260px] xl:items-start xl:justify-center">
        <aside class="order-3 xl:order-1">
          <div
            class="bos-panel p-4"
            :class="{ 'bos-panel-active': bonusRunning }"
          >
            <div class="bos-panel-head">
              <UIcon
                name="i-lucide-book-open"
                class="size-3.5"
              />
              <span>Grimoire</span>
            </div>

            <template v-if="bonusRunning && bonusData">
              <div class="mt-2.5 flex items-center justify-between">
                <span class="text-[11px] font-bold text-muted">Spin</span>
                <strong class="bos-value-blood text-sm">{{ bonusSpinIndex }}/{{ bonusSpinTotal }}</strong>
              </div>
              <div class="bos-progress mt-2">
                <div
                  class="bos-progress-fill"
                  :style="{ width: `${(bonusSpinIndex / bonusSpinTotal) * 100}%` }"
                />
              </div>
              <div class="mt-3 flex items-center justify-between">
                <span class="text-[11px] font-bold text-muted">Skull columns</span>
                <strong class="bos-value-blood text-sm">{{ skullColumns }}/{{ BOS_COLS }}</strong>
              </div>
              <div class="mt-3 flex items-center justify-between">
                <span class="text-[11px] font-bold text-muted">Bonus symbol</span>
                <strong class="bos-value-bone inline-flex items-center gap-1.5 text-sm">
                  <span
                    class="bos-inline-symbol"
                    :style="symbolIconStyle(bonusData.tier.symbol, true, 22)"
                    aria-hidden="true"
                  />
                  {{ bonusData.tier.label }} · {{ tierValue(bonusData.tier.multiplier) }}
                </strong>
              </div>
              <div class="mt-4 border-t border-white/5 pt-3 text-center">
                <span class="text-[10px] font-black tracking-wide uppercase text-muted">Bonus total</span>
                <strong class="bos-value-blood mt-1 block text-3xl leading-none font-black">
                  {{ formatNumber(bonusTotal, false) }}
                </strong>
              </div>
            </template>

            <template v-else>
              <p class="mt-2.5 text-[11px] leading-relaxed text-muted">
                Land {{ BONUS_TRIGGER_COUNT }}+ books to awaken {{ BONUS_SPINS }} bonus spins, then
                roll a bonus symbol that locks its column and pays at its own value.
              </p>
              <button
                type="button"
                class="mt-3 inline-flex items-center gap-1 text-[10px] font-bold text-muted underline-offset-2 hover:underline"
                @click="showHelp = true"
              >
                <UIcon
                  name="i-lucide-info"
                  class="size-3"
                />
                Symbol values &amp; rules
              </button>
            </template>
          </div>

          <div class="bos-panel mt-3 p-3">
            <button
              class="bos-buy-btn"
              :disabled="!ready || isSpinning || showBonusPick || bonusRunning || autoSpinEnabled || balance < buyBonusCost"
              @click="playSfx('button'); spin(true)"
            >
              <UIcon
                name="i-lucide-skull"
                class="size-4"
              />
              Buy bonus · {{ formatNumber(buyBonusCost, false) }}
            </button>
          </div>
        </aside>

        <main class="order-1 xl:order-2">
          <div class="bos-console overflow-hidden">
            <div class="bos-reel-area relative overflow-hidden p-1.5 sm:p-2">
              <div class="bos-reel-sheen pointer-events-none absolute inset-0 z-[2]" />
              <div
                ref="canvasHost"
                class="relative z-[1] mx-auto w-full max-w-[612px] [&>canvas]:!block [&>canvas]:!h-auto [&>canvas]:!w-full"
              />

              <Transition name="pop">
                <div
                  v-if="showBonusPick"
                  class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[rgba(6,4,5,0.88)] backdrop-blur-[4px]"
                >
                  <UIcon
                    name="i-lucide-skull"
                    class="size-8 text-[#ef4444] drop-shadow-[0_0_14px_rgba(239,68,68,0.7)]"
                  />
                  <p class="bos-awaken-text">
                    THE BOOK AWAKENS
                  </p>
                  <p class="text-xs text-white/50">
                    Roll your bonus symbol — skull columns pay at its rate
                  </p>

                  <div
                    class="bos-tier-reveal flex flex-col items-center justify-center gap-1"
                    :class="{ 'bos-tier-reveal-settled': !rolling && rolledTier }"
                  >
                    <span
                      v-if="rolledTier"
                      class="bos-tier-sprite"
                      :style="symbolIconStyle(rolledTier.symbol, true, 96)"
                      aria-hidden="true"
                    />
                    <span
                      v-else
                      class="bos-tier-placeholder"
                    >?</span>
                    <span
                      v-if="rolledTier"
                      class="text-center text-[11px] font-bold tracking-wide text-muted uppercase"
                    >{{ rolledTier.label }}</span>
                    <span
                      v-if="rolledTier"
                      class="bos-tier-reveal-value"
                    >{{ tierValue(rolledTier.multiplier) }}</span>
                  </div>

                  <button
                    class="bos-roll-btn"
                    :disabled="rolling || (!rolling && !!rolledTier)"
                    @click="playSfx('button'); rollTier()"
                  >
                    {{ rolling ? 'Rolling…' : rolledTier ? 'Sealed' : 'Roll' }}
                  </button>
                </div>
              </Transition>

              <Transition name="pop">
                <div
                  v-if="bigWinBanner"
                  class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 bg-[rgba(6,3,4,0.84)] backdrop-blur-[4px]"
                >
                  <p
                    class="bos-bigwin-label"
                    :style="{ backgroundImage: bigWinGradient, filter: `drop-shadow(0 0 22px ${bigWinGlow})` }"
                  >
                    {{ bigWinLabel }}
                  </p>
                  <strong class="bos-bigwin-amount">
                    {{ formatNumber(bigWinAmount, false) }}
                  </strong>
                </div>
              </Transition>

              <div
                v-if="!ready && !errorMsg"
                class="absolute inset-0 z-10 flex items-center justify-center"
              >
                <UIcon
                  name="i-lucide-loader-circle"
                  class="size-10 animate-spin text-[#ef4444]"
                />
              </div>
            </div>

            <div class="grid grid-cols-1 items-center gap-3 border-t border-[#ef4444]/15 bg-background/75 px-3.5 py-3 sm:grid-cols-[1fr_auto_1fr]">
              <div class="order-2 flex min-w-0 flex-col gap-1.5 sm:order-none">
                <div class="bos-readout">
                  <span>Balance</span>
                  <strong><CoinBalance
                    :compact="false"
                    :value="balance"
                  /></strong>
                </div>
                <div class="bos-readout">
                  <span>Bet</span>
                  <input
                    v-model="betInput"
                    :disabled="locked()"
                    inputmode="numeric"
                    aria-label="Bet amount"
                    class="w-24 border-0 bg-transparent text-right text-sm font-black text-highlighted outline-none"
                    @blur="commitBetInput"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  >
                </div>
              </div>

              <div
                class="order-1 min-w-[132px] text-center transition-transform duration-200 sm:order-none"
                :class="totalWinPulse ? 'scale-[1.08]' : ''"
              >
                <span class="text-[10px] font-black tracking-wide uppercase text-muted">{{ bonusRunning ? status : 'Win' }}</span>
                <strong
                  class="mt-0.5 block text-3xl leading-none font-black tracking-normal"
                  :class="(bonusRunning ? bonusTotal : totalWin) > 0 ? 'bos-value-blood' : 'text-muted/40'"
                >
                  {{ formatNumber(bonusRunning ? bonusTotal : totalWin, false) }}
                </strong>
                <span class="mt-1 block text-[11px] font-bold text-muted">Last {{ formatNumber(lastWin, false) }}</span>
              </div>

              <div class="order-3 flex items-center justify-end gap-2.5 sm:order-none">
                <UTooltip text="Halve bet">
                  <button
                    class="bos-icon-btn"
                    :disabled="locked() || bet <= MIN_BET"
                    @click="playSfx('button'); betDown()"
                  >
                    1/2
                  </button>
                </UTooltip>

                <div class="flex flex-col items-center gap-1.5">
                  <button
                    class="bos-spin-btn"
                    :disabled="!ready || isSpinning || showBonusPick || bonusRunning || (!autoSpinEnabled && balance < bet)"
                    @click="playSfx('button'); autoSpinEnabled ? stopAutoSpin() : spin()"
                  >
                    <UIcon
                      v-if="isSpinning"
                      name="i-lucide-loader-circle"
                      class="size-5 animate-spin"
                    />
                    <span
                      v-else-if="autoSpinEnabled"
                      class="flex flex-col items-center gap-0.5 leading-none"
                    >
                      <span class="text-[10px]">{{ autoSpinsLeft }}x</span>
                      <span>STOP</span>
                    </span>
                    <span v-else>SPIN</span>
                  </button>
                  <button
                    v-if="!autoSpinEnabled"
                    class="bos-auto-btn"
                    :disabled="!ready || isSpinning || showBonusPick || bonusRunning || balance < bet"
                    @click="playSfx('button'); showAutoSpinModal = true"
                  >
                    AUTO
                  </button>
                  <button
                    v-else
                    class="bos-auto-btn bos-auto-btn-stop"
                    @click="playSfx('button'); stopAutoSpin()"
                  >
                    STOP
                  </button>
                </div>

                <UTooltip text="Double bet">
                  <button
                    class="bos-icon-btn"
                    :disabled="locked() || bet >= MAX_BET"
                    @click="playSfx('button'); betUp()"
                  >
                    2x
                  </button>
                </UTooltip>
              </div>
            </div>

            <div class="flex items-center justify-between gap-3 border-t border-[#ef4444]/10 px-3.5 pt-2.5 pb-3">
              <div class="flex gap-2">
                <UTooltip text="Rules & paytable">
                  <button
                    class="bos-mini-btn"
                    @click="playSfx('button'); showHelp = true"
                  >
                    <UIcon
                      name="i-lucide-info"
                      class="size-4"
                    />
                  </button>
                </UTooltip>
                <UTooltip text="Turbo">
                  <button
                    class="bos-mini-btn"
                    :class="{ 'bos-mini-btn-active': turbo }"
                    @click="playSfx('button'); turbo = !turbo"
                  >
                    <UIcon
                      name="i-lucide-zap"
                      class="size-4"
                    />
                  </button>
                </UTooltip>
                <UTooltip :text="muted ? 'Unmute' : 'Mute'">
                  <button
                    class="bos-mini-btn"
                    :class="{ 'bos-mini-btn-active': muted }"
                    @click="toggleMuted"
                  >
                    <UIcon
                      :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
                      class="size-4"
                    />
                  </button>
                </UTooltip>
                <USlider
                  v-model="volume"
                  class="w-20 shrink-0"
                  :min="0"
                  :max="100"
                  :step="5"
                  :disabled="muted"
                  size="sm"
                  color="error"
                />
              </div>
              <p
                v-if="errorMsg"
                class="text-xs text-error"
              >
                {{ errorMsg }}
              </p>
              <p
                v-else
                class="text-xs text-muted"
              >
                {{ status }} · {{ formatNumber(BOS_DISPLAY_MAX_WIN, false, 0) }}x max
              </p>
            </div>
          </div>
        </main>

        <aside class="order-2 xl:order-3">
          <div class="bos-panel p-4">
            <div class="bos-panel-head">
              <UIcon
                name="i-lucide-scroll-text"
                class="size-3.5"
              />
              <span>Recent spins</span>
            </div>
            <div
              v-if="history.length"
              class="mt-3 space-y-1.5"
            >
              <div
                v-for="(item, index) in history"
                :key="index"
                class="bos-history-item"
                :class="item.payout > 0 ? 'bos-history-item-win' : ''"
              >
                <UIcon
                  :name="item.bonus ? 'i-lucide-skull' : 'i-lucide-book-open'"
                  class="size-3.5 shrink-0"
                />
                <span class="min-w-0 flex-1 truncate text-[11px] font-bold tracking-wide text-muted uppercase">
                  {{ item.bonus ? 'Bonus' : 'Base spin' }}
                </span>
                <strong class="text-[13px]">{{ item.payout > 0 ? formatNumber(item.payout, false) : '0.00' }}</strong>
              </div>
            </div>
            <UEmpty
              v-else
              class="mt-2"
              icon="i-lucide-moon"
              description="No spins yet"
            />
          </div>
        </aside>
      </div>
    </div>

    <UModal
      v-model:open="showAutoSpinModal"
      title="Auto Spin"
    >
      <template #body>
        <div class="grid grid-cols-5 gap-2">
          <UButton
            v-for="count in AUTO_SPIN_OPTIONS"
            :key="count"
            block
            color="neutral"
            variant="soft"
            @click="playSfx('button'); startAutoSpin(count)"
          >
            {{ count }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="showHelp"
      title="How Book of Shadows works"
    >
      <template #body>
        <div class="space-y-3 text-sm text-muted">
          <p>
            Connections start on the leftmost column and read left to right — a symbol links to the
            next column in the same row or one row up/down, so paths can zigzag.
            {{ BOS_MIN_CONNECTION }}+ connected columns pay. The Book substitutes for everything.
          </p>
          <p>
            {{ BONUS_TRIGGER_COUNT }}+ Books anywhere award {{ BONUS_SPINS }} bonus spins. Before they
            start you roll a bonus symbol — commons roll often, premiums are rare. During the bonus
            your symbol can land and lock its whole column wild for the rest of the round, paying at
            its own value below; the dream is to roll a premium then fill the board with it. All
            other symbols pay their normal base rate. Landing {{ BONUS_RETRIGGER_BOOKS }} books on a
            single bonus spin adds {{ BONUS_RETRIGGER_SPINS }} more spins — once per bonus.
          </p>

          <div>
            <p class="mb-1.5 text-[11px] font-black tracking-wide text-muted uppercase">
              Bonus symbol values · at {{ formatNumber(bet, false) }} bet
            </p>
            <div class="grid grid-cols-3 gap-1.5">
              <div
                v-for="tier in BONUS_TIERS"
                :key="tier.id"
                class="bos-tier-chip"
              >
                <span
                  class="bos-chip-sprite"
                  :style="symbolIconStyle(tier.symbol, true, 24)"
                  aria-hidden="true"
                />
                <span class="mt-0.5 block text-[10px] font-bold text-muted">{{ tier.label }}</span>
                <span class="mt-0.5 block text-[11px] font-black text-[#fecaca]">{{ tierValue(tier.multiplier) }}</span>
              </div>
            </div>
          </div>
          <p>
            Buy bonus skips straight to the feature for {{ formatNumber(buyBonusCost, false) }}
            ({{ BOS_BUY_BONUS_COST }}x bet). Total win is capped at
            {{ formatNumber(BOS_DISPLAY_MAX_WIN, false, 0) }}x bet.
          </p>

          <div class="overflow-hidden rounded-lg border border-default">
            <table class="w-full text-left text-xs">
              <thead>
                <tr class="bg-elevated text-[10px] font-black tracking-wide uppercase">
                  <th class="px-3 py-2">
                    Symbol
                  </th>
                  <th class="px-2 py-2 text-right">
                    ×3
                  </th>
                  <th class="px-2 py-2 text-right">
                    ×4
                  </th>
                  <th class="px-3 py-2 text-right">
                    ×5
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in PAYTABLE_ROWS"
                  :key="row.id"
                  class="border-t border-default"
                >
                  <td class="px-3 py-1.5 font-bold">
                    <span class="inline-flex items-center gap-2">
                      <span
                        class="bos-table-sprite"
                        :style="symbolIconStyle(row.id, false, 22)"
                        aria-hidden="true"
                      />
                      {{ row.name }}
                    </span>
                  </td>
                  <td class="px-2 py-1.5 text-right">
                    {{ row.pays[0] }}x
                  </td>
                  <td class="px-2 py-1.5 text-right">
                    {{ row.pays[1] }}x
                  </td>
                  <td class="px-3 py-1.5 text-right">
                    {{ row.pays[2] }}x
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="text-[11px]">
            Paytable values are × total bet. Skull Wild pays only appear during the bonus and are
            further multiplied by your rolled tier.
          </p>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.bos-shell {
  --bos-blood: #ef4444;
  --bos-blood-deep: #7f1d1d;
  --bos-blood-soft: #fecaca;
  --bos-bone: #d4d4d8;
  --bos-ash: #27272a;
  background: var(--ui-bg);
}

.bos-bg {
  background:
    radial-gradient(ellipse 80% 55% at 50% 0%, rgba(127, 29, 29, 0.14) 0%, transparent 65%),
    radial-gradient(ellipse 60% 45% at 18% 88%, rgba(63, 63, 70, 0.22) 0%, transparent 70%),
    radial-gradient(ellipse 55% 40% at 85% 80%, rgba(127, 29, 29, 0.1) 0%, transparent 70%),
    linear-gradient(180deg, rgba(11, 11, 13, 0.35) 0%, rgba(9, 9, 11, 0.4) 55%, rgba(5, 5, 6, 0.55) 100%),
    url('/slots/bookofshadows/background.png') center 30% / cover no-repeat;
}

.bos-fog {
  background:
    radial-gradient(ellipse 42% 26% at 28% 40%, rgba(161, 161, 170, 0.05), transparent 70%),
    radial-gradient(ellipse 38% 22% at 74% 62%, rgba(161, 161, 170, 0.04), transparent 70%);
  animation: bos-fog-drift 14s ease-in-out infinite alternate;
}

@keyframes bos-fog-drift {
  0% {
    transform: translateX(-1.5%) translateY(0);
    opacity: 0.8;
  }

  100% {
    transform: translateX(1.5%) translateY(-1%);
    opacity: 1;
  }
}

.bos-vignette {
  background: radial-gradient(ellipse 76% 66% at 50% 38%, transparent 0%, rgba(5, 5, 6, 0.22) 72%, rgba(2, 2, 3, 0.55) 100%);
}

.bos-title {
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: linear-gradient(180deg, #fafafa 0%, var(--bos-bone) 34%, #71717a 70%, #2c2c30 100%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.9)) drop-shadow(0 0 26px rgba(239, 68, 68, 0.3));
  animation: bos-candle-flicker 7s ease-in-out infinite;
}

/* uneven candlelight — the glow breathes and occasionally stutters */
@keyframes bos-candle-flicker {
  0%, 100% {
    filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.9)) drop-shadow(0 0 26px rgba(239, 68, 68, 0.3));
  }

  42% {
    filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.9)) drop-shadow(0 0 38px rgba(239, 68, 68, 0.45));
  }

  47% {
    filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.9)) drop-shadow(0 0 18px rgba(239, 68, 68, 0.18));
  }

  52% {
    filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.9)) drop-shadow(0 0 34px rgba(239, 68, 68, 0.42));
  }

  76% {
    filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.9)) drop-shadow(0 0 22px rgba(239, 68, 68, 0.24));
  }
}

.bos-eyebrow {
  color: #71717a;
  text-shadow: 0 0 12px rgba(239, 68, 68, 0.25);
}

.bos-seam-line {
  height: 1px;
  width: 110px;
  background: linear-gradient(90deg, transparent, rgba(153, 27, 27, 0.9));
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.35);
}

.bos-seam-line-flip {
  background: linear-gradient(90deg, rgba(153, 27, 27, 0.9), transparent);
}

.bos-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(161, 161, 170, 0.22);
  border-radius: 999px;
  background: rgba(39, 39, 42, 0.4);
  padding: 4px 10px;
  color: var(--bos-bone);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.03em;
}

.bos-badge-blood {
  border-color: rgba(239, 68, 68, 0.32);
  background: rgba(127, 29, 29, 0.2);
  color: var(--bos-blood-soft);
}

.bos-console,
.bos-panel {
  position: relative;
  border: 1px solid rgba(113, 113, 122, 0.26);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(19, 19, 22, 0.94), rgba(7, 7, 9, 0.97));
  box-shadow: 0 26px 80px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 0 42px rgba(127, 29, 29, 0.1);
  backdrop-filter: blur(10px);
}

.bos-console {
  border-top-color: rgba(153, 27, 27, 0.55);
}

/* a thin blood seam along the top edge, dripping down into the reels */
.bos-console::before {
  content: '';
  position: absolute;
  z-index: 2;
  inset: 0 0 auto 0;
  height: 14px;
  pointer-events: none;
  background:
    radial-gradient(ellipse 2.5px 6px at 5% 3px, #7f1d1d 88%, transparent),
    radial-gradient(ellipse 3px 9px at 14% 3px, #6b1414 88%, transparent),
    radial-gradient(ellipse 2px 5px at 22% 3px, #7f1d1d 88%, transparent),
    radial-gradient(ellipse 3.5px 11px at 33% 3px, #801717 88%, transparent),
    radial-gradient(ellipse 2px 4px at 41% 3px, #6b1414 88%, transparent),
    radial-gradient(ellipse 3px 8px at 52% 3px, #7f1d1d 88%, transparent),
    radial-gradient(ellipse 2.5px 5px at 63% 3px, #6b1414 88%, transparent),
    radial-gradient(ellipse 3px 10px at 74% 3px, #801717 88%, transparent),
    radial-gradient(ellipse 2px 6px at 83% 3px, #7f1d1d 88%, transparent),
    radial-gradient(ellipse 3px 8px at 92% 3px, #6b1414 88%, transparent),
    radial-gradient(ellipse 2px 4px at 98% 3px, #7f1d1d 88%, transparent),
    linear-gradient(180deg, rgba(127, 29, 29, 0.95) 0 3px, transparent 3px);
  filter: drop-shadow(0 0 6px rgba(239, 68, 68, 0.3));
}

.bos-panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--bos-blood);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.bos-panel-head span {
  color: var(--ui-text-muted);
}

.bos-panel-active {
  border-color: rgba(239, 68, 68, 0.5);
  animation: bos-panel-pulse 1.8s ease-in-out infinite;
}

@keyframes bos-panel-pulse {
  0%, 100% {
    box-shadow: 0 26px 80px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 0 20px rgba(239, 68, 68, 0.18);
  }

  50% {
    box-shadow: 0 26px 80px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 0 38px rgba(239, 68, 68, 0.38);
  }
}

.bos-value-blood {
  color: var(--bos-blood-soft);
  text-shadow: 0 0 16px rgba(239, 68, 68, 0.45);
}

.bos-value-bone {
  color: var(--bos-bone);
}

.bos-inline-symbol,
.bos-tier-sprite,
.bos-chip-sprite,
.bos-table-sprite {
  display: inline-block;
  flex: 0 0 auto;
  background-repeat: no-repeat;
  image-rendering: auto;
}

.bos-inline-symbol,
.bos-table-sprite {
  filter: drop-shadow(0 0 5px rgba(239, 68, 68, 0.25));
}

.bos-tier-sprite {
  filter: drop-shadow(0 0 12px rgba(239, 68, 68, 0.45));
}

.bos-chip-sprite {
  margin: 0 auto;
  filter: drop-shadow(0 0 7px rgba(239, 68, 68, 0.28));
}

.bos-progress {
  position: relative;
  height: 7px;
  overflow: hidden;
  border: 1px solid rgba(239, 68, 68, 0.18);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.5);
}

.bos-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #450a0a, var(--bos-blood-deep), var(--bos-blood));
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.6);
  transition: width 320ms ease;
}

.bos-tier-chip {
  border: 1px solid rgba(113, 113, 122, 0.24);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  padding: 5px 0;
  color: var(--bos-bone);
  font-size: 11px;
  font-weight: 900;
  text-align: center;
}

.bos-buy-btn {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(239, 68, 68, 0.45);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(69, 10, 10, 0.7), rgba(24, 24, 27, 0.7));
  padding: 9px 10px;
  color: var(--bos-blood-soft);
  font-size: 12.5px;
  font-weight: 900;
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, opacity 140ms ease;
}

.bos-buy-btn:not(:disabled):hover {
  border-color: rgba(239, 68, 68, 0.85);
  background: linear-gradient(180deg, rgba(127, 29, 29, 0.75), rgba(39, 39, 42, 0.75));
  transform: translateY(-1px);
}

.bos-buy-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.bos-reel-area {
  background:
    radial-gradient(ellipse 88% 58% at 50% 0%, rgba(127, 29, 29, 0.14), transparent 72%),
    linear-gradient(180deg, rgba(24, 24, 27, 0.85), rgba(7, 7, 9, 0.97));
}

.bos-reel-sheen {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 20%),
    radial-gradient(ellipse 70% 42% at 50% 106%, rgba(0, 0, 0, 0.42), transparent 65%);
}

.bos-readout {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid rgba(113, 113, 122, 0.18);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.32);
  padding: 6px 10px;
}

.bos-readout span {
  display: block;
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.bos-readout strong {
  min-width: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 950;
  text-align: right;
}

.bos-spin-btn,
.bos-icon-btn,
.bos-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(113, 113, 122, 0.32);
  background: rgba(0, 0, 0, 0.48);
  color: white;
  font-weight: 950;
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, opacity 140ms ease;
}

.bos-spin-btn {
  width: 84px;
  height: 58px;
  border-color: rgba(239, 68, 68, 0.75);
  border-radius: 999px;
  background: linear-gradient(180deg, #b91c1c, #450a0a);
  color: #fef2f2;
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.5), 0 0 24px rgba(239, 68, 68, 0.35);
}

.bos-icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 8px;
}

.bos-mini-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
}

.bos-mini-btn-active {
  border-color: rgba(239, 68, 68, 0.9);
  background: rgba(239, 68, 68, 0.16);
}

.bos-spin-btn:disabled,
.bos-icon-btn:disabled,
.bos-mini-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.bos-spin-btn:not(:disabled):hover,
.bos-icon-btn:not(:disabled):hover,
.bos-mini-btn:not(:disabled):hover {
  transform: translateY(-1px);
}

.bos-auto-btn {
  border: 0;
  background: none;
  color: var(--ui-text-muted);
  cursor: pointer;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.22em;
  padding: 0;
}

.bos-auto-btn:hover:not(:disabled) {
  color: var(--bos-blood);
}

.bos-auto-btn-stop {
  color: var(--ui-error);
}

.bos-history-item {
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(113, 113, 122, 0.14);
  border-left: 2px solid rgba(113, 113, 122, 0.28);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  padding: 7px 9px;
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 800;
}

.bos-history-item-win {
  border-left-color: var(--bos-blood);
  color: var(--bos-blood-soft);
}

.bos-awaken-text {
  font-size: 22px;
  font-weight: 900;
  letter-spacing: 0.28em;
  background: linear-gradient(180deg, #fecaca, #991b1b);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 18px rgba(239, 68, 68, 0.55));
}

.bos-tier-placeholder {
  font-size: 56px;
  font-weight: 900;
  line-height: 1;
  color: var(--bos-bone);
  opacity: 0.45;
}

.bos-tier-reveal-value {
  font-size: 26px;
  font-weight: 950;
  line-height: 1;
  color: var(--bos-blood-soft);
  text-shadow: 0 0 18px rgba(239, 68, 68, 0.5);
}

.bos-tier-reveal-settled .bos-tier-sprite {
  animation: bos-tier-pop 320ms ease;
}

@keyframes bos-tier-pop {
  0% {
    transform: scale(0.8);
  }

  60% {
    transform: scale(1.14);
  }

  100% {
    transform: scale(1);
  }
}

.bos-roll-btn {
  border: 1px solid rgba(239, 68, 68, 0.65);
  border-radius: 999px;
  background: linear-gradient(180deg, #b91c1c, #450a0a);
  padding: 9px 34px;
  color: #fef2f2;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.14em;
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.5), 0 0 22px rgba(239, 68, 68, 0.35);
  transition: transform 140ms ease, opacity 140ms ease;
}

.bos-roll-btn:not(:disabled):hover {
  transform: translateY(-1px);
}

.bos-roll-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.bos-bigwin-label {
  font-size: 40px;
  font-weight: 950;
  letter-spacing: 0.1em;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: bos-bigwin-throb 900ms ease-in-out infinite alternate;
}

.bos-bigwin-amount {
  font-size: 46px;
  font-weight: 950;
  line-height: 1;
  color: #fef2f2;
  text-shadow: 0 0 26px rgba(239, 68, 68, 0.65), 0 3px 0 rgba(0, 0, 0, 0.8);
}

@keyframes bos-bigwin-throb {
  0% {
    transform: scale(1);
  }

  100% {
    transform: scale(1.05);
  }
}

.pop-enter-active,
.pop-leave-active {
  transition: transform 220ms ease, opacity 220ms ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: scale(0.92);
}
</style>
