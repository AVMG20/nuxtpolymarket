<script setup lang="ts">
// Trash Panda Heist: a 5×4, 1024-ways slot with sticky multiplier-wild free
// spins (Night Heist) and a pick game (Dumpster Dive). The server decides
// every outcome (shared/utils/gamelogic/trashpanda.ts); this component only
// presents it. All artwork is painted procedurally
// (~/utils/slots/trashpanda-art) and every sound is synthesized
// (~/composables/trashpanda-sound), so the game loads no image or audio files.
import type { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Cell, TphFreeSpin, TphStickyWild, TphSymbol, TphWayWin, TrashPandaResult } from '#shared/utils/gamelogic/trashpanda'
import {
  BASE_REEL_WEIGHTS,
  DIVE_REELS,
  FS_TRIGGER,
  TPH_BUY_DIVE_COST,
  TPH_BUY_FREE_SPINS_COST,
  TPH_COLS,
  TPH_MAX_WIN_MULT,
  TPH_ROWS,
  TPH_WAYS
} from '#shared/utils/gamelogic/trashpanda'
import { initSlotPixiApp, safeDestroy } from '~/utils/slot-pixi'
import {
  TPH_SYMBOLS,
  TPH_WILD_COLORS,
  TPH_WILD_MULTS,
  loadTphFonts,
  paintTphArt,
  paintTphReelBackdrop,
  tphArtDataUrl,
  tphCoinSprite,
  tphGlowSprite,
  tphMotionBlur,
  tphSparkSprite,
  type TphWildMult
} from '~/utils/slots/trashpanda-art'
import { makeTphSymbols, type TphReelId, type TphSymbolTextures } from '~/utils/slots/trashpanda-symbols'
import { TPH_STATS } from '~/utils/slots/trashpanda-stats'
import { XenoFx } from '~/utils/slots/xenoslot-fx'
import TphBigWin from '~/components/games/trashpanda/TphBigWin.vue'
import TphDive from '~/components/games/trashpanda/TphDive.vue'
import TphPaytable from '~/components/games/trashpanda/TphPaytable.vue'
import SlotControlBar from '~/components/slots/SlotControlBar.vue'
import type { SlotAutoSettings, SlotBuyOption, SlotSpinMode } from '~/utils/slots/slot-controls'
import { TRASH_BAR_THEME } from '~/utils/slots/slot-themes'

type Feature = 'buyFreeSpins' | 'buyDive'

const { fetchSession } = useAuth()
const { bet, isSpinning, errorMsg, balance, setBalance, history, pushHistory, spin: requestSpin } = useSlotGame<TrashPandaResult, { payout: number, bet: number, bonus: boolean }>('trashpanda')
const sound = useTrashPandaSound()
const { soundEnabled, soundVolume, musicVolume } = sound

// --- bet --------------------------------------------------------------------
const MIN_BET = 1
const MAX_BET = 100_000_000_000
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
  setBet([...BET_LADDER].reverse().find(v => v <= balance.value) ?? MIN_BET, 'bet-up')
}

function typeBet(v: number) {
  setBet(v, v > bet.value ? 'bet-up' : 'bet-down')
}

const heistArt = ref('')
const diveArt = ref('')
const bossArt = ref('')

const buyOptions = computed<SlotBuyOption[]>(() => [
  {
    id: 'buyFreeSpins',
    title: 'Night Heist',
    description: '8 free spins with sticky multiplier wilds',
    cost: bet.value * TPH_BUY_FREE_SPINS_COST,
    image: heistArt.value
  },
  {
    id: 'buyDive',
    title: 'Dumpster Dive',
    description: '12 trash cans, 2 guard dogs',
    cost: bet.value * TPH_BUY_DIVE_COST,
    image: diveArt.value
  }
])

// --- round / HUD state --------------------------------------------------------
type Phase = 'idle' | 'spinning' | 'presenting' | 'bonus'
const phase = ref<Phase>('idle')
const ready = ref(false)
const loadError = ref('')
const turbo = ref(false)
const showHelp = ref(false)

const winMeter = ref(0)
const winPulse = ref(0)
const winning = ref(false)
const message = ref('Place your bet and spin')
const messageTone = ref<'idle' | 'win' | 'bonus' | 'warn'>('idle')

const inFreeSpins = ref(false)
const fsSpin = ref(0)
const fsTotalSpins = ref(0)
const fsTotal = ref(0)
const stickyHud = ref<TphStickyWild[]>([])
/** Best multiplier a single way can reach now: the biggest sticky wild on each reel, added up. */
const topWayMult = computed(() => {
  const best = new Map<number, number>()
  for (const w of stickyHud.value) best.set(w.col, Math.max(best.get(w.col) ?? 0, w.mult))
  return [...best.values()].reduce((a, m) => a + m, 0)
})
const stickyChips = computed(() => {
  const counts = new Map<number, number>()
  for (const w of stickyHud.value) counts.set(w.mult, (counts.get(w.mult) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([mult, count]) => ({ mult, count, color: TPH_WILD_COLORS[mult as TphWildMult] }))
})

const card = reactive({ show: false, kind: 'fs' as 'fs' | 'fs-end' | 'dive' | 'retrigger', title: '', sub: '', amount: 0 })
const dive = reactive({ show: false, data: null as TrashPandaResult['dive'], bet: 0, payout: 0 })
const diveRef = ref<InstanceType<typeof TphDive> | null>(null)
let diveResolve: (() => void) | null = null

const bigWin = reactive({ show: false, label: '', tier: 0, amount: 0, multiple: 0 })

const autoplay = useSlotAutoplay()

function say(text: string, tone: typeof messageTone.value = 'idle') {
  message.value = text
  messageTone.value = tone
}

const BIG_TIERS = [
  { threshold: 15, label: 'BIG WIN' },
  { threshold: 40, label: 'MEGA WIN' },
  { threshold: 100, label: 'EPIC WIN' },
  { threshold: 400, label: 'MASTER HEIST' },
  { threshold: 1000, label: 'LEGENDARY!' }
] as const

function tierFor(multiple: number) {
  let t = -1
  BIG_TIERS.forEach((tier, i) => { if (multiple >= tier.threshold) t = i })
  return t
}

// --- geometry -----------------------------------------------------------------
const CELL = 120
const GAP = 8
const PAD_X = 18
const PAD_Y = 14
const REEL_W = TPH_COLS * CELL + (TPH_COLS - 1) * GAP
const REEL_H = TPH_ROWS * CELL + (TPH_ROWS - 1) * GAP
const APP_W = REEL_W + PAD_X * 2
const APP_H = REEL_H + PAD_Y * 2

function cellCenter(c: Cell) {
  return { x: PAD_X + c.col * (CELL + GAP) + CELL / 2, y: PAD_Y + c.row * (CELL + GAP) + CELL / 2 }
}

function hex(color: string) {
  return Number.parseInt(color.slice(1), 16)
}

const REEL_IDS: TphReelId[] = [
  ...(Object.keys(TPH_SYMBOLS) as TphSymbol[]),
  ...TPH_WILD_MULTS.map(m => `wild${m}` as TphReelId)
]

const INITIAL_GRID: TphSymbol[][] = [
  ['pizza', 'boss', 'can', 'bin'],
  ['donut', 'wild', 'gem', 'fish'],
  ['boss', 'apple', 'safe', 'banana'],
  ['cash', 'boss', 'bag', 'pizza'],
  ['gem', 'can', 'donut', 'boss']
]

// --- pixi (non-reactive on purpose; Vue proxies break PixiJS objects) ---------
type PixiModule = typeof import('pixi.js')
type ReelsModule = typeof import('pixi-reels')
type Gsap = typeof import('gsap').gsap

const canvasWrap = ref<HTMLDivElement>()
let PIXI: PixiModule | null = null
let REELS: ReelsModule | null = null
let GSAP: Gsap | null = null
let app: import('pixi.js').Application | null = null
let reelSet: any = null
let fx: XenoFx | null = null
let symbolTex: TphSymbolTextures | null = null
let stageRoot: Container | null = null
let lineLayer: Container | null = null
let anticLayer: Container | null = null
let floatLayer: Container | null = null
let dimLayer: Graphics | null = null
let backdrop: Sprite | null = null
const ownedTextures: Texture[] = []
let resizeObs: ResizeObserver | null = null
let currentRes = 1
let reelsMoving = false
let destroyed = false

function renderResolution(): number {
  const dpr = window.devicePixelRatio || 1
  const cssW = canvasWrap.value?.clientWidth || APP_W
  // Match device pixels and never go below them; supersample standard
  // screens a little so the ink outlines stay crisp.
  let r = dpr * cssW / APP_W
  if (dpr < 1.5) r *= 1.25
  return Math.max(Math.min(dpr, 1), Math.min(3, r))
}

function texFrom(canvas: HTMLCanvasElement): Texture {
  const t = PIXI!.Texture.from(canvas)
  ownedTextures.push(t)
  return t
}

onMounted(async () => {
  window.addEventListener('pointerdown', onFirstGesture, { once: true })
  try {
    turbo.value = localStorage.getItem('trashpanda-turbo') === 'true'
  } catch { /* storage blocked */ }
  try {
    const [pixi, reels, gsapMod] = await Promise.all([
      import('pixi.js'),
      import('pixi-reels'),
      import('gsap'),
      loadTphFonts()
    ])
    if (destroyed) return
    PIXI = pixi
    REELS = reels
    GSAP = gsapMod.gsap ?? gsapMod.default

    heistArt.value = tphArtDataUrl('wild5', 160)
    diveArt.value = tphArtDataUrl('bin', 160)
    bossArt.value = tphArtDataUrl('boss', 200)

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
  const sharp = {} as Record<TphReelId, Texture>
  const blur = {} as Record<TphReelId, Texture>
  for (const id of REEL_IDS) {
    const c = paintTphArt(id, px)
    sharp[id] = texFrom(c)
    blur[id] = texFrom(tphMotionBlur(c))
  }
  symbolTex = { sharp, blur, glow: texFrom(tphGlowSprite(128)) }
}

function buildStage() {
  const P = PIXI!
  const R = REELS!
  const tex = symbolTex!
  const stage = app!.stage

  stageRoot = new P.Container()
  stageRoot.sortableChildren = true
  stage.addChild(stageRoot)

  backdrop = new P.Sprite(texFrom(paintTphReelBackdrop(APP_W, APP_H, Math.max(2, currentRes), TPH_COLS, i => PAD_X + i * (CELL + GAP), CELL, PAD_Y, REEL_H)))
  backdrop.width = APP_W
  backdrop.height = APP_H
  backdrop.zIndex = 0
  stageRoot.addChild(backdrop)

  const { TphReelSymbol } = makeTphSymbols({ PIXI: P, REELS: R, gsap: GSAP!, tex, reelsMoving: () => reelsMoving })

  // Filler weights while spinning: the base reel mix, without feature symbols
  // so blurred strips don't tease scatters that aren't there.
  const w = BASE_REEL_WEIGHTS[1]!
  const weights: Record<string, number> = {}
  for (const id of REEL_IDS) weights[id] = 0
  for (const id of Object.keys(w) as TphSymbol[]) weights[id] = id === 'safe' || id === 'bin' ? 0 : w[id]

  reelSet = new R.ReelSetBuilder()
    .reels(TPH_COLS).visibleRows(TPH_ROWS).symbolSize(CELL, CELL).symbolGap(GAP, GAP)
    .symbols((r: any) => {
      for (const id of REEL_IDS) r.register(id, TphReelSymbol, {})
    })
    .weights(weights)
    .speed('normal', { ...R.SpeedPresets.NORMAL, spinSpeed: 34, stopDelay: 150, bounceDistance: 28, bounceDuration: 360, anticipationDelay: 1400 })
    .speed('turbo', { ...R.SpeedPresets.TURBO, anticipationDelay: 650 })
    .initialFrame(INITIAL_GRID.map(col => ({ visible: col })))
    .ticker(app!.ticker)
    .build()
  reelSet.x = PAD_X
  reelSet.y = PAD_Y
  reelSet.zIndex = 10
  stageRoot.addChild(reelSet)
  reelSet.events.on('spin:reelLanded', onReelLanded)
  reelSet.events.on('pin:overlayCreated', (_pin: unknown, overlay: any) => overlay?.showSharp?.())

  anticLayer = new P.Container()
  anticLayer.zIndex = 15
  stageRoot.addChild(anticLayer)

  lineLayer = new P.Container()
  lineLayer.zIndex = 20
  lineLayer.eventMode = 'none'
  stageRoot.addChild(lineLayer)

  floatLayer = new P.Container()
  floatLayer.zIndex = 30
  floatLayer.eventMode = 'none'
  stageRoot.addChild(floatLayer)

  dimLayer = new P.Graphics()
  dimLayer.rect(-40, -40, APP_W + 80, APP_H + 80).fill({ color: 0x0a0618 })
  dimLayer.alpha = 0
  dimLayer.zIndex = 40
  stageRoot.addChild(dimLayer)

  const fxLayer = new P.Container()
  fxLayer.zIndex = 50
  fxLayer.eventMode = 'none'
  stageRoot.addChild(fxLayer)
  const coin = texFrom(tphCoinSprite(64))
  fx = new XenoFx(P, app!.ticker, fxLayer, { glow: tex.glow, spark: texFrom(tphSparkSprite(64)), coins: [coin, coin] }, APP_W, APP_H)
}

onUnmounted(() => {
  destroyed = true
  window.removeEventListener('pointerdown', onFirstGesture)
  resizeObs?.disconnect()
  stopAutoplay()
  requestSkip()
  diveResolve?.()
  sound.stopMusic()
  sound.stopEffects()
  meterTween?.kill()
  clearFrames()
  clearFloats()
  reelGlow(0, false)
  if (GSAP) {
    for (const target of [dimLayer, stageRoot, reelSet]) if (target) GSAP.killTweensOf(target)
  }
  safeDestroy(() => fx?.destroy())
  safeDestroy(() => reelSet?.destroy())
  safeDestroy(() => app?.destroy(true, { children: true }))
  for (const t of ownedTextures.splice(0)) safeDestroy(() => t.destroy(true))
  fx = null
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
    localStorage.setItem('trashpanda-turbo', String(turbo.value))
  } catch { /* storage blocked */ }
}

// --- timing -----------------------------------------------------------------
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

let meterTween: ReturnType<Gsap['to']> | null = null
function countWin(to: number, seconds: number): Promise<void> {
  meterTween?.kill()
  winPulse.value++
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
let safesSeen = 0
let binsSeen = 0
let roundGrid: TphSymbol[][] | null = null

function reelGlow(col: number, on: boolean, color = 0xfacc15) {
  if (!anticLayer || !PIXI || !GSAP) return
  for (const child of anticLayer.removeChildren()) {
    GSAP.killTweensOf(child)
    child.destroy()
  }
  if (!on) return
  const g = new PIXI.Graphics()
  const x = PAD_X + col * (CELL + GAP)
  g.roundRect(x - 8, PAD_Y - 8, CELL + 16, REEL_H + 16, 20).stroke({ color, width: 18, alpha: 0.22 })
  g.roundRect(x - 4, PAD_Y - 4, CELL + 8, REEL_H + 8, 17).stroke({ color, width: 6, alpha: 0.6 })
  g.roundRect(x - 2, PAD_Y - 2, CELL + 4, REEL_H + 4, 15).stroke({ color: 0xffffff, width: 2, alpha: 1 })
  g.roundRect(x, PAD_Y, CELL, REEL_H, 14).fill({ color, alpha: 0.16 })
  g.blendMode = 'add'
  anticLayer.addChild(g)
  GSAP.fromTo(g, { alpha: 0.4 }, { alpha: 1, duration: 0.22, yoyo: true, repeat: -1, ease: 'sine.inOut' })
  fx?.burst(x + CELL / 2, PAD_Y + REEL_H, { count: 18, kind: 'spark', speed: 380, cone: 0.6, colors: [color, 0xffffff], gravity: -80 })
}

function onReelLanded(reelIndex: number) {
  landedCount++
  sound.play('reel-stop', reelIndex)
  sound.setWhir((TPH_COLS - landedCount) / TPH_COLS)
  const col = roundGrid?.[reelIndex]
  if (col) {
    col.forEach((sym, row) => {
      const p = cellCenter({ col: reelIndex, row })
      if (sym === 'safe') {
        safesSeen++
        sound.play('scatter-land', Math.min(4, safesSeen), 0.02)
        fx?.ring(p.x, p.y, 0xfacc15, 80, 0.5, 5)
        fx?.burst(p.x, p.y, { count: 12, colors: [0xfde047, 0xffffff], speed: 240 })
      } else if (sym === 'bin' && !inFreeSpins.value) {
        sound.play('bin-land', binsSeen)
        fx?.ring(p.x, p.y, 0x4ade80, 70, 0.45, 4)
      }
    })
    if (!inFreeSpins.value && col.includes('bin') && (DIVE_REELS as readonly number[]).includes(reelIndex)) binsSeen++
  }
  reelGlow(reelIndex, false)
  const next = reelIndex + 1
  if (anticipation.includes(next)) {
    const binTease = next === 4 && binsSeen >= 2 && safesSeen < FS_TRIGGER - 1
    reelGlow(next, true, binTease ? 0x4ade80 : 0xfacc15)
    sound.play('anticipation')
    say(binTease ? 'Two dumpsters... one more!' : `${safesSeen} safes... one more!`, 'bonus')
  }
}

/** Reels that spin long: after the second safe, and reel 5 when reels 1 and 3 hold dumpsters. */
function anticipationReels(grid: TphSymbol[][], diveAllowed: boolean): number[] {
  const out = new Set<number>()
  let safes = 0
  for (let col = 0; col < grid.length; col++) {
    if (safes >= FS_TRIGGER - 1) out.add(col)
    safes += grid[col]!.filter(s => s === 'safe').length
  }
  if (diveAllowed && grid[0]!.includes('bin') && grid[2]!.includes('bin')) out.add(4)
  return [...out].sort((a, b) => a - b)
}

// --- win presentation ---------------------------------------------------------
function clearFrames() {
  if (!lineLayer) return
  for (const child of lineLayer.removeChildren()) {
    GSAP?.killTweensOf(child)
    child.destroy()
  }
}

function clearFloats() {
  if (!floatLayer) return
  for (const child of floatLayer.removeChildren()) {
    GSAP?.killTweensOf(child)
    child.destroy()
  }
}

function forEachView(fn: (view: Container, col: number, row: number) => void) {
  for (let col = 0; col < TPH_COLS; col++) {
    for (let row = 0; row < TPH_ROWS; row++) {
      const view = reelSet?.getReel(col)?.getSymbolAt(row)?.view
      if (view) fn(view, col, row)
    }
  }
}

function spotlight(cells: Cell[]) {
  const keep = new Set(cells.map(c => `${c.col}:${c.row}`))
  reelSet.spotlight.hide()
  forEachView((view, col, row) => { view.alpha = keep.has(`${col}:${row}`) ? 1 : 0.3 })
  void reelSet.spotlight.show(cells.map(c => ({ reelIndex: c.col, rowIndex: c.row })), { dimAmount: 0 })
}

function unspotlight() {
  reelSet?.spotlight?.hide()
  forEachView((view) => { view.alpha = 1 })
}

function drawFrames(cells: Cell[], color: number) {
  if (!PIXI || !lineLayer || !GSAP) return
  const g = new PIXI.Graphics()
  for (const c of cells) {
    const x = PAD_X + c.col * (CELL + GAP)
    const y = PAD_Y + c.row * (CELL + GAP)
    g.roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 16).stroke({ color, width: 10, alpha: 0.22 })
    g.roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 15).stroke({ color: 0x1a1030, width: 6, alpha: 0.9 })
    g.roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 15).stroke({ color, width: 3.5, alpha: 1 })
  }
  g.alpha = 0
  lineLayer.addChild(g)
  GSAP.to(g, { alpha: 1, duration: 0.18 })
}

function floatText(x: number, y: number, text: string, color = 0xfde047, size = 30) {
  if (!PIXI || !floatLayer || !GSAP) return
  const t = new PIXI.Text({
    text,
    style: {
      fontFamily: '"Lilita One", "Arial Black", sans-serif',
      fontSize: size,
      fill: color,
      stroke: { color: 0x1a1030, width: 7, join: 'round' },
      dropShadow: { color: 0x1a1030, alpha: 1, blur: 0, distance: 4, angle: Math.PI / 3 }
    }
  })
  t.anchor.set(0.5)
  t.position.set(x, y)
  floatLayer.addChild(t)
  GSAP.fromTo(t.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.6)' })
  GSAP.to(t, { y: y - 26, duration: 1.4, ease: 'power1.out' })
  GSAP.to(t, { alpha: 0, duration: 0.4, delay: 1.1, onComplete: () => t.destroy() })
}

/** Sticky wild multipliers by "col:row" while a free spin is being shown. */
let wayMults: Map<string, number> | null = null

/**
 * Multiplier range over the ways of a win. A way's multiplier is the sum of
 * the wilds it runs through, so the best way takes the biggest wild on each
 * reel and the weakest way takes a plain symbol wherever it can.
 */
function wayMultRange(w: TphWayWin): { min: number, max: number } | null {
  if (!wayMults || w.weight === w.ways) return null
  let min = 0
  let max = 0
  for (let col = 0; col < w.length; col++) {
    const mults = w.cells.filter(c => c.col === col).map(c => wayMults!.get(`${c.col}:${c.row}`) ?? 0)
    const wilds = mults.filter(m => m > 0)
    if (!wilds.length) continue
    max += Math.max(...wilds)
    if (wilds.length === mults.length) min += Math.min(...wilds)
  }
  return { min: Math.max(1, min), max: Math.max(1, max) }
}

function wayLabel(w: TphWayWin) {
  const range = wayMultRange(w)
  const boost = range ? ` · wilds ${range.min === range.max ? '' : 'up to '}×${range.max}` : ''
  return `${TPH_SYMBOLS[w.symbol].name} × ${w.length} · ${w.ways} ${w.ways === 1 ? 'way' : 'ways'}${boost} · ${formatNumber(w.amount)}`
}

/**
 * Show a set of ways wins: frame every winning cell, count the meter up by
 * `total` from `base`, then walk through each symbol on its own.
 */
async function presentWays(wins: TphWayWin[], total: number, theBet: number, base = 0, allowBigWin = true) {
  if (!wins.length || !reelSet) return
  const multiple = total / theBet
  const cells = new Map<string, Cell>()
  for (const w of wins) for (const c of w.cells) cells.set(`${c.col}:${c.row}`, c)
  const cellList = [...cells.values()]

  winning.value = true
  spotlight(cellList)
  drawFrames(cellList, 0xfde047)
  for (const c of cellList) {
    const p = cellCenter(c)
    fx?.burst(p.x, p.y, { count: multiple >= 5 ? 12 : 6, colors: [0xfde047, 0xffffff, 0x86efac], speed: 220 })
  }
  say(wins.length > 1 ? `${wins.length} symbols win ${formatNumber(total)}` : wayLabel(wins[0]!), 'win')

  const tier = tierFor(multiple)
  if (allowBigWin && tier >= 0) {
    sound.play('win-big')
    await delay(600)
    await showBigWin(total, multiple, base)
  } else {
    sound.play(multiple >= 5 ? 'win-big' : multiple >= 1.5 ? 'win-medium' : 'win-small')
    if (multiple >= 5) fx?.shake(stageRoot!, 5, 0.35)
    await countWin(base + total, multiple >= 5 ? 1.4 : multiple >= 1.5 ? 0.9 : 0.5)
  }
  await delay(inFreeSpins.value ? 450 : 650)

  if (wins.length > 1 && !turbo.value && !autoplay.active && !skipping) {
    for (const [i, w] of wins.entries()) {
      if (skipping || destroyed) break
      clearFrames()
      spotlight(w.cells)
      drawFrames(w.cells, hex(TPH_SYMBOLS[w.symbol].color))
      sound.play('way-show', i)
      const mid = w.cells.find(c => c.col === Math.floor((w.length - 1) / 2)) ?? w.cells[0]!
      const p = cellCenter(mid)
      floatText(p.x, p.y, `+${formatNumber(w.amount)}`)
      say(wayLabel(w), 'win')
      await delay(inFreeSpins.value ? 700 : 950)
    }
  }
  unspotlight()
  clearFrames()
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
  GSAP.to(dimLayer, { alpha: 0.7, duration: 0.3 })
  fx.fountain(14)
  sound.play('tier-up', 0)
  fx.ring(APP_W / 2, APP_H / 2, 0xfacc15, 380, 0.8, 10)

  const seconds = (2.2 + top * 1.4) * (turbo.value ? 0.6 : 1)
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
          fx!.ring(APP_W / 2, APP_H / 2, [0xfacc15, 0x4ade80, 0x38bdf8, 0xe879f9, 0xfb7185][t]!, 420, 0.9, 12)
          fx!.burst(APP_W / 2, APP_H / 2, { count: 40 + t * 18, kind: 'mix', speed: 520 + t * 80, colors: [0xfde047, 0xffffff, 0x4ade80] })
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
  winPulse.value++
  sound.play('bigwin-end')
  fx.burst(APP_W / 2, APP_H / 2, { count: 70, kind: 'mix', speed: 640, colors: [0xfde047, 0xffffff] })
  skipping = false
  await delay(2000)
  fx.fountain(0)
  bigWin.show = false
  GSAP.to(dimLayer, { alpha: 0, duration: 0.35 })
  await delay(250)
}

async function showCard(kind: typeof card.kind, title: string, sub: string, amount: number, ms: number) {
  skipping = false
  card.kind = kind
  card.title = title
  card.sub = sub
  card.amount = amount
  card.show = true
  if (dimLayer) void tween(dimLayer, { alpha: 0.6, duration: 0.3 })
  await delay(ms)
  card.show = false
  if (dimLayer) void tween(dimLayer, { alpha: 0, duration: 0.3 })
  await delay(250)
  skipping = false
}

// --- spin flow -----------------------------------------------------------------
let reelSpin: Promise<unknown> | null = null
let resultSet = false

function resetRound() {
  winMeter.value = 0
  winning.value = false
  landedCount = 0
  safesSeen = 0
  binsSeen = 0
  anticipation = []
  roundGrid = null
  errorMsg.value = ''
  meterTween?.kill()
  clearFrames()
  clearFloats()
  unspotlight()
}

/** Spin the reels to `grid` locally (free spins: no server call). */
async function spinTo(grid: TphSymbol[][], display: string[][], diveAllowed: boolean) {
  landedCount = 0
  safesSeen = 0
  binsSeen = 0
  roundGrid = grid
  reelsMoving = true
  sound.startWhir()
  reelSet.setSpeed(turbo.value ? 'turbo' : 'normal')
  reelSpin = reelSet.spin()
  anticipation = anticipationReels(grid, diveAllowed)
  await delay(120)
  reelSet.setResult(display.map(col => ({ visible: col })))
  reelSet.setAnticipation(anticipation)
  resultSet = true
  await reelSpin
  resultSet = false
  reelsMoving = false
  sound.stopWhir()
  reelGlow(0, false)
}

async function spin(feature: Feature | null = null) {
  if (!ready.value || phase.value !== 'idle' || !reelSet) return
  sound.unlock()
  sound.startMusic()
  const cost = feature === 'buyFreeSpins' ? bet.value * TPH_BUY_FREE_SPINS_COST : feature === 'buyDive' ? bet.value * TPH_BUY_DIVE_COST : bet.value
  if (balance.value < cost) {
    say('Not enough coins for this bet', 'warn')
    sound.play('error')
    stopAutoplay()
    return
  }
  const balanceBefore = balance.value
  let debited = false
  skipping = false

  const data = await requestSpin(cost, feature ? { feature } : undefined, () => {
    phase.value = 'spinning'
    debited = true
    setBalance(balanceBefore - cost)
    resetRound()
    sound.play(feature ? 'buy-bonus' : 'spin-start')
    sound.startWhir()
    say(feature === 'buyFreeSpins' ? 'Cracking the safe...' : feature === 'buyDive' ? 'Lifting the lid...' : 'Good luck!')
    reelsMoving = true
    reelSet.setSpeed(turbo.value ? 'turbo' : 'normal')
    reelSpin = reelSet.spin()
  })

  if (!data) {
    if (debited) {
      setBalance(balanceBefore)
      reelSet.setResult(reelSet.getVisibleGrid().map((col: string[]) => ({ visible: col })))
      await reelSpin
      reelsMoving = false
      sound.stopWhir()
      say(errorMsg.value || 'Spin failed', 'warn')
      phase.value = 'idle'
      stopAutoplay()
      void fetchSession()
    }
    return
  }

  const result = data.gameData
  try {
    roundGrid = result.grid
    anticipation = anticipationReels(result.grid, true)
    reelSet.setResult(result.grid.map((col: TphSymbol[]) => ({ visible: col })))
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

    const hasFeature = Boolean(result.dive || result.freeSpins)
    if (result.wins.length) {
      await presentWays(result.wins, result.basePayout, result.bet, 0, !hasFeature)
    } else if (!hasFeature) {
      say(autoplay.active ? `Autoplay · ${autoplay.left} left` : 'Nothing in the bins. Spin again')
    }

    if (hasFeature && !destroyed) {
      phase.value = 'bonus'
      autoplay.bonusHit()
      if (result.dive) await playDive(result)
      if (result.freeSpins && !destroyed) await playFreeSpins(result)
      const multiple = result.payout / result.bet
      winMeter.value = result.payout
      if (tierFor(multiple) >= 0 && !destroyed) await showBigWin(result.payout, multiple)
    }

    winMeter.value = result.payout
    setBalance(data.balance)
    pushHistory({ payout: result.payout, bet: result.cost, bonus: result.bonusTriggered || result.feature !== null })
    if (result.payout > 0) say(`You won ${formatNumber(result.payout)}`, 'win')
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
    inFreeSpins.value = false
    dive.show = false
    wayMults = null
    void fetchSession()
  }

  if (destroyed) return
  continueAutoplay(result)
}

/** Space / spin button while busy: quick-stop the reels or hurry the presentation. */
function hurry() {
  if (dive.show) {
    diveRef.value?.hurry()
    return
  }
  if ((phase.value === 'spinning' || inFreeSpins.value) && resultSet && reelSet?.isSpinning) {
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
  void spin()
}

// --- Dumpster Dive -----------------------------------------------------------------
async function playDive(result: TrashPandaResult) {
  const d = result.dive!
  skipping = false
  say('Three dumpsters. Time for a Dumpster Dive!', 'bonus')
  sound.play('dive-trigger')
  spotlight(result.bins)
  for (const c of result.bins) {
    const p = cellCenter(c)
    fx?.ring(p.x, p.y, 0x4ade80, 140, 0.7, 7)
    fx?.burst(p.x, p.y, { count: 24, kind: 'mix', colors: [0x86efac, 0xfde047, 0xffffff], speed: 320 })
  }
  fx?.shake(stageRoot!, 6, 0.5)
  await delay(1300)
  unspotlight()
  await showCard('dive', 'DUMPSTER DIVE', 'Pick trash cans for cash. Two guard dogs are hiding in there.', 0, 2200)

  const before = winMeter.value
  diveBase = before
  dive.data = d
  dive.bet = result.bet
  dive.payout = result.divePayout
  dive.show = true
  await new Promise<void>((resolve) => { diveResolve = resolve })
  diveResolve = null
  dive.show = false
  if (destroyed) return
  skipping = false
  await countWin(before + result.divePayout, 0.8)
  say(result.divePayout > 0 ? `The dive paid ${formatNumber(result.divePayout)}` : 'The dog got you straight away', result.divePayout > 0 ? 'win' : 'idle')
  await delay(500)
}

let diveBase = 0

function onDivePot(pot: number) {
  winMeter.value = diveBase + Math.min(pot * dive.bet, dive.payout)
  winPulse.value++
}

function onDiveDone() {
  diveResolve?.()
}

function onDiveShake() {
  if (stageRoot) fx?.shake(stageRoot, 8, 0.5)
}

// --- Night Heist free spins ---------------------------------------------------------
function displayGrid(spin: TphFreeSpin): string[][] {
  const mults = new Map(spin.sticky.map(w => [`${w.col}:${w.row}`, w.mult]))
  return spin.grid.map((col, c) => col.map((sym, r) => {
    const m = mults.get(`${c}:${r}`)
    return m ? `wild${m}` : sym
  }))
}

async function playFreeSpins(result: TrashPandaResult) {
  const fs = result.freeSpins!
  if (!reelSet) return
  skipping = false
  if (fs.source === 'key') {
    say('The golden key opens the vault!', 'bonus')
  } else {
    say(`${result.scatters.length} safes. Night Heist!`, 'bonus')
    sound.play('fs-trigger')
    spotlight(result.scatters)
    for (const c of result.scatters) {
      const p = cellCenter(c)
      fx?.ring(p.x, p.y, 0xfacc15, 150, 0.8, 8)
      fx?.burst(p.x, p.y, { count: 28, kind: 'mix', colors: [0xfde047, 0xffffff], speed: 360 })
    }
    fx?.shake(stageRoot!, 7, 0.6)
    await delay(1500)
    unspotlight()
  }
  if (fs.source === 'key') sound.play('fs-trigger')

  inFreeSpins.value = true
  fsSpin.value = 0
  fsTotalSpins.value = fs.awarded
  fsTotal.value = 0
  stickyHud.value = []
  sound.setBonusMusic(true)
  await showCard('fs', 'NIGHT HEIST', `${fs.awarded} free spins. Every wild sticks with a multiplier, and multipliers add up.`, 0, 2600)

  const before = winMeter.value
  const pinned: TphStickyWild[] = []
  try {
    for (const spin of fs.spins) {
      if (destroyed) return
      skipping = false
      fsSpin.value = spin.index + 1
      say(`Free spin ${spin.index + 1} of ${fsTotalSpins.value}`, 'bonus')
      sound.play('fs-spin')
      await spinTo(spin.grid, displayGrid(spin), false)
      if (destroyed) return

      if (spin.newWilds.length) {
        for (const w of spin.newWilds) {
          reelSet.pin(w.col, w.row, `wild${w.mult}`, { turns: 'permanent' })
          pinned.push(w)
          const sym = reelSet.getReel(w.col)?.getSymbolAt(w.row) as any
          sym?.pop?.(0.4)
          const p = cellCenter(w)
          sound.play('wild-stick', w.mult)
          fx?.ring(p.x, p.y, hex(TPH_WILD_COLORS[w.mult as TphWildMult]), 90, 0.5, 6)
          fx?.burst(p.x, p.y, { count: 16, colors: [hex(TPH_WILD_COLORS[w.mult as TphWildMult]), 0xffffff], speed: 260 })
          floatText(p.x, p.y - 30, `×${w.mult}`, hex(TPH_WILD_COLORS[w.mult as TphWildMult]), 34)
          await delay(260)
        }
        stickyHud.value = spin.sticky.map(w => ({ ...w }))
        say(`Wild sticks! Best way now ×${topWayMult.value}`, 'bonus')
        await delay(300)
      }

      if (spin.wins.length) {
        wayMults = new Map(spin.sticky.map(w => [`${w.col}:${w.row}`, w.mult]))
        await presentWays(spin.wins, spin.win, result.bet, before + fsTotal.value, false)
        wayMults = null
      }
      fsTotal.value = spin.runningTotal
      winMeter.value = before + fsTotal.value

      if (spin.retrigger > 0) {
        fsTotalSpins.value = spin.totalSpins
        sound.play('retrigger')
        spotlight(spin.scatters)
        await showCard('retrigger', `+${spin.retrigger} SPINS`, 'More safes. The heist goes on.', 0, 1600)
        unspotlight()
      }
      await delay(spin.wins.length ? 200 : 420)
    }
  } finally {
    for (const w of pinned) safeDestroy(() => reelSet?.unpin(w.col, w.row))
  }
  if (destroyed) return

  sound.setBonusMusic(false)
  sound.play('fs-end')
  if (fs.total > 0) fx?.burst(APP_W / 2, APP_H / 2, { count: 60, kind: 'mix', speed: 520, colors: [0xfde047, 0xffffff, 0x86efac] })
  await showCard('fs-end', fs.capped ? 'MAX WIN!' : 'HEIST COMPLETE', fs.total > 0 ? `${fsTotalSpins.value} spins, ${stickyHud.value.length} sticky wilds` : 'The vault was empty this time', fs.total, 2600)
  inFreeSpins.value = false
  stickyHud.value = []
  say(fs.total > 0 ? `Night Heist paid ${formatNumber(fs.total)}` : 'The vault was empty', fs.total > 0 ? 'win' : 'idle')
}

// --- autoplay ----------------------------------------------------------------------
function startAutoplay(settings: SlotAutoSettings) {
  autoplay.start(settings, balance.value)
  sound.play('click')
  if (phase.value === 'idle') void spin()
}

function stopAutoplay() {
  autoplay.stop()
}

function continueAutoplay(result: TrashPandaResult) {
  if (!autoplay.active) return
  if (!autoplay.finish({ payout: result.payout, bet: result.bet, bonus: result.bonusTriggered }, balance.value, bet.value)) {
    if (balance.value < bet.value) say('Autoplay stopped: balance too low', 'warn')
    return
  }
  setTimeout(() => {
    if (!destroyed && autoplay.active) void spin()
  }, turbo.value ? 150 : 350)
}

function buyBonus(id: string) {
  if (phase.value !== 'idle' || autoplay.active) return
  if (id === 'buyFreeSpins' || id === 'buyDive') void spin(id)
}

// --- template helpers ---------------------------------------------------------------
const canSpin = computed(() => ready.value && balance.value >= bet.value)
const spinMode = computed<SlotSpinMode>(() => {
  if (phase.value === 'spinning') return 'stop'
  if (phase.value !== 'idle') return 'skip'
  return 'spin'
})

// Night skyline: building widths/heights and lit windows (cosmetic).
const skyline = (() => {
  let seed = 7
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const out: { x: number, w: number, h: number, windows: { x: number, y: number, on: boolean }[] }[] = []
  let x = 0
  while (x < 1600) {
    const w = 60 + Math.floor(rnd() * 90)
    const h = 120 + Math.floor(rnd() * 260)
    const windows: { x: number, y: number, on: boolean }[] = []
    for (let wy = 400 - h + 16; wy < 380; wy += 22) {
      for (let wx = x + 10; wx < x + w - 14; wx += 18) windows.push({ x: wx, y: wy, on: rnd() < 0.28 })
    }
    out.push({ x, w, h, windows })
    x += w + 4 + Math.floor(rnd() * 14)
  }
  return out
})()
</script>

<template>
  <div class="tph-page" :class="{ 'is-bonus': inFreeSpins, 'is-dive': dive.show }">
    <div class="tph-sky" aria-hidden="true">
      <div class="tph-sky__moon" />
      <div class="tph-sky__beam tph-sky__beam--a" />
      <div class="tph-sky__beam tph-sky__beam--b" />
      <svg class="tph-sky__city" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMax slice">
        <g v-for="(b, i) in skyline" :key="i">
          <rect :x="b.x" :y="400 - b.h" :width="b.w" :height="b.h" fill="#120b29" />
          <rect v-for="(win, j) in b.windows" :key="j" :x="win.x" :y="win.y" width="8" height="11" rx="1" :fill="win.on ? '#fcd34d' : '#1d1540'" :opacity="win.on ? 0.75 : 1" />
        </g>
      </svg>
    </div>

    <div class="tph-stage">
      <div class="tph-cabinet">
        <div class="tph-tape" aria-hidden="true">
          <div class="tph-tape__track">
            <span v-for="i in 12" :key="i">POLICE LINE · DO NOT CROSS</span>
          </div>
        </div>

        <header class="tph-marquee">
          <div class="tph-logo">
            <img v-if="bossArt" :src="bossArt" alt="" class="tph-logo__boss">
            <div class="tph-logo__text">
              <h1 class="tph-logo__word">
                Trash Panda
              </h1>
              <span class="tph-logo__stamp">Heist</span>
            </div>
          </div>

          <Transition name="tph-fade" mode="out-in">
            <div v-if="inFreeSpins" key="hud" class="tph-hud">
              <div class="tph-hud__block">
                <span class="tph-hud__label">Free spin</span>
                <span class="tph-hud__value">{{ fsSpin }} / {{ fsTotalSpins }}</span>
              </div>
              <div class="tph-hud__block tph-hud__block--wilds">
                <span class="tph-hud__label">Sticky wilds</span>
                <span class="tph-hud__chips">
                  <span v-if="!stickyChips.length" class="tph-hud__none">none yet</span>
                  <span v-for="c in stickyChips" :key="c.mult" class="tph-hud__chip" :style="{ '--c': c.color }">
                    ×{{ c.mult }}<small v-if="c.count > 1" class="tph-hud__count">{{ c.count }}</small>
                  </span>
                  <span v-if="stickyChips.length" class="tph-hud__sum" title="Best way multiplier">best<span class="tph-hud__sum-way"> way</span> ×{{ topWayMult }}</span>
                </span>
              </div>
              <div class="tph-hud__block">
                <span class="tph-hud__label">Heist total</span>
                <span class="tph-hud__value tph-hud__value--gold">{{ formatNumber(fsTotal) }}</span>
              </div>
            </div>
            <div v-else key="badges" class="tph-badges">
              <span class="tph-badge">{{ formatNumber(TPH_WAYS, false) }} ways</span>
              <span class="tph-badge tph-badge--hot">Night Heist</span>
              <span class="tph-badge tph-badge--green">Dumpster Dive</span>
              <span class="tph-badge">RTP {{ (TPH_STATS.rtp * 100).toFixed(1) }}%</span>
              <span class="tph-badge tph-badge--max">Max {{ formatNumber(TPH_MAX_WIN_MULT, false) }}×</span>
            </div>
          </Transition>
        </header>

        <div class="tph-window" :data-winning="winning">
          <div class="tph-window__inner">
            <div ref="canvasWrap" class="tph-canvas" />

            <div v-if="!ready && !loadError" class="tph-overlay">
              <UIcon class="size-10 animate-spin" name="i-lucide-loader-circle" />
            </div>
            <div v-if="loadError" class="tph-overlay">
              <p class="tph-card__sub">
                {{ loadError }}
              </p>
            </div>

            <TphDive
              v-if="dive.show && dive.data"
              ref="diveRef"
              :dive="dive.data"
              :bet="dive.bet"
              :payout="dive.payout"
              :auto="autoplay.active"
              :turbo="turbo"
              :play="sound.play"
              @done="onDiveDone"
              @shake="onDiveShake"
              @pot="onDivePot"
            />

            <Transition name="tph-pop">
              <div v-if="card.show" class="tph-overlay" @click="requestSkip">
                <div class="tph-card" :class="`is-${card.kind}`">
                  <img v-if="card.kind === 'fs' && heistArt" :src="heistArt" alt="" class="tph-card__art">
                  <img v-else-if="card.kind === 'dive' && diveArt" :src="diveArt" alt="" class="tph-card__art">
                  <p class="tph-card__title">
                    {{ card.title }}
                  </p>
                  <p v-if="card.kind === 'fs-end'" class="tph-card__amount" :class="{ 'is-zero': card.amount <= 0 }">
                    {{ formatNumber(card.amount) }}
                  </p>
                  <p class="tph-card__sub">
                    {{ card.sub }}
                  </p>
                </div>
              </div>
            </Transition>

            <Transition name="tph-pop">
              <TphBigWin
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

        <div class="tph-ticker" :class="`is-${messageTone}`" role="status">
          <Transition name="tph-fade" mode="out-in">
            <span :key="message">{{ message }}</span>
          </Transition>
        </div>

        <SlotControlBar
          v-model:sound-on="soundEnabled"
          v-model:volume="soundVolume"
          v-model:music-volume="musicVolume"
          class="tph-bar"
          :theme="TRASH_BAR_THEME"
          :balance="balance"
          :bet="bet"
          :bet-min="MIN_BET"
          :bet-max="MAX_BET"
          :bet-locked="betLocked"
          :bet-hint="`${formatNumber(TPH_WAYS, false)} ways`"
          :win="winMeter"
          :win-label="inFreeSpins ? 'Heist win' : dive.show ? 'Dive win' : 'Win'"
          :win-pulse="winPulse"
          :spin-mode="spinMode"
          :spin-disabled="!canSpin"
          :auto-left="autoplay.left"
          :auto-disabled="!canSpin || phase !== 'idle'"
          :turbo="turbo"
          :buys="buyOptions"
          :buy-disabled="!ready || phase !== 'idle' || autoplay.active"
          :space-blocked="showHelp"
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

        <Transition name="tph-fade">
          <div v-if="errorMsg" class="tph-error">
            <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0" />
            <span class="flex-1">{{ errorMsg }}</span>
            <button aria-label="Dismiss" @click="errorMsg = ''">
              <UIcon name="i-lucide-x" class="size-4" />
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <div v-if="history.length" class="tph-history">
      <span class="tph-history__label">Last rounds</span>
      <span
        v-for="(h, i) in history"
        :key="i"
        class="tph-history__chip"
        :class="{ 'is-win': h.payout > h.bet, 'is-bonus': h.bonus }"
      >
        <UIcon v-if="h.bonus" name="i-lucide-vault" class="size-3" />
        {{ h.payout > 0 ? formatNumber(h.payout) : '–' }}
      </span>
    </div>

    <TphPaytable v-model:open="showHelp" :bet="bet" />
  </div>
</template>

<style scoped>
/* ── Page & night city ─────────────────────────────────────────────────── */
.tph-page {
  --tph-ink: #1a1030;
  --tph-gold: #facc15;
  --tph-green: #4ade80;
  --tph-text: #f5f3ff;
  position: relative;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 12px 28px;
  overflow: hidden;
  isolation: isolate;
  color: var(--tph-text);
  font-family: 'Fredoka', system-ui, sans-serif;
  background: #0b0720;
}

.tph-sky {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(ellipse 70% 45% at 50% -10%, rgba(99, 102, 241, 0.35), transparent 70%),
    radial-gradient(circle at 85% 12%, rgba(250, 204, 21, 0.12), transparent 30%),
    linear-gradient(180deg, #151036 0%, #0e0a26 55%, #0a0618 100%);
  transition: filter 0.8s;
}

.is-bonus .tph-sky { filter: hue-rotate(-25deg) saturate(1.3) brightness(1.15); }

.tph-sky__moon {
  position: absolute;
  right: 9%;
  top: 36px;
  width: 92px;
  height: 92px;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 35%, #fffbe6, #fde68a 55%, #f59e0b);
  box-shadow: 0 0 60px rgba(253, 230, 138, 0.45), 0 0 140px rgba(253, 230, 138, 0.2);
}

.tph-sky__moon::after {
  content: '';
  position: absolute;
  inset: 22% 18% 40% 50%;
  border-radius: 50%;
  background: rgba(217, 119, 6, 0.18);
  box-shadow: -34px 26px 0 -6px rgba(217, 119, 6, 0.15);
}

.tph-sky__beam {
  position: absolute;
  bottom: 0;
  width: 160px;
  height: 120%;
  transform-origin: 50% 100%;
  background: linear-gradient(0deg, rgba(186, 230, 253, 0.2), rgba(186, 230, 253, 0) 85%);
  clip-path: polygon(46% 100%, 54% 100%, 100% 0, 0 0);
  filter: blur(2px);
}

.tph-sky__beam--a { left: 12%; animation: tph-sweep 9s ease-in-out infinite; }
.tph-sky__beam--b { right: 18%; animation: tph-sweep 11s ease-in-out infinite reverse; }

.is-bonus .tph-sky__beam { background: linear-gradient(0deg, rgba(248, 113, 113, 0.28), rgba(96, 165, 250, 0) 85%); }

@keyframes tph-sweep {
  0%, 100% { transform: rotate(-22deg); }
  50% { transform: rotate(18deg); }
}

.tph-sky__city {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 46%;
}

/* ── Stage & cabinet ───────────────────────────────────────────────────── */
.tph-stage {
  position: relative;
  width: 100%;
  max-width: 780px;
}

.tph-cabinet {
  position: relative;
  padding: 26px 16px 16px;
  border-radius: 28px;
  border: 4px solid var(--tph-ink);
  background:
    radial-gradient(ellipse 90% 40% at 50% 0%, rgba(250, 204, 21, 0.16), transparent 70%),
    linear-gradient(180deg, #2a1d57 0%, #1c1340 45%, #140d30 100%);
  box-shadow:
    0 0 0 3px #3b2a78,
    0 0 0 7px var(--tph-ink),
    0 26px 60px rgba(0, 0, 0, 0.6),
    0 0 60px rgba(99, 102, 241, 0.3);
  container-type: inline-size;
  container-name: tph-cab;
  transition: box-shadow 0.6s;
}

.is-bonus .tph-cabinet {
  box-shadow:
    0 0 0 3px #b45309,
    0 0 0 7px var(--tph-ink),
    0 26px 60px rgba(0, 0, 0, 0.6),
    0 0 80px rgba(250, 204, 21, 0.45);
}

.tph-tape {
  position: absolute;
  left: -14px;
  right: -14px;
  top: 2px;
  height: 22px;
  overflow: hidden;
  transform: rotate(-1.2deg);
  background: #facc15;
  border-top: 2px solid var(--tph-ink);
  border-bottom: 2px solid var(--tph-ink);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
}

/* One plain yellow tape; the text scrolls as a single track. The copies are
   duplicated, so sliding by half its width loops without a seam. */
.tph-tape__track {
  display: flex;
  width: max-content;
  height: 100%;
  align-items: center;
  animation: tph-tape 40s linear infinite;
}

.tph-tape span {
  flex-shrink: 0;
  padding: 0 14px;
  font-family: 'Bangers', sans-serif;
  font-size: 14px;
  letter-spacing: 0.14em;
  color: var(--tph-ink);
}

.tph-tape span::after {
  content: '★';
  margin-left: 28px;
  font-size: 11px;
}

@keyframes tph-tape {
  to { transform: translateX(-50%); }
}

/* ── Marquee ───────────────────────────────────────────────────────────── */
.tph-marquee {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 6px 10px;
}

.tph-logo {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
}

.tph-logo__boss {
  width: clamp(54px, 11cqw, 78px);
  height: auto;
  filter: drop-shadow(0 4px 0 rgba(0, 0, 0, 0.35));
  animation: tph-bob 3s ease-in-out infinite;
}

.tph-logo__text {
  position: relative;
  display: flex;
  align-items: center;
}

.tph-logo__word {
  font-family: 'Bangers', 'Arial Black', sans-serif;
  font-size: clamp(34px, 8cqw, 60px);
  line-height: 1;
  letter-spacing: 0.04em;
  color: #fde047;
  background: linear-gradient(180deg, #ffffff 0%, #fef08a 30%, #facc15 60%, #f59e0b 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  -webkit-text-stroke: 3px var(--tph-ink);
  paint-order: stroke fill;
  filter: drop-shadow(4px 5px 0 var(--tph-ink));
  transform: rotate(-2deg);
}

.tph-logo__stamp {
  margin-left: 10px;
  padding: 2px 10px 0;
  font-family: 'Bangers', sans-serif;
  font-size: clamp(20px, 4.4cqw, 32px);
  letter-spacing: 0.12em;
  color: #fff;
  background: #dc2626;
  border: 3px solid var(--tph-ink);
  border-radius: 8px;
  box-shadow: 3px 4px 0 var(--tph-ink);
  transform: rotate(6deg);
}

@keyframes tph-bob {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50% { transform: translateY(-4px) rotate(3deg); }
}

.tph-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  row-gap: 4px;
  min-height: 44px;
  align-content: center;
}

.tph-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(221, 214, 254, 0.62);
}

.tph-badge + .tph-badge::before {
  content: '';
  width: 4px;
  height: 4px;
  margin: 0 11px;
  border-radius: 50%;
  background: rgba(250, 204, 21, 0.5);
}

.tph-badge--hot { color: #fde047; }
.tph-badge--green { color: #86efac; }

.tph-hud {
  display: flex;
  gap: 10px;
  align-items: stretch;
  min-height: 44px;
}

.tph-hud__block {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 3px 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.35);
  border: 2px solid rgba(250, 204, 21, 0.3);
}

.tph-hud__label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #c4b5fd;
}

.tph-hud__value {
  font-family: 'Lilita One', sans-serif;
  font-size: 18px;
  line-height: 1.1;
  color: #fff;
}

.tph-hud__value--gold { color: #fde047; }

.tph-hud__chips {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 22px;
}

.tph-hud__chip {
  padding: 0 6px;
  border-radius: 999px;
  font-family: 'Lilita One', sans-serif;
  font-size: 14px;
  color: #fff;
  background: var(--c);
  border: 2px solid var(--tph-ink);
  box-shadow: 0 0 10px color-mix(in srgb, var(--c) 60%, transparent);
  animation: tph-chip 0.4s cubic-bezier(0.2, 1.8, 0.4, 1);
}

.tph-hud__chip { position: relative; }

.tph-hud__count {
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 13px;
  text-align: center;
  color: var(--tph-ink);
  background: #fff;
  border: 1.5px solid var(--tph-ink);
}
.tph-hud__sum { font-family: 'Lilita One', sans-serif; font-size: 16px; color: #fde047; margin-left: 2px; }
.tph-hud__none { font-size: 12px; color: #8f88b8; }

@keyframes tph-chip {
  from { transform: scale(0.3); }
  to { transform: scale(1); }
}

/* ── Reel window ───────────────────────────────────────────────────────── */
.tph-window {
  position: relative;
  padding: 6px;
  border-radius: 22px;
  background: linear-gradient(180deg, #fde047, #b45309 50%, #facc15);
  border: 3px solid var(--tph-ink);
  box-shadow: 0 6px 0 var(--tph-ink), 0 0 24px rgba(250, 204, 21, 0.25);
  transition: box-shadow 0.4s;
}

.tph-window[data-winning='true'] {
  box-shadow: 0 6px 0 var(--tph-ink), 0 0 40px rgba(250, 204, 21, 0.6);
}

.is-dive .tph-window { background: linear-gradient(180deg, #86efac, #15803d 50%, #4ade80); }

.tph-window__inner {
  position: relative;
  border-radius: 15px;
  overflow: hidden;
  background: radial-gradient(ellipse 70% 60% at 50% 40%, #1f1646, #0e0a24 80%);
  border: 3px solid var(--tph-ink);
  container-type: inline-size;
}

.tph-canvas {
  position: relative;
  z-index: 1;
  width: 100%;
  aspect-ratio: 672 / 536;
}

.tph-canvas :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.tph-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 16px;
  color: #c4b5fd;
}

.tph-card {
  position: relative;
  max-width: 460px;
  padding: 18px 26px 22px;
  border-radius: 22px;
  text-align: center;
  background: linear-gradient(180deg, #2a1d57, #150e33);
  border: 4px solid var(--tph-ink);
  box-shadow: 0 0 0 3px #facc15, 0 0 0 7px var(--tph-ink), 0 20px 60px rgba(0, 0, 0, 0.7);
  cursor: pointer;
}

.tph-card.is-dive { box-shadow: 0 0 0 3px #4ade80, 0 0 0 7px var(--tph-ink), 0 20px 60px rgba(0, 0, 0, 0.7); }

.tph-card__art {
  display: block;
  width: clamp(80px, 20cqw, 120px);
  margin: -64px auto 4px;
  filter: drop-shadow(0 6px 0 rgba(0, 0, 0, 0.4));
  animation: tph-bob 2s ease-in-out infinite;
}

.tph-card__title {
  font-family: 'Bangers', sans-serif;
  font-size: clamp(36px, 9cqw, 64px);
  line-height: 1;
  letter-spacing: 0.05em;
  color: #fde047;
  -webkit-text-stroke: 3px var(--tph-ink);
  paint-order: stroke fill;
  text-shadow: 4px 5px 0 var(--tph-ink);
  transform: rotate(-2deg);
}

.tph-card.is-dive .tph-card__title { color: #86efac; }
.tph-card.is-retrigger .tph-card__title { color: #fb923c; }

.tph-card__sub {
  margin-top: 8px;
  font-size: clamp(13px, 2.6cqw, 16px);
  font-weight: 500;
  color: #ddd6fe;
}

.tph-card__amount {
  margin: 6px 0 0;
  font-family: 'Lilita One', sans-serif;
  font-size: clamp(34px, 8cqw, 58px);
  color: #fff7d1;
  -webkit-text-stroke: 3px var(--tph-ink);
  paint-order: stroke fill;
  text-shadow: 3px 4px 0 var(--tph-ink), 0 0 24px rgba(250, 204, 21, 0.5);
}

.tph-card__amount.is-zero { color: #a8a2cf; text-shadow: 3px 4px 0 var(--tph-ink); }

/* ── Ticker ────────────────────────────────────────────────────────────── */
.tph-ticker {
  margin: 10px 4px 0;
  height: 24px;
  display: grid;
  place-items: center;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
  color: rgba(221, 214, 254, 0.8);
}

.tph-ticker > span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; padding: 0 10px; }
.tph-ticker.is-win { color: #fde047; }
.tph-ticker.is-bonus { color: #86efac; }
.tph-ticker.is-warn { color: #fca5a5; }

.tph-bar { margin-top: 6px; }

.tph-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.35);
  box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.4);
}

/* ── History ───────────────────────────────────────────────────────────── */
.tph-history {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 16px;
  max-width: 780px;
}

.tph-history__label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(196, 181, 253, 0.7);
}

.tph-history__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  font-family: 'Lilita One', sans-serif;
  font-size: 12px;
  color: rgba(221, 214, 254, 0.5);
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(196, 181, 253, 0.15);
}

.tph-history__chip.is-win { color: #fde047; border-color: rgba(250, 204, 21, 0.4); }
.tph-history__chip.is-bonus { color: #86efac; border-color: rgba(74, 222, 128, 0.5); }

/* ── Transitions ───────────────────────────────────────────────────────── */
.tph-fade-enter-active, .tph-fade-leave-active { transition: opacity 0.2s, transform 0.2s; }
.tph-fade-enter-from { opacity: 0; transform: translateY(4px); }
.tph-fade-leave-to { opacity: 0; transform: translateY(-4px); }

.tph-pop-enter-active { transition: opacity 0.25s, transform 0.35s cubic-bezier(0.2, 1.5, 0.4, 1); }
.tph-pop-leave-active { transition: opacity 0.2s, transform 0.2s; }
.tph-pop-enter-from { opacity: 0; transform: scale(0.8); }
.tph-pop-leave-to { opacity: 0; transform: scale(1.08); }

/* ── Narrow cabinets (phones) ──────────────────────────────────────────── */
@container tph-cab (max-width: 520px) {
  .tph-hud { gap: 6px; }
  .tph-hud__block { padding: 2px 8px; }
  .tph-hud__value { font-size: 15px; }
  .tph-hud__chip { font-size: 12px; }
  .tph-hud__chips { gap: 5px; }
  .tph-hud__sum-way { display: none; }
  .tph-badge { font-size: 9.5px; letter-spacing: 0.08em; }
  .tph-badge + .tph-badge::before { margin: 0 7px; }
  .tph-badge--max { display: none; }
  .tph-ticker { font-size: 10.5px; letter-spacing: 0.06em; }
}

@media (max-width: 480px) {
  .tph-page { padding: 12px 6px 20px; }
  .tph-cabinet { border-radius: 20px; padding: 24px 8px 10px; }
  .tph-window { border-radius: 16px; padding: 4px; }
  .tph-window__inner { border-radius: 11px; }
  .tph-sky__moon { width: 60px; height: 60px; }
}

@media (prefers-reduced-motion: reduce) {
  .tph-sky__beam, .tph-tape__track, .tph-logo__boss, .tph-card__art { animation: none !important; }
}
</style>
