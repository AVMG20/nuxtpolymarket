<script setup lang="ts">
// Ember Portals: a 7×7 cluster-pays tumble slot. Winning clusters open portal
// wilds that grow, jump and merge; in free spins the portals stay open. The
// server decides every outcome (shared/utils/gamelogic/emberportals.ts),
// including every tumble, fall and portal move; this component only replays
// it. Artwork is painted on canvases (~/utils/slots/emberportals-art), the
// effects live in ~/utils/slots/emberportals-fx and every sound is
// synthesized (~/composables/emberportals-sound).
import type { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { Cell, EmberPortalsResult, EpCluster, EpSpin, EpSymbol, EpTumble, EpWild } from '#shared/utils/gamelogic/emberportals'
import {
  EP_ANTE_COST,
  EP_BUY_COST,
  EP_COLS,
  EP_PAY_SYMBOLS,
  EP_ROWS,
  FS_AWARD,
  FS_TRIGGER
} from '#shared/utils/gamelogic/emberportals'
import { initSlotPixiApp, safeDestroy } from '~/utils/slot-pixi'
import {
  EP_DISPLAY_FONT,
  EP_NUMBER_FONT,
  EP_PORTAL_TIERS,
  EP_SYMBOLS,
  EP_UI_FONT,
  epArtDataUrl,
  epPlaqueDataUrl,
  epGlowSprite,
  epMotionBlur,
  epPortalTierIndex,
  epSparkSprite,
  loadEpFonts,
  paintEpBoard,
  paintEpPortalCore,
  paintEpPortalRing,
  paintEpScene,
  paintEpSpinRing,
  paintEpSymbol
} from '~/utils/slots/emberportals-art'
import {
  EpEmberDrift,
  EpFx,
  paintFlameSprite,
  paintMoteSprite,
  paintRaysSprite,
  paintShardSprite,
  type FlameHandle,
  type RaysHandle
} from '~/utils/slots/emberportals-fx'
import EpBigWin from '~/components/games/emberportals/EpBigWin.vue'
import EpCard from '~/components/games/emberportals/EpCard.vue'
import EpPaytable from '~/components/games/emberportals/EpPaytable.vue'
import EpFiligree from '~/components/games/emberportals/EpFiligree.vue'
import EpWarp from '~/components/games/emberportals/EpWarp.vue'
import EpWinDisplay from '~/components/games/emberportals/EpWinDisplay.vue'
import SlotBuyDialog from '~/components/slots/SlotBuyDialog.vue'
import SlotControlBar from '~/components/slots/SlotControlBar.vue'
import type { SlotAutoSettings, SlotBuyOption, SlotSpinMode } from '~/utils/slots/slot-controls'
import { EMBER_BAR_THEME } from '~/utils/slots/slot-themes'

const { fetchSession } = useAuth()
const { bet, isSpinning, errorMsg, balance, setBalance, history, pushHistory, spin: requestSpin } = useSlotGame<EmberPortalsResult, { payout: number, bet: number, bonus: boolean }>('emberportals')
const sound = useEmberPortalsSound()
const { soundEnabled, soundVolume, musicVolume } = sound

/** Sound effects go quiet once the game unmounts, even if a round is still unwinding. */
function sfx(...args: Parameters<typeof sound.play>) {
  if (!destroyed) sound.play(...args)
}

/** Font stacks for CSS; the art module names the families. */
function fontStack(name: string, fallback: string) {
  return name.includes(',') ? name : `'${name}', ${fallback}`
}
const DISPLAY_STACK = fontStack(EP_DISPLAY_FONT, 'Georgia, serif')
const NUMBER_STACK = fontStack(EP_NUMBER_FONT, 'Georgia, serif')
const UI_STACK = fontStack(EP_UI_FONT, 'system-ui, sans-serif')
const fontVars = { '--ep-display': DISPLAY_STACK, '--ep-number': NUMBER_STACK, '--ep-ui': UI_STACK }

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

function setBet(v: number, effect?: 'bet-up' | 'bet-down') {
  if (betLocked.value) return
  const next = clampBet(v)
  if (next === bet.value) return
  bet.value = next
  if (effect) sfx(effect)
}

function betUp() {
  setBet(BET_LADDER.find(v => v > bet.value) ?? MAX_BET, 'bet-up')
}

function betDown() {
  setBet([...BET_LADDER].reverse().find(v => v < bet.value) ?? MIN_BET, 'bet-down')
}

function maxBet() {
  const unit = ante.value ? EP_ANTE_COST : 1
  setBet([...BET_LADDER].reverse().find(v => v * unit <= balance.value) ?? MIN_BET, 'bet-up')
}

function typeBet(v: number) {
  setBet(v, v > bet.value ? 'bet-up' : 'bet-down')
}

// --- extra chance (ante) ------------------------------------------------------
const ante = ref(false)
const spinCost = computed(() => ante.value ? bet.value * EP_ANTE_COST : bet.value)
const buyCost = computed(() => bet.value * EP_BUY_COST)

function toggleAnte() {
  if (betLocked.value) return
  ante.value = !ante.value
  sound.unlock()
  sfx(ante.value ? 'ante-on' : 'ante-off')
  try {
    localStorage.setItem('emberportals-ante', String(ante.value))
  } catch { /* storage blocked */ }
}

const buyArt = ref('')
const logoArt = ref('')
const ringArt = ref('')
const spinRingArt = ref('')
const showBuy = ref(false)
/** Right wing legend in the base game: every portal tier and where it starts. */
const tierLegend = ref<{ min: number, name: string, glow: string, url: string }[]>([])

const buyOptions = computed<SlotBuyOption[]>(() => [
  {
    id: 'buy',
    title: 'Buy Free Spins',
    description: `${FS_AWARD[0]}+ free spins, portals stay open`,
    cost: buyCost.value,
    image: buyArt.value
  }
])

// --- round / HUD state --------------------------------------------------------
type Phase = 'idle' | 'spinning' | 'presenting' | 'bonus'
const phase = ref<Phase>('idle')
const ready = ref(false)
const loadError = ref('')
const turbo = ref(false)
const showHelp = ref(false)
/** The server answered and the new screen is dropping in. */
const resultIn = ref(false)
const reducedMotion = ref(false)

const winMeter = ref(0)
const winPulse = ref(0)
const winning = ref(false)
const teasing = ref(false)
const launching = ref(false)
/** Screen-reader only: what just happened. The visible status line is the win display. */
const message = ref('Match 5 or more to open a portal')

const inFreeSpins = ref(false)
const bonusScene = ref(false)
const warp = reactive({ show: false, color: '#ff8a1f' })
const fsSpin = ref(0)
const fsTotalSpins = ref(0)
const fsTotal = ref(0)
const portalHud = ref<EpWild[]>([])
const portalChips = computed(() => [...portalHud.value].sort((a, b) => b.mult - a.mult))
const portalSum = computed(() => portalHud.value.reduce((a, w) => a + w.mult, 0))
const fsLeft = computed(() => Math.max(0, fsTotalSpins.value - fsSpin.value))
/** Frame glow: the tier colour of the biggest open portal in free spins. */
const frameGlow = computed(() => {
  const top = portalChips.value[0]
  return top ? tierCss(top.mult).glow : '#ff8a1f'
})

const card = reactive({ show: false, kind: 'fs' as 'fs' | 'fs-end' | 'retrigger', title: '', sub: '', amount: 0, countMs: 1600 })
const bigWin = reactive({ show: false, label: '', tier: 0, amount: 0, multiple: 0 })

const autoplay = useSlotAutoplay()

function say(text: string) {
  message.value = text
}

const BIG_TIERS = [
  { threshold: 15, label: 'Big Win', color: 0xff8a1f },
  { threshold: 40, label: 'Mega Win', color: 0xff5a3c },
  { threshold: 100, label: 'Epic Win', color: 0x43c8ff },
  { threshold: 400, label: 'Inferno', color: 0xc77dff },
  { threshold: 1000, label: 'Legendary', color: 0xffe066 }
] as const

function tierFor(multiple: number) {
  let t = -1
  BIG_TIERS.forEach((tier, i) => { if (multiple >= tier.threshold) t = i })
  return t
}

/** Win display glow by how big the round is so far. */
const winGlow = computed(() => {
  const m = winMeter.value / Math.max(1, bet.value)
  if (m >= 100) return '#c77dff'
  if (m >= 15) return '#ff5a3c'
  if (m >= 3) return '#ff8a1f'
  return '#ffc247'
})

function hex(color: string) {
  return Number.parseInt(color.replace('#', '').slice(0, 6), 16)
}

// --- portal tiers (colours from the art module) ------------------------------
function tierIndex(mult: number): number {
  return Math.max(0, Math.min(EP_PORTAL_TIERS.length - 1, epPortalTierIndex(mult)))
}

function tierCss(mult: number) {
  return EP_PORTAL_TIERS[tierIndex(mult)]!
}

function tierColors(i: number) {
  const t = EP_PORTAL_TIERS[i]!
  return { ring: hex(t.ring), core: hex(t.core), glow: hex(t.glow), flames: t.flames.map(hex) }
}

/** Flame size and rate, 0..1: ×1 barely smoulders, ×500+ roars. */
function flameIntensity(mult: number) {
  return Math.min(1, 0.15 + Math.log2(mult + 1) / 10.5)
}

// --- geometry -----------------------------------------------------------------
const CELL = 96
const GAP = 6
const PAD = 14
const STEP = CELL + GAP
const BOARD_W = EP_COLS * CELL + (EP_COLS - 1) * GAP
const BOARD_H = EP_ROWS * CELL + (EP_ROWS - 1) * GAP
const APP_W = BOARD_W + PAD * 2
const APP_H = BOARD_H + PAD * 2
const SYM = CELL * 0.94
const RING = CELL * 1.3

const cx = (col: number) => PAD + col * STEP + CELL / 2
const cy = (row: number) => PAD + row * STEP + CELL / 2
const cellKey = (col: number, row: number) => col * EP_ROWS + row

function centroid(cells: Cell[]) {
  const x = cells.reduce((s, c) => s + cx(c.col), 0) / cells.length
  const y = cells.reduce((s, c) => s + cy(c.row), 0) / cells.length
  return { x: Math.min(APP_W - 70, Math.max(70, x)), y: Math.min(APP_H - 40, Math.max(40, y)) }
}

const SYMBOL_IDS: EpSymbol[] = [...EP_PAY_SYMBOLS, 'scatter']
/** Symbols that catch an occasional glint while idle (never rescaled, so the grid stays even). */
const HIGH_SYMBOLS = new Set<EpSymbol>(['phoenix', 'grimoire', 'amulet', 'scatter'])

const INITIAL_GRID: EpSymbol[][] = [
  ['ember', 'rune', 'potion', 'phoenix', 'rune', 'chalice', 'ember'],
  ['amulet', 'hourglass', 'ember', 'rune', 'grimoire', 'potion', 'rune'],
  ['potion', 'chalice', 'grimoire', 'ember', 'hourglass', 'phoenix', 'amulet'],
  ['rune', 'ember', 'scatter', 'amulet', 'potion', 'rune', 'hourglass'],
  ['hourglass', 'phoenix', 'rune', 'potion', 'ember', 'amulet', 'chalice'],
  ['grimoire', 'potion', 'amulet', 'hourglass', 'chalice', 'ember', 'rune'],
  ['chalice', 'rune', 'hourglass', 'ember', 'phoenix', 'grimoire', 'potion']
]

// --- pixi (non-reactive on purpose; Vue proxies break PixiJS objects) ---------
type PixiModule = typeof import('pixi.js')
type Gsap = typeof import('gsap').gsap
type Tween = ReturnType<Gsap['to']>

interface SymView {
  id: EpSymbol
  box: Container
  sprite: Sprite
}

interface PortalView {
  id: number
  col: number
  row: number
  mult: number
  tier: number
  box: Container
  rays: Sprite
  halo: Sprite
  /** Halo scale at rest; it pulses around this. */
  haloBase: number
  flames: Container
  core: Sprite
  ring: Sprite
  label: Text
  flame: FlameHandle
}

interface Trace {
  g: Graphics
  comet: Sprite
  loops: { x: number, y: number }[][]
  lens: number[][]
  color: number
  t: number
  dur: number
}

const pageEl = ref<HTMLDivElement>()
const canvasWrap = ref<HTMLDivElement>()
const sceneEl = ref<HTMLDivElement>()
const driftEl = ref<HTMLCanvasElement>()
const flyersEl = ref<HTMLDivElement>()
const winDisplay = ref<InstanceType<typeof EpWinDisplay> | null>(null)
let PIXI: PixiModule | null = null
let GSAP: Gsap | null = null
let app: import('pixi.js').Application | null = null
let fx: EpFx | null = null
let drift: EpEmberDrift | null = null
let stageRoot: Container | null = null
let symbolLayer: Container | null = null
let teaseLayer: Container | null = null
let frameLayer: Container | null = null
let portalLayer: Container | null = null
let floatLayer: Container | null = null
let dimLayer: Graphics | null = null
const sharpTex = {} as Record<EpSymbol, Texture>
const blurTex = {} as Record<EpSymbol, Texture>
const ringTex: Texture[] = []
const coreTex: Texture[] = []
let glowTex: Texture | null = null
let raysTex: Texture | null = null
const ownedTextures: Texture[] = []
let resizeObs: ResizeObserver | null = null
let currentRes = 1
let destroyed = false
let isPhone = false

const views: (SymView | null)[][] = Array.from({ length: EP_COLS }, () => Array.from({ length: EP_ROWS }, () => null))
const portals = new Map<number, PortalView>()
const traces: Trace[] = []
let shownGrid: EpSymbol[][] = INITIAL_GRID.map(c => c.slice())
/** Portals left burning on the settled board until the next spin. */
let restingWilds: EpWild[] = []

function renderResolution(): number {
  const dpr = window.devicePixelRatio || 1
  const cssW = canvasWrap.value?.clientWidth || APP_W
  // Match device pixels and never go below them; supersample standard
  // screens a little so the thin glows stay crisp.
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
  reducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  isPhone = window.matchMedia('(max-width: 640px), (pointer: coarse)').matches
  try {
    turbo.value = localStorage.getItem('emberportals-turbo') === 'true'
    ante.value = localStorage.getItem('emberportals-ante') === 'true'
  } catch { /* storage blocked */ }
  try {
    const [pixi, gsapMod] = await Promise.all([
      import('pixi.js'),
      import('gsap'),
      loadEpFonts()
    ])
    if (destroyed) return
    PIXI = pixi
    GSAP = gsapMod.gsap ?? gsapMod.default

    buyArt.value = epArtDataUrl('buy', 200)
    logoArt.value = epArtDataUrl('logo', 360)
    ringArt.value = epArtDataUrl('wild', 256)
    spinRingArt.value = paintEpSpinRing(256).toDataURL()
    tierLegend.value = EP_PORTAL_TIERS.map((t, i) => ({ min: t.min, name: t.name, glow: t.glow, url: paintEpPortalRing(96, i).toDataURL() }))
    buildScene('base')

    app = await initSlotPixiApp(PIXI.Application, { width: APP_W, height: APP_H }, () => destroyed)
    if (!app) return
    currentRes = renderResolution()
    app.renderer.resize(APP_W, APP_H, currentRes)
    app.stage.sortableChildren = true
    canvasWrap.value?.appendChild(app.canvas)

    buildTextures()
    buildStage()
    syncBoard(shownGrid, [])

    resizeObs = new ResizeObserver(() => {
      if (!app || destroyed) return
      const r = renderResolution()
      if (Math.abs(r - currentRes) > 0.05) {
        currentRes = r
        app.renderer.resize(APP_W, APP_H, r)
      }
      drift?.resize()
      measurePillars()
    })
    if (canvasWrap.value) resizeObs.observe(canvasWrap.value)
    if (pageEl.value) resizeObs.observe(pageEl.value)
    if (driftEl.value) {
      drift = new EpEmberDrift(driftEl.value, isPhone ? 14 : 36, reducedMotion.value ? 1.5 : isPhone ? 3 : 7)
      resizeObs.observe(driftEl.value)
    }
    measurePillars()
    ready.value = true
    // The bonus sky is only needed later; paint it off the first frame.
    setTimeout(() => { if (!destroyed) buildScene('bonus') }, 400)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load the game'
  }
})

// --- plaques: painted sign backgrounds, repainted to each sign's size ----------
type PlaqueVariant = Parameters<typeof epPlaqueDataUrl>[2]
let plaqueObs: ResizeObserver | null = null

function paintPlaque(el: HTMLElement) {
  const variant = el.dataset.plaque as PlaqueVariant | undefined
  const w = Math.round(el.offsetWidth / 4) * 4
  const h = Math.round(el.offsetHeight / 4) * 4
  if (!variant || w < 20 || h < 20) return
  el.style.backgroundImage = `url(${epPlaqueDataUrl(w, h, variant)})`
  el.classList.add('has-art')
}

/** Template ref for a sign: paint its plaque now and whenever it resizes. */
const plaqueEls = new Set<HTMLElement>()

function plaqueRef(el: unknown) {
  if (typeof ResizeObserver === 'undefined') return
  plaqueObs ??= new ResizeObserver((entries) => {
    for (const e of entries) paintPlaque(e.target as HTMLElement)
  })
  if (el instanceof HTMLElement) {
    if (!plaqueEls.has(el)) plaqueObs.observe(el)
    plaqueEls.add(el)
    return
  }
  // A sign unmounted (Vue passes null): stop watching whatever left the DOM.
  for (const old of plaqueEls) {
    if (old.isConnected) continue
    plaqueObs.unobserve(old)
    plaqueEls.delete(old)
  }
}

// The scene's arch pillars stand at cx ± 0.285 × the painted width (see
// archGeometry in emberportals-scene, canvas aspect 0.62), and the canvas is
// cover-scaled to the page. The deck must fit between them.
const SCENE_ASPECT = 0.62
const PILLAR_HALF_GAP = 0.285

function measurePillars() {
  const page = pageEl.value
  if (!page) return
  const shown = Math.max(page.clientWidth, page.clientHeight / SCENE_ASPECT)
  page.style.setProperty('--ep-pillars', `${Math.round(shown * PILLAR_HALF_GAP * 2)}px`)
}

// --- scene: a static backdrop, painted once per mode ---------------------------
function buildScene(mode: 'base' | 'bonus') {
  const host = sceneEl.value?.querySelector<HTMLElement>(`[data-scene="${mode}"]`)
  if (!host || host.childElementCount) return
  const w = Math.round(Math.min(2200, Math.max(1200, window.innerWidth * Math.min(1.5, window.devicePixelRatio || 1))))
  const h = Math.round(w * 0.62)
  const canvas = paintEpScene(w, h, mode)
  canvas.className = 'ep-scene__canvas'
  host.appendChild(canvas)
}

// --- pixi stage ----------------------------------------------------------------
function buildTextures() {
  const px = Math.min(512, Math.ceil(CELL * Math.max(2, currentRes) / 16) * 16)
  for (const id of SYMBOL_IDS) {
    const c = paintEpSymbol(id, px)
    sharpTex[id] = texFrom(c)
    blurTex[id] = texFrom(epMotionBlur(c))
  }
  const ringPx = Math.min(512, Math.ceil(RING * Math.max(2, currentRes) / 16) * 16)
  EP_PORTAL_TIERS.forEach((_, i) => {
    ringTex[i] = texFrom(paintEpPortalRing(ringPx, i))
    coreTex[i] = texFrom(paintEpPortalCore(ringPx, i))
  })
  glowTex = texFrom(epGlowSprite(128))
  raysTex = texFrom(paintRaysSprite(256))
}

function buildStage() {
  const P = PIXI!
  const stage = app!.stage

  stageRoot = new P.Container()
  stageRoot.sortableChildren = true
  stage.addChild(stageRoot)

  const board = new P.Sprite(texFrom(paintEpBoard(APP_W, APP_H, Math.max(2, currentRes), EP_COLS, EP_ROWS, CELL, GAP, PAD, PAD)))
  board.width = APP_W
  board.height = APP_H
  board.zIndex = 0
  stageRoot.addChild(board)

  teaseLayer = new P.Container()
  teaseLayer.zIndex = 5
  teaseLayer.eventMode = 'none'
  stageRoot.addChild(teaseLayer)

  // Symbols drop in from above the board and fall out below it: clip them.
  symbolLayer = new P.Container()
  symbolLayer.zIndex = 10
  const mask = new P.Graphics()
  mask.rect(PAD - 3, PAD - 3, BOARD_W + 6, BOARD_H + 6).fill({ color: 0xffffff })
  stageRoot.addChild(mask)
  symbolLayer.mask = mask
  stageRoot.addChild(symbolLayer)

  frameLayer = new P.Container()
  frameLayer.zIndex = 20
  frameLayer.eventMode = 'none'
  stageRoot.addChild(frameLayer)

  // Portals sit above the symbols and overflow their cells; their additive
  // halo is what lights the neighbouring symbols.
  portalLayer = new P.Container()
  portalLayer.zIndex = 25
  portalLayer.eventMode = 'none'
  portalLayer.sortableChildren = true
  stageRoot.addChild(portalLayer)

  floatLayer = new P.Container()
  floatLayer.zIndex = 30
  floatLayer.eventMode = 'none'
  stageRoot.addChild(floatLayer)

  dimLayer = new P.Graphics()
  dimLayer.rect(-40, -40, APP_W + 80, APP_H + 80).fill({ color: 0x05060f })
  dimLayer.alpha = 0
  dimLayer.zIndex = 40
  stageRoot.addChild(dimLayer)

  const fxLayer = new P.Container()
  fxLayer.zIndex = 50
  fxLayer.eventMode = 'none'
  stageRoot.addChild(fxLayer)
  fx = new EpFx(P, app!.ticker, fxLayer, {
    spark: texFrom(epSparkSprite(64)),
    glow: glowTex!,
    mote: texFrom(paintMoteSprite(64)),
    shard: texFrom(paintShardSprite(48)),
    flame: texFrom(paintFlameSprite(64))
  }, APP_W, APP_H, isPhone ? 280 : 750, reducedMotion.value)
  fx.ambient(isPhone ? 3 : 6)

  app!.ticker.add(animateBoard)
}

// --- idle life: portals burn, high symbols breathe and glint ---------------------
let glintAcc = 0

function animateBoard(t: { deltaMS: number }) {
  const dt = Math.min(50, t.deltaMS) / 1000
  const now = performance.now() / 1000
  for (const p of portals.values()) {
    const k = flameIntensity(p.mult)
    p.core.rotation += dt * (1.2 + k * 3)
    p.rays.rotation -= dt * (0.35 + k * 0.6)
    const pulse = Math.sin(now * (3 + k * 3) + p.id)
    p.halo.alpha = 0.55 + k * 0.3 + pulse * 0.15
    p.halo.scale.set(p.haloBase * (1 + pulse * 0.05))
    p.rays.alpha = 0.35 + k * 0.45 + pulse * 0.1
  }
  if (phase.value !== 'idle' || !fx || reducedMotion.value) return
  glintAcc += dt
  if (glintAcc < 1.1) return
  glintAcc = Math.random() * 0.5
  const high: SymView[] = []
  for (const col of views) for (const v of col) if (v && HIGH_SYMBOLS.has(v.id)) high.push(v)
  const v = high[Math.floor(Math.random() * high.length)]
  if (!v) return
  const gx = v.box.x + (Math.random() - 0.3) * SYM * 0.5
  const gy = v.box.y - (Math.random() * 0.4 + 0.1) * SYM
  fx.emit(gx, gy, { count: 1, kind: 'spark', speed: 1, life: 0.6, scale: 0.9, endScale: 0.1, colors: [0xffffff], spin: 4 })
  fx.bloom(gx, gy, hex(EP_SYMBOLS[v.id].color), 70, 0.5)
}

onUnmounted(() => {
  destroyed = true
  window.removeEventListener('pointerdown', onFirstGesture)
  resizeObs?.disconnect()
  plaqueObs?.disconnect()
  stopAutoplay()
  requestSkip()
  sound.stopMusic()
  sound.stopEffects()
  meterTween?.kill()
  clearFlyers()
  for (const tw of live.keys()) tw.kill()
  live.clear()
  app?.ticker.remove(animateBoard)
  app?.ticker.remove(updateTraces)
  for (const p of portals.values()) p.flame.destroy()
  portals.clear()
  drift?.destroy()
  safeDestroy(() => fx?.destroy())
  safeDestroy(() => app?.destroy(true, { children: true }))
  for (const t of ownedTextures.splice(0)) safeDestroy(() => t.destroy(true))
  fx = null
  app = null
})

// --- sound helpers ---------------------------------------------------------
function onFirstGesture() {
  sound.unlock()
  sound.startMusic()
}

function click() {
  sound.unlock()
  sfx('click')
}

function toggleTurbo() {
  turbo.value = !turbo.value
  sfx('click')
  try {
    localStorage.setItem('emberportals-turbo', String(turbo.value))
  } catch { /* storage blocked */ }
}

// --- timing -----------------------------------------------------------------
let skipping = false
const waiters = new Set<() => void>()
/** Running anim() tweens and the resolver of the promise each one returned. */
const live = new Map<Tween, () => void>()

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

/** Fast-forward: every running animation jumps to its end, every wait ends. */
function requestSkip() {
  skipping = true
  for (const tw of [...live.keys()]) tw.totalProgress(1)
  for (const w of [...waiters]) w()
  fx?.clear()
  clearFlyers()
  clearTraces()
  clearLayer(floatLayer)
}

/** GSAP tween scaled by turbo; finishes at once while skipping. */
function anim(target: object, vars: Record<string, unknown>): Promise<void> {
  if (!GSAP || destroyed) return Promise.resolve()
  const duration = skipping ? 0 : Number(vars.duration ?? 0.3) * speed()
  const wait = skipping ? 0 : Number(vars.delay ?? 0) * speed()
  return new Promise<void>((resolve) => {
    // A zero-length tween can complete inside gsap.to(), before `tw` is set.
    let done = false
    let tw: Tween | null = null
    tw = GSAP!.to(target, {
      ...vars,
      duration,
      delay: wait,
      onComplete: () => {
        done = true
        if (tw) live.delete(tw)
        resolve()
      }
    })
    if (!done) live.set(tw, resolve)
  })
}

/** Stop every tween on these targets; anim() promises on them resolve instead of hanging. */
function killAnims(...targets: object[]) {
  for (const [tw, resolve] of [...live]) {
    if (!tw.targets().some((t: unknown) => targets.includes(t as object))) continue
    live.delete(tw)
    tw.kill()
    resolve()
  }
  GSAP?.killTweensOf(targets)
}

let meterTween: Tween | null = null
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
      onUpdate: () => { winMeter.value = obj.v },
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

// --- board views ------------------------------------------------------------
function setTexture(v: SymView, tex: Texture) {
  v.sprite.texture = tex
  v.sprite.width = SYM
  v.sprite.height = SYM * tex.height / tex.width
}

function makeView(id: EpSymbol, col: number, row: number, y = cy(row)): SymView {
  const P = PIXI!
  const box = new P.Container()
  box.position.set(cx(col), y)
  const sprite = new P.Sprite(sharpTex[id])
  sprite.anchor.set(0.5)
  box.addChild(sprite)
  const v = { id, box, sprite }
  setTexture(v, sharpTex[id])
  symbolLayer!.addChild(box)
  return v
}

function destroyView(v: SymView) {
  killAnims(v.box, v.box.scale, v.sprite)
  safeDestroy(() => v.box.destroy({ children: true }))
}

function makePortal(id: number, col: number, row: number, mult: number): PortalView {
  const P = PIXI!
  const tier = tierIndex(mult)
  const colors = tierColors(tier)
  const box = new P.Container()
  box.position.set(cx(col), cy(row))
  box.zIndex = mult

  const rays = new P.Sprite(raysTex!)
  rays.anchor.set(0.5)
  rays.width = rays.height = CELL * 2.4
  rays.blendMode = 'add'

  const halo = new P.Sprite(glowTex!)
  halo.anchor.set(0.5)
  halo.width = halo.height = CELL * 2.3
  halo.blendMode = 'add'

  const flames = new P.Container()

  const core = new P.Sprite(coreTex[tier]!)
  core.anchor.set(0.5)
  core.width = core.height = RING * 0.5
  core.blendMode = 'add'

  const ring = new P.Sprite(ringTex[tier]!)
  ring.anchor.set(0.5)
  ring.width = ring.height = RING

  const label = new P.Text({
    text: `×${mult}`,
    style: {
      fontFamily: NUMBER_STACK,
      fontSize: CELL * 0.45,
      fontWeight: '900',
      fill: 0xffffff,
      stroke: { color: 0x0a0406, width: 9, join: 'round' },
      dropShadow: { color: colors.glow, alpha: 1, blur: 12, distance: 0, angle: 0 }
    }
  })
  label.anchor.set(0.5)
  label.y = 2

  box.addChild(rays, halo, flames, core, ring, label)
  portalLayer!.addChild(box)
  const flame = fx!.addFlame(flames, { radius: RING * 0.42, colors: colors.flames, intensity: flameIntensity(mult) })
  const p: PortalView = { id, col, row, mult, tier, box, rays, halo, haloBase: halo.scale.x, flames, core, ring, label, flame }
  paintPortal(p, mult, false)
  portals.set(id, p)
  return p
}

/** Recolour a portal for its multiplier; `slam` plays the tier-up / grow moment. */
function paintPortal(p: PortalView, mult: number, slam: boolean) {
  const tier = tierIndex(mult)
  const tierUp = tier !== p.tier
  const colors = tierColors(tier)
  p.mult = mult
  p.tier = tier
  p.box.zIndex = mult
  p.ring.texture = ringTex[tier]!
  p.core.texture = coreTex[tier]!
  p.halo.tint = colors.glow
  p.rays.tint = colors.glow
  p.flame.set({ colors: colors.flames, intensity: flameIntensity(mult) })
  p.label.text = `×${formatNumber(mult, false)}`
  p.label.style.fontSize = mult >= 1000 ? CELL * 0.28 : mult >= 100 ? CELL * 0.34 : CELL * 0.45
  p.label.style.dropShadow = { color: colors.glow, alpha: 1, blur: 12, distance: 0, angle: 0 }
  if (!slam || skipping) return
  const x = p.box.x
  const y = p.box.y
  if (tierUp) {
    fx?.bloom(x, y, 0xffffff, CELL * 4, 0.45)
    fx?.bloom(x, y, colors.glow, CELL * 3.2, 0.8)
    fx?.shockwave(x, y, colors.glow, CELL * 2.2, 0.7, 12)
    fx?.emit(x, y, { count: 40, kind: 'flame', speed: [160, 420], gravity: -200, life: 0.7, scale: 1, colors: colors.flames })
    if (stageRoot) fx?.shake(stageRoot, 5, 0.35)
    void anim(p.label.scale, { x: 1, y: 1, duration: 0.45, ease: 'back.out(3)', startAt: { x: 2.6, y: 2.6 } })
  } else {
    fx?.bloom(x, y, colors.glow, CELL * 2.4, 0.4)
    void anim(p.label.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)', startAt: { x: 1.7, y: 1.7 } })
  }
}

function destroyPortal(p: PortalView) {
  portals.delete(p.id)
  killAnims(p.box, p.box.scale, p.label.scale)
  p.flame.destroy()
  safeDestroy(() => p.box.destroy({ children: true }))
}

/**
 * Snap the board to a known state: symbols in `grid`, portals from `wilds`.
 * Runs after every animated step, so a skip or a missed tween can never
 * leave the screen out of step with the server result.
 */
function syncBoard(grid: EpSymbol[][], wilds: EpWild[]) {
  if (!symbolLayer) return
  const wildCells = new Set(wilds.map(w => cellKey(w.col, w.row)))
  for (let col = 0; col < EP_COLS; col++) {
    for (let row = 0; row < EP_ROWS; row++) {
      const sym = grid[col]![row]!
      const v = views[col]![row]
      if (sym === 'wild' || wildCells.has(cellKey(col, row))) {
        if (v) destroyView(v)
        views[col]![row] = null
        continue
      }
      if (v && v.id === sym) {
        killAnims(v.box, v.box.scale)
        v.box.position.set(cx(col), cy(row))
        v.box.scale.set(1)
        v.box.alpha = 1
        v.box.rotation = 0
        setTexture(v, sharpTex[sym])
        v.sprite.tint = 0xffffff
        continue
      }
      if (v) destroyView(v)
      views[col]![row] = makeView(sym, col, row)
    }
  }
  const keep = new Set(wilds.map(w => w.id))
  for (const p of [...portals.values()]) if (!keep.has(p.id)) destroyPortal(p)
  for (const w of wilds) {
    const p = portals.get(w.id) ?? makePortal(w.id, w.col, w.row, w.mult)
    killAnims(p.box, p.box.scale, p.label.scale)
    p.label.scale.set(1)
    p.col = w.col
    p.row = w.row
    p.box.position.set(cx(w.col), cy(w.row))
    p.box.scale.set(1)
    p.box.alpha = 1
    p.box.rotation = 0
    if (p.mult !== w.mult) paintPortal(p, w.mult, false)
  }
  shownGrid = grid.map(c => c.slice())
}

function clearLayer(layer: Container | null) {
  if (!layer) return
  for (const child of layer.removeChildren()) {
    GSAP?.killTweensOf(child)
    safeDestroy(() => child.destroy())
  }
}

function dim(keep: Set<number>, portalIds: Set<number> = new Set()) {
  for (let col = 0; col < EP_COLS; col++) {
    for (let row = 0; row < EP_ROWS; row++) {
      const v = views[col]![row]
      if (v) v.box.alpha = keep.has(cellKey(col, row)) ? 1 : 0.3
    }
  }
  for (const p of portals.values()) p.box.alpha = portalIds.has(p.id) || keep.has(cellKey(p.col, p.row)) ? 1 : 0.5
}

function undim() {
  for (const col of views) for (const v of col) if (v) v.box.alpha = 1
  for (const p of portals.values()) p.box.alpha = 1
}

function floatText(x: number, y: number, text: string, color = 0xffc247, size = 30) {
  if (!PIXI || !floatLayer || !GSAP || skipping) return
  const t = new PIXI.Text({
    text,
    style: {
      fontFamily: NUMBER_STACK,
      fontSize: size,
      fontWeight: '900',
      fill: 0xffffff,
      stroke: { color: 0x0a0406, width: 7, join: 'round' },
      dropShadow: { color, alpha: 1, blur: 10, distance: 0, angle: 0 }
    }
  })
  t.anchor.set(0.5)
  t.position.set(x, y)
  floatLayer.addChild(t)
  GSAP.fromTo(t.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.6)' })
  GSAP.to(t, { y: y - 30, duration: 1.3 * speed(), ease: 'power1.out' })
  GSAP.to(t, { alpha: 0, duration: 0.35, delay: 0.95 * speed(), onComplete: () => t.destroy() })
}

// --- chips flying into the win display (DOM) ------------------------------------
const flyerTweens = new Set<ReturnType<Gsap['timeline']>>()

function clearFlyers() {
  for (const tl of flyerTweens) tl.kill()
  flyerTweens.clear()
  flyersEl.value?.replaceChildren()
}

/** A chip pops at a board point, then flies into the win display and pops it. */
function flyToWin(x: number, y: number, text: string, color: string, big = false) {
  const page = pageEl.value
  const layer = flyersEl.value
  const wrap = canvasWrap.value
  const target = winDisplay.value?.target
  if (!GSAP || !page || !layer || !wrap || !target || skipping) {
    winPulse.value++
    return
  }
  const pr = page.getBoundingClientRect()
  const cr = wrap.getBoundingClientRect()
  const tr = target.getBoundingClientRect()
  const sx = cr.left - pr.left + (x / APP_W) * cr.width
  const sy = cr.top - pr.top + (y / APP_H) * cr.height
  const tx = tr.left - pr.left + tr.width / 2
  const ty = tr.top - pr.top + tr.height / 2
  const el = document.createElement('span')
  el.className = big ? 'ep-flyer is-big' : 'ep-flyer'
  el.textContent = text
  el.style.setProperty('--c', color)
  layer.appendChild(el)
  const tl = GSAP.timeline({
    onComplete: () => {
      flyerTweens.delete(tl)
      el.remove()
      winPulse.value++
    }
  })
  tl.set(el, { x: sx, y: sy, xPercent: -50, yPercent: -50, scale: 0.2, opacity: 0 })
  // Pop in, hold over the cluster long enough to read, then fly to the win.
  tl.to(el, { scale: 1.15, opacity: 1, duration: 0.25 * speed(), ease: 'back.out(3)' })
  tl.to(el, { scale: 1, duration: 0.2 * speed(), ease: 'sine.out' })
  // The hold only half-scales with turbo so the amount is still readable there.
  tl.to(el, { y: sy - 10, duration: 0.4 + 0.3 * speed(), ease: 'sine.out' })
  tl.to(el, { x: tx, y: ty, scale: 0.55, duration: 0.6 * speed(), ease: 'power2.in' })
  flyerTweens.add(tl)
}

// --- cluster outline traces -------------------------------------------------------
/** Outline loops (board px) around a set of cells, following the cell edges. */
function outlineLoops(cells: Cell[]): { x: number, y: number }[][] {
  const inSet = new Set(cells.map(c => cellKey(c.col, c.row)))
  const has = (c: number, r: number) => c >= 0 && r >= 0 && c < EP_COLS && r < EP_ROWS && inSet.has(cellKey(c, r))
  const edges = new Map<string, [number, number][]>()
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = `${x0},${y0}`
    const list = edges.get(k) ?? []
    list.push([x1, y1])
    edges.set(k, list)
  }
  for (const { col, row } of cells) {
    if (!has(col, row - 1)) add(col, row, col + 1, row)
    if (!has(col + 1, row)) add(col + 1, row, col + 1, row + 1)
    if (!has(col, row + 1)) add(col + 1, row + 1, col, row + 1)
    if (!has(col - 1, row)) add(col, row + 1, col, row)
  }
  const toPx = (g: number) => PAD + g * STEP - GAP / 2
  const loops: { x: number, y: number }[][] = []
  for (const [k, list] of edges) {
    while (list.length) {
      const [sx, sy] = k.split(',').map(Number) as [number, number]
      const loop: [number, number][] = [[sx, sy]]
      let cur = list.pop()!
      for (let guard = 0; guard < 400; guard++) {
        loop.push(cur)
        if (cur[0] === sx && cur[1] === sy) break
        const next = edges.get(`${cur[0]},${cur[1]}`)
        if (!next?.length) break
        cur = next.pop()!
      }
      loops.push(loop.map(([gx, gy]) => ({ x: toPx(gx), y: toPx(gy) })))
    }
  }
  return loops
}

function traceCluster(c: EpCluster) {
  if (!PIXI || !frameLayer || skipping) return
  const loops = outlineLoops(c.cells)
  const lens = loops.map((pts) => {
    const acc = [0]
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y))
    return acc
  })
  const g = new PIXI.Graphics()
  g.blendMode = 'add'
  const comet = new PIXI.Sprite(glowTex!)
  comet.anchor.set(0.5)
  comet.width = comet.height = 60
  comet.blendMode = 'add'
  const color = hex(EP_SYMBOLS[c.symbol].color)
  comet.tint = color
  frameLayer.addChild(g, comet)
  if (!traces.length) app?.ticker.add(updateTraces)
  traces.push({ g, comet, loops, lens, color, t: 0, dur: 0.45 * speed() })
}

function updateTraces(tk: { deltaMS: number }) {
  const dt = Math.min(50, tk.deltaMS) / 1000
  const now = performance.now() / 1000
  for (const tr of traces) {
    tr.t += dt
    const p = Math.min(1, tr.t / tr.dur)
    const pulse = p >= 1 ? 0.75 + Math.sin(now * 9) * 0.25 : 1
    tr.g.clear()
    tr.loops.forEach((pts, li) => {
      const acc = tr.lens[li]!
      const total = acc[acc.length - 1]!
      const upto = total * p
      tr.g.moveTo(pts[0]!.x, pts[0]!.y)
      let head = pts[0]!
      for (let i = 1; i < pts.length; i++) {
        if (acc[i]! <= upto) {
          tr.g.lineTo(pts[i]!.x, pts[i]!.y)
          head = pts[i]!
          continue
        }
        const seg = acc[i]! - acc[i - 1]!
        const f = seg > 0 ? (upto - acc[i - 1]!) / seg : 0
        head = { x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * f, y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * f }
        tr.g.lineTo(head.x, head.y)
        break
      }
      if (li === 0) tr.comet.position.set(head.x, head.y)
    })
    tr.g.stroke({ color: tr.color, width: 14, alpha: 0.22 * pulse, join: 'round', cap: 'round' })
    tr.g.stroke({ color: tr.color, width: 6, alpha: 0.7 * pulse, join: 'round', cap: 'round' })
    tr.g.stroke({ color: 0xffffff, width: 2.5, alpha: 0.95 * pulse, join: 'round', cap: 'round' })
    tr.comet.alpha = p >= 1 ? Math.max(0, tr.comet.alpha - dt * 4) : 1
  }
}

function clearTraces() {
  for (const tr of traces.splice(0)) {
    safeDestroy(() => tr.g.destroy())
    safeDestroy(() => tr.comet.destroy())
  }
  app?.ticker.remove(updateTraces)
}

// --- drop in / out -------------------------------------------------------------
function teaseColumn(col: number) {
  clearLayer(teaseLayer)
  teasing.value = col >= 0
  if (col < 0 || !PIXI || !GSAP || !teaseLayer) return
  const g = new PIXI.Graphics()
  const x = PAD + col * STEP
  g.roundRect(x - 6, PAD - 6, CELL + 12, BOARD_H + 12, 16).stroke({ color: 0xff8a1f, width: 16, alpha: 0.3 })
  g.roundRect(x - 2, PAD - 2, CELL + 4, BOARD_H + 4, 13).stroke({ color: 0xffc247, width: 4, alpha: 0.9 })
  g.roundRect(x, PAD, CELL, BOARD_H, 12).fill({ color: 0xff8a1f, alpha: 0.18 })
  g.blendMode = 'add'
  teaseLayer.addChild(g)
  GSAP.fromTo(g, { alpha: 0.35 }, { alpha: 1, duration: 0.3, yoyo: true, repeat: -1, ease: 'sine.inOut' })
  fx?.emit(x + CELL / 2, PAD + BOARD_H, { count: 22, kind: 'flame', angle: -Math.PI / 2, cone: 0.5, speed: [200, 420], gravity: -60, life: 0.9, colors: [0xff8a1f, 0xffe0a0, 0xff4a1a] })
}

/** Symbols (never the portals) fall out through the bottom, sharp: accelerate, shrink a touch, fade. */
function dropOut(): Promise<void> {
  const jobs: Promise<void>[] = []
  clearLayer(frameLayer)
  clearTraces()
  undim()
  for (let col = 0; col < EP_COLS; col++) {
    for (let row = 0; row < EP_ROWS; row++) {
      const v = views[col]![row]
      if (!v) continue
      views[col]![row] = null
      const d = col * 0.03 + (EP_ROWS - 1 - row) * 0.015
      jobs.push(Promise.all([
        anim(v.box, { y: v.box.y + BOARD_H * 0.8, alpha: 0, duration: 0.34, delay: d, ease: 'power3.in' }),
        anim(v.box.scale, { x: 0.86, y: 0.86, duration: 0.34, delay: d, ease: 'power2.in' })
      ]).then(() => destroyView(v)))
    }
  }
  return Promise.all(jobs).then(() => {})
}

async function dropColumn(col: number, symbols: EpSymbol[], slow: boolean): Promise<void> {
  const jobs: Promise<void>[] = []
  const held = new Set<number>()
  for (const p of portals.values()) held.add(cellKey(p.col, p.row))
  const fall = slow ? 0.6 : 0.34
  for (let row = 0; row < EP_ROWS; row++) {
    const sym = symbols[row]!
    if (sym === 'wild' || held.has(cellKey(col, row))) continue
    const old = views[col]![row]
    if (old) destroyView(old)
    const target = cy(row)
    const v = makeView(sym, col, row, target - BOARD_H - PAD)
    setTexture(v, blurTex[sym])
    views[col]![row] = v
    const d = (EP_ROWS - 1 - row) * 0.02
    jobs.push((async () => {
      // Blurred while it streaks in; sharp again before it lands.
      await anim(v.box, { y: target - CELL * 0.35, duration: fall * 0.82, delay: d, ease: 'power2.in' })
      setTexture(v, sharpTex[sym])
      await anim(v.box, { y: target, duration: fall * 0.18, ease: 'none' })
      if (skipping) return
      await anim(v.box.scale, { x: 1.1, y: 0.84, duration: 0.06, ease: 'power1.out' })
      await anim(v.box.scale, { x: 1, y: 1, duration: 0.26, ease: 'back.out(3)' })
    })())
  }
  await Promise.all(jobs)
}

function onColumnLanded(col: number, symbols: EpSymbol[], scattersSoFar: number) {
  sfx('land', col)
  if (!skipping) {
    fx?.emit(cx(col), PAD + BOARD_H - 8, { count: 7, kind: 'mote', angle: -Math.PI / 2, cone: 2.6, speed: [40, 150], gravity: 60, life: 0.5, scale: 0.35, spread: CELL * 0.35 })
  }
  let n = scattersSoFar
  symbols.forEach((sym, row) => {
    if (sym !== 'scatter') return
    sfx('scatter', n)
    n++
    const v = views[col]![row]
    if (skipping || !v) return
    // Scatters slam in.
    void anim(v.box.scale, { x: 1, y: 1, duration: 0.45, ease: 'back.out(3.4)', startAt: { x: 1.8, y: 1.8 } })
    fx?.shockwave(cx(col), cy(row), 0xff8a1f, 150, 0.6, 10)
    fx?.bloom(cx(col), cy(row), 0xffb347, CELL * 2.6, 0.6)
    fx?.emit(cx(col), cy(row), { count: 20, kind: 'spark', colors: [0xffc247, 0xff5a1a, 0xffffff], speed: 300 })
    if (stageRoot) fx?.shake(stageRoot, 3, 0.25)
  })
}

/** Pulse the scatters already on the board while the next columns tease. */
function pulseScatters(grid: EpSymbol[][], upto: number) {
  for (let c = 0; c < upto; c++) {
    grid[c]!.forEach((sym, row) => {
      const v = views[c]![row]
      if (sym !== 'scatter' || !v || skipping) return
      void anim(v.box.scale, { x: 1.14, y: 1.14, duration: 0.28, yoyo: true, repeat: 1, ease: 'sine.inOut' })
      fx?.bloom(cx(c), cy(row), 0xff8a1f, CELL * 2, 0.5)
    })
  }
}

/** Drop a new screen in column by column; after two scatters every later column crawls in. */
async function dropIn(grid: EpSymbol[][]) {
  const landings: Promise<void>[] = []
  let scatters = 0
  const step = turbo.value ? 30 : 70
  for (let col = 0; col < EP_COLS; col++) {
    const tease = scatters >= FS_TRIGGER - 1 && !skipping
    if (tease) {
      await Promise.all(landings)
      teaseColumn(col)
      pulseScatters(grid, col)
      sfx('tease', turbo.value ? 0.7 : 1.3)
      say(scatters >= FS_TRIGGER ? `${scatters} scatters. More means more spins` : 'Two scatters. One more!')
      await delay(turbo.value ? 600 : 1150)
    }
    const before = scatters
    const column = grid[col]!
    landings.push(dropColumn(col, column, tease).then(() => onColumnLanded(col, column, before)))
    scatters += column.filter(s => s === 'scatter').length
    if (step > 0 && !skipping) await delay(step / speed())
  }
  await Promise.all(landings)
  teaseColumn(-1)
}

// --- tumbles ---------------------------------------------------------------------
/**
 * One tumble step, strictly in order: show the clusters and the win, burn
 * every paid symbol (portal targets included) until the cells are empty, move
 * the portals, then let symbols fall and fresh ones drop.
 */
async function playTumble(t: EpTumble, theBet: number, meterTo: number, index: number) {
  const cells = new Set<number>()
  const portalIds = new Set<number>()
  for (const c of t.clusters) {
    for (const cell of c.cells) cells.add(cellKey(cell.col, cell.row))
    for (const id of c.wilds) portalIds.add(id)
  }
  const multiple = t.win / theBet

  // 1. Highlight and pay.
  winning.value = true
  dim(cells, portalIds)
  for (const c of t.clusters) traceCluster(c)
  for (const k of cells) {
    const v = views[Math.floor(k / EP_ROWS)]![k % EP_ROWS]
    if (v && !skipping) void anim(v.box.scale, { x: 1.14, y: 1.14, duration: 0.22, yoyo: true, repeat: 1, ease: 'sine.inOut' })
  }
  sfx(multiple >= 5 ? 'win-big' : multiple >= 1 ? 'win' : 'win-small', Math.min(1, multiple / 5 + index * 0.1))
  for (const c of t.clusters) {
    const p = centroid(c.cells)
    const color = EP_SYMBOLS[c.symbol].color
    if (!skipping) fx?.bloom(p.x, p.y, hex(color), CELL * (2 + Math.min(3, c.size / 5)), 0.6)
    flyToWin(p.x, p.y, `+${formatNumber(c.amount)}`, color, c.amount / theBet >= 5)
    if (c.wilds.length) floatText(p.x, p.y + 34, `×${formatNumber(c.mult, false)}`, hex(tierCss(c.mult).glow), 30)
  }
  for (const id of portalIds) {
    const p = portals.get(id)
    if (!p || skipping) continue
    void anim(p.box.scale, { x: 1.2, y: 1.2, duration: 0.18, yoyo: true, repeat: 1, ease: 'sine.inOut' })
    fx?.bloom(p.box.x, p.box.y, tierColors(p.tier).glow, CELL * 3, 0.5)
  }
  say(t.clusters.length > 1 ? `${t.clusters.length} clusters pay ${formatNumber(t.win)}` : `${t.clusters[0]!.size} ${EP_SYMBOLS[t.clusters[0]!.symbol].name} pay ${formatNumber(t.win)}`)
  await countWin(meterTo, multiple >= 5 ? 1 : 0.6)
  await delay(inFreeSpins.value ? 380 : 480)

  // 2. Explode every paid symbol, including the cells portals are about to land on.
  const burn = new Map<number, Cell>()
  for (const c of t.clusters) for (const cell of c.cells) burn.set(cellKey(cell.col, cell.row), cell)
  for (const cell of t.removed) burn.set(cellKey(cell.col, cell.row), cell)
  const burns: Promise<void>[] = []
  for (const cell of burn.values()) {
    const v = views[cell.col]![cell.row]
    if (!v) continue
    views[cell.col]![cell.row] = null
    const color = hex(EP_SYMBOLS[v.id].color)
    if (!skipping) {
      const x = cx(cell.col)
      const y = cy(cell.row)
      fx?.emit(x, y, { count: 6, kind: 'shard', speed: [180, 420], life: 0.8, scale: 0.55, colors: [color, 0xffffff] })
      fx?.emit(x, y, { count: 8, kind: 'mote', speed: [60, 220], gravity: -140, life: 0.8, scale: 0.4 })
      fx?.bloom(x, y, color, CELL * 1.6, 0.35)
    }
    v.sprite.tint = 0xffd0a0
    burns.push(Promise.all([
      anim(v.box.scale, { x: 1.35, y: 1.35, duration: 0.2, ease: 'power2.out' }),
      anim(v.box, { alpha: 0, duration: 0.22, ease: 'power1.in' })
    ]).then(() => destroyView(v)))
  }
  sfx('burn', index)
  if (stageRoot && !skipping) fx?.shake(stageRoot, Math.min(12, 2 + multiple * 1.2), 0.3 + Math.min(0.4, multiple * 0.03))
  clearTraces()
  clearLayer(frameLayer)
  await Promise.all(burns)

  // 3. Portals open, jump and merge into the now-empty cells.
  await playPortalChanges(t)
  undim()
  portalHud.value = t.wilds.map(w => ({ ...w }))

  // 4. Falls and fresh symbols.
  const falls = t.falls.map(f => ({ f, v: views[f.col]![f.from] ?? null }))
  for (const { f } of falls) views[f.col]![f.from] = null
  const jobs: Promise<void>[] = []
  const dur = (rows: number) => 0.2 + rows * 0.045
  const land = (v: SymView) => skipping
    ? Promise.resolve()
    : anim(v.box.scale, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)', startAt: { x: 1.08, y: 0.88 } })
  for (const { f, v } of falls) {
    if (!v) continue
    views[f.col]![f.to] = v
    jobs.push(anim(v.box, { y: cy(f.to), duration: dur(f.to - f.from), ease: 'power2.in' }).then(() => land(v)))
  }
  const freshCount = new Array(EP_COLS).fill(0)
  for (const n of t.fresh) freshCount[n.col]++
  for (const n of t.fresh) {
    const drop = freshCount[n.col] * STEP + PAD
    const v = makeView(n.symbol, n.col, n.row, cy(n.row) - drop)
    views[n.col]![n.row] = v
    jobs.push(anim(v.box, { y: cy(n.row), duration: dur(freshCount[n.col]), delay: 0.05 + n.col * 0.02, ease: 'power2.in' }).then(() => land(v)))
  }
  sfx('tumble', index)
  await Promise.all(jobs)
  sfx('land', 3)
}

/** Spawn, grow, jump and merge portals as the server moved them. */
async function playPortalChanges(t: EpTumble) {
  const jobs: Promise<void>[] = []
  for (const ch of t.wildChanges) {
    const to = ch.to
    const x = cx(to.col)
    const y = cy(to.row)
    if (ch.kind === 'spawn') {
      const p = makePortal(ch.id, to.col, to.row, ch.mult)
      p.box.scale.set(0)
      p.box.rotation = -2.4
      sfx('portal-open')
      if (!skipping) {
        const colors = tierColors(p.tier)
        fx?.vortex(x, y, [...colors.flames, 0xffffff], CELL * 1.3, isPhone ? 20 : 36, 0.55 * speed())
        fx?.bloom(x, y, 0xffffff, CELL * 3, 0.4)
        fx?.bloom(x, y, colors.glow, CELL * 3.4, 0.8)
        fx?.shockwave(x, y, colors.glow, CELL * 1.6, 0.6, 8)
      }
      jobs.push((async () => {
        await delay(180)
        await Promise.all([
          anim(p.box.scale, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2.2)' }),
          anim(p.box, { rotation: 0, duration: 0.5, ease: 'power3.out' })
        ])
      })())
      continue
    }
    // Merged portals fly in as fireballs with trails.
    const flights: Promise<void>[] = []
    for (const mid of ch.merged) {
      const m = portals.get(mid)
      if (!m) continue
      const colors = tierColors(m.tier)
      const from = { x: m.box.x, y: m.box.y }
      destroyPortal(m)
      if (!skipping && fx) flights.push(fx.fireball(from.x, from.y, x, y, [colors.glow, ...colors.flames], 0.5 * speed()))
    }
    const from = ch.from ?? to
    const keeper = portals.get(ch.id) ?? makePortal(ch.id, from.col, from.row, ch.prevMult)
    keeper.col = to.col
    keeper.row = to.row
    sfx(ch.merged.length ? 'portal-merge' : 'portal-grow', Math.min(1, ch.mult / 25))
    jobs.push((async () => {
      const lift = Math.min(60, Math.hypot(keeper.box.x - x, keeper.box.y - y) * 0.3)
      await Promise.all([
        ...flights,
        anim(keeper.box, { x, duration: 0.45, ease: 'power2.inOut' }),
        anim(keeper.box, { y: y - lift, duration: 0.22, ease: 'power2.out' }).then(() => anim(keeper.box, { y, duration: 0.23, ease: 'power2.in' })),
        anim(keeper.box.scale, { x: 1.3, y: 1.3, duration: 0.22, yoyo: true, repeat: 1, ease: 'sine.inOut' })
      ])
      keeper.box.scale.set(1)
      if (ch.merged.length && !skipping) {
        fx?.shockwave(x, y, 0xffffff, CELL * 2.6, 0.7, 14)
        fx?.shockwave(x, y, tierColors(tierIndex(ch.mult)).glow, CELL * 3.4, 0.9, 10)
        if (stageRoot) fx?.shake(stageRoot, 7, 0.4)
      }
      paintPortal(keeper, ch.mult, true)
      if (!skipping) floatText(x, y - CELL * 0.62, `×${formatNumber(ch.mult, false)}`, hex(tierCss(ch.mult).glow), 32)
    })())
  }
  await Promise.all(jobs)
}

/** Replay one spin's tumbles; the meter counts up from `meterBase`. */
async function playTumbles(spin: EpSpin, theBet: number, meterBase: number) {
  let acc = 0
  for (const [i, t] of spin.tumbles.entries()) {
    if (destroyed) return
    acc += t.win
    await playTumble(t, theBet, meterBase + acc, i)
    syncBoard(spin.tumbles[i + 1]?.grid ?? spin.finalGrid, t.wilds)
  }
  syncBoard(spin.finalGrid, spin.wildsEnd)
  winning.value = false
}

/** Implode every open portal (at the next spin, or before the free spins). */
async function closePortals() {
  if (!portals.size) return
  const jobs: Promise<void>[] = []
  for (const p of [...portals.values()]) {
    portals.delete(p.id)
    if (!skipping) {
      fx?.vortex(p.box.x, p.box.y, tierColors(p.tier).flames, CELL, isPhone ? 10 : 18, 0.4)
      fx?.bloom(p.box.x, p.box.y, tierColors(p.tier).glow, CELL * 2, 0.4)
    }
    jobs.push(Promise.all([
      anim(p.box.scale, { x: 0, y: 0, duration: 0.38, ease: 'back.in(2)' }),
      anim(p.box, { rotation: 2.5, duration: 0.38, ease: 'power2.in' })
    ]).then(() => {
      killAnims(p.box, p.box.scale, p.label.scale)
      p.flame.destroy()
      safeDestroy(() => p.box.destroy({ children: true }))
    }))
  }
  restingWilds = []
  await Promise.all(jobs)
  portalHud.value = []
}

// --- big win / cards ----------------------------------------------------------------
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
  fx.fountain(isPhone ? 14 : 26, [0xffc247, 0xff8a1f, 0xffffff])
  const rays: RaysHandle = fx.lightRays(APP_W / 2, APP_H / 2, BIG_TIERS[0].color)
  fx.flash(0xffb060, 0.6, 0.35)
  sfx('bigwin', 0)
  fx.shockwave(APP_W / 2, APP_H / 2, BIG_TIERS[0].color, 380, 0.8, 12)

  const seconds = (2.2 + top * 1.4) * (turbo.value ? 0.6 : 1)
  const meterFloor = winMeter.value
  const obj = { v: 0 }
  await new Promise<void>((resolve) => {
    const tw = GSAP!.to(obj, {
      v: amount,
      duration: seconds,
      ease: 'power1.inOut',
      onUpdate: () => {
        bigWin.amount = obj.v
        bigWin.multiple = obj.v / theBet
        winMeter.value = Math.max(meterFloor, base + obj.v)
        sfx('count')
        const t = tierFor(obj.v / theBet)
        if (t > bigWin.tier) {
          const color = BIG_TIERS[t]!.color
          bigWin.tier = t
          bigWin.label = BIG_TIERS[t]!.label
          winPulse.value++
          sfx('bigwin', t)
          rays.setColor(color)
          fx!.flash(color, 0.55, 0.4)
          fx!.fountain((isPhone ? 14 : 26) + t * (isPhone ? 5 : 12), [color, 0xffc247, 0xffffff])
          fx!.shockwave(APP_W / 2, APP_H / 2, color, 440, 0.9, 14)
          fx!.emit(APP_W / 2, APP_H / 2, { count: 40 + t * 18, kind: 'flame', speed: [300, 700 + t * 80], gravity: 200, life: 1, scale: 1.2, colors: [color, 0xffc247, 0xffffff] })
          fx!.shake(stageRoot!, 6 + t * 2, 0.5)
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
  sfx('count-end')
  fx.emit(APP_W / 2, APP_H / 2, { count: 70, kind: 'mote', speed: 640, gravity: 300, life: 1.2, scale: 0.8 })
  skipping = false
  await delay(2000)
  fx.fountain(0)
  rays.destroy()
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
  card.countMs = Math.round(ms * 0.55 * speed())
  card.show = true
  if (dimLayer && GSAP) GSAP.to(dimLayer, { alpha: 0.6, duration: 0.3 })
  await delay(autoplay.active ? ms * 0.7 : ms)
  card.show = false
  if (dimLayer && GSAP) GSAP.to(dimLayer, { alpha: 0, duration: 0.3 })
  await delay(250)
  skipping = false
}

function launchSpinButton() {
  launching.value = false
  requestAnimationFrame(() => {
    launching.value = true
    setTimeout(() => { launching.value = false }, 320)
  })
}

// --- spin flow -----------------------------------------------------------------
function resetRound() {
  winMeter.value = 0
  winning.value = false
  errorMsg.value = ''
  meterTween?.kill()
  clearLayer(frameLayer)
  clearLayer(floatLayer)
  clearTraces()
  clearFlyers()
  teaseColumn(-1)
  undim()
}

type Mode = 'normal' | 'ante' | 'buy'

async function spin(buy = false) {
  if (!ready.value || phase.value !== 'idle' || !symbolLayer) return
  sound.unlock()
  sound.startMusic()
  const mode: Mode = buy ? 'buy' : ante.value ? 'ante' : 'normal'
  const cost = mode === 'buy' ? buyCost.value : spinCost.value
  if (balance.value < cost) {
    errorMsg.value = 'Not enough coins for this bet'
    sfx('error')
    stopAutoplay()
    return
  }
  const balanceBefore = balance.value
  const gridBefore = shownGrid.map(c => c.slice())
  const wildsBefore = restingWilds.map(w => ({ ...w }))
  let debited = false
  let clearing: Promise<unknown> = Promise.resolve()
  skipping = false
  resultIn.value = false

  const options = mode === 'buy' ? { feature: 'buy' } : mode === 'ante' ? { ante: true } : undefined
  const data = await requestSpin(cost, options, () => {
    phase.value = 'spinning'
    debited = true
    setBalance(balanceBefore - cost)
    resetRound()
    launchSpinButton()
    sfx(mode === 'buy' ? 'buy' : 'spin')
    say(mode === 'buy' ? 'The portals stir' : 'Spinning')
    // The last round's portals implode as its symbols fall away.
    clearing = Promise.all([dropOut(), closePortals()])
  })

  if (!data) {
    if (debited) {
      await clearing
      setBalance(balanceBefore)
      syncBoard(gridBefore, wildsBefore)
      restingWilds = wildsBefore
      say(errorMsg.value || 'Spin failed')
      sfx('error')
      phase.value = 'idle'
      stopAutoplay()
      void fetchSession()
    }
    return
  }

  const result = data.gameData
  try {
    await clearing
    resultIn.value = true
    await dropIn(result.base.grid)
    syncBoard(result.base.grid, [])
    if (destroyed) return
    phase.value = 'presenting'

    if (result.base.tumbles.length) {
      await playTumbles(result.base, result.bet, 0)
    } else if (!result.freeSpins) {
      say('No cluster this time')
    }

    if (result.freeSpins && !destroyed) {
      phase.value = 'bonus'
      autoplay.bonusHit()
      await bonusCinematic(result)
      await playFreeSpins(result)
      const multiple = result.payout / result.bet
      if (tierFor(multiple) >= 0 && !destroyed) await showBigWin(result.payout, multiple)
    } else if (result.basePayout > 0 && !destroyed) {
      const multiple = result.basePayout / result.bet
      if (tierFor(multiple) >= 0) {
        await showBigWin(result.basePayout, multiple)
      } else {
        sfx(multiple >= 1 ? 'win' : 'win-small', Math.min(1, multiple / 5))
        await delay(300)
      }
    }

    winMeter.value = result.payout
    setBalance(data.balance)
    pushHistory({ payout: result.payout, bet: result.cost, bonus: result.bonusTriggered })
    if (result.payout > 0) say(`You won ${formatNumber(result.payout)}`)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    setBalance(data.balance)
    stopAutoplay()
  } finally {
    isSpinning.value = false
    phase.value = 'idle'
    resultIn.value = false
    winning.value = false
    inFreeSpins.value = false
    bonusScene.value = false
    warp.show = false
    teaseColumn(-1)
    if (!destroyed) {
      // The settled board keeps its portals burning until the next spin.
      const last = result.freeSpins?.spins.at(-1)
      const end = last ?? result.base
      restingWilds = end.wildsEnd.map(w => ({ ...w }))
      syncBoard(end.finalGrid, restingWilds)
      portalHud.value = []
    }
    void fetchSession()
  }

  if (destroyed) return
  continueAutoplay(result)
}

/** Scatters beam into the centre, the screen flares and a giant portal swallows the view. */
async function bonusCinematic(result: EmberPortalsResult) {
  const fs = result.freeSpins!
  skipping = false
  const scatters = result.base.scatters
  dim(new Set(scatters.map(c => cellKey(c.col, c.row))))
  sfx('bonus-trigger')
  say(fs.source === 'buy' ? 'The portals awaken' : `${scatters.length} scatters: ${fs.awarded} free spins`)
  const mx = APP_W / 2
  const my = APP_H / 2
  for (const c of scatters) {
    const v = views[c.col]![c.row]
    if (v) void anim(v.box.scale, { x: 1.3, y: 1.3, duration: 0.25, yoyo: true, repeat: 3, ease: 'sine.inOut' })
    fx?.shockwave(cx(c.col), cy(c.row), 0xff8a1f, 170, 0.8, 10)
    fx?.bloom(cx(c.col), cy(c.row), 0xffb347, CELL * 3, 0.9)
  }
  await delay(550)
  for (const c of scatters) fx?.beam(cx(c.col), cy(c.row), mx, my, 0xffb347, 1.1, 16)
  fx?.bloom(mx, my, 0xffffff, 420, 1)
  if (stageRoot) fx?.shake(stageRoot, 12, 0.9)
  await delay(650)
  fx?.flash(0xffc890, 0.9, 0.6)
  await closePortals()
  undim()
  warp.color = '#ff8a1f'
  warp.show = true
  sfx('fs-start')
  await delay(1000)
  bonusScene.value = true
  await delay(1300)
  warp.show = false
}

async function playFreeSpins(result: EmberPortalsResult) {
  const fs = result.freeSpins!
  inFreeSpins.value = true
  bonusScene.value = true
  fsSpin.value = 0
  fsTotalSpins.value = fs.awarded
  fsTotal.value = 0
  portalHud.value = []
  if (!destroyed) sound.setBonusMusic(true)
  fx?.fountain(isPhone ? 8 : 16, [0xffc247, 0xff5a1a, 0xffffff])
  await showCard('fs', `${fs.awarded} Free Spins`, 'Portals stay open and keep growing until the last spin.', 0, 2600)
  fx?.fountain(0)

  const before = winMeter.value
  for (const spin of fs.spins) {
    if (destroyed) return
    skipping = false
    fsSpin.value = spin.index + 1
    say(`Free spin ${spin.index + 1} of ${fsTotalSpins.value}`)
    sfx('spin')
    // Only the symbols drop: open portals hold their cells.
    await dropOut()
    await dropIn(spin.grid)
    syncBoard(spin.grid, spin.wildsStart)
    if (destroyed) return

    const prev = fsTotal.value
    if (spin.tumbles.length) await playTumbles(spin, result.bet, before + prev)
    fsTotal.value = spin.runningTotal
    winMeter.value = before + fsTotal.value
    portalHud.value = spin.wildsEnd.map(w => ({ ...w }))

    if (spin.retrigger > 0) {
      fsTotalSpins.value = spin.totalSpins
      sfx('retrigger')
      dim(new Set(spin.scatters.map(c => cellKey(c.col, c.row))))
      for (const c of spin.scatters) {
        fx?.beam(cx(c.col), cy(c.row), APP_W / 2, APP_H / 2, 0x7fdcff, 0.9, 12)
        fx?.shockwave(cx(c.col), cy(c.row), 0x7fdcff, 150, 0.7, 10)
      }
      fx?.flash(0x9fe8ff, 0.6, 0.45)
      fx?.emit(APP_W / 2, APP_H / 2, { count: 60, kind: 'spark', speed: [300, 700], life: 0.9, scale: 0.8, colors: [0x7fdcff, 0xffffff, 0xffc247] })
      if (stageRoot) fx?.shake(stageRoot, 8, 0.5)
      await showCard('retrigger', `+${spin.retrigger} Spins`, 'More scatters. The portals stay open.', 0, 1600)
      undim()
    }
    await delay(spin.tumbles.length ? 250 : 450)
  }
  if (destroyed) return

  // The final portals stay burning through the outro and until the next spin.
  const peak = Math.max(0, ...portalHud.value.map(w => w.mult))
  skipping = false
  await delay(300)
  if (!destroyed) sound.setBonusMusic(false)
  sfx('fs-end')
  if (fs.total > 0) {
    fx?.fountain(isPhone ? 16 : 30, [0xffc247, 0xff8a1f, 0xffffff])
    fx?.flash(0xffb060, 0.5, 0.4)
  }
  const sub = fs.total > 0
    ? `${fsTotalSpins.value} spins${peak > 1 ? `, biggest portal ×${formatNumber(peak, false)}` : ''}`
    : 'The portals stayed quiet this time'
  await showCard('fs-end', fs.capped ? 'Max Win!' : 'Feature Complete', sub, fs.total, 3000)
  fx?.fountain(0)
  inFreeSpins.value = false
  say(fs.total > 0 ? `Free spins paid ${formatNumber(fs.total)}` : 'The portals stayed quiet')
}

/** Space / spin button while busy: hurry the presentation along. */
function hurry() {
  if (phase.value === 'spinning' && !resultIn.value) return
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

// --- autoplay ----------------------------------------------------------------------
function startAutoplay(settings: SlotAutoSettings) {
  autoplay.start(settings, balance.value)
  sfx('click')
  if (phase.value === 'idle') void spin()
}

function stopAutoplay() {
  autoplay.stop()
}

function continueAutoplay(result: EmberPortalsResult) {
  if (!autoplay.active) return
  if (!autoplay.finish({ payout: result.payout, bet: result.cost, bonus: result.bonusTriggered }, balance.value, spinCost.value)) {
    if (balance.value < spinCost.value) errorMsg.value = 'Autoplay stopped: balance too low'
    return
  }
  setTimeout(() => {
    if (!destroyed && autoplay.active) void spin()
  }, turbo.value ? 150 : 350)
}

function buyBonus(id: string) {
  if (phase.value !== 'idle' || autoplay.active || id !== 'buy') return
  void spin(true)
}

function openBuy() {
  if (!ready.value || phase.value !== 'idle' || autoplay.active) return
  click()
  showBuy.value = true
}

// --- template helpers ---------------------------------------------------------------
const canSpin = computed(() => ready.value && balance.value >= spinCost.value)
const spinMode = computed<SlotSpinMode>(() => {
  if (phase.value === 'spinning' && !resultIn.value) return 'wait'
  if (phase.value !== 'idle') return 'skip'
  return 'spin'
})
const buyLocked = computed(() => !ready.value || phase.value !== 'idle' || autoplay.active)
const portalChipColor = (m: number) => tierCss(m).glow
</script>

<template>
  <div
    ref="pageEl"
    class="ep-page"
    :class="{ 'is-bonus': inFreeSpins, 'is-bonus-scene': bonusScene, 'is-ante': ante, 'is-tease': teasing, 'is-winning': winning }"
    :style="{ ...fontVars, '--frame': frameGlow, '--ep-ring': spinRingArt ? `url(${spinRingArt})` : 'none' }"
  >
    <div ref="sceneEl" class="ep-scene" aria-hidden="true">
      <div class="ep-scene__set" data-scene="base" />
      <div class="ep-scene__set ep-scene__set--bonus" data-scene="bonus" />
    </div>
    <canvas ref="driftEl" class="ep-drift" aria-hidden="true" />
    <div class="ep-scene__veil" aria-hidden="true" />

    <!-- The board floats on the scene; signs hang beside it, no slab behind. -->
    <div class="ep-stage">
      <div class="ep-layout">
        <!-- Left: two hanging signs -->
        <aside class="ep-left">
          <div class="ep-hang ep-hang--buy" :class="{ 'is-locked': buyLocked }">
            <button :ref="plaqueRef" type="button" class="ep-sign ep-sign--buy" data-plaque="fire" :disabled="buyLocked" @click="openBuy">
              <img v-if="buyArt" :src="buyArt" alt="" class="ep-sign__art">
              <span class="ep-title">Buy<br>Free Spins</span>
              <EpFiligree class="ep-sign__rule" gem="#ff8a1f" />
              <span class="ep-num ep-num--gold">{{ formatNumber(buyCost) }}</span>
            </button>
          </div>

          <div class="ep-hang" :class="{ 'is-on': ante }">
            <div :ref="plaqueRef" class="ep-sign ep-sign--ante" data-plaque="gold" :class="{ 'is-on': ante }">
              <span class="ep-title ep-title--sm">Extra<br>Chance</span>
              <span class="ep-label">Bet</span>
              <span class="ep-num" :class="ante ? 'ep-num--gold' : 'ep-num--teal'">{{ formatNumber(bet * EP_ANTE_COST) }}</span>
              <span class="ep-label">More scatters</span>
              <button
                type="button"
                role="switch"
                class="ep-switch"
                :aria-checked="ante"
                :disabled="betLocked"
                aria-label="Extra chance of scatters"
                @click="toggleAnte"
              >
                <span class="ep-switch__knob" />
                <span class="ep-switch__state">{{ ante ? 'On' : 'Off' }}</span>
              </button>
            </div>
          </div>
        </aside>

        <!-- Centre: the board is the hero, the win is lettered under it -->
        <div class="ep-center">
          <div class="ep-board" :data-winning="winning">
            <div class="ep-board__heat" aria-hidden="true" />
            <div class="ep-board__inner">
              <div ref="canvasWrap" class="ep-canvas" />

              <div v-if="!ready && !loadError" class="ep-overlay">
                <div class="flex flex-col items-center gap-3" role="status">
                  <UIcon class="size-8 animate-spin text-primary" name="i-lucide-loader-circle" />
                  <span class="text-sm text-muted">Kindling the portals…</span>
                </div>
              </div>
              <div v-if="loadError" class="ep-overlay">
                <p class="text-sm text-error">
                  {{ loadError }}
                </p>
              </div>

              <Transition name="ep-pop">
                <EpCard
                  v-if="card.show"
                  :kind="card.kind"
                  :title="card.title"
                  :sub="card.sub"
                  :amount="card.amount"
                  :count-ms="card.countMs"
                  :art="card.kind === 'fs' ? ringArt : undefined"
                  @skip="requestSkip"
                />
              </Transition>

              <Transition name="ep-pop">
                <EpBigWin
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

          <EpWinDisplay
            ref="winDisplay"
            :amount="winMeter"
            :label="inFreeSpins ? 'Feature win' : 'Win'"
            :pulse="winPulse"
            :glow="winGlow"
            :hot="winMeter > 0"
          />
        </div>

        <!-- Right: logo, then the portal legend or the free-spins sign -->
        <aside class="ep-right">
          <div class="ep-logo">
            <img v-if="logoArt" :src="logoArt" alt="Ember Portals" class="ep-logo__img">
            <h1 v-else class="ep-title">
              Ember Portals
            </h1>
          </div>

          <Transition name="ep-fade" mode="out-in">
            <div v-if="inFreeSpins" key="fs" class="ep-hang">
              <div :ref="plaqueRef" class="ep-sign ep-sign--fs" data-plaque="stone">
                <span class="ep-label">Spins left</span>
                <span class="ep-num ep-num--big">{{ fsLeft }}<small> / {{ fsTotalSpins }}</small></span>
                <EpFiligree class="ep-sign__rule" />
                <span class="ep-label">Feature win</span>
                <span class="ep-num ep-num--gold">{{ formatNumber(fsTotal) }}</span>
                <EpFiligree class="ep-sign__rule" />
                <span class="ep-label">Open portals<template v-if="portalChips.length"> · Σ ×{{ formatNumber(portalSum, false) }}</template></span>
                <span class="ep-portals">
                  <span v-if="!portalChips.length" class="ep-label">none yet</span>
                  <span
                    v-for="w in portalChips.slice(0, 8)"
                    :key="w.id"
                    class="ep-portals__mult"
                    :style="{ '--c': portalChipColor(w.mult) }"
                  >×{{ formatNumber(w.mult, false) }}</span>
                  <span v-if="portalChips.length > 8" class="ep-label">+{{ portalChips.length - 8 }}</span>
                </span>
              </div>
            </div>
            <div v-else key="legend" class="ep-legend">
              <p class="ep-legend__head">
                <span class="ep-rune" aria-hidden="true">ᛟ</span>
                Portal fire
                <span class="ep-rune" aria-hidden="true">ᛟ</span>
              </p>
              <EpFiligree />
              <ul class="ep-legend__list">
                <li v-for="t in tierLegend" :key="t.min" :style="{ '--c': t.glow }">
                  <img :src="t.url" alt="" class="ep-legend__ring">
                  <span class="ep-legend__mult">×{{ t.min }}</span>
                  <span class="ep-legend__name">{{ t.name }}</span>
                </li>
              </ul>
              <EpFiligree />
            </div>
          </Transition>
        </aside>
      </div>

      <!-- Control deck: one slim glass strip -->
      <div class="ep-deck" :class="{ 'is-launch': launching }">
        <SlotControlBar
          v-model:sound-on="soundEnabled"
          v-model:volume="soundVolume"
          v-model:music-volume="musicVolume"
          :theme="EMBER_BAR_THEME"
          :balance="balance"
          :bet="bet"
          :bet-min="MIN_BET"
          :bet-max="MAX_BET"
          :bet-locked="betLocked"
          :bet-hint="ante ? `Extra chance · ${formatNumber(spinCost)}` : ''"
          :win="winMeter"
          :show-win="false"
          :spin-mode="spinMode"
          :spin-disabled="!canSpin"
          :auto-left="autoplay.left"
          :auto-disabled="!canSpin || phase !== 'idle'"
          :spin-cost="spinCost"
          :turbo="turbo"
          :buys="[]"
          :space-blocked="showHelp || showBuy"
          @spin="onSpinButton"
          @bet-down="betDown"
          @bet-up="betUp"
          @bet-max="maxBet"
          @bet-set="typeBet"
          @auto-start="startAutoplay"
          @auto-stop="click(); stopAutoplay()"
          @toggle-turbo="toggleTurbo"
          @info="click(); showHelp = true"
          @ui-click="click"
        />
      </div>

      <div v-if="history.length" class="ep-history">
        <span class="ep-label">Last rounds</span>
        <span
          v-for="(h, i) in history"
          :key="i"
          class="ep-history__chip"
          :class="{ 'is-win': h.payout > h.bet, 'is-bonus': h.bonus }"
        >
          <span v-if="h.bonus" class="ep-rune" aria-hidden="true">ᛟ</span>
          {{ h.payout > 0 ? formatNumber(h.payout) : '–' }}
        </span>
      </div>

      <Transition name="ep-fade">
        <div v-if="errorMsg" class="ep-error">
          <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0" />
          <span class="flex-1">{{ errorMsg }}</span>
          <button aria-label="Dismiss" @click="errorMsg = ''">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </div>
      </Transition>
    </div>

    <p class="sr-only" role="status">
      {{ message }}
    </p>

    <div ref="flyersEl" class="ep-flyers" aria-hidden="true" />

    <Transition name="ep-fade">
      <EpWarp v-if="warp.show" :ring="ringArt" :color="warp.color" />
    </Transition>

    <SlotBuyDialog v-model:open="showBuy" :theme="EMBER_BAR_THEME" :options="buyOptions" :balance="balance" @buy="buyBonus" />
    <EpPaytable v-model:open="showHelp" :bet="bet" :font-vars="fontVars" />
  </div>
</template>

<style scoped>
/* A slot, not a dashboard: the board floats on the dark scene, signs hang
   beside it and the deck is one slim glass strip. One surface level only:
   the signs and the deck have a surface, nothing inside them does (controls
   aside). Detail comes from painted art, filigree rules and lettering.
   The scene is a fixed illustration in both colour modes, so the palette is
   fixed rather than following the site theme. */
.ep-page {
  --ep-ink: #05040f;
  --ep-gold: #e8b54a;
  --ep-gold-hi: #fff3c4;
  --ep-teal: #78f0ff;
  --ep-fire: #ff8a1f;
  --ep-text: #f4ecd8;
  --ep-muted: #b9a57a;
  --ep-bevel: linear-gradient(135deg, #fff3c4 0%, #e9b64a 18%, #8a520f 48%, #e2a93c 70%, #4a2604 100%);
  --ep-cut: polygon(14px 0, calc(100% - 14px) 0, 100% 14px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 14px 100%, 0 calc(100% - 14px), 0 14px);
  /* Size scale for the HUD around the board (0.88 on desktop). */
  --ep-s: 1;
  /* The board is the hero: as big as the viewport allows beside the signs. */
  /* Room is kept for the top padding, and the win row and deck below. */
  --board: clamp(340px, min(calc(88vh - 186px), calc(100vw - 560px)), 830px);
  position: relative;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 34px 16px 24px;
  overflow: hidden;
  isolation: isolate;
  color: var(--ep-text);
  font-family: var(--ep-ui);
  background: #05060f;
}

/* ── Scene: static backdrop ────────────────────────────────────────── */
.ep-scene {
  position: absolute;
  inset: 0;
  z-index: -3;
  overflow: hidden;
  background: #05060f;
}

.ep-scene__set {
  position: absolute;
  inset: 0;
  transition: opacity 1.2s ease;
}

.ep-scene__set--bonus { opacity: 0; }
.is-bonus-scene .ep-scene__set--bonus { opacity: 1; }
.is-bonus-scene .ep-scene__set:not(.ep-scene__set--bonus) { opacity: 0; }

.ep-scene :deep(.ep-scene__canvas) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 30%;
}

.ep-drift {
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.ep-scene__veil {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: radial-gradient(ellipse 70% 60% at 50% 45%, transparent 45%, rgba(3, 3, 10, 0.55) 100%);
}

/* ── Layout ───────────────────────────────────────────────────────── */
.ep-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.ep-layout {
  display: grid;
  /* Equal side tracks keep the board on the page's centre axis, whatever
     the signs and the legend measure; each side leans toward the board. */
  grid-template-columns: minmax(0, 1fr) var(--board) minmax(0, 1fr);
  align-items: center;
  gap: calc(28px * var(--ep-s));
  width: 100%;
}

.ep-left { justify-self: end; width: calc(220px * var(--ep-s)); max-width: 100%; }
.ep-right { justify-self: start; width: calc(240px * var(--ep-s)); max-width: 100%; }

.ep-left,
.ep-right {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(30px * var(--ep-s));
}

.ep-center {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* ── Typography ───────────────────────────────────────────────────── */
.ep-title {
  font-family: var(--ep-display);
  font-size: calc(21px * var(--ep-s));
  font-weight: 900;
  line-height: 1.05;
  letter-spacing: 0.03em;
  text-align: center;
  background: linear-gradient(180deg, #fffbe6 8%, #f5cf6a 45%, #c8862a 80%, #8a520f 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 2px 0 #0a0406);
}

.ep-title--sm { font-size: calc(17px * var(--ep-s)); }

.ep-label {
  font-family: var(--ep-ui);
  font-size: calc(10px * var(--ep-s));
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ep-muted);
}

.ep-num {
  font-family: var(--ep-number);
  font-size: calc(24px * var(--ep-s));
  font-weight: 900;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: #fff;
  text-shadow: 0 2px 0 var(--ep-ink);
}

.ep-num small { font-size: calc(14px * var(--ep-s)); color: var(--ep-muted); }
.ep-num--big { font-size: calc(38px * var(--ep-s)); text-shadow: 0 2px 0 var(--ep-ink), 0 0 16px var(--frame); }
.ep-num--gold { color: #ffd873; text-shadow: 0 2px 0 var(--ep-ink), 0 0 14px rgba(232, 181, 74, 0.6); }
.ep-num--teal { color: var(--ep-teal); text-shadow: 0 2px 0 var(--ep-ink), 0 0 12px rgba(120, 240, 255, 0.5); }

.ep-rune {
  font-size: 0.9em;
  color: var(--ep-teal);
  text-shadow: 0 0 8px rgba(120, 240, 255, 0.8);
}

/* ── Hanging signs (the one surface level beside the board) ───────── */
.ep-hang {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

/* Two gold chains hold each sign; the plaque art carries the crest gem. */
.ep-hang::before {
  content: '';
  width: 62%;
  height: calc(22px * var(--ep-s));
  border-left: 2px dotted rgba(232, 181, 74, 0.7);
  border-right: 2px dotted rgba(232, 181, 74, 0.7);
}

.ep-sign {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: calc(30px * var(--ep-s)) calc(18px * var(--ep-s)) calc(20px * var(--ep-s));
  clip-path: var(--ep-cut);
  background: var(--ep-bevel);
  color: inherit;
}

/* Painted plaque (paintEpPlaque) replaces the CSS fallback bevel once ready. */
.ep-sign.has-art {
  clip-path: none;
  background: center / 100% 100% no-repeat;
}

.ep-sign.has-art::before { display: none; }

/* Near-black glass inside the gold bevel (opaque enough that the bevel
   behind it doesn't show through). */
.ep-sign::before {
  content: '';
  position: absolute;
  inset: 2px;
  z-index: -1;
  clip-path: var(--ep-cut);
  background:
    radial-gradient(ellipse 90% 50% at 50% 0%, rgba(255, 200, 120, 0.14), transparent 70%),
    linear-gradient(180deg, rgba(14, 10, 30, 0.94), rgba(5, 4, 14, 0.96));
}

.ep-sign__rule { width: 86%; margin: 2px 0; }

.ep-sign__art {
  width: calc(92px * var(--ep-s));
  height: calc(92px * var(--ep-s));
  margin: -4px 0 2px;
  filter: drop-shadow(0 0 16px rgba(255, 138, 31, 0.85));
  animation: ep-spin 10s linear infinite;
}

.ep-sign--buy {
  cursor: pointer;
  transition: transform 0.15s, filter 0.2s;
}

/* Glows sit on the hanger: a filter on the clipped sign would be cut off. */
.ep-hang--buy { animation: ep-sign-glow 2.6s ease-in-out infinite; }
.ep-hang--buy.is-locked { animation: none; }
.ep-hang.is-on { filter: drop-shadow(0 0 16px rgba(255, 138, 31, 0.65)); }

.ep-sign--buy:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.18); }
.ep-sign--buy:focus-visible { outline: 2px solid var(--ep-fire); outline-offset: -6px; }
.ep-sign--buy:disabled { cursor: not-allowed; filter: grayscale(0.5) brightness(0.65); }

.ep-switch {
  position: relative;
  display: flex;
  align-items: center;
  width: calc(84px * var(--ep-s));
  height: calc(30px * var(--ep-s));
  margin-top: 6px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1.5px solid rgba(232, 181, 74, 0.7);
  background: rgba(3, 2, 10, 0.8);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.8);
  cursor: pointer;
  transition: background 0.2s, box-shadow 0.2s;
}

.ep-switch:disabled { cursor: not-allowed; opacity: 0.55; }
.ep-switch:focus-visible { outline: 2px solid var(--ep-fire); outline-offset: 2px; }

.ep-switch__knob {
  position: absolute;
  left: 3px;
  top: 3px;
  width: calc(21px * var(--ep-s));
  height: calc(21px * var(--ep-s));
  border-radius: 50%;
  background: linear-gradient(180deg, #fff3c4, #b98a2e);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
  transition: transform 0.2s cubic-bezier(0.3, 1.4, 0.5, 1);
}

.ep-switch__state {
  margin-left: auto;
  font-family: var(--ep-number);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  color: var(--ep-muted);
}

.is-on .ep-switch { background: linear-gradient(180deg, #ff9b3a, #c2410c); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 0 14px rgba(255, 138, 31, 0.7); }
.is-on .ep-switch__knob { transform: translateX(calc(54px * var(--ep-s))); }
.is-on .ep-switch__state { margin-left: 0; color: #2a0a02; }

/* Free-spins sign: open portal multipliers, lettered, no chips. */
.ep-portals {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 2px 10px;
  min-height: 26px;
}

.ep-portals__mult {
  font-family: var(--ep-number);
  font-size: calc(18px * var(--ep-s));
  font-weight: 900;
  color: #fff;
  text-shadow: 0 1px 0 var(--ep-ink), 0 0 10px var(--c), 0 0 18px var(--c);
  animation: ep-pop-in 0.4s cubic-bezier(0.2, 1.8, 0.4, 1);
}

/* ── Right: logo and the portal legend (no box) ──────────────────── */
.ep-logo {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
}

.ep-logo__img {
  position: relative;
  width: 100%;
  height: auto;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.7)) drop-shadow(0 0 10px rgba(232, 181, 74, 0.25));
}

.ep-legend {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
}

/* A soft darkening (not a box) so scene runes never read through the list. */
.ep-legend::before {
  content: '';
  position: absolute;
  inset: -28px -36px;
  z-index: -1;
  pointer-events: none;
  background: radial-gradient(ellipse closest-side, rgba(3, 2, 10, 0.82), rgba(3, 2, 10, 0.55) 55%, transparent);
}

.ep-legend__head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--ep-display);
  font-size: calc(16px * var(--ep-s));
  font-weight: 900;
  letter-spacing: 0.06em;
  color: #f5cf6a;
  text-shadow: 0 2px 0 var(--ep-ink), 0 0 10px rgba(232, 181, 74, 0.4);
}

.ep-legend__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 2px 6px;
}

.ep-legend__list li {
  display: grid;
  grid-template-columns: calc(38px * var(--ep-s)) auto 1fr;
  align-items: center;
  gap: calc(10px * var(--ep-s));
}

.ep-legend__ring { width: calc(38px * var(--ep-s)); height: calc(38px * var(--ep-s)); filter: drop-shadow(0 0 8px var(--c)); }
.ep-legend__mult { font-family: var(--ep-number); font-size: calc(19px * var(--ep-s)); font-weight: 900; color: #fff; text-shadow: 0 1px 0 var(--ep-ink), 0 0 10px var(--c); }
.ep-legend__name { font-size: calc(10px * var(--ep-s)); font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; text-align: right; color: var(--c); opacity: 0.9; }

/* ── Board (frame painted in the canvas) ─────────────────────────── */
.ep-board {
  position: relative;
  border-radius: 24px;
  filter: drop-shadow(0 22px 40px rgba(0, 0, 0, 0.7));
}

.ep-board::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 24px;
  pointer-events: none;
  box-shadow: 0 0 50px rgba(255, 150, 60, 0.12);
  transition: box-shadow 0.4s;
}

.ep-board[data-winning='true']::after { box-shadow: 0 0 70px rgba(255, 138, 31, 0.5); }
.is-tease .ep-board::after { animation: ep-heartbeat 0.9s ease-in-out infinite; }
.is-bonus .ep-board::after { animation: ep-frame 1.8s ease-in-out infinite; }

.ep-board__heat {
  position: absolute;
  left: 6%;
  right: 6%;
  top: -40px;
  height: 56px;
  z-index: 2;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(ellipse at 50% 100%, color-mix(in srgb, var(--frame) 55%, transparent), transparent 70%);
  filter: blur(10px);
  transition: opacity 0.6s;
}

.is-bonus .ep-board__heat { opacity: 1; animation: ep-heat 1.4s ease-in-out infinite alternate; }

.ep-board__inner {
  position: relative;
  border-radius: 24px;
  overflow: hidden;
  container-type: inline-size;
}

.ep-canvas {
  position: relative;
  z-index: 1;
  width: 100%;
  aspect-ratio: 1 / 1;
}

.ep-canvas :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.ep-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 16px;
}

/* The win gets its own row: clear of the board rim above and of the spin
   ring that rises out of the deck below. */
.ep-center > .ep-wd { margin: calc(16px * var(--ep-s)) 0 calc(46px * var(--ep-s)); }

/* ── Control deck: one slim dark-glass strip ─────────────────────── */
.ep-deck {
  position: relative;
  /* As wide as the stage (sign to legend), and always inside the pillars. */
  width: min(100%, calc(var(--board) + 2 * (240px + 28px) * var(--ep-s)), calc(var(--ep-pillars, 100%) - 48px));
  margin-top: 6px;
  padding: 4px 18px;
  background: linear-gradient(180deg, rgba(8, 6, 20, 0.5), rgba(8, 6, 20, 0.78));
  backdrop-filter: blur(10px);
  border-top: 1px solid transparent;
  border-bottom: 1px solid transparent;
  border-image: linear-gradient(90deg, transparent, #8a520f 12%, #fff3c4 50%, #8a520f 88%, transparent) 1;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
}

.ep-deck :deep(.sc-grid) { padding: 6px 4px; }
.ep-deck :deep(.sc-label) { font-family: var(--ep-ui); color: var(--ep-muted); letter-spacing: 0.2em; }
.ep-deck :deep(.sc-value),
.ep-deck :deep(.sc-bet__value) {
  font-family: var(--ep-number);
  font-size: calc(24px * var(--ep-s));
  font-weight: 900;
  color: #ffd873;
  text-shadow: 0 2px 0 var(--ep-ink), 0 0 10px rgba(232, 181, 74, 0.45);
}

/* No pill inside the strip: controls are dark glass circles with gold rims. */
.ep-deck :deep(.sc-bet__row) { background: transparent; gap: 6px; }
.ep-deck :deep(.sc-step),
.ep-deck :deep(.sc-icon) {
  background: rgba(3, 2, 10, 0.7);
  box-shadow: inset 0 0 0 1.5px rgba(232, 181, 74, 0.65), inset 0 -3px 6px rgba(0, 0, 0, 0.6);
  color: #f5cf6a;
}

.ep-deck :deep(.sc-tile) {
  width: 50px;
  border-radius: 50%;
  background: rgba(3, 2, 10, 0.7);
  box-shadow: inset 0 0 0 1.5px rgba(232, 181, 74, 0.65), inset 0 -3px 6px rgba(0, 0, 0, 0.6);
  color: #f5cf6a;
  transition: background 0.2s, box-shadow 0.2s, color 0.2s;
}

/* Turbo / auto on: the circle lights up like a small portal. */
.ep-deck :deep(.sc-tile.is-on),
.ep-deck :deep(.sc-tile.is-on:hover:not(:disabled)) {
  background: radial-gradient(circle at 50% 30%, #ffe0a0 0%, #ff8a1f 50%, #9a2a06 100%);
  box-shadow: inset 0 0 0 1.5px #ffe7a8, inset 0 2px 0 rgba(255, 255, 255, 0.4), 0 0 16px rgba(255, 138, 31, 0.75);
  color: #2a0a02;
}

/* The spin button is a portal: the tier-0 ring turns slowly behind it and
   lifts it over the strip's top edge. */
.ep-deck :deep(.sc-spin) {
  isolation: isolate;
  width: calc(92px * var(--ep-s));
  height: calc(92px * var(--ep-s));
  margin: calc(-26px * var(--ep-s)) 0 calc(-8px * var(--ep-s));
  padding: calc(12px * var(--ep-s));
  background: transparent;
  box-shadow: none;
}

.ep-deck :deep(.sc-spin)::before {
  content: '';
  position: absolute;
  inset: calc(-16px * var(--ep-s));
  z-index: -1;
  background: var(--ep-ring) center / contain no-repeat;
  filter: drop-shadow(0 0 14px rgba(255, 138, 31, 0.7));
  animation: ep-spin 14s linear infinite;
}

.ep-deck :deep(.sc-spin__face) {
  background: radial-gradient(circle at 50% 30%, #ffe0a0 0%, #ff8a1f 45%, #9a2a06 100%);
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.45), inset 0 -5px 12px rgba(0, 0, 0, 0.4), 0 0 20px rgba(255, 138, 31, 0.6);
}

.ep-deck.is-launch :deep(.sc-spin) { animation: ep-launch 0.3s cubic-bezier(0.3, 1.6, 0.5, 1); }

/* History: lettering under the deck, no chips. */
.ep-history {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 14px;
  margin-top: 10px;
}

.ep-history__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--ep-number);
  font-size: 12px;
  font-weight: 700;
  color: rgba(244, 236, 216, 0.45);
}

.ep-history__chip.is-win { color: #ffd873; }
.ep-history__chip.is-bonus { color: var(--ep-fire); }

.ep-error {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 640px;
  margin-top: 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: #fecaca;
  clip-path: var(--ep-cut);
  background: rgba(90, 16, 16, 0.75);
}

/* ── Win chips flying to the win line ─────────────────────────────── */
.ep-flyers {
  position: absolute;
  inset: 0;
  z-index: 50;
  pointer-events: none;
  overflow: hidden;
}

.ep-flyers :deep(.ep-flyer) {
  position: absolute;
  left: 0;
  top: 0;
  padding: 2px 12px 4px;
  border-radius: 999px;
  font-family: var(--ep-number);
  font-size: 28px;
  font-weight: 900;
  line-height: 1.1;
  white-space: nowrap;
  color: #ffe28a;
  -webkit-text-stroke: 5px #1a0804;
  paint-order: stroke fill;
  text-shadow: 0 2px 0 #000, 0 0 14px rgba(255, 170, 40, 0.8);
  /* A dark lozenge rimmed in the cluster's colour keeps the amount readable over bright symbols. */
  background: radial-gradient(ellipse at 50% 40%, rgba(24, 10, 6, 0.92), rgba(8, 3, 2, 0.8));
  box-shadow: 0 0 0 1.5px var(--c), 0 0 16px var(--c), 0 4px 12px rgba(0, 0, 0, 0.6);
}

.ep-flyers :deep(.ep-flyer.is-big) { font-size: 36px; }

/* ── Transitions & keyframes ─────────────────────────────────────────── */
.ep-fade-enter-active, .ep-fade-leave-active { transition: opacity 0.25s, transform 0.25s; }
.ep-fade-enter-from { opacity: 0; transform: translateY(4px); }
.ep-fade-leave-to { opacity: 0; transform: translateY(-4px); }

.ep-pop-enter-active { transition: opacity 0.2s; }
.ep-pop-leave-active { transition: opacity 0.2s, transform 0.2s; }
.ep-pop-enter-from { opacity: 0; }
.ep-pop-leave-to { opacity: 0; transform: scale(1.06); }

@keyframes ep-pop-in {
  from { transform: scale(0.3); }
  to { transform: scale(1); }
}

@keyframes ep-spin {
  to { transform: rotate(360deg); }
}

@keyframes ep-sign-glow {
  0%, 100% { filter: drop-shadow(0 0 6px rgba(255, 138, 31, 0.25)); }
  50% { filter: drop-shadow(0 0 20px rgba(255, 138, 31, 0.6)); }
}

@keyframes ep-heartbeat {
  0%, 100% { box-shadow: 0 0 40px rgba(255, 138, 31, 0.35); }
  15% { box-shadow: 0 0 90px rgba(255, 138, 31, 0.9); }
  30% { box-shadow: 0 0 50px rgba(255, 138, 31, 0.45); }
  45% { box-shadow: 0 0 80px rgba(255, 138, 31, 0.8); }
}

@keyframes ep-frame {
  0%, 100% { box-shadow: 0 0 40px color-mix(in srgb, var(--frame) 55%, transparent); }
  50% { box-shadow: 0 0 100px var(--frame); }
}

@keyframes ep-heat {
  from { transform: scaleY(0.8) skewX(-3deg); opacity: 0.6; }
  to { transform: scaleY(1.2) skewX(3deg); opacity: 1; }
}

@keyframes ep-launch {
  0% { transform: scale(1); }
  30% { transform: scale(0.84, 0.9); }
  70% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

/* Desktop: everything around the board runs at 88% (real sizes, not zoom,
   so pixi, the flyers and the renderer resolution all see true pixels). */
@media (min-width: 1101px) {
  .ep-page { --ep-s: 0.88; }
}

/* ── Narrow screens: signs fold into rows around the board ───────── */
@media (max-width: 1100px) {
  .ep-page { --board: min(calc(100vw - 32px), 680px); }
  .ep-layout {
    grid-template-columns: var(--board);
    grid-template-areas: 'right' 'center' 'left';
    gap: 12px;
  }
  .ep-center { grid-area: center; }
  .ep-left, .ep-right { width: auto; justify-self: stretch; }
  .ep-left { grid-area: left; flex-direction: row; align-items: stretch; gap: 12px; }
  .ep-right { grid-area: right; flex-direction: row; align-items: center; justify-content: center; gap: 16px; }
  .ep-logo { width: 190px; flex-shrink: 0; }
  .ep-left > .ep-hang { flex: 1 1 0; min-width: 0; }
  .ep-hang::before { height: 10px; }
  .ep-sign { padding: 22px 12px 14px; }
  .ep-sign__art { width: 52px; height: 52px; }
  .ep-legend { width: auto; flex: 1 1 auto; }
  .ep-legend .ep-fil, .ep-legend__head { display: none; }
  .ep-legend__list { flex-direction: row; flex-wrap: wrap; justify-content: center; gap: 4px 12px; }
  .ep-legend__list li { grid-template-columns: 26px auto; gap: 4px; }
  .ep-legend__ring { width: 26px; height: 26px; }
  .ep-legend__mult { font-size: 15px; }
  .ep-legend__name { display: none; }
  .ep-right > .ep-hang { flex: 1 1 auto; max-width: 420px; }
  .ep-deck { width: 100%; }
}

@media (max-width: 560px) {
  .ep-page { --board: calc(100vw - 12px); padding: 10px 6px 20px; }
  .ep-right { flex-direction: column; gap: 6px; }
  .ep-logo { width: 150px; }
  .ep-title { font-size: 15px; }
  .ep-title--sm { font-size: 14px; }
  .ep-title br { display: none; }
  .ep-num { font-size: 18px; }
  .ep-num--big { font-size: 26px; }
  .ep-label { font-size: 8.5px; letter-spacing: 0.12em; }
  .ep-sign { gap: 2px; }
  .ep-switch { width: 66px; height: 26px; }
  .is-on .ep-switch__knob { transform: translateX(38px); }
  .ep-switch__knob { width: 18px; height: 18px; top: 2.5px; }
  .ep-deck { padding: 2px 4px; }
  .ep-center > .ep-wd { margin: 12px 0 34px; }
  .ep-deck :deep(.sc-value), .ep-deck :deep(.sc-bet__value) { font-size: 17px; }
  .ep-deck :deep(.sc-spin) { width: 76px; height: 76px; margin: -18px 0 -4px; padding: 10px; }
  .ep-flyers :deep(.ep-flyer) { font-size: 18px; }
  .ep-flyers :deep(.ep-flyer.is-big) { font-size: 24px; }
}

@media (prefers-reduced-motion: reduce) {
  .ep-portals__mult, .ep-hang--buy, .ep-sign__art, .ep-board::after, .ep-board__heat { animation: none !important; }
  .ep-deck :deep(.sc-spin)::before { animation: none; }
}
</style>
