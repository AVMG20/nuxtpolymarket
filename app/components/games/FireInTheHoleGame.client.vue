<script setup lang="ts">
import type { FireBonusDrop, FireBonusResult, FireBonusValueEvent, FireCell, FireCascadeStep, FireInTheHoleResult, FireSymbol } from '#shared/utils/gamelogic/fireinthehole'
import { FITH_BUY_BONUS_COST, FITH_COLS, FITH_FREE_SPINS, FITH_MIN_CONNECTION, FITH_ROWS, playFireInTheHole } from '#shared/utils/gamelogic/fireinthehole'

definePageMeta({
  title: 'Fire in the Hole'
})

const canvasHost = ref<HTMLDivElement | null>(null)
const { user, setBalance, fetchSession } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))
const isReady = ref(false)
const isPlaying = ref(false)
const activeLines = ref(3)
const chainCount = ref(0)
const lastBombs = ref(0)
const totalWin = ref(0)
const lastWin = ref(0)
const bonusMultiplier = ref(0)
const isBonusActive = ref(false)
const status = ref('Ready')
const errorMsg = ref('')
const turbo = ref(false)
const showHelp = ref(false)
const totalWinPulse = ref(false)

const bigWinBanner = ref(false)
const bigWinLabel = ref('')
const bigWinAmount = ref(0)
const bigWinGradient = ref('')
const bigWinGlow = ref('')
const bigWinIntensity = ref(1)

// Realistic max win shown to players, derived from a 2M-spin Monte Carlo run
// (scripts/fireinthehole-rtp.ts — observed max ~8,880x). The configured hard
// cap (20,000x) is enforced server-side but is an extreme, near-unreachable
// outlier, so the UI advertises a figure players could plausibly hit instead.
const FITH_DISPLAY_MAX_WIN = 10000
// Volatility rating (1-5 zaps) — see SlotVolatility.vue. Fire in the Hole's
// observed max win puts it at the top tier (>=5,000x).
const FITH_VOLATILITY = 5

const MIN_BET = 1
const MAX_BET = 100_000_000_000
const bet = ref(10)
const betInput = ref('10')
const spinCost = computed(() => bet.value)
const buyBonusCost = computed(() => bet.value * FITH_BUY_BONUS_COST)
const history = ref<{ payout: number, bet: number, bonus: boolean }[]>([])

const autoSpinEnabled = ref(false)
const autoSpinsLeft = ref(0)
const autoSpinPaused = ref(false)
const showAutoSpinModal = ref(false)
const AUTO_SPIN_OPTIONS = [10, 25, 50, 100, 250]
let resumeAutoSpin: (() => void) | null = null

// Reel layout constants — kept in sync with the ReelSetBuilder config below
// and used to derive a scale/margin that keeps the grid centered in the
// canvas at every container width (see resizePixi).
const SYMBOL_SIZE = 108
const SYMBOL_GAP = 8
const REEL_MARGIN = 36
const REEL_CONTENT_W = FITH_COLS * SYMBOL_SIZE + (FITH_COLS - 1) * SYMBOL_GAP
const CANVAS_DESIGN_SIZE = REEL_CONTENT_W + REEL_MARGIN * 2

let pixiApp: import('pixi.js').Application | null = null
let reelSet: import('pixi-reels').ReelSet | null = null
let effectsLayer: import('pixi.js').Container | null = null
let bonusValueLayer: import('pixi.js').Container | null = null
let dividerLayer: import('pixi.js').Graphics | null = null
let resizeObserver: ResizeObserver | null = null
let latestResult: FireInTheHoleResult | null = null
let boundaryVisualLines = 3
let boundaryTween: { kill: () => void } | null = null
let pendingBonusDrops: FireBonusDrop[] = []

// Symbol textures cropped from sprite.png (base grid) and bonus.png (bonus
// drops), populated in initPixi. Crop rects live in app/utils/fireinthehole-sprite.ts
// — tune them via /games/fireinthehole-sprite-debug.
const TEX: Partial<Record<FireSymbol, import('pixi.js').Texture>> = {}
const ALL_SYMBOL_IDS = [...Object.keys(FITH_SYMBOL_META), ...Object.keys(FITH_BONUS_SYMBOL_META)] as FireSymbol[]

watch(() => user.value?.balance, (value) => {
  if (value !== undefined) balance.value = parseFloat(value ?? '0')
})

watch(bet, (value) => {
  betInput.value = String(value)
}, { immediate: true })

function clampBet(value: number): number {
  if (!Number.isFinite(value) || value < MIN_BET) return MIN_BET
  return Math.min(MAX_BET, Math.floor(value))
}

function setBet(value: number) {
  if (isPlaying.value || autoSpinEnabled.value) return
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
  if (!isPlaying.value) play()
}

function stopAutoSpin() {
  autoSpinEnabled.value = false
  autoSpinsLeft.value = 0
  autoSpinPaused.value = false
  resumeAutoSpin?.()
  resumeAutoSpin = null
}

function onCanvasClick() {
  if (!autoSpinPaused.value) return

  autoSpinPaused.value = false
  resumeAutoSpin?.()
  resumeAutoSpin = null
}

function gridToTargets(grid: FireSymbol[][]) {
  return grid.map(visible => ({ visible }))
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function stepDelay(ms: number) {
  return sleep(turbo.value ? Math.round(ms * 0.55) : ms)
}

function animationSpeedFactor(index: number) {
  const base = Math.max(0.4, 0.85 - index * 0.05)
  return turbo.value ? Math.max(0.32, base * 0.8) : base
}

function cellKey(cell: FireCell) {
  return `${cell.col}:${cell.row}`
}

function bonusVisibleTotal(values: Iterable<FireBonusDrop>) {
  return [...values].reduce((sum, value) => value.symbol === 'boost' ? sum : sum + value.multiplier, 0)
}

function bonusDropLabel(drop: FireBonusDrop) {
  if (drop.symbol === 'boost') return `+${formatNumber(drop.multiplier, false)}x`
  if (drop.symbol === 'double') return '2x'
  if (drop.symbol === 'collector') return `${formatNumber(drop.multiplier, false)}x`
  return `${formatNumber(drop.multiplier, false)}x`
}

function pulseWin() {
  totalWinPulse.value = true
  window.setTimeout(() => {
    totalWinPulse.value = false
  }, 320)
}

const tickRuns = new WeakMap<Ref<number>, number>()

// Eases a display ref toward `to` instead of snapping — used for the win
// counters so a chain of coin/boost/double drops reads as accumulating value
// rather than jumping in place.
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

function syncBonusTotals(multiplier: number, duration = 260) {
  tickNumber(bonusMultiplier, multiplier, duration)
  const bonusWin = multiplier * (latestResult?.bet ?? 1)
  tickNumber(totalWin, Number(((latestResult?.basePayout ?? 0) + bonusWin).toFixed(2)), duration)
}

async function screenShake(intensity = 8, duration = 0.3) {
  if (!reelSet) return

  const { gsap } = await import('gsap')
  const target = reelSet
  const baseX = target.position.x
  const baseY = target.position.y
  const steps = 5
  const tl = gsap.timeline({
    onComplete: () => target.position.set(baseX, baseY)
  })

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

// Escalating "big win" showcase shown once a bonus round clears a threshold —
// tiers span 50x (quiet nod) through 1500x+ (full showcase).
const WIN_TIERS = [
  { threshold: 1500, rank: 6, label: 'ULTRA WIN', from: '#f0abfc', to: '#a855f7', glow: 'rgba(168,85,247,0.75)' },
  { threshold: 600, rank: 5, label: 'SUPER WIN', from: '#fda4af', to: '#e11d48', glow: 'rgba(225,29,72,0.7)' },
  { threshold: 300, rank: 4, label: 'MEGA WIN', from: '#fdba74', to: '#ea580c', glow: 'rgba(234,88,12,0.7)' },
  { threshold: 150, rank: 3, label: 'GREAT WIN', from: '#fde047', to: '#ca8a04', glow: 'rgba(202,138,4,0.65)' },
  { threshold: 75, rank: 2, label: 'BIG WIN', from: '#86efac', to: '#16a34a', glow: 'rgba(22,163,74,0.6)' },
  { threshold: 50, rank: 1, label: 'NICE WIN', from: '#7dd3fc', to: '#0284c7', glow: 'rgba(2,132,199,0.55)' }
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
  await sleep(2200)
  bigWinBanner.value = false
}

async function initPixi() {
  if (!canvasHost.value || pixiApp) return

  const [
    { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture },
    { ReelSetBuilder, ReelSymbol, SpeedPresets },
    { gsap }
  ] = await Promise.all([
    import('pixi.js'),
    import('pixi-reels'),
    import('gsap')
  ])

  const [baseSheet, bonusSheet] = await Promise.all([
    Assets.load(FITH_SPRITE_SRC),
    Assets.load(FITH_BONUS_SPRITE_SRC)
  ])
  for (const [id, meta] of Object.entries(FITH_SYMBOL_META)) {
    TEX[id as FireSymbol] = new Texture({ source: baseSheet.source, frame: new Rectangle(...meta.rect) })
  }
  for (const [id, meta] of Object.entries(FITH_BONUS_SYMBOL_META)) {
    TEX[id as FireSymbol] = new Texture({ source: bonusSheet.source, frame: new Rectangle(...meta.rect) })
  }

  class MineSymbol extends ReelSymbol {
    private readonly tile = new Graphics()
    private readonly sprite = new Sprite()
    private readonly bonusLabelBg = new Graphics()

    private readonly bonusLabel = new Text({
      text: '',
      style: {
        fill: 0xfffbeb,
        fontFamily: 'Inter, ui-sans-serif, system-ui',
        fontSize: 23,
        fontWeight: '900',
        stroke: { color: 0x111827, width: 5 }
      }
    })

    private symbol: FireSymbol = 'coal'
    private width = 100
    private height = 100

    constructor() {
      super()
      this.view.addChild(this.tile, this.sprite, this.bonusLabelBg, this.bonusLabel)
      this.sprite.anchor.set(0.5)
      this.bonusLabel.anchor.set(0.5)
    }

    protected onActivate(symbolId: string): void {
      this.symbol = symbolId as FireSymbol
      this.bonusLabel.text = ''
      this.bonusLabel.visible = false
      this.bonusLabelBg.clear()
      this.draw()
    }

    protected onDeactivate(): void {
      gsap.killTweensOf([this.view.scale, this.view])
    }

    async playWin(): Promise<void> {
      await gsap.to(this.view.scale, {
        x: 1.12,
        y: 1.12,
        duration: 0.12,
        yoyo: true,
        repeat: 1,
        ease: 'power2.out'
      })
    }

    stopAnimation(): void {
      gsap.killTweensOf(this.view.scale)
      this.view.scale.set(1)
    }

    resize(width: number, height: number): void {
      this.width = width
      this.height = height
      this.draw()
    }

    override async playDestroy(opts?: { delay?: number, signal?: AbortSignal }): Promise<void> {
      await super.playDestroy(opts)
    }

    setBonusDrop(drop?: FireBonusDrop): void {
      if (!drop) {
        this.bonusLabel.text = ''
        this.bonusLabel.visible = false
        this.bonusLabelBg.clear()
        return
      }

      const text = bonusDropLabel(drop)

      this.bonusLabel.text = text
      this.bonusLabel.visible = true
      this.bonusLabel.style.fontSize = text.length > 5 ? 19 : 23
      this.bonusLabel.position.set(this.width * 0.5, this.height * 0.5)
      this.bonusLabelBg.clear()
      this.draw()
    }

    private draw() {
      const pad = 5
      const isLocked = this.symbol === 'rock' || this.symbol === 'empty'

      this.tile.clear()
      this.tile.roundRect(pad, pad, this.width - pad * 2, this.height - pad * 2, 13)
      this.tile.fill({ color: 0x000000, alpha: isLocked ? 0.32 : 0.2 })

      const tex = TEX[this.symbol]
      if (tex) {
        const maxSize = Math.min(this.width, this.height) * 0.92
        const scale = Math.min(maxSize / tex.width, maxSize / tex.height)
        this.sprite.texture = tex
        this.sprite.alpha = isLocked ? 0.75 : 1
        this.sprite.scale.set(scale)
        this.sprite.position.set(this.width * 0.5, this.height * 0.5)
        this.sprite.visible = true
      } else {
        this.sprite.visible = false
      }

      if (this.bonusLabel.visible) {
        this.bonusLabel.position.set(this.width * 0.5, this.height * 0.5)
        this.bonusLabelBg.clear()
      }
    }
  }

  pixiApp = new Application()
  await pixiApp.init({
    width: CANVAS_DESIGN_SIZE,
    height: CANVAS_DESIGN_SIZE,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2)
  })

  pixiApp.canvas.classList.add('h-full', 'w-full')
  canvasHost.value.appendChild(pixiApp.canvas)

  latestResult = playFireInTheHole(1)

  reelSet = new ReelSetBuilder()
    .reels(FITH_COLS)
    .visibleRows(FITH_ROWS)
    .symbolSize(SYMBOL_SIZE, SYMBOL_SIZE)
    .symbolGap(SYMBOL_GAP, SYMBOL_GAP)
    .bufferSymbols(1)
    .symbols((registry) => {
      for (const id of ALL_SYMBOL_IDS) {
        registry.register(id, MineSymbol, {})
      }
    })
    .weights({
      coal: 34,
      ore: 28,
      ruby: 18,
      sapphire: 13,
      emerald: 9,
      bomb: 9,
      scatter: 5,
      coin: 1,
      boost: 1,
      double: 1,
      collector: 1,
      empty: 1,
      rock: 1
    })
    .symbolData({
      bomb: { zIndex: 10 },
      rock: { zIndex: -1 }
    })
    .tumble({
      fall: { duration: 280, ease: 'power2.in', rowStagger: 28, rowOrder: 'bottomToTop' },
      dropIn: { duration: 460, ease: 'power3.out', rowStagger: 30, distance: 'perHole' }
    })
    .speed('mine', {
      ...SpeedPresets.NORMAL,
      name: 'mine',
      minimumSpinTime: 560,
      tumble: {
        fall: { duration: 250, rowStagger: 20 },
        dropIn: { duration: 420, rowStagger: 24 }
      }
    })
    .speed('mineTurbo', {
      ...SpeedPresets.TURBO,
      name: 'mineTurbo',
      minimumSpinTime: 260,
      tumble: {
        fall: { duration: 150, rowStagger: 10 },
        dropIn: { duration: 250, rowStagger: 12 }
      }
    })
    .initialSpeed('mine')
    .initialFrame(gridToTargets(latestResult.grid))
    .ticker(pixiApp.ticker)
    .build()

  reelSet.position.set(REEL_MARGIN, REEL_MARGIN)
  pixiApp.stage.addChild(reelSet)

  dividerLayer = new Graphics()
  pixiApp.stage.addChild(dividerLayer)

  bonusValueLayer = new Container()
  pixiApp.stage.addChild(bonusValueLayer)

  effectsLayer = new Container()
  pixiApp.stage.addChild(effectsLayer)

  reelSet.events.on('cascade:dropIn:symbol', ({ view, duration }) => {
    gsap.fromTo(view.scale, { x: 1.14, y: 0.84 }, {
      x: 1,
      y: 1,
      duration: Math.max(duration / 2200, 0.1),
      ease: 'power2.out'
    })
  })

  reelSet.events.on('cascade:place:end', ({ reelIndex, placedSymbols }) => {
    for (const drop of pendingBonusDrops) {
      if (drop.col !== reelIndex) continue
      placedSymbols[drop.row]?.setBonusDrop?.(drop)
    }
  })

  resizeObserver = new ResizeObserver(resizePixi)
  resizeObserver.observe(canvasHost.value)
  resizePixi()

  activeLines.value = latestResult.steps[0]?.activeLinesBefore ?? latestResult.activeLines
  boundaryVisualLines = activeLines.value
  drawMineBoundary()

  isReady.value = true
}

function resizePixi() {
  if (!pixiApp || !reelSet || !canvasHost.value) return

  const size = Math.max(320, Math.min(canvasHost.value.clientWidth, CANVAS_DESIGN_SIZE))
  pixiApp.renderer.resize(size, size)

  const scale = size / CANVAS_DESIGN_SIZE
  reelSet.scale.set(scale)

  // effectsLayer/bonusValueLayer/dividerLayer stay unscaled (1:1 with the
  // canvas) — every point drawn into them is computed in real screen pixels
  // via reelSet.position + cellBounds * reelSet.scale, see cellCenter() and
  // drawMineBoundary(). Scaling the layers on top of that double-applies the
  // zoom and was the source of the grid drifting off-center.
  const offset = REEL_MARGIN * scale
  reelSet.position.set(offset, offset)
  drawMineBoundary()
}

function cellCenter(cell: FireCell) {
  if (!reelSet) return { x: 0, y: 0 }

  const bounds = reelSet.getCellBounds(cell.col, cell.row)
  const s = reelSet.scale.x
  return {
    x: reelSet.x + (bounds.x + bounds.width / 2) * s,
    y: reelSet.y + (bounds.y + bounds.height / 2) * s
  }
}

async function spawnBlast(cell: FireCell, bomb = false) {
  if (!pixiApp || !effectsLayer) return

  const { Graphics } = await import('pixi.js')
  const { gsap } = await import('gsap')
  const center = cellCenter(cell)
  const count = bomb ? 34 : 10
  const colors = bomb ? [0xfff7ed, 0xfacc15, 0xfb923c, 0xef4444] : [0xd4d4d8, 0xa1a1aa, 0xffffff]
  const debrisColors = [0x27272a, 0x3f3f46, 0x18181b]

  if (bomb) {
    // Dark soot puffs linger a beat longer than the flash — breaks up the
    // "uniform bright circle" look with some grit/weight.
    for (let i = 0; i < 6; i++) {
      const smoke = new Graphics()
      const size = 9 + Math.random() * 13
      smoke.circle(0, 0, size)
      smoke.fill({ color: debrisColors[i % debrisColors.length]!, alpha: 0.32 + Math.random() * 0.2 })
      smoke.position.set(center.x + (Math.random() - 0.5) * 12, center.y + (Math.random() - 0.5) * 12)
      smoke.scale.set(0.3)
      effectsLayer.addChild(smoke)

      const angle = Math.random() * Math.PI * 2
      const dist = 18 + Math.random() * 36
      const dur = 0.85 + Math.random() * 0.3

      gsap.to(smoke.position, {
        x: smoke.x + Math.cos(angle) * dist,
        y: smoke.y + Math.sin(angle) * dist - 16,
        duration: dur,
        ease: 'power1.out'
      })
      gsap.to(smoke.scale, {
        x: 1.5 + Math.random() * 0.7,
        y: 1.5 + Math.random() * 0.7,
        duration: dur,
        ease: 'power1.out'
      })
      gsap.to(smoke, {
        alpha: 0,
        duration: dur,
        delay: 0.06,
        ease: 'power1.in',
        onComplete: () => smoke.destroy()
      })
    }

    // Hot white-core flash right at the point of impact.
    const flash = new Graphics()
    flash.circle(0, 0, 22)
    flash.fill({ color: 0xfffbeb, alpha: 1 })
    flash.position.set(center.x, center.y)
    flash.scale.set(0.15)
    flash.blendMode = 'add'
    effectsLayer.addChild(flash)

    gsap.to(flash.scale, { x: 1.3, y: 1.3, duration: 0.14, ease: 'power2.out' })
    gsap.to(flash, { alpha: 0, duration: 0.16, ease: 'power2.in', onComplete: () => flash.destroy() })

    const ring = new Graphics()
    ring.circle(0, 0, 34)
    ring.stroke({ color: 0xfb923c, alpha: 1, width: 7 })
    ring.position.set(center.x, center.y)
    ring.scale.set(0.2)
    ring.blendMode = 'add'
    effectsLayer.addChild(ring)

    gsap.to(ring.scale, {
      x: 2.15,
      y: 2.15,
      duration: 0.46,
      ease: 'power3.out'
    })
    gsap.to(ring, {
      alpha: 0,
      duration: 0.46,
      ease: 'power2.out',
      onComplete: () => ring.destroy()
    })

    screenShake(turbo.value ? 5 : 9, turbo.value ? 0.18 : 0.32)
  }

  for (let i = 0; i < count; i++) {
    // Every fifth particle is a tumbling charcoal debris chunk instead of a
    // glowing spark — non-additive and gravity-affected for contrast against
    // the bright embers.
    const isDebris = bomb && i % 5 === 0
    const particle = new Graphics()
    const color = isDebris ? debrisColors[i % debrisColors.length]! : colors[i % colors.length]!
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.35
    const isEmber = !isDebris && i % 3 === 0
    const distance = (bomb ? 88 : 38) + Math.random() * (bomb ? 90 : 26)
    const size = isDebris
      ? 3 + Math.random() * 4
      : isEmber
        ? (bomb ? 6 + Math.random() * 7 : 3 + Math.random() * 3)
        : (bomb ? 2 + Math.random() * 4 : 1.5 + Math.random() * 2.5)
    const duration = (bomb ? 0.5 : 0.3) + Math.random() * (bomb ? 0.3 : 0.16)
    const rotation = angle + Math.random() * 0.6

    if (isDebris) {
      particle.roundRect(-size * 0.5, -size * 1.6, size, size * 3.2, size * 0.4)
      particle.rotation = rotation
    } else {
      particle.circle(0, 0, size)
    }
    particle.fill({ color, alpha: isDebris ? 0.85 : isEmber ? 0.55 : 0.95 })
    particle.blendMode = isDebris ? 'normal' : 'add'
    particle.position.set(center.x, center.y)
    effectsLayer.addChild(particle)

    gsap.to(particle.position, {
      x: center.x + Math.cos(angle) * distance,
      y: center.y + Math.sin(angle) * distance + (isDebris ? 20 : 0),
      duration,
      ease: isDebris ? 'power2.out' : 'power3.out'
    })
    if (isDebris) {
      gsap.to(particle, { rotation: rotation + (Math.random() - 0.5) * 6, duration, ease: 'power1.out' })
    }
    gsap.to(particle.scale, {
      x: isDebris ? 0.7 : isEmber ? 0.55 : 0.2,
      y: isDebris ? 0.7 : isEmber ? 0.55 : 0.2,
      duration,
      ease: 'power2.in'
    })
    gsap.to(particle, {
      alpha: 0,
      duration: duration + 0.06,
      ease: 'power2.in',
      onComplete: () => particle.destroy()
    })
  }
}

async function playCascadeEffects(step: FireCascadeStep) {
  const bombKeys = new Set(step.bombCells.map(cell => `${cell.col}:${cell.row}`))
  const chipCells = step.winCells.filter(cell => !bombKeys.has(`${cell.col}:${cell.row}`))

  await Promise.all(chipCells.map(cell => spawnBlast(cell)))

  for (const bomb of step.bombCells) {
    await spawnBlast(bomb, true)
    await sleep(90)
  }

  spawnMoneyPopup(step.stepPay, step.winCells)
}

function drawMineBoundary() {
  if (!reelSet || !dividerLayer) return

  dividerLayer.clear()

  const first = reelSet.getCellBounds(0, 0)
  const second = reelSet.getCellBounds(0, 1)
  const last = reelSet.getCellBounds(FITH_COLS - 1, FITH_ROWS - 1)
  const s = reelSet.scale.x
  const rowPitch = (second.y - first.y) * s
  const bottom = reelSet.y + (last.y + last.height) * s
  const left = reelSet.x + first.x * s
  const right = reelSet.x + (last.x + last.width) * s
  const lockedTop = boundaryVisualLines >= FITH_ROWS
    ? bottom
    : reelSet.y + first.y * s + boundaryVisualLines * rowPitch - 8 * s

  if (boundaryVisualLines < FITH_ROWS) {
    dividerLayer.rect(left - 2 * s, lockedTop, right - left + 4 * s, bottom - lockedTop)
    dividerLayer.fill({ color: 0x18181b, alpha: 0.88 })

    dividerLayer.roundRect(left - 6 * s, lockedTop - 3 * s, right - left + 12 * s, 7 * s, 7 * s)
    dividerLayer.fill({ color: 0x3f3f46, alpha: 1 })
    dividerLayer.roundRect(left - 6 * s, lockedTop - 3 * s, right - left + 12 * s, 2 * s, 2 * s)
    dividerLayer.fill({ color: 0xf2c14e, alpha: 0.4 })
    dividerLayer.roundRect(left - 6 * s, lockedTop + 5 * s, right - left + 12 * s, 2 * s, 2 * s)
    dividerLayer.fill({ color: 0x0a0a0b, alpha: 0.7 })
  }
}

async function animateMineBoundary(lines: number) {
  const { gsap } = await import('gsap')

  boundaryTween?.kill()
  boundaryTween = gsap.to({ value: boundaryVisualLines }, {
    value: lines,
    duration: Math.min(0.62, Math.max(0.28, Math.abs(lines - boundaryVisualLines) * 0.26)),
    ease: 'power2.inOut',
    onUpdate() {
      boundaryVisualLines = this.targets()[0].value
      drawMineBoundary()
    },
    onComplete() {
      boundaryVisualLines = lines
      drawMineBoundary()
      boundaryTween = null
    }
  })
}

async function spawnMoneyPopup(amount: number, cells: FireCell[]) {
  if (!effectsLayer || cells.length === 0 || amount <= 0) return

  const { Text } = await import('pixi.js')
  const { gsap } = await import('gsap')
  const center = cells.reduce((point, cell) => {
    const next = cellCenter(cell)
    return { x: point.x + next.x, y: point.y + next.y }
  }, { x: 0, y: 0 })
  const label = new Text({
    text: `+$${formatNumber(amount, false)}`,
    style: {
      fill: 0xfef3c7,
      fontFamily: 'Inter, ui-sans-serif, system-ui',
      fontSize: 34,
      fontWeight: '900',
      stroke: { color: 0x111827, width: 6 },
      dropShadow: { color: 0xfacc15, blur: 10, distance: 0, alpha: 0.9 }
    }
  })

  label.anchor.set(0.5)
  label.position.set(center.x / cells.length, center.y / cells.length)
  label.scale.set(0.45, 1.35)
  effectsLayer.addChild(label)

  const drift = (Math.random() - 0.5) * 34

  gsap.to(label.scale, {
    x: 1,
    y: 1,
    duration: 0.2,
    ease: 'back.out(2.8)'
  })
  gsap.to(label.position, {
    x: label.x + drift,
    y: label.y - 78,
    duration: 0.9,
    ease: 'power2.out'
  })
  gsap.to(label, {
    alpha: 0,
    duration: 0.22,
    delay: 0.68,
    ease: 'power2.in',
    onComplete: () => label.destroy()
  })
}

function clearBonusValues() {
  bonusValueLayer?.removeChildren().forEach(child => child.destroy({ children: true }))
}

async function drawBonusValues(coins: FireBonusDrop[]) {
  if (!bonusValueLayer || !reelSet) return

  const { Container, Sprite, Text } = await import('pixi.js')
  const s = reelSet.scale.x

  clearBonusValues()

  for (const coin of coins) {
    const bounds = reelSet.getCellBounds(coin.col, coin.row)
    if (!bounds) continue

    const tex = TEX[coin.symbol]
    const glowColor = coin.symbol === 'collector' ? 0xf87171 : coin.symbol === 'boost' ? 0x6ee7b7 : 0xfacc15
    const holder = new Container()
    const sprite = new Sprite()
    const labelText = coin.symbol === 'boost'
      ? `+${formatNumber(coin.multiplier, false)}x`
      : `${formatNumber(coin.multiplier, false)}x`
    const label = new Text({
      text: labelText,
      style: {
        fill: 0xfffbeb,
        fontFamily: 'Inter, ui-sans-serif, system-ui',
        fontSize: coin.multiplier >= 1000 || coin.symbol === 'boost' ? 18 : 20,
        fontWeight: '900',
        stroke: { color: coin.symbol === 'collector' ? 0x7f1d1d : coin.symbol === 'boost' ? 0x064e3b : 0x713f12, width: 4 },
        dropShadow: { color: glowColor, blur: 6, distance: 0, alpha: 0.85 }
      }
    })

    const width = bounds.width * s
    const height = bounds.height * s

    if (tex) {
      const maxSize = Math.min(width, height) * 0.92
      const scale = Math.min(maxSize / tex.width, maxSize / tex.height)
      sprite.texture = tex
      sprite.anchor.set(0.5)
      sprite.scale.set(scale)
      sprite.position.set(width * 0.5, height * 0.5)
    }

    label.anchor.set(0.5)
    label.position.set(width * 0.5, height * 0.5)
    holder.addChild(sprite, label)
    holder.position.set(reelSet.x + bounds.x * s, reelSet.y + bounds.y * s)
    bonusValueLayer.addChild(holder)
  }
}

async function spawnBonusDropPopup(drop: FireBonusDrop, speedFactor = 1) {
  if (!effectsLayer) return

  const { Text } = await import('pixi.js')
  const { gsap } = await import('gsap')
  const center = cellCenter(drop)
  const text = drop.symbol === 'boost'
    ? `+${formatNumber(drop.multiplier, false)}x ALL`
    : drop.symbol === 'double'
      ? 'DOUBLE'
      : drop.symbol === 'collector'
        ? 'COLLECT'
        : `${formatNumber(drop.multiplier, false)}x`
  const glowColor = drop.symbol === 'double' ? 0xa78bfa : drop.symbol === 'collector' ? 0xf87171 : 0x6ee7b7
  const label = new Text({
    text,
    style: {
      fill: 0xfef3c7,
      fontFamily: 'Inter, ui-sans-serif, system-ui',
      fontSize: drop.symbol === 'collector' ? 24 : 28,
      fontWeight: '900',
      stroke: { color: 0x111827, width: 5 },
      dropShadow: { color: glowColor, blur: 9, distance: 0, alpha: 0.9 }
    }
  })

  label.anchor.set(0.5)
  label.position.set(center.x, center.y)
  label.scale.set(0.5, 1.3)
  effectsLayer.addChild(label)

  gsap.to(label.scale, {
    x: 1,
    y: 1,
    duration: 0.13 * speedFactor,
    ease: 'back.out(2.4)'
  })
  gsap.to(label.position, {
    y: label.y - 64,
    duration: 0.48 * speedFactor,
    ease: 'power3.out'
  })
  gsap.to(label, {
    alpha: 0,
    duration: 0.16 * speedFactor,
    delay: 0.34 * speedFactor,
    ease: 'power2.in',
    onComplete: () => label.destroy()
  })
}

async function animateValueTransfer(event: FireBonusValueEvent, speedFactor = 1) {
  if (!effectsLayer) return

  const { Graphics, Text } = await import('pixi.js')
  const { gsap } = await import('gsap')
  const from = event.type === 'collect' ? cellCenter(event.target) : cellCenter(event.source)
  const to = event.type === 'collect' ? cellCenter(event.source) : cellCenter(event.target)
  const text = event.type === 'double'
    ? `+${formatNumber(event.amount, false)}x`
    : event.type === 'collect'
      ? `${formatNumber(event.amount, false)}x`
      : `+${formatNumber(event.amount, false)}x`
  const glowColor = event.type === 'double' ? 0xa78bfa : event.type === 'collect' ? 0xf87171 : 0x6ee7b7
  const label = new Text({
    text,
    style: {
      fill: 0xfffbeb,
      fontFamily: 'Inter, ui-sans-serif, system-ui',
      fontSize: event.amount >= 1000 ? 20 : 24,
      fontWeight: '900',
      stroke: { color: event.type === 'double' ? 0x312e81 : event.type === 'collect' ? 0x7f1d1d : 0x064e3b, width: 5 },
      dropShadow: { color: glowColor, blur: 8, distance: 0, alpha: 0.9 }
    }
  })

  label.anchor.set(0.5)
  label.position.set(from.x, from.y)
  label.scale.set(0.55)
  effectsLayer.addChild(label)

  await gsap.to(label.scale, {
    x: 1,
    y: 1,
    duration: 0.09 * speedFactor,
    ease: 'back.out(2)'
  })

  // Single arcing tween (mid-flight peak, then settle) instead of a flat
  // slide — reads more like a coin toss between the two cells.
  const peakY = Math.min(from.y, to.y) - 46

  // A few jittered sparks trail the same arc a beat behind the value, like
  // the neon particle streams in pixi-reels' hold-and-win recipes.
  const trailCount = turbo.value ? 2 : 4
  for (let i = 0; i < trailCount; i++) {
    const dot = new Graphics()
    const jitterX = (Math.random() - 0.5) * 20
    const jitterY = (Math.random() - 0.5) * 16
    dot.circle(0, 0, 2 + Math.random() * 2)
    dot.fill({ color: glowColor, alpha: 0.9 })
    dot.blendMode = 'add'
    dot.position.set(from.x, from.y)
    effectsLayer.addChild(dot)

    gsap.to(dot, {
      delay: i * 0.035 * speedFactor,
      keyframes: {
        '55%': { x: (from.x + to.x) / 2 + jitterX, y: peakY + jitterY },
        '100%': { x: to.x, y: to.y }
      },
      duration: 0.3 * speedFactor,
      ease: 'power2.inOut',
      onComplete: () => {
        gsap.to(dot, { alpha: 0, duration: 0.12, onComplete: () => dot.destroy() })
      }
    })
  }

  await gsap.to(label, {
    keyframes: {
      '55%': { x: (from.x + to.x) / 2, y: peakY },
      '100%': { x: to.x, y: to.y }
    },
    duration: 0.28 * speedFactor,
    ease: 'power2.inOut'
  })

  const pulse = new Graphics()
  pulse.circle(0, 0, 28)
  pulse.stroke({ color: 0xfacc15, alpha: 0.95, width: 4 })
  pulse.position.set(to.x, to.y)
  pulse.scale.set(0.35)
  pulse.blendMode = 'add'
  effectsLayer.addChild(pulse)

  gsap.to(pulse.scale, {
    x: 1.45,
    y: 1.45,
    duration: 0.2 * speedFactor,
    ease: 'power2.out'
  })
  gsap.to(pulse, {
    alpha: 0,
    duration: 0.2 * speedFactor,
    ease: 'power2.in',
    onComplete: () => pulse.destroy()
  })

  await gsap.to(label, {
    alpha: 0,
    duration: 0.08 * speedFactor,
    ease: 'power2.in',
    onComplete: () => label.destroy()
  })
}

async function playBonusFeature(bonus: FireBonusResult) {
  if (!reelSet) return

  status.value = 'Free spins'
  isBonusActive.value = true
  bonusMultiplier.value = 0
  activeLines.value = bonus.activeLines
  boundaryVisualLines = bonus.activeLines
  drawMineBoundary()
  clearBonusValues()
  const lockedCoins = new Map<string, FireBonusDrop>()

  for (const step of bonus.steps) {
    status.value = `Free spin ${step.spin}/${bonus.freeSpins}`

    reelSet.setSpeed?.(turbo.value ? 'mineTurbo' : 'mine')
    const spinDone = reelSet.spin({ timeoutMs: turbo.value ? 2800 : 4200 })
    await stepDelay(110)
    pendingBonusDrops = step.drops
    reelSet.setResult(gridToTargets(step.grid))
    await spinDone

    const specialDrops = step.drops.filter(drop => drop.symbol !== 'coin')
    const coinDrops = step.drops.filter(drop => drop.symbol === 'coin')
    const collectorDrops = step.drops.filter(drop => drop.symbol === 'collector')
    const boostDrops = step.drops.filter(drop => drop.symbol === 'boost')

    coinDrops.forEach((drop) => {
      lockedCoins.set(cellKey(drop), { ...drop })
    })

    for (const drop of [...collectorDrops, ...boostDrops]) {
      lockedCoins.set(cellKey(drop), { ...drop })
    }

    await drawBonusValues([...lockedCoins.values()])
    syncBonusTotals(bonusVisibleTotal(lockedCoins.values()), 240)

    for (let index = 0; index < specialDrops.length; index++) {
      const speedFactor = animationSpeedFactor(index)

      await spawnBonusDropPopup(specialDrops[index]!, speedFactor)
      await sleep(90 * speedFactor)
    }

    for (let index = 0; index < step.valueEvents.length; index++) {
      const speedFactor = animationSpeedFactor(index)
      const event = step.valueEvents[index]!

      await animateValueTransfer(event, speedFactor)

      if (event.type === 'collect') {
        lockedCoins.delete(cellKey(event.target))
        lockedCoins.set(cellKey(event.source), { ...event.source, multiplier: event.after })
      } else {
        lockedCoins.set(cellKey(event.target), { ...event.target, multiplier: event.after })
      }

      await drawBonusValues([...lockedCoins.values()])
      syncBonusTotals(bonusVisibleTotal(lockedCoins.values()), 220 * speedFactor)
      await sleep(38 * speedFactor)
    }

    lockedCoins.clear()
    for (const coin of step.coins) {
      lockedCoins.set(cellKey(coin), { ...coin })
    }
    await drawBonusValues([...lockedCoins.values()])
    syncBonusTotals(step.totalMultiplier, 320)

    const bonusWin = step.totalMultiplier * (latestResult?.bet ?? 1)
    lastWin.value = Number(bonusWin.toFixed(2))
    if (bonusWin > 0) pulseWin()
    await stepDelay(150)
  }

  totalWin.value = latestResult?.payout ?? bonus.payout
  lastWin.value = bonus.payout
  bonusMultiplier.value = bonus.totalMultiplier
  status.value = `Bonus ${formatNumber(bonus.totalMultiplier, false)}x`

  if (bonus.totalMultiplier > 50) {
    await showBigWinPopup(bonus.totalMultiplier, bonus.payout)
  }
}

async function flashUnlockedRows(rows: number[]) {
  if (!effectsLayer || !reelSet || rows.length === 0) return

  const { Graphics } = await import('pixi.js')
  const { gsap } = await import('gsap')
  const s = reelSet.scale.x

  for (const row of rows) {
    for (let col = 0; col < FITH_COLS; col++) {
      const bounds = reelSet.getCellBounds(col, row)
      if (!bounds) continue

      const width = bounds.width * s
      const height = bounds.height * s
      const flash = new Graphics()
      flash.roundRect(reelSet.x + bounds.x * s + 5 * s, reelSet.y + bounds.y * s + 5 * s, width - 10 * s, height - 10 * s, 14 * s)
      flash.stroke({ color: 0xfb923c, alpha: 0.95, width: 5 })
      effectsLayer.addChild(flash)

      gsap.to(flash, {
        alpha: 0,
        duration: 0.72,
        delay: col * 0.035,
        ease: 'power2.out',
        onComplete: () => flash.destroy()
      })
    }
  }
}

async function animateResult(result: FireInTheHoleResult) {
  if (!reelSet) return

  latestResult = result
  activeLines.value = result.steps[0]?.activeLinesBefore ?? 3
  drawMineBoundary()
  reelSet.setSpeed?.(turbo.value ? 'mineTurbo' : 'mine')
  pendingBonusDrops = []

  const spinDone = reelSet.spin({ mode: 'cascade', timeoutMs: turbo.value ? 4200 : 8000 })
  await stepDelay(160)
  reelSet.setResult(gridToTargets(result.grid))
  await spinDone

  let stepIndex = 0
  let currentStep: FireCascadeStep | undefined

  await reelSet.runCascade({
    detectWinners: () => {
      currentStep = latestResult?.steps[stepIndex]
      return currentStep?.winCells.map(cell => ({ reel: cell.col, row: cell.row })) ?? []
    },
    nextGrid: async () => {
      const nextGrid = latestResult?.steps[stepIndex + 1]?.grid ?? latestResult?.restGrid ?? []
      stepIndex += 1
      return gridToTargets(nextGrid)
    },
    onCascade: async () => {
      if (!currentStep) return

      status.value = currentStep.bombCells.length > 0 ? 'Bombs opening the mine' : 'Cascading'
      chainCount.value += 1
      lastBombs.value = currentStep.bombCells.length
      lastWin.value = currentStep.stepPay
      totalWin.value = currentStep.totalPay
      if (currentStep.stepPay > 0) pulseWin()

      await playCascadeEffects(currentStep)

      if (currentStep.unlockedRows.length > 0) {
        activeLines.value = currentStep.activeLinesAfter
        await animateMineBoundary(currentStep.activeLinesAfter)
        await flashUnlockedRows(currentStep.unlockedRows)
      }
    },
    pauseAfterDestroyMs: turbo.value ? 90 : 180,
    refillMode: 'gravity-then-drop',
    gravityHoldMs: turbo.value ? 80 : 190,
    maxChain: FITH_ROWS * 2
  })

  activeLines.value = result.activeLines
  totalWin.value = result.basePayout
  drawMineBoundary()

  if (result.bonus) {
    status.value = 'Scatters hit'
    await stepDelay(420)
    await playBonusFeature(result.bonus)
  } else {
    status.value = result.scatterCells.length > 0
      ? `${result.scatterCells.length} scatters`
      : result.steps.length > 0 ? 'Settled' : 'No connection'
  }

  totalWin.value = result.payout
  lastWin.value = result.payout
  if (result.payout > 0) pulseWin()
}

async function play(buy = false) {
  const cost = buy ? buyBonusCost.value : spinCost.value
  if (!reelSet || isPlaying.value || balance.value < cost) return

  isPlaying.value = true
  status.value = buy ? 'Buying bonus' : 'Dropping'
  errorMsg.value = ''
  chainCount.value = 0
  lastBombs.value = 0
  totalWin.value = 0
  lastWin.value = 0
  bonusMultiplier.value = 0
  isBonusActive.value = false
  clearBonusValues()

  const balanceBeforeSpin = balance.value
  balance.value = balanceBeforeSpin - cost
  setBalance(balance.value)

  let data: { gameData: FireInTheHoleResult, balance: number }
  try {
    data = await $fetch('/api/games/play-game', {
      method: 'POST',
      body: {
        bet: bet.value,
        game: 'fireinthehole',
        options: buy ? { buyBonus: true } : undefined
      }
    }) as { gameData: FireInTheHoleResult, balance: number }
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : 'Spin failed'
    balance.value = balanceBeforeSpin
    setBalance(balanceBeforeSpin)
    isPlaying.value = false
    stopAutoSpin()
    return
  }

  try {
    await animateResult(data.gameData)
    history.value.unshift({ payout: data.gameData.payout, bet: data.gameData.cost, bonus: Boolean(data.gameData.bonus) })
    if (history.value.length > 10) history.value.pop()
    balance.value = data.balance
    setBalance(data.balance)
    await fetchSession()
  } catch (error) {
    errorMsg.value = error instanceof Error ? error.message : 'Animation error'
    balance.value = data.balance
    setBalance(data.balance)
    stopAutoSpin()
  }

  isPlaying.value = false

  if (autoSpinEnabled.value) {
    if (data.gameData.bonus) {
      autoSpinPaused.value = true
      status.value = 'Bonus complete'
      await new Promise<void>((resolve) => {
        resumeAutoSpin = resolve
      })
    }

    if (autoSpinEnabled.value) {
      autoSpinsLeft.value--
      if (autoSpinsLeft.value > 0 && balance.value >= spinCost.value) play()
      else stopAutoSpin()
    }
  }
}

watch(activeLines, () => {
  animateMineBoundary(activeLines.value)
})

onMounted(initPixi)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  reelSet?.destroy()
  pixiApp?.destroy(true)
  reelSet = null
  pixiApp = null
  effectsLayer = null
  bonusValueLayer = null
  dividerLayer = null
})
</script>

<template>
  <div class="fire-shell relative min-h-full overflow-hidden px-2 py-6 text-default sm:px-3">
    <div class="fire-bg absolute inset-0" />
    <div class="fire-vignette absolute inset-0" />

    <div class="relative z-[1] mx-auto w-full max-w-7xl">
      <header class="mb-5 text-center">
        <div class="mb-2 flex items-center justify-center gap-3">
          <span class="fire-eyebrow-line" />
          <p class="flex items-center gap-2 text-xs font-black tracking-[0.32em] uppercase text-[#f2c14e]">
            <UIcon
              name="i-lucide-pickaxe"
              class="size-3.5 shrink-0"
            />
            Mine the depths
            <UIcon
              name="i-lucide-gem"
              class="size-3.5 shrink-0"
            />
          </p>
          <span class="fire-eyebrow-line" />
        </div>
        <h1 class="fire-title text-[36px] leading-none font-black tracking-normal sm:text-[52px]">
          Fire in the Hole
        </h1>
        <div class="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span class="fire-badge">
            <UIcon
              name="i-lucide-flame"
              class="size-3"
            />
            {{ formatNumber(FITH_DISPLAY_MAX_WIN, false, 0) }}x max win
          </span>
          <span class="fire-badge fire-badge-ruby">
            <UIcon
              name="i-lucide-bomb"
              class="size-3"
            />
            Bombs unlock deeper rows
          </span>
          <span class="fire-badge">
            <SlotVolatility :level="FITH_VOLATILITY" />
          </span>
        </div>
      </header>

      <div class="grid gap-4 xl:grid-cols-[250px_minmax(0,760px)_260px] xl:items-start">
        <aside class="order-3 xl:order-1">
          <div class="fire-panel p-4">
            <div class="fire-panel-head">
              <UIcon
                name="i-lucide-layers"
                class="size-3.5"
              />
              <span>Mine depth</span>
            </div>
            <div class="mt-2.5 flex items-center justify-between">
              <span class="text-[11px] font-bold text-muted">Rows unlocked</span>
              <strong class="fire-value-gold text-sm">{{ activeLines }}/6</strong>
            </div>
            <div class="fire-depth-bar mt-2">
              <div
                class="fire-depth-fill"
                :style="{ width: `${(activeLines / 6) * 100}%` }"
              />
            </div>
            <div class="mt-4 grid grid-cols-2 gap-2 text-center">
              <div class="fire-stat">
                <UIcon
                  name="i-lucide-repeat"
                  class="fire-stat-icon"
                />
                <span>Cascades</span>
                <strong>{{ chainCount }}</strong>
              </div>
              <div class="fire-stat fire-stat-ruby">
                <UIcon
                  name="i-lucide-bomb"
                  class="fire-stat-icon"
                />
                <span>Bombs</span>
                <strong>{{ lastBombs }}</strong>
              </div>
            </div>
          </div>

          <div
            class="fire-panel fire-panel-bonus mt-3 p-4"
            :class="{ 'fire-panel-bonus-active': isBonusActive }"
          >
            <div class="fire-panel-head">
              <UIcon name="i-lucide-sparkles" />
              <span>Bonus multi</span>
            </div>
            <strong
              class="mt-2 block text-3xl leading-none font-black tracking-normal"
              :class="isBonusActive ? 'fire-value-gold' : 'text-muted'"
            >
              {{ formatNumber(bonusMultiplier, false) }}x
            </strong>
          </div>

          <div class="fire-panel mt-3 p-3">
            <button
              class="fire-buy-btn"
              :disabled="!isReady || isPlaying || autoSpinEnabled || balance < buyBonusCost"
              @click="play(true)"
            >
              <UIcon
                name="i-lucide-flame"
                class="size-4"
              />
              Buy bonus · {{ formatNumber(buyBonusCost, false) }}
            </button>
          </div>
        </aside>

        <main class="order-1 xl:order-2">
          <div class="fire-console overflow-hidden">
            <div
              class="fire-reel-area relative cursor-default overflow-hidden p-1.5 sm:p-2"
              @click="onCanvasClick"
            >
              <div class="fire-reel-sheen pointer-events-none absolute inset-0 z-[2]" />
              <div
                ref="canvasHost"
                class="relative z-[1] aspect-square w-full [&>canvas]:!block [&>canvas]:!h-auto [&>canvas]:!w-full"
              />

              <Transition name="pop">
                <div
                  v-if="autoSpinPaused"
                  class="absolute inset-0 z-20 flex cursor-pointer items-center justify-center bg-[rgba(8,10,12,0.78)] backdrop-blur-[3px]"
                >
                  <div class="rounded-lg border border-[#fbbf24]/40 bg-background/95 px-6 py-4 text-center shadow-xl">
                    <p class="text-base font-black text-highlighted">
                      Bonus complete
                    </p>
                    <span class="mt-1 block text-xs text-muted">Tap to continue auto spin</span>
                  </div>
                </div>
              </Transition>

              <Transition name="pop">
                <div
                  v-if="bigWinBanner"
                  class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 bg-[rgba(5,3,1,0.82)] backdrop-blur-[4px]"
                  :style="{ '--tier': bigWinIntensity }"
                >
                  <p
                    class="fire-bigwin-label"
                    :style="{ backgroundImage: bigWinGradient, filter: `drop-shadow(0 0 22px ${bigWinGlow})` }"
                  >
                    {{ bigWinLabel }}
                  </p>
                  <strong class="fire-bigwin-amount">
                    {{ formatNumber(bigWinAmount, false) }}
                  </strong>
                </div>
              </Transition>

              <div
                v-if="!isReady && !errorMsg"
                class="absolute inset-0 z-10 flex items-center justify-center"
              >
                <UIcon
                  name="i-lucide-loader-circle"
                  class="size-10 animate-spin text-[#f2c14e]"
                />
              </div>
            </div>

            <div class="grid grid-cols-1 items-center gap-3 border-t border-[#fbbf24]/15 bg-background/75 px-3.5 py-3 sm:grid-cols-[1fr_auto_1fr]">
              <div class="order-2 flex min-w-0 flex-col gap-1.5 sm:order-none">
                <div class="fire-readout">
                  <span>Balance</span>
                  <strong><CoinBalance
                    :compact="false"
                    :value="balance"
                  /></strong>
                </div>
                <div class="fire-readout">
                  <span>Bet</span>
                  <input
                    v-model="betInput"
                    :disabled="isPlaying || autoSpinEnabled"
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
                <span class="text-[10px] font-black tracking-wide uppercase text-muted">{{ isBonusActive ? status : 'Win' }}</span>
                <strong
                  class="mt-0.5 block text-3xl leading-none font-black tracking-normal"
                  :class="totalWin > 0 ? 'fire-value-gold' : 'text-muted/40'"
                >
                  {{ formatNumber(totalWin, false) }}
                </strong>
                <span class="mt-1 block text-[11px] font-bold text-muted">Last {{ formatNumber(lastWin, false) }}</span>
              </div>

              <div class="order-3 flex items-center justify-end gap-2.5 sm:order-none">
                <UTooltip text="Halve bet">
                  <button
                    class="fire-icon-btn"
                    :disabled="isPlaying || autoSpinEnabled || bet <= MIN_BET"
                    @click="betDown"
                  >
                    1/2
                  </button>
                </UTooltip>

                <div class="flex flex-col items-center gap-1.5">
                  <button
                    class="fire-spin-btn"
                    :disabled="!isReady || isPlaying || balance < spinCost"
                    @click="autoSpinEnabled ? stopAutoSpin() : play()"
                  >
                    <UIcon
                      v-if="isPlaying"
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
                    class="fire-auto-btn"
                    :disabled="!isReady || isPlaying || balance < spinCost"
                    @click="showAutoSpinModal = true"
                  >
                    AUTO
                  </button>
                  <button
                    v-else
                    class="fire-auto-btn fire-auto-btn-stop"
                    @click="stopAutoSpin"
                  >
                    STOP
                  </button>
                </div>

                <UTooltip text="Double bet">
                  <button
                    class="fire-icon-btn"
                    :disabled="isPlaying || autoSpinEnabled || bet >= MAX_BET"
                    @click="betUp"
                  >
                    2x
                  </button>
                </UTooltip>
              </div>
            </div>

            <div class="flex items-center justify-between gap-3 border-t border-[#fbbf24]/10 px-3.5 pt-2.5 pb-3">
              <div class="flex gap-2">
                <UTooltip text="Game rules">
                  <button
                    class="fire-mini-btn"
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
                    class="fire-mini-btn"
                    :class="{ 'fire-mini-btn-active': turbo }"
                    @click="turbo = !turbo"
                  >
                    <UIcon
                      name="i-lucide-zap"
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
                {{ status }} · {{ formatNumber(FITH_DISPLAY_MAX_WIN, false, 0) }}x max
              </p>
            </div>
          </div>
        </main>

        <aside class="order-2 xl:order-3">
          <div class="fire-panel p-4">
            <div class="fire-panel-head">
              <UIcon
                name="i-lucide-scroll-text"
                class="size-3.5"
              />
              <span>Recent spins</span>
            </div>
            <div
              v-if="history.length"
              class="fire-history mt-3 space-y-1.5"
            >
              <div
                v-for="(item, index) in history"
                :key="index"
                class="fire-history-item"
                :class="item.payout > 0 ? 'fire-history-item-win' : ''"
              >
                <UIcon
                  :name="item.bonus ? 'i-lucide-flame' : 'i-lucide-pickaxe'"
                  class="size-3.5 shrink-0"
                />
                <span class="min-w-0 flex-1 truncate text-[11px] font-bold tracking-wide text-muted uppercase">
                  {{ item.bonus ? 'Free spins' : 'Base spin' }}
                </span>
                <strong class="text-[13px]">{{ item.payout > 0 ? formatNumber(item.payout, false) : '0.00' }}</strong>
              </div>
            </div>
            <UEmpty
              v-else
              class="mt-2"
              icon="i-lucide-pickaxe"
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
        <div class="space-y-4">
          <div class="grid grid-cols-5 gap-2">
            <UButton
              v-for="count in AUTO_SPIN_OPTIONS"
              :key="count"
              block
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

    <UModal
      v-model:open="showHelp"
      title="How Fire in the Hole works"
    >
      <template #body>
        <div class="space-y-3 text-sm text-muted">
          <p>Connect {{ FITH_MIN_CONNECTION }}+ matching symbols. Bombs are wilds, explode nearby tiles, and unlock deeper rows when they hit near the divider.</p>
          <p>Three scatters award {{ FITH_FREE_SPINS }} free spins using only the rows you unlocked during the base spin.</p>
          <p>Bonus coins can land as low as 0.13x and 0.33x. Sticky boosts add flat value every spin, doublers multiply everything on the board when they land, and collectors absorb coins.</p>
          <p>Buy bonus skips straight to {{ FITH_FREE_SPINS }} free spins for {{ formatNumber(buyBonusCost, false) }} ({{ FITH_BUY_BONUS_COST }}x bet).</p>
          <p>Total win is realistically capped around {{ formatNumber(FITH_DISPLAY_MAX_WIN, false, 0) }}x bet — huge outlier bonus rounds can occasionally push higher.</p>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.fire-shell {
  --fith-gold: #f2c14e;
  --fith-gold-soft: #fde68a;
  --fith-gold-deep: #92400e;
  --fith-ruby: #ef4444;
  --fith-ruby-deep: #7f1d1d;
  background: var(--ui-bg);
}

.fire-bg {
  background: url('/slots/fireinthehole/background.png') center 30% / cover no-repeat;
}

.fire-vignette {
  background: radial-gradient(ellipse 75% 65% at 50% 36%, rgba(120, 53, 15, 0.16) 0%, rgba(9, 9, 11, 0.58) 70%, rgba(3, 7, 18, 0.9) 100%);
}

.fire-title {
  background: linear-gradient(180deg, #fff7ed 0%, var(--fith-gold-soft) 45%, var(--fith-gold) 78%, #c2740c 100%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 3px 0 rgba(69, 26, 3, 0.8), 0 0 30px rgba(251, 146, 60, 0.45);
}

.fire-eyebrow-line {
  height: 1px;
  width: 32px;
  background: linear-gradient(90deg, transparent, rgba(242, 193, 78, 0.7));
}

.fire-eyebrow-line:last-child {
  background: linear-gradient(90deg, rgba(242, 193, 78, 0.7), transparent);
}

.fire-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(242, 193, 78, 0.28);
  border-radius: 999px;
  background: rgba(146, 64, 14, 0.14);
  padding: 4px 10px;
  color: var(--fith-gold-soft);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.03em;
}

.fire-badge-ruby {
  border-color: rgba(239, 68, 68, 0.28);
  background: rgba(127, 29, 29, 0.18);
  color: #fca5a5;
}

.fire-console,
.fire-panel {
  position: relative;
  border: 1px solid rgba(251, 146, 60, 0.24);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(24, 24, 27, 0.92), rgba(9, 9, 11, 0.96));
  box-shadow: 0 26px 80px rgba(0, 0, 0, 0.56), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 42px rgba(251, 146, 60, 0.08);
  backdrop-filter: blur(10px);
}

.fire-console {
  border-top-color: rgba(242, 193, 78, 0.5);
}

.fire-console::before {
  content: '';
  position: absolute;
  z-index: 1;
  inset: 0 0 auto 0;
  height: 3px;
  background: repeating-linear-gradient(-45deg, var(--fith-gold) 0 10px, var(--fith-ruby-deep) 10px 20px);
  opacity: 0.85;
  border-radius: 8px 8px 0 0;
}

.fire-panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fith-gold);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fire-panel-head span {
  color: var(--ui-text-muted);
}

.fire-value-gold {
  color: var(--fith-gold-soft);
  text-shadow: 0 0 16px rgba(242, 193, 78, 0.4);
}

.fire-depth-bar {
  position: relative;
  height: 7px;
  overflow: hidden;
  border: 1px solid rgba(251, 146, 60, 0.16);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
}

.fire-depth-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--fith-ruby-deep), var(--fith-gold-deep), var(--fith-gold));
  box-shadow: 0 0 10px rgba(242, 193, 78, 0.55);
  transition: width 320ms ease;
}

.fire-panel-bonus {
  transition: box-shadow 260ms ease, border-color 260ms ease;
}

.fire-panel-bonus-active {
  border-color: rgba(242, 193, 78, 0.55);
  box-shadow: 0 26px 80px rgba(0, 0, 0, 0.56), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 30px rgba(242, 193, 78, 0.28);
  animation: fire-bonus-pulse 1.8s ease-in-out infinite;
}

@keyframes fire-bonus-pulse {
  0%, 100% {
    box-shadow: 0 26px 80px rgba(0, 0, 0, 0.56), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 22px rgba(242, 193, 78, 0.22);
  }
  50% {
    box-shadow: 0 26px 80px rgba(0, 0, 0, 0.56), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 38px rgba(242, 193, 78, 0.42);
  }
}

.fire-buy-btn {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(242, 193, 78, 0.45);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(127, 29, 29, 0.55), rgba(146, 64, 14, 0.55));
  padding: 9px 10px;
  color: var(--fith-gold-soft);
  font-size: 12.5px;
  font-weight: 900;
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, opacity 140ms ease;
}

.fire-buy-btn:not(:disabled):hover {
  border-color: rgba(242, 193, 78, 0.8);
  background: linear-gradient(180deg, rgba(153, 27, 27, 0.65), rgba(180, 83, 9, 0.65));
  transform: translateY(-1px);
}

.fire-buy-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.fire-history-item {
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(251, 146, 60, 0.12);
  border-left: 2px solid rgba(251, 146, 60, 0.2);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.28);
  padding: 7px 9px;
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 800;
}

.fire-history-item-win {
  border-left-color: var(--fith-gold);
  color: var(--fith-gold-soft);
}

.fire-reel-area {
  background:
    radial-gradient(ellipse 88% 64% at 50% 0%, rgba(154, 52, 18, 0.2), transparent 72%),
    linear-gradient(180deg, rgba(39, 39, 42, 0.8), rgba(9, 9, 11, 0.96));
}

.fire-reel-sheen {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 22%),
    radial-gradient(ellipse 70% 44% at 50% 105%, rgba(0, 0, 0, 0.38), transparent 65%);
}

.fire-stat,
.fire-readout {
  border: 1px solid rgba(251, 146, 60, 0.13);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.28);
}

.fire-stat {
  padding: 9px 8px;
}

.fire-stat-icon {
  margin-bottom: 2px;
  color: var(--fith-gold);
  opacity: 0.7;
  width: 14px;
  height: 14px;
}

.fire-stat-ruby .fire-stat-icon {
  color: var(--fith-ruby);
}

.fire-stat span,
.fire-readout span {
  display: block;
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fire-stat strong {
  display: block;
  margin-top: 3px;
  color: var(--fith-gold-soft);
  font-size: 20px;
  line-height: 1;
}

.fire-stat-ruby strong {
  color: #fca5a5;
}

.fire-readout {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
}

.fire-readout strong {
  min-width: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 950;
  text-align: right;
}

.fire-spin-btn,
.fire-icon-btn,
.fire-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(251, 146, 60, 0.28);
  background: rgba(0, 0, 0, 0.45);
  color: white;
  font-weight: 950;
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, opacity 140ms ease;
}

.fire-spin-btn {
  width: 84px;
  height: 58px;
  border-color: rgba(251, 146, 60, 0.8);
  border-radius: 999px;
  background: linear-gradient(180deg, rgb(253, 186, 116), rgb(194, 65, 12));
  color: rgb(24, 24, 27);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.42), 0 0 24px rgba(251, 146, 60, 0.36);
}

.fire-icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 8px;
}

.fire-mini-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
}

.fire-mini-btn-active {
  border-color: rgba(251, 146, 60, 0.95);
  background: rgba(251, 146, 60, 0.18);
}

.fire-spin-btn:disabled,
.fire-icon-btn:disabled,
.fire-mini-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.fire-spin-btn:not(:disabled):hover,
.fire-icon-btn:not(:disabled):hover,
.fire-mini-btn:not(:disabled):hover {
  transform: translateY(-1px);
}

.fire-auto-btn {
  border: 0;
  background: none;
  color: var(--ui-text-muted);
  cursor: pointer;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.22em;
  padding: 0;
}

.fire-auto-btn:hover:not(:disabled) {
  color: var(--fith-gold);
}

.fire-auto-btn-stop {
  color: var(--ui-error);
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

.fire-bigwin-label {
  margin: 0;
  font-size: calc(26px + var(--tier, 1) * 6px);
  font-weight: 950;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  animation: fire-bigwin-pop 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both;
}

.fire-bigwin-amount {
  font-size: calc(34px + var(--tier, 1) * 9px);
  font-weight: 950;
  line-height: 1;
  color: rgb(254, 243, 199);
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.6), 0 0 26px rgba(250, 204, 21, 0.55);
  animation: fire-bigwin-pop 0.5s 0.08s cubic-bezier(0.2, 1.4, 0.4, 1) both;
}

@keyframes fire-bigwin-pop {
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
