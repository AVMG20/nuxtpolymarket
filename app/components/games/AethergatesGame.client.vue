<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  AetherBonusTier,
  AetherFeature,
  AetherGatesResult,
  AetherPaySymbol,
  AetherSequence,
  AetherStep,
  AetherSymbol,
  Cell,
  MultDrop
} from '#shared/utils/gamelogic/aethergates'
import {
  AETHER_MULT_VALUES_BASE,
  AETHER_MULT_VALUES_BONUS,
  AETHER_MULTIPLIER_WEIGHT,
  AETHER_PAY_SYMBOLS,
  AETHER_SCATTER_WEIGHT,
  AETHER_SYMBOL_WEIGHTS,
  AG_BONUS_CHANCE_COST,
  AG_BUY_FREESPINS_COST,
  AG_BUY_SUPERBONUS_COST,
  AG_CELLS,
  AG_COLS,
  AG_FREE_SPINS,
  AG_FREE_SPINS_SUPER,
  AG_MIN_MATCH,
  AG_RETRIGGER_SPINS,
  AG_ROWS,
  AG_SCATTER_TRIGGER,
  AG_SCATTER_TRIGGER_SUPER,
  aetherPayMult
} from '#shared/utils/gamelogic/aethergates'
import { initSlotPixiApp, safeDestroy } from '~/utils/slot-pixi'

// Realistic max win shown to players, derived from a 2M-spin Monte Carlo run
// (scripts/aethergates-rtp.ts — observed max ~532x). AG_MAX_WIN_MULT (10,000x)
// is the server-enforced hard cap but is an extreme, near-unreachable outlier.
const AG_DISPLAY_MAX_WIN = 1000
// Volatility rating (1-5 zaps) — see SlotVolatility.vue. Lowest observed max
// win of the four slots puts Aether Gates at the bottom tier.
const AG_VOLATILITY = 1

const { fetchSession } = useAuth()
const { bet, isSpinning, errorMsg, balance, setBalance, history, pushHistory, spin: requestSpin } = useSlotGame<AetherGatesResult, { payout: number, bet: number, bonus: boolean }>('aethergates')

// --- bet control
const MIN_BET = 1
const MAX_BET = 100_000_000_000
const betInput = ref('10')
watch(bet, (v) => {
  betInput.value = String(v)
}, { immediate: true })

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

function betDown() {
  setBet(Math.floor(bet.value / 2))
}

function betUp() {
  setBet(bet.value * 2)
}

// --- feature buys
const bonusChanceMode = ref(false)
const buyFreeSpinsCost = computed(() => bet.value * AG_BUY_FREESPINS_COST)
const superBonusCost = computed(() => bet.value * AG_BUY_SUPERBONUS_COST)
const bonusChanceCost = computed(() => bet.value * AG_BONUS_CHANCE_COST)

function costFor(feature?: AetherFeature): number {
  if (feature === 'buyFreeSpins') return buyFreeSpinsCost.value
  if (feature === 'superBonus') return superBonusCost.value
  if (feature === 'bonusChance') return bonusChanceCost.value
  return bet.value
}

const spinCost = computed(() => costFor(bonusChanceMode.value ? 'bonusChance' : undefined))

function toggleBonusChance() {
  if (isSpinning.value || autoSpinEnabled.value) return
  bonusChanceMode.value = !bonusChanceMode.value
}

function buyFreeSpins() {
  if (!ready.value || isSpinning.value || autoSpinEnabled.value || balance.value < buyFreeSpinsCost.value) return
  spin('buyFreeSpins')
}

function buySuperBonus() {
  if (!ready.value || isSpinning.value || autoSpinEnabled.value || balance.value < superBonusCost.value) return
  spin('superBonus')
}

// --- round state
const turbo = ref(false)
const showHelp = ref(false)
const ready = ref(false)

const lastWin = ref(0)
const winFlash = ref(false)
const winPulse = ref(false)
const meter = ref(0)
const meterFlash = ref(false)

const bonusBanner = ref(false)
const bonusBannerTier = ref<AetherBonusTier>('normal')
const retriggerBanner = ref(false)
const inBonus = ref(false)
const bonusSpinLabel = ref('')

const bigWinBanner = ref(false)
const bigWinLabel = ref('')
const bigWinAmount = ref(0)
const bigWinGradient = ref('')
const bigWinGlow = ref('')
const bigWinIntensity = ref(1)

const flying = ref<{ id: number, value: number, style: Record<string, string> }[]>([])
let flyId = 0

// --- auto-spin state
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

const bonusOdds = computed(() => {
  const total = Object.values(AETHER_SYMBOL_WEIGHTS).reduce((a, b) => a + b, 0) + AETHER_SCATTER_WEIGHT + AETHER_MULTIPLIER_WEIGHT
  const p = AETHER_SCATTER_WEIGHT / total
  const q = 1 - p
  const choose = (n: number, k: number) => {
    let r = 1
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1)
    return r
  }
  let pLess = 0
  for (let k = 0; k < AG_SCATTER_TRIGGER; k++) pLess += choose(AG_CELLS, k) * p ** k * q ** (AG_CELLS - k)
  const pTrigger = 1 - pLess
  return pTrigger > 0 ? Math.round(1 / pTrigger) : 0
})

// --- sound effects (synthesized with the Web Audio API — no asset files)
const muted = ref(false)
let audioCtx: AudioContext | null = null

function toggleMute() {
  muted.value = !muted.value
  if (import.meta.client) localStorage.setItem('ag_muted', muted.value ? '1' : '0')
  if (!muted.value) blip(660, 0.06, 'sine', 0.1)
}

function ensureAudio(): AudioContext | null {
  if (muted.value || !import.meta.client) return null
  if (!audioCtx) {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctx) return null
    audioCtx = new Ctx()
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  return audioCtx
}

function blip(freq: number, dur = 0.12, type: OscillatorType = 'sine', gain = 0.16) {
  const ctx = ensureAudio()
  if (!ctx) return
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

function sweep(from: number, to: number, dur = 0.18, type: OscillatorType = 'triangle', gain = 0.18) {
  const ctx = ensureAudio()
  if (!ctx) return
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

const sfx = {
  spin: () => sweep(200, 420, 0.16, 'sawtooth', 0.1),
  pop: (chain = 1) => blip(500 + Math.min(chain, 12) * 55, 0.1, 'triangle', 0.14),
  mult: () => blip(880, 0.12, 'square', 0.12),
  win: () => sweep(440, 980, 0.26, 'triangle', 0.18),
  bonus: () => [392, 523, 659, 880].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.2), i * 110)),
  retrigger: () => [659, 880, 1108].forEach((f, i) => setTimeout(() => blip(f, 0.16, 'square', 0.16), i * 90))
}

onMounted(() => {
  if (import.meta.client && localStorage.getItem('ag_muted') === '1') muted.value = true
})

// Sprite crop rects live in app/utils/aethergates-sprite.ts (single source of
// truth shared with the /games/aethergates-sprite-debug tuning page).
const SPRITE_SRC = AETHER_SPRITE_SRC
const SHEET_W = AETHER_SHEET_W
const SHEET_H = AETHER_SHEET_H
const symbolMeta = AETHER_SYMBOL_META

function tileStyle(sym: AetherPaySymbol, w = 40): Record<string, string> {
  const [x, y, tw, th] = symbolMeta[sym].rect
  const h = Math.round(w * th / tw)
  const sx = w / tw
  const sy = h / th
  return {
    width: `${w}px`,
    height: `${h}px`,
    backgroundImage: `url(${SPRITE_SRC})`,
    backgroundSize: `${Math.round(SHEET_W * sx)}px ${Math.round(SHEET_H * sy)}px`,
    backgroundPosition: `-${Math.round(x * sx)}px -${Math.round(y * sy)}px`
  }
}

const paytableRows = [...AETHER_PAY_SYMBOLS].reverse().map(sym => ({
  sym,
  pays: [8, 10, 12, 15, 20].map(count => Math.round(aetherPayMult(sym, count) * 1000) / 1000)
}))

function wait(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function stepDelay(ms: number) {
  return wait(turbo.value ? Math.round(ms * 0.45) : ms)
}

function randomGrid(): AetherSymbol[][] {
  const grid: AetherSymbol[][] = []
  for (let col = 0; col < AG_COLS; col++) {
    const column: AetherSymbol[] = []
    for (let row = 0; row < AG_ROWS; row++) {
      column.push(AETHER_PAY_SYMBOLS[Math.floor(Math.random() * AETHER_PAY_SYMBOLS.length)]!)
    }
    grid.push(column)
  }
  return grid
}

const tickRuns = new WeakMap<Ref<number>, number>()

function tickNumber(target: Ref<number>, to: number, duration = 480, respectTurbo = true) {
  const run = (tickRuns.get(target) ?? 0) + 1
  tickRuns.set(target, run)
  const from = target.value
  const start = performance.now()
  const d = respectTurbo && turbo.value ? Math.round(duration * 0.45) : duration
  const frame = (now: number) => {
    if (tickRuns.get(target) !== run) return
    const t = Math.min(1, (now - start) / d)
    const eased = 1 - (1 - t) ** 3
    target.value = from + (to - from) * eased
    if (t < 1) requestAnimationFrame(frame)
    else target.value = to
  }
  requestAnimationFrame(frame)
}

// Escalating "big win" showcase shown once a round clears a threshold — tuned
// well below Fire in the Hole's tiers since Aether Gates' realistic max win
// (~532x, displayed as AG_DISPLAY_MAX_WIN) is a fraction of that game's.
const WIN_TIERS = [
  { threshold: 700, rank: 6, label: 'ULTRA WIN', from: '#f0abfc', to: '#a855f7', glow: 'rgba(168,85,247,0.75)' },
  { threshold: 400, rank: 5, label: 'SUPER WIN', from: '#fda4af', to: '#e11d48', glow: 'rgba(225,29,72,0.7)' },
  { threshold: 200, rank: 4, label: 'MEGA WIN', from: '#fdba74', to: '#ea580c', glow: 'rgba(234,88,12,0.7)' },
  { threshold: 100, rank: 3, label: 'GREAT WIN', from: '#fde047', to: '#ca8a04', glow: 'rgba(202,138,4,0.65)' },
  { threshold: 50, rank: 2, label: 'BIG WIN', from: '#86efac', to: '#16a34a', glow: 'rgba(22,163,74,0.6)' },
  { threshold: 25, rank: 1, label: 'NICE WIN', from: '#7dd3fc', to: '#0284c7', glow: 'rgba(2,132,199,0.55)' }
] as const

async function showBigWinPopup(totalMultiplier: number, amount: number) {
  const tier = WIN_TIERS.find(t => totalMultiplier >= t.threshold)
  if (!tier) return

  bigWinLabel.value = tier.label
  bigWinGradient.value = `linear-gradient(180deg, ${tier.from}, ${tier.to})`
  bigWinGlow.value = tier.glow
  bigWinIntensity.value = tier.rank
  bigWinAmount.value = 0
  bigWinBanner.value = true

  tickNumber(bigWinAmount, amount, 1400, false)
  await wait(2200)
  bigWinBanner.value = false
}

// Pixi / pixi-reels state. Kept outside Vue reactivity because Pixi objects do
// not enjoy being proxied.
const canvasWrap = ref<HTMLDivElement>()
const meterRef = ref<HTMLElement>()
let app: any = null
let reelSet: any = null
let overlayLayer: any = null
let particleLayer: any = null
let floatLayer: any = null
let PIXI: any = null
let REELS: any = null
let GSAP: any = null
let destroyed = false

const TEX: Record<string, any> = {}
// Relic values for whatever grid is about to be placed (initial reveal or a
// cascade refill). Primed right before each reelSet.setResult()/nextGrid()
// call, consumed by the 'cascade:place:end' handler so values are baked
// onto tiles before the drop-in tween starts — see AGENTS.md in pixi-reels:
// "the canonical spot to apply per-symbol decorations... so they fall WITH
// the symbol."
let pendingMults: MultDrop[] = []

function applyPendingMults(info: { reelIndex: number, placedSymbols: readonly any[] }) {
  for (const drop of pendingMults) {
    if (drop.col !== info.reelIndex) continue
    info.placedSymbols[drop.row]?.setMultValue?.(drop.value)
  }
}

const CELL = 88
const GAP = 7
const REEL_W = AG_COLS * CELL + (AG_COLS - 1) * GAP
const REEL_H = AG_ROWS * CELL + (AG_ROWS - 1) * GAP
const APP_W = REEL_W + 26
const APP_H = REEL_H + 26
const OFFSET_X = (APP_W - REEL_W) / 2
const OFFSET_Y = (APP_H - REEL_H) / 2

const POP_COLOR: Record<AetherSymbol, number> = {
  coin: 0x34d399, ring: 0x38bdf8, chalice: 0xa78bfa, laurel: 0x84cc16,
  lyre: 0xd8b4fe, helm: 0xf87171, sun: 0xfacc15, star: 0x93c5fd,
  scatter: 0xfbbf24, multiplier: 0x67e8f9
}

function cellLocal(col: number, row: number): { x: number, y: number } {
  return {
    x: OFFSET_X + col * (CELL + GAP) + CELL / 2,
    y: OFFSET_Y + row * (CELL + GAP) + CELL / 2
  }
}

function cellScreen(cell: Cell): { x: number, y: number } | null {
  const canvas = app?.canvas as HTMLCanvasElement | undefined
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const p = cellLocal(cell.col, cell.row)
  return {
    x: rect.left + (p.x / APP_W) * rect.width,
    y: rect.top + (p.y / APP_H) * rect.height
  }
}

function toTargets(grid: AetherSymbol[][]) {
  return grid.map(col => ({ visible: col }))
}

// Relic border glow ramps up in color as its rolled value climbs, so a big
// hit reads as "special" the instant it lands — not just once it's flying.
function multBorderColor(value: number): number {
  if (value >= 100) return 0xfde047 // gold — jackpot-tier relic
  if (value >= 50) return 0xfb923c // orange — huge
  if (value >= 25) return 0xf472b6 // pink — big
  if (value >= 10) return 0xa78bfa // violet — solid
  return 0x67e8f9 // cyan — default/small
}

function makeSymbolClass() {
  const { Container, Graphics, Sprite, Text } = PIXI
  const Base = REELS.ReelSymbol

  class AetherTile extends Base {
    frame = new Graphics()
    sprite = new Sprite()
    viewBox = new Container()
    labelBg = new Graphics()
    label = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 16,
        fontWeight: '900',
        fill: 0xffffff,
        align: 'center',
        stroke: { color: 0x082f49, width: 4, join: 'round' },
        dropShadow: { color: 0x67e8f9, blur: 5, distance: 0, alpha: 0.85 }
      }
    })

    w = CELL
    h = CELL
    value: number | undefined = undefined
    _tween: any = null

    constructor() {
      super()
      this.sprite.anchor.set(0.5)
      this.label.anchor.set(0.5)
      this.viewBox.addChild(this.sprite)
      this.viewBox.addChild(this.frame)
      this.viewBox.addChild(this.labelBg)
      this.viewBox.addChild(this.label)
      this.view.addChild(this.viewBox)
    }

    _render(id: string) {
      const tex = TEX[id]
      if (!tex) return
      // The sprite art already bakes in its own gold card frame, so the tile
      // just places it near edge-to-edge — no extra drawn border/shine on top.
      const isScatter = id === 'scatter'
      const isRelic = id === 'multiplier'
      const glow = isScatter ? 0xfbbf24 : isRelic ? multBorderColor(this.value ?? 0) : null
      const borderWidth = isRelic ? 3 : 2
      const max = Math.min(this.w, this.h) * 0.96
      const s = Math.min(max / tex.width, max / tex.height)

      this.frame.clear()
      if (glow) {
        this.frame.roundRect(2, 2, this.w - 4, this.h - 4, 12)
          .stroke({ color: glow, width: borderWidth, alpha: 0.75 })
      }
      this.sprite.texture = tex
      this.sprite.scale.set(s)
      this.sprite.position.set(this.w / 2, this.h / 2)

      this.label.x = this.w / 2
      this.label.y = this.h - 15
      this.labelBg.clear()
      if (isRelic && this.value) {
        this.labelBg.roundRect(-this.label.width / 2 - 6, -this.label.height / 2 - 3, this.label.width + 12, this.label.height + 6, 7)
          .fill({ color: multBorderColor(this.value), alpha: 0.4 })
        this.labelBg.position.set(this.label.x, this.label.y)
      }
    }

    // Sets the relic's rolled value — text + border color update together so
    // a big hit reads as "special" from the moment it lands on the board.
    setMultValue(value: number | undefined) {
      this.value = value
      this.label.text = value ? `×${value}` : ''
      this.label.alpha = 1
      if (this.symbolId === 'multiplier') this._render(this.symbolId)
    }

    // Quick fade right as the relic starts its flight into the meter, so the
    // static badge doesn't overlap the flying "×N" clone.
    fadeMultLabel(duration: number) {
      GSAP.to([this.label, this.labelBg], { alpha: 0, duration })
    }

    // A small grow-and-settle nudge on the value badge, timed with the
    // lightning strike so the number stays the readable focal point.
    pulseMultLabel(duration: number) {
      GSAP.fromTo(this.label.scale, { x: 1, y: 1 }, { x: 1.45, y: 1.45, duration: duration * 0.4, yoyo: true, repeat: 1, ease: 'back.out(2)' })
      GSAP.fromTo(this.labelBg.scale, { x: 1, y: 1 }, { x: 1.45, y: 1.45, duration: duration * 0.4, yoyo: true, repeat: 1, ease: 'back.out(2)' })
    }

    onActivate(id: string) {
      this.view.alpha = 1
      this.value = undefined
      this.label.text = ''
      this.label.alpha = 1
      this.labelBg.clear()
      this._render(id)
    }

    onDeactivate() {
      this._kill()
    }

    resize(w: number, h: number) {
      this.w = w
      this.h = h
      if (this.symbolId) this._render(this.symbolId)
    }

    stopAnimation() {
      this._kill()
      this.view.scale.set(1)
    }

    _kill() {
      if (this._tween) {
        this._tween.kill()
        this._tween = null
      }
      this.view.scale.set(1)
    }

    playWin() {
      this._kill()
      return new Promise<void>((resolve) => {
        this._tween = GSAP.to(this.view.scale, {
          x: 1.09,
          y: 1.09,
          duration: 0.12,
          yoyo: true,
          repeat: 1,
          ease: 'sine.inOut',
          onComplete: resolve
        })
      })
    }
  }

  return AetherTile
}

// --- relic burst particles (mirrors the Candy Madness "pop" effect)
function spawnPops(step: AetherStep) {
  if (!particleLayer) return
  const { Graphics } = PIXI
  const count = turbo.value ? 4 : 7
  for (const wc of step.winCells) {
    const sym = step.grid[wc.col]?.[wc.row] as AetherSymbol | undefined
    const color = sym ? (POP_COLOR[sym] ?? 0xffffff) : 0xffffff
    const p = cellLocal(wc.col, wc.row)
    for (let k = 0; k < count; k++) {
      const g = new Graphics()
      g.circle(0, 0, 2.5 + Math.random() * 4).fill({ color })
      g.position.set(p.x, p.y)
      particleLayer.addChild(g)
      const ang = Math.random() * Math.PI * 2
      const dist = 18 + Math.random() * 34
      const dur = 0.42 + Math.random() * 0.26
      GSAP.to(g, { x: p.x + Math.cos(ang) * dist, y: p.y + Math.sin(ang) * dist - 10, duration: dur, ease: 'power2.out' })
      GSAP.to(g.scale, { x: 0.1, y: 0.1, duration: dur, ease: 'power1.in' })
      GSAP.to(g, {
        alpha: 0,
        duration: dur,
        ease: 'power1.in',
        onComplete: () => {
          try {
            g.destroy()
          } catch { /* ignore */ }
        }
      })
    }
  }
}

function spawnWinText(step: AetherStep, sequence: AetherSequence, resultBet: number) {
  if (!PIXI || !GSAP || !floatLayer || step.stepPayMult <= 0) return
  const { Text } = PIXI
  const cells = step.winCells
  const meterMult = Math.max(1, sequence.meterAfter)
  const amount = step.stepPayMult * meterMult * resultBet
  const cx = cells.reduce((sum, c) => sum + cellLocal(c.col, c.row).x, 0) / cells.length
  const cy = cells.reduce((sum, c) => sum + cellLocal(c.col, c.row).y, 0) / cells.length
  const text = new Text({
    text: `+${formatNumber(amount, false)}`,
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 24,
      fontWeight: '900',
      fill: 0xfef3c7,
      align: 'center',
      stroke: { color: 0x082f49, width: 5, join: 'round' },
      dropShadow: { color: 0x000000, blur: 4, distance: 2, alpha: 0.45, angle: Math.PI / 2 }
    }
  })
  text.anchor.set(0.5)
  text.position.set(cx, cy)
  floatLayer.addChild(text)
  const dur = turbo.value ? 0.85 : 1.25
  GSAP.fromTo(text.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(2.6)' })
  GSAP.to(text, { y: cy - 42, duration: dur, ease: 'power1.out' })
  GSAP.to(text, {
    alpha: 0,
    duration: dur * 0.38,
    delay: dur * 0.62,
    ease: 'power1.in',
    onComplete: () => {
      try {
        text.destroy()
      } catch { /* ignore */ }
    }
  })
}

function spawnFlightSparks(from: { x: number, y: number }, midX: number, midY: number, endX: number, endY: number, duration: number) {
  if (!import.meta.client) return
  const count = 3
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div')
    el.className = 'ag-fly-spark'
    el.style.left = `${from.x}px`
    el.style.top = `${from.y}px`
    document.body.appendChild(el)
    el.animate([
      { transform: 'translate(-50%, -50%) scale(1)', offset: 0, opacity: 0.85 },
      { transform: `translate(${midX - from.x}px, ${midY - from.y}px) scale(0.5)`, offset: 0.55, opacity: 0.55 },
      { transform: `translate(${endX - from.x}px, ${endY - from.y}px) scale(0.1)`, offset: 1, opacity: 0 }
    ], {
      duration: duration * 0.9,
      delay: i * (duration * 0.09),
      easing: 'cubic-bezier(.18,.8,.2,1)',
      fill: 'forwards'
    }).finished.catch(() => {}).finally(() => el.remove())
  }
}

async function flyMultiplier(drop: MultDrop, toValue: number, normalSpeed = false) {
  const from = cellScreen(drop)
  const toEl = meterRef.value
  if (!from || !toEl || !import.meta.client) {
    meter.value = toValue
    return
  }

  // Fade the tile's own baked-in badge right as it starts flying so it
  // doesn't overlap the flying "×N" clone.
  const useTurboTiming = turbo.value && !normalSpeed
  reelSet?.getReel?.(drop.col)?.getSymbolAt?.(drop.row)?.fadeMultLabel?.(useTurboTiming ? 0.12 : 0.2)

  const to = toEl.getBoundingClientRect()
  const endX = to.left + to.width / 2
  const endY = to.top + to.height / 2
  const midX = (from.x + endX) / 2 + (endX > from.x ? 36 : -36)
  const midY = Math.min(from.y, endY) - 95
  const id = ++flyId
  flying.value.push({
    id,
    value: drop.value,
    style: {
      left: `${from.x}px`,
      top: `${from.y}px`
    }
  })

  await nextTick()
  const el = document.querySelector(`[data-fly="${id}"]`) as HTMLElement | null
  if (!el) {
    meter.value = toValue
    return
  }

  const duration = useTurboTiming ? 420 : 860
  let meterHitStarted = false
  const startMeterHit = () => {
    if (meterHitStarted) return
    meterHitStarted = true
    meterFlash.value = true
    tickNumber(meter, toValue, 300, !normalSpeed)
    setTimeout(() => {
      meterFlash.value = false
    }, useTurboTiming ? 150 : 240)
  }
  spawnFlightSparks(from, midX, midY, endX, endY, duration)
  const meterHitTimer = window.setTimeout(startMeterHit, duration * 0.78)

  await el.animate([
    { transform: 'translate(-50%, -50%) scale(1)', offset: 0, opacity: 1 },
    { transform: `translate(${midX - from.x}px, ${midY - from.y}px) scale(0.82)`, offset: 0.5, opacity: 1 },
    { transform: `translate(${endX - from.x}px, ${endY - from.y}px) scale(0.44)`, offset: 0.82, opacity: 0.92 },
    { transform: `translate(${endX - from.x}px, ${endY - from.y - 8}px) scale(0.06)`, offset: 1, opacity: 0 }
  ], {
    duration,
    easing: 'cubic-bezier(.16,.84,.24,1)',
    fill: 'forwards'
  }).finished.catch(() => {})

  window.clearTimeout(meterHitTimer)
  startMeterHit()
  flying.value = flying.value.filter(f => f.id !== id)
}

// Relics at/above this value get a quick lightning strike before they fly off.
const AETHER_LIGHTNING_MIN_MULT = 10
const AETHER_LIGHTNING_TEST_MODE = false

// Deliberately NOT scaled by turbo — this is a short showcase beat for a big
// hit, not part of the normal spin-speed pacing.
function jaggedBolt(px: number, py: number, fromY: number, spread: number) {
  const { Graphics } = PIXI
  const g = new Graphics()
  let x = px
  let y = fromY
  g.moveTo(x, y)
  const segments = 5
  for (let i = 1; i <= segments; i++) {
    y = fromY + ((py - fromY) * i) / segments
    x = px + (Math.random() - 0.5) * spread
    g.lineTo(x, y)
  }
  return g
}

function spawnLightningStrike(drop: MultDrop): Promise<void> {
  if (!PIXI || !GSAP || !overlayLayer) return Promise.resolve()
  const { Graphics } = PIXI
  const p = cellLocal(drop.col, drop.row)

  // The bolt is the star here — tall, thick, and it flickers like a real
  // strike. The impact glow sits near the TOP of the tile (not centered)
  // so it never washes out the "×N" label sitting at the bottom.
  const bolt = jaggedBolt(p.x, p.y - 24, p.y - 96, 24)
  bolt.stroke({ color: 0xe0f7ff, width: 4.5, alpha: 1 })
  bolt.alpha = 0
  overlayLayer.addChild(bolt)

  const branch = jaggedBolt(p.x + 16, p.y - 24, p.y - 60, 28)
  branch.stroke({ color: 0xbae6fd, width: 2.5, alpha: 1 })
  branch.alpha = 0
  overlayLayer.addChild(branch)

  const impactY = p.y - 26
  const impact = new Graphics()
  impact.circle(0, 0, 18).fill({ color: 0xffffff, alpha: 1 })
  impact.position.set(p.x, impactY)
  impact.alpha = 0
  overlayLayer.addChild(impact)

  const ring = new Graphics()
  ring.circle(0, 0, 16).stroke({ color: 0xe0f7ff, width: 3, alpha: 1 })
  ring.position.set(p.x, impactY)
  ring.alpha = 0
  overlayLayer.addChild(ring)

  reelSet?.getReel?.(drop.col)?.getSymbolAt?.(drop.row)?.pulseMultLabel?.(0.4)

  return new Promise<void>((resolve) => {
    GSAP.timeline({
      onComplete: () => {
        for (const g of [bolt, branch, impact, ring]) {
          try {
            g.destroy()
          } catch { /* ignore */ }
        }
        resolve()
      }
    })
      .to(bolt, { alpha: 1, duration: 0.07 })
      .to(branch, { alpha: 0.85, duration: 0.05 }, '<0.03')
      .to(bolt, { alpha: 0.35, duration: 0.04 }, '+=0.02')
      .to(bolt, { alpha: 1, duration: 0.04 })
      .to(impact, { alpha: 0.75, duration: 0.05 }, '<')
      .to(ring.scale, { x: 2.4, y: 2.4, duration: 0.24, ease: 'power2.out' }, '<')
      .to(ring, { alpha: 0, duration: 0.24 }, '<')
      .to(impact, { alpha: 0, duration: 0.1 }, '+=0.02')
      .to([bolt, branch], { alpha: 0, duration: 0.2 }, '<')
  })
}

async function collectMultipliers(step: AetherStep) {
  if (!step.multipliers.length) return
  await stepDelay(180)
  sfx.mult()
  const flights = step.multipliers.map((drop, index) => {
    const isShowcaseMult = AETHER_LIGHTNING_TEST_MODE || drop.value >= AETHER_LIGHTNING_MIN_MULT
    const stagger = turbo.value && !isShowcaseMult ? 45 : 105
    return wait(index * stagger).then(async () => {
      const previous = step.meterBefore + step.multipliers.slice(0, index).reduce((sum, d) => sum + d.value, 0)
      if (isShowcaseMult) {
        await spawnLightningStrike(drop)
      }
      return flyMultiplier(drop, previous + drop.value, isShowcaseMult)
    })
  })
  await Promise.all(flights)
}

function addStepWin(step: AetherStep, sequence: AetherSequence, resultBet: number) {
  if (step.stepPayMult <= 0) return
  const meterMult = Math.max(1, sequence.meterAfter)
  const amount = step.stepPayMult * meterMult * resultBet
  tickNumber(lastWin, lastWin.value + amount, 420)
  winFlash.value = true
  winPulse.value = true
  setTimeout(() => {
    winPulse.value = false
  }, 320)
  spawnWinText(step, sequence, resultBet)
}

async function playSequence(sequence: AetherSequence, resultBet: number): Promise<number> {
  if (!reelSet) return 0
  meter.value = sequence.meterBefore

  reelSet.setSpeed?.(turbo.value ? 'turbo' : 'normal')
  const first = sequence.steps[0]?.grid ?? sequence.restGrid
  pendingMults = sequence.steps[0]?.multipliers ?? sequence.restMults
  const spinPromise = reelSet.spin({ mode: 'cascade' })
  reelSet.setResult(toTargets(first))
  await spinPromise

  const winningSteps = sequence.steps.filter(step => step.winCells.length > 0)
  if (winningSteps.length) {
    await reelSet.runCascade({
      detectWinners: (_grid: string[][], level: number) =>
        (winningSteps[level]?.winCells ?? []).map((c: Cell) => ({ reel: c.col, row: c.row })),
      nextGrid: (_grid: string[][], _winners: any, level: number) => {
        pendingMults = winningSteps[level + 1]?.multipliers ?? sequence.restMults
        return (winningSteps[level + 1]?.grid ?? sequence.restGrid) as unknown as string[][]
      },
      onCascade: async ({ chain }: { chain: number }) => {
        const step = winningSteps[chain - 1]
        if (!step) return
        if (step.winCells.length) sfx.pop(chain)
        spawnPops(step)
        await collectMultipliers(step)
        addStepWin(step, sequence, resultBet)
      },
      pauseAfterDestroyMs: turbo.value ? 100 : 240,
      maxChain: 64
    })
  }

  for (const step of sequence.steps.filter(step => !step.winCells.length && step.multipliers.length)) {
    await collectMultipliers(step)
  }

  pendingMults = sequence.restMults
  reelSet.setResult(toTargets(sequence.restGrid))
  meter.value = sequence.meterAfter
  return sequence.winMult * resultBet
}

async function runBonus(result: AetherGatesResult) {
  if (!result.bonus || !reelSet) return
  const totalRounds = result.bonus.spins.length
  bonusBannerTier.value = result.bonusTier ?? 'normal'
  bonusBanner.value = true
  inBonus.value = true
  bonusSpinLabel.value = `${totalRounds} free spins`
  sfx.bonus()

  if (result.scatterCells.length) {
    await reelSet.spotlight.show(result.scatterCells.map(c => ({ reelIndex: c.col, rowIndex: c.row })))
    await stepDelay(700)
    reelSet.spotlight.hide()
  }

  await stepDelay(900)
  bonusBanner.value = false

  const startWin = lastWin.value
  let bonusWin = 0
  for (const fs of result.bonus.spins) {
    bonusSpinLabel.value = `Free spin ${fs.round} / ${totalRounds}`
    await playSequence(fs.sequence, result.bet)
    bonusWin += fs.spinWinMult * result.bet
    lastWin.value = startWin + bonusWin

    if (fs.retriggered) {
      retriggerBanner.value = true
      sfx.retrigger()
      await stepDelay(950)
      retriggerBanner.value = false
    }
    await stepDelay(220)
  }
  lastWin.value = startWin + bonusWin
  bonusSpinLabel.value = 'Feature complete'
  await stepDelay(850)
  inBonus.value = false

  await showBigWinPopup(result.totalWinMult, result.payout)
}

async function spin(forceFeature?: AetherFeature) {
  const feature: AetherFeature | undefined = forceFeature ?? (bonusChanceMode.value ? 'bonusChance' : undefined)
  const cost = costFor(feature)
  if (!ready.value) return

  const balanceBeforeSpin = balance.value
  let debited = false

  const data = await requestSpin(cost, feature ? { feature } : undefined, () => {
    sfx.spin()
    lastWin.value = 0
    winFlash.value = false
    meter.value = 0
    setBalance(balanceBeforeSpin - cost)
    debited = true
  })

  if (!data) {
    if (debited) {
      setBalance(balanceBeforeSpin)
      stopAutoSpin()
    }
    return
  }

  const result = data.gameData
  try {
    await playSequence(result.base, result.bet)

    if (result.bonusTriggered) {
      if (autoSpinEnabled.value) {
        autoSpinPaused.value = true
        await new Promise<void>((res) => {
          _resumeAutoSpin = res
        })
      }
      await runBonus(result)
    }

    lastWin.value = result.payout
    winFlash.value = result.payout > 0
    winPulse.value = result.payout > 0
    if (result.payout > 0) sfx.win()
    meter.value = result.bonus?.finalMeter ?? result.base.meterAfter
    pushHistory({ payout: result.payout, bet: result.cost, bonus: result.bonusTriggered })
    setBalance(data.balance)
    await fetchSession()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    setBalance(data.balance)
    stopAutoSpin()
  } finally {
    setTimeout(() => {
      winPulse.value = false
    }, 420)
    isSpinning.value = false
    if (autoSpinEnabled.value) {
      if (autoSpinPaused.value) {
        await new Promise<void>((res) => {
          _resumeAutoSpin = res
        })
      }
      if (autoSpinEnabled.value) {
        autoSpinsLeft.value--
        if (autoSpinsLeft.value > 0 && balance.value >= spinCost.value) spin()
        else stopAutoSpin()
      }
    }
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault()
    if (!autoSpinEnabled.value) spin()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)

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

    app = await initSlotPixiApp(PIXI.Application, { width: APP_W, height: APP_H }, () => destroyed)
    if (!app) return
    canvasWrap.value?.appendChild(app.canvas)

    const sheet = await PIXI.Assets.load(SPRITE_SRC)
    if (destroyed) return
    for (const [id, meta] of Object.entries(symbolMeta)) {
      TEX[id] = new PIXI.Texture({ source: sheet.source, frame: new PIXI.Rectangle(...meta.rect) })
    }

    const AetherTile = makeSymbolClass()
    const weights: Record<string, number> = {}
    for (const symbol of AETHER_PAY_SYMBOLS) weights[symbol] = AETHER_SYMBOL_WEIGHTS[symbol]
    weights.scatter = AETHER_SCATTER_WEIGHT
    weights.multiplier = AETHER_MULTIPLIER_WEIGHT

    reelSet = new REELS.ReelSetBuilder()
      .reels(AG_COLS)
      .visibleRows(AG_ROWS)
      .symbolSize(CELL, CELL)
      .symbolGap(GAP, GAP)
      .symbols((registry: any) => {
        for (const id of Object.keys(symbolMeta)) registry.register(id, AetherTile, {})
      })
      .weights(weights)
      .tumble({
        fall: { duration: 220, ease: 'sine.in', rowStagger: 0 },
        dropIn: { duration: 390, ease: 'back.out(1.35)', rowStagger: 36, distance: 'perHole' }
      })
      .speed('normal', REELS.SpeedPresets.NORMAL)
      .speed('turbo', REELS.SpeedPresets.TURBO)
      .ticker(app.ticker)
      .build()

    reelSet.x = OFFSET_X
    reelSet.y = OFFSET_Y
    app.stage.addChild(reelSet)
    reelSet.events.on('cascade:place:end', applyPendingMults)

    overlayLayer = new PIXI.Container()
    overlayLayer.eventMode = 'none'
    app.stage.addChild(overlayLayer)

    particleLayer = new PIXI.Container()
    particleLayer.eventMode = 'none'
    app.stage.addChild(particleLayer)

    floatLayer = new PIXI.Container()
    floatLayer.eventMode = 'none'
    app.stage.addChild(floatLayer)

    reelSet.setResult(toTargets(randomGrid()))
    ready.value = true
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load the Pixi reel engine'
  }
})

onUnmounted(() => {
  destroyed = true
  window.removeEventListener('keydown', onKeydown)
  try {
    overlayLayer?.destroy?.({ children: true })
  } catch { /* ignore */ }
  try {
    particleLayer?.destroy?.({ children: true })
  } catch { /* ignore */ }
  try {
    floatLayer?.destroy?.({ children: true })
  } catch { /* ignore */ }
  safeDestroy(() => reelSet?.destroy?.())
  safeDestroy(() => app?.destroy?.(true))
})
</script>

<template>
  <div class="relative min-h-full overflow-hidden px-2 py-6 sm:px-3">
    <div class="ag-bg absolute inset-0 z-0" />
    <div class="ag-vignette absolute inset-0 z-0" />
    <div class="relative z-[1] mx-auto w-full max-w-7xl">
      <div class="ag-title relative text-center">
        <h1 class="text-[34px] leading-none font-black sm:text-[44px]">
          Aether Gates
        </h1>
      </div>

      <div class="flex flex-col justify-center items-center">
        <div
          ref="meterRef"
          class="relative top-5 left-0 w-full max-w-125 bg-[url('/slots/aethergates/multi_meter_banner.png')] bg-center bg-no-repeat bg-size-[100%_100%] aspect-1536/564 transition-transform duration-200 drop-shadow-[0_10px_22px_rgba(0,0,0,0.5)]"
          :class="meterFlash ? 'scale-[1.045] drop-shadow-[0_0_26px_rgba(250,204,21,0.65)]' : ''"
        >
          <span class="sr-only">Multiplier meter</span>
          <p class="absolute top-[74%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-[clamp(20px,5.4vw,30px)] leading-none font-black whitespace-nowrap text-[#fde047] [text-shadow:0_0_20px_rgba(250,204,21,0.6)]">
            ×{{ formatNumber(Math.max(1, meter), false, 0) }}
          </p>
        </div>
      </div>

      <div class="flex w-full flex-col gap-4 xl:grid xl:grid-cols-[260px_minmax(0,640px)_260px] xl:items-start xl:justify-center">
        <section class="order-3 xl:order-0 xl:col-start-1 xl:row-start-2">
          <div class="ag-rail">
            <button
              class="ag-feature-btn ag-feature-btn-buy"
              :disabled="!ready || isSpinning || autoSpinEnabled || balance < buyFreeSpinsCost"
              @click="buyFreeSpins"
            >
              <span>Buy Free Spins</span>
              <strong><CoinBalance
                :compact="false"
                :value="buyFreeSpinsCost"
              /></strong>
              <small>{{ AG_SCATTER_TRIGGER }} gates guaranteed · {{ AG_FREE_SPINS }} spins</small>
            </button>

            <button
              class="ag-feature-btn ag-feature-btn-super"
              :disabled="!ready || isSpinning || autoSpinEnabled || balance < superBonusCost"
              @click="buySuperBonus"
            >
              <span>Buy Super Bonus</span>
              <strong><CoinBalance
                :compact="false"
                :value="superBonusCost"
              /></strong>
              <small>{{ AG_SCATTER_TRIGGER_SUPER }} gates guaranteed · {{ AG_FREE_SPINS_SUPER }} spins</small>
            </button>

            <button
              class="ag-feature-btn"
              :class="{ 'ag-feature-btn-active': bonusChanceMode }"
              :disabled="isSpinning || autoSpinEnabled"
              @click="toggleBonusChance"
            >
              <span>Bonus Chance</span>
              <strong>{{ bonusChanceMode ? 'ON' : 'OFF' }}</strong>
              <small>Spin cost {{ formatNumber(bonusChanceCost, false) }} · ~2× gate odds</small>
            </button>

            <div class="flex flex-wrap items-center gap-1.5">
              <span
                v-for="tag in ['96–98% RTP']"
                :key="tag"
                class="inline-flex rounded-full border border-[rgba(250,204,21,0.32)] bg-[rgba(2,6,16,0.55)] px-2 py-1 text-[10.5px] font-extrabold uppercase text-muted"
              >{{ tag }}</span>
              <span class="inline-flex rounded-full border border-[rgba(250,204,21,0.32)] bg-[rgba(2,6,16,0.55)] px-2 py-1">
                <SlotVolatility :level="AG_VOLATILITY" />
              </span>
            </div>

            <div class="ag-rail-foot">
              <img
                src="/slots/aethergates/logo.svg"
                alt=""
              >
              <p>{{ formatNumber(AG_DISPLAY_MAX_WIN, false, 0) }}x max win</p>
            </div>
          </div>
        </section>
        <main class="order-2 xl:order-0 xl:col-start-2 xl:row-start-2">
          <div class="ag-console relative overflow-hidden rounded-[10px] border border-[rgba(250,204,21,0.24)] backdrop-blur-[10px]">
            <div
              class="ag-reel-area relative cursor-default overflow-hidden p-1.5 sm:p-2"
              @click="onCanvasClick"
            >
              <div class="ag-reel-sheen pointer-events-none absolute inset-0 z-[2]" />
              <div
                ref="canvasWrap"
                class="relative z-[1] w-full [&>canvas]:!block [&>canvas]:!h-auto [&>canvas]:!w-full"
              />

              <Transition name="pop">
                <div
                  v-if="bonusBanner"
                  class="absolute inset-[50px_18px] z-[8] flex flex-col items-center justify-center rounded-lg border border-[rgba(236,254,255,0.55)] bg-[rgba(8,47,73,0.84)] text-center backdrop-blur-[4px]"
                >
                  <p class="text-[32px] leading-none font-black text-white sm:text-[44px]">
                    {{ bonusBannerTier === 'super' ? 'Super Bonus!' : 'Free Spins!' }}
                  </p>
                  <span class="mt-2 font-extrabold text-primary">Multiplier meter stays alive the whole feature</span>
                </div>
              </Transition>

              <Transition name="pop">
                <div
                  v-if="retriggerBanner"
                  class="absolute inset-[90px_40px] z-[8] flex flex-col items-center justify-center rounded-lg border border-[rgba(253,224,71,0.6)] bg-[rgba(30,20,3,0.86)] text-center backdrop-blur-[4px]"
                >
                  <p class="text-[32px] leading-none font-black text-[#fde047] [text-shadow:0_0_20px_rgba(250,204,21,0.6)]">
                    +{{ AG_RETRIGGER_SPINS }} Free Spins!
                  </p>
                  <span class="mt-2 text-xs font-extrabold uppercase tracking-wide text-[rgba(253,224,71,0.75)]">3+ gates landed again</span>
                </div>
              </Transition>

              <Transition name="pop">
                <BigWinOverlay
                  v-if="bigWinBanner"
                  tint="rgba(5,3,1,0.82)"
                  :intensity="bigWinIntensity"
                >
                  <p
                    class="ag-bigwin-label"
                    :style="{ backgroundImage: bigWinGradient, filter: `drop-shadow(0 0 22px ${bigWinGlow})` }"
                  >
                    {{ bigWinLabel }}
                  </p>
                  <strong class="ag-bigwin-amount">
                    {{ formatNumber(bigWinAmount, false) }}
                  </strong>
                </BigWinOverlay>
              </Transition>

              <Transition name="pop">
                <div
                  v-if="autoSpinPaused"
                  class="absolute inset-0 z-20 flex cursor-pointer items-center justify-center bg-[rgba(4,9,20,0.78)] backdrop-blur-[3px]"
                >
                  <div class="rounded-2xl border border-[rgba(56,189,248,0.35)] bg-[rgba(8,20,38,0.95)] px-6 py-4 text-center shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
                    <p class="text-base font-black text-white">
                      Bonus! Tap to play
                    </p>
                    <span class="mt-1 block text-xs text-[rgba(186,230,253,0.65)]">{{ autoSpinsLeft }} spin{{ autoSpinsLeft !== 1 ? 's' : '' }} remaining</span>
                  </div>
                </div>
              </Transition>

              <div
                v-if="!ready && !errorMsg"
                class="absolute inset-0 z-10 flex items-center justify-center"
              >
                <UIcon
                  name="i-lucide-loader-circle"
                  class="size-10 animate-spin text-primary"
                />
              </div>
            </div>

            <div class="grid grid-cols-1 items-center gap-3 border-t border-[rgba(250,204,21,0.14)] bg-black/40 px-3.5 py-3 sm:grid-cols-[1fr_auto_1fr]">
              <div class="order-2 flex min-w-0 flex-col gap-1.5 sm:order-none">
                <div class="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[rgba(250,204,21,0.12)] bg-black/40 px-2.5 py-1.5">
                  <span class="text-[10px] font-black tracking-wide uppercase text-muted">Balance</span>
                  <strong class="min-w-0 text-right text-sm font-black text-white"><CoinBalance
                    :compact="false"
                    :value="balance"
                  /></strong>
                </div>
                <div class="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[rgba(250,204,21,0.12)] bg-black/40 px-2.5 py-1.5">
                  <span class="text-[10px] font-black tracking-wide uppercase text-muted">Bet</span>
                  <input
                    v-model="betInput"
                    :disabled="isSpinning || autoSpinEnabled"
                    inputmode="numeric"
                    aria-label="Bet amount"
                    class="w-24 border-0 bg-transparent text-right text-sm font-black text-white outline-none"
                    @blur="commitBetInput"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  >
                </div>
              </div>

              <div
                class="order-1 min-w-[126px] text-center transition-transform duration-200 sm:order-none"
                :class="winPulse ? 'scale-[1.08]' : ''"
              >
                <span class="text-[10px] font-black tracking-wide uppercase text-muted">{{ inBonus ? bonusSpinLabel : 'Win' }}</span>
                <Transition
                  mode="out-in"
                  name="pop"
                >
                  <strong
                    v-if="!inBonus && winFlash && lastWin > 0"
                    key="win"
                    class="mt-0.5 block text-2xl leading-none font-black text-[#fde047] [text-shadow:0_0_16px_rgba(250,204,21,0.4)]"
                  >{{ formatNumber(lastWin, false) }}</strong>
                  <strong
                    v-else-if="inBonus"
                    key="bonus"
                    class="mt-0.5 block text-2xl leading-none font-black text-[#fde047] [text-shadow:0_0_16px_rgba(250,204,21,0.4)]"
                  >{{ formatNumber(lastWin, false) }}</strong>
                  <strong
                    v-else
                    key="idle"
                    class="mt-0.5 block text-2xl leading-none font-black text-[rgba(250,204,21,0.18)]"
                  >0.00</strong>
                </Transition>
              </div>

              <div class="order-3 flex items-center justify-end gap-2.5 sm:order-none">
                <UTooltip text="Halve bet">
                  <button
                    class="ag-icon-btn"
                    :disabled="isSpinning || autoSpinEnabled || bet <= MIN_BET"
                    @click="betDown"
                  >
                    1/2
                  </button>
                </UTooltip>

                <div class="flex flex-col items-center gap-1.5">
                  <button
                    class="ag-spin"
                    :disabled="!ready || isSpinning || balance < spinCost"
                    @click="autoSpinEnabled ? stopAutoSpin() : spin()"
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
                      <span class="text-[10px] opacity-85">{{ autoSpinsLeft }}×</span>
                      <span>STOP</span>
                    </span>
                    <span v-else>SPIN</span>
                  </button>
                  <button
                    v-if="!autoSpinEnabled"
                    class="ag-auto-btn"
                    :disabled="!ready || isSpinning || balance < spinCost"
                    @click="showAutoSpinModal = true"
                  >
                    AUTO
                  </button>
                  <button
                    v-else
                    class="ag-auto-btn ag-auto-btn-stop"
                    @click="stopAutoSpin"
                  >
                    STOP
                  </button>
                </div>

                <UTooltip text="Double bet">
                  <button
                    class="ag-icon-btn"
                    :disabled="isSpinning || autoSpinEnabled || bet >= MAX_BET"
                    @click="betUp"
                  >
                    2x
                  </button>
                </UTooltip>
              </div>
            </div>

            <div class="flex items-center justify-between gap-3 border-t border-[rgba(250,204,21,0.1)] px-3.5 pt-2.5 pb-3">
              <div class="flex gap-2">
                <UTooltip text="Game rules">
                  <button
                    class="ag-mini-btn"
                    @click="showHelp = true"
                  >
                    <UIcon
                      name="i-lucide-info"
                      class="size-4"
                    />
                  </button>
                </UTooltip>
                <UTooltip text="Turbo">
                  <button
                    class="ag-mini-btn"
                    :class="{ 'ag-mini-btn-active': turbo }"
                    @click="turbo = !turbo"
                  >
                    <UIcon
                      name="i-lucide-zap"
                      class="size-4"
                    />
                  </button>
                </UTooltip>
                <UTooltip :text="muted ? 'Unmute' : 'Mute'">
                  <button
                    class="ag-mini-btn"
                    @click="toggleMute"
                  >
                    <UIcon
                      :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
                      class="size-4"
                    />
                  </button>
                </UTooltip>
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
                Relics carry a value — any win sweeps them into the meter.
              </p>
            </div>
          </div>
        </main>
        <aside class="order-4 xl:order-0 xl:col-start-3 xl:row-start-2">
          <div class="ag-panel rounded-lg border border-[rgba(250,204,21,0.24)] p-4 backdrop-blur-[10px]">
            <p class="mb-3 text-xs font-black uppercase tracking-wide text-muted">
              Recent spins
            </p>
            <div
              v-if="history.length"
              class="space-y-2"
            >
              <div
                v-for="(h, i) in history"
                :key="i"
                class="flex items-center justify-between rounded-lg bg-[rgba(15,23,42,0.48)] px-2.5 py-2 text-[13px] font-extrabold"
                :class="h.payout > 0 ? 'text-primary' : 'text-muted'"
              >
                <span>{{ h.bonus ? 'Free spins' : 'Base spin' }}</span>
                <strong>{{ h.payout > 0 ? formatNumber(h.payout, false) : '—' }}</strong>
              </div>
            </div>
            <UEmpty
              v-else
              icon="i-lucide-sparkles"
              description="No spins yet"
            />
          </div>
        </aside>
      </div>
    </div>

    <div
      v-for="item in flying"
      :key="item.id"
      :data-fly="item.id"
      class="ag-fly pointer-events-none fixed z-[80] rounded-full border border-[rgba(255,251,235,0.7)] px-2.5 py-1.5 text-xl leading-none font-black text-[rgb(40,25,4)] [text-shadow:0_1px_0_rgba(255,255,255,0.45)]"
      :style="item.style"
    >
      x{{ item.value }}
    </div>

    <!-- Auto-spin modal -->
    <AutoSpinModal
      v-model:open="showAutoSpinModal"
      :options="AUTO_SPIN_OPTIONS"
      @pick="startAutoSpin($event)"
    >
      <template #description>
        <p class="text-sm text-muted">
          Select number of spins. Auto-spin pauses before a bonus round so you can watch — tap the board to resume.
        </p>
      </template>
    </AutoSpinModal>

    <UModal
      v-model:open="showHelp"
      title="How Aether Gates works"
    >
      <template #body>
        <div class="space-y-4 text-sm text-muted">
          <ul class="list-inside list-disc space-y-1.5">
            <li>Land <strong class="text-default">{{ AG_MIN_MATCH }}+</strong> matching symbols anywhere on the 6×5 board to win — no paylines, no adjacency needed.</li>
            <li>Winning symbols tumble away and new ones drop in, so one spin can chain many wins.</li>
            <li>
              <strong class="text-primary">Relic</strong> tiles carry a multiplier value ({{ AETHER_MULT_VALUES_BASE.join('×, ') }}× in the base game, up to {{ Math.max(...AETHER_MULT_VALUES_BONUS) }}× in free spins). The instant
              any win lands, every relic on the board — wherever it sits — flies into the meter above the reels and is swept away.
            </li>
            <li>When the tumble sequence ends, the meter multiplies the whole spin's win. It resets every paid base spin.</li>
            <li>
              Land <strong class="text-default">{{ AG_SCATTER_TRIGGER }}</strong> gates for <strong class="text-default">{{ AG_FREE_SPINS }}</strong> free spins, or
              <strong class="text-default">{{ AG_SCATTER_TRIGGER_SUPER }}+</strong> gates for the richer <strong class="text-default">{{ AG_FREE_SPINS_SUPER }}</strong>-spin Super Bonus.
            </li>
            <li>During free spins the meter <strong class="text-default">never resets</strong> and relics land more often. Landing {{ AG_SCATTER_TRIGGER }}+ gates again grants <strong class="text-default">+{{ AG_RETRIGGER_SPINS }} spins</strong> — a one-time bonus that can only happen once per feature, after which gates stop appearing.</li>
            <li>Total win is realistically capped around <strong class="text-default">{{ formatNumber(AG_DISPLAY_MAX_WIN, false, 0) }}x</strong> bet — huge outlier bonus rounds can occasionally push higher.</li>
          </ul>
          <p class="text-xs text-muted">
            Approx natural bonus trigger: 1 in {{ formatNumber(bonusOdds, true, 0) }} base spins.
          </p>
          <div class="overflow-hidden rounded-lg border border-default">
            <div class="grid grid-cols-[auto_1fr] border-b border-default bg-elevated/60 text-xs text-muted">
              <div class="px-3 py-1" />
              <div class="flex justify-end gap-3 px-3 py-1 font-medium">
                <span class="w-11 text-right">8</span>
                <span class="w-11 text-right">10</span>
                <span class="w-11 text-right">12</span>
                <span class="w-11 text-right">15</span>
                <span class="w-11 text-right">20+</span>
              </div>
            </div>
            <div class="grid grid-cols-[auto_1fr] items-center text-sm">
              <template
                v-for="(row, i) in paytableRows"
                :key="row.sym"
              >
                <div
                  :class="i % 2 ? 'bg-elevated/40' : ''"
                  class="flex items-center justify-center px-3 py-1.5"
                >
                  <span
                    class="inline-block rounded-md bg-no-repeat"
                    :style="tileStyle(row.sym as AetherPaySymbol)"
                    role="img"
                    :aria-label="symbolMeta[row.sym as AetherPaySymbol].name"
                  />
                </div>
                <div
                  :class="i % 2 ? 'bg-elevated/40' : ''"
                  class="flex justify-end gap-3 px-3 py-1.5 font-mono tabular-nums"
                >
                  <span
                    v-for="pay in row.pays"
                    :key="pay"
                    class="w-11 text-right"
                  >{{ pay }}x</span>
                </div>
              </template>
            </div>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.ag-bg {
  background: url('/slots/aethergates/aether_gates_bg.png') center 30% / cover no-repeat;
}

.ag-vignette {
  background: radial-gradient(ellipse 70% 60% at 50% 40%, rgba(4, 9, 20, 0.35) 0%, rgba(4, 9, 20, 0.72) 68%, rgba(2, 5, 10, 0.92) 100%);
}

.ag-title h1 {
  background: linear-gradient(180deg, #ffffff 0%, #fef3c7 30%, #facc15 68%, #b45309 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  filter: drop-shadow(0 3px 0 rgba(8, 15, 30, 0.7)) drop-shadow(0 0 26px rgba(250, 204, 21, 0.35));
}

.ag-console,
.ag-panel {
  background: linear-gradient(180deg, rgba(10, 16, 30, 0.92), rgba(2, 5, 13, 0.96));
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 50px rgba(250, 204, 21, 0.08);
}

.ag-rail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid rgba(250, 204, 21, 0.22);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(250, 204, 21, 0.08), rgba(2, 5, 13, 0.9));
  padding: 10px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
}

.ag-feature-btn {
  display: flex;
  min-height: 78px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(250, 204, 21, 0.2);
  border-radius: 8px;
  background: rgba(4, 9, 20, 0.7);
  color: white;
  text-align: center;
  cursor: pointer;
  transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
}

.ag-feature-btn span {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 950;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ag-feature-btn strong {
  margin-top: 4px;
  color: #fde047;
  font-size: 20px;
  font-weight: 950;
  line-height: 1;
}

.ag-feature-btn small {
  margin-top: 5px;
  color: var(--ui-text-muted);
  font-size: 10.5px;
  font-weight: 800;
  padding: 0 6px;
}

.ag-feature-btn-buy {
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.18), rgba(4, 9, 20, 0.75));
  border-color: rgba(125, 211, 252, 0.28);
}

.ag-feature-btn-buy strong {
  color: #7dd3fc;
}

.ag-feature-btn-super {
  background: linear-gradient(180deg, rgba(250, 204, 21, 0.3), rgba(4, 9, 20, 0.75));
  border-color: rgba(250, 204, 21, 0.45);
}

.ag-feature-btn-super strong {
  color: #fde047;
}

.ag-feature-btn-active {
  border-color: #facc15;
  box-shadow: 0 0 24px rgba(250, 204, 21, 0.3);
}

.ag-feature-btn:disabled {
  cursor: not-allowed;
}

.ag-feature-btn:not(:disabled):hover {
  transform: translateY(-1px);
}

.ag-rail-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(250, 204, 21, 0.14);
  padding: 8px;
}

.ag-rail-foot img {
  width: 76px;
  height: 42px;
  object-fit: contain;
}

.ag-rail-foot p {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.ag-reel-area {
  background: radial-gradient(ellipse 90% 65% at 50% 0%, rgba(37, 30, 10, 0.5), rgba(2, 5, 13, 0.92) 72%);
}

.ag-reel-sheen {
  background:
    radial-gradient(ellipse 70% 50% at 50% 105%, rgba(0, 0, 0, 0.32), transparent 62%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 22%);
}

.ag-spin,
.ag-icon-btn,
.ag-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(250, 204, 21, 0.22);
  background: rgba(0, 0, 0, 0.45);
  color: white;
  font-weight: 950;
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, opacity 140ms ease;
}

.ag-spin {
  width: 82px;
  height: 58px;
  border-color: rgba(250, 204, 21, 0.7);
  border-radius: 999px;
  background: linear-gradient(180deg, #fde047, #ca8a04);
  color: #241705;
  box-shadow: 0 12px 22px rgba(0, 0, 0, 0.4), 0 0 24px rgba(250, 204, 21, 0.35);
}

.ag-auto-btn {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-weight: 800;
  color: rgba(186, 230, 253, 0.55);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
  padding: 0;
}

.ag-auto-btn:hover:not(:disabled) {
  color: #e0f2fe;
}

.ag-auto-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.ag-auto-btn-stop {
  color: rgba(248, 113, 113, 0.75);
}

.ag-auto-btn-stop:hover {
  color: #f87171;
}

.ag-icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 8px;
}

.ag-mini-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
}

.ag-mini-btn-active {
  border-color: #facc15;
  background: rgba(250, 204, 21, 0.18);
}

.ag-spin:disabled,
.ag-icon-btn:disabled {
  opacity: 0.45;
}

.ag-spin:not(:disabled):hover,
.ag-icon-btn:not(:disabled):hover,
.ag-mini-btn:hover {
  transform: translateY(-1px);
}

.ag-fly {
  background: radial-gradient(circle at 32% 24%, white, #fde047 34%, #ca8a04 72%);
  box-shadow: 0 0 18px rgba(250, 204, 21, 0.5);
}

.ag-fly-spark {
  position: fixed;
  z-index: 78;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  pointer-events: none;
  background: radial-gradient(circle, #ffffff, #7dd3fc 60%, transparent 75%);
  box-shadow: 0 0 8px rgba(125, 211, 252, 0.6);
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

.ag-bigwin-label {
  margin: 0;
  font-size: calc(26px + var(--tier, 1) * 6px);
  font-weight: 950;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  animation: ag-bigwin-pop 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both;
}

.ag-bigwin-amount {
  font-size: calc(34px + var(--tier, 1) * 9px);
  font-weight: 950;
  line-height: 1;
  color: rgb(254, 243, 199);
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.6), 0 0 26px rgba(250, 204, 21, 0.55);
  animation: ag-bigwin-pop 0.5s 0.08s cubic-bezier(0.2, 1.4, 0.4, 1) both;
}

@keyframes ag-bigwin-pop {
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
