<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  AetherBonusTier,
  AetherFeature,
  AetherGatesResult,
  AetherSequence,
  AetherStep,
  AetherSymbol,
  Cell,
  MultDrop
} from '#shared/utils/gamelogic/aethergates'
import {
  AETHER_PAY_SYMBOLS,
  AETHER_SYMBOL_WEIGHTS,
  AG_BONUS_CHANCE_COST,
  AG_BUY_FREESPINS_COST,
  AG_BUY_SUPERBONUS_COST,
  AG_COLS,
  AG_FREE_SPINS,
  AG_FREE_SPINS_SUPER,
  AG_MIN_MATCH,
  AG_RETRIGGER_SPINS,
  AG_ROWS,
  AG_SCATTER_TRIGGER,
  AG_SCATTER_TRIGGER_SUPER
} from '#shared/utils/gamelogic/aethergates'
import AgAutoSpinModal from '~/components/games/aethergates/AgAutoSpinModal.vue'
import AgBackdrop from '~/components/games/aethergates/AgBackdrop.vue'
import AgBigWin from '~/components/games/aethergates/AgBigWin.vue'
import AgLogo from '~/components/games/aethergates/AgLogo.vue'
import AgMeter from '~/components/games/aethergates/AgMeter.vue'
import AgPaytable from '~/components/games/aethergates/AgPaytable.vue'
import {
  AG_FONT,
  AG_ORB_TIERS,
  AG_SYMBOL_INFO,
  agGateFrameCanvas,
  agGlowCanvas,
  agOrbCanvas,
  agOrbTier,
  agPortalCanvas,
  agShardCanvas,
  agSymbolCanvas,
  agSymbolDataUrl
} from '~/utils/slots/aethergates-art'
import { AgFx, type AgPoint } from '~/utils/slots/aethergates-fx'
import { AG_WIN_TIERS, agBetLadder, agWinTier, type AgAutoSettings } from '~/utils/slots/aethergates-ui'
import { initSlotPixiApp, safeDestroy } from '~/utils/slot-pixi'

useHead({
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&display=swap' }
  ]
})

const toast = useToast()
const sound = useAethergatesSound()
const { soundEnabled, soundVolume } = sound
const { bet, isSpinning, errorMsg, balance, setBalance, history, pushHistory, spin: requestSpin } = useSlotGame<AetherGatesResult, { payout: number, cost: number, bonus: boolean }>('aethergates')

watch(errorMsg, (msg) => {
  if (msg) toast.add({ title: 'Spin failed', description: msg, color: 'error' })
})

// --- bet ----------------------------------------------------------------------
const MIN_BET = 1
const MAX_BET = 100_000_000_000
const BET_LADDER = agBetLadder(MAX_BET)

const betDraft = ref(bet.value)
const betText = useAmountInput(betDraft, { integer: true, shorthand: true })
watch(bet, (v) => {
  betDraft.value = v
})

const locked = computed(() => isSpinning.value || autoLeft.value > 0 || overlayBusy.value)

function setBet(v: number, cue?: 'bet-up' | 'bet-down' | 'bet-max') {
  if (locked.value) return
  const next = Math.min(MAX_BET, Math.max(MIN_BET, Math.floor(Number.isFinite(v) ? v : MIN_BET)))
  if (next !== bet.value && cue) sound.play(cue)
  bet.value = next
  betDraft.value = next
}

function commitBet() {
  setBet(betDraft.value || MIN_BET)
  betText.value = amountShorthand(bet.value)
}

function betDown() {
  const lower = [...BET_LADDER].reverse().find(v => v < bet.value)
  setBet(lower ?? MIN_BET, 'bet-down')
}

function betUp() {
  const higher = BET_LADDER.find(v => v > bet.value)
  setBet(higher ?? MAX_BET, 'bet-up')
}

function betMax() {
  const affordable = [...BET_LADDER].reverse().find(v => v <= balance.value)
  setBet(affordable ?? MIN_BET, 'bet-max')
}

// --- features -------------------------------------------------------------------
const bonusChance = ref(false)
const buyFreeCost = computed(() => bet.value * AG_BUY_FREESPINS_COST)
const buySuperCost = computed(() => bet.value * AG_BUY_SUPERBONUS_COST)
const chanceCost = computed(() => bet.value * AG_BONUS_CHANCE_COST)
const spinCost = computed(() => (bonusChance.value ? chanceCost.value : bet.value))

function costFor(feature?: AetherFeature): number {
  if (feature === 'buyFreeSpins') return buyFreeCost.value
  if (feature === 'superBonus') return buySuperCost.value
  if (feature === 'bonusChance') return chanceCost.value
  return bet.value
}

function toggleChance() {
  if (locked.value) return
  bonusChance.value = !bonusChance.value
  sound.play('toggle')
}

const buyConfirm = ref<'buyFreeSpins' | 'superBonus' | null>(null)

function askBuy(feature: 'buyFreeSpins' | 'superBonus') {
  if (locked.value || !ready.value) return
  sound.play('click')
  buyConfirm.value = feature
}

function confirmBuy() {
  const feature = buyConfirm.value
  buyConfirm.value = null
  if (!feature || balance.value < costFor(feature)) return
  sound.play('buy-bonus')
  void spin(feature)
}

// --- round / ui state ------------------------------------------------------------
const ready = ref(false)
const turbo = ref(false)
const hurry = ref(false)
const showPaytable = ref(false)
const showAuto = ref(false)
const showVolume = ref(false)

const winShown = ref(0)
const winLabel = ref('Win')
const meter = ref(0)
const meterHit = ref(0)
const meterApplying = ref(false)
const ticker = ref('')

const inBonus = ref(false)
const bonusTier = ref<AetherBonusTier>('normal')
const fsRound = ref(0)
const fsTotal = ref(0)
const bonusBase = ref(0)
const bonusWin = computed(() => Math.max(0, winShown.value - bonusBase.value))

type Overlay =
  | { kind: 'intro', tier: AetherBonusTier, spins: number, meter: number, bought: boolean }
  | { kind: 'retrigger' }
  | { kind: 'outro', total: number, spins: number, meter: number }
  | { kind: 'apply', base: number, meter: number, total: number }
const overlay = ref<Overlay | null>(null)
const bigWin = ref<{ amount: number, bet: number } | null>(null)
const bigWinSkip = ref(0)
const overlayBusy = computed(() => !!overlay.value || !!bigWin.value)

let overlayResolve: (() => void) | null = null

function waitOverlay(o: Overlay, autoMs: number): Promise<void> {
  overlay.value = o
  return new Promise((resolve) => {
    const timer = setTimeout(done, autoMs)
    function done() {
      clearTimeout(timer)
      overlayResolve = null
      overlay.value = null
      resolve()
    }
    overlayResolve = done
  })
}

function dismissOverlay() {
  overlayResolve?.()
}

let bigWinResolve: (() => void) | null = null

function showBigWin(amount: number, resultBet: number): Promise<void> {
  bigWin.value = { amount, bet: resultBet }
  return new Promise((resolve) => {
    bigWinResolve = () => {
      bigWinResolve = null
      bigWin.value = null
      resolve()
    }
  })
}

function closeBigWin() {
  bigWinResolve?.()
}

function onBigWinTier(index: number) {
  const tier = AG_WIN_TIERS[index]
  if (!tier) return
  if (index === 0) sound.play(tier.sound)
  else sound.play('tier-up', { intensity: index })
  if (index > 0) sound.play(tier.sound)
}

// --- autoplay ------------------------------------------------------------------------
const autoLeft = ref(0)
let autoSettings: AgAutoSettings = { count: 0, stopOnFeature: false, stopOnWin: 0 }

function startAuto(settings: AgAutoSettings) {
  showAuto.value = false
  autoSettings = settings
  autoLeft.value = settings.count
  sound.play('click')
  if (!isSpinning.value) void spin()
}

function stopAuto() {
  autoLeft.value = 0
}

// --- timing helpers -------------------------------------------------------------------
function speed(): number {
  return (turbo.value ? 0.5 : 1) * (hurry.value ? 0.55 : 1)
}

function wait(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function beat(ms: number) {
  return wait(Math.round(ms * speed()))
}

let winRun = 0

/** Count the win meter up to `to`, ticking as it goes. */
function countWin(to: number, ms = 600) {
  const run = ++winRun
  const from = winShown.value
  if (to <= from) {
    winShown.value = to
    return
  }
  const start = performance.now()
  const d = Math.max(120, ms * speed())
  let lastTick = 0
  const frame = (now: number) => {
    if (run !== winRun) return
    const t = Math.min(1, (now - start) / d)
    winShown.value = from + (to - from) * (1 - (1 - t) ** 3)
    if (now - lastTick > 65 && t < 1) {
      lastTick = now
      sound.play('tick', { intensity: t })
    }
    if (t < 1) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

const TIPS = [
  `${AG_MIN_MATCH} or more matching symbols anywhere pay`,
  'Every paying tumble sends all storm orbs into the meter',
  `${AG_SCATTER_TRIGGER} Aether Gates start ${AG_FREE_SPINS} free spins`,
  'In free spins the meter never resets',
  'Press Space to spin'
]
let tipIndex = 0
let tipTimer: ReturnType<typeof setInterval> | null = null

function idleTicker() {
  ticker.value = TIPS[tipIndex % TIPS.length]!
}

// --- Pixi scene --------------------------------------------------------------------------
const canvasWrap = ref<HTMLDivElement>()
const fxCanvas = ref<HTMLCanvasElement>()
const meterComp = ref<InstanceType<typeof AgMeter>>()
const winEl = ref<HTMLElement>()

let app: any = null
let reelSet: any = null
let PIXI: any = null
let REELS: any = null
let GSAP: any = null
let fx: AgFx | null = null
let destroyed = false
let resizeObserver: ResizeObserver | null = null
let boardLayer: any = null
let anticLayer: any = null
let particleLayer: any = null
let floatLayer: any = null

const TEX: Record<string, any> = {}
// Tweens on short-lived effect objects, killed on unmount so none outlive their target.
const looseTweens = new Set<any>()

function loose(tween: any) {
  looseTweens.add(tween)
  tween.eventCallback?.('onInterrupt', () => looseTweens.delete(tween))
  const done = tween.vars?.onComplete
  tween.eventCallback?.('onComplete', () => {
    looseTweens.delete(tween)
    done?.()
  })
  return tween
}
const portals = new Set<any>()
const orbGlows = new Set<any>()
interface Shard { sprite: any, vx: number, vy: number, vr: number, life: number, age: number }
const shards: Shard[] = []

const CELL = 100
const GAP = 6
const PAD = 14
const REEL_W = AG_COLS * CELL + (AG_COLS - 1) * GAP
const REEL_H = AG_ROWS * CELL + (AG_ROWS - 1) * GAP
const APP_W = REEL_W + PAD * 2
const APP_H = REEL_H + PAD * 2

let pendingMults: MultDrop[] = []

function cellLocal(col: number, row: number) {
  return { x: PAD + col * (CELL + GAP) + CELL / 2, y: PAD + row * (CELL + GAP) + CELL / 2 }
}

function cellScreen(cell: Cell): AgPoint | null {
  const canvas = app?.canvas as HTMLCanvasElement | undefined
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const p = cellLocal(cell.col, cell.row)
  return { x: rect.left + (p.x / APP_W) * rect.width, y: rect.top + (p.y / APP_H) * rect.height }
}

function elCenter(el: HTMLElement | undefined | null): AgPoint | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function meterPoint(): AgPoint | null {
  return elCenter(meterComp.value?.target as HTMLElement | undefined)
}

function tileAt(col: number, row: number): any {
  return reelSet?.getReel?.(col)?.getSymbolAt?.(row) ?? null
}

function toTargets(grid: AetherSymbol[][]) {
  return grid.map(col => ({ visible: col }))
}

function toCells(cells: Cell[]) {
  return cells.map(c => ({ reel: c.col, row: c.row }))
}

function randomGrid(): AetherSymbol[][] {
  // Cosmetic idle board shown before the first spin.
  return Array.from({ length: AG_COLS }, () =>
    Array.from({ length: AG_ROWS }, () => AETHER_PAY_SYMBOLS[Math.floor(Math.random() * AETHER_PAY_SYMBOLS.length)]!)
  )
}

function applyPendingMults(info: { reelIndex: number, placedSymbols: readonly any[] }) {
  for (const drop of pendingMults) {
    if (drop.col !== info.reelIndex) continue
    info.placedSymbols[drop.row]?.setMultValue?.(drop.value)
  }
}

function pixelRatio(): number {
  const dpr = window.devicePixelRatio || 1
  const shown = canvasWrap.value?.clientWidth || APP_W
  const scale = shown / APP_W
  // Never below native; supersample standard-density screens for the thin glows.
  return Math.min(3, Math.max(dpr * scale, dpr <= 1 ? Math.min(1.5, Math.max(1, scale * 1.25)) : 1))
}

function fitResolution() {
  if (!app?.renderer) return
  const res = pixelRatio()
  if (Math.abs(app.renderer.resolution - res) > 0.05) app.renderer.resize(APP_W, APP_H, res)
}

function buildTextures(res: number) {
  // Keep detailed art sharp when resizing from a narrow view to a large display.
  const size = Math.max(384, Math.min(512, Math.ceil(CELL * res * 1.5)))
  for (const id of [...AETHER_PAY_SYMBOLS]) TEX[id] = PIXI.Texture.from(agSymbolCanvas(id, size))
  TEX.gate = PIXI.Texture.from(agGateFrameCanvas(size))
  TEX.portal = PIXI.Texture.from(agPortalCanvas(size))
  AG_ORB_TIERS.forEach((_, i) => {
    TEX[`orb${i}`] = PIXI.Texture.from(agOrbCanvas(size, i))
  })
  TEX.glow = PIXI.Texture.from(agGlowCanvas(128))
  TEX.shard = PIXI.Texture.from(agShardCanvas(32))
}

function makeTileClass() {
  const { Container, Sprite, Text } = PIXI

  class AgTile extends REELS.ReelSymbol {
    inner = new Container()
    glow = new Sprite()
    portal = new Sprite()
    art = new Sprite()
    label = new Text({
      text: '',
      style: {
        fontFamily: AG_FONT,
        fontSize: 30,
        fontWeight: '900',
        fill: 0xfffbeb,
        stroke: { color: 0x1a0f02, width: 6, join: 'round' },
        dropShadow: { color: 0x000000, blur: 3, distance: 2, alpha: 0.7, angle: Math.PI / 2 }
      }
    })

    w = CELL
    h = CELL
    value: number | undefined = undefined
    tweens: any[] = []

    constructor() {
      super()
      for (const s of [this.glow, this.portal, this.art, this.label]) s.anchor.set(0.5)
      this.glow.texture = TEX.glow
      this.glow.blendMode = 'add'
      this.inner.addChild(this.glow, this.portal, this.art, this.label)
      this.view.addChild(this.inner)
    }

    draw(id: string) {
      const size = Math.min(this.w, this.h)
      this.inner.position.set(this.w / 2, this.h / 2)
      this.portal.visible = false
      this.label.visible = false
      this.glow.alpha = 0
      portals.delete(this.portal)
      orbGlows.delete(this.glow)
      if (id === 'scatter') {
        this.art.texture = TEX.gate
        this.portal.texture = TEX.portal
        this.portal.visible = true
        this.portal.width = this.portal.height = size
        portals.add(this.portal)
        this.glow.tint = 0x67e8f9
        this.glow.alpha = 0.45
      } else if (id === 'multiplier') {
        const tier = agOrbTier(this.value ?? 2)
        this.art.texture = TEX[`orb${tier}`]
        this.glow.tint = AG_ORB_TIERS[tier]!.color
        this.glow.alpha = 0.5
        orbGlows.add(this.glow)
        if (this.value) {
          const digits = String(this.value).length
          this.label.text = `×${this.value}`
          this.label.style.fontSize = size * (digits >= 3 ? 0.26 : 0.32)
          this.label.visible = true
          this.label.position.set(0, size * 0.02)
        }
      } else {
        this.art.texture = TEX[id]
        this.glow.tint = AG_SYMBOL_INFO[id as AetherSymbol]?.color ?? 0xffffff
      }
      this.art.width = this.art.height = size
      this.glow.width = this.glow.height = size * 1.5
    }

    setMultValue(value: number | undefined) {
      this.value = value
      if (this.symbolId === 'multiplier') this.draw('multiplier')
    }

    onActivate(id: string) {
      this.kill()
      this.value = undefined
      this.inner.alpha = 1
      this.inner.scale.set(1)
      this.inner.rotation = 0
      this.draw(id)
    }

    onDeactivate() {
      this.kill()
      portals.delete(this.portal)
      orbGlows.delete(this.glow)
    }

    resize(w: number, h: number) {
      this.w = w
      this.h = h
      if (this.symbolId) this.draw(this.symbolId)
    }

    kill() {
      for (const t of this.tweens) t.kill()
      this.tweens = []
    }

    stopAnimation() {
      this.kill()
      this.inner.scale.set(1)
      this.inner.alpha = 1
    }

    dim(on: boolean) {
      this.tweens.push(GSAP.to(this.inner, { alpha: on ? 0.35 : 1, duration: 0.18 }))
    }

    playWin() {
      this.kill()
      this.inner.alpha = 1
      return new Promise<void>((resolve) => {
        const base = this.glow.alpha
        this.tweens.push(GSAP.fromTo(this.glow, { alpha: 0.2 }, { alpha: 1, duration: 0.16, yoyo: true, repeat: 3, onComplete: () => {
          this.glow.alpha = base
        } }))
        this.tweens.push(GSAP.to(this.inner.scale, { x: 1.14, y: 1.14, duration: 0.16, yoyo: true, repeat: 3, ease: 'sine.inOut', onComplete: resolve }))
      })
    }

    charge() {
      this.kill()
      this.tweens.push(GSAP.to(this.glow, { alpha: 1, duration: 0.15 }))
      this.tweens.push(GSAP.fromTo(this.inner.scale, { x: 1, y: 1 }, { x: 1.25, y: 1.25, duration: 0.14, yoyo: true, repeat: 1, ease: 'back.out(2)' }))
    }

    playDestroy(opts: { delay?: number, signal?: AbortSignal } = {}) {
      this.kill()
      return new Promise<void>((resolve) => {
        // Leave the destroyed pose on the view (the library resets that when it
        // reuses the symbol) and restore our own inner container.
        const finish = () => {
          this.view.alpha = 0
          this.inner.alpha = 1
          this.inner.rotation = 0
          this.inner.scale.set(1)
          resolve()
        }
        if (opts.signal?.aborted) return finish()
        const tl = GSAP.timeline({ delay: opts.delay ?? 0, onComplete: finish })
        tl.to(this.inner.scale, { x: 1.22, y: 1.22, duration: 0.07, ease: 'power2.out' })
          .to(this.glow, { alpha: 1, duration: 0.07 }, '<')
          .to(this.inner.scale, { x: 0.2, y: 0.2, duration: 0.16, ease: 'power2.in' })
          .to(this.inner, { alpha: 0, rotation: (Math.random() - 0.5) * 0.8, duration: 0.16 }, '<')
        this.tweens.push(tl)
        opts.signal?.addEventListener('abort', () => {
          tl.kill()
          finish()
        }, { once: true })
      })
    }
  }

  return AgTile
}

function drawBoard() {
  const { Graphics } = PIXI
  const g = new Graphics()
  for (let c = 0; c < AG_COLS; c++) {
    for (let r = 0; r < AG_ROWS; r++) {
      const x = PAD + c * (CELL + GAP)
      const y = PAD + r * (CELL + GAP)
      g.roundRect(x, y, CELL, CELL, 10).fill({ color: 0xb7d3e8, alpha: 0.025 })
      g.roundRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1, 10).stroke({ color: 0xb7d3e8, alpha: 0.055, width: 0.7 })
    }
  }
  return g
}

function tick(ticker: any) {
  const dt = ticker.deltaMS / 1000
  const t = performance.now() / 1000
  for (const p of portals) p.rotation += dt * (inBonus.value ? 1.4 : 0.8)
  for (const g of orbGlows) g.alpha = 0.4 + Math.sin(t * 3 + g.x) * 0.15
  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i]!
    s.age += dt
    s.vy += 900 * dt
    s.sprite.x += s.vx * dt
    s.sprite.y += s.vy * dt
    s.sprite.rotation += s.vr * dt
    s.sprite.alpha = Math.max(0, 1 - s.age / s.life)
    if (s.age >= s.life) {
      s.sprite.destroy()
      shards.splice(i, 1)
    }
  }
  if (anticLayer?.visible) anticLayer.alpha = 0.65 + Math.sin(t * 9) * 0.35
}

function spawnShatter(cells: Cell[], grid: AetherSymbol[][]) {
  if (!particleLayer) return
  const { Sprite, Graphics } = PIXI
  const per = turbo.value ? 5 : 9
  for (const cell of cells) {
    const sym = grid[cell.col]?.[cell.row]
    const color = sym ? AG_SYMBOL_INFO[sym].color : 0xffffff
    const p = cellLocal(cell.col, cell.row)
    for (let k = 0; k < per; k++) {
      const s = new Sprite(TEX.shard)
      s.anchor.set(0.5)
      s.tint = k % 3 ? color : 0xffffff
      s.blendMode = 'add'
      const size = 8 + Math.random() * 12
      s.width = s.height = size
      s.position.set(p.x + (Math.random() - 0.5) * 30, p.y + (Math.random() - 0.5) * 30)
      particleLayer.addChild(s)
      const a = Math.random() * Math.PI * 2
      const v = 120 + Math.random() * 260
      shards.push({ sprite: s, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 180, vr: (Math.random() - 0.5) * 14, life: 0.55 + Math.random() * 0.4, age: 0 })
    }
    const flash = new Graphics().circle(0, 0, CELL * 0.42).fill({ color, alpha: 0.55 })
    flash.position.set(p.x, p.y)
    flash.blendMode = 'add'
    particleLayer.addChild(flash)
    loose(GSAP.to(flash.scale, { x: 1.6, y: 1.6, duration: 0.3, ease: 'power2.out' }))
    loose(GSAP.to(flash, { alpha: 0, duration: 0.3, onComplete: () => flash.destroy() }))
  }
}

function floatText(text: string, x: number, y: number, color = 0xfde68a, size = 30) {
  if (!floatLayer) return
  const t = new PIXI.Text({
    text,
    style: {
      fontFamily: AG_FONT,
      fontSize: size,
      fontWeight: '900',
      fill: color,
      stroke: { color: 0x1a0f02, width: 7, join: 'round' },
      dropShadow: { color: 0x000000, blur: 4, distance: 3, alpha: 0.7, angle: Math.PI / 2 }
    }
  })
  t.anchor.set(0.5)
  t.position.set(x, y)
  floatLayer.addChild(t)
  const d = turbo.value ? 0.9 : 1.4
  loose(GSAP.fromTo(t.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2.4)' }))
  loose(GSAP.to(t, { y: y - 46, duration: d, ease: 'power1.out' }))
  loose(GSAP.to(t, { alpha: 0, duration: d * 0.35, delay: d * 0.65, onComplete: () => t.destroy() }))
}

function setAnticipation(cols: number[]) {
  if (!anticLayer) return
  anticLayer.removeChildren().forEach((c: any) => c.destroy())
  if (!cols.length) {
    anticLayer.visible = false
    return
  }
  const { Graphics } = PIXI
  for (const c of cols) {
    const x = PAD + c * (CELL + GAP) - 3
    const g = new Graphics()
    g.roundRect(x, PAD - 3, CELL + 6, REEL_H + 6, 16).fill({ color: 0x67e8f9, alpha: 0.1 })
    g.roundRect(x, PAD - 3, CELL + 6, REEL_H + 6, 16).stroke({ color: 0xa5f3fc, alpha: 0.9, width: 3 })
    g.label = `col${c}`
    anticLayer.addChild(g)
  }
  anticLayer.visible = true
}

function clearAnticipationCol(col: number) {
  if (!anticLayer) return
  const g = anticLayer.children.find((ch: any) => ch.label === `col${col}`)
  if (g) {
    anticLayer.removeChild(g)
    g.destroy()
  }
  if (!anticLayer.children.length) anticLayer.visible = false
}

// --- drop bookkeeping (landing sounds, gate chimes, anticipation) -------------------
let dropGrid: AetherSymbol[][] | null = null
let dropMults: MultDrop[] = []
let landed = new Set<number>()
let gatesSeen = 0
let anticCols: number[] = []
let anticShown = false

function onReelLanded(col: number) {
  if (!dropGrid || landed.has(col)) return
  landed.add(col)
  const pan = (col / (AG_COLS - 1)) * 1.2 - 0.6
  sound.play('reel-land', { intensity: col, pan })
  const gates = dropGrid[col]!.filter(s => s === 'scatter').length
  if (gates) {
    gatesSeen += gates
    sound.play('scatter-land', { intensity: gatesSeen, pan })
    for (let r = 0; r < AG_ROWS; r++) {
      if (dropGrid[col]![r] === 'scatter') {
        const p = cellScreen({ col, row: r })
        if (p) fx?.burst(p, '#a5f3fc', 14, 180, 0.6)
      }
    }
  }
  const orbs = dropMults.filter(m => m.col === col)
  if (orbs.length) sound.play('orb-land', { intensity: Math.max(...orbs.map(o => o.value)), pan })
  clearAnticipationCol(col)
  // The tease follows the drop: light only the next column still to land.
  const next = anticCols.find(c => !landed.has(c))
  if (next !== undefined && gatesSeen >= AG_SCATTER_TRIGGER - 1) {
    setAnticipation([next])
    if (!anticShown) sound.play('anticipation')
    anticShown = true
  }
}

function dropDelays(grid: AetherSymbol[][]): { delays: number[], antic: number[] } {
  const step = turbo.value ? 45 : 110
  const gap = turbo.value ? 520 : 950
  const delays: number[] = []
  const antic: number[] = []
  let acc = 0
  let seen = 0
  for (let c = 0; c < AG_COLS; c++) {
    if (seen >= AG_SCATTER_TRIGGER - 1) {
      antic.push(c)
      acc += gap
    } else if (c > 0) {
      acc += step
    }
    delays.push(acc)
    seen += grid[c]!.filter(s => s === 'scatter').length
  }
  return { delays, antic }
}

// --- sequence playback ---------------------------------------------------------------
async function dropGridIn(grid: AetherSymbol[][], mults: MultDrop[]) {
  const { delays, antic } = dropDelays(grid)
  dropGrid = grid
  dropMults = mults
  landed = new Set()
  gatesSeen = 0
  anticCols = antic
  anticShown = false
  pendingMults = mults
  reelSet.setSpeed?.(turbo.value ? 'turbo' : 'normal')
  reelSet.setDropOrder(delays)
  const spinning = reelSet.spin({ mode: 'cascade' })
  reelSet.setResult(toTargets(grid))
  await spinning
  for (let c = 0; c < AG_COLS; c++) onReelLanded(c)
  setAnticipation([])
  dropGrid = null
  reelSet.setDropOrder('all')
}

async function collectOrbs(step: AetherStep) {
  if (!step.multipliers.length) return
  const target = meterPoint()
  let running = step.meterBefore
  const flights = step.multipliers.map(async (drop, i) => {
    await wait(i * Math.round(140 * speed()))
    const tile = tileAt(drop.col, drop.row)
    tile?.charge?.()
    sound.play('orb-charge', { intensity: drop.value })
    await wait(Math.round(160 * speed()))
    const from = cellScreen(drop)
    const color = AG_ORB_TIERS[agOrbTier(drop.value)]!.css
    sound.play('orb-zap')
    if (from && target && fx) {
      fx.bolt(from, target, color, 0.35 + Math.min(0.3, drop.value / 200), drop.value >= 25 ? 4.5 : 3)
      await fx.comet(from, target, color, 0.5 * Math.max(0.6, speed()), drop.value >= 25 ? 18 : 13)
    }
    running += drop.value
    meter.value = running
    meterHit.value++
    sound.play('meter-hit', { intensity: running })
    if (target) fx?.burst(target, color, 16, 200, 0.6)
  })
  const cells = step.multipliers.map(m => ({ reel: m.col, row: m.row }))
  await wait(Math.round(280 * speed()))
  const vanish = reelSet.destroySymbols(cells, { delay: (_: unknown, i: number) => i * 0.14 * speed() })
  await Promise.all([...flights, vanish])
  meter.value = step.meterAfter
}

function dimAll(on: boolean, except?: Set<string>) {
  for (let c = 0; c < AG_COLS; c++) {
    for (let r = 0; r < AG_ROWS; r++) {
      if (except?.has(`${c}:${r}`)) continue
      tileAt(c, r)?.dim?.(on)
    }
  }
}

async function playStep(step: AetherStep, index: number, next: { grid: AetherSymbol[][], mults: MultDrop[] }, resultBet: number, winBase: { value: number }) {
  const winners = new Set(step.winCells.map(c => `${c.col}:${c.row}`))
  sound.play('win-cluster', { intensity: index + 1 })
  dimAll(true, new Set([...winners, ...step.multipliers.map(m => `${m.col}:${m.row}`)]))
  const pulses = step.winCells.map(c => tileAt(c.col, c.row)?.playWin?.())

  // Label each paying group at its centre.
  const names: string[] = []
  for (const w of step.wins) {
    const cx = w.cells.reduce((s, c) => s + cellLocal(c.col, c.row).x, 0) / w.cells.length
    const cy = w.cells.reduce((s, c) => s + cellLocal(c.col, c.row).y, 0) / w.cells.length
    floatText(formatNumber(w.payMult * resultBet), cx, cy, 0xfde68a, 32)
    names.push(`${w.count}× ${AG_SYMBOL_INFO[w.symbol].name} pays ${formatNumber(w.payMult * resultBet)}`)
  }
  ticker.value = names.join(' · ')
  winBase.value += step.stepPayMult * resultBet
  countWin(winBase.value, 500)
  await Promise.race([Promise.all(pulses), wait(1400)])
  await beat(80)

  sound.play('shatter')
  spawnShatter(step.winCells, step.grid)
  await reelSet.destroySymbols(toCells(step.winCells), { delay: (_: unknown, i: number) => (i % 6) * 0.015 })
  dimAll(false, winners)

  await collectOrbs(step)
  await beat(120)

  const clear = [...step.winCells, ...step.multipliers.map(m => ({ col: m.col, row: m.row }))]
  pendingMults = next.mults
  sound.play('tumble')
  await reelSet.refill({ winners: toCells(clear), grid: toTargets(next.grid) })
  // Orbs that just fell in announce themselves.
  const holes = new Map<number, number>()
  for (const c of clear) holes.set(c.col, (holes.get(c.col) ?? 0) + 1)
  const fresh = next.mults.filter(m => m.row < (holes.get(m.col) ?? 0))
  if (fresh.length) sound.play('orb-land', { intensity: Math.max(...fresh.map(m => m.value)) })
  await beat(140)
}

/** Replays one tumble sequence. Returns the base (pre-meter) win it showed. */
async function playSequence(seq: AetherSequence, resultBet: number, winOffset: number): Promise<void> {
  meter.value = seq.meterBefore
  const first = seq.steps[0]?.grid ?? seq.restGrid
  const firstMults = seq.steps[0]?.multipliers ?? seq.restMults
  await dropGridIn(first, firstMults)

  const winBase = { value: winOffset }
  for (let i = 0; i < seq.steps.length; i++) {
    if (destroyed) return
    const step = seq.steps[i]!
    const nextStep = seq.steps[i + 1]
    const next = { grid: nextStep?.grid ?? seq.restGrid, mults: nextStep?.multipliers ?? seq.restMults }
    await playStep(step, i, next, resultBet, winBase)
  }
  meter.value = seq.meterAfter

  if (seq.basePayMult > 0 && seq.meterAfter > 1) {
    // The meter strikes the win: base × meter.
    const base = seq.basePayMult * resultBet
    const total = seq.winMult * resultBet
    meterApplying.value = true
    overlay.value = { kind: 'apply', base, meter: seq.meterAfter, total }
    await beat(500)
    const from = meterPoint()
    const to = elCenter(winEl.value)
    sound.play('orb-zap')
    if (from && to && fx) {
      fx.bolt(from, to, '#fde68a', 0.5, 5)
      await fx.comet(from, to, '#fde68a', 0.45, 20)
      fx.burst(to, '#fde68a', 26, 260, 0.8)
    }
    sound.play('meter-hit', { intensity: seq.meterAfter * 4 })
    countWin(winOffset + total, 700)
    ticker.value = `${formatNumber(base)} × ${formatNumber(seq.meterAfter, false, 0)} = ${formatNumber(total)}`
    await beat(1100)
    overlay.value = null
    meterApplying.value = false
  } else if (seq.winMult > 0) {
    countWin(winOffset + seq.winMult * resultBet, 300)
  }
}

function scatterCellsOf(grid: AetherSymbol[][]): Cell[] {
  const cells: Cell[] = []
  grid.forEach((col, c) => col.forEach((s, r) => {
    if (s === 'scatter') cells.push({ col: c, row: r })
  }))
  return cells
}

async function celebrateGates(cells: Cell[]) {
  for (const c of cells) {
    tileAt(c.col, c.row)?.playWin?.()
    const p = cellScreen(c)
    if (p) fx?.burst(p, '#67e8f9', 26, 260, 0.9)
  }
  const target = meterPoint()
  for (const c of cells) {
    const p = cellScreen(c)
    if (p && target) fx?.bolt(p, { x: p.x + (Math.random() - 0.5) * 60, y: p.y - 260 }, '#a5f3fc', 0.5, 3)
  }
}

async function runBonus(result: AetherGatesResult) {
  const bonus = result.bonus
  if (!bonus) return
  const tier = result.bonusTier ?? 'normal'
  bonusTier.value = tier
  const initial = tier === 'super' ? AG_FREE_SPINS_SUPER : AG_FREE_SPINS

  sound.play('bonus-trigger')
  ticker.value = tier === 'super' ? 'Super Bonus triggered' : 'Free spins triggered'
  await celebrateGates(result.scatterCells.length ? result.scatterCells : scatterCellsOf(result.grid))
  await wait(1400)

  await waitOverlay({ kind: 'intro', tier, spins: initial, meter: result.base.meterAfter, bought: !!result.feature && result.feature !== 'bonusChance' }, 12000)
  sound.play('bonus-start')
  sound.startPad()
  inBonus.value = true
  fsTotal.value = initial
  const baseWin = result.basePayout
  bonusBase.value = baseWin
  winLabel.value = 'Bonus win'
  winShown.value = baseWin
  await wait(900)

  let acc = baseWin
  for (const fs of bonus.spins) {
    if (destroyed) return
    fsRound.value = fs.round
    sound.play('free-spin', { intensity: fs.round })
    ticker.value = `Free spin ${fs.round} of ${fsTotal.value}`
    await playSequence(fs.sequence, result.bet, acc)
    acc += fs.spinWinMult * result.bet
    if (fs.retriggered) {
      await celebrateGates(scatterCellsOf(fs.sequence.steps[0]?.grid ?? fs.sequence.restGrid))
      sound.play('retrigger')
      fsTotal.value += AG_RETRIGGER_SPINS
      await waitOverlay({ kind: 'retrigger' }, 1900)
    }
    await beat(fs.spinWinMult > 0 ? 450 : 250)
  }

  sound.stopPad()
  countWin(result.payout, 500)
  if (agWinTier(result.totalWinMult) >= 0) await showBigWin(result.payout, result.bet)
  sound.play('bonus-end')
  await waitOverlay({ kind: 'outro', total: result.payout, spins: bonus.totalSpins, meter: bonus.finalMeter }, 7000)
  inBonus.value = false
  fsRound.value = 0
}

// --- spin ---------------------------------------------------------------------------------
async function spin(forced?: AetherFeature) {
  if (!ready.value || isSpinning.value || overlayBusy.value) return
  const feature: AetherFeature | undefined = forced ?? (bonusChance.value ? 'bonusChance' : undefined)
  const cost = costFor(feature)
  if (balance.value < cost) {
    stopAuto()
    return
  }
  sound.unlock()
  const before = balance.value
  let debited = false
  hurry.value = false

  const data = await requestSpin(cost, feature ? { feature } : undefined, () => {
    if (!forced) sound.play('spin')
    winRun++
    winShown.value = 0
    winLabel.value = 'Win'
    meter.value = 0
    ticker.value = forced ? 'Opening the gates…' : 'Good luck!'
    setBalance(before - cost)
    debited = true
  })

  if (!data) {
    if (debited) setBalance(before)
    stopAuto()
    return
  }

  const result = data.gameData
  try {
    await playSequence(result.base, result.bet, 0)
    if (result.bonusTriggered) {
      if (autoLeft.value > 0 && autoSettings.stopOnFeature) stopAuto()
      await runBonus(result)
    } else {
      const mult = result.totalWinMult
      if (agWinTier(mult) >= 0) {
        countWin(result.payout, 300)
        await showBigWin(result.payout, result.bet)
      } else if (result.payout > 0) {
        sound.play(mult >= 5 ? 'win-medium' : 'win-small')
      }
    }
    winRun++
    winShown.value = result.payout
    winLabel.value = result.bonusTriggered ? 'Total win' : 'Win'
    meter.value = result.bonus?.finalMeter ?? result.base.meterAfter
    ticker.value = result.payout > 0 ? `You won ${formatNumber(result.payout)}` : TIPS[++tipIndex % TIPS.length]!
    pushHistory({ payout: result.payout, cost: result.cost, bonus: result.bonusTriggered })
    setBalance(data.balance)
    if (autoLeft.value > 0 && autoSettings.stopOnWin > 0 && result.totalWinMult >= autoSettings.stopOnWin) stopAuto()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    setBalance(data.balance)
    stopAuto()
    inBonus.value = false
    sound.stopPad()
  } finally {
    isSpinning.value = false
    hurry.value = false
    if (autoLeft.value > 0 && !destroyed) {
      autoLeft.value--
      if (autoLeft.value > 0 && balance.value >= spinCost.value) {
        await wait(turbo.value ? 150 : 350)
        if (autoLeft.value > 0 && !destroyed) void spin()
      } else {
        stopAuto()
      }
    }
  }
}

function onSpinButton() {
  sound.unlock()
  if (autoLeft.value > 0) {
    stopAuto()
    sound.play('click')
    return
  }
  if (isSpinning.value) {
    hurry.value = true
    return
  }
  void spin()
}

function toggleTurbo() {
  turbo.value = !turbo.value
  sound.play('toggle')
}

function toggleSound() {
  soundEnabled.value = !soundEnabled.value
}

function onKeydown(e: KeyboardEvent) {
  if (e.code !== 'Space') return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (showPaytable.value || showAuto.value || buyConfirm.value) return
  e.preventDefault()
  if (e.repeat) return
  if (bigWin.value) {
    bigWinSkip.value++
    return
  }
  if (overlay.value && overlay.value.kind !== 'apply') {
    dismissOverlay()
    return
  }
  onSpinButton()
}

function onResize() {
  fx?.resize()
  fitResolution()
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
  idleTicker()
  tipTimer = setInterval(() => {
    if (!isSpinning.value && !overlayBusy.value && ticker.value === TIPS[tipIndex % TIPS.length]) {
      tipIndex++
      idleTicker()
    }
  }, 6000)
  if (fxCanvas.value) fx = new AgFx(fxCanvas.value)

  try {
    const [pixi, reels, gsapMod] = await Promise.all([import('pixi.js'), import('pixi-reels'), import('gsap')])
    if (destroyed) return
    PIXI = pixi
    REELS = reels
    GSAP = gsapMod.gsap ?? gsapMod.default

    // Wait briefly for the display font so orb values and the gate ribbon use it.
    try {
      await Promise.race([document.fonts.load(`900 40px Cinzel`), wait(1500)])
    } catch { /* Georgia fallback */ }
    if (destroyed) return

    app = await initSlotPixiApp(PIXI.Application, { width: APP_W, height: APP_H }, () => destroyed)
    if (!app) return
    canvasWrap.value?.appendChild(app.canvas)
    fitResolution()
    buildTextures(app.renderer.resolution)

    const AgTile = makeTileClass()
    // Filler symbols shown while nothing is decided yet: pay symbols only, so no
    // valueless orbs or stray gates appear on the idle board.
    const weights: Record<string, number> = {}
    for (const s of AETHER_PAY_SYMBOLS) weights[s] = AETHER_SYMBOL_WEIGHTS[s]

    boardLayer = drawBoard()
    app.stage.addChild(boardLayer)

    reelSet = new REELS.ReelSetBuilder()
      .reels(AG_COLS)
      .visibleRows(AG_ROWS)
      .symbolSize(CELL, CELL)
      .symbolGap(GAP, GAP)
      .symbols((registry: any) => {
        for (const id of [...AETHER_PAY_SYMBOLS, 'scatter', 'multiplier']) registry.register(id, AgTile, {})
      })
      .weights(weights)
      .tumble({
        fall: { duration: 240, ease: 'power2.in', rowStagger: 18 },
        dropIn: { duration: 420, ease: 'back.out(1.1)', rowStagger: 40, distance: 'perHole' }
      })
      .speed('normal', REELS.SpeedPresets.NORMAL)
      .speed('turbo', REELS.SpeedPresets.TURBO)
      .ticker(app.ticker)
      .build()
    reelSet.x = PAD
    reelSet.y = PAD
    app.stage.addChild(reelSet)
    reelSet.events.on('cascade:place:end', applyPendingMults)
    reelSet.events.on('cascade:dropIn:end', (info: { reelIndex: number }) => onReelLanded(info.reelIndex))
    reelSet.events.on('spin:reelLanded', (col: number) => onReelLanded(col))

    anticLayer = new PIXI.Container()
    anticLayer.visible = false
    particleLayer = new PIXI.Container()
    floatLayer = new PIXI.Container()
    for (const layer of [anticLayer, particleLayer, floatLayer]) {
      layer.eventMode = 'none'
      app.stage.addChild(layer)
    }
    app.ticker.add(tick)

    reelSet.setResult(toTargets(randomGrid()))
    ready.value = true

    resizeObserver = new ResizeObserver(() => fitResolution())
    if (canvasWrap.value) resizeObserver.observe(canvasWrap.value)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load the reels'
  }
})

onBeforeUnmount(() => {
  destroyed = true
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  if (tipTimer) clearInterval(tipTimer)
  resizeObserver?.disconnect()
  overlayResolve?.()
  bigWinResolve?.()
  sound.stopAll()
  fx?.destroy()
  fx = null
  portals.clear()
  orbGlows.clear()
  shards.length = 0
  safeDestroy(() => app?.ticker?.remove?.(tick))
  for (const t of looseTweens) safeDestroy(() => t.kill())
  looseTweens.clear()
  safeDestroy(() => reelSet?.destroy?.())
  safeDestroy(() => app?.destroy?.(true, { children: true, texture: true }))
  for (const tex of Object.values(TEX)) safeDestroy(() => tex?.destroy?.(true))
})

const gateIcon = agSymbolDataUrl('scatter', 128)
const crownIcon = agSymbolDataUrl('star', 128)
const canSpin = computed(() => ready.value && !overlayBusy.value && (isSpinning.value || autoLeft.value > 0 || balance.value >= spinCost.value))
</script>

<template>
  <div
    class="ag-root"
    :class="{ 'is-bonus': inBonus, 'is-turbo': turbo }"
  >
    <AgBackdrop :bonus="inBonus" />
    <canvas
      ref="fxCanvas"
      class="ag-fx"
      aria-hidden="true"
    />

    <div class="ag-shell">
      <header class="ag-marquee">
        <div class="ag-marquee-logo">
          <AgLogo :bonus="inBonus" />
        </div>
        <p class="ag-marquee-caption">An opening to the extraordinary</p>
      </header>

      <div class="ag-stage">
        <!-- feature buys -->
        <aside class="ag-buys">
          <p class="ag-section-label">Enter the gates</p>
          <button
            class="ag-buy"
            :disabled="locked || !ready || balance < buyFreeCost"
            @click="askBuy('buyFreeSpins')"
          >
            <img
              :src="gateIcon"
              alt=""
              class="ag-buy-icon"
            >
            <span class="ag-buy-title">Buy free spins</span>
            <span class="ag-buy-sub">{{ AG_FREE_SPINS }} spins</span>
            <strong class="ag-buy-cost">{{ formatNumber(buyFreeCost, true, 0) }}</strong>
          </button>
          <button
            class="ag-buy is-super"
            :disabled="locked || !ready || balance < buySuperCost"
            @click="askBuy('superBonus')"
          >
            <img
              :src="crownIcon"
              alt=""
              class="ag-buy-icon"
            >
            <span class="ag-buy-title">Super bonus</span>
            <span class="ag-buy-sub">{{ AG_FREE_SPINS_SUPER }} spins</span>
            <strong class="ag-buy-cost">{{ formatNumber(buySuperCost, true, 0) }}</strong>
          </button>
          <button
            class="ag-buy is-chance"
            :class="{ 'is-on': bonusChance }"
            :disabled="locked"
            :aria-pressed="bonusChance"
            @click="toggleChance"
          >
            <span class="ag-buy-title">Bonus chance</span>
            <span class="ag-switch"><span /></span>
            <span class="ag-buy-sub">2× gate odds</span>
            <strong class="ag-buy-cost is-small">Spin {{ formatNumber(chanceCost, true, 0) }}</strong>
          </button>
        </aside>

        <!-- reels -->
        <section class="ag-cabinet" aria-label="Aether Gates reels">
          <div class="ag-board-heading">
            <span>{{ inBonus ? 'The gates are open' : 'Realm of aether' }}</span>
            <span>{{ AG_MIN_MATCH }}+ matching symbols to win</span>
          </div>
          <div class="ag-frame">
            <div
              class="ag-window"
              @click="overlay && overlay.kind !== 'apply' ? dismissOverlay() : undefined"
            >
              <div
                ref="canvasWrap"
                class="ag-canvas"
              />
              <div class="ag-window-sheen" />

              <div
                v-if="!ready && !errorMsg"
                class="ag-loading"
              >
                <UIcon
                  name="i-lucide-loader-circle"
                  class="size-10 animate-spin"
                />
              </div>

              <Transition name="ag-pop">
                <div
                  v-if="overlay?.kind === 'apply'"
                  class="ag-apply"
                >
                  <span>{{ formatNumber(overlay.base) }}</span>
                  <b>× {{ formatNumber(overlay.meter, false, 0) }}</b>
                </div>
              </Transition>

              <Transition name="ag-pop">
                <div
                  v-if="overlay?.kind === 'retrigger'"
                  class="ag-banner is-retrigger"
                >
                  <p class="ag-banner-big">
                    +{{ AG_RETRIGGER_SPINS }}
                  </p>
                  <p class="ag-banner-title">
                    Free spins
                  </p>
                  <p class="ag-banner-sub">
                    The gates opened again. This can only happen once.
                  </p>
                </div>
              </Transition>
            </div>
          </div>

          <div
            class="ag-ticker"
            aria-live="polite"
          >
            <span>{{ ticker }}</span>
          </div>
        </section>

        <!-- meter & status -->
        <aside class="ag-status">
          <AgMeter
            ref="meterComp"
            :value="meter"
            :hit="meterHit"
            :bonus="inBonus"
            :applying="meterApplying"
          />
          <Transition name="ag-pop">
            <div
              v-if="inBonus"
              class="ag-fs-plaque"
            >
              <span class="ag-fs-label">{{ bonusTier === 'super' ? 'Super bonus' : 'Free spins' }}</span>
              <strong class="ag-fs-count">{{ fsRound }}<small>/{{ fsTotal }}</small></strong>
              <span class="ag-fs-label">Feature win</span>
              <strong class="ag-fs-win">{{ formatNumber(bonusWin) }}</strong>
            </div>
          </Transition>
          <div
            v-if="!inBonus"
            class="ag-history"
          >
            <p class="ag-history-title">
              Last rounds
            </p>
            <ul v-if="history.length">
              <li
                v-for="(h, i) in history.slice(0, 6)"
                :key="i"
                :class="{ 'is-win': h.payout > 0, 'is-bonus': h.bonus }"
              >
                <span>{{ h.bonus ? 'Free spins' : 'Spin' }}</span>
                <b>{{ h.payout > 0 ? formatNumber(h.payout, true, 0) : '–' }}</b>
              </li>
            </ul>
            <p
              v-else
              class="ag-history-empty"
            >
              Your journey begins with a spin.
            </p>
          </div>
        </aside>
      </div>

      <!-- control deck -->
      <div class="ag-deck">
        <div class="ag-deck-tools">
          <button
            class="ag-tool"
            aria-label="Paytable and rules"
            @click="showPaytable = true; sound.play('click')"
          >
            <UIcon
              name="i-lucide-info"
              class="size-5"
            />
          </button>
          <div class="ag-tool-wrap">
            <button
              class="ag-tool"
              :aria-label="soundEnabled ? 'Sound settings' : 'Sound off'"
              @click="showVolume = !showVolume"
            >
              <UIcon
                :name="!soundEnabled || soundVolume === 0 ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
                class="size-5"
              />
            </button>
            <div
              v-if="showVolume"
              class="ag-volume"
              @mouseleave="showVolume = false"
            >
              <button
                class="ag-volume-mute"
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
          <button
            class="ag-tool"
            :class="{ 'is-on': turbo }"
            aria-label="Turbo"
            :aria-pressed="turbo"
            @click="toggleTurbo"
          >
            <UIcon
              name="i-lucide-zap"
              class="size-5"
            />
          </button>
        </div>

        <div class="ag-lcd is-balance">
          <span class="ag-lcd-label">Balance</span>
          <strong class="ag-lcd-value">{{ formatNumber(balance) }}</strong>
        </div>

        <div class="ag-bet">
          <button
            class="ag-round-btn"
            aria-label="Lower bet"
            :disabled="locked || bet <= MIN_BET"
            @click="betDown"
          >
            <UIcon
              name="i-lucide-minus"
              class="size-5"
            />
          </button>
          <label class="ag-lcd is-bet">
            <span class="ag-lcd-label">Bet</span>
            <input
              v-model="betText"
              class="ag-lcd-input"
              inputmode="decimal"
              aria-label="Bet amount"
              :disabled="locked"
              @blur="commitBet"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            >
            <output
              v-if="amountPreview(betText, true)"
              class="ag-lcd-hint"
            >{{ amountPreview(betText, true) }}</output>
          </label>
          <button
            class="ag-round-btn"
            aria-label="Raise bet"
            :disabled="locked || bet >= MAX_BET"
            @click="betUp"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-5"
            />
          </button>
          <button
            class="ag-max"
            :disabled="locked"
            @click="betMax"
          >
            Max
          </button>
        </div>

        <div
          ref="winEl"
          class="ag-lcd is-win"
          :class="{ 'is-lit': winShown > 0 }"
        >
          <span class="ag-lcd-label">{{ winLabel }}</span>
          <strong class="ag-lcd-value">{{ formatNumber(winShown) }}</strong>
        </div>

        <div class="ag-deck-play">
          <button
            class="ag-auto"
            :class="{ 'is-on': autoLeft > 0 }"
            :disabled="!ready || (autoLeft === 0 && (isSpinning || overlayBusy || balance < spinCost))"
            @click="autoLeft > 0 ? stopAuto() : (showAuto = true)"
          >
            <UIcon
              :name="autoLeft > 0 ? 'i-lucide-square' : 'i-lucide-repeat'"
              class="size-4"
            />
            <span>{{ autoLeft > 0 ? autoLeft : 'Auto' }}</span>
          </button>
          <button
            class="ag-spin"
            :class="{ 'is-spinning': isSpinning, 'is-auto': autoLeft > 0 }"
            :disabled="!canSpin"
            :aria-label="autoLeft > 0 ? 'Stop autoplay' : 'Spin'"
            @click="onSpinButton"
          >
            <svg
              v-if="autoLeft === 0"
              class="ag-spin-arrows"
              viewBox="0 0 48 48"
              aria-hidden="true"
            >
              <path
                d="M24 8a16 16 0 0 1 15.2 11"
                fill="none"
                stroke="currentColor"
                stroke-width="4.5"
                stroke-linecap="round"
              />
              <path
                d="M41 12l-1.5 8.6-8.3-2.8"
                fill="none"
                stroke="currentColor"
                stroke-width="4.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M24 40A16 16 0 0 1 8.8 29"
                fill="none"
                stroke="currentColor"
                stroke-width="4.5"
                stroke-linecap="round"
              />
              <path
                d="M7 36l1.5-8.6 8.3 2.8"
                fill="none"
                stroke="currentColor"
                stroke-width="4.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span
              v-else
              class="ag-spin-stop"
            >Stop</span>
          </button>
        </div>
      </div>
    </div>

    <!-- full-screen moments -->
    <Transition name="ag-fade">
      <div
        v-if="overlay?.kind === 'intro'"
        class="ag-moment"
        @click="dismissOverlay"
      >
        <div class="ag-moment-card">
          <img
            :src="gateIcon"
            alt=""
            class="ag-moment-gate"
          >
          <p class="ag-moment-kicker">
            {{ overlay.tier === 'super' ? 'Super bonus' : 'The gates are open' }}
          </p>
          <p class="ag-moment-big">
            {{ overlay.spins }}
          </p>
          <p class="ag-moment-title">
            Free spins
          </p>
          <p class="ag-moment-text">
            The multiplier meter never resets during the feature. Every orb you collect keeps counting until the last spin.
          </p>
          <p
            v-if="overlay.meter > 1"
            class="ag-moment-text is-gold"
          >
            Starting meter ×{{ formatNumber(overlay.meter, false, 0) }}
          </p>
          <button class="ag-moment-btn">
            Start
          </button>
        </div>
      </div>
    </Transition>

    <Transition name="ag-fade">
      <div
        v-if="overlay?.kind === 'outro'"
        class="ag-moment"
        @click="dismissOverlay"
      >
        <div class="ag-moment-card">
          <p class="ag-moment-kicker">
            Feature complete
          </p>
          <p class="ag-moment-title">
            Total win
          </p>
          <p class="ag-moment-big is-amount">
            {{ formatNumber(overlay.total) }}
          </p>
          <p class="ag-moment-text">
            {{ overlay.spins }} free spins · final meter ×{{ formatNumber(Math.max(1, overlay.meter), false, 0) }}
          </p>
          <button class="ag-moment-btn">
            Collect
          </button>
        </div>
      </div>
    </Transition>

    <AgBigWin
      v-if="bigWin"
      :amount="bigWin.amount"
      :bet="bigWin.bet"
      :turbo="turbo"
      :skip="bigWinSkip"
      @tier="onBigWinTier"
      @tick="(p: number) => sound.play('tick', { intensity: p })"
      @done="closeBigWin"
    />

    <Transition name="ag-fade">
      <div
        v-if="buyConfirm"
        class="ag-moment"
        @click.self="buyConfirm = null"
      >
        <div class="ag-moment-card is-confirm">
          <img
            :src="buyConfirm === 'superBonus' ? crownIcon : gateIcon"
            alt=""
            class="ag-moment-gate is-small"
          >
          <p class="ag-moment-title">
            {{ buyConfirm === 'superBonus' ? 'Buy the Super Bonus?' : 'Buy free spins?' }}
          </p>
          <p class="ag-moment-text">
            {{ buyConfirm === 'superBonus' ? AG_FREE_SPINS_SUPER : AG_FREE_SPINS }} free spins start straight away
            ({{ buyConfirm === 'superBonus' ? AG_SCATTER_TRIGGER_SUPER : AG_SCATTER_TRIGGER }} gates guaranteed).
          </p>
          <p class="ag-moment-big is-amount is-cost">
            {{ formatNumber(costFor(buyConfirm)) }}
          </p>
          <div class="ag-moment-actions">
            <button
              class="ag-moment-btn is-ghost"
              @click="buyConfirm = null"
            >
              Cancel
            </button>
            <button
              class="ag-moment-btn"
              @click="confirmBuy"
            >
              Buy
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <AgPaytable
      v-if="showPaytable"
      :bet="bet"
      @close="showPaytable = false"
    />
    <AgAutoSpinModal
      v-if="showAuto"
      @close="showAuto = false"
      @start="startAuto"
    />
  </div>
</template>

<style scoped>
.ag-root {
  --ag-night: color-mix(in srgb, var(--ui-color-neutral-950) 92%, var(--ui-info));
  --ag-panel: color-mix(in srgb, var(--ag-night) 92%, var(--ui-info));
  --ag-text: var(--ui-color-neutral-100);
  --ag-muted: var(--ui-color-neutral-400);
  --ag-gold: color-mix(in srgb, var(--ui-warning) 35%, var(--ag-text));
  --ag-accent: color-mix(in srgb, var(--ui-info) 65%, var(--ag-text));
  --ag-line: color-mix(in srgb, var(--ag-accent) 16%, transparent);
  --gold-1: var(--ag-gold);
  --gold-2: var(--ag-gold);
  --gold-3: var(--ui-warning);
  --gold-4: var(--ag-night);
  --ink: var(--ag-night);
  position: relative;
  min-height: 100%;
  overflow: hidden;
  color: var(--ag-text);
  color-scheme: dark;
  isolation: isolate;
}

.ag-fx {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  z-index: 70;
  pointer-events: none;
}

.ag-shell {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  max-width: 1320px;
  margin: 0 auto;
  padding: 30px 28px 36px;
}

.ag-root button:focus-visible,
.ag-root input:focus-visible {
  outline: 2px solid var(--ag-accent);
  outline-offset: 4px;
}

.ag-marquee-caption {
  color: var(--ag-muted);
  font-size: 10px;
  letter-spacing: 0.19em;
  text-transform: uppercase;
}

.ag-section-label,
.ag-board-heading {
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--ag-muted);
}

.ag-section-label { margin-bottom: 5px; }
.ag-board-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 4px 12px;
}
.ag-board-heading span:first-child { color: var(--ag-gold); }

/* marquee ------------------------------------------------------------------- */
.ag-marquee {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
}

.ag-marquee-logo {
  width: min(310px, 78vw);
}

/* stage ----------------------------------------------------------------------- */
.ag-stage {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr) 190px;
  grid-template-areas: 'buys cabinet status';
  gap: 24px;
  align-items: start;
}

.ag-buys {
  grid-area: buys;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 5px;
}

.ag-cabinet {
  grid-area: cabinet;
  min-width: 0;
}

.ag-status {
  grid-area: status;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 24px;
  padding-top: 34px;
}

/* feature buttons ----------------------------------------------------------- */
.ag-buy {
  position: relative;
  display: grid;
  grid-template-columns: 44px 1fr;
  grid-template-rows: auto auto auto;
  column-gap: 10px;
  row-gap: 4px;
  align-items: center;
  padding: 18px 12px;
  border-radius: 12px;
  border: 1px solid var(--ag-line);
  background: linear-gradient(130deg, color-mix(in srgb, var(--ag-accent) 9%, var(--ag-night)), var(--ag-panel));
  text-align: left;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.ag-buy.is-super {
  border-color: color-mix(in srgb, var(--ag-gold) 24%, transparent);
  background: linear-gradient(130deg, color-mix(in srgb, var(--ag-gold) 9%, var(--ag-night)), var(--ag-panel));
}

.ag-buy.is-chance {
  grid-template-columns: 1fr auto;
  margin-top: 4px;
  background: color-mix(in srgb, var(--ag-panel) 80%, transparent);
}

.ag-buy:not(:disabled):hover {
  transform: translateY(-2px);
  border-color: var(--ag-gold);
}

.ag-buy:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ag-buy-icon {
  grid-row: 1 / span 3;
  width: 44px;
  height: 52px;
  object-fit: contain;
}

.ag-buy-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--ag-text);
}

.ag-buy-sub {
  font-size: 11px;
  color: var(--ag-muted);
}

.ag-buy-cost {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  color: var(--ag-gold);
}

.ag-buy.is-chance .ag-buy-sub,
.ag-buy.is-chance .ag-buy-cost {
  grid-column: 1 / span 2;
}

.ag-buy-cost.is-small {
  font-size: 12px;
  font-weight: 500;
  color: var(--ag-muted);
}

.ag-switch {
  position: relative;
  width: 32px;
  height: 20px;
  border-radius: 999px;
  background: var(--ag-line);
  transition: background 160ms ease;
}

.ag-switch span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--ag-text);
  transition: transform 160ms ease;
}

.ag-buy.is-on .ag-switch {
  background: var(--ui-info);
}

.ag-buy.is-on .ag-switch span {
  transform: translateX(12px);
}

.ag-buy.is-on {
  border-color: var(--ag-accent);
}

/* reel frame ------------------------------------------------------------------ */
.ag-frame {
  position: relative;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--ag-gold) 35%, transparent);
  border-radius: 18px;
  background: color-mix(in srgb, var(--ag-panel) 85%, transparent);
  box-shadow: 0 20px 70px color-mix(in srgb, var(--ag-night) 70%, transparent), inset 0 0 0 3px var(--ag-night);
  transition: border-color 600ms ease, box-shadow 600ms ease;
}

.is-bonus .ag-frame {
  border-color: var(--ag-accent);
  box-shadow: 0 0 45px color-mix(in srgb, var(--ag-accent) 18%, transparent);
}






.ag-window {
  position: relative;
  overflow: hidden;
  border-radius: 11px;
  background: linear-gradient(160deg, var(--ag-panel), var(--ag-night));
}

.is-bonus .ag-window {
  background: linear-gradient(160deg, color-mix(in srgb, var(--ui-secondary) 16%, var(--ag-night)), var(--ag-night));
}

.ag-canvas {
  position: relative;
  z-index: 1;
  width: 100%;
  aspect-ratio: 658 / 552;
}

.ag-canvas :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.ag-window-sheen {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  border: 1px solid var(--ag-line);
  border-radius: inherit;
}

.ag-loading {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  color: #fde68a;
}

.ag-apply {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(8, 5, 30, 0.7), transparent 70%);
  font-family: 'Cinzel', Georgia, serif;
  font-weight: 900;
}

.ag-apply span {
  font-size: clamp(28px, 5vw, 46px);
  color: #fff7d6;
  -webkit-text-stroke: 2px #1a0f02;
  paint-order: stroke fill;
  text-shadow: 0 4px 0 rgba(0, 0, 0, 0.5);
}

.ag-apply b {
  font-size: clamp(40px, 8vw, 76px);
  line-height: 1;
  color: #fde68a;
  -webkit-text-stroke: 2px #1a0f02;
  paint-order: stroke fill;
  text-shadow: 0 5px 0 rgba(0, 0, 0, 0.5), 0 0 30px rgba(252, 211, 77, 0.8);
  animation: ag-apply-slam 500ms cubic-bezier(0.2, 1.7, 0.4, 1) both;
}

.ag-banner {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: radial-gradient(ellipse at center, rgba(12, 6, 40, 0.88), rgba(12, 6, 40, 0.5) 70%);
}

.ag-banner-big {
  font-family: 'Cinzel', Georgia, serif;
  font-size: clamp(64px, 12vw, 120px);
  font-weight: 900;
  line-height: 1;
  background: linear-gradient(180deg, #fff, #fde68a 40%, #d97706);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 5px 0 rgba(0, 0, 0, 0.6)) drop-shadow(0 0 28px rgba(252, 211, 77, 0.7));
}

.ag-banner-title {
  font-family: 'Cinzel', Georgia, serif;
  font-size: clamp(22px, 4vw, 36px);
  font-weight: 900;
  color: #fde68a;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.ag-banner-sub {
  margin-top: 6px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(224, 231, 255, 0.75);
}

.ag-ticker {
  margin: 12px auto 0;
  min-height: 24px;
  padding: 4px 8px;
  text-align: center;
  font-size: 11px;
  font-weight: 500;
  color: var(--ag-muted);
}

/* status column ------------------------------------------------------------- */
.ag-fs-plaque {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  border-radius: 16px;
  border: 2px solid #c084fc;
  background: linear-gradient(180deg, #3b1573, #170733);
  box-shadow: 0 0 30px rgba(168, 85, 247, 0.5), 0 10px 24px rgba(0, 0, 0, 0.5);
}

.ag-fs-label {
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(233, 213, 255, 0.8);
}

.ag-fs-count {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 40px;
  font-weight: 900;
  line-height: 1.1;
  color: #fff;
  text-shadow: 0 0 18px rgba(216, 180, 254, 0.9);
}

.ag-fs-count small {
  font-size: 20px;
  color: rgba(233, 213, 255, 0.7);
}

.ag-fs-win {
  font-size: 20px;
  font-weight: 900;
  color: #fde68a;
}

.ag-history {
  padding: 18px 0;
  border-top: 1px solid var(--ag-line);
}

.ag-history-title {
  margin-bottom: 12px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ag-muted);
}

.ag-history ul {
  display: grid;
  gap: 4px;
}

.ag-history li {
  display: flex;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
  font-weight: 700;
  color: rgba(224, 231, 255, 0.55);
}

.ag-history li.is-win {
  color: #fef3c7;
}

.ag-history li.is-bonus span {
  color: #d8b4fe;
}

.ag-history-empty {
  font-size: 12px;
  line-height: 1.7;
  color: var(--ag-muted);
}

/* control deck ---------------------------------------------------------------- */
.ag-deck {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
  grid-template-areas:
    'balance bet win play'
    'tools tools tools tools';
  width: calc(100% - 428px);
  margin-inline: auto;
  align-items: center;
  gap: 10px 12px;
  padding: 14px 16px 10px;
  border-radius: 16px;
  border: 1px solid var(--ag-line);
  background: color-mix(in srgb, var(--ag-panel) 90%, transparent);
  box-shadow: 0 16px 40px color-mix(in srgb, var(--ag-night) 40%, transparent);
}

.ag-deck-tools {
  grid-area: tools;
  display: flex;
  justify-content: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--ag-line);
}

.ag-tool-wrap {
  position: relative;
}

.ag-tool {
  display: grid;
  place-items: center;
  width: 32px;
  height: 28px;
  border-radius: 10px;
  border: 1px solid var(--ag-line);
  background: transparent;
  color: var(--ag-muted);
  transition: color 120ms ease, background 120ms ease;
}

.ag-tool:hover {
  transform: translateY(-1px);
}

.ag-tool.is-on {
  background: color-mix(in srgb, var(--ag-accent) 12%, transparent);
  color: var(--ag-accent);
}

.ag-volume {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1.5px solid #c9942d;
  background: #150e3c;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
}

.ag-volume input {
  width: 120px;
  accent-color: #f59e0b;
}

.ag-volume-mute {
  font-size: 12px;
  font-weight: 800;
  color: #fde68a;
}

.ag-lcd {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 6px 12px;
}

.ag-lcd.is-balance {
  grid-area: balance;
}

.ag-lcd.is-win {
  grid-area: win;
  transition: box-shadow 300ms ease;
}

.ag-lcd.is-win.is-lit {
  color: var(--ag-gold);
}

.ag-lcd-label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ag-muted);
}

.ag-lcd-value {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 23px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  color: var(--ag-text);
}

.ag-lcd.is-win .ag-lcd-value {
  color: var(--ag-gold);
}

.ag-bet {
  grid-area: bet;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ag-lcd.is-bet {
  position: relative;
  width: 104px;
  border: 1px solid var(--ag-line);
  background: var(--ag-night);
  border-radius: 10px;
}

.ag-lcd-input {
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  text-align: center;
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  color: var(--ag-text);
}

.ag-lcd-input:disabled {
  opacity: 0.7;
}

.ag-lcd-hint {
  position: absolute;
  bottom: -16px;
  font-size: 10px;
  font-weight: 700;
  color: rgba(224, 231, 255, 0.6);
}

.ag-round-btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 40px;
  border-radius: 8px;
  border: 1px solid var(--ag-line);
  background: transparent;
  color: var(--ag-text);
  transition: background 100ms ease;
}

.ag-round-btn:active:not(:disabled) {
  background: var(--ag-line);
}

.ag-round-btn:disabled,
.ag-max:disabled,
.ag-auto:disabled {
  filter: grayscale(0.7) brightness(0.6);
  cursor: not-allowed;
}

.ag-max {
  height: 32px;
  padding: 0 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ag-muted);
}

.ag-deck-play {
  grid-area: play;
  display: flex;
  align-items: center;
  gap: 12px;
}

.ag-auto {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 44px;
  height: 48px;
  border-radius: 10px;
  border: 1px solid var(--ag-line);
  color: var(--ag-muted);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ag-auto.is-on {
  background: color-mix(in srgb, var(--ui-error) 18%, var(--ag-night));
  color: var(--ag-text);
}

.ag-spin {
  position: relative;
  display: grid;
  place-items: center;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border: 1px solid var(--ag-gold);
  background: var(--ag-gold);
  color: var(--ag-night);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--ag-gold) 8%, transparent);
  transition: transform 110ms ease, filter 160ms ease;
}

.ag-spin:not(:disabled):hover {
  filter: brightness(1.08);
}

.ag-spin:not(:disabled):active {
  transform: translateY(4px);
}

.ag-spin:disabled {
  filter: grayscale(0.5) brightness(0.65);
  cursor: not-allowed;
}

.ag-spin-arrows {
  width: 36px;
  height: 36px;
}

.ag-spin.is-spinning .ag-spin-arrows {
  animation: ag-spin-rot 0.6s linear infinite;
}

.ag-spin.is-auto {
  background: var(--ui-error);
  border-color: var(--ui-error);
  color: var(--ag-text);
}

.ag-spin-stop {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 20px;
  font-weight: 900;
  text-transform: uppercase;
}

/* full-screen moments --------------------------------------------------------- */
.ag-moment {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 16px;
  background: radial-gradient(ellipse at center, rgba(40, 16, 90, 0.7), rgba(3, 2, 12, 0.92) 70%);
  cursor: pointer;
}

.ag-moment-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 440px;
  text-align: center;
  animation: ag-card-in 600ms cubic-bezier(0.2, 1.5, 0.4, 1) both;
}

.ag-moment-card.is-confirm {
  padding: 24px 22px;
  border-radius: 22px;
  border: 2px solid #c9942d;
  background: linear-gradient(180deg, #221655, #0c0827);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7), 0 0 0 4px rgba(59, 29, 0, 0.8);
  cursor: default;
}

.ag-moment-gate {
  width: 150px;
  height: 150px;
  filter: drop-shadow(0 0 30px rgba(103, 232, 249, 0.7));
  animation: ag-gate-float 3s ease-in-out infinite alternate;
}

.ag-moment-gate.is-small {
  width: 90px;
  height: 90px;
}

.ag-moment-kicker {
  margin-top: 6px;
  font-family: 'Cinzel', Georgia, serif;
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #a5f3fc;
}

.ag-moment-big {
  font-family: 'Cinzel', Georgia, serif;
  font-size: clamp(88px, 16vw, 150px);
  font-weight: 900;
  line-height: 0.95;
  background: linear-gradient(180deg, #fff, #fde68a 35%, #f59e0b 70%, #7c2d12);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 6px 0 rgba(0, 0, 0, 0.6)) drop-shadow(0 0 34px rgba(252, 211, 77, 0.6));
}

.ag-moment-big.is-amount {
  margin: 6px 0;
  font-family: 'Cinzel', Georgia, serif;
  font-size: clamp(44px, 8vw, 76px);
}

.ag-moment-big.is-cost {
  font-size: clamp(34px, 6vw, 48px);
}

.ag-moment-title {
  font-family: 'Cinzel', Georgia, serif;
  font-size: clamp(26px, 4.5vw, 40px);
  font-weight: 900;
  color: #fde68a;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.6);
}

.ag-moment-text {
  margin-top: 10px;
  font-size: 14px;
  line-height: 1.5;
  color: rgba(224, 231, 255, 0.8);
}

.ag-moment-text.is-gold {
  font-weight: 900;
  color: #fde68a;
}

.ag-moment-actions {
  display: flex;
  gap: 12px;
}

.ag-moment-btn {
  margin-top: 20px;
  min-width: 160px;
  height: 52px;
  padding: 0 24px;
  border-radius: 999px;
  border: 2px solid #3b1d00;
  background: linear-gradient(180deg, #fff1a8, #f5b829 45%, #b45309);
  box-shadow: 0 6px 0 #5a2e02, 0 12px 24px rgba(0, 0, 0, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.6);
  font-family: 'Cinzel', Georgia, serif;
  font-size: 18px;
  font-weight: 900;
  color: #2a1402;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  animation: ag-btn-glow 1.4s ease-in-out infinite alternate;
}

.ag-moment-btn.is-ghost {
  min-width: 120px;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(253, 230, 138, 0.4);
  color: #fde68a;
  box-shadow: none;
  animation: none;
}

/* transitions & keyframes --------------------------------------------------- */
.ag-pop-enter-active,
.ag-pop-leave-active {
  transition: transform 260ms cubic-bezier(0.2, 1.4, 0.4, 1), opacity 200ms ease;
}

.ag-pop-enter-from,
.ag-pop-leave-to {
  opacity: 0;
  transform: scale(0.85);
}

.ag-fade-enter-active,
.ag-fade-leave-active {
  transition: opacity 300ms ease;
}

.ag-fade-enter-from,
.ag-fade-leave-to {
  opacity: 0;
}

@keyframes ag-spin-rot {
  to {
    transform: rotate(360deg);
  }
}

@keyframes ag-apply-slam {
  0% {
    transform: scale(2.4);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes ag-card-in {
  0% {
    transform: scale(0.5);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes ag-gate-float {
  to {
    transform: translateY(-8px) scale(1.04);
  }
}

@keyframes ag-btn-glow {
  to {
    box-shadow: 0 6px 0 #5a2e02, 0 12px 24px rgba(0, 0, 0, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.6), 0 0 30px rgba(252, 211, 77, 0.7);
  }
}

/* responsive ------------------------------------------------------------------- */
@media (max-width: 1023px) {
  .ag-shell {
    gap: 8px;
    padding: 20px 14px 24px;
  }

  .ag-marquee-logo {
    width: min(300px, 70vw);
  }

  .ag-section-label { display: none; }

  /* Flatten the stage so the deck sits right under the reels and the buys go last. */
  .ag-stage {
    display: contents;
  }

  .ag-marquee {
    order: 0;
  }

  .ag-cabinet {
    order: 2;
  }

  .ag-deck {
    order: 3;
    width: 100%;
  }

  .ag-status {
    order: 1;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    padding-top: 0;
  }

  .ag-history {
    display: none;
  }

  .ag-fs-plaque {
    padding: 6px 12px;
  }

  .ag-fs-count {
    font-size: 26px;
  }

  .ag-buys {
    order: 4;
    flex-direction: row;
    padding-top: 0;
  }

  .ag-buy {
    flex: 1;
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
    padding: 10px 6px;
  }

  .ag-buy-icon {
    display: none;
  }

  .ag-buy.is-chance {
    grid-template-columns: 1fr;
  }

  .ag-buy.is-chance .ag-buy-sub,
  .ag-buy.is-chance .ag-buy-cost {
    grid-column: auto;
  }

  .ag-buy-cost {
    font-size: 16px;
  }

  .ag-frame {
    padding: 5px;
    border-radius: 14px;
  }


  .ag-deck {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'balance win'
      'bet play'
      'tools tools';
    gap: 10px;
    padding: 12px;
  }

  .ag-bet {
    justify-content: flex-start;
    gap: 5px;
  }

  .ag-deck-tools { justify-content: center; }
  .ag-deck-play { gap: 10px; }
  .ag-lcd.is-bet { width: 76px; }
  .ag-lcd-hint { bottom: -13px; }

  .ag-deck-play {
    justify-content: flex-end;
  }

  .ag-lcd-value,
  .ag-lcd-input {
    font-size: 18px;
  }

  .ag-spin {
    width: 60px;
    height: 60px;
  }

  .ag-spin-arrows {
    width: 34px;
    height: 34px;
  }
}

@media (max-width: 420px) {
  .ag-board-heading { font-size: 8px; letter-spacing: 0.04em; }
  .ag-max { display: none; }
  .ag-round-btn { width: 28px; }
  .ag-buy-title {
    font-size: 11px;
  }

  .ag-lcd.is-bet {
    width: 64px;
  }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
