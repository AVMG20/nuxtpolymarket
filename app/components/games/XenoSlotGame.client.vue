<script setup lang="ts">
// Xeno Slot: a 5×3, 5-line slot with a Hold & Win collector bonus. The server
// decides every outcome (shared/utils/gamelogic/xenoslot.ts); this component
// only presents it. All artwork is painted procedurally
// (~/utils/slots/xenoslot-art) and every sound is synthesized
// (~/composables/xenoslot-sound), so the game loads no image or audio files.
import type { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { XenoSlotResult, BonusWave, Cell, SlotSymbol, LineWin } from '#shared/utils/gamelogic/xenoslot'
import { XENOSLOT_LINES, XENOSLOT_MAX_WIN_MULT, XENOSLOT_BUY_BONUS_COST, BONUS_FREE_SPINS, BONUS_TRIGGER_COUNT } from '#shared/utils/gamelogic/xenoslot'
import { initSlotPixiApp, safeDestroy } from '~/utils/slot-pixi'
import {
  XENO_COIN_TIER_INDEX,
  XENO_SYMBOLS,
  loadXenoFonts,
  paintXenoArt,
  paintXenoReelBackdrop,
  xenoArtDataUrl,
  xenoCoinTier,
  xenoGlowSprite,
  xenoMotionBlur,
  xenoSparkSprite,
  type XenoCoinTier,
  type XenoCoreMult
} from '~/utils/slots/xenoslot-art'
import { XenoFx } from '~/utils/slots/xenoslot-fx'
import { XENO_LINE_COLORS, XENO_PAYLINES } from '~/utils/slots/xenoslot-lines'
import { makeXenoSymbols, type XenoSymbolClasses, type XenoSymbolTextures } from '~/utils/slots/xenoslot-symbols'
import XenoPaytable from '~/components/games/xenoslot/XenoPaytable.vue'
import XenoBigWin from '~/components/games/xenoslot/XenoBigWin.vue'
import SlotControlBar from '~/components/slots/SlotControlBar.vue'
import type { SlotAutoSettings, SlotBuyOption, SlotSpinMode } from '~/utils/slots/slot-controls'
import { XENO_BAR_THEME } from '~/utils/slots/slot-themes'

// Shown in the header and rules. The volatility rating sits a tier below
// Fire in the Hole, whose max win is twice as high.
const XS_RTP = '98%'
const XS_VOLATILITY = 4

const { bet, isSpinning, errorMsg, balance, setBalance, history, pushHistory, spin: requestSpin } = useSlotGame<XenoSlotResult, { payout: number, bet: number, bonus: boolean }>('xenoslot')
const sound = useXenoSlotSound()
const { soundEnabled, soundVolume, musicVolume } = sound

// --- bet --------------------------------------------------------------------
const MIN_BET = 1
const MAX_BET = 100_000_000_000
// 1, 2, 5, 10, 20, 50 … up to MAX_BET.
const BET_LADDER: number[] = []
for (let e = 0; e <= 11; e++) for (const m of [1, 2, 5]) BET_LADDER.push(m * 10 ** e)

function clampBet(v: number): number {
  if (!Number.isFinite(v) || v < MIN_BET) return MIN_BET
  return Math.min(MAX_BET, Math.floor(v))
}

const betLocked = computed(() => phase.value !== 'idle' || autoplay.active)

function setBet(v: number, sfx?: 'bet-up' | 'bet-down') {
  if (betLocked.value) return
  const next = clampBet(v)
  if (next === bet.value) return
  bet.value = next
  if (sfx) sound.play(sfx)
}

function betUp() {
  setBet(BET_LADDER.find(v => v > bet.value) ?? MAX_BET, 'bet-up')
}

function betDown() {
  setBet([...BET_LADDER].reverse().find(v => v < bet.value) ?? MIN_BET, 'bet-down')
}

function maxBet() {
  const affordable = [...BET_LADDER].reverse().find(v => v <= balance.value) ?? MIN_BET
  setBet(affordable, 'bet-up')
}

function typeBet(v: number) {
  setBet(v, v > bet.value ? 'bet-up' : 'bet-down')
}

const buyBonusCost = computed(() => bet.value * XENOSLOT_BUY_BONUS_COST)
const buyOptions = computed<SlotBuyOption[]>(() => [{
  id: 'holdwin',
  title: 'Hold & Win',
  description: `Start the bonus with ${BONUS_TRIGGER_COUNT} coins, ${XENOSLOT_BUY_BONUS_COST}× bet`,
  cost: buyBonusCost.value,
  image: ufoArt.value
}])

// --- round / HUD state --------------------------------------------------------
type Phase = 'idle' | 'spinning' | 'presenting' | 'bonus'
const phase = ref<Phase>('idle')
const ready = ref(false)
const loadError = ref('')
const turbo = ref(false)
const showHelp = ref(false)

const winMeter = ref(0)
const winning = ref(false)
const message = ref('Place your bet and spin')
const messageTone = ref<'idle' | 'win' | 'bonus' | 'warn'>('idle')

const inBonus = ref(false)
const bonusIntro = ref(false)
const bonusOutro = ref(false)
const bonusOutroAmount = ref(0)
const bonusSpinsLeft = ref(0)

const bigWin = reactive({ show: false, label: '', tier: 0, amount: 0, multiple: 0 })

const autoplay = useSlotAutoplay()

const ufoArt = ref('')

function say(text: string, tone: typeof messageTone.value = 'idle') {
  message.value = text
  messageTone.value = tone
}

// Big-win tiers, in × bet. The count-up climbs through them.
const BIG_TIERS = [
  { threshold: 15, label: 'BIG WIN' },
  { threshold: 40, label: 'MEGA WIN' },
  { threshold: 100, label: 'EPIC WIN' },
  { threshold: 400, label: 'COSMIC WIN' }
] as const

function tierFor(multiple: number) {
  let t = -1
  BIG_TIERS.forEach((tier, i) => { if (multiple >= tier.threshold) t = i })
  return t
}

// --- geometry -----------------------------------------------------------------
const CELL = 136
const GAP = 8
const PAD_X = 36
const PAD_Y = 16
const REEL_W = 5 * CELL + 4 * GAP
const REEL_H = 3 * CELL + 2 * GAP
const APP_W = REEL_W + PAD_X * 2
const APP_H = REEL_H + PAD_Y * 2

function cellCenter(c: Cell) {
  return { x: PAD_X + c.col * (CELL + GAP) + CELL / 2, y: PAD_Y + c.row * (CELL + GAP) + CELL / 2 }
}

// Payline markers sit in the side gutters; lines that share a row are nudged apart.
function markerY(line: number, side: 0 | 1): number {
  const rows = XENO_PAYLINES[line]!
  const row = side === 0 ? rows[0]! : rows[4]!
  const base = cellCenter({ col: 0, row }).y
  if (line === 1 || line === 2) return base - 26
  if (line === 3 || line === 4) return base + 26
  return base
}

function hex(color: string) {
  return Number.parseInt(color.slice(1), 16)
}

const SYMBOL_IDS = Object.keys(XENO_SYMBOLS) as SlotSymbol[]
const INITIAL_GRID: SlotSymbol[][] = [
  ['king', 'seven', 'queen'],
  ['bell', 'wild', 'ace'],
  ['diamond', 'bonus', 'jack'],
  ['ace', 'wild', 'bell'],
  ['queen', 'seven', 'ten']
]

// --- pixi (non-reactive on purpose; Vue proxies break PixiJS objects) ---------
type PixiModule = typeof import('pixi.js')
type ReelsModule = typeof import('pixi-reels')
type Gsap = typeof import('gsap').gsap

const canvasWrap = ref<HTMLDivElement>()
const windowEl = ref<HTMLDivElement>()
let PIXI: PixiModule | null = null
let REELS: ReelsModule | null = null
let GSAP: Gsap | null = null
let app: import('pixi.js').Application | null = null
let reelSet: any = null
let board: any = null
let fx: XenoFx | null = null
let symbols: XenoSymbolClasses | null = null
let symbolTex: XenoSymbolTextures | null = null
let stageRoot: Container | null = null
let lineLayer: Container | null = null
let anticLayer: Container | null = null
let floatLayer: Container | null = null
let dimLayer: Graphics | null = null
let backdrop: Sprite | null = null
const markers: Container[] = []
const ownedTextures: Texture[] = []
let resizeObs: ResizeObserver | null = null
let currentRes = 1
let reelsMoving = false
let destroyed = false

function renderResolution(): number {
  const dpr = window.devicePixelRatio || 1
  const cssW = canvasWrap.value?.clientWidth || APP_W
  // Match device pixels, never go below them; supersample standard screens a
  // little so the thin neon strokes stay smooth.
  let r = dpr * cssW / APP_W
  if (dpr < 1.5) r *= 1.25
  return Math.max(1, Math.min(3, r))
}

function texFrom(canvas: HTMLCanvasElement): Texture {
  const t = PIXI!.Texture.from(canvas)
  ownedTextures.push(t)
  return t
}

onMounted(async () => {
  window.addEventListener('pointerdown', onFirstGesture, { once: true })
  try {
    const [pixi, reels, gsapMod] = await Promise.all([
      import('pixi.js'),
      import('pixi-reels'),
      import('gsap'),
      loadXenoFonts()
    ])
    if (destroyed) return
    PIXI = pixi
    REELS = reels
    GSAP = gsapMod.gsap ?? gsapMod.default

    ufoArt.value = xenoArtDataUrl('ufo-on', 160)

    app = await initSlotPixiApp(PIXI.Application, { width: APP_W, height: APP_H }, () => destroyed)
    if (!app) return
    currentRes = renderResolution()
    app.renderer.resize(APP_W, APP_H, currentRes)
    app.stage.sortableChildren = true
    canvasWrap.value?.appendChild(app.canvas)

    buildTextures()
    buildStage()

    resizeObs = new ResizeObserver(() => {
      if (!app || destroyed) return
      const r = renderResolution()
      if (Math.abs(r - currentRes) > 0.05) {
        currentRes = r
        app.renderer.resize(APP_W, APP_H, r)
      }
    })
    if (canvasWrap.value) resizeObs.observe(canvasWrap.value)

    ready.value = true
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load the slot engine'
  }
})

function buildTextures() {
  const px = Math.min(512, Math.ceil(CELL * Math.max(2, currentRes) / 16) * 16)
  const sharp = {} as Record<SlotSymbol, Texture>
  const blur = {} as Record<SlotSymbol, Texture>
  for (const id of SYMBOL_IDS) {
    const c = paintXenoArt(id, px)
    sharp[id] = texFrom(c)
    blur[id] = texFrom(xenoMotionBlur(c))
  }
  const coin = {} as Record<XenoCoinTier, Texture>
  for (const t of ['bronze', 'silver', 'gold', 'xenium'] as XenoCoinTier[]) coin[t] = texFrom(paintXenoArt(`coin-${t}`, px))
  const core = {} as Record<XenoCoreMult, Texture>
  for (const m of [2, 5, 10] as XenoCoreMult[]) core[m] = texFrom(paintXenoArt(`core-${m}`, px))
  symbolTex = {
    sharp,
    blur,
    coin,
    core,
    ufo: texFrom(paintXenoArt('ufo', px)),
    ufoOn: texFrom(paintXenoArt('ufo-on', px)),
    glow: texFrom(xenoGlowSprite(128))
  }
}

function buildStage() {
  const P = PIXI!
  const R = REELS!
  const tex = symbolTex!
  const stage = app!.stage

  stageRoot = new P.Container()
  stageRoot.sortableChildren = true
  stage.addChild(stageRoot)

  backdrop = new P.Sprite(texFrom(paintXenoReelBackdrop(APP_W, APP_H, Math.max(2, currentRes), 5, i => PAD_X + i * (CELL + GAP), CELL, PAD_Y, REEL_H)))
  backdrop.width = APP_W
  backdrop.height = APP_H
  backdrop.zIndex = 0
  stageRoot.addChild(backdrop)

  symbols = makeXenoSymbols({
    PIXI: P,
    REELS: R,
    gsap: GSAP!,
    tex,
    reelsMoving: () => reelsMoving,
    format: v => formatNumber(v, true)
  })

  reelSet = new R.ReelSetBuilder()
    .reels(5).visibleRows(3).symbolSize(CELL, CELL).symbolGap(GAP, GAP)
    .symbols((r: any) => {
      for (const id of SYMBOL_IDS) r.register(id, symbols!.XenoReelSymbol, {})
    })
    .weights({ ten: 30, jack: 28, queen: 24, king: 20, ace: 16, bell: 12, seven: 7, diamond: 4, wild: 4, bonus: 5 })
    .speed('normal', { ...R.SpeedPresets.NORMAL, spinSpeed: 34, stopDelay: 170, bounceDistance: 30, bounceDuration: 380, anticipationDelay: 1500 })
    .speed('turbo', { ...R.SpeedPresets.TURBO, anticipationDelay: 700 })
    .initialFrame(INITIAL_GRID.map(col => ({ visible: col })))
    .ticker(app!.ticker)
    .build()
  reelSet.x = PAD_X
  reelSet.y = PAD_Y
  reelSet.zIndex = 10
  stageRoot.addChild(reelSet)

  reelSet.events.on('spin:reelLanded', onReelLanded)

  anticLayer = new P.Container()
  anticLayer.zIndex = 15
  stageRoot.addChild(anticLayer)

  lineLayer = new P.Container()
  lineLayer.zIndex = 20
  lineLayer.eventMode = 'none'
  stageRoot.addChild(lineLayer)

  // Payline markers.
  for (let line = 0; line < XENO_PAYLINES.length; line++) {
    for (const side of [0, 1] as const) {
      const m = new P.Container()
      const color = hex(XENO_LINE_COLORS[line]!)
      const g = new P.Graphics()
      g.circle(0, 0, 13).fill({ color: 0x0b0618 }).stroke({ color, width: 2.5 })
      g.circle(0, 0, 9).fill({ color, alpha: 0.28 })
      const t = new P.Text({ text: String(line + 1), style: { fontFamily: 'Orbitron, system-ui, sans-serif', fontSize: 13, fontWeight: '900', fill: 0xffffff } })
      t.anchor.set(0.5)
      m.addChild(g, t)
      m.position.set(side === 0 ? PAD_X / 2 : APP_W - PAD_X / 2, markerY(line, side))
      m.alpha = 0.55
      m.zIndex = 22
      stageRoot.addChild(m)
      markers.push(m)
    }
  }

  floatLayer = new P.Container()
  floatLayer.zIndex = 30
  floatLayer.eventMode = 'none'
  stageRoot.addChild(floatLayer)

  dimLayer = new P.Graphics()
  dimLayer.rect(-40, -40, APP_W + 80, APP_H + 80).fill({ color: 0x05010f })
  dimLayer.alpha = 0
  dimLayer.zIndex = 40
  stageRoot.addChild(dimLayer)

  const fxLayer = new P.Container()
  fxLayer.zIndex = 50
  fxLayer.eventMode = 'none'
  stageRoot.addChild(fxLayer)
  fx = new XenoFx(P, app!.ticker, fxLayer, {
    glow: tex.glow,
    spark: texFrom(xenoSparkSprite(64)),
    coins: [tex.coin.gold, tex.coin.gold, tex.coin.xenium, tex.coin.silver]
  }, APP_W, APP_H)
}

onUnmounted(() => {
  destroyed = true
  window.removeEventListener('pointerdown', onFirstGesture)
  resizeObs?.disconnect()
  stopAutoplay()
  requestSkip()
  sound.stopMusic()
  sound.stopEffects()
  if (GSAP) {
    for (const target of [dimLayer, stageRoot, reelSet, board?.container]) if (target) GSAP.killTweensOf(target)
  }
  safeDestroy(() => fx?.destroy())
  safeDestroy(() => board?.destroy())
  safeDestroy(() => reelSet?.destroy())
  safeDestroy(() => app?.destroy(true, { children: true }))
  for (const t of ownedTextures.splice(0)) safeDestroy(() => t.destroy(true))
  fx = null
  board = null
  reelSet = null
  app = null
})

// --- sound helpers ---------------------------------------------------------
function onFirstGesture() {
  sound.unlock()
  sound.startMusic()
}

function click() {
  sound.unlock()
  sound.play('click')
}

function toggleTurbo() {
  turbo.value = !turbo.value
  sound.play('toggle', turbo.value ? 1 : 0)
  try {
    localStorage.setItem('xenoslot-turbo', String(turbo.value))
  } catch { /* storage blocked */ }
}

onMounted(() => {
  try {
    turbo.value = localStorage.getItem('xenoslot-turbo') === 'true'
  } catch { /* storage blocked */ }
})

// --- timing -----------------------------------------------------------------
// `delay` waits scale with turbo and resolve early when the player skips.
let skipping = false
const waiters = new Set<() => void>()

function speed() {
  return turbo.value ? 0.5 : 1
}

function delay(ms: number): Promise<void> {
  const t = ms * speed()
  if (skipping || t <= 0 || destroyed) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(id)
      waiters.delete(done)
      resolve()
    }
    const id = setTimeout(done, t)
    waiters.add(done)
  })
}

function requestSkip() {
  skipping = true
  for (const w of [...waiters]) w()
}

function tween(target: object, vars: Record<string, unknown>): Promise<void> {
  if (!GSAP) return Promise.resolve()
  return new Promise<void>((resolve) => {
    GSAP!.to(target, { ...vars, onComplete: () => resolve() })
  })
}

/** Count the win meter up to `to`, ticking as it goes. */
let meterTween: ReturnType<Gsap['to']> | null = null
function countWin(to: number, seconds: number): Promise<void> {
  meterTween?.kill()
  if (!GSAP || skipping || seconds <= 0) {
    winMeter.value = to
    return Promise.resolve()
  }
  const obj = { v: winMeter.value }
  return new Promise<void>((resolve) => {
    meterTween = GSAP!.to(obj, {
      v: to,
      duration: seconds * speed(),
      ease: 'power1.out',
      onUpdate: () => {
        winMeter.value = obj.v
        sound.play('tick')
      },
      onComplete: () => {
        winMeter.value = to
        resolve()
      }
    })
    const stop = () => {
      meterTween?.progress(1)
      waiters.delete(stop)
    }
    waiters.add(stop)
  })
}

// --- reel events -------------------------------------------------------------
let anticipation: number[] = []
let landedCount = 0
let scattersSeen = 0
let roundGrid: SlotSymbol[][] | null = null

function reelGlow(col: number, on: boolean) {
  if (!anticLayer || !PIXI || !GSAP) return
  for (const child of anticLayer.removeChildren()) {
    GSAP.killTweensOf(child)
    child.destroy()
  }
  if (!on) return
  const g = new PIXI.Graphics()
  const x = PAD_X + col * (CELL + GAP)
  g.roundRect(x - 8, PAD_Y - 8, CELL + 16, REEL_H + 16, 20).stroke({ color: 0xd946ef, width: 18, alpha: 0.22 })
  g.roundRect(x - 4, PAD_Y - 4, CELL + 8, REEL_H + 8, 17).stroke({ color: 0xe879f9, width: 6, alpha: 0.6 })
  g.roundRect(x - 2, PAD_Y - 2, CELL + 4, REEL_H + 4, 15).stroke({ color: 0xfdf4ff, width: 2, alpha: 1 })
  g.roundRect(x, PAD_Y, CELL, REEL_H, 14).fill({ color: 0xd946ef, alpha: 0.2 })
  g.blendMode = 'add'
  anticLayer.addChild(g)
  GSAP.fromTo(g, { alpha: 0.4 }, { alpha: 1, duration: 0.22, yoyo: true, repeat: -1, ease: 'sine.inOut' })
  fx?.burst(x + CELL / 2, PAD_Y + REEL_H, { count: 18, kind: 'spark', speed: 380, cone: 0.6, colors: [0xf0abfc, 0xe879f9, 0xffffff], gravity: -80 })
}

function onReelLanded(reelIndex: number) {
  landedCount++
  sound.play('reel-stop', reelIndex)
  sound.setWhir((5 - landedCount) / 5)
  const col = roundGrid?.[reelIndex]
  if (col) {
    col.forEach((sym, row) => {
      if (sym !== 'bonus') return
      scattersSeen++
      sound.play('scatter-land', Math.min(4, scattersSeen), 0.02)
      const p = cellCenter({ col: reelIndex, row })
      fx?.ring(p.x, p.y, 0xf0abfc, 90, 0.5, 5)
      fx?.burst(p.x, p.y, { count: 14, colors: [0xf0abfc, 0xfde047, 0xffffff], speed: 260 })
    })
  }
  reelGlow(reelIndex, false)
  if (anticipation.includes(reelIndex + 1)) {
    reelGlow(reelIndex + 1, true)
    sound.play('anticipation')
    say(`${scattersSeen} portals... one more!`, 'bonus')
  }
}

// Reels after the second portal (until the third lands) spin long with a glow.
function anticipationReels(grid: SlotSymbol[][]): number[] {
  const out: number[] = []
  let seen = 0
  for (let col = 0; col < grid.length; col++) {
    if (seen === BONUS_TRIGGER_COUNT - 1) out.push(col)
    seen += grid[col]!.filter(s => s === 'bonus').length
  }
  return out
}

// --- win presentation ---------------------------------------------------------
function clearLines() {
  if (!lineLayer) return
  for (const child of lineLayer.removeChildren()) {
    GSAP?.killTweensOf(child)
    child.destroy()
  }
  for (const m of markers) {
    m.alpha = 0.55
    m.scale.set(1)
  }
}

function clearFloats() {
  if (!floatLayer) return
  for (const child of floatLayer.removeChildren()) {
    GSAP?.killTweensOf(child)
    child.destroy()
  }
}

/** Fade every reel symbol except `cells` (the spotlight lifts the kept ones above the mask). */
function dimExcept(cells: Cell[]) {
  const keep = new Set(cells.map(c => `${c.col}:${c.row}`))
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 3; row++) {
      const view = reelSet?.getReel(col)?.getSymbolAt(row)?.view
      if (view) view.alpha = keep.has(`${col}:${row}`) ? 1 : 0.28
    }
  }
}

function undim() {
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 3; row++) {
      const view = reelSet?.getReel(col)?.getSymbolAt(row)?.view
      if (view) view.alpha = 1
    }
  }
}

function spotlight(cells: Cell[]) {
  reelSet.spotlight.hide()
  dimExcept(cells)
  void reelSet.spotlight.show(cells.map(c => ({ reelIndex: c.col, rowIndex: c.row })), { dimAmount: 0 })
}

function unspotlight() {
  reelSet?.spotlight?.hide()
  undim()
}

function lightMarker(line: number) {
  for (const side of [0, 1]) {
    const m = markers[line * 2 + side]
    if (!m) continue
    m.alpha = 1
    GSAP?.fromTo(m.scale, { x: 1.5, y: 1.5 }, { x: 1.15, y: 1.15, duration: 0.35, ease: 'back.out(3)' })
  }
}

function linePath(line: number): { x: number, y: number }[] {
  const rows = XENO_PAYLINES[line]!
  return [
    { x: PAD_X / 2 + 13, y: markerY(line, 0) },
    ...rows.map((row, col) => cellCenter({ col, row })),
    { x: APP_W - PAD_X / 2 - 13, y: markerY(line, 1) }
  ]
}

/** Draw a payline as a glowing neon tube, traced left to right, with frames on the winning cells. */
function drawWinLine(win: LineWin) {
  if (!PIXI || !lineLayer || !GSAP) return
  const color = hex(XENO_LINE_COLORS[win.line] ?? '#ffffff')
  const pts = linePath(win.line)
  const g = new PIXI.Graphics()
  g.blendMode = 'add'
  lineLayer.addChild(g)
  const frames = new PIXI.Graphics()
  for (const c of win.cells) {
    const x = PAD_X + c.col * (CELL + GAP)
    const y = PAD_Y + c.row * (CELL + GAP)
    frames.roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 16).stroke({ color, width: 10, alpha: 0.2 })
    frames.roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 15).stroke({ color, width: 3, alpha: 1 })
  }
  frames.alpha = 0
  lineLayer.addChild(frames)

  const seg: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
    seg.push(d)
    total += d
  }
  const draw = (p: number) => {
    g.clear()
    let left = total * p
    const path: { x: number, y: number }[] = [pts[0]!]
    for (let i = 1; i < pts.length && left > 0; i++) {
      const d = seg[i - 1]!
      const t = Math.min(1, left / d)
      path.push({ x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * t, y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * t })
      left -= d
    }
    if (path.length < 2) return
    for (const [w, a, c] of [[16, 0.14, color], [8, 0.35, color], [3.5, 1, 0xffffff]] as const) {
      g.moveTo(path[0]!.x, path[0]!.y)
      for (const q of path.slice(1)) g.lineTo(q.x, q.y)
      g.stroke({ color: c, width: w, alpha: a, cap: 'round', join: 'round' })
    }
  }
  const o = { p: 0 }
  GSAP.to(o, { p: 1, duration: 0.32 * speed(), ease: 'power2.out', onUpdate: () => draw(o.p) })
  GSAP.to(frames, { alpha: 1, duration: 0.2, delay: 0.1 })
  lightMarker(win.line)
}

function floatAmount(x: number, y: number, text: string, color = 0xfde047, size = 30) {
  if (!PIXI || !floatLayer || !GSAP) return
  const t = new PIXI.Text({
    text,
    style: {
      fontFamily: '"Chakra Petch", system-ui, sans-serif',
      fontSize: size,
      fontWeight: '700',
      fill: color,
      stroke: { color: 0x14052b, width: 6, join: 'round' },
      dropShadow: { color: 0x000000, alpha: 0.7, blur: 6, distance: 3, angle: Math.PI / 2 }
    }
  })
  t.anchor.set(0.5)
  t.position.set(x, y)
  floatLayer.addChild(t)
  GSAP.fromTo(t.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.6)' })
  GSAP.to(t, { y: y - 26, duration: 1.4, ease: 'power1.out' })
  GSAP.to(t, { alpha: 0, duration: 0.4, delay: 1.1, onComplete: () => t.destroy() })
}

/**
 * The spin's total, stamped big over the winning cells. It pops in, counts up
 * alongside the meter and holds until the returned function sends it off.
 */
function winPop(cells: Cell[], amount: number, multiple: number, seconds: number): () => void {
  if (!PIXI || !floatLayer || !GSAP) return () => {}
  const pts = cells.map(cellCenter)
  const x = Math.min(APP_W - 160, Math.max(160, pts.reduce((s, p) => s + p.x, 0) / pts.length))
  const y = Math.min(APP_H - 60, Math.max(60, pts.reduce((s, p) => s + p.y, 0) / pts.length))
  const size = multiple >= 5 ? 88 : multiple >= 1.5 ? 74 : 62
  const t = new PIXI.Text({
    text: `+${formatNumber(0)}`,
    style: {
      fontFamily: '"Chakra Petch", system-ui, sans-serif',
      fontSize: size,
      fontWeight: '700',
      fill: multiple >= 1.5 ? 0xfde047 : 0xffffff,
      stroke: { color: 0x14052b, width: 10, join: 'round' },
      dropShadow: { color: multiple >= 1.5 ? 0xa3e635 : 0x22d3ee, alpha: 0.8, blur: 18, distance: 0 }
    }
  })
  t.anchor.set(0.5)
  t.position.set(x, y)
  floatLayer.addChild(t)
  GSAP.fromTo(t.scale, { x: 0.2, y: 0.2 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(3)' })
  fx?.ring(x, y, multiple >= 1.5 ? 0xa3e635 : 0x22d3ee, size * 2.4, 0.5, 6)
  const obj = { v: 0 }
  const count = GSAP.to(obj, {
    v: amount,
    duration: skipping ? 0 : seconds * speed(),
    ease: 'power1.out',
    onUpdate: () => {
      if (!t.destroyed) t.text = `+${formatNumber(obj.v)}`
    },
    onComplete: () => {
      if (t.destroyed) return
      t.text = `+${formatNumber(amount)}`
      GSAP!.fromTo(t.scale, { x: 1.18, y: 1.18 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' })
    }
  })
  return () => {
    count.progress(1)
    if (t.destroyed) return
    GSAP!.to(t, { y: y - 40, alpha: 0, duration: 0.4, ease: 'power1.in', onComplete: () => t.destroy() })
  }
}

function lineLabel(win: LineWin) {
  return `Line ${win.line + 1} · ${win.count}× ${XENO_SYMBOLS[win.symbol].name} · ${formatNumber(win.amount)}`
}

async function presentLineWins(result: XenoSlotResult) {
  const lines = result.lines
  if (!lines.length || !reelSet) return
  const multiple = result.basePayout / result.bet
  const cells = new Map<string, Cell>()
  for (const l of lines) for (const c of l.cells) cells.set(`${c.col}:${c.row}`, c)

  winning.value = true
  for (const l of lines) drawWinLine(l)
  spotlight([...cells.values()])
  for (const c of cells.values()) {
    const p = cellCenter(c)
    fx?.burst(p.x, p.y, { count: multiple >= 5 ? 14 : 8, colors: [0xfde047, 0xffffff, 0xa3e635], speed: 240 })
  }
  say(lines.length > 1 ? `${lines.length} lines win ${formatNumber(result.basePayout)}` : lineLabel(lines[0]!), 'win')

  const tier = tierFor(multiple)
  if (tier >= 0) {
    sound.play('win-big')
    await delay(700)
    await showBigWin(result.basePayout, multiple)
    winMeter.value = result.basePayout
  } else {
    sound.play(multiple >= 5 ? 'win-big' : multiple >= 1.5 ? 'win-medium' : 'win-small')
    if (multiple >= 5) fx?.shake(stageRoot!, 5, 0.35)
    const seconds = multiple >= 5 ? 1.6 : multiple >= 1.5 ? 1.0 : 0.6
    const dismiss = winPop([...cells.values()], result.basePayout, multiple, seconds)
    await countWin(result.basePayout, seconds)
    await delay(900)
    dismiss()
  }
  await delay(700)

  // Walk through each line on its own when there is more than one.
  if (lines.length > 1 && !turbo.value && !autoplay.active && !skipping) {
    for (const l of lines) {
      if (skipping || destroyed) break
      clearLines()
      drawWinLine(l)
      spotlight(l.cells)
      sound.play('line-show', l.line)
      const mid = cellCenter(l.cells[Math.floor((l.cells.length - 1) / 2)]!)
      floatAmount(mid.x, mid.y, `+${formatNumber(l.amount)}`)
      say(lineLabel(l), 'win')
      await delay(1000)
    }
  }
  unspotlight()
  clearLines()
}

/** Escalating big-win count-up: dims the reels, rains coins, climbs through the tiers. */
async function showBigWin(amount: number, multiple: number, base = 0) {
  const top = tierFor(multiple)
  if (top < 0 || !GSAP || !fx || !dimLayer || !stageRoot) return
  skipping = false
  const theBet = amount / multiple
  bigWin.show = true
  bigWin.tier = 0
  bigWin.label = BIG_TIERS[0].label
  bigWin.amount = 0
  bigWin.multiple = 0
  GSAP.to(dimLayer, { alpha: 0.72, duration: 0.3 })
  fx.fountain(14)
  sound.play('tier-up', 0)
  fx.ring(APP_W / 2, APP_H / 2, 0x22d3ee, 380, 0.8, 10)

  const seconds = (2.2 + top * 1.6) * (turbo.value ? 0.6 : 1)
  const obj = { v: 0 }
  await new Promise<void>((resolve) => {
    const tw = GSAP!.to(obj, {
      v: amount,
      duration: seconds,
      ease: 'power1.inOut',
      onUpdate: () => {
        bigWin.amount = obj.v
        bigWin.multiple = obj.v / theBet
        winMeter.value = base + obj.v
        sound.play('tick')
        const t = tierFor(obj.v / theBet)
        if (t > bigWin.tier) {
          bigWin.tier = t
          bigWin.label = BIG_TIERS[t]!.label
          sound.play('tier-up', t)
          fx!.fountain(14 + t * 10)
          fx!.ring(APP_W / 2, APP_H / 2, [0x22d3ee, 0xe879f9, 0xfacc15, 0xa3e635][t]!, 420, 0.9, 12)
          fx!.burst(APP_W / 2, APP_H / 2, { count: 40 + t * 20, kind: 'mix', speed: 520 + t * 80, colors: [0xfde047, 0xffffff, 0xe879f9] })
          fx!.shake(stageRoot!, 5 + t * 2, 0.5)
        }
      },
      onComplete: () => resolve()
    })
    const skip = () => {
      tw.progress(1)
      waiters.delete(skip)
    }
    waiters.add(skip)
  })
  bigWin.amount = amount
  bigWin.multiple = multiple
  winMeter.value = base + amount
  sound.play('bigwin-end')
  fx.burst(APP_W / 2, APP_H / 2, { count: 70, kind: 'mix', speed: 640, colors: [0xfde047, 0xffffff] })
  skipping = false
  await delay(2200)
  fx.fountain(0)
  bigWin.show = false
  GSAP.to(dimLayer, { alpha: 0, duration: 0.35 })
  await delay(250)
}

// --- spin flow -----------------------------------------------------------------
async function spin(buy = false) {
  if (!ready.value || phase.value !== 'idle' || !reelSet) return
  sound.unlock()
  sound.startMusic()
  const cost = buy ? buyBonusCost.value : bet.value
  if (balance.value < cost) {
    say('Not enough coins for this bet', 'warn')
    sound.play('error')
    stopAutoplay()
    return
  }
  const balanceBefore = balance.value
  let debited = false
  skipping = false

  const data = await requestSpin(cost, buy ? { buyBonus: true } : undefined, () => {
    phase.value = 'spinning'
    debited = true
    setBalance(balanceBefore - cost)
    resetRound()
    sound.play(buy ? 'buy-bonus' : 'spin-start')
    sound.startWhir()
    say(buy ? 'Bonus bought. Opening the portals' : 'Good luck!')
    reelsMoving = true
    reelSet.setSpeed(turbo.value ? 'turbo' : 'normal')
    reelSpin = reelSet.spin()
  })

  if (!data) {
    if (debited) {
      setBalance(balanceBefore)
      // Land the reels back where they were.
      reelSet.setResult(reelSet.getVisibleGrid().map((col: string[]) => ({ visible: col })))
      await reelSpin
      reelsMoving = false
      sound.stopWhir()
      say(errorMsg.value || 'Spin failed', 'warn')
      phase.value = 'idle'
      stopAutoplay()
    }
    return
  }

  const result = data.gameData
  let roundWin = 0
  try {
    roundGrid = result.grid
    anticipation = anticipationReels(result.grid)
    reelSet.setResult(result.grid.map((col: SlotSymbol[]) => ({ visible: col })))
    reelSet.setAnticipation(anticipation)
    resultSet = true
    await reelSpin
    reelsMoving = false
    resultSet = false
    sound.stopWhir()
    reelGlow(0, false)
    if (destroyed) return
    phase.value = 'presenting'
    skipping = false

    if (result.lines.length) {
      await presentLineWins(result)
      roundWin = result.basePayout
    } else if (!result.bonusTriggered) {
      say(autoplay.active ? `Autoplay · ${autoplay.left} left` : 'No win this time. Spin again')
    }

    if (result.bonusTriggered && result.bonus && !destroyed) {
      skipping = false
      phase.value = 'bonus'
      await playBonus(result)
      roundWin = result.payout
    }

    winMeter.value = result.payout
    setBalance(data.balance)
    pushHistory({ payout: result.payout, bet: result.cost, bonus: result.bonusTriggered })
    if (result.payout > 0 && !result.bonusTriggered) say(`You won ${formatNumber(result.payout)}`, 'win')
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    setBalance(data.balance)
    stopAutoplay()
  } finally {
    reelsMoving = false
    sound.stopWhir()
    isSpinning.value = false
    phase.value = 'idle'
    winning.value = false
  }

  if (destroyed) return
  continueAutoplay(result, roundWin)
}

let reelSpin: Promise<unknown> | null = null
let resultSet = false

function resetRound() {
  winMeter.value = 0
  winning.value = false
  landedCount = 0
  scattersSeen = 0
  anticipation = []
  roundGrid = null
  errorMsg.value = ''
  meterTween?.kill()
  clearLines()
  clearFloats()
  unspotlight()
}

/** Space / spin button while busy: quick-stop the reels or hurry the presentation. */
function hurry() {
  if (phase.value === 'spinning' && resultSet && reelSet?.isSpinning) {
    reelSet.slamStop()
    return
  }
  if (phase.value !== 'idle') requestSkip()
}

function onSpinButton() {
  sound.unlock()
  if (autoplay.active) {
    click()
    stopAutoplay()
    return
  }
  if (phase.value !== 'idle') {
    hurry()
    return
  }
  spin()
}

// --- Hold & Win --------------------------------------------------------------------
function absCenter(cell: Cell) {
  return cellCenter(cell)
}

async function playBonus(result: XenoSlotResult) {
  const bonus = result.bonus!
  if (!PIXI || !REELS || !GSAP || !app || !symbols || !stageRoot) return

  // 1. Trigger: portals light up on the base reels.
  say(`${result.bonusCells.length} portals · Hold & Win!`, 'bonus')
  sound.play('bonus-trigger')
  spotlight(result.bonusCells)
  for (const c of result.bonusCells) {
    const p = cellCenter(c)
    fx?.ring(p.x, p.y, 0xf0abfc, 160, 0.8, 8)
    fx?.burst(p.x, p.y, { count: 30, kind: 'mix', colors: [0xf0abfc, 0xfde047, 0xffffff], speed: 360 })
  }
  fx?.shake(stageRoot, 7, 0.6)
  await delay(1500)
  unspotlight()

  // 2. Intro card.
  inBonus.value = true
  bonusSpinsLeft.value = BONUS_FREE_SPINS
  winMeter.value = result.lines.length ? result.basePayout : 0
  sound.setBonusMusic(true)
  bonusIntro.value = true
  if (dimLayer) void tween(dimLayer, { alpha: 0.6, duration: 0.3 })
  skipping = false
  await delay(2600)
  bonusIntro.value = false
  if (dimLayer) void tween(dimLayer, { alpha: 0, duration: 0.3 })
  skipping = false

  // 3. Board, built over the reel window with the same cell geometry.
  const b = new REELS.HoldAndWinBuilder()
    .grid(5, 3).cellSize(CELL, { gap: GAP })
    .symbols((r: any) => {
      r.register('coin', symbols!.XenoCoinSymbol, {})
      r.register('glover', symbols!.XenoCoreSymbol, {})
      r.register('collector', symbols!.XenoCollectorSymbol, {})
    })
    .weights({ coin: 3, collector: 1, glover: 1, empty: 9 })
    .respins(99) // the loop follows the server's waves, not the board's counter
    .cellChrome((g: any, size: number) => {
      g.roundRect(0, 0, size, size, 16).fill({ color: 0x0c0622, alpha: 0.94 }).stroke({ color: 0x8b5cf6, width: 2, alpha: 0.5 })
      g.roundRect(5, 5, size - 10, size - 10, 12).stroke({ color: 0xffffff, width: 1, alpha: 0.06 })
    })
    .ticker(app.ticker)
    .build()
  board = b

  b.events.on('coin:locked', ({ coin }: any) => {
    const sym = b.symbolAt(coin.cell) as any
    const p = cellCenter(coin.cell)
    if (coin.id === 'coin') {
      const mult = coin.data?.value ?? 0
      sym?.setValue?.(mult * result.bet, mult)
      sym?.pop?.(0.6)
      const tier = xenoCoinTier(mult)
      sound.play('coin-land', XENO_COIN_TIER_INDEX[tier])
      fx?.burst(p.x, p.y, { count: 6 + XENO_COIN_TIER_INDEX[tier] * 6, colors: tier === 'xenium' ? [0x6ee7b7, 0xffffff] : [0xfde047, 0xffffff], speed: 220 })
    } else if (coin.id === 'glover') {
      sym?.setMult?.(coin.data?.mult ?? 2)
      sound.play('core-land', coin.data?.mult ?? 2)
      fx?.ring(p.x, p.y, 0x67e8f9, 80, 0.45, 4)
    } else if (coin.id === 'collector') {
      sym?.pop?.(0.5)
      sound.play('ufo-land')
      fx?.ring(p.x, p.y, 0x5eead4, 110, 0.6, 6)
    }
  })
  b.events.on('cell:landed', ({ coin }: any) => {
    if (!coin) sound.play('cell-stop')
  })

  b.container.position.set(PAD_X, PAD_Y)
  b.container.zIndex = 12
  b.container.alpha = 0
  stageRoot.addChild(b.container)
  void tween(reelSet, { alpha: 0, duration: 0.35 })
  await tween(b.container, { alpha: 1, duration: 0.35 })
  reelSet.visible = false

  try {
    const seed = bonus.seed.map(c => ({ cell: c.cell, id: 'coin', data: { value: c.value } }))
    b.enter(seed)
    for (const c of bonus.seed) {
      const sym = b.symbolAt(c.cell) as any
      sym?.setValue?.(c.value * result.bet, c.value)
      sym?.pop?.(0.4)
      sound.play('coin-land', XENO_COIN_TIER_INDEX[xenoCoinTier(c.value)])
    }
    say('Coins stick. A UFO collects them all', 'bonus')
    await delay(900)

    // The pixi-reels board ends the feature on its own when every cell is
    // taken, which can happen before the server's waves run out; stop
    // advancing then (the current wave still finishes).
    let boardDone = false
    for (const wave of bonus.waves) {
      if (boardDone || destroyed) break
      skipping = false
      bonusSpinsLeft.value = BONUS_FREE_SPINS - wave.round
      say(`Bonus spin ${wave.round} of ${BONUS_FREE_SPINS}`, 'bonus')
      sound.play('bonus-spin')

      // Coins landing beside a core in the same wave already hold their boosted
      // value; spawn them at the pre-boost value so the boost can play out.
      const preBoost = new Map<string, number>()
      for (const g of wave.glovers) {
        for (const up of g.upgrades) {
          const k = `${up.cell.col}:${up.cell.row}`
          if (!preBoost.has(k)) preBoost.set(k, up.from)
        }
      }
      const hits = [
        ...wave.coins.map(c => ({ cell: c.cell, id: 'coin', data: { value: preBoost.get(`${c.cell.col}:${c.cell.row}`) ?? c.value } })),
        ...wave.glovers.map(g => ({ cell: g.cell, id: 'glover', data: { mult: g.mult } })),
        ...wave.collectors.map(c => ({ cell: c.cell, id: 'collector', data: { collected: c.collected } }))
      ]
      const res = await b.respin(hits)
      boardDone = res.done

      if (wave.glovers.length) {
        await delay(220)
        await applyCores(b, wave, result.bet)
        b.release(wave.glovers.map(g => g.cell))
        await delay(150)
      }

      if (wave.collectors.length) {
        await delay(250)
        await collectIntoUfo(b, wave, result.bet)
        b.release([...wave.collectedCoins.map(c => c.cell), ...wave.collectors.map(c => c.cell)])
        await delay(250)
      } else {
        await delay(wave.hit ? 320 : 220)
      }
    }

    bonusSpinsLeft.value = 0
    await delay(500)
  } finally {
    // 4. Back to the reels.
    if (!destroyed) {
      reelSet.visible = true
      void tween(b.container, { alpha: 0, duration: 0.35 })
      await tween(reelSet, { alpha: 1, duration: 0.35 })
    }
    safeDestroy(() => stageRoot?.removeChild(b.container))
    safeDestroy(() => b.destroy())
    board = null
  }
  if (destroyed) return

  // 5. A big haul goes straight into the escalating count-up, so the total
  // isn't spoiled first. Anything smaller gets the outro card.
  skipping = false
  const base = Math.min(result.basePayout, result.payout)
  const multiple = (result.payout - base) / result.bet
  if (tierFor(multiple) >= 0) {
    say('Hold & Win complete', 'win')
    inBonus.value = false
    sound.setBonusMusic(false)
    await showBigWin(result.payout - base, multiple, base)
    winMeter.value = result.payout
    return
  }
  bonusOutroAmount.value = bonus.bonusPayout
  bonusOutro.value = true
  if (dimLayer) void tween(dimLayer, { alpha: 0.6, duration: 0.3 })
  sound.play('bonus-end')
  say(bonus.bonusPayout > 0 ? `Hold & Win paid ${formatNumber(bonus.bonusPayout)}` : 'No UFO landed. The coins stay behind', bonus.bonusPayout > 0 ? 'win' : 'idle')
  if (bonus.bonusPayout > 0) fx?.burst(APP_W / 2, APP_H / 2, { count: 60, kind: 'mix', speed: 520, colors: [0xfde047, 0xffffff, 0xf0abfc] })
  await delay(2400)
  bonusOutro.value = false
  if (dimLayer) void tween(dimLayer, { alpha: 0, duration: 0.3 })
  inBonus.value = false
  sound.setBonusMusic(false)
  await countWin(result.payout, 0.8)
}

// Each core zaps its neighbours: lightning to every coin it boosts, new value, then it fades.
async function applyCores(b: any, wave: BonusWave, theBet: number) {
  say('Multiplier core!', 'bonus')
  for (const core of wave.glovers) {
    const orb = b.symbolAt(core.cell) as any
    const from = absCenter(core.cell)
    await orb?.playWin?.()
    const color = core.mult >= 10 ? 0xfacc15 : core.mult >= 5 ? 0xe879f9 : 0x22d3ee
    for (const up of core.upgrades) {
      const to = absCenter(up.cell)
      fx?.bolt(from.x, from.y, to.x, to.y, color)
      sound.play('core-zap')
      const coin = b.symbolAt(up.cell) as any
      coin?.setValue?.(up.to * theBet, up.to)
      coin?.pop?.(1.3)
      floatAmount(to.x, to.y - 20, `×${core.mult}`, color, 26)
      fx?.burst(to.x, to.y, { count: 10, colors: [color, 0xffffff], speed: 260 })
      await delay(140)
    }
    await delay(core.upgrades.length ? 300 : 140)
    if (orb?.view) await tween(orb.view, { alpha: 0, duration: 0.22 })
  }
}

// The UFO opens its beam and pulls every coin in, one after another; the
// running total ticks up on each arrival, then the board is wiped.
async function collectIntoUfo(b: any, wave: BonusWave, theBet: number) {
  say('UFO collecting!', 'bonus')
  for (const collector of wave.collectors) {
    const ufo = b.symbolAt(collector.cell) as any
    let running = 0
    ufo?.open?.()
    ufo?.setCollected?.(0)
    sound.play('ufo-beam')
    await delay(260)
    const gap = Math.max(50, Math.min(120, 1100 / Math.max(1, wave.collectedCoins.length)))
    const flights = wave.collectedCoins.map((coin, i) => new Promise<void>((resolve) => {
      setTimeout(() => {
        if (destroyed) return resolve()
        flyCoin(coin.cell, collector.cell, coin.value * theBet, coin.value, () => {
          running += coin.value * theBet
          winMeter.value += coin.value * theBet
          ufo?.setCollected?.(running)
          ufo?.playWin?.()
          sound.play('collect-coin', i)
          const p = absCenter(collector.cell)
          fx?.burst(p.x, p.y - 10, { count: 6, colors: [0x5eead4, 0xffffff, 0xfde047], speed: 180 })
        }).then(resolve)
      }, i * gap * speed())
    }))
    await Promise.allSettled(flights)
    await delay(350)
  }
  for (const coin of wave.collectedCoins) {
    const cs = b.symbolAt(coin.cell) as any
    if (cs?.view) GSAP?.to(cs.view, { alpha: 0, duration: 0.2 })
  }
  sound.play('board-clear')
  await delay(250)
}

function flyCoin(fromCell: Cell, toCell: Cell, amount: number, mult: number, onArrive: () => void): Promise<void> {
  if (!PIXI || !GSAP || !floatLayer || !symbolTex) {
    onArrive()
    return Promise.resolve()
  }
  const f = absCenter(fromCell)
  const to = absCenter(toCell)
  const ctrl = { x: (f.x + to.x) / 2 + (Math.random() * 80 - 40), y: Math.min(f.y, to.y) - 90 }
  const clone = new PIXI.Container()
  const s = new PIXI.Sprite(symbolTex.coin[xenoCoinTier(mult)])
  s.anchor.set(0.5)
  s.width = 58
  s.height = 58
  const t: Text = new PIXI.Text({ text: formatNumber(amount, true), style: { fontFamily: '"Chakra Petch", system-ui, sans-serif', fontSize: 16, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x1a0b2e, width: 4, join: 'round' } } })
  t.anchor.set(0.5)
  if (t.width > 46) t.scale.set(46 / t.width)
  clone.addChild(s, t)
  clone.position.set(f.x, f.y)
  floatLayer.addChild(clone)
  return new Promise<void>((resolve) => {
    const o = { u: 0 }
    GSAP!.to(o, {
      u: 1,
      duration: 0.55 * speed(),
      ease: 'power2.in',
      onUpdate: () => {
        const u = o.u
        const mu = 1 - u
        clone.x = mu * mu * f.x + 2 * mu * u * ctrl.x + u * u * to.x
        clone.y = mu * mu * f.y + 2 * mu * u * ctrl.y + u * u * to.y
        clone.scale.set(1 - 0.45 * u)
      },
      onComplete: () => {
        onArrive()
        clone.destroy({ children: true })
        resolve()
      }
    })
  })
}

// --- autoplay ----------------------------------------------------------------------
function startAutoplay(settings: SlotAutoSettings) {
  autoplay.start(settings, balance.value)
  sound.play('click')
  if (phase.value === 'idle') spin()
}

function stopAutoplay() {
  autoplay.stop()
}

function continueAutoplay(result: XenoSlotResult, _roundWin: number) {
  if (!autoplay.active) return
  if (!autoplay.finish({ payout: result.payout, bet: result.bet, bonus: result.bonusTriggered }, balance.value, bet.value)) {
    if (balance.value < bet.value) say('Autoplay stopped: balance too low', 'warn')
    return
  }
  setTimeout(() => {
    if (!destroyed && autoplay.active) spin()
  }, turbo.value ? 150 : 350)
}

// --- buy bonus -----------------------------------------------------------------
function buyBonus() {
  if (phase.value !== 'idle' || autoplay.active) return
  spin(true)
}

// --- template helpers ---------------------------------------------------------------
const canSpin = computed(() => ready.value && balance.value >= bet.value)
const spinMode = computed<SlotSpinMode>(() => {
  if (phase.value === 'spinning') return 'stop'
  if (phase.value !== 'idle') return 'skip'
  return 'spin'
})
const volatilityPips = Array.from({ length: 5 }, (_, i) => i < XS_VOLATILITY)
</script>

<template>
  <div class="xs-page" :class="{ 'is-bonus': inBonus }">
    <!-- Deep-space backdrop -->
    <div class="xs-sky" aria-hidden="true">
      <div class="xs-sky__stars" />
      <div class="xs-sky__stars xs-sky__stars--far" />
      <div class="xs-sky__planet" />
      <div class="xs-sky__grid" />
    </div>

    <div class="xs-stage">
      <!-- Cabinet -->
      <div class="xs-cabinet">
        <div class="xs-lights" aria-hidden="true" />

        <header class="xs-marquee">
          <div class="xs-logo">
            <img v-if="ufoArt" :src="ufoArt" alt="" class="xs-logo__ufo">
            <h1 class="xs-logo__word">
              XENO
            </h1>
            <span class="xs-logo__slot">SLOT</span>
          </div>

          <Transition name="xs-fade" mode="out-in">
            <div v-if="inBonus" key="hud" class="xs-hud">
              <div class="xs-hud__block">
                <span class="xs-hud__label">Hold &amp; Win · {{ bonusSpinsLeft }} {{ bonusSpinsLeft === 1 ? 'spin' : 'spins' }} left</span>
                <div class="xs-hud__pips">
                  <span v-for="i in BONUS_FREE_SPINS" :key="i" class="xs-hud__pip" :class="{ 'is-on': i <= bonusSpinsLeft }" />
                </div>
              </div>
            </div>
            <div v-else key="badges" class="xs-badges">
              <span class="xs-badge">{{ XENOSLOT_LINES }} lines</span>
              <span class="xs-badge xs-badge--hot">Hold &amp; Win</span>
              <span class="xs-badge">RTP {{ XS_RTP }}</span>
              <span class="xs-badge">Max {{ formatNumber(XENOSLOT_MAX_WIN_MULT, false) }}×</span>
              <span class="xs-badge xs-badge--vol" :title="`Volatility ${XS_VOLATILITY} of 5`">
                <UIcon v-for="(on, i) in volatilityPips" :key="i" name="i-lucide-zap" class="size-3" :class="on ? 'is-on' : ''" />
              </span>
            </div>
          </Transition>
        </header>

        <!-- Reel window -->
        <div ref="windowEl" class="xs-window" :data-xs-idle="phase === 'idle' && ready" :data-xs-winning="winning">
          <div class="xs-window__inner">
            <div ref="canvasWrap" class="xs-canvas" />
            <div class="xs-window__glass" aria-hidden="true" />

            <div v-if="!ready && !loadError" class="xs-overlay xs-overlay--loading">
              <UIcon class="size-10 animate-spin" name="i-lucide-loader-circle" />
            </div>
            <div v-if="loadError" class="xs-overlay">
              <p class="xs-card__sub">
                {{ loadError }}
              </p>
            </div>

            <Transition name="xs-pop">
              <div v-if="bonusIntro" class="xs-overlay" @click="requestSkip">
                <div class="xs-card xs-card--bonus">
                  <img v-if="ufoArt" :src="ufoArt" alt="" class="xs-card__ufo">
                  <p class="xs-card__kicker">
                    Bonus unlocked
                  </p>
                  <p class="xs-card__title">
                    HOLD &amp; WIN
                  </p>
                  <p class="xs-card__sub">
                    {{ BONUS_FREE_SPINS }} spins. Coins stick, cores multiply, a UFO collects.
                  </p>
                </div>
              </div>
            </Transition>

            <Transition name="xs-pop">
              <div v-if="bonusOutro" class="xs-overlay" @click="requestSkip">
                <div class="xs-card">
                  <p class="xs-card__kicker">
                    Bonus complete
                  </p>
                  <p class="xs-card__amount" :class="{ 'is-zero': bonusOutroAmount <= 0 }">
                    {{ formatNumber(bonusOutroAmount) }}
                  </p>
                  <p class="xs-card__sub">
                    {{ bonusOutroAmount > 0 ? 'collected by the UFOs' : 'No UFO landed this time' }}
                  </p>
                </div>
              </div>
            </Transition>

            <Transition name="xs-pop">
              <XenoBigWin
                v-if="bigWin.show"
                :label="bigWin.label"
                :tier="bigWin.tier"
                :amount="bigWin.amount"
                :multiple="bigWin.multiple"
                @skip="requestSkip"
              />
            </Transition>

          </div>
        </div>

        <!-- Message strip -->
        <div class="xs-ticker" :class="`is-${messageTone}`" role="status">
          <Transition name="xs-fade" mode="out-in">
            <span :key="message">{{ message }}</span>
          </Transition>
        </div>

        <SlotControlBar
          class="xs-bar"
          :theme="XENO_BAR_THEME"
          :balance="balance"
          :bet="bet"
          :bet-min="MIN_BET"
          :bet-max="MAX_BET"
          :bet-locked="betLocked"
          :win="winMeter"
          :win-label="inBonus ? 'Bonus win' : 'Win'"
          :spin-mode="spinMode"
          :spin-disabled="!canSpin"
          :auto-left="autoplay.left"
          :auto-disabled="!canSpin || phase !== 'idle'"
          :turbo="turbo"
          :buys="buyOptions"
          :buy-disabled="!ready || phase !== 'idle' || autoplay.active"
          :space-blocked="showHelp"
          v-model:sound-on="soundEnabled"
          v-model:volume="soundVolume"
          v-model:music-volume="musicVolume"
          @spin="onSpinButton"
          @bet-down="betDown"
          @bet-up="betUp"
          @bet-max="maxBet"
          @bet-set="typeBet"
          @auto-start="startAutoplay"
          @auto-stop="click(); stopAutoplay()"
          @toggle-turbo="toggleTurbo"
          @buy="buyBonus"
          @info="click(); showHelp = true"
          @ui-click="click"
        />

        <Transition name="xs-fade">
          <div v-if="errorMsg" class="xs-error">
            <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0" />
            <span class="flex-1">{{ errorMsg }}</span>
            <button aria-label="Dismiss" @click="errorMsg = ''">
              <UIcon name="i-lucide-x" class="size-4" />
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- History -->
    <div v-if="history.length" class="xs-history">
      <span class="xs-history__label">Last rounds</span>
      <span
        v-for="(h, i) in history"
        :key="i"
        class="xs-history__chip"
        :class="{ 'is-win': h.payout > h.bet, 'is-bonus': h.bonus }"
      >
        <UIcon v-if="h.bonus" name="i-lucide-orbit" class="size-3" />
        {{ h.payout > 0 ? formatNumber(h.payout) : '–' }}
      </span>
    </div>

    <XenoPaytable v-model:open="showHelp" :bet="bet" :rtp="XS_RTP" :volatility="XS_VOLATILITY" />
  </div>
</template>

<style scoped>
/* ── Page & deep-space backdrop ─────────────────────────────────────────── */
.xs-page {
  --xs-violet: #8b5cf6;
  --xs-magenta: #d946ef;
  --xs-cyan: #22d3ee;
  --xs-lime: #a3e635;
  --xs-gold: #facc15;
  --xs-ink: #0a0518;
  --xs-text: #ede9fe;
  --xs-dim: #a78bfa;
  --xs-chrome: linear-gradient(180deg, rgba(196, 181, 253, 0.55) 0%, rgba(139, 92, 246, 0.28) 30%, rgba(76, 29, 149, 0.2) 70%, rgba(167, 139, 250, 0.4) 100%);
  position: relative;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 12px 28px;
  overflow: hidden;
  isolation: isolate;
  color: var(--xs-text);
  font-family: 'Orbitron', system-ui, sans-serif;
  background: #05020d;
  container-type: inline-size;
  container-name: xs-page;
}

.xs-sky {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(ellipse 70% 45% at 50% -8%, rgba(124, 58, 237, 0.55), transparent 70%),
    radial-gradient(circle at 12% 28%, rgba(217, 70, 239, 0.22), transparent 36%),
    radial-gradient(circle at 88% 18%, rgba(34, 211, 238, 0.16), transparent 34%),
    radial-gradient(circle at 78% 82%, rgba(163, 230, 53, 0.08), transparent 36%),
    linear-gradient(180deg, #0d0421 0%, #07021a 55%, #04010c 100%);
  transition: filter 0.8s;
}

.is-bonus .xs-sky { filter: hue-rotate(38deg) saturate(1.35) brightness(1.15); }

.xs-sky__stars {
  position: absolute;
  inset: -50%;
  background-image:
    radial-gradient(1.5px 1.5px at 20px 30px, #fff, transparent),
    radial-gradient(1px 1px at 90px 120px, rgba(255, 255, 255, 0.8), transparent),
    radial-gradient(1.5px 1.5px at 160px 60px, #e9d5ff, transparent),
    radial-gradient(1px 1px at 230px 190px, rgba(255, 255, 255, 0.7), transparent),
    radial-gradient(2px 2px at 300px 90px, #a5f3fc, transparent),
    radial-gradient(1px 1px at 60px 250px, rgba(255, 255, 255, 0.6), transparent),
    radial-gradient(1.5px 1.5px at 340px 280px, #fff, transparent);
  background-size: 360px 320px;
  opacity: 0.8;
  animation: xs-drift 120s linear infinite;
}

.xs-sky__stars--far {
  background-size: 220px 200px;
  opacity: 0.35;
  animation-duration: 200s;
  animation-direction: reverse;
}

.xs-sky__planet {
  position: absolute;
  left: -120px;
  bottom: -140px;
  width: 420px;
  height: 420px;
  border-radius: 50%;
  background: radial-gradient(circle at 65% 30%, #c084fc 0%, #7c3aed 25%, #3b0764 55%, #12021f 80%);
  box-shadow: 0 0 80px rgba(168, 85, 247, 0.35), inset -30px -20px 60px rgba(0, 0, 0, 0.6);
  opacity: 0.55;
}

.xs-sky__planet::after {
  content: '';
  position: absolute;
  left: -30%;
  top: 38%;
  width: 160%;
  height: 26%;
  border-radius: 50%;
  border: 6px solid rgba(240, 171, 252, 0.35);
  border-top-color: transparent;
  transform: rotate(-14deg);
}

.xs-sky__grid {
  position: absolute;
  left: -50%;
  right: -50%;
  bottom: 0;
  height: 42%;
  background:
    repeating-linear-gradient(90deg, rgba(168, 85, 247, 0.22) 0 1px, transparent 1px 64px),
    repeating-linear-gradient(0deg, rgba(168, 85, 247, 0.22) 0 1px, transparent 1px 48px);
  transform: perspective(420px) rotateX(62deg);
  transform-origin: bottom;
  mask-image: linear-gradient(0deg, rgba(0, 0, 0, 0.8), transparent 90%);
}

@keyframes xs-drift {
  to { transform: translate(360px, 320px); }
}

/* ── Stage: buy card + cabinet ─────────────────────────────────────────── */
.xs-stage {
  position: relative;
  width: 100%;
  max-width: 860px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}


/* ── Buy card ──────────────────────────────────────────────────────────── */

@keyframes xs-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

@keyframes xs-rise {
  0% { opacity: 0; transform: translateY(20%) scale(0.9); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-260%) scale(0.5); }
}

/* ── Cabinet ───────────────────────────────────────────────────────────── */
.xs-cabinet {
  position: relative;
  padding: 14px 16px 16px;
  border-radius: 30px;
  border: 1px solid transparent;
  background:
    radial-gradient(ellipse 90% 40% at 50% 0%, rgba(168, 85, 247, 0.25), transparent 70%) padding-box,
    linear-gradient(180deg, #1d1040 0%, #120828 45%, #0b0519 100%) padding-box,
    var(--xs-chrome) border-box;
  box-shadow:
    0 30px 60px rgba(0, 0, 0, 0.6),
    0 0 60px rgba(139, 92, 246, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
  container-type: inline-size;
  container-name: xs-cab;
  transition: box-shadow 0.6s;
}

.is-bonus .xs-cabinet {
  box-shadow:
    0 30px 60px rgba(0, 0, 0, 0.6),
    0 0 90px rgba(217, 70, 239, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

/* Chasing marquee bulbs along the top edge. */
.xs-lights {
  position: absolute;
  left: 26px;
  right: 26px;
  top: 5px;
  height: 6px;
  border-radius: 999px;
  background-image: radial-gradient(circle, #fde68a 0 2px, rgba(250, 204, 21, 0.25) 2.5px, transparent 3.5px);
  background-size: 18px 6px;
  filter: drop-shadow(0 0 3px rgba(250, 204, 21, 0.8));
  animation: xs-chase 0.9s steps(3) infinite;
}

.is-bonus .xs-lights {
  background-image: radial-gradient(circle, #f5d0fe 0 2px, rgba(217, 70, 239, 0.35) 2.5px, transparent 3.5px);
  filter: drop-shadow(0 0 4px rgba(217, 70, 239, 0.9));
  animation-duration: 0.45s;
}

@keyframes xs-chase {
  to { background-position: 18px 0; }
}

/* ── Marquee: logo + badges / bonus HUD ────────────────────────────────── */
.xs-marquee {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 6px 12px;
}

.xs-logo {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 0 58px;
}

.xs-logo__ufo {
  position: absolute;
  left: 0;
  top: 50%;
  width: 50px;
  height: 50px;
  margin-top: -28px;
  animation: xs-bob 2.6s ease-in-out infinite;
  filter: drop-shadow(0 0 8px rgba(94, 234, 212, 0.7));
}

.xs-logo__word {
  font-family: 'Audiowide', sans-serif;
  font-size: clamp(30px, 6cqw, 46px);
  line-height: 1;
  letter-spacing: 0.06em;
  background: linear-gradient(180deg, #ffffff 0%, #ecfccb 28%, #a3e635 52%, #22d3ee 78%, #0e7490 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 2px 0 #1a0b2e) drop-shadow(0 0 16px rgba(163, 230, 53, 0.55));
}

.xs-logo__slot {
  font-family: 'Audiowide', sans-serif;
  font-size: clamp(14px, 2.4cqw, 19px);
  letter-spacing: 0.5em;
  color: #fdf4ff;
  text-shadow: 0 0 4px #f0abfc, 0 0 12px #d946ef, 0 0 24px #a21caf;
  animation: xs-flicker 6s infinite;
}

@keyframes xs-flicker {
  0%, 92%, 96%, 100% { opacity: 1; }
  94% { opacity: 0.55; }
}

/* Game facts as one quiet line of text, dot-separated, instead of a row of chips. */
.xs-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  column-gap: 0;
  row-gap: 4px;
}

.xs-badges, .xs-hud { min-height: 28px; align-content: center; }

.xs-badge {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(221, 214, 254, 0.62);
}

.xs-badge + .xs-badge::before {
  content: '';
  width: 3px;
  height: 3px;
  margin: 0 12px;
  border-radius: 50%;
  background: rgba(167, 139, 250, 0.5);
}

.xs-badge--hot { color: #f0abfc; }

.xs-badge--vol :deep(.iconify) { color: rgba(167, 139, 250, 0.35); }
.xs-badge--vol :deep(.is-on) { color: #facc15; filter: drop-shadow(0 0 3px rgba(250, 204, 21, 0.8)); }

.xs-hud {
  display: flex;
  gap: 18px;
  align-items: center;
}

.xs-hud__block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.xs-hud__label {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: #f0abfc;
}

.xs-hud__pips { display: flex; gap: 4px; }

.xs-hud__pip {
  width: 10px;
  height: 14px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(240, 171, 252, 0.25);
  transition: background 0.3s, box-shadow 0.3s;
}

.xs-hud__pip.is-on {
  background: linear-gradient(180deg, #fdf4ff, #e879f9);
  box-shadow: 0 0 8px rgba(232, 121, 249, 0.9);
}

/* ── Reel window ───────────────────────────────────────────────────────── */
.xs-window {
  position: relative;
  padding: 1.5px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(196, 181, 253, 0.7), rgba(124, 58, 237, 0.35) 45%, rgba(124, 58, 237, 0.35) 55%, rgba(167, 139, 250, 0.6));
  box-shadow: 0 0 28px rgba(168, 85, 247, 0.3), 0 12px 30px rgba(0, 0, 0, 0.45);
  transition: box-shadow 0.4s;
}

.xs-window[data-xs-winning='true'] {
  box-shadow: 0 0 36px rgba(250, 204, 21, 0.45), 0 12px 30px rgba(0, 0, 0, 0.45);
}

.is-bonus .xs-window {
  background: linear-gradient(180deg, rgba(245, 208, 254, 0.8), rgba(192, 38, 211, 0.4) 50%, rgba(232, 121, 249, 0.7));
  box-shadow: 0 0 40px rgba(217, 70, 239, 0.5), 0 12px 30px rgba(0, 0, 0, 0.45);
}

.xs-window__inner {
  position: relative;
  border-radius: 20.5px;
  overflow: hidden;
  background:
    radial-gradient(ellipse 70% 60% at 50% 40%, #1a0d3a, #07031a 80%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 12px 30px rgba(0, 0, 0, 0.8);
  container-type: inline-size;
}

.xs-canvas {
  position: relative;
  z-index: 1;
  width: 100%;
  aspect-ratio: 780 / 456;
}

.xs-canvas :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.xs-window__glass {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background:
    linear-gradient(115deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 28%, transparent 30%),
    linear-gradient(180deg, rgba(0, 0, 0, 0.35), transparent 10%, transparent 90%, rgba(0, 0, 0, 0.4));
}

.xs-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 16px;
  color: #c4b5fd;
}

.xs-overlay--loading { color: var(--xs-lime); }

.xs-card {
  position: relative;
  max-width: 440px;
  padding: 22px 28px 24px;
  border-radius: 22px;
  text-align: center;
  border: 2px solid transparent;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(217, 70, 239, 0.4), transparent 65%) padding-box,
    linear-gradient(180deg, rgba(36, 16, 74, 0.96), rgba(12, 5, 30, 0.96)) padding-box,
    linear-gradient(135deg, #f5d0fe, #a21caf 30%, #3b0764 55%, #f0abfc 80%, #86198f) border-box;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7), 0 0 60px rgba(217, 70, 239, 0.45);
  cursor: pointer;
}

.xs-card--bonus { padding-top: 54px; }

.xs-card__ufo {
  position: absolute;
  left: 50%;
  top: -58px;
  width: 104px;
  height: 104px;
  margin-left: -52px;
  animation: xs-bob 2s ease-in-out infinite;
  filter: drop-shadow(0 0 18px rgba(94, 234, 212, 0.8));
}

.xs-card__kicker {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #f0abfc;
}

.xs-card__title {
  margin: 4px 0 6px;
  font-family: 'Audiowide', sans-serif;
  white-space: nowrap;
  font-size: clamp(28px, 6.5cqw, 52px);
  line-height: 1;
  background: linear-gradient(180deg, #ffffff, #fde68a 40%, #facc15 60%, #b45309);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 3px 0 #3b0764) drop-shadow(0 0 20px rgba(250, 204, 21, 0.6));
}

.xs-card__sub {
  font-family: system-ui, sans-serif;
  font-size: 14px;
  color: #e9d5ff;
}

.xs-card__amount {
  font-family: 'Chakra Petch', 'Orbitron', monospace;
  margin: 6px 0;
  font-weight: 900;
  font-size: clamp(30px, 7cqw, 48px);
  color: #fff7d1;
  text-shadow: 0 0 8px rgba(250, 204, 21, 0.9), 0 0 26px rgba(250, 204, 21, 0.5);
  font-variant-numeric: tabular-nums;
}

.xs-card__amount.is-zero { color: #a78bfa; text-shadow: none; }

/* ── Ticker ────────────────────────────────────────────────────────────── */
/* Status line: plain text under the reels, framed only by a hairline. */
.xs-ticker {
  position: relative;
  margin: 8px 4px 0;
  height: 26px;
  display: grid;
  place-items: center;
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  white-space: nowrap;
  color: rgba(196, 181, 253, 0.8);
}

.xs-ticker > span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; padding: 0 10px; }
.xs-ticker.is-win { color: #fde68a; text-shadow: 0 0 8px rgba(250, 204, 21, 0.7); }
.xs-ticker.is-bonus { color: #f5d0fe; text-shadow: 0 0 8px rgba(217, 70, 239, 0.8); }
.xs-ticker.is-warn { color: #fca5a5; }

/* ── Console ───────────────────────────────────────────────────────────── */

@keyframes xs-hot {
  to { box-shadow: inset 0 0 0 1.5px rgba(250, 204, 21, 1), inset 0 3px 10px rgba(0, 0, 0, 0.8), 0 0 28px rgba(250, 204, 21, 0.55); }
}

/* The big spin button. */

@keyframes xs-breathe {
  0%, 100% { box-shadow: 0 8px 22px rgba(0, 0, 0, 0.6), 0 0 20px rgba(163, 230, 53, 0.3); }
  50% { box-shadow: 0 8px 22px rgba(0, 0, 0, 0.6), 0 0 36px rgba(163, 230, 53, 0.65); }
}

/* The controls sit on the cabinet itself, split off by a hairline, not boxed in a second card. */
.xs-bar {
  margin-top: 6px;
  border-top: 1px solid rgba(196, 181, 253, 0.1);
}

.xs-bar :deep(.sc-grid) {
  background: transparent;
  padding: 14px 6px 4px;
}

.xs-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 12px;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.35);
  box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.4);
}

/* ── History ───────────────────────────────────────────────────────────── */
.xs-history {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 16px;
  max-width: 860px;
}

.xs-history__label {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgba(167, 139, 250, 0.7);
}

.xs-history__chip {
  font-family: 'Chakra Petch', 'Orbitron', monospace;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: rgba(221, 214, 254, 0.45);
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(167, 139, 250, 0.15);
}

.xs-history__chip.is-win { color: #fde68a; border-color: rgba(250, 204, 21, 0.4); }
.xs-history__chip.is-bonus { color: #f5d0fe; border-color: rgba(217, 70, 239, 0.5); }

/* ── Transitions ───────────────────────────────────────────────────────── */
.xs-fade-enter-active, .xs-fade-leave-active { transition: opacity 0.2s, transform 0.2s; }
.xs-fade-enter-from { opacity: 0; transform: translateY(4px); }
.xs-fade-leave-to { opacity: 0; transform: translateY(-4px); }

.xs-pop-enter-active { transition: opacity 0.25s, transform 0.35s cubic-bezier(0.2, 1.5, 0.4, 1); }
.xs-pop-leave-active { transition: opacity 0.2s, transform 0.2s; }
.xs-pop-enter-from { opacity: 0; transform: scale(0.8); }
.xs-pop-leave-to { opacity: 0; transform: scale(1.08); }

/* ── Narrow cabinets (phones, small windows) ───────────────────────────── */
@container xs-cab (max-width: 620px) {














  .xs-marquee { justify-content: center; }
  .xs-badges { justify-content: center; }
}

@container xs-cab (max-width: 440px) {
  .xs-cabinet { padding: 10px; }


  .xs-badge { font-size: 9px; letter-spacing: 0.1em; }
  .xs-badge + .xs-badge::before { margin: 0 7px; }

  .xs-ticker { font-size: 10px; letter-spacing: 0.08em; }
}

@media (max-width: 480px) {
  .xs-page { padding: 10px 6px 20px; }
  .xs-cabinet { border-radius: 22px; padding: 10px 10px 12px; }
  .xs-window { border-radius: 18px; padding: 4px; }
  .xs-window__inner { border-radius: 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .xs-sky__stars,
.xs-lights,
.xs-logo__ufo { animation: none !important; }
}
</style>

<style>
/* Sound popover content is teleported. */

</style>
