<script setup lang="ts">
import type { XenoSlotResult, BonusWave, Cell, SlotSymbol } from '#shared/utils/gamelogic/xenoslot'
import { XENOSLOT_LINES, XENOSLOT_MAX_WIN_MULT, XENOSLOT_BUY_BONUS_COST, BONUS_FREE_SPINS, BONUS_TRIGGER_COUNT, XENOSLOT_CELLS, PAYTABLE, SYMBOL_WEIGHTS } from '#shared/utils/gamelogic/xenoslot'

// Max win shown to players, derived from a 2M-spin Monte Carlo run
// (scripts/xenoslot-rtp.ts). Unlike the other slots, Xeno Slot actually hit
// its configured hard cap a handful of times in that sample (1 in ~500,000),
// so — unlike the others — the realistic figure matches the true cap here.
const XS_DISPLAY_MAX_WIN = XENOSLOT_MAX_WIN_MULT
// Volatility rating (1-5 zaps) — see SlotVolatility.vue. Realistic max win
// (5,000x) is half of Fire in the Hole's (10,000x), so this sits a tier below
// it rather than tying for the top spot.
const XS_VOLATILITY = 4

const { user, setBalance } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))
watch(() => user.value?.balance, (v) => { if (v !== undefined) balance.value = parseFloat(v ?? '0') })

// --- bet / round state ------------------------------------------------------
const MIN_BET = 1
const MAX_BET = 100_000_000_000
const bet = ref(10)
const betInput = ref('10')
watch(bet, (v) => { betInput.value = String(v) })

function clampBet(v: number): number {
  if (!Number.isFinite(v) || v < MIN_BET) return MIN_BET
  return Math.min(MAX_BET, Math.floor(v))
}
function setBet(v: number) {
  if (isSpinning.value || autoSpinEnabled.value) return
  bet.value = clampBet(v)
}
function commitBetInput() {
  setBet(parseInt(betInput.value.replace(/[^\d]/g, ''), 10) || MIN_BET)
  betInput.value = String(bet.value)
}
function betDown() { setBet(Math.floor(bet.value / 2)) }
const buyBonusCost = computed(() => bet.value * XENOSLOT_BUY_BONUS_COST)
function betUp() { setBet(bet.value * 2) }

const turbo = ref(false)
const isSpinning = ref(false)
const errorMsg = ref('')
const showHelp = ref(false)
const ready = ref(false)

const lastWin = ref(0)
const lastLines = ref(0)
const winFlash = ref(false)

// bonus HUD
const inBonus = ref(false)
const bonusBanner = ref(false)
const bonusSpinsLeft = ref(0)
const bonusTotal = ref(0)
const bonusStatus = ref('')

const bigWinBanner = ref(false)
const bigWinLabel = ref('')
const bigWinAmount = ref(0)
const bigWinGradient = ref('')
const bigWinGlow = ref('')
const bigWinIntensity = ref(1)

const history = ref<{ payout: number, bet: number, bonus: boolean }[]>([])

// --- auto-spin state -------------------------------------------------------
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

// Approx odds of triggering the bonus (3+ bonus symbols across the 15 cells),
// expressed as "1 in N". Binomial, p = bonus weight / total weight per cell.
const bonusOdds = computed(() => {
  const total = Object.values(SYMBOL_WEIGHTS).reduce((a, b) => a + b, 0)
  const p = SYMBOL_WEIGHTS.bonus / total
  const q = 1 - p
  const choose = (n: number, k: number) => {
    let r = 1
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1)
    return r
  }
  let pLess = 0
  for (let k = 0; k < BONUS_TRIGGER_COUNT; k++) pLess += choose(XENOSLOT_CELLS, k) * p ** k * q ** (XENOSLOT_CELLS - k)
  const pTrigger = 1 - pLess
  return pTrigger > 0 ? Math.round(1 / pTrigger) : 0
})

// --- asset atlas geometry ---------------------------------------------------
// The symbols live in a 5×3 sheet; the coins/collector live in a second sheet.
// The tiles are NOT evenly divided — the sheet has outer margins and ~16px
// gutters between tiles, so the cut lines below were measured from the art
// (gutter centres) rather than assumed. Slicing on 1/5 · 1/3 drifts and clips
// the vine frames off the tiles.
const SHEET_W = 1536
const SHEET_H = 1024
const COL_CUT = [27, 323, 621, 917, 1211, 1507] // vertical tile edges (6 → 5 cols)
const ROW_CUT = [42, 343, 644, 945] // horizontal tile edges (4 → 3 rows)

// [x, y, w, h] of the tile at grid cell (col, row).
function tileRect(c: number, r: number): [number, number, number, number] {
  const x = COL_CUT[c]!
  const y = ROW_CUT[r]!
  return [x, y, COL_CUT[c + 1]! - x, ROW_CUT[r + 1]! - y]
}

// Which sheet tile [col,row] each game symbol paints. Ordered low → high so the
// value ramp reads: leafy greens → flowers → prestige plants → wild → scatter.
const SYMBOL_TILE: Record<SlotSymbol, [number, number]> = {
  ten: [2, 2], // fern
  jack: [1, 0], // J
  queen: [0, 0], // Q
  king: [2, 0], // K
  ace: [3, 0], // succulent
  bell: [4, 1], // lavender
  seven: [4, 0], // orchid
  diamond: [2, 1], // bonsai
  wild: [0, 2], // WILD plaque
  bonus: [1, 2] // SCATTER clover
}

// Coin medallion + treasure-chest frames inside coins.png.
const MEDAL_FRAME: Record<'bronze' | 'silver' | 'gold' | 'green', [number, number, number, number]> = {
  bronze: [36, 100, 330, 330],
  silver: [409, 100, 330, 330],
  gold: [783, 100, 330, 330],
  green: [1158, 100, 330, 330]
}
const CHEST_FRAME: Record<'closed' | 'open', [number, number, number, number]> = {
  closed: [247, 520, 467, 378],
  open: [809, 520, 452, 378]
}

// --- pixi (non-reactive on purpose; Vue proxies break PixiJS objects) -------
const canvasWrap = ref<HTMLDivElement>()
let app: any = null
let reelSet: any = null
let connectionLayer: any = null
let floatLayer: any = null
let REELS: any = null
let PIXI: any = null
let GSAP: any = null
let CoinSymbolClass: any = null
let CollectorSymbolClass: any = null
let GloverSymbolClass: any = null
let destroyed = false

// Textures cut from the two atlases, built once the sheets load.
const SYMBOL_TEX: Record<string, any> = {}
const MEDAL_TEX: Record<string, any> = {}
const CHEST_TEX: Record<string, any> = {}

const APP_W = 720
const APP_H = 456
const CELL = 128
const GAP = 8
const REEL_W = 5 * CELL + 4 * GAP
const REEL_H = 3 * CELL + 2 * GAP
const B_CELL = 120
const B_GAP = 8
const B_W = 5 * (B_CELL + B_GAP) - B_GAP
const B_H = 3 * (B_CELL + B_GAP) - B_GAP

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Escalating "big win" showcase shown once a round clears a threshold — tuned
// below Fire in the Hole's tiers since Xeno Slot's max win (XENOSLOT_MAX_WIN_MULT,
// 5,000x) is half of that game's.
const WIN_TIERS = [
  { threshold: 2000, rank: 6, label: 'ULTRA WIN', from: '#f0abfc', to: '#a855f7', glow: 'rgba(168,85,247,0.75)' },
  { threshold: 800, rank: 5, label: 'SUPER WIN', from: '#fda4af', to: '#e11d48', glow: 'rgba(225,29,72,0.7)' },
  { threshold: 400, rank: 4, label: 'MEGA WIN', from: '#fdba74', to: '#ea580c', glow: 'rgba(234,88,12,0.7)' },
  { threshold: 200, rank: 3, label: 'GREAT WIN', from: '#fde047', to: '#ca8a04', glow: 'rgba(202,138,4,0.65)' },
  { threshold: 100, rank: 2, label: 'BIG WIN', from: '#86efac', to: '#16a34a', glow: 'rgba(22,163,74,0.6)' },
  { threshold: 60, rank: 1, label: 'NICE WIN', from: '#7dd3fc', to: '#0284c7', glow: 'rgba(2,132,199,0.55)' }
] as const

function tickBigWinAmount(to: number, duration = 1400) {
  const obj = { v: bigWinAmount.value }
  GSAP.to(obj, {
    v: to,
    duration: duration / 1000,
    ease: 'power3.out',
    onUpdate: () => { bigWinAmount.value = Number(obj.v.toFixed(2)) }
  })
}

async function showBigWinPopup(totalMultiplier: number, amount: number) {
  const tier = WIN_TIERS.find(t => totalMultiplier >= t.threshold)
  if (!tier) return

  bigWinLabel.value = tier.label
  bigWinGradient.value = `linear-gradient(180deg, ${tier.from}, ${tier.to})`
  bigWinGlow.value = tier.glow
  bigWinIntensity.value = tier.rank
  bigWinAmount.value = 0
  bigWinBanner.value = true

  tickBigWinAmount(amount)
  await wait(2200)
  bigWinBanner.value = false
}

function ensureConnectionLayer() {
  if (!app || !PIXI) return null
  if (!connectionLayer) {
    connectionLayer = new PIXI.Graphics()
    connectionLayer.zIndex = 20
    app.stage.addChild(connectionLayer)
  } else {
    app.stage.addChild(connectionLayer)
  }
  return connectionLayer
}

function clearConnections() {
  connectionLayer?.clear?.()
}

function clearWinText() {
  floatLayer?.removeChildren?.().forEach((child: any) => {
    try { child.destroy?.() } catch { /* ignore */ }
  })
}

function drawConnectionPath(points: { x: number, y: number }[], color = 0xfde047, width = 5, alpha = 0.9) {
  if (points.length < 2) return
  const g = ensureConnectionLayer()
  if (!g) return

  g.moveTo(points[0]!.x, points[0]!.y)
  for (const p of points.slice(1)) g.lineTo(p.x, p.y)
  g.stroke({ color, width: width + 7, alpha: 0.18, cap: 'round', join: 'round' })

  g.moveTo(points[0]!.x, points[0]!.y)
  for (const p of points.slice(1)) g.lineTo(p.x, p.y)
  g.stroke({ color, width, alpha, cap: 'round', join: 'round' })
}

function drawBaseWinConnections(lines: XenoSlotResult['lines']) {
  clearConnections()
  for (const line of lines) {
    const points = line.cells.map(c => ({
      x: reelSet.x + c.col * (CELL + GAP) + CELL / 2,
      y: reelSet.y + c.row * (CELL + GAP) + CELL / 2
    }))
    drawConnectionPath(points, 0xfde047, 5, 0.9)
  }
}

function spawnLineWinText(lines: XenoSlotResult['lines']) {
  if (!floatLayer || !PIXI || !GSAP) return
  const { Text } = PIXI
  for (const line of lines) {
    if (!line.amount || line.amount <= 0 || !line.cells.length) continue

    let sx = 0
    let sy = 0
    for (const c of line.cells) {
      sx += c.col * (CELL + GAP) + CELL / 2
      sy += c.row * (CELL + GAP) + CELL / 2
    }
    const cx = sx / line.cells.length
    const cy = sy / line.cells.length

    const t = new Text({
      text: `+${formatNumber(line.amount, false)}`,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 24,
        fontWeight: '900',
        fill: 0xfde047,
        align: 'center',
        stroke: { color: 0x14532d, width: 5, join: 'round' },
        dropShadow: { color: 0x000000, blur: 4, distance: 2, alpha: 0.5, angle: Math.PI / 2 }
      }
    })
    t.anchor.set(0.5)
    t.position.set(cx, cy)
    floatLayer.addChild(t)

    const dur = turbo.value ? 0.95 : 1.6
    GSAP.fromTo(t.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2.6)' })
    GSAP.to(t, { y: cy - 40, duration: dur, ease: 'power1.out' })
    GSAP.to(t, {
      alpha: 0,
      duration: dur * 0.38,
      delay: dur * 0.62,
      ease: 'power1.in',
      onComplete: () => {
        try { t.destroy() } catch { /* ignore */ }
      }
    })
  }
}

function addLineWin(line: XenoSlotResult['lines'][number]) {
  if (!line.amount || line.amount <= 0) return
  lastWin.value += line.amount
  winFlash.value = true
}

// Coin metal tiers, picked from a coin's bet-multiplier so the medallion metal
// is stable regardless of stake. The tiny fly-into-chest clones reuse the same
// palette so they match the medallion they left.
type CoinTier = { face: number, rim: number, shine: number, ring: number, text: number }
const COIN_TIERS: Record<'bronze' | 'silver' | 'gold' | 'platinum', CoinTier> = {
  bronze: { face: 0xc97b3c, rim: 0x6e3f17, shine: 0xe8b27a, ring: 0xf0c79a, text: 0x3a210c },
  silver: { face: 0xc7d2e0, rim: 0x59697f, shine: 0xf6f9fc, ring: 0xeef3f9, text: 0x27313f },
  gold: { face: 0xf5c518, rim: 0x9a5b09, shine: 0xfde98a, ring: 0xfff0b3, text: 0x40260a },
  platinum: { face: 0x86efac, rim: 0x166534, shine: 0xdcfce7, ring: 0xbbf7d0, text: 0x0c3a1e }
}
function tierFor(mult: number): CoinTier {
  if (mult >= 25) return COIN_TIERS.platinum
  if (mult >= 5) return COIN_TIERS.gold
  if (mult >= 1) return COIN_TIERS.silver
  return COIN_TIERS.bronze
}
// Same thresholds, but as the medallion sprite key.
function medalFor(mult: number): 'bronze' | 'silver' | 'gold' | 'green' {
  if (mult >= 25) return 'green'
  if (mult >= 5) return 'gold'
  if (mult >= 1) return 'silver'
  return 'bronze'
}

// Glover (multiplier clover) look per multiplier — progressively brighter green tiers.
type GloverLook = { face: number, ring: number, glow: number, text: number }
const GLOVER_LOOKS: Record<number, GloverLook> = {
  2: { face: 0x166534, ring: 0xbbf7d0, glow: 0x16a34a, text: 0xffffff },
  5: { face: 0x14532d, ring: 0x86efac, glow: 0x22c55e, text: 0xffffff },
  10: { face: 0x052e16, ring: 0x4ade80, glow: 0x4ade80, text: 0xecfdf5 }
}
function gloverLook(mult: number): GloverLook {
  return GLOVER_LOOKS[mult] ?? GLOVER_LOOKS[2]!
}

// Paytable rows for the help modal, high → low. Divide by XENOSLOT_LINES so the
// values are × total bet (what the player actually feels).
const PAY_ORDER: Exclude<SlotSymbol, 'bonus'>[] = ['wild', 'diamond', 'seven', 'bell', 'ace', 'king', 'queen', 'jack', 'ten']
const paytableRows = PAY_ORDER.map(sym => ({
  sym,
  pays: PAYTABLE[sym].map(p => Math.round((p / XENOSLOT_LINES) * 10) / 10) as [number, number, number]
}))

// CSS one-tile crop of the symbol sheet (measured grid), for the paytable art.
function tileStyle(sym: SlotSymbol, w = 46) {
  const [c, r] = SYMBOL_TILE[sym]
  const [x, y, tw, th] = tileRect(c!, r!)
  const h = Math.round(w * th / tw)
  const sx = w / tw
  const sy = h / th
  return {
    width: `${w}px`,
    height: `${h}px`,
    backgroundImage: 'url(/slots/xenoslot/sprite.png)',
    backgroundSize: `${Math.round(SHEET_W * sx)}px ${Math.round(SHEET_H * sy)}px`,
    backgroundPosition: `-${Math.round(x * sx)}px -${Math.round(y * sy)}px`
  }
}

// --- build the symbol classes once Pixi is loaded ---------------------------
function makeSymbolClasses() {
  const { Sprite, Graphics, Text } = PIXI
  const Base = REELS.ReelSymbol

  // Scale a sprite to fit inside w×h without cropping, and centre it.
  function fit(sprite: any, tex: any, w: number, h: number, factor = 1) {
    sprite.texture = tex
    const s = Math.min(w / tex.width, h / tex.height) * factor
    sprite.scale.set(s)
    sprite.x = w / 2
    sprite.y = h / 2
  }

  // Base reel symbol: a single tile from the botanical sheet (frame + art baked
  // in), so the reel reads like the reference board out of the box.
  class SpriteSymbol extends Base {
    sprite = new Sprite()
    w = CELL
    h = CELL
    _tween: any = null

    constructor() {
      super()
      this.sprite.anchor.set(0.5)
      this.view.addChild(this.sprite)
    }

    _render(id: string) {
      const tex = SYMBOL_TEX[id]
      if (!tex) return
      fit(this.sprite, tex, this.w, this.h, 1)
    }

    onActivate(id: string) { this.view.alpha = 1; this._render(id) }
    onDeactivate() { this._kill() }
    resize(w: number, h: number) { this.w = w; this.h = h; if (this.symbolId) this._render(this.symbolId) }
    stopAnimation() { this._kill(); this.view.scale.set(1, 1) }
    _kill() { if (this._tween) { this._tween.kill(); this._tween = null } this.view.scale.set(1, 1) }
    playWin() {
      this._kill()
      return new Promise<void>((res) => {
        // Pulse inward so a framed tile never spills over its neighbours.
        this._tween = GSAP.to(this.view.scale, { x: 0.9, y: 0.9, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut', onComplete: res })
      })
    }
  }

  // A coin = a metal medallion sprite with its cash value stamped on the disc.
  class CoinSymbol extends Base {
    sprite = new Sprite()
    label: any
    w = B_CELL
    h = B_CELL
    _tween: any = null
    // Default bronze: coins fall bronze while spinning, then setValue() re-tiers
    // them on landing so they appear to upgrade to silver/gold/green.
    _medal: 'bronze' | 'silver' | 'gold' | 'green' = 'bronze'

    constructor() {
      super()
      this.sprite.anchor.set(0.5)
      this.label = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 23, fontWeight: '900', fill: 0x241708, align: 'center', stroke: { color: 0xf5deb3, width: 3 } } })
      this.label.anchor.set(0.5)
      this.view.addChild(this.sprite)
      this.view.addChild(this.label)
    }

    _draw() {
      fit(this.sprite, MEDAL_TEX[this._medal], this.w, this.h, 1)
      // The disc sits a touch above the leaf-framed medallion's centre.
      this.label.x = this.w / 2
      this.label.y = this.h * 0.46
    }

    setValue(amount: number, mult?: number) {
      if (mult !== undefined) this._medal = medalFor(mult)
      this._draw()
      this.label.text = formatNumber(amount, true, 0)
    }

    onActivate() { this.view.alpha = 1; this._draw(); if (!this.label.text) this.label.text = '' }
    onDeactivate() { this._kill(); this.label.text = '' }
    resize(w: number, h: number) { this.w = w; this.h = h; this._draw() }
    stopAnimation() { this._kill(); this.view.scale.set(1, 1) }
    _kill() { if (this._tween) { this._tween.kill(); this._tween = null } this.view.scale.set(1, 1) }
    playWin() {
      this._kill()
      return new Promise<void>((res) => {
        this._tween = GSAP.to(this.view.scale, { x: 0.9, y: 0.9, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut', onComplete: res })
      })
    }
  }

  // A collector = the vine-wrapped treasure chest. It sits closed on the board
  // and springs open while it harvests coins, its total ticking up underneath.
  class CollectorSymbol extends Base {
    sprite = new Sprite()
    label: any
    w = B_CELL
    h = B_CELL
    _tween: any = null
    _open = false

    constructor() {
      super()
      this.sprite.anchor.set(0.5)
      this.label = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 20, fontWeight: '900', fill: 0xfde68a, align: 'center', stroke: { color: 0x2a1a02, width: 4 } } })
      this.label.anchor.set(0.5)
      this.view.addChild(this.sprite)
      this.view.addChild(this.label)
    }

    _draw() {
      fit(this.sprite, this._open ? CHEST_TEX.open : CHEST_TEX.closed, this.w, this.h, 1.04)
      this.label.x = this.w / 2
      this.label.y = this.h - 12
    }

    // Pop the lid open — the "tiny bit of animation" as it starts collecting.
    open() {
      if (this._open) return
      this._open = true
      this._draw()
      this._kill()
      this._tween = GSAP.fromTo(this.view.scale, { x: 0.86, y: 0.86 }, { x: 1, y: 1, duration: 0.24, ease: 'back.out(2.4)' })
    }

    setCollected(amount: number) {
      this.label.text = amount > 0 ? `+${formatNumber(amount, true)}` : ''
    }

    onActivate() { this.view.alpha = 1; this._open = false; this.label.text = ''; this._draw() }
    onDeactivate() { this._kill() }
    resize(w: number, h: number) { this.w = w; this.h = h; this._draw() }
    stopAnimation() { this._kill(); this.view.scale.set(1, 1) }
    _kill() { if (this._tween) { this._tween.kill(); this._tween = null } this.view.scale.set(1, 1) }
    playWin() {
      this._kill()
      return new Promise<void>((res) => {
        this._tween = GSAP.to(this.view.scale, { x: 1.08, y: 1.08, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut', onComplete: res })
      })
    }
  }

  // A glover (multiplier clover). It lands showing 🍀 + ×N, boosts the coins around it,
  // then vanishes — it never stays on the board.
  class GloverSymbol extends Base {
    bg = new Graphics()
    icon: any
    label: any
    w = B_CELL
    h = B_CELL
    _tween: any = null
    _look: GloverLook = GLOVER_LOOKS[2]!

    constructor() {
      super()
      this.icon = new Text({ text: '🍀', style: { fontFamily: 'system-ui, sans-serif', fontSize: 36, align: 'center' } })
      this.icon.anchor.set(0.5)
      this.label = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 20, fontWeight: '900', fill: 0xffffff, align: 'center' } })
      this.label.anchor.set(0.5)
      this.view.addChild(this.bg)
      this.view.addChild(this.icon)
      this.view.addChild(this.label)
    }

    _draw() {
      const pad = 5
      const r = 16
      const L = this._look
      this.bg.clear()
      this.bg.roundRect(pad, pad, this.w - 2 * pad, this.h - 2 * pad, r).fill({ color: L.face }).stroke({ color: L.ring, width: 3 })
      this.icon.x = this.w / 2
      this.icon.y = this.h / 2 - 12
      this.label.style.fill = L.text
      this.label.x = this.w / 2
      this.label.y = this.h / 2 + 20
    }

    setMult(mult: number) {
      this._look = gloverLook(mult)
      this.label.text = `×${mult}`
      this._draw()
    }

    onActivate() { this.view.alpha = 1; this.label.text = ''; this._draw() }
    onDeactivate() { this._kill() }
    resize(w: number, h: number) { this.w = w; this.h = h; this._draw() }
    stopAnimation() { this._kill(); this.view.scale.set(1, 1) }
    _kill() { if (this._tween) { this._tween.kill(); this._tween = null } this.view.scale.set(1, 1) }
    playWin() {
      this._kill()
      return new Promise<void>((res) => {
        this._tween = GSAP.to(this.view.scale, { x: 0.9, y: 0.9, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut', onComplete: res })
      })
    }
  }

  CoinSymbolClass = CoinSymbol
  CollectorSymbolClass = CollectorSymbol
  GloverSymbolClass = GloverSymbol
  return SpriteSymbol
}

onMounted(async () => {
  try {
    const [pixi, reels, gsapMod] = await Promise.all([
      import('pixi.js'),
      import('pixi-reels'),
      import('gsap')
    ])
    if (destroyed) return
    PIXI = pixi
    REELS = reels
    GSAP = gsapMod.gsap ?? gsapMod.default

    app = new PIXI.Application()
    // Transparent canvas so the jungle board panel shows through behind the tiles.
    await app.init({ width: APP_W, height: APP_H, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) })
    if (destroyed) { app.destroy(true); return }
    app.stage.sortableChildren = true
    canvasWrap.value?.appendChild(app.canvas)

    // Load the two atlases and slice out every frame we need.
    const [sheet, coins] = await Promise.all([
      PIXI.Assets.load('/slots/xenoslot/sprite.png'),
      PIXI.Assets.load('/slots/xenoslot/coins.png')
    ])
    if (destroyed) { app.destroy(true); return }
    for (const id of Object.keys(SYMBOL_TILE) as SlotSymbol[]) {
      const [c, r] = SYMBOL_TILE[id]
      SYMBOL_TEX[id] = new PIXI.Texture({ source: sheet.source, frame: new PIXI.Rectangle(...tileRect(c!, r!)) })
    }
    for (const [key, f] of Object.entries(MEDAL_FRAME)) {
      MEDAL_TEX[key] = new PIXI.Texture({ source: coins.source, frame: new PIXI.Rectangle(f[0], f[1], f[2], f[3]) })
    }
    for (const [key, f] of Object.entries(CHEST_FRAME)) {
      CHEST_TEX[key] = new PIXI.Texture({ source: coins.source, frame: new PIXI.Rectangle(f[0], f[1], f[2], f[3]) })
    }

    const SpriteSymbol = makeSymbolClasses()

    reelSet = new REELS.ReelSetBuilder()
      .reels(5).visibleRows(3).symbolSize(CELL, CELL).symbolGap(GAP, GAP)
      .symbols((r: any) => {
        for (const id of Object.keys(SYMBOL_TILE)) r.register(id, SpriteSymbol, {})
      })
      .weights({ ten: 30, jack: 28, queen: 24, king: 20, ace: 16, bell: 12, seven: 7, diamond: 4, wild: 4, bonus: 5 })
      .speed('normal', REELS.SpeedPresets.NORMAL)
      .speed('turbo', REELS.SpeedPresets.TURBO)
      .ticker(app.ticker)
      .build()

    reelSet.x = (APP_W - REEL_W) / 2
    reelSet.y = (APP_H - REEL_H) / 2
    app.stage.addChild(reelSet)

    floatLayer = new PIXI.Container()
    floatLayer.x = reelSet.x
    floatLayer.y = reelSet.y
    floatLayer.zIndex = 30
    floatLayer.eventMode = 'none'
    app.stage.addChild(floatLayer)

    ready.value = true
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load the slot engine'
  }
})

onUnmounted(() => {
  destroyed = true
  try { floatLayer?.destroy?.({ children: true }) } catch { /* ignore */ }
  try { reelSet?.destroy?.() } catch { /* ignore */ }
  try { app?.destroy?.(true) } catch { /* ignore */ }
})

// --- spin flow --------------------------------------------------------------
async function spin(buy = false) {
  const cost = buy ? buyBonusCost.value : bet.value
  if (!ready.value || isSpinning.value || balance.value < cost) return
  isSpinning.value = true
  errorMsg.value = ''
  lastWin.value = 0
  lastLines.value = 0
  winFlash.value = false
  const balanceBeforeSpin = balance.value
  balance.value = balanceBeforeSpin - cost
  setBalance(balance.value)
  clearConnections()
  clearWinText()

  let data: { gameData: XenoSlotResult, balance: number }
  try {
    data = await $fetch('/api/games/play-game', {
      method: 'POST',
      body: { bet: bet.value, game: 'xenoslot', options: buy ? { buyBonus: true } : undefined }
    }) as { gameData: XenoSlotResult, balance: number }
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
    balance.value = balanceBeforeSpin
    setBalance(balanceBeforeSpin)
    isSpinning.value = false
    stopAutoSpin()
    return
  }

  const result = data.gameData

  try {
    // 1. Spin the base reels onto the server grid (turbo only affects the base
    // spin; the bonus board below always plays at its own pace).
    reelSet.setSpeed?.(turbo.value ? 'turbo' : 'normal')
    const spinPromise = reelSet.spin()
    reelSet.setResult(result.grid.map((col: SlotSymbol[]) => ({ visible: col })))
    await spinPromise

    // 2. Celebrate line wins.
    if (result.lines.length) {
      lastLines.value = result.lines.length
      for (const line of result.lines) {
        const winLine = { positions: line.cells.map(c => ({ reelIndex: c.col, rowIndex: c.row })) }
        drawBaseWinConnections([line])
        spawnLineWinText([line])
        addLineWin(line)
        await reelSet.spotlight.cycle([winLine], { displayDuration: 850, gapDuration: 120, cycles: 1 })
      }
      clearConnections()
    }

    // 3. Bonus feature.
    if (result.bonusTriggered && result.bonus) {
      clearWinText()
      await reelSet.spotlight.show(result.bonusCells.map(c => ({ reelIndex: c.col, rowIndex: c.row })), { displayDuration: 600 } as any)
      if (autoSpinEnabled.value) {
        autoSpinPaused.value = true
        await new Promise<void>((res) => { _resumeAutoSpin = res })
      }
      await runBonus(result)
    }

    // 4. Settle balance + HUD.
    lastWin.value = result.payout
    winFlash.value = result.payout > 0
    balance.value = data.balance
    setBalance(data.balance)
    history.value.unshift({ payout: result.payout, bet: result.cost, bonus: result.bonusTriggered })
    if (history.value.length > 10) history.value.pop()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    balance.value = data.balance
    setBalance(data.balance)
    stopAutoSpin()
  } finally {
    clearConnections()
    isSpinning.value = false
    if (autoSpinEnabled.value) {
      if (autoSpinPaused.value) {
        await new Promise<void>((res) => { _resumeAutoSpin = res })
      }
      if (autoSpinEnabled.value) {
        autoSpinsLeft.value--
        if (autoSpinsLeft.value > 0 && balance.value >= bet.value) {
          spin()
        } else {
          stopAutoSpin()
        }
      }
    }
  }
}

// --- bonus animation driven entirely by the server's precomputed waves ------
async function runBonus(result: XenoSlotResult) {
  const bonus = result.bonus!
  inBonus.value = true
  bonusBanner.value = true
  bonusTotal.value = 0
  bonusSpinsLeft.value = BONUS_FREE_SPINS
  bonusStatus.value = 'Hold & Win!'
  await wait(1100)
  bonusBanner.value = false

  reelSet.visible = false

  const board = new REELS.HoldAndWinBuilder()
    .grid(5, 3).cellSize(B_CELL, { gap: B_GAP })
    .symbols((r: any) => {
      r.register('coin', CoinSymbolClass, {})
      r.register('glover', GloverSymbolClass, {})
      r.register('collector', CollectorSymbolClass, {})
    })
    .weights({ coin: 3, collector: 1, glover: 1, empty: 9 })
    .respins(99) // we drive the loop from server waves, not the board's counter
    .cellChrome((g: any, size: number) => {
      g.roundRect(0, 0, size, size, 14).fill({ color: 0x000000, alpha: 0.94 }).stroke({ color: 0x2f5a24, width: 2 })
    })
    .ticker(app.ticker)
    .build()

  // Coins show their value on landing. Collectors land as a closed chest —
  // their total stays hidden and ticks up later as coins fly into them.
  board.events.on('coin:locked', ({ coin }: any) => {
    if (coin.id === 'coin') {
      const mult = coin.data?.value ?? 0
      board.symbolAt(coin.cell)?.setValue?.(mult * result.bet, mult)
    } else if (coin.id === 'glover') {
      board.symbolAt(coin.cell)?.setMult?.(coin.data?.mult ?? 2)
    }
  })

  board.container.x = (APP_W - B_W) / 2
  board.container.y = (APP_H - B_H) / 2
  app.stage.addChild(board.container)

  try {
    // Seed from the trigger cells.
    const seed = bonus.seed.map(c => ({ cell: c.cell, id: 'coin', data: { value: c.value } }))
    board.enter(seed)
    for (const c of bonus.seed) board.symbolAt(c.cell)?.setValue?.(c.value * result.bet, c.value)
    await wait(500)

    // Replay each bonus spin. The pixi-reels board auto-ends the feature the
    // instant its grid fills up (coins/glovers/collectors all occupy a cell
    // until released), which can happen before the server's fixed 10 waves are
    // exhausted — respin() would then throw on the next iteration. `boardDone`
    // guards against that: once respin() reports the board ended, we stop
    // advancing (the current wave still finishes its glover/collector replay).
    let boardDone = false
    for (const wave of bonus.waves) {
      if (boardDone) break
      bonusStatus.value = `Spin ${wave.round} / ${BONUS_FREE_SPINS}`
      bonusSpinsLeft.value = BONUS_FREE_SPINS - wave.round
      // Coins that land the same wave as a glover neighbour them already have
      // their post-boost value in wave.coins (the server mutates in place).
      // Capture the pre-boost value from glover.upgrades so the coin spawns at
      // its original value and the upgrade animation has something to animate.
      const preGloverMap = new Map<string, number>()
      for (const g of wave.glovers) {
        for (const up of g.upgrades) {
          const k = `${up.cell.col}:${up.cell.row}`
          if (!preGloverMap.has(k)) preGloverMap.set(k, up.from)
        }
      }
      const hits = [
        ...wave.coins.map(c => ({ cell: c.cell, id: 'coin', data: { value: preGloverMap.get(`${c.cell.col}:${c.cell.row}`) ?? c.value } })),
        ...wave.glovers.map(g => ({ cell: g.cell, id: 'glover', data: { mult: g.mult } })),
        ...wave.collectors.map(c => ({ cell: c.cell, id: 'collector', data: { collected: c.collected } }))
      ]
      const res = await board.respin(hits)
      boardDone = res.done

      // Glovers resolve first: each boosts its neighbouring coins, then vanishes.
      if (wave.glovers.length) {
        await wait(160)
        await applyGlovers(board, wave, result.bet)
        board.release(wave.glovers.map(g => g.cell))
        await wait(120)
      }

      // A collector pulls every coin in, ticking the total up coin by coin,
      // then the whole board is wiped clean.
      if (wave.collectors.length) {
        await wait(200)
        await collectIntoChest(board, wave, result.bet)
        const occupied = [...wave.collectedCoins.map(c => c.cell), ...wave.collectors.map(c => c.cell)]
        board.release(occupied)
        await wait(220)
      } else {
        await wait(wave.hit ? 220 : 160)
      }
    }

    // Snap to the exact server total (covers float drift) and hold.
    bonusTotal.value = bonus.bonusPayout
    bonusSpinsLeft.value = 0
    bonusStatus.value = bonus.bonusPayout > 0 ? 'Bonus complete!' : 'No collectors — no win'
    await wait(1300)
  } finally {
    try { app.stage.removeChild(board.container) } catch { /* ignore */ }
    try { board.destroy() } catch { /* ignore */ }
    reelSet.visible = true
    inBonus.value = false
  }

  await showBigWinPopup(result.payout / result.bet, result.payout)
}

// Absolute (stage-space) centre of a board cell.
function absCenter(board: any, cell: Cell): { x: number, y: number } {
  const c = board.cellCenter(cell)
  return { x: board.container.x + c.x, y: board.container.y + c.y }
}

// A small tier-coloured coin carrying a value, used for the fly-into-chest clones.
function makeFlyClone(amount: number, tier: CoinTier): any {
  const { Container, Graphics, Text } = PIXI
  const c = new Container()
  const g = new Graphics()
  const rad = 19
  g.circle(0, 0, rad).fill({ color: tier.rim })
  g.circle(0, 0, rad - 2.5).fill({ color: tier.face })
  g.circle(0, 0, rad - 6).stroke({ color: tier.ring, width: 1.5, alpha: 0.9 })
  g.ellipse(-rad * 0.3, -rad * 0.4, rad * 0.42, rad * 0.25).fill({ color: tier.shine, alpha: 0.4 })
  const t = new Text({ text: formatNumber(amount, true), style: { fontFamily: 'system-ui, sans-serif', fontSize: 15, fontWeight: '900', fill: tier.text } })
  t.anchor.set(0.5)
  c.addChild(g)
  c.addChild(t)
  return c
}

// Tween a value clone along a quadratic bezier arc from a coin to a collector.
function flyValue(board: any, fromCell: Cell, toCell: Cell, amount: number, mult: number, onArrive: () => void): Promise<void> {
  const f = absCenter(board, fromCell)
  const to = absCenter(board, toCell)
  const ctrl = { x: (f.x + to.x) / 2 + (Math.random() * 60 - 30), y: Math.min(f.y, to.y) - 70 }
  const clone = makeFlyClone(amount, tierFor(mult))
  clone.position.set(f.x, f.y)
  app.stage.addChild(clone)
  return new Promise<void>((res) => {
    const o = { t: 0 }
    GSAP.to(o, {
      t: 1,
      duration: 0.52,
      ease: 'power1.in',
      onUpdate: () => {
        const u = o.t
        const mu = 1 - u
        clone.x = mu * mu * f.x + 2 * mu * u * ctrl.x + u * u * to.x
        clone.y = mu * mu * f.y + 2 * mu * u * ctrl.y + u * u * to.y
        clone.scale.set(1 - 0.35 * u)
      },
      onComplete: () => {
        onArrive()
        clone.destroy({ children: true })
        res()
      }
    })
  })
}

// A small "×N" label that floats up from a cell and fades — used when a glover
// boosts a neighbouring coin.
function floatText(board: any, cell: Cell, text: string, mult: number) {
  const { Text } = PIXI
  const p = absCenter(board, cell)
  const look = gloverLook(mult)
  const t = new Text({ text, style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '900', fill: look.glow, stroke: { color: 0x052e16, width: 3 } } })
  t.anchor.set(0.5)
  t.position.set(p.x, p.y - 6)
  app.stage.addChild(t)
  GSAP.to(t, { y: p.y - 40, alpha: 0, duration: 0.7, ease: 'power1.out', onComplete: () => t.destroy() })
}

// Replay each glover this wave: pulse the orb, raise the value (and recolour the
// tier) of every neighbouring coin it boosted, then fade the orb away.
async function applyGlovers(board: any, wave: BonusWave, bet: number) {
  bonusStatus.value = 'Multiplier!'
  for (const glover of wave.glovers) {
    const orb = board.symbolAt(glover.cell)
    await orb?.playWin?.()
    await wait(110)
    for (const up of glover.upgrades) {
      const coin = board.symbolAt(up.cell)
      coin?.setValue?.(up.to * bet, up.to)
      coin?.playWin?.()
      floatText(board, up.cell, `×${glover.mult}`, glover.mult)
    }
    await wait(glover.upgrades.length ? 320 : 140)
    if (orb?.view) await new Promise<void>(res => GSAP.to(orb.view, { alpha: 0, duration: 0.22, ease: 'power1.in', onComplete: () => res() }))
  }
}

// Each collector chest pops open and pulls in EVERY coin on the board, one chest
// at a time. A clone of each coin's value flies into the chest along an arc and
// the running total ticks up on every arrival. Coins stay put until all chests
// have harvested, then they fade out (the caller clears the board).
async function collectIntoChest(board: any, wave: BonusWave, bet: number) {
  bonusStatus.value = 'Collecting…'

  for (const collector of wave.collectors) {
    const chest = board.symbolAt(collector.cell)
    let running = 0
    chest?.open?.()
    chest?.setCollected?.(0)
    await wait(180)

    const flights = wave.collectedCoins.map((coin, i) =>
      wait(i * 110).then(() => flyValue(board, coin.cell, collector.cell, coin.value * bet, coin.value, () => {
        running += coin.value * bet
        bonusTotal.value += coin.value * bet
        const c = board.symbolAt(collector.cell)
        c?.setCollected?.(running)
        c?.playWin?.()
      })))
    await Promise.allSettled(flights)
    await wait(250)
  }

  // Fade the harvested coins out before the board is wiped clean.
  for (const coin of wave.collectedCoins) {
    const cs = board.symbolAt(coin.cell)
    if (cs?.view) GSAP.to(cs.view, { alpha: 0, duration: 0.2 })
  }
  await wait(220)
}

function onKeydown(e: KeyboardEvent) {
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); if (!autoSpinEnabled.value) spin() }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!-- Jungle background, scoped to the page (not the sidebar) -->
  <div class="page-root relative min-h-full flex flex-col items-center overflow-hidden px-3 py-5 sm:py-6">
    <div class="page-bg" />
    <div class="page-vignette" />

    <!-- ── Title ── -->
    <div class="xs-title relative z-[1] mb-3 sm:mb-4 text-center">
      <h1 class="xs-title__text">
        <span class="xs-title__emoji">🌿</span>
        Xeno Slot
        <span class="xs-title__emoji">🌺</span>
      </h1>
      <div class="mt-2.5 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        <span class="xs-badge xs-badge--rtp">98% RTP</span>
        <span class="xs-badge xs-badge--lines">{{ XENOSLOT_LINES }} Lines</span>
        <span class="xs-badge xs-badge--hold">Hold &amp; Win</span>
        <span class="xs-badge xs-badge--vol"><SlotVolatility :level="XS_VOLATILITY" /></span>
        <span class="xs-badge xs-badge--maxwin">{{ formatNumber(XS_DISPLAY_MAX_WIN, false, 0) }}x max win</span>
      </div>
    </div>

    <div class="game-layout relative w-full max-w-[760px] flex flex-col">
      <!-- Buy bonus — sits above the card on mobile, floats to its left from lg up -->
      <button
        :disabled="!ready || isSpinning || autoSpinEnabled || balance < buyBonusCost"
        class="relative mx-auto mb-3 aspect-[3/2] w-[190px] cursor-pointer border-0 bg-[url('/slots/xenoslot/buy_bonus.png')] bg-contain bg-center bg-no-repeat p-0 drop-shadow-[0_6px_16px_rgba(0,0,0,0.55)] transition-transform duration-150 hover:scale-[1.04] active:scale-[0.97] disabled:cursor-default disabled:opacity-45 disabled:grayscale-[70%] lg:absolute lg:right-full lg:top-0 lg:mx-0 lg:mb-0 lg:w-[260px]"
        @click="spin(true)"
      >
        <span class="pointer-events-none absolute inset-x-0 bottom-[28%] text-center font-mono text-base font-black tracking-wide text-[#fff7d6] [text-shadow:0_2px_3px_rgba(0,0,0,0.65),0_0_10px_rgba(250,204,21,0.5)] lg:text-xl">{{ formatNumber(buyBonusCost, false) }}</span>
      </button>

      <!-- Slot machine -->
      <div class="machine w-full flex flex-col">
        <!-- ── Reel area ── -->
        <div
          class="reel-area relative select-none"
          @click="onCanvasClick"
        >
          <div class="reel-sheen" />

          <!-- Bonus banner -->
          <Transition name="pop">
            <div
              v-if="bonusBanner"
              class="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
            >
              <div class="bonus-banner text-center">
                <p class="text-3xl font-black text-white tracking-tight drop-shadow-lg">
                  HOLD &amp; WIN
                </p>
                <p
                  class="text-sm font-bold mt-1"
                  style="color: #dcfce7;"
                >
                  {{ BONUS_FREE_SPINS }} free spins — collect the treasure!
                </p>
              </div>
            </div>
          </Transition>

          <!-- Big win showcase -->
          <Transition name="pop">
            <div
              v-if="bigWinBanner"
              class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 bg-[rgba(3,10,5,0.82)] backdrop-blur-[4px]"
              :style="{ '--tier': bigWinIntensity }"
            >
              <p
                class="xs-bigwin-label"
                :style="{ backgroundImage: bigWinGradient, filter: `drop-shadow(0 0 22px ${bigWinGlow})` }"
              >
                {{ bigWinLabel }}
              </p>
              <strong class="xs-bigwin-amount">
                {{ formatNumber(bigWinAmount, false) }}
              </strong>
            </div>
          </Transition>

          <!-- Auto-spin pause overlay -->
          <Transition name="pop">
            <div
              v-if="autoSpinPaused"
              class="absolute inset-0 z-20 flex items-center justify-center cursor-pointer"
              style="background: rgba(6,20,8,0.78); backdrop-filter: blur(3px);"
            >
              <div class="pause-card text-center px-6 py-4">
                <p class="font-black text-white text-base">
                  🍀 Bonus! Tap to play
                </p>
                <p
                  class="text-xs mt-1"
                  style="color: rgba(187,247,208,0.7);"
                >
                  {{ autoSpinsLeft }} spin{{ autoSpinsLeft !== 1 ? 's' : '' }} remaining
                </p>
              </div>
            </div>
          </Transition>

          <!-- Canvas -->
          <div
            ref="canvasWrap"
            class="relative z-10 w-full [&>canvas]:!w-full [&>canvas]:!h-auto [&>canvas]:block"
          />

          <!-- Loading -->
          <div
            v-if="!ready && !errorMsg"
            class="absolute inset-0 z-40 flex items-center justify-center"
          >
            <UIcon
              class="size-10 animate-spin"
              name="i-lucide-loader-circle"
              style="color: #86efac;"
            />
          </div>
        </div>

        <!-- ── Control bar (attached below the board) ── -->
        <div class="ctrl-bar flex items-center gap-2 sm:gap-5 px-4 py-3.5 sm:px-5 sm:py-4">
          <!-- LEFT: icons + credit/bet -->
          <div class="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
            <!-- Action icons stacked -->
            <div class="flex flex-col gap-1.5 shrink-0">
              <button
                class="icon-btn"
                title="Help"
                @click="showHelp = true"
              >
                <UIcon
                  class="size-3.5"
                  name="i-lucide-info"
                />
              </button>
              <button
                :class="{ 'icon-btn--active': turbo }"
                class="icon-btn"
                title="Turbo"
                @click="turbo = !turbo"
              >
                <UIcon
                  class="size-3.5"
                  name="i-lucide-zap"
                />
              </button>
            </div>

            <!-- Credit + Bet readouts -->
            <div class="min-w-0 flex flex-col gap-1.5">
              <div class="readout w-full flex justify-between">
                <span class="ctrl-value truncate">
                  <CoinBalance
                    :compact="false"
                    :value="balance"
                  />
                </span>
              </div>
              <div class="readout w-full justify-between">
                <span class="ctrl-label">Bet</span>
                <input
                  v-model="betInput"
                  :disabled="isSpinning || autoSpinEnabled"
                  aria-label="Bet amount"
                  class="bet-input ctrl-value tabular-nums"
                  inputmode="numeric"
                  @blur="commitBetInput"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                >
              </div>
            </div>
          </div>

          <!-- CENTER: WIN / bonus total -->
          <div class="flex flex-col items-center justify-center shrink-0 min-w-[84px]">
            <div
              v-if="inBonus"
              class="text-center"
            >
              <p
                class="text-[9px] uppercase tracking-[0.2em] mb-1"
                style="color: rgba(187,247,208,0.55);"
              >
                {{ bonusStatus }}
              </p>
              <p class="text-xl font-black tabular-nums leading-none text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.5)]">
                {{ formatNumber(bonusTotal, false) }}
              </p>
            </div>

            <template v-else>
              <span class="ctrl-label mb-1">Win</span>
              <Transition
                mode="out-in"
                name="pop"
              >
                <span
                  v-if="winFlash && lastWin > 0"
                  key="win"
                  class="win-amount"
                >{{ formatNumber(lastWin, false) }}</span>
                <span
                  v-else
                  key="idle"
                  class="win-idle"
                >0.00</span>
              </Transition>
            </template>
          </div>

          <!-- RIGHT: ½ SPIN 2× / AUTO -->
          <div class="flex items-center gap-2 sm:gap-2.5 flex-1 justify-end">
            <!-- Halve bet -->
            <button
              :disabled="isSpinning || autoSpinEnabled || bet <= MIN_BET"
              class="adj-btn"
              title="Halve bet"
              @click="betDown"
            >
              <span class="text-sm font-black leading-none">½</span>
            </button>

            <!-- SPIN + AUTO stacked -->
            <div class="flex flex-col items-center gap-1.5">
              <button
                :disabled="!ready || balance < bet || isSpinning"
                class="spin-btn"
                @click="autoSpinEnabled ? stopAutoSpin() : spin()"
              >
                <span class="spin-btn__ring" />
                <UIcon
                  v-if="isSpinning"
                  class="size-6 animate-spin relative"
                  name="i-lucide-loader-circle"
                />
                <span
                  v-else-if="autoSpinEnabled"
                  class="flex flex-col items-center leading-none relative"
                >
                  <span class="text-[10px] tracking-wider opacity-80">{{ autoSpinsLeft }}×</span>
                  <span class="text-xs font-black">STOP</span>
                </span>
                <span
                  v-else
                  class="relative"
                >SPIN</span>
              </button>

              <button
                v-if="!autoSpinEnabled"
                :disabled="!ready || balance < bet || isSpinning"
                class="auto-btn"
                @click="showAutoSpinModal = true"
              >
                AUTO
              </button>
              <button
                v-else
                class="auto-btn auto-btn--stop"
                @click="stopAutoSpin"
              >
                STOP
              </button>
            </div>

            <!-- Double bet -->
            <button
              :disabled="isSpinning || autoSpinEnabled || bet >= MAX_BET"
              class="adj-btn"
              title="Double bet"
              @click="betUp"
            >
              <span class="text-xs font-black leading-none">2×</span>
            </button>
          </div>
        </div>

        <!-- Error strip -->
        <Transition name="fade-up">
          <div
            v-if="errorMsg"
            class="error-strip flex items-center justify-between gap-3 px-4 py-2"
          >
            <p class="text-xs text-red-300">
              {{ errorMsg }}
            </p>
            <button
              class="text-red-300/50 hover:text-red-200 text-sm transition-colors"
              @click="errorMsg = ''"
            >
              ✕
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- History -->
    <div class="relative z-[1] min-h-8">
      <div
        v-if="history.length"
        class="flex gap-1.5 flex-wrap justify-center mt-3"
      >
        <span
          v-for="(h, i) in history"
          :key="i"
          :class="h.payout > h.bet ? 'bg-emerald-500/15 text-emerald-300' : 'text-white/25'"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold"
          style="background: rgba(255,255,255,0.04);"
        >
          <UIcon
            v-if="h.bonus"
            class="size-3"
            name="i-lucide-gift"
          />
          {{ h.payout > 0 ? formatNumber(h.payout) : '—' }}
        </span>
      </div>
    </div>

    <!-- Auto-spin modal -->
    <UModal
      v-model:open="showAutoSpinModal"
      title="Auto Spin"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Select number of spins. Auto-spin pauses before a bonus round so you can watch — tap the board to resume.
          </p>
          <div class="grid grid-cols-5 gap-2">
            <UButton
              v-for="count in AUTO_SPIN_OPTIONS"
              :key="count"
              block
              class="font-bold"
              color="neutral"
              variant="soft"
              @click="startAutoSpin(count)"
            >
              {{ count }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Help modal -->
    <UModal
      v-model:open="showHelp"
      title="How Xeno Slot works"
    >
      <template #body>
        <div class="space-y-4 text-sm text-muted">
          <ul class="space-y-1.5 list-disc list-inside">
            <li>Match <strong class="text-default">3, 4 or 5</strong> of the same symbol left-to-right on any of the <strong class="text-default">{{ XENOSLOT_LINES }} paylines</strong>. The <strong class="text-default">WILD</strong> plaque substitutes for any symbol.</li>
            <li>Land <strong class="text-default">3+ clover scatters</strong> anywhere to trigger <strong class="text-default">Hold &amp; Win</strong> (~1 in {{ formatNumber(bonusOdds, true, 0) }} spins).</li>
          </ul>

          <!-- Paytable -->
          <div>
            <p class="text-xs uppercase tracking-wide text-muted font-medium mb-2">
              Pays × your bet
            </p>
            <div class="rounded-lg border border-default overflow-hidden">
              <div class="grid grid-cols-[auto_1fr] text-xs text-muted bg-elevated/60 border-b border-default">
                <div class="px-3 py-1" />
                <div class="px-3 py-1 flex justify-end gap-3 font-medium">
                  <span class="w-10 text-right">3×</span>
                  <span class="w-10 text-right">4×</span>
                  <span class="w-10 text-right text-default">5×</span>
                </div>
              </div>
              <div class="grid grid-cols-[auto_1fr] items-center text-sm">
                <template
                  v-for="(row, i) in paytableRows"
                  :key="row.sym"
                >
                  <div
                    class="px-3 py-1.5 flex items-center justify-center"
                    :class="i % 2 ? 'bg-elevated/40' : ''"
                  >
                    <span
                      class="rounded-md bg-no-repeat"
                      :style="tileStyle(row.sym)"
                    />
                  </div>
                  <div
                    class="px-3 py-1.5 font-mono tabular-nums flex justify-end gap-3"
                    :class="i % 2 ? 'bg-elevated/40' : ''"
                  >
                    <span class="w-10 text-right text-muted">{{ row.pays[0] }}×</span>
                    <span class="w-10 text-right text-muted">{{ row.pays[1] }}×</span>
                    <span class="w-10 text-right font-bold text-default">{{ row.pays[2] }}×</span>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <!-- Bonus mechanics -->
          <div>
            <p class="text-xs uppercase tracking-wide text-muted font-medium mb-2">
              Hold &amp; Win bonus
            </p>
            <ul class="space-y-1.5 list-disc list-inside">
              <li><strong class="text-default">{{ BONUS_FREE_SPINS }} spins.</strong> Coins stick to the board as <strong class="text-default">metal medallions</strong> — bronze → silver → gold → emerald as the value climbs.</li>
              <li><strong class="text-default">🍀 Glovers</strong> (<span class="text-success font-bold">×2</span> / <span class="text-success font-bold">×5</span> / <span class="text-success font-bold">×10</span>) multiply all adjacent coins, then vanish.</li>
              <li><strong class="text-default">Treasure chests</strong> spring open and collect every coin on the board, then wipe it clean. <strong class="text-default">Only collected coins pay out</strong> — max {{ formatNumber(XS_DISPLAY_MAX_WIN, false, 0) }}× bet.</li>
              <li><strong class="text-default">Buy Bonus</strong> skips straight to the feature for {{ formatNumber(buyBonusCost, false) }} ({{ XENOSLOT_BUY_BONUS_COST }}× bet).</li>
            </ul>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
/* ── Page background, scoped to the main content area ───────────────────── */
.page-root {
  min-height: 100%;
}

.page-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: url('/slots/xenoslot/xenoslot_bg.png') center / cover no-repeat;
}

/* dark vignette so the machine pops and the art doesn't compete with it */
.page-vignette {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
      radial-gradient(ellipse 62% 44% at 50% 35%, rgba(255, 232, 129, 0.12) 0%, rgba(22, 163, 74, 0.08) 34%, transparent 68%),
      radial-gradient(ellipse 78% 66% at 50% 42%, rgba(4, 16, 6, 0.28) 0%, rgba(4, 16, 6, 0.68) 66%, rgba(2, 10, 4, 0.94) 100%);
}

.page-root > .game-layout {
  position: relative;
  z-index: 1;
}

/* ── Title ──────────────────────────────────────────────────────────────── */
.xs-title__text {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: clamp(30px, 6vw, 46px);
  font-weight: 900;
  letter-spacing: 0.5px;
  line-height: 1;
  /* glossy leaf-to-gold gradient poured top-to-bottom over the letters */
  background: linear-gradient(180deg, #f0fff4 0%, #bbf7d0 30%, #4ade80 60%, #f5c518 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  filter: drop-shadow(0 2px 0 rgba(6, 46, 22, 0.6))
  drop-shadow(0 6px 16px rgba(22, 163, 74, 0.5));
}

.xs-title__emoji {
  -webkit-text-fill-color: initial;
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.45));
}

.xs-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 11px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #fff;
  background: rgba(6, 20, 8, 0.5);
  border: 1px solid rgba(74, 222, 128, 0.3);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(2px);
}

.xs-badge--rtp {
  color: #bbf7d0;
  border-color: rgba(52, 211, 153, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 12px rgba(52, 211, 153, 0.28);
}

.xs-badge--lines {
  color: #d9f99d;
  border-color: rgba(132, 204, 22, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 12px rgba(132, 204, 22, 0.28);
}

.xs-badge--vol {
  color: #bae6fd;
  border-color: rgba(56, 189, 248, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 12px rgba(56, 189, 248, 0.28);
}

.xs-badge--maxwin {
  color: #fecaca;
  border-color: rgba(248, 113, 113, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 12px rgba(248, 113, 113, 0.28);
}

.xs-badge--hold {
  color: #fde68a;
  border-color: rgba(245, 197, 24, 0.55);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 12px rgba(245, 197, 24, 0.3);
}

/* ── Machine shell ──────────────────────────────────────────────────────── */
.machine {
  border-radius: 24px;
  padding: 10px;
  background:
      linear-gradient(180deg, rgba(239, 255, 244, 0.22), transparent 9%),
      linear-gradient(160deg, rgba(74, 222, 128, 0.3), rgba(21, 94, 43, 0.18) 42%, rgba(4, 18, 8, 0.78));
  box-shadow:
      0 0 0 1px rgba(74, 222, 128, 0.42),
      0 0 0 4px rgba(3, 14, 5, 0.5),
      inset 0 1px 0 rgba(220, 252, 231, 0.28),
      inset 0 -18px 28px rgba(0, 0, 0, 0.18),
      0 0 72px rgba(22, 163, 74, 0.28),
      0 34px 88px rgba(0, 0, 0, 0.88);
  backdrop-filter: blur(2px);
}

/* ── Reel area ──────────────────────────────────────────────────────────── */
.reel-area {
  background:
      linear-gradient(90deg, rgba(255, 255, 255, 0.04), transparent 10%, transparent 90%, rgba(255, 255, 255, 0.035)),
      radial-gradient(ellipse 120% 78% at 50% 0%, #23652f 0%, #16461f 30%, #0d2a13 58%, #08200c 82%, #061708 100%);
  border-radius: 17px 17px 0 0;
  box-shadow:
      inset 0 0 0 1px rgba(187, 247, 208, 0.18),
      inset 0 0 0 5px rgba(3, 18, 7, 0.32),
      inset 0 2px 22px rgba(0, 0, 0, 0.42);
  cursor: default;
  overflow: hidden;
}

.reel-sheen {
  position: absolute;
  inset: 0;
  z-index: 15;
  pointer-events: none;
  background:
      radial-gradient(ellipse 72% 48% at 50% 105%, rgba(0, 0, 0, 0.42) 0%, transparent 64%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.1) 0%, transparent 16%),
      linear-gradient(90deg, rgba(0, 0, 0, 0.28), transparent 7%, transparent 93%, rgba(0, 0, 0, 0.28));
}

/* ── Bonus / pause overlays ─────────────────────────────────────────────── */
.bonus-banner {
  padding: 20px 32px;
  border-radius: 18px;
  transform: rotate(-2deg);
  background: linear-gradient(135deg, #16a34a, #ca8a04);
  box-shadow: 0 8px 40px rgba(22, 163, 74, 0.55);
}

.pause-card {
  border-radius: 14px;
  background: rgba(8, 26, 12, 0.95);
  border: 1px solid rgba(74, 222, 128, 0.35);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

/* ── Control bar (attached below the board, jungle palette) ─────────────── */
.ctrl-bar {
  background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.045), transparent 20%),
      linear-gradient(180deg, #102d14 0%, #071909 100%);
  border-top: 1px solid rgba(187, 247, 208, 0.22);
  border-radius: 0 0 18px 18px;
  box-shadow:
      inset 0 1px 0 rgba(220, 252, 231, 0.14),
      inset 0 -1px 0 rgba(0, 0, 0, 0.65);
}

/* Credit / Bet readout chips */
.readout {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 7px 13px;
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.36));
  box-shadow:
      inset 0 0 0 1px rgba(74, 222, 128, 0.18),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.ctrl-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 700;
  color: rgba(187, 247, 208, 0.45);
  flex-shrink: 0;
}

.ctrl-value {
  font-family: ui-monospace, monospace;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.01em;
}

/* Editable bet field — looks like the readout value, free typing for any stake */
.bet-input {
  min-width: 0;
  flex: 1;
  text-align: right;
  background: transparent;
  border: none;
  outline: none;
  padding: 0;
  appearance: textfield;
}

.bet-input:focus {
  color: #fde047;
}

.bet-input:disabled {
  opacity: 0.6;
  cursor: default;
}

.bet-input::-webkit-inner-spin-button,
.bet-input::-webkit-outer-spin-button {
  appearance: none;
  margin: 0;
}

/* Win amount */
.win-amount {
  font-size: 25px;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: #fde047;
  text-shadow: 0 0 18px rgba(250, 204, 21, 0.6), 0 1px 1px rgba(0, 0, 0, 0.4);
}

.win-idle {
  font-size: 25px;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: rgba(187, 247, 208, 0.18);
}

/* Info / Turbo icon buttons */
.icon-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(0, 0, 0, 0.16));
  color: rgba(187, 247, 208, 0.5);
  border: 1px solid rgba(74, 222, 128, 0.2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.icon-btn:hover {
  background: rgba(74, 222, 128, 0.18);
  color: #fff;
  border-color: rgba(74, 222, 128, 0.4);
}

.icon-btn--active {
  background: rgba(250, 204, 21, 0.18);
  color: #fde047;
  border-color: rgba(250, 204, 21, 0.4);
  box-shadow: 0 0 10px rgba(250, 204, 21, 0.3);
}

/* Bet adjustment ½ / 2× buttons */
.adj-btn {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(235, 255, 240, 0.85);
  background:
      radial-gradient(circle at 50% 26%, rgba(220, 252, 231, 0.16) 0%, transparent 32%),
      radial-gradient(circle at 50% 30%, #23652f 0%, #0d2a13 100%);
  border: 1px solid rgba(74, 222, 128, 0.35);
  box-shadow: inset 0 1px 0 rgba(187, 247, 208, 0.2), 0 2px 6px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: filter 0.15s, transform 0.1s;
}

.adj-btn:hover:not(:disabled) {
  filter: brightness(1.3);
}

.adj-btn:active:not(:disabled) {
  transform: scale(0.92);
}

.adj-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

/* SPIN button — gold gem */
.spin-btn {
  position: relative;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #4a3206;
  background: radial-gradient(circle at 50% 28%, #fef3c7 0%, #fbdf6b 34%, #f5c518 66%, #b8860b 100%);
  box-shadow:
      0 6px 0 #7a5a06,
      0 13px 30px rgba(245, 197, 24, 0.48),
      0 0 0 4px rgba(58, 35, 4, 0.26),
      inset 0 2px 4px rgba(255, 255, 255, 0.58);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
  cursor: pointer;
  transition: transform 0.08s, box-shadow 0.08s, filter 0.15s, opacity 0.15s;
  border: none;
  outline: none;
}

/* glossy ring */
.spin-btn__ring {
  position: absolute;
  inset: 6px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0%, transparent 45%);
  pointer-events: none;
}

.spin-btn:hover:not(:disabled) {
  filter: brightness(1.06);
}

.spin-btn:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: 0 2px 0 #7a5a06, 0 6px 16px rgba(245, 197, 24, 0.38), inset 0 2px 4px rgba(255, 255, 255, 0.45);
}

.spin-btn:disabled {
  opacity: 0.5;
  cursor: default;
  filter: saturate(0.6);
}

/* AUTO / STOP text button */
.auto-btn {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.24em;
  font-weight: 800;
  color: rgba(187, 247, 208, 0.5);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
  padding: 0;
}

.auto-btn:hover:not(:disabled) {
  color: #dcfce7;
}

.auto-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.auto-btn--stop {
  color: rgba(248, 113, 113, 0.75);
}

.auto-btn--stop:hover {
  color: #f87171;
}

.error-strip {
  background: rgba(87, 29, 29, 0.55);
  border-top: 1px solid rgba(185, 28, 28, 0.4);
  border-radius: 0 0 16px 16px;
}

@media (max-width: 480px) {
  .machine {
    border-radius: 18px;
    padding: 6px;
  }

  .reel-area {
    border-radius: 13px 13px 0 0;
  }

  .ctrl-bar {
    border-radius: 0 0 14px 14px;
  }

  .readout {
    min-height: 30px;
    padding: 5px 9px;
  }

  .ctrl-value {
    font-size: 12px;
  }

  .icon-btn {
    width: 30px;
    height: 30px;
  }

  .adj-btn {
    width: 34px;
    height: 34px;
  }

  .spin-btn {
    width: 70px;
    height: 70px;
    font-size: 13px;
  }
}

/* ── Transitions ────────────────────────────────────────────────────────── */
.fade-up-enter-active, .fade-up-leave-active {
  transition: all 0.2s ease;
}

.fade-up-enter-from, .fade-up-leave-to {
  opacity: 0;
  transform: translateY(5px);
}

.pop-enter-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.pop-leave-active {
  transition: all 0.18s ease;
}

.pop-enter-from {
  opacity: 0;
  transform: scale(0.7);
}

.pop-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

.xs-bigwin-label {
  margin: 0;
  font-size: calc(26px + var(--tier, 1) * 6px);
  font-weight: 950;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  animation: xs-bigwin-pop 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both;
}

.xs-bigwin-amount {
  font-size: calc(34px + var(--tier, 1) * 9px);
  font-weight: 950;
  line-height: 1;
  color: rgb(220, 252, 231);
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.6), 0 0 26px rgba(74, 222, 128, 0.55);
  animation: xs-bigwin-pop 0.5s 0.08s cubic-bezier(0.2, 1.4, 0.4, 1) both;
}

@keyframes xs-bigwin-pop {
  0% {
    transform: scale(0.4);
    opacity: 0;
  }
  60% {
    transform: scale(1.12);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
