<script lang="ts" setup>
import type {
  CandyFeature,
  CandyMadnessResult,
  CandySymbol,
  Cell,
  MultSpot,
  TumbleSequence,
  TumbleStep
} from '#shared/utils/gamelogic/candymadness'
import {
  CANDY_KEYS,
  CANDY_WEIGHTS,
  CM_BONUS_HUNT_COST,
  CM_BUY_FREESPINS_COST,
  CM_COLS,
  CM_FREE_SPINS,
  CM_MAX_WIN_MULT,
  CM_ROWS,
  SCATTER_WEIGHT
} from '#shared/utils/gamelogic/candymadness'
import { parseAmount } from '#shared/utils/parse-amount'
import { initSlotPixiApp, safeDestroy } from '~/utils/slot-pixi'
import {
  CANDY_INFO,
  candyDataUrl,
  drawCandyCanvas,
  drawParticleCanvas,
  hexCss,
  spotColor,
  type CandyArtKey,
  type ParticleKey
} from '~/utils/slots/candymadness-art'
import { CANDY_BET_LADDER, CANDY_BIG_WIN_AT, CANDY_BONUS_ODDS } from '~/utils/slots/candymadness-ui'
import CandyBackdrop from '~/components/games/candymadness/CandyBackdrop.vue'
import CandyBigWin from '~/components/games/candymadness/CandyBigWin.vue'
import CandyRules from '~/components/games/candymadness/CandyRules.vue'
import CandyAutoSpin from '~/components/games/candymadness/CandyAutoSpin.vue'

// Volatility rating (1-5) for SlotVolatility. The sticky multiplier tail in
// free spins makes this a medium-volatility game.
const CM_VOLATILITY = 3

const { bet, isSpinning, errorMsg, balance, setBalance, history, pushHistory, spin: requestSpin } = useSlotGame<CandyMadnessResult, { payout: number, bet: number, bonus: boolean }>('candymadness')
const sound = useCandyMadnessSound()
const { soundEnabled, soundVolume } = sound

// --- bet ---------------------------------------------------------------------
const MIN_BET = 1
const MAX_BET = 100_000_000_000 // matches the server-side cap in play-game.post.ts

const betText = useAmountInput(bet, { integer: true, shorthand: true })
const betEditing = ref(false)
const betInputEl = ref<HTMLInputElement>()

function clampBet(v: number): number {
  if (!Number.isFinite(v) || v < MIN_BET) return MIN_BET
  return Math.min(MAX_BET, Math.floor(v))
}

function setBet(v: number) {
  if (betLocked.value) return
  bet.value = clampBet(v)
}

function commitBet() {
  betEditing.value = false
  bet.value = clampBet(parseAmount(betText.value) ?? MIN_BET)
}

function editBet() {
  if (betLocked.value) return
  betEditing.value = true
  nextTick(() => betInputEl.value?.select())
}

function betUp() {
  const next = CANDY_BET_LADDER.find(v => v > bet.value)
  if (next === undefined || betLocked.value) return
  setBet(next)
  sound.play('bet-up', { intensity: CANDY_BET_LADDER.indexOf(next) % 12 })
}

function betDown() {
  const prev = [...CANDY_BET_LADDER].reverse().find(v => v < bet.value)
  if (prev === undefined || betLocked.value) return
  setBet(prev)
  sound.play('bet-down', { intensity: CANDY_BET_LADDER.indexOf(prev) % 12 })
}

/** Largest ladder step the balance covers. */
const maxAffordableBet = computed(() => {
  const cap = Math.min(MAX_BET, Math.floor(balance.value))
  const step = [...CANDY_BET_LADDER].reverse().find(v => v <= cap)
  return step ?? MIN_BET
})

function betMax() {
  if (betLocked.value) return
  setBet(maxAffordableBet.value)
  sound.play('bet-max')
}

// --- features ----------------------------------------------------------------
const huntMode = ref(false)
const buyFreeSpinsCost = computed(() => bet.value * CM_BUY_FREESPINS_COST)
const bonusHuntCost = computed(() => bet.value * CM_BONUS_HUNT_COST)
const spinCost = computed(() => huntMode.value ? bonusHuntCost.value : bet.value)
const buyArmed = ref(false)
let buyArmTimer: ReturnType<typeof setTimeout> | null = null

function costFor(feature?: CandyFeature): number {
  if (feature === 'buyFreeSpins') return buyFreeSpinsCost.value
  if (feature === 'bonusHunt') return bonusHuntCost.value
  return bet.value
}

function toggleHunt() {
  if (betLocked.value) return
  huntMode.value = !huntMode.value
  sound.unlock()
  sound.play('toggle', { intensity: huntMode.value ? 1 : 0 })
}

function onBuyClick() {
  if (!ready.value || betLocked.value || balance.value < buyFreeSpinsCost.value) return
  sound.unlock()
  if (!buyArmed.value) {
    buyArmed.value = true
    sound.play('click')
    if (buyArmTimer) clearTimeout(buyArmTimer)
    buyArmTimer = setTimeout(() => (buyArmed.value = false), 4000)
    return
  }
  buyArmed.value = false
  sound.play('buy')
  spin('buyFreeSpins')
}

// --- round / HUD state ---------------------------------------------------------
const ready = ref(false)
const turbo = ref(false)
const showRules = ref(false)
const showAuto = ref(false)
const showSound = ref(false)
/** True while a round's animation is still playing after the server replied. */
const presenting = ref(false)

const winShown = ref(0)
const winEquation = ref('')
const winPulse = ref(0)
const multSum = ref(0)
const multPulse = ref(0)
const tumbleCount = ref(0)
const anticipating = ref(false)

const inBonus = ref(false)
const bonusRound = ref(0)
const bonusTotal = ref(0)
const bonusIntro = ref(false)
const bonusOutro = ref(false)
const bonusOutroAmount = ref(0)
let bonusGate: (() => void) | null = null

const bigWin = ref<{ amount: number, bet: number, subtitle?: string } | null>(null)
let bigWinDone: (() => void) | null = null

// --- auto spin -----------------------------------------------------------------
const autoSpinEnabled = ref(false)
const autoSpinsLeft = ref(0)
const autoStopOnBonus = ref(false)

const betLocked = computed(() => isSpinning.value || autoSpinEnabled.value || presenting.value)

function startAutoSpin(opts: { count: number, stopOnBonus: boolean }) {
  autoSpinsLeft.value = opts.count
  autoStopOnBonus.value = opts.stopOnBonus
  autoSpinEnabled.value = true
  sound.unlock()
  sound.play('toggle', { intensity: 1 })
  if (!isSpinning.value && !presenting.value) spin()
}

function stopAutoSpin() {
  autoSpinEnabled.value = false
  autoSpinsLeft.value = 0
}

// --- timing helpers ------------------------------------------------------------
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const t = (normal: number, fast: number) => turbo.value ? fast : normal

/** Animate a ref to `to` with ticks; resolves when done. */
function countTo(target: Ref<number>, to: number, ms: number): Promise<void> {
  const from = target.value
  if (ms <= 0 || from === to) {
    target.value = to
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const start = performance.now()
    let lastTick = 0
    let n = 0
    const step = (now: number) => {
      if (destroyed) return resolve()
      const k = Math.min(1, (now - start) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      target.value = from + (to - from) * e
      if (now - lastTick > 65 && k < 1) {
        lastTick = now
        sound.play('tick', { intensity: n++ })
      }
      if (k < 1) requestAnimationFrame(step)
      else {
        target.value = to
        resolve()
      }
    }
    requestAnimationFrame(step)
  })
}

// --- pixi (non-reactive on purpose; Vue proxies break Pixi objects) ------------
const canvasWrap = ref<HTMLDivElement>()
let app: any = null
let reelSet: any = null
let REELS: any = null
let PIXI: any = null
let GSAP: any = null
let board: any = null
let cellLayer: any = null
let spotLayer: any = null
let spotLabelLayer: any = null
let fxLayer: any = null
let particleLayer: any = null
let floatLayer: any = null
let resizeObserver: ResizeObserver | null = null
let destroyed = false
let stageScale = 1
const TEX: Record<string, any> = {}
const PTEX: Partial<Record<ParticleKey, any>> = {}
const liveScatters = new Set<any>()

const CELL = 66
const GAP = 6
const PAD = 12
const REEL_W = CM_COLS * CELL + (CM_COLS - 1) * GAP
const REEL_H = CM_ROWS * CELL + (CM_ROWS - 1) * GAP
const APP_W = REEL_W + PAD * 2
const APP_H = REEL_H + PAD * 2
const SYMBOL_IDS: CandySymbol[] = [...CANDY_KEYS, 'scatter']
const SPRINKLES = [0xff6fb5, 0xffd23a, 0x5ee0a0, 0x58c4ff, 0xb77bff, 0xffffff]

function cellCenter(col: number, row: number) {
  return { x: PAD + col * (CELL + GAP) + CELL / 2, y: PAD + row * (CELL + GAP) + CELL / 2 }
}

function textRes() {
  return Math.min(4, (app?.renderer?.resolution ?? 1) * stageScale * 1.25)
}

function makeTexture(canvas: HTMLCanvasElement) {
  const source = new PIXI.CanvasSource({ resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear' })
  return new PIXI.Texture({ source })
}

// --- particles -----------------------------------------------------------------
interface Particle {
  s: any
  vx: number
  vy: number
  g: number
  life: number
  max: number
  spin: number
  s0: number
  s1: number
  drag: number
}
const particles: Particle[] = []
const MAX_PARTICLES = 700

interface EmitOptions {
  vx?: number
  vy?: number
  g?: number
  life: number
  scale: number
  scaleTo?: number
  tint?: number
  spin?: number
  add?: boolean
  alpha?: number
  drag?: number
  rot?: number
}

function emit(key: ParticleKey, x: number, y: number, o: EmitOptions) {
  if (!particleLayer || particles.length >= MAX_PARTICLES) return
  const s = new PIXI.Sprite(PTEX[key])
  s.anchor.set(0.5)
  s.position.set(x, y)
  s.tint = o.tint ?? 0xffffff
  s.alpha = o.alpha ?? 1
  s.rotation = o.rot ?? Math.random() * Math.PI * 2
  s.scale.set(o.scale)
  if (o.add) s.blendMode = 'add'
  particleLayer.addChild(s)
  particles.push({ s, vx: o.vx ?? 0, vy: o.vy ?? 0, g: o.g ?? 0, life: o.life, max: o.life, spin: o.spin ?? 0, s0: o.scale, s1: o.scaleTo ?? o.scale, drag: o.drag ?? 0 })
}

function updateParticles(dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!
    p.life -= dt
    if (p.life <= 0) {
      p.s.destroy()
      particles.splice(i, 1)
      continue
    }
    const k = 1 - p.life / p.max
    p.vy += p.g * dt
    if (p.drag) {
      const d = Math.max(0, 1 - p.drag * dt)
      p.vx *= d
      p.vy *= d
    }
    p.s.x += p.vx * dt
    p.s.y += p.vy * dt
    p.s.rotation += p.spin * dt
    p.s.scale.set(p.s0 + (p.s1 - p.s0) * k)
    p.s.alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4
  }
}

function burst(x: number, y: number, color: number, power = 1) {
  const lite = turbo.value
  const shards = lite ? 4 : 7
  for (let i = 0; i < shards; i++) {
    const a = Math.random() * Math.PI * 2
    const v = (110 + Math.random() * 170) * power
    emit('shard', x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 90, g: 620, life: 0.55 + Math.random() * 0.35, scale: 0.28 + Math.random() * 0.22, scaleTo: 0.1, tint: color, spin: (Math.random() - 0.5) * 14 })
  }
  const spr = lite ? 2 : 5
  for (let i = 0; i < spr; i++) {
    const a = Math.random() * Math.PI * 2
    const v = 80 + Math.random() * 150
    emit('sprinkle', x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, g: 520, life: 0.7 + Math.random() * 0.4, scale: 0.28, tint: SPRINKLES[Math.floor(Math.random() * SPRINKLES.length)], spin: (Math.random() - 0.5) * 18 })
  }
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * Math.PI * 2
    const v = 40 + Math.random() * 90
    emit('star', x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3, life: 0.45 + Math.random() * 0.3, scale: 0.35, scaleTo: 0.05, add: true, spin: 4 })
  }
  emit('ring', x, y, { life: 0.32, scale: 0.12, scaleTo: 0.75, tint: color, add: true, rot: 0 })
  emit('glow', x, y, { life: 0.25, scale: 0.6, scaleTo: 1.1, tint: color, add: true, alpha: 0.8 })
}

// --- symbol class --------------------------------------------------------------
function makeSymbolClass() {
  const { Sprite } = PIXI
  const Base = REELS.ReelSymbol

  class CandyTile extends Base {
    glow = new Sprite()
    rays = new Sprite()
    sprite = new Sprite()
    flash = new Sprite()
    w = CELL
    h = CELL
    base = 1
    tl: any = null

    constructor() {
      super()
      for (const s of [this.glow, this.rays, this.sprite, this.flash]) s.anchor.set(0.5)
      this.glow.blendMode = 'add'
      this.flash.blendMode = 'add'
      this.rays.blendMode = 'add'
      this.view.addChild(this.glow, this.rays, this.sprite, this.flash)
    }

    render(id: string) {
      const tex = TEX[id]
      if (!tex) return
      this.sprite.texture = tex
      this.flash.texture = tex
      this.base = (Math.min(this.w, this.h) * (id === 'scatter' ? 1.08 : 0.94)) / tex.width
      for (const s of [this.sprite, this.flash]) {
        s.scale.set(this.base)
        s.position.set(this.w / 2, this.h / 2)
        s.rotation = 0
      }
      this.sprite.alpha = 1
      this.flash.alpha = 0
      this.glow.texture = PTEX.glow
      this.glow.tint = CANDY_INFO[id as CandySymbol]?.color ?? 0xffffff
      this.glow.position.set(this.w / 2, this.h / 2)
      this.glow.scale.set((this.w * 1.5) / 128)
      this.glow.alpha = 0
      const isScatter = id === 'scatter'
      this.rays.visible = isScatter
      if (isScatter) {
        this.rays.texture = TEX.rays
        this.rays.position.set(this.w / 2, this.h / 2)
        this.rays.scale.set((this.w * 1.25) / TEX.rays.width)
        this.rays.alpha = 0.75
        liveScatters.add(this)
      } else {
        liveScatters.delete(this)
      }
    }

    onActivate(id: string) {
      this.kill()
      this.view.alpha = 1
      this.view.scale.set(1)
      this.render(id)
    }

    onDeactivate() {
      this.kill()
      liveScatters.delete(this)
    }

    resize(w: number, h: number) {
      this.w = w
      this.h = h
      if (this.symbolId) this.render(this.symbolId)
    }

    kill() {
      if (this.tl) {
        this.tl.kill()
        this.tl = null
      }
      this.sprite.scale.set(this.base)
      this.sprite.rotation = 0
      this.sprite.alpha = 1
      this.flash.alpha = 0
      this.glow.alpha = 0
    }

    stopAnimation() {
      this.kill()
    }

    /** Wiggle and glow while the cluster is being presented. */
    playWin() {
      this.kill()
      return new Promise<void>((res) => {
        const b = this.base
        this.tl = GSAP.timeline({ onComplete: res })
          .to(this.glow, { alpha: 0.85, duration: 0.14 }, 0)
          .to(this.sprite.scale, { x: b * 1.2, y: b * 1.2, duration: 0.14, ease: 'back.out(3)' }, 0)
          .to(this.sprite, { rotation: 0.16, duration: 0.07, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 0.05)
          .to(this.sprite.scale, { x: b * 1.1, y: b * 1.1, duration: 0.18, ease: 'sine.out' }, 0.18)
      })
    }

    /** Swell, flash white, then pop (particles are spawned by the game). */
    playDestroy(opts?: { delay?: number, signal?: AbortSignal }) {
      const signal = opts?.signal
      const done = () => {
        this.view.alpha = 0
        this.sprite.scale.set(this.base)
        this.sprite.alpha = 1
        this.flash.alpha = 0
        this.glow.alpha = 0
      }
      if (signal?.aborted) {
        done()
        return Promise.resolve()
      }
      if (this.tl) this.tl.kill()
      return new Promise<void>((res) => {
        const b = this.base
        const finish = () => {
          signal?.removeEventListener('abort', abort)
          done()
          res()
        }
        const abort = () => {
          this.tl?.kill()
          finish()
        }
        signal?.addEventListener('abort', abort, { once: true })
        this.flash.scale.set(b * 1.2)
        this.tl = GSAP.timeline({ onComplete: finish })
          .to([this.sprite.scale, this.flash.scale], { x: b * 1.34, y: b * 1.34, duration: 0.09, ease: 'power2.out' }, 0)
          .to(this.flash, { alpha: 0.9, duration: 0.08 }, 0)
          .to([this.sprite.scale, this.flash.scale], { x: 0, y: 0, duration: 0.12, ease: 'back.in(2)' }, 0.1)
          .to(this.glow, { alpha: 0, duration: 0.1 }, 0.1)
      })
    }
  }

  return CandyTile
}

// --- multiplier spots ----------------------------------------------------------
interface SpotView { value: number, container: any, tile: any, glow: any, label: any, bg: any, text: any }
const spots = new Map<string, SpotView>()

function drawSpot(s: SpotView) {
  const c = spotColor(s.value)
  s.tile.clear()
  s.tile.roundRect(-CELL / 2, -CELL / 2, CELL, CELL, 14).fill({ color: c, alpha: 0.26 })
  s.tile.roundRect(-CELL / 2 + 1.5, -CELL / 2 + 1.5, CELL - 3, CELL - 3, 13).stroke({ color: c, width: 3, alpha: 0.95 })
  s.glow.tint = c
  s.text.text = `×${formatNumber(s.value, true)}`
  const w = Math.max(28, s.text.width + 12)
  s.bg.clear()
  s.bg.roundRect(-w, -19, w, 19, 9.5).fill({ color: 0x2a0838, alpha: 0.92 }).stroke({ color: c, width: 2 })
  s.text.position.set(-w / 2, -9.5)
}

function makeSpot(col: number, row: number, value: number) {
  const { Container, Graphics, Sprite, Text } = PIXI
  const p = cellCenter(col, row)
  const container = new Container()
  const glow = new Sprite(PTEX.glow)
  glow.anchor.set(0.5)
  glow.scale.set((CELL * 1.6) / 128)
  glow.alpha = 0.35
  glow.blendMode = 'add'
  const tile = new Graphics()
  container.addChild(glow, tile)
  container.position.set(p.x, p.y)
  spotLayer.addChild(container)

  const label = new Container()
  const bg = new Graphics()
  const text = new Text({
    text: '',
    resolution: textRes(),
    style: { fontFamily: 'Lilita One, Fredoka, system-ui, sans-serif', fontSize: 15, fill: 0xffffff, stroke: { color: 0x2a0838, width: 3, join: 'round' } }
  })
  text.anchor.set(0.5)
  label.addChild(bg, text)
  label.position.set(p.x + CELL / 2 + 2, p.y + CELL / 2 + 3)
  spotLabelLayer.addChild(label)

  const view: SpotView = { value, container, tile, glow, label, bg, text }
  drawSpot(view)
  spots.set(`${col}:${row}`, view)
  GSAP.fromTo(container.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.2)' })
  GSAP.fromTo(label.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.5)', delay: 0.05 })
}

function bumpSpot(s: SpotView, value: number) {
  s.value = value
  drawSpot(s)
  GSAP.fromTo(s.label.scale, { x: 1.7, y: 1.7 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2.5)' })
  GSAP.fromTo(s.glow, { alpha: 1 }, { alpha: 0.35, duration: 0.5 })
}

function syncSpots(list: MultSpot[]) {
  let made = 0
  let bumped = 0
  let top = 0
  for (const s of list) {
    const existing = spots.get(`${s.col}:${s.row}`)
    if (!existing) {
      makeSpot(s.col, s.row, s.value)
      made++
    } else if (existing.value !== s.value) {
      bumpSpot(existing, s.value)
      bumped++
    }
    top = Math.max(top, s.value)
  }
  multSum.value = list.reduce((a, s) => a + s.value, 0)
  if (made || bumped) multPulse.value++
  const level = Math.log2(Math.max(2, top))
  if (bumped) sound.play('spot-up', { intensity: level })
  else if (made) sound.play('spot', { intensity: level })
}

function clearSpots() {
  for (const s of spots.values()) {
    safeDestroy(() => GSAP?.killTweensOf([s.container.scale, s.label.scale, s.glow]))
    safeDestroy(() => s.container.destroy({ children: true }))
    safeDestroy(() => s.label.destroy({ children: true }))
  }
  spots.clear()
  multSum.value = 0
}

/** Stars stream from every spot to the multiplier meter at the top of the board. */
async function flySpotsToMeter() {
  const tx = APP_W / 2
  const ty = 2
  const dur = t(0.5, 0.3)
  for (const s of spots.values()) {
    GSAP.fromTo(s.label.scale, { x: 1.4, y: 1.4 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2)' })
    const star = new PIXI.Sprite(PTEX.star)
    star.anchor.set(0.5)
    star.blendMode = 'add'
    star.tint = spotColor(s.value)
    star.scale.set(0.45)
    star.position.set(s.label.x - 14, s.label.y - 10)
    fxLayer.addChild(star)
    GSAP.to(star, { x: tx, y: ty, duration: dur, delay: Math.random() * 0.15, ease: 'power2.in', onComplete: () => safeDestroy(() => star.destroy()) })
    GSAP.to(star.scale, { x: 0.2, y: 0.2, duration: dur, ease: 'power2.in' })
  }
  await wait(t(620, 380))
  multPulse.value++
}

// --- cluster presentation --------------------------------------------------------
let currentStep: TumbleStep | undefined
let currentChain = 0
let activeBet = 1

function clusterCentroid(cells: Cell[]) {
  let sx = 0
  let sy = 0
  for (const c of cells) {
    const p = cellCenter(c.col, c.row)
    sx += p.x
    sy += p.y
  }
  return { x: sx / cells.length, y: sy / cells.length }
}

function floatText(x: number, y: number, text: string, color = 0xffe38a, size = 22) {
  const label = new PIXI.Text({
    text,
    resolution: textRes(),
    style: {
      fontFamily: 'Lilita One, Fredoka, system-ui, sans-serif',
      fontSize: size,
      fill: color,
      stroke: { color: 0x4a0b3d, width: 5, join: 'round' },
      dropShadow: { color: 0x000000, blur: 4, distance: 2, alpha: 0.5, angle: Math.PI / 2 }
    }
  })
  label.anchor.set(0.5)
  label.position.set(x, y)
  floatLayer.addChild(label)
  const dur = t(1.5, 0.9)
  GSAP.fromTo(label.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2.6)' })
  GSAP.to(label, { y: y - 36, duration: dur, ease: 'power1.out' })
  GSAP.to(label, { alpha: 0, duration: dur * 0.35, delay: dur * 0.65, onComplete: () => safeDestroy(() => label.destroy()) })
}

async function presentClusters(step: TumbleStep, chain: number) {
  currentStep = step
  currentChain = chain
  tumbleCount.value = chain
  sound.play('cluster', { intensity: chain })
  for (const cl of step.clusters) {
    for (const c of cl.cells) {
      const sym = reelSet.reels[c.col]?.getSymbolAt(c.row)
      sym?.playWin?.()
    }
    const p = clusterCentroid(cl.cells)
    floatText(p.x, p.y, `+${formatNumber(cl.pay * activeBet)}`)
  }
  await wait(t(520, 240))
}

function onDestroyStart({ cells }: { cells: { reel: number, row: number }[] }) {
  const step = currentStep
  const chain = currentChain
  sound.play('pop', { intensity: chain })
  setTimeout(() => {
    if (destroyed) return
    for (const c of cells) {
      const sym = step?.grid[c.reel]?.[c.row] as CandySymbol | undefined
      const p = cellCenter(c.reel, c.row)
      burst(p.x, p.y, sym ? CANDY_INFO[sym].color : 0xffffff, 1 + Math.min(chain, 6) * 0.06)
    }
  }, 110)
}

// initial drop sounds / scatter reveal
let dropping = false
let scattersSeen = 0

let anticFrom = -1

function onReelLanded(reelIndex: number, symbols: string[]) {
  if (!dropping) return
  if (anticFrom > 0 && reelIndex === anticFrom - 1) {
    anticipating.value = true
    sound.play('anticipation')
  }
  sound.play('drop', { intensity: reelIndex, pan: (reelIndex / (CM_COLS - 1)) * 1.2 - 0.6 })
  symbols.forEach((id, row) => {
    if (id !== 'scatter' || row >= CM_ROWS) return
    sound.play('scatter-land', { intensity: scattersSeen++ })
    const sym = reelSet.reels[reelIndex]?.getSymbolAt(row)
    sym?.playWin?.()
  })
}

// --- pixi bootstrap ----------------------------------------------------------------
function randomGrid(): CandySymbol[][] {
  // Cosmetic idle board.
  const total = CANDY_KEYS.reduce((a, k) => a + CANDY_WEIGHTS[k], 0)
  return Array.from({ length: CM_COLS }, () => Array.from({ length: CM_ROWS }, () => {
    let r = Math.random() * total
    for (const k of CANDY_KEYS) {
      r -= CANDY_WEIGHTS[k]
      if (r < 0) return k
    }
    return 'grape' as CandySymbol
  }))
}

function toTargets(grid: CandySymbol[][]) {
  return grid.map(col => ({ visible: col }))
}

// Render at the displayed size (never CSS-upscaled) so dpr 1 screens stay sharp.
function fitCanvas() {
  if (!app || !canvasWrap.value) return
  const w = canvasWrap.value.clientWidth
  if (!w) return
  const h = Math.round(w * APP_H / APP_W)
  stageScale = w / APP_W
  app.renderer.resize(w, h)
  board.scale.set(stageScale)
}

function drawCells() {
  const g = new PIXI.Graphics()
  for (let c = 0; c < CM_COLS; c++) {
    for (let r = 0; r < CM_ROWS; r++) {
      const p = cellCenter(c, r)
      const x = p.x - CELL / 2
      const y = p.y - CELL / 2
      const odd = (c + r) % 2 === 1
      g.roundRect(x, y, CELL, CELL, 14).fill({ color: odd ? 0xffffff : 0xffd6f0, alpha: odd ? 0.07 : 0.1 })
      g.roundRect(x + 3, y + 2, CELL - 6, CELL * 0.42, 11).fill({ color: 0xffffff, alpha: 0.05 })
    }
  }
  cellLayer.addChild(g)
}

async function loadFonts() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('16px "Lilita One"'), document.fonts.load('16px "Fredoka"')]),
      wait(2500)
    ])
  } catch { /* fall back to system fonts */ }
}

function tickerUpdate(ticker: any) {
  const dt = Math.min(0.05, ticker.deltaMS / 1000)
  updateParticles(dt)
  for (const s of liveScatters) s.rays.rotation += dt * 0.9
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  try {
    const [pixi, reels, gsapMod] = await Promise.all([
      import('pixi.js'),
      import('pixi-reels'),
      import('gsap'),
      loadFonts()
    ])
    if (destroyed) return
    PIXI = pixi
    REELS = reels
    GSAP = gsapMod.gsap ?? gsapMod.default

    app = await initSlotPixiApp(PIXI.Application, { width: APP_W, height: APP_H }, () => destroyed)
    if (!app) return
    canvasWrap.value?.appendChild(app.canvas)

    const artKeys: CandyArtKey[] = [...SYMBOL_IDS, 'rays']
    for (const id of artKeys) TEX[id] = makeTexture(drawCandyCanvas(id, 256))
    for (const k of ['dot', 'star', 'sprinkle', 'shard', 'ring', 'glow'] as ParticleKey[]) PTEX[k] = makeTexture(drawParticleCanvas(k))

    board = new PIXI.Container()
    app.stage.addChild(board)
    cellLayer = new PIXI.Container()
    spotLayer = new PIXI.Container()
    spotLabelLayer = new PIXI.Container()
    fxLayer = new PIXI.Container()
    particleLayer = new PIXI.Container()
    floatLayer = new PIXI.Container()
    for (const l of [spotLabelLayer, fxLayer, particleLayer, floatLayer]) l.eventMode = 'none'
    drawCells()

    const CandyTile = makeSymbolClass()
    const weights: Record<string, number> = { scatter: SCATTER_WEIGHT }
    for (const k of CANDY_KEYS) weights[k] = CANDY_WEIGHTS[k]

    reelSet = new REELS.ReelSetBuilder()
      .reels(CM_COLS)
      .visibleRows(CM_ROWS)
      .symbolSize(CELL, CELL)
      .symbolGap(GAP, GAP)
      .symbols((r: any) => {
        for (const id of SYMBOL_IDS) r.register(id, CandyTile, {})
      })
      .weights(weights)
      .tumble({
        fall: { duration: 260, ease: 'power2.in', rowStagger: 0 },
        dropIn: { duration: 420, ease: 'back.out(1.25)', rowStagger: 35, distance: 'perHole' }
      })
      .speed('normal', REELS.SpeedPresets.NORMAL)
      .speed('turbo', REELS.SpeedPresets.TURBO)
      .ticker(app.ticker)
      .build()
    reelSet.x = PAD
    reelSet.y = PAD

    board.addChild(cellLayer, spotLayer, reelSet, spotLabelLayer, fxLayer, particleLayer, floatLayer)
    reelSet.events.on('cascade:destroy:start', onDestroyStart)
    reelSet.events.on('spin:reelLanded', onReelLanded)
    app.ticker.add(tickerUpdate)

    reelSet.setResult(toTargets(randomGrid()))
    fitCanvas()
    resizeObserver = new ResizeObserver(() => fitCanvas())
    if (canvasWrap.value) resizeObserver.observe(canvasWrap.value)
    ready.value = true
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load the slot engine'
  }
})

onBeforeUnmount(() => {
  destroyed = true
  stopAutoSpin()
  window.removeEventListener('keydown', onKeydown)
  resizeObserver?.disconnect()
  if (buyArmTimer) clearTimeout(buyArmTimer)
  bonusGate?.()
  bigWinDone?.()
  sound.stopAll()
  safeDestroy(() => app?.ticker?.remove(tickerUpdate))
  safeDestroy(() => reelSet?.events?.off('cascade:destroy:start', onDestroyStart))
  safeDestroy(() => reelSet?.events?.off('spin:reelLanded', onReelLanded))
  for (const p of particles.splice(0)) safeDestroy(() => p.s.destroy())
  clearSpots()
  liveScatters.clear()
  for (const layer of [fxLayer, floatLayer]) {
    if (layer) safeDestroy(() => GSAP?.killTweensOf(layer.children))
  }
  safeDestroy(() => reelSet?.destroy?.())
  safeDestroy(() => app?.destroy?.(true, { children: true }))
  for (const tex of [...Object.values(TEX), ...Object.values(PTEX)]) safeDestroy(() => tex.destroy(true))
})

// --- spin flow ---------------------------------------------------------------------
async function spin(forceFeature?: CandyFeature) {
  if (!ready.value || isSpinning.value || presenting.value) return
  const feature: CandyFeature | undefined = forceFeature ?? (huntMode.value ? 'bonusHunt' : undefined)
  const cost = costFor(feature)
  sound.unlock()

  const balanceBefore = balance.value
  let debited = false

  const data = await requestSpin(cost, feature ? { feature } : undefined, () => {
    sound.play('spin')
    winShown.value = 0
    winEquation.value = ''
    tumbleCount.value = 0
    setBalance(balanceBefore - cost)
    debited = true
  })

  if (!data) {
    if (debited) setBalance(balanceBefore)
    stopAutoSpin()
    return
  }

  const result = data.gameData
  activeBet = result.bet
  presenting.value = true

  try {
    clearSpots()
    const baseWin = await playSequence(result.base, 0, true)
    winShown.value = baseWin

    if (result.bonusTriggered && result.bonus) {
      await celebrateScatters(result.scatterCells)
      if (autoSpinEnabled.value && autoStopOnBonus.value) stopAutoSpin()
      await openBonusIntro()
      await runBonus(result)
    }

    winShown.value = result.payout
    winEquation.value = ''
    const x = result.payout / result.bet
    if (x >= CANDY_BIG_WIN_AT) {
      await showBigWin(result.payout, result.bet, result.bonusTriggered ? 'Free spins total' : undefined)
    } else if (result.bonusTriggered && result.bonus) {
      await showBonusOutro(result.payout)
    } else if (result.payout > 0) {
      sound.play(x >= 8 ? 'win-big' : x >= 2 ? 'win-medium' : 'win-small')
      winPulse.value++
    }
    setBalance(data.balance)
    pushHistory({ payout: result.payout, bet: result.cost, bonus: result.bonusTriggered })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    setBalance(data.balance)
    stopAutoSpin()
  } finally {
    isSpinning.value = false
    presenting.value = false
    inBonus.value = false
  }

  if (autoSpinEnabled.value && !destroyed) {
    autoSpinsLeft.value--
    if (autoSpinsLeft.value > 0 && balance.value >= spinCost.value) {
      await wait(t(350, 120))
      if (autoSpinEnabled.value) spin()
    } else {
      stopAutoSpin()
    }
  }
}

/**
 * Play one tumble sequence. `offset` is what the win meter already shows
 * (bonus total so far). Returns the currency this sequence paid.
 */
async function playSequence(seq: TumbleSequence, offset: number, initial: boolean): Promise<number> {
  reelSet.setSpeed?.(turbo.value ? 'turbo' : 'normal')
  const first = seq.steps[0]?.grid ?? seq.restGrid

  // Anticipation: two lollipops already down with columns still to land.
  let antic: number[] = []
  if (initial) {
    let seen = 0
    for (let c = 0; c < CM_COLS; c++) {
      seen += first[c]!.filter(s => s === 'scatter').length
      if (seen >= 2 && c < CM_COLS - 1) {
        antic = Array.from({ length: CM_COLS - 1 - c }, (_, i) => c + 1 + i)
        break
      }
    }
  }

  // Columns drop left to right; after the second lollipop the remaining
  // columns hold back so the player sweats the third.
  const step = t(110, 25)
  const delays: number[] = []
  for (let c = 0; c < CM_COLS; c++) {
    const prev = delays[c - 1] ?? -step
    delays.push(antic.includes(c) ? prev + t(750, 450) : prev + step)
  }
  reelSet.setDropOrder(delays)
  anticFrom = antic[0] ?? -1

  dropping = true
  scattersSeen = 0
  const spinPromise = reelSet.spin({ mode: 'cascade' })
  reelSet.setResult(toTargets(first))
  await spinPromise
  dropping = false
  anticipating.value = false
  // Refills drop every column together.
  reelSet.setDropOrder('all')

  let baseSoFar = 0
  await reelSet.runCascade({
    // Unmounting mid-cascade destroys the reels' symbols while this chain is
    // still awaiting. Reporting no winners ends the cascade cleanly.
    detectWinners: async (_g: string[][], lvl: number) => {
      const step = seq.steps[lvl]
      if (destroyed || !step) return []
      await presentClusters(step, lvl + 1)
      if (destroyed) return []
      return step.winCells.map((c: Cell) => ({ reel: c.col, row: c.row }))
    },
    nextGrid: (_g: string[][], _w: unknown, lvl: number) => (seq.steps[lvl + 1]?.grid ?? seq.restGrid) as unknown as string[][],
    onCascade: ({ chain }: { chain: number }) => {
      const step = seq.steps[chain - 1]
      if (!step) return
      baseSoFar += step.stepPay * activeBet
      winShown.value = offset + baseSoFar
      winPulse.value++
      syncSpots(step.spotsAfter)
      setTimeout(() => sound.play('tumble'), t(200, 90))
    },
    pauseAfterDestroyMs: t(300, 120),
    maxChain: 64
  })

  if (destroyed || seq.basePay <= 0) return 0

  // Apply the multiplier sum to the whole sequence.
  const total = seq.win * activeBet
  const mult = Math.max(1, seq.multiplierSum)
  winEquation.value = `${formatNumber(baseSoFar)} × ${formatNumber(mult, false)}`
  await flySpotsToMeter()
  sound.play('mult-apply')
  await countTo(winShown, offset + total, t(900, 400))
  winPulse.value++
  await wait(t(450, 150))
  winEquation.value = ''
  return total
}

async function celebrateScatters(cells: Cell[]) {
  sound.play('bonus-trigger')
  for (const c of cells) {
    const sym = reelSet.reels[c.col]?.getSymbolAt(c.row)
    sym?.playWin?.()
    const p = cellCenter(c.col, c.row)
    for (let i = 0; i < 3; i++) setTimeout(() => !destroyed && burst(p.x, p.y, 0xff6fd1, 1.3), i * 250)
  }
  try {
    await reelSet.spotlight.show(cells.map(c => ({ reelIndex: c.col, rowIndex: c.row })))
  } catch { /* the board may be torn down mid-show */ }
  await wait(1300)
  // show() dims the board and never restores it by itself.
  safeDestroy(() => reelSet.spotlight.hide())
}

function openBonusIntro(): Promise<void> {
  bonusIntro.value = true
  return new Promise<void>((resolve) => {
    // Auto spin waits for a tap so the player gets to watch the bonus.
    const timer = autoSpinEnabled.value ? null : setTimeout(() => bonusGate?.(), 6000)
    bonusGate = () => {
      if (timer) clearTimeout(timer)
      bonusGate = null
      bonusIntro.value = false
      bonusOutro.value = false
      resolve()
    }
  })
}

function closeGate() {
  sound.unlock()
  sound.play('click')
  bonusGate?.()
}

async function runBonus(result: CandyMadnessResult) {
  const bonus = result.bonus!
  sound.play('bonus-start')
  inBonus.value = true
  bonusTotal.value = 0
  bonusRound.value = 0
  winShown.value = 0
  clearSpots()
  await wait(700)

  for (const fs of bonus.spins) {
    if (destroyed) return
    bonusRound.value = fs.round
    tumbleCount.value = 0
    sound.play('bonus-spin', { intensity: fs.round })
    const before = bonusTotal.value
    const win = await playSequence(fs.sequence, before, false)
    bonusTotal.value = before + win
    winShown.value = bonusTotal.value
    await wait(t(500, 200))
  }
  bonusTotal.value = result.bonusPayout
  winShown.value = result.bonusPayout
}

function showBonusOutro(amount: number): Promise<void> {
  bonusOutroAmount.value = amount
  bonusOutro.value = true
  sound.play('bonus-end')
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => bonusGate?.(), autoSpinEnabled.value ? 2800 : 4500)
    bonusGate = () => {
      clearTimeout(timer)
      bonusGate = null
      bonusOutro.value = false
      resolve()
    }
  })
}

function showBigWin(amount: number, betAmount: number, subtitle?: string): Promise<void> {
  bigWin.value = { amount, bet: betAmount, subtitle }
  return new Promise<void>((resolve) => {
    bigWinDone = () => {
      bigWinDone = null
      bigWin.value = null
      resolve()
    }
  })
}

function onBigWinDone() {
  sound.play('bigwin-end')
  bigWinDone?.()
}

// --- controls ------------------------------------------------------------------------
const canSpin = computed(() => ready.value && !isSpinning.value && !presenting.value && balance.value >= spinCost.value)

function onSpinButton() {
  sound.unlock()
  if (autoSpinEnabled.value) {
    stopAutoSpin()
    sound.play('toggle', { intensity: 0 })
    return
  }
  if (!canSpin.value) return
  spin()
}

function toggleTurbo() {
  turbo.value = !turbo.value
  sound.unlock()
  sound.play('toggle', { intensity: turbo.value ? 1 : 0 })
}

function openAuto() {
  if (autoSpinEnabled.value) {
    stopAutoSpin()
    return
  }
  sound.unlock()
  sound.play('click')
  showAuto.value = true
}

function openRules() {
  sound.unlock()
  sound.play('click')
  showRules.value = true
}

function toggleSound() {
  soundEnabled.value = !soundEnabled.value
  if (soundEnabled.value) {
    sound.unlock()
    setTimeout(() => sound.play('toggle', { intensity: 1 }), 60)
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.code !== 'Space' || e.repeat) return
  const el = e.target as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
  if (showRules.value || showAuto.value) return
  e.preventDefault()
  if (bonusIntro.value || bonusOutro.value) {
    closeGate()
    return
  }
  if (bigWin.value) return
  onSpinButton()
}

const lollipopUrl = computed(() => ready.value ? candyDataUrl('scatter', 128) : '')
const heartUrl = computed(() => ready.value ? candyDataUrl('red', 96) : '')
const spinsLeft = computed(() => Math.max(0, CM_FREE_SPINS - bonusRound.value))
const multColor = computed(() => hexCss(spotColor(2 ** Math.max(1, Math.min(11, Math.floor(Math.log2(Math.max(2, multSum.value))))))))
</script>

<template>
  <div
    class="cm-root"
    :class="{ 'is-bonus': inBonus }"
  >
    <CandyBackdrop :bonus="inBonus" />

    <div class="cm-stage">
      <header class="cm-logo">
        <img
          v-if="lollipopUrl"
          :src="lollipopUrl"
          alt=""
          class="cm-logo__art cm-logo__art--l"
        >
        <h1 class="cm-logo__title">
          <span class="cm-logo__candy">Candy</span>
          <span class="cm-logo__madness">Madness</span>
        </h1>
        <img
          v-if="heartUrl"
          :src="heartUrl"
          alt=""
          class="cm-logo__art cm-logo__art--r"
        >
      </header>
      <div class="cm-chips">
        <span class="cm-chip">98% RTP</span>
        <span class="cm-chip cm-chip--vol"><SlotVolatility :level="CM_VOLATILITY" /></span>
        <span class="cm-chip">{{ formatNumber(CM_MAX_WIN_MULT, false) }}× max win</span>
      </div>

      <div class="cm-main">
        <!-- Feature buys -->
        <aside class="cm-side cm-side--left">
          <button
            class="cm-feature cm-feature--buy"
            :class="{ 'is-armed': buyArmed }"
            :disabled="!ready || betLocked || balance < buyFreeSpinsCost"
            @click="onBuyClick"
          >
            <span class="cm-feature__art">
              <img
                v-if="lollipopUrl"
                :src="lollipopUrl"
                alt=""
              >
            </span>
            <span class="cm-feature__text">
              <span class="cm-feature__title">{{ buyArmed ? 'Tap to confirm' : 'Buy free spins' }}</span>
              <span class="cm-feature__desc">{{ CM_FREE_SPINS }} free spins, multipliers stay</span>
            </span>
            <span class="cm-feature__price">
              <UIcon
                name="i-lucide-coins"
                class="size-3.5"
              />
              {{ formatNumber(buyFreeSpinsCost) }}
            </span>
          </button>

          <button
            class="cm-feature cm-feature--hunt"
            :class="{ 'is-on': huntMode }"
            :disabled="!ready || betLocked"
            :aria-pressed="huntMode"
            @click="toggleHunt"
          >
            <span class="cm-feature__switch"><i /></span>
            <span class="cm-feature__text">
              <span class="cm-feature__title">Bonus hunter</span>
              <span class="cm-feature__desc">A lollipop on every spin</span>
            </span>
            <span class="cm-feature__price">
              <UIcon
                name="i-lucide-coins"
                class="size-3.5"
              />
              {{ formatNumber(bonusHuntCost) }}<small>/spin</small>
            </span>
          </button>
        </aside>

        <!-- Cabinet -->
        <div class="cm-cabinet">
          <div
            class="cm-frame"
            :class="{ 'is-anticipating': anticipating }"
          >
            <div class="cm-bulbs cm-bulbs--top" />
            <div class="cm-bulbs cm-bulbs--bottom" />

            <div class="cm-topbar">
              <div
                v-if="inBonus"
                class="cm-pill cm-pill--spins"
              >
                <span class="cm-pill__label">Free spins</span>
                <span class="cm-pill__value">{{ spinsLeft }}</span>
              </div>
              <div
                :key="multPulse"
                class="cm-pill cm-pill--mult"
                :class="{ 'is-live': multSum > 0 }"
                :style="{ '--mult-color': multColor }"
              >
                <span class="cm-pill__label">Multiplier</span>
                <span class="cm-pill__value">×{{ formatNumber(multSum, true) }}</span>
              </div>
              <div
                v-if="tumbleCount > 1"
                :key="`tumble-${tumbleCount}`"
                class="cm-pill cm-pill--tumble"
              >
                <span class="cm-pill__label">Tumble</span>
                <span class="cm-pill__value">{{ tumbleCount }}</span>
              </div>
            </div>

            <div class="cm-window">
              <div
                ref="canvasWrap"
                class="cm-canvas"
              />

              <div
                v-if="!ready && !errorMsg"
                class="cm-loading"
              >
                <UIcon
                  name="i-lucide-loader-circle"
                  class="size-10 animate-spin"
                />
              </div>

              <Transition name="cm-pop">
                <div
                  v-if="bonusIntro"
                  class="cm-splash"
                  @click="closeGate"
                >
                  <div class="cm-splash__rays" />
                  <img
                    v-if="lollipopUrl"
                    :src="lollipopUrl"
                    alt=""
                    class="cm-splash__lolly"
                  >
                  <p class="cm-splash__kicker">
                    You won
                  </p>
                  <p class="cm-splash__big">
                    {{ CM_FREE_SPINS }} free spins
                  </p>
                  <p class="cm-splash__text">
                    Multiplier spots stay on the board for every spin.
                  </p>
                  <button class="cm-splash__btn">
                    Start
                  </button>
                </div>
              </Transition>

              <Transition name="cm-pop">
                <div
                  v-if="bonusOutro"
                  class="cm-splash"
                  @click="closeGate"
                >
                  <div class="cm-splash__rays" />
                  <p class="cm-splash__kicker">
                    Free spins complete
                  </p>
                  <p class="cm-splash__big">
                    <UIcon
                      name="i-lucide-coins"
                      class="cm-splash__coin"
                    />
                    {{ formatNumber(bonusOutroAmount) }}
                  </p>
                  <p class="cm-splash__text">
                    {{ bonusOutroAmount > 0 ? `${formatNumber(bonusOutroAmount / activeBet, false)}× your bet` : 'No win this time' }}
                  </p>
                  <button class="cm-splash__btn">
                    Collect
                  </button>
                </div>
              </Transition>

              <Transition name="cm-pop">
                <CandyBigWin
                  v-if="bigWin"
                  :amount="bigWin.amount"
                  :bet="bigWin.bet"
                  :subtitle="bigWin.subtitle"
                  @tier="(i: number) => sound.play('bigwin-tier', { intensity: i })"
                  @tick="sound.play('tick')"
                  @done="onBigWinDone"
                />
              </Transition>
            </div>
          </div>

          <!-- Control deck -->
          <div class="cm-deck">
            <div class="cm-meter cm-meter--balance">
              <span class="cm-meter__label">Balance</span>
              <span class="cm-meter__value">
                <UIcon
                  name="i-lucide-coins"
                  class="cm-coin"
                />
                {{ formatNumber(balance) }}
              </span>
            </div>

            <div
              class="cm-meter cm-meter--bet"
              :class="{ 'is-locked': betLocked }"
            >
              <span class="cm-meter__label">
                Bet
                <button
                  class="cm-max"
                  :disabled="betLocked || bet === maxAffordableBet"
                  @click="betMax"
                >MAX</button>
              </span>
              <div class="cm-bet">
                <button
                  class="cm-round cm-round--sm"
                  aria-label="Lower bet"
                  :disabled="betLocked || bet <= MIN_BET"
                  @click="betDown"
                >
                  <UIcon name="i-lucide-minus" />
                </button>
                <input
                  v-if="betEditing"
                  ref="betInputEl"
                  v-model="betText"
                  class="cm-bet__input"
                  aria-label="Bet amount"
                  inputmode="decimal"
                  @blur="commitBet"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                >
                <button
                  v-else
                  class="cm-bet__value"
                  title="Type a bet"
                  :disabled="betLocked"
                  @click="editBet"
                >
                  {{ formatNumber(bet) }}
                </button>
                <button
                  class="cm-round cm-round--sm"
                  aria-label="Raise bet"
                  :disabled="betLocked || bet >= MAX_BET"
                  @click="betUp"
                >
                  <UIcon name="i-lucide-plus" />
                </button>
              </div>
              <span
                v-if="betEditing && amountPreview(betText, true)"
                class="cm-bet__preview"
              >{{ amountPreview(betText, true) }}</span>
              <span
                v-else-if="huntMode"
                class="cm-bet__preview"
              >Spin costs {{ formatNumber(spinCost) }}</span>
            </div>

            <div class="cm-meter cm-meter--win">
              <span class="cm-meter__label">{{ inBonus ? 'Bonus win' : 'Win' }}</span>
              <span
                :key="winPulse"
                class="cm-meter__win"
                :class="{ 'is-hot': winShown > 0 }"
              >{{ formatNumber(winShown) }}</span>
              <span
                v-if="winEquation"
                class="cm-meter__eq"
              >{{ winEquation }}</span>
            </div>

            <div class="cm-actions">
              <button
                class="cm-round"
                :class="{ 'is-on': turbo }"
                title="Turbo"
                aria-label="Turbo"
                :aria-pressed="turbo"
                @click="toggleTurbo"
              >
                <UIcon name="i-lucide-zap" />
              </button>
              <button
                class="cm-spin"
                :class="{ 'is-busy': isSpinning || presenting, 'is-auto': autoSpinEnabled }"
                :disabled="!autoSpinEnabled && !canSpin"
                :aria-label="autoSpinEnabled ? 'Stop auto spin' : 'Spin'"
                @click="onSpinButton"
              >
                <span class="cm-spin__ring" />
                <span
                  v-if="autoSpinEnabled"
                  class="cm-spin__auto"
                >
                  <b>{{ autoSpinsLeft }}</b>
                  <small>STOP</small>
                </span>
                <UIcon
                  v-else
                  name="i-lucide-rotate-cw"
                  class="cm-spin__icon"
                />
              </button>
              <button
                class="cm-round"
                :class="{ 'is-on': autoSpinEnabled }"
                title="Auto spin"
                aria-label="Auto spin"
                :disabled="!autoSpinEnabled && !canSpin"
                @click="openAuto"
              >
                <UIcon :name="autoSpinEnabled ? 'i-lucide-square' : 'i-lucide-repeat'" />
              </button>
            </div>

            <div class="cm-utils">
              <button
                class="cm-util"
                title="Rules and paytable"
                aria-label="Rules and paytable"
                @click="openRules"
              >
                <UIcon name="i-lucide-info" />
              </button>
              <div
                class="cm-sound"
                @mouseleave="showSound = false"
              >
                <button
                  class="cm-util"
                  :title="soundEnabled ? 'Sound' : 'Sound off'"
                  aria-label="Sound settings"
                  @click="showSound = !showSound"
                >
                  <UIcon :name="soundEnabled && soundVolume > 0 ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" />
                </button>
                <div
                  v-if="showSound"
                  class="cm-sound__pop"
                >
                  <button
                    class="cm-sound__toggle"
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
              </div>
            </div>
          </div>

          <Transition name="cm-fade">
            <div
              v-if="errorMsg"
              class="cm-error"
            >
              <span>{{ errorMsg }}</span>
              <button
                aria-label="Dismiss"
                @click="errorMsg = ''"
              >
                <UIcon name="i-lucide-x" />
              </button>
            </div>
          </Transition>
        </div>

        <!-- Info column -->
        <aside class="cm-side cm-side--right">
          <div class="cm-panel">
            <p class="cm-panel__title">
              How it pays
            </p>
            <ul class="cm-panel__list">
              <li><b>4+</b> matching candies touching side by side</li>
              <li>Popped squares leave <b>×2</b> spots that double on every repeat pop</li>
              <li>All spots add up and multiply the spin's win</li>
              <li><b>3 lollipops</b> = {{ CM_FREE_SPINS }} free spins, about 1 in {{ formatNumber(CANDY_BONUS_ODDS, false) }} spins</li>
            </ul>
            <button
              class="cm-panel__link"
              @click="openRules"
            >
              Full rules and paytable
            </button>
          </div>
          <div
            v-if="history.length"
            class="cm-panel"
          >
            <p class="cm-panel__title">
              Last spins
            </p>
            <div class="cm-history">
              <span
                v-for="(h, i) in history"
                :key="i"
                :class="{ win: h.payout > h.bet, bonus: h.bonus }"
              >
                <UIcon
                  v-if="h.bonus"
                  name="i-lucide-candy"
                  class="size-3"
                />
                {{ h.payout > 0 ? formatNumber(h.payout) : '–' }}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>

    <CandyRules
      v-model:open="showRules"
      :bet="bet"
    />
    <CandyAutoSpin
      v-model:open="showAuto"
      :spin-cost="spinCost"
      @start="startAutoSpin"
    />
  </div>
</template>

<style scoped>
.cm-root {
  --cm-ink: #2a0838;
  --cm-pink: #ff5fa8;
  --cm-pink-hi: #ff9fd3;
  --cm-gold: #ffd35a;
  --cm-cream: #fff4fb;
  position: relative;
  min-height: 100%;
  overflow: hidden;
  font-family: 'Fredoka', system-ui, sans-serif;
  color: var(--cm-cream);
  isolation: isolate;
}

.cm-stage {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 16px 28px;
}

/* ── logo ─────────────────────────────────────────────────────────── */
.cm-logo {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.cm-logo__title {
  display: flex;
  align-items: baseline;
  gap: 0.25em;
  font-family: 'Lilita One', system-ui, sans-serif;
  font-weight: 400;
  font-size: clamp(34px, 6vw, 56px);
  line-height: 1.05;
  letter-spacing: 0.01em;
  transform: rotate(-2deg);
}

.cm-logo__candy, .cm-logo__madness {
  display: inline-block;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-stroke: 2px #5a0f45;
  paint-order: stroke fill;
}

.cm-logo__candy {
  background-image: linear-gradient(180deg, #fff 0%, #ffd0ea 30%, #ff5fa8 70%, #d81f78 100%);
  filter: drop-shadow(0 4px 0 #5a0f45) drop-shadow(0 8px 16px rgba(120, 10, 80, 0.45));
}

.cm-logo__madness {
  background-image: linear-gradient(180deg, #fffbe0 0%, #ffe38a 35%, #ffb52e 70%, #e07800 100%);
  filter: drop-shadow(0 4px 0 #5a0f45) drop-shadow(0 8px 16px rgba(120, 60, 0, 0.45));
  animation: cm-wobble 3.2s ease-in-out infinite;
}

@keyframes cm-wobble {
  0%, 100% { transform: rotate(0) translateY(0); }
  50% { transform: rotate(2deg) translateY(-2px); }
}

.cm-logo__art {
  width: clamp(40px, 6vw, 58px);
  height: auto;
  filter: drop-shadow(0 4px 6px rgba(80, 0, 60, 0.45));
}

.cm-logo__art--l { rotate: -18deg; animation: cm-bob 2.6s ease-in-out infinite; }
.cm-logo__art--r { rotate: 14deg; animation: cm-bob 2.6s ease-in-out -1.3s infinite; }

@keyframes cm-bob {
  0%, 100% { translate: 0 0; }
  50% { translate: 0 -5px; }
}

.cm-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin: 10px 0 24px;
}

.cm-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #fff;
  background: rgba(58, 10, 74, 0.72);
  border: 1.5px solid rgba(255, 159, 211, 0.6);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.cm-chip--vol :deep(.text-muted) { color: #f0c8e6; }

/* ── layout ───────────────────────────────────────────────────────── */
.cm-main {
  display: grid;
  grid-template-columns: 1fr minmax(0, 640px) 1fr;
  gap: 20px;
  width: 100%;
  max-width: 1180px;
  align-items: start;
}

.cm-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 230px;
}

.cm-side--left { justify-self: end; margin-top: 40px; }
.cm-side--right { justify-self: start; margin-top: 40px; }

@media (max-width: 1100px) {
  .cm-main { grid-template-columns: minmax(0, 640px); justify-content: center; }
  .cm-side--left { order: 2; flex-direction: row; max-width: none; margin-top: 0; justify-self: stretch; }
  .cm-side--left > * { flex: 1; }
  .cm-side--right { display: none; }
}

@media (max-width: 480px) {
  .cm-side--left { flex-direction: column; }
}

/* ── feature cards ────────────────────────────────────────────────── */
.cm-feature {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 8px 10px;
  padding: 12px;
  border-radius: 20px;
  text-align: left;
  cursor: pointer;
  color: #fff;
  background: linear-gradient(180deg, #7a1f86 0%, #4a1466 100%);
  border: 2.5px solid #ff9fd3;
  box-shadow: 0 5px 0 #2a0838, 0 12px 24px rgba(30, 0, 40, 0.45), inset 0 2px 0 rgba(255, 255, 255, 0.25);
  transition: transform 0.12s, filter 0.12s, box-shadow 0.12s;
}

.cm-feature:not(:disabled):hover { transform: translateY(-2px); filter: brightness(1.08); }
.cm-feature:not(:disabled):active { transform: translateY(3px); box-shadow: 0 2px 0 #2a0838, 0 6px 12px rgba(30, 0, 40, 0.4); }
.cm-feature:disabled { opacity: 0.5; cursor: default; filter: saturate(0.6); }

.cm-feature--buy {
  background: linear-gradient(180deg, #ff6fb5 0%, #c2257a 100%);
  border-color: #ffe38a;
}

.cm-feature--buy.is-armed {
  animation: cm-armed 0.5s ease-in-out infinite alternate;
  border-color: #fff;
}

@keyframes cm-armed {
  from { box-shadow: 0 5px 0 #2a0838, 0 0 0 0 rgba(255, 227, 138, 0.8); }
  to { box-shadow: 0 5px 0 #2a0838, 0 0 0 6px rgba(255, 227, 138, 0.25); }
}

.cm-feature__art {
  grid-row: span 2;
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0) 70%);
}

.cm-feature__art img { width: 44px; height: 44px; animation: cm-bob 2.2s ease-in-out infinite; }

.cm-feature__text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }

.cm-feature__title {
  font-family: 'Lilita One', system-ui, sans-serif;
  font-size: 17px;
  letter-spacing: 0.02em;
  line-height: 1.1;
  text-shadow: 0 2px 0 rgba(60, 0, 50, 0.5);
}

.cm-feature__desc {
  font-size: 12px;
  line-height: 1.3;
  color: rgba(255, 240, 250, 0.85);
}

.cm-feature__price {
  grid-column: 2;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 14px;
  color: var(--cm-gold);
  background: rgba(42, 8, 56, 0.6);
  font-variant-numeric: tabular-nums;
}

.cm-feature__price small { font-size: 10px; opacity: 0.75; margin-left: 1px; }

.cm-feature__switch {
  grid-row: span 2;
  position: relative;
  width: 46px;
  height: 26px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.35);
  transition: background 0.2s;
}

.cm-feature__switch i {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fff, #e8d4f2);
  box-shadow: 0 2px 3px rgba(0, 0, 0, 0.35);
  transition: transform 0.2s cubic-bezier(0.3, 1.6, 0.5, 1);
}

.cm-feature--hunt.is-on {
  border-color: #7df5c4;
  background: linear-gradient(180deg, #1fae78 0%, #0d6b52 100%);
}

.cm-feature--hunt.is-on .cm-feature__switch { background: #7df5c4; }
.cm-feature--hunt.is-on .cm-feature__switch i { transform: translateX(20px); }

/* ── cabinet frame ────────────────────────────────────────────────── */
.cm-cabinet {
  position: relative;
  width: 100%;
  max-width: max(340px, min(640px, calc((100dvh - 250px) * 0.97)));
  justify-self: center;
}

.cm-frame {
  position: relative;
  padding: 26px 14px 18px;
  border-radius: 34px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 18%),
    repeating-linear-gradient(135deg, #ff5fa8 0 16px, #fff4fb 16px 32px);
  box-shadow:
    inset 0 0 0 5px var(--cm-gold),
    inset 0 0 0 8px #b8317b,
    0 0 0 4px #5a0f45,
    0 18px 50px rgba(40, 0, 50, 0.55),
    0 0 60px rgba(255, 95, 168, 0.35);
  transition: box-shadow 0.4s;
}

.is-bonus .cm-frame {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 18%),
    repeating-linear-gradient(135deg, #ffb52e 0 16px, #fff6d8 16px 32px);
  box-shadow:
    inset 0 0 0 5px #fff1a8,
    inset 0 0 0 8px #c77a00,
    0 0 0 4px #5a2a00,
    0 18px 50px rgba(40, 0, 50, 0.55),
    0 0 80px rgba(255, 200, 60, 0.55);
}

.cm-frame.is-anticipating {
  animation: cm-antic 0.35s ease-in-out infinite alternate;
}

@keyframes cm-antic {
  from { box-shadow: inset 0 0 0 5px var(--cm-gold), inset 0 0 0 8px #b8317b, 0 0 0 4px #5a0f45, 0 0 30px rgba(255, 211, 90, 0.5); }
  to { box-shadow: inset 0 0 0 5px #fff, inset 0 0 0 8px #ff5fa8, 0 0 0 4px #5a0f45, 0 0 90px rgba(255, 211, 90, 0.95); }
}

.cm-bulbs {
  position: absolute;
  left: 30px;
  right: 30px;
  height: 12px;
  background: radial-gradient(circle, #fff9d6 0 3px, rgba(255, 211, 90, 0.85) 4px, rgba(255, 211, 90, 0) 6.5px) 0 50% / 24px 12px repeat-x;
  animation: cm-chase 1.2s linear infinite;
  pointer-events: none;
}

.cm-bulbs--top { top: 8px; }
.cm-bulbs--bottom { bottom: 3px; animation-direction: reverse; }
.is-bonus .cm-bulbs { animation-duration: 0.45s; }

@keyframes cm-chase {
  from { background-position: 0 50%; }
  to { background-position: 24px 50%; }
}

.cm-topbar {
  position: absolute;
  top: -16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  gap: 6px;
  white-space: nowrap;
}

.cm-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 14px 4px 12px;
  border-radius: 999px;
  background: linear-gradient(180deg, #5a1a72, #2a0838);
  border: 2.5px solid var(--cm-gold);
  box-shadow: 0 4px 0 #1c0426, 0 8px 18px rgba(0, 0, 0, 0.35);
  animation: cm-pill-in 0.4s cubic-bezier(0.3, 1.8, 0.5, 1);
}

@keyframes cm-pill-in {
  from { transform: scale(1.25); }
  to { transform: scale(1); }
}

.cm-pill__label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #e7c4f5;
}

.cm-pill__value {
  font-family: 'Lilita One', system-ui, sans-serif;
  font-size: 20px;
  line-height: 1;
  color: #fff;
  font-variant-numeric: tabular-nums;
}

.cm-pill--mult { --mult-color: #ff7ac0; }
.cm-pill--mult:not(.is-live) .cm-pill__value { color: rgba(255, 255, 255, 0.45); }

.cm-pill--mult.is-live {
  border-color: var(--mult-color);
  box-shadow: 0 4px 0 #1c0426, 0 0 22px color-mix(in srgb, var(--mult-color) 70%, transparent);
}

.cm-pill--mult.is-live .cm-pill__value {
  color: var(--mult-color);
  text-shadow: 0 0 12px color-mix(in srgb, var(--mult-color) 60%, transparent);
}

.cm-pill--spins { border-color: #7df5c4; }
.cm-pill--spins .cm-pill__value { color: #7df5c4; }
.cm-pill--tumble .cm-pill__value { color: var(--cm-pink-hi); }

@media (max-width: 480px) {
  .cm-pill { padding: 3px 10px; gap: 5px; }
  .cm-pill__label { font-size: 9px; letter-spacing: 0.08em; }
  .cm-pill__value { font-size: 16px; }
}

.cm-window {
  position: relative;
  border-radius: 22px;
  overflow: hidden;
  aspect-ratio: 1 / 1;
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255, 140, 210, 0.28), transparent 70%),
    radial-gradient(ellipse 70% 50% at 50% 100%, rgba(120, 60, 220, 0.3), transparent 70%),
    linear-gradient(180deg, #5a1a7a 0%, #36104f 55%, #240a38 100%);
  box-shadow: inset 0 0 0 3px #2a0838, inset 0 8px 24px rgba(0, 0, 0, 0.55), inset 0 -4px 12px rgba(255, 150, 220, 0.12);
}

.is-bonus .cm-window {
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255, 200, 80, 0.3), transparent 70%),
    radial-gradient(ellipse 70% 50% at 50% 100%, rgba(255, 90, 160, 0.3), transparent 70%),
    linear-gradient(180deg, #6a1e5a 0%, #3e0f42 55%, #2a0a30 100%);
}

.cm-canvas {
  position: absolute;
  inset: 0;
}

.cm-canvas :deep(canvas) { display: block; }

.cm-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--cm-pink-hi);
}

/* ── bonus splash ─────────────────────────────────────────────────── */
.cm-splash {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  text-align: center;
  cursor: pointer;
  overflow: hidden;
  background: radial-gradient(circle, rgba(90, 14, 90, 0.75), rgba(20, 2, 30, 0.92));
}

.cm-splash__rays {
  position: absolute;
  inset: -50%;
  background: repeating-conic-gradient(rgba(255, 211, 90, 0.18) 0deg 10deg, transparent 10deg 24deg);
  mask-image: radial-gradient(circle, #000, transparent 55%);
  animation: cm-rotate 16s linear infinite;
}

@keyframes cm-rotate {
  to { transform: rotate(360deg); }
}

.cm-splash > :not(.cm-splash__rays) { position: relative; }

.cm-splash__lolly {
  width: clamp(80px, 22%, 130px);
  filter: drop-shadow(0 0 30px rgba(255, 111, 209, 0.8));
  animation: cm-bob 1.8s ease-in-out infinite;
}

.cm-splash__kicker {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #ffe6f4;
}

.cm-splash__big {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: 'Lilita One', system-ui, sans-serif;
  font-size: clamp(38px, 9vw, 70px);
  line-height: 1.05;
  background: linear-gradient(180deg, #fff 0%, #ffe38a 40%, #ff9a2e 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-stroke: 2px #5a0f45;
  paint-order: stroke fill;
  filter: drop-shadow(0 4px 0 #5a0f45) drop-shadow(0 0 24px rgba(255, 180, 60, 0.7));
  font-variant-numeric: tabular-nums;
}

.cm-splash__coin { color: var(--cm-gold); width: 0.8em; height: 0.8em; }

.cm-splash__text {
  max-width: 320px;
  font-size: 15px;
  color: #f4dcf9;
}

.cm-splash__btn {
  margin-top: 12px;
  padding: 12px 38px;
  border-radius: 999px;
  font-family: 'Lilita One', system-ui, sans-serif;
  font-size: 22px;
  letter-spacing: 0.04em;
  color: #fff;
  background: linear-gradient(180deg, #5ef2a8, #16b86a);
  box-shadow: 0 5px 0 #0b7a45, 0 10px 24px rgba(0, 0, 0, 0.4), inset 0 2px 0 rgba(255, 255, 255, 0.5);
  text-shadow: 0 2px 0 rgba(0, 80, 40, 0.6);
  animation: cm-throb 0.9s ease-in-out infinite alternate;
}

@keyframes cm-throb {
  from { transform: scale(1); }
  to { transform: scale(1.06); }
}

/* ── control deck ─────────────────────────────────────────────────── */
.cm-deck {
  position: relative;
  margin-top: 14px;
  display: grid;
  /* The bet sizes to its content so compact bets like 2,5B never clip. */
  grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1.2fr) auto;
  grid-template-areas: 'util bal bet win act';
  align-items: center;
  gap: 8px 10px;
  padding: 12px 14px;
  border-radius: 26px;
  background: linear-gradient(180deg, #5a1a72 0%, #36104f 100%);
  border: 3px solid #ff9fd3;
  box-shadow: 0 0 0 3px #5a0f45, 0 12px 30px rgba(30, 0, 40, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.2);
}

.cm-meter--balance { grid-area: bal; }
.cm-meter--bet { grid-area: bet; }
.cm-meter--win { grid-area: win; }
.cm-actions { grid-area: act; }
.cm-utils { grid-area: util; }

.cm-meter {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  min-height: 62px;
  padding: 6px 8px;
  border-radius: 16px;
  background: linear-gradient(180deg, #1c0426, #2c0a3c);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.6), 0 1px 0 rgba(255, 255, 255, 0.15);
}

.cm-meter__label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #c9a6db;
}

.cm-meter__value {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff;
}

.cm-coin { width: 16px; height: 16px; color: var(--cm-gold); flex: none; }

.cm-meter--win {
  background: linear-gradient(180deg, #14021c, #2a0838);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.7), 0 0 0 2px rgba(255, 211, 90, 0.35);
}

.cm-meter__win {
  font-family: 'Lilita One', system-ui, sans-serif;
  font-size: 28px;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.35);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cm-meter__win.is-hot {
  color: var(--cm-gold);
  text-shadow: 0 0 16px rgba(255, 200, 60, 0.65), 0 2px 0 #7a3a00;
  animation: cm-pill-in 0.35s cubic-bezier(0.3, 1.8, 0.5, 1);
}

.cm-meter__eq {
  position: absolute;
  bottom: -9px;
  padding: 1px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: var(--cm-ink);
  background: var(--cm-gold);
  white-space: nowrap;
  animation: cm-pill-in 0.3s cubic-bezier(0.3, 1.8, 0.5, 1);
}

.cm-max {
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--cm-ink);
  background: var(--cm-gold);
  cursor: pointer;
}

.cm-max:disabled { opacity: 0.4; cursor: default; }

.cm-bet {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  justify-content: space-between;
}

.cm-bet__value, .cm-bet__input {
  /* Fixed room for compact bets like 2,5B or 999K; an input left to size
     itself would take its default ~20ch width and squeeze the meters. */
  flex: 0 0 auto;
  width: 5.2ch;
  min-width: 0;
  font-size: 18px;
  font-weight: 700;
  text-align: center;
  color: #fff;
  font-variant-numeric: tabular-nums;
  background: transparent;
  cursor: text;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cm-bet__input {
  border-radius: 8px;
  outline: 2px solid var(--cm-gold);
  background: rgba(255, 255, 255, 0.08);
}

.cm-bet__value:disabled { cursor: default; }

.cm-bet__preview {
  position: absolute;
  bottom: -9px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--cm-ink);
  background: var(--cm-pink-hi);
  white-space: nowrap;
}

.is-locked .cm-bet__value { opacity: 0.6; }

.cm-round {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  font-size: 20px;
  color: #fff;
  cursor: pointer;
  background: radial-gradient(circle at 35% 28%, #a64fc4, #5a1a72 70%);
  box-shadow: 0 3px 0 #1c0426, inset 0 2px 0 rgba(255, 255, 255, 0.3), 0 0 0 2px rgba(255, 159, 211, 0.55);
  transition: transform 0.1s, filter 0.1s;
}

.cm-round--sm { width: 30px; height: 30px; font-size: 15px; box-shadow: 0 2px 0 #1c0426, inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 0 0 1.5px rgba(255, 159, 211, 0.55); }
.cm-round:not(:disabled):hover { filter: brightness(1.15); }
.cm-round:not(:disabled):active { transform: translateY(2px); }
.cm-round:disabled { opacity: 0.4; cursor: default; }

.cm-round.is-on {
  color: var(--cm-ink);
  background: radial-gradient(circle at 35% 28%, #fff4c2, #ffc23a 70%);
  box-shadow: 0 3px 0 #7a4a00, inset 0 2px 0 rgba(255, 255, 255, 0.6), 0 0 16px rgba(255, 211, 90, 0.7);
}

.cm-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cm-spin {
  position: relative;
  display: grid;
  place-items: center;
  width: 92px;
  height: 92px;
  margin: -18px 0;
  border-radius: 50%;
  cursor: pointer;
  color: #fff;
  background: radial-gradient(circle at 38% 28%, #fff 0%, #ffb3dc 14%, #ff5fa8 45%, #c2257a 80%, #8a1257 100%);
  box-shadow:
    0 6px 0 #5a0f45,
    0 14px 30px rgba(120, 10, 80, 0.55),
    0 0 0 4px var(--cm-gold),
    0 0 0 7px #5a0f45,
    inset 0 -6px 12px rgba(90, 0, 60, 0.45);
  transition: transform 0.12s, filter 0.12s, box-shadow 0.12s;
}

.cm-spin:not(:disabled):hover { filter: brightness(1.08); transform: translateY(-1px) scale(1.02); }
.cm-spin:not(:disabled):active { transform: translateY(4px); box-shadow: 0 2px 0 #5a0f45, 0 6px 14px rgba(120, 10, 80, 0.5), 0 0 0 4px var(--cm-gold), 0 0 0 7px #5a0f45, inset 0 -6px 12px rgba(90, 0, 60, 0.45); }
.cm-spin:disabled { cursor: default; }
.cm-spin:disabled:not(.is-busy) { filter: saturate(0.5) brightness(0.85); }

.cm-spin__ring {
  position: absolute;
  inset: 8px;
  border-radius: 50%;
  background: repeating-conic-gradient(rgba(255, 255, 255, 0.55) 0deg 15deg, transparent 15deg 45deg);
  mask-image: radial-gradient(circle, transparent 55%, #000 57%, #000 70%, transparent 72%);
  opacity: 0.7;
}

.cm-spin.is-busy .cm-spin__ring { animation: cm-rotate 0.7s linear infinite; }
.cm-spin:not(:disabled):not(.is-busy) .cm-spin__ring { animation: cm-rotate 8s linear infinite; }

.cm-spin__icon {
  position: relative;
  width: 40px;
  height: 40px;
  filter: drop-shadow(0 2px 0 rgba(90, 0, 60, 0.6));
}

.cm-spin.is-busy .cm-spin__icon { animation: cm-rotate 0.6s linear infinite; }

.cm-spin__auto {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
  text-shadow: 0 2px 0 rgba(90, 0, 60, 0.6);
}

.cm-spin__auto b { font-family: 'Lilita One', system-ui, sans-serif; font-size: 26px; font-weight: 400; }
.cm-spin__auto small { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; }

.cm-utils {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cm-util {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  font-size: 17px;
  color: #e7c4f5;
  background: rgba(255, 255, 255, 0.07);
  cursor: pointer;
}

.cm-util:hover { color: #fff; background: rgba(255, 255, 255, 0.14); }

.cm-sound { position: relative; }

.cm-sound__pop {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 14px;
  background: var(--cm-ink);
  border: 2px solid #ff9fd3;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
}

.cm-sound__toggle {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: var(--cm-ink);
  background: var(--cm-gold);
  cursor: pointer;
}

.cm-sound__pop input { width: 110px; accent-color: #ff5fa8; }

@media (max-width: 640px) {
  .cm-stage { padding: 8px 10px 20px; }
  .cm-frame { padding: 22px 8px 12px; border-radius: 26px; }
  .cm-window { border-radius: 16px; }
  .cm-deck {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas: 'win win' 'bal bet' 'act act' 'util util';
    padding: 10px;
  }
  .cm-actions { justify-content: center; gap: 18px; padding: 16px 0 6px; }
  .cm-spin { margin: 0; }
  .cm-utils { flex-direction: row; justify-content: center; }
  .cm-meter__win { font-size: 26px; }
}

/* ── side panels ──────────────────────────────────────────────────── */
.cm-panel {
  padding: 14px;
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(74, 20, 102, 0.92), rgba(42, 8, 56, 0.92));
  border: 2px solid rgba(255, 159, 211, 0.55);
  box-shadow: 0 10px 24px rgba(30, 0, 40, 0.4);
}

.cm-panel__title {
  font-family: 'Lilita One', system-ui, sans-serif;
  font-size: 17px;
  color: var(--cm-gold);
  margin-bottom: 8px;
}

.cm-panel__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  line-height: 1.4;
  color: #ecd3f6;
}

.cm-panel__list li { padding-left: 14px; position: relative; }
.cm-panel__list li::before { content: ''; position: absolute; left: 0; top: 7px; width: 6px; height: 6px; border-radius: 50%; background: var(--cm-pink); }
.cm-panel__list b { color: #fff; }

.cm-panel__link {
  margin-top: 10px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--cm-pink-hi);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.cm-history {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.cm-history span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.45);
  background: rgba(0, 0, 0, 0.25);
}

.cm-history span.win { color: #7df5c4; background: rgba(63, 224, 160, 0.14); }
.cm-history span.bonus { color: var(--cm-gold); background: rgba(255, 211, 90, 0.14); }

.cm-error {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 14px;
  font-size: 13px;
  color: #ffd0da;
  background: rgba(120, 0, 30, 0.75);
  border: 1.5px solid #ff6b8a;
}

.cm-pop-enter-active { transition: opacity 0.25s, transform 0.35s cubic-bezier(0.3, 1.6, 0.5, 1); }
.cm-pop-leave-active { transition: opacity 0.2s, transform 0.2s; }
.cm-pop-enter-from { opacity: 0; transform: scale(1.1); }
.cm-pop-leave-to { opacity: 0; transform: scale(0.95); }
.cm-fade-enter-active, .cm-fade-leave-active { transition: opacity 0.2s; }
.cm-fade-enter-from, .cm-fade-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .cm-logo__madness, .cm-logo__art, .cm-bulbs, .cm-spin__ring, .cm-feature__art img { animation: none !important; }
}
</style>
