<script setup lang="ts">
import type { FireBonusDrop, FireBonusResult, FireBonusValueEvent, FireCell, FireCascadeStep, FireInTheHoleResult, FireSymbol } from '#shared/utils/gamelogic/fireinthehole'
import { FITH_BUY_BONUS_COST, FITH_COLS, FITH_FREE_SPINS, FITH_MAX_WIN_MULT, FITH_MIN_CONNECTION, FITH_ROWS, playFireInTheHole } from '#shared/utils/gamelogic/fireinthehole'

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

const MIN_BET = 1
const MAX_BET = 1_000_000
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

const symbolMeta: Record<FireSymbol, { label: string, color: number, accent: number }> = {
  coal: { label: 'C', color: 0x3f3f46, accent: 0xa1a1aa },
  ore: { label: 'O', color: 0x0f766e, accent: 0x5eead4 },
  ruby: { label: 'R', color: 0xbe123c, accent: 0xfda4af },
  sapphire: { label: 'S', color: 0x1d4ed8, accent: 0x93c5fd },
  emerald: { label: 'E', color: 0x15803d, accent: 0x86efac },
  bomb: { label: 'B', color: 0x18181b, accent: 0xf97316 },
  scatter: { label: 'FS', color: 0x7c2d12, accent: 0xfacc15 },
  coin: { label: '', color: 0xca8a04, accent: 0xfef3c7 },
  boost: { label: '+', color: 0x0f766e, accent: 0x99f6e4 },
  double: { label: '2X', color: 0x6d28d9, accent: 0xddd6fe },
  collector: { label: '', color: 0xbe123c, accent: 0xfef3c7 },
  empty: { label: '', color: 0x27272a, accent: 0x3f3f46 },
  rock: { label: '', color: 0x27272a, accent: 0x52525b }
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

async function initPixi() {
  if (!canvasHost.value || pixiApp) return

  const [
    { Application, Container, Graphics, Text },
    { ReelSetBuilder, ReelSymbol, SpeedPresets },
    { gsap }
  ] = await Promise.all([
    import('pixi.js'),
    import('pixi-reels'),
    import('gsap')
  ])

  class MineSymbol extends ReelSymbol {
    private readonly tile = new Graphics()
    private readonly ring = new Graphics()
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

    private readonly glyph = new Text({
      text: '',
      style: {
        fill: 0xffffff,
        fontFamily: 'Inter, ui-sans-serif, system-ui',
        fontSize: 28,
        fontWeight: '900'
      }
    })

    private symbol: FireSymbol = 'coal'
    private width = 100
    private height = 100

    constructor() {
      super()
      this.view.addChild(this.tile, this.ring, this.bonusLabelBg, this.bonusLabel, this.glyph)
      this.bonusLabel.anchor.set(0.5)
      this.glyph.anchor.set(0.5)
    }

    protected onActivate(symbolId: string): void {
      this.symbol = symbolId as FireSymbol
      this.glyph.text = symbolMeta[this.symbol].label
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
      const bgColor = drop.symbol === 'collector'
        ? 0xbe123c
        : drop.symbol === 'boost'
          ? 0x047857
          : drop.symbol === 'double'
            ? 0x6d28d9
            : 0x92400e

      this.bonusLabel.text = text
      this.bonusLabel.visible = true
      this.bonusLabel.style.fontSize = text.length > 5 ? 19 : 23
      this.bonusLabel.position.set(this.width * 0.5, this.height * 0.5)
      this.bonusLabelBg.clear()
      this.bonusLabelBg.roundRect(this.width * 0.5 - 42, this.height * 0.5 - 20, 84, 40, 20)
      this.bonusLabelBg.fill({ color: bgColor, alpha: 0.9 })
      this.bonusLabelBg.stroke({ color: 0xfef3c7, alpha: 0.9, width: 2 })
      this.draw()
    }

    private draw() {
      const meta = symbolMeta[this.symbol]
      const pad = 5
      const radius = this.symbol === 'bomb' || this.symbol === 'coin' || this.symbol === 'collector' ? 999 : 13

      this.tile.clear()
      this.tile.roundRect(pad, pad, this.width - pad * 2, this.height - pad * 2, radius)
      this.tile.fill({ color: meta.color, alpha: this.symbol === 'rock' || this.symbol === 'empty' ? 0.72 : 0.96 })
      this.tile.stroke({ color: meta.accent, alpha: this.symbol === 'rock' || this.symbol === 'empty' ? 0.28 : 0.78, width: this.symbol === 'bomb' ? 4 : 2 })

      this.ring.clear()

      if (this.symbol === 'bomb') {
        this.ring.circle(this.width * 0.5, this.height * 0.5, Math.min(this.width, this.height) * 0.24)
        this.ring.stroke({ color: 0xffedd5, alpha: 0.95, width: 4 })
        this.ring.moveTo(this.width * 0.58, this.height * 0.28)
        this.ring.lineTo(this.width * 0.72, this.height * 0.14)
        this.ring.stroke({ color: meta.accent, alpha: 1, width: 5 })
      } else if (this.symbol === 'scatter') {
        this.ring.star(this.width * 0.5, this.height * 0.48, 5, this.width * 0.28, this.width * 0.13)
        this.ring.fill({ color: meta.accent, alpha: 0.28 })
        this.ring.stroke({ color: 0xfef3c7, alpha: 0.85, width: 3 })
      } else if (this.symbol === 'coin' || this.symbol === 'collector') {
        this.ring.circle(this.width * 0.5, this.height * 0.5, Math.min(this.width, this.height) * 0.32)
        this.ring.fill({ color: meta.accent, alpha: this.symbol === 'collector' ? 0.22 : 0.18 })
        this.ring.stroke({ color: meta.accent, alpha: 0.9, width: 4 })
        this.ring.circle(this.width * 0.5, this.height * 0.5, Math.min(this.width, this.height) * 0.2)
        this.ring.stroke({ color: 0xffffff, alpha: 0.55, width: 2 })
      } else if (this.symbol === 'rock') {
        for (let i = 0; i < 3; i++) {
          const y = this.height * (0.32 + i * 0.18)
          this.ring.moveTo(this.width * 0.22, y)
          this.ring.lineTo(this.width * 0.78, y - 8)
          this.ring.stroke({ color: meta.accent, alpha: 0.38, width: 3 })
        }
      } else {
        this.ring.roundRect(this.width * 0.24, this.height * 0.24, this.width * 0.52, this.height * 0.52, 12)
        this.ring.fill({ color: meta.accent, alpha: 0.18 })
        this.ring.stroke({ color: 0xffffff, alpha: 0.42, width: 2 })
      }

      this.glyph.position.set(this.width * 0.5, this.height * 0.52)
      this.glyph.visible = !this.bonusLabel.visible && !['rock', 'empty', 'coin', 'collector'].includes(this.symbol)

      if (this.bonusLabel.visible) {
        this.bonusLabel.position.set(this.width * 0.5, this.height * 0.5)
        this.bonusLabelBg.clear()
        const bgColor = this.symbol === 'collector'
          ? 0xbe123c
          : this.symbol === 'boost'
            ? 0x047857
            : this.symbol === 'double'
              ? 0x6d28d9
              : 0x92400e

        this.bonusLabelBg.roundRect(this.width * 0.5 - 42, this.height * 0.5 - 20, 84, 40, 20)
        this.bonusLabelBg.fill({ color: bgColor, alpha: 0.9 })
        this.bonusLabelBg.stroke({ color: 0xfef3c7, alpha: 0.9, width: 2 })
      }
    }
  }

  pixiApp = new Application()
  await pixiApp.init({
    width: 760,
    height: 760,
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
    .symbolSize(108, 108)
    .symbolGap(8, 8)
    .bufferSymbols(1)
    .symbols((registry) => {
      for (const id of Object.keys(symbolMeta)) {
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

  reelSet.position.set(36, 36)
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

  const size = Math.max(320, Math.min(canvasHost.value.clientWidth, 760))
  pixiApp.renderer.resize(size, size)

  const contentSize = 720
  const scale = size / contentSize
  reelSet.scale.set(scale)

  if (effectsLayer) effectsLayer.scale.set(scale)
  if (bonusValueLayer) bonusValueLayer.scale.set(scale)
  if (dividerLayer) dividerLayer.scale.set(scale)
  drawMineBoundary()
}

function cellCenter(cell: FireCell) {
  if (!reelSet) return { x: 0, y: 0 }

  const bounds = reelSet.getCellBounds(cell.col, cell.row)
  return {
    x: reelSet.x + bounds.x + bounds.width / 2,
    y: reelSet.y + bounds.y + bounds.height / 2
  }
}

async function spawnBlast(cell: FireCell, bomb = false) {
  if (!pixiApp || !effectsLayer) return

  const { Graphics } = await import('pixi.js')
  const { gsap } = await import('gsap')
  const center = cellCenter(cell)
  const count = bomb ? 40 : 10
  const colors = bomb ? [0xffedd5, 0xfb923c, 0xef4444, 0xfacc15, 0xfdba74] : [0xd4d4d8, 0xa1a1aa, 0xffffff]

  if (bomb) {
    const ring = new Graphics()
    ring.circle(0, 0, 34)
    ring.stroke({ color: 0xfb923c, alpha: 1, width: 7 })
    ring.position.set(center.x, center.y)
    ring.scale.set(0.2)
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
  }

  for (let i = 0; i < count; i++) {
    const particle = new Graphics()
    const color = colors[i % colors.length]!
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.35
    const distance = (bomb ? 88 : 38) + Math.random() * (bomb ? 82 : 22)
    const size = bomb ? 3 + Math.random() * 6 : 2 + Math.random() * 3

    if (bomb && i % 3 === 0) {
      particle.roundRect(-size * 0.5, -size * 2.3, size, size * 4.6, size)
      particle.rotation = angle
    } else {
      particle.circle(0, 0, size)
    }
    particle.fill({ color, alpha: 0.95 })
    particle.position.set(center.x, center.y)
    effectsLayer.addChild(particle)

    gsap.to(particle.position, {
      x: center.x + Math.cos(angle) * distance,
      y: center.y + Math.sin(angle) * distance,
      duration: bomb ? 0.58 : 0.34,
      ease: 'power3.out'
    })
    gsap.to(particle.scale, {
      x: 0.3,
      y: 0.3,
      duration: bomb ? 0.58 : 0.34,
      ease: 'power2.in'
    })
    gsap.to(particle, {
      alpha: 0,
      duration: bomb ? 0.6 : 0.36,
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
  const rowPitch = second.y - first.y
  const bottom = reelSet.y + last.y + last.height
  const left = reelSet.x + first.x
  const right = reelSet.x + last.x + last.width
  const lockedTop = boundaryVisualLines >= FITH_ROWS
    ? bottom
    : reelSet.y + first.y + boundaryVisualLines * rowPitch - 8

  if (boundaryVisualLines < FITH_ROWS) {
    dividerLayer.rect(left - 2, lockedTop, right - left + 4, bottom - lockedTop)
    dividerLayer.fill({ color: 0x18181b, alpha: 0.88 })

    dividerLayer.roundRect(left - 6, lockedTop - 3, right - left + 12, 7, 7)
    dividerLayer.fill({ color: 0x10b981, alpha: 1 })
    dividerLayer.roundRect(left - 6, lockedTop + 5, right - left + 12, 2, 2)
    dividerLayer.fill({ color: 0x064e3b, alpha: 0.62 })
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

  const { Container, Graphics, Text } = await import('pixi.js')
  const { gsap } = await import('gsap')
  const center = cells.reduce((point, cell) => {
    const next = cellCenter(cell)
    return { x: point.x + next.x, y: point.y + next.y }
  }, { x: 0, y: 0 })
  const popup = new Container()
  const label = new Text({
    text: `+$${formatNumber(amount, false)}`,
    style: {
      fill: 0xfef3c7,
      fontFamily: 'Inter, ui-sans-serif, system-ui',
      fontSize: 34,
      fontWeight: '900',
      stroke: { color: 0x111827, width: 6 }
    }
  })
  const bg = new Graphics()

  label.anchor.set(0.5)
  bg.roundRect(-label.width / 2 - 18, -label.height / 2 - 9, label.width + 36, label.height + 18, 18)
  bg.fill({ color: 0x065f46, alpha: 0.92 })
  bg.stroke({ color: 0xfacc15, alpha: 0.95, width: 3 })

  popup.addChild(bg, label)
  popup.position.set(center.x / cells.length, center.y / cells.length)
  popup.scale.set(0.62)
  effectsLayer.addChild(popup)

  gsap.to(popup.scale, {
    x: 1,
    y: 1,
    duration: 0.18,
    ease: 'back.out(2.4)'
  })
  gsap.to(popup.position, {
    y: popup.y - 78,
    duration: 0.9,
    ease: 'power3.out'
  })
  gsap.to(popup, {
    alpha: 0,
    duration: 0.22,
    delay: 0.68,
    ease: 'power2.in',
    onComplete: () => popup.destroy({ children: true })
  })
}

function clearBonusValues() {
  bonusValueLayer?.removeChildren().forEach(child => child.destroy({ children: true }))
}

async function drawBonusValues(coins: FireBonusDrop[]) {
  if (!bonusValueLayer) return

  const { Container, Graphics, Text } = await import('pixi.js')

  clearBonusValues()

  for (const coin of coins) {
    const bounds = reelSet?.getCellBounds(coin.col, coin.row)
    if (!bounds) continue

    const meta = symbolMeta[coin.symbol]
    const holder = new Container()
    const tile = new Graphics()
    const ring = new Graphics()
    const bg = new Graphics()
    const labelText = coin.symbol === 'boost'
      ? `+${formatNumber(coin.multiplier, false)}x`
      : `${formatNumber(coin.multiplier, false)}x`
    const label = new Text({
      text: labelText,
      style: {
        fill: 0xfffbeb,
        fontFamily: 'Inter, ui-sans-serif, system-ui',
        fontSize: coin.multiplier >= 1000 || coin.symbol === 'boost' ? 22 : 26,
        fontWeight: '900',
        stroke: { color: coin.symbol === 'collector' ? 0x7f1d1d : coin.symbol === 'boost' ? 0x064e3b : 0x713f12, width: 5 }
      }
    })

    const width = bounds.width
    const height = bounds.height
    const pad = 5

    label.anchor.set(0.5)
    tile.roundRect(pad, pad, width - pad * 2, height - pad * 2, coin.symbol === 'boost' ? 16 : 999)
    tile.fill({ color: meta.color, alpha: 0.98 })
    tile.stroke({ color: meta.accent, alpha: 0.92, width: 4 })

    if (coin.symbol === 'boost') {
      ring.roundRect(width * 0.22, height * 0.22, width * 0.56, height * 0.56, 14)
      ring.fill({ color: meta.accent, alpha: 0.2 })
      ring.stroke({ color: meta.accent, alpha: 0.86, width: 4 })
      ring.moveTo(width * 0.35, height * 0.5)
      ring.lineTo(width * 0.65, height * 0.5)
      ring.moveTo(width * 0.5, height * 0.35)
      ring.lineTo(width * 0.5, height * 0.65)
      ring.stroke({ color: 0xffffff, alpha: 0.45, width: 5 })
    } else {
      ring.circle(width * 0.5, height * 0.5, Math.min(width, height) * 0.32)
      ring.fill({ color: meta.accent, alpha: coin.symbol === 'collector' ? 0.24 : 0.18 })
      ring.stroke({ color: meta.accent, alpha: 0.9, width: 4 })
      ring.circle(width * 0.5, height * 0.5, Math.min(width, height) * 0.2)
      ring.stroke({ color: 0xffffff, alpha: 0.55, width: 2 })
    }

    bg.roundRect(width * 0.5 - 42, height * 0.5 - 20, 84, 40, 20)
    bg.fill({ color: coin.symbol === 'collector' ? 0xbe123c : coin.symbol === 'boost' ? 0x047857 : 0x92400e, alpha: 0.88 })
    bg.stroke({ color: 0xfef3c7, alpha: 0.9, width: 2 })

    label.position.set(width * 0.5, height * 0.5)
    holder.addChild(tile, ring, bg, label)
    holder.position.set(reelSet!.x + bounds.x, reelSet!.y + bounds.y)
    bonusValueLayer.addChild(holder)
  }
}

async function spawnBonusDropPopup(drop: FireBonusDrop, speedFactor = 1) {
  if (!effectsLayer) return

  const { Container, Graphics, Text } = await import('pixi.js')
  const { gsap } = await import('gsap')
  const center = cellCenter(drop)
  const text = drop.symbol === 'boost'
    ? `+${formatNumber(drop.multiplier, false)}x ALL`
    : drop.symbol === 'double'
      ? 'DOUBLE'
      : drop.symbol === 'collector'
        ? 'COLLECT'
        : `${formatNumber(drop.multiplier, false)}x`
  const popup = new Container()
  const label = new Text({
    text,
    style: {
      fill: 0xfef3c7,
      fontFamily: 'Inter, ui-sans-serif, system-ui',
      fontSize: drop.symbol === 'collector' ? 24 : 28,
      fontWeight: '900',
      stroke: { color: 0x111827, width: 5 }
    }
  })
  const bg = new Graphics()

  label.anchor.set(0.5)
  bg.roundRect(-label.width / 2 - 14, -label.height / 2 - 8, label.width + 28, label.height + 16, 16)
  bg.fill({ color: drop.symbol === 'double' ? 0x6d28d9 : drop.symbol === 'collector' ? 0xbe123c : 0x065f46, alpha: 0.92 })
  bg.stroke({ color: 0xfacc15, alpha: 0.9, width: 2 })

  popup.addChild(bg, label)
  popup.position.set(center.x, center.y)
  popup.scale.set(0.68)
  effectsLayer.addChild(popup)

  gsap.to(popup.scale, {
    x: 1,
    y: 1,
    duration: 0.13 * speedFactor,
    ease: 'back.out(2.2)'
  })
  gsap.to(popup.position, {
    y: popup.y - 64,
    duration: 0.48 * speedFactor,
    ease: 'power3.out'
  })
  gsap.to(popup, {
    alpha: 0,
    duration: 0.16 * speedFactor,
    delay: 0.34 * speedFactor,
    ease: 'power2.in',
    onComplete: () => popup.destroy({ children: true })
  })
}

async function animateValueTransfer(event: FireBonusValueEvent, speedFactor = 1) {
  if (!effectsLayer) return

  const { Container, Graphics, Text } = await import('pixi.js')
  const { gsap } = await import('gsap')
  const from = event.type === 'collect' ? cellCenter(event.target) : cellCenter(event.source)
  const to = event.type === 'collect' ? cellCenter(event.source) : cellCenter(event.target)
  const text = event.type === 'double'
    ? `+${formatNumber(event.amount, false)}x`
    : event.type === 'collect'
      ? `${formatNumber(event.amount, false)}x`
      : `+${formatNumber(event.amount, false)}x`
  const chip = new Container()
  const bg = new Graphics()
  const label = new Text({
    text,
    style: {
      fill: 0xfffbeb,
      fontFamily: 'Inter, ui-sans-serif, system-ui',
      fontSize: event.amount >= 1000 ? 20 : 24,
      fontWeight: '900',
      stroke: { color: event.type === 'double' ? 0x312e81 : event.type === 'collect' ? 0x7f1d1d : 0x064e3b, width: 5 }
    }
  })
  const color = event.type === 'double' ? 0x6d28d9 : event.type === 'collect' ? 0xbe123c : 0x0f766e

  label.anchor.set(0.5)
  bg.roundRect(-label.width / 2 - 12, -label.height / 2 - 7, label.width + 24, label.height + 14, 14)
  bg.fill({ color, alpha: 0.94 })
  bg.stroke({ color: 0xfacc15, alpha: 0.9, width: 2 })

  chip.addChild(bg, label)
  chip.position.set(from.x, from.y)
  chip.scale.set(0.62)
  effectsLayer.addChild(chip)

  await gsap.to(chip.scale, {
    x: 1,
    y: 1,
    duration: 0.09 * speedFactor,
    ease: 'back.out(2)'
  })

  await gsap.to(chip.position, {
    x: to.x,
    y: to.y,
    duration: 0.24 * speedFactor,
    ease: 'power2.inOut'
  })

  const pulse = new Graphics()
  pulse.circle(0, 0, 28)
  pulse.stroke({ color: 0xfacc15, alpha: 0.95, width: 4 })
  pulse.position.set(to.x, to.y)
  pulse.scale.set(0.35)
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

  await gsap.to(chip, {
    alpha: 0,
    duration: 0.08 * speedFactor,
    ease: 'power2.in',
    onComplete: () => chip.destroy({ children: true })
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
      bonusMultiplier.value = bonusVisibleTotal(lockedCoins.values())
      await sleep(38 * speedFactor)
    }

    lockedCoins.clear()
    for (const coin of step.coins) {
      lockedCoins.set(cellKey(coin), { ...coin })
    }
    await drawBonusValues([...lockedCoins.values()])
    bonusMultiplier.value = step.totalMultiplier

    const bonusWin = step.totalMultiplier * (latestResult?.bet ?? 1)
    totalWin.value = Number(((latestResult?.basePayout ?? 0) + bonusWin).toFixed(2))
    lastWin.value = Number(bonusWin.toFixed(2))
    if (bonusWin > 0) pulseWin()
    await stepDelay(150)
  }

  totalWin.value = latestResult?.payout ?? bonus.payout
  lastWin.value = bonus.payout
  bonusMultiplier.value = bonus.totalMultiplier
  status.value = `Bonus ${formatNumber(bonus.totalMultiplier, false)}x`
}

async function flashUnlockedRows(rows: number[]) {
  if (!effectsLayer || rows.length === 0) return

  const { Graphics } = await import('pixi.js')
  const { gsap } = await import('gsap')

  for (const row of rows) {
    for (let col = 0; col < FITH_COLS; col++) {
      const bounds = reelSet?.getCellBounds(col, row)
      if (!bounds) continue

      const flash = new Graphics()
      flash.roundRect(reelSet!.x + bounds.x + 5, reelSet!.y + bounds.y + 5, bounds.width - 10, bounds.height - 10, 14)
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
      <header class="mb-4 text-center">
        <p class="text-xs font-black tracking-[0.28em] uppercase text-primary">
          Fire in the Hole
        </p>
        <h1 class="fire-title text-[36px] leading-none font-black tracking-normal sm:text-[52px]">
          Fire in the Hole
        </h1>
      </header>

      <div class="grid gap-4 xl:grid-cols-[250px_minmax(0,760px)_260px] xl:items-start">
        <aside class="order-3 xl:order-1">
          <div class="fire-panel p-4">
            <div class="flex items-center justify-between">
              <span class="text-xs font-black tracking-wide uppercase text-muted">Mine depth</span>
              <strong class="text-sm text-primary">{{ activeLines }}/6</strong>
            </div>
            <UProgress
              class="mt-3"
              :model-value="activeLines"
              :max="6"
              color="primary"
            />
            <div class="mt-4 grid grid-cols-2 gap-2 text-center">
              <div class="fire-stat">
                <span>Cascades</span>
                <strong>{{ chainCount }}</strong>
              </div>
              <div class="fire-stat">
                <span>Bombs</span>
                <strong>{{ lastBombs }}</strong>
              </div>
            </div>
          </div>

          <div class="fire-panel mt-3 p-4">
            <div class="flex items-center justify-between">
              <span class="text-xs font-black tracking-wide uppercase text-muted">Bonus multi</span>
              <UIcon
                name="i-lucide-sparkles"
                :class="isBonusActive ? 'text-primary' : 'text-muted'"
              />
            </div>
            <strong
              class="mt-2 block text-3xl leading-none font-black tracking-normal"
              :class="isBonusActive ? 'text-primary' : 'text-muted'"
            >
              {{ formatNumber(bonusMultiplier, false) }}x
            </strong>
          </div>

          <div class="fire-panel mt-3 p-3">
            <UButton
              block
              color="primary"
              :disabled="!isReady || isPlaying || autoSpinEnabled || balance < buyBonusCost"
              icon="i-lucide-flame"
              :label="`Buy bonus · ${formatNumber(buyBonusCost, false)}`"
              size="sm"
              variant="soft"
              @click="play(true)"
            />
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
                  <div class="rounded-lg border border-primary/40 bg-background/95 px-6 py-4 text-center shadow-xl">
                    <p class="text-base font-black text-highlighted">
                      Bonus complete
                    </p>
                    <span class="mt-1 block text-xs text-muted">Tap to continue auto spin</span>
                  </div>
                </div>
              </Transition>

              <div
                v-if="!isReady && !errorMsg"
                class="absolute inset-0 z-10 flex items-center justify-center"
              >
                <UIcon
                  name="i-lucide-loader-circle"
                  class="size-10 animate-spin text-primary"
                />
              </div>
            </div>

            <div class="grid grid-cols-1 items-center gap-3 border-t border-primary/15 bg-background/75 px-3.5 py-3 sm:grid-cols-[1fr_auto_1fr]">
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
                  :class="totalWin > 0 ? 'text-primary' : 'text-muted/40'"
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

            <div class="flex items-center justify-between gap-3 border-t border-primary/10 px-3.5 pt-2.5 pb-3">
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
                {{ status }} · {{ FITH_MAX_WIN_MULT }}x max
              </p>
            </div>
          </div>
        </main>

        <aside class="order-2 xl:order-3">
          <div class="fire-panel p-4">
            <p class="mb-3 text-xs font-black tracking-wide uppercase text-muted">
              Recent spins
            </p>
            <div
              v-if="history.length"
              class="space-y-2"
            >
              <div
                v-for="(item, index) in history"
                :key="index"
                class="flex items-center justify-between rounded-lg border border-primary/10 bg-background/55 px-2.5 py-2 text-[13px] font-extrabold"
                :class="item.payout > 0 ? 'text-primary' : 'text-muted'"
              >
                <span>{{ item.bonus ? 'Free spins' : 'Base spin' }}</span>
                <strong>{{ item.payout > 0 ? formatNumber(item.payout, false) : '0.00' }}</strong>
              </div>
            </div>
            <UEmpty
              v-else
              icon="i-lucide-flame"
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
          <p>Total win is capped at {{ FITH_MAX_WIN_MULT }}x bet.</p>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.fire-shell {
  background: var(--ui-bg);
}

.fire-bg {
  background:
    linear-gradient(180deg, rgba(24, 24, 27, 0.4), rgba(9, 9, 11, 0.94)),
    repeating-linear-gradient(90deg, rgba(251, 146, 60, 0.08) 0 1px, transparent 1px 84px),
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.04) 0 1px, transparent 1px 72px);
}

.fire-vignette {
  background: radial-gradient(ellipse 75% 65% at 50% 36%, rgba(120, 53, 15, 0.16) 0%, rgba(9, 9, 11, 0.58) 70%, rgba(3, 7, 18, 0.9) 100%);
}

.fire-title {
  color: rgb(255, 247, 237);
  text-shadow: 0 3px 0 rgba(69, 26, 3, 0.8), 0 0 26px rgba(251, 146, 60, 0.42);
}

.fire-console,
.fire-panel {
  border: 1px solid rgba(251, 146, 60, 0.24);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(24, 24, 27, 0.92), rgba(9, 9, 11, 0.96));
  box-shadow: 0 26px 80px rgba(0, 0, 0, 0.56), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 42px rgba(251, 146, 60, 0.08);
  backdrop-filter: blur(10px);
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

.fire-stat span,
.fire-readout span {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fire-stat strong {
  display: block;
  margin-top: 3px;
  color: var(--ui-primary);
  font-size: 20px;
  line-height: 1;
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
  color: var(--ui-primary);
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
</style>
