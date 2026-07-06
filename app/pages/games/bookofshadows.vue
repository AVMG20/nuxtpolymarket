<script setup lang="ts">
import type { BonusResult, BonusSpinResult, BonusTier, BookOfShadowsResult, Cell, ConnectionWin, SlotSymbol } from '#shared/utils/gamelogic/bookofshadows'
import { BONUS_TIERS, BOS_BUY_BONUS_COST, BOS_COLS, BOS_ROWS, SYMBOL_WEIGHTS } from '#shared/utils/gamelogic/bookofshadows'

const { user, setBalance, fetchSession } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))

watch(() => user.value?.balance, (value) => {
  if (value !== undefined) balance.value = parseFloat(value ?? '0')
})

const MIN_BET = 1
const MAX_BET = 1_000_000
const bet = ref(1)
const betInput = ref('1')
const buyBonusCost = computed(() => Math.round(bet.value * BOS_BUY_BONUS_COST * 100) / 100)
const turbo = ref(false)

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

const isSpinning = ref(false)
const ready = ref(false)
const errorMsg = ref('')
const lastWin = ref(0)

const showBigWin = ref(false)
const bigWinValue = ref(0)

const bonusData = ref<BonusResult | null>(null)
const showBonusPick = ref(false)
const rolling = ref(false)
const rolledTier = ref<BonusTier | null>(null)
const bonusRunning = ref(false)
const bonusSpinIndex = ref(0)
const bonusTotal = ref(0)

const showBonusFlash = ref(false)
const bonusFlashValue = ref(0)

const canvasWrap = ref<HTMLDivElement>()
let app: any = null
let reelSet: any = null
let REELS: any = null
let PIXI: any = null
let GSAP: any = null
let linesLayer: any = null
let completedSegments: { from: { x: number, y: number }, to: { x: number, y: number } }[] = []
let destroyed = false

// Grid is a touch bigger than the first pass.
const CELL = 94
const GAP = 8
const REEL_W = BOS_COLS * CELL + (BOS_COLS - 1) * GAP
const REEL_H = BOS_ROWS * CELL + (BOS_ROWS - 1) * GAP
const APP_W = REEL_W + 40
const APP_H = REEL_H + 40

const SYMBOL_COLOR: Record<SlotSymbol, number> = {
  ten: 0x334155,
  jack: 0x3f3f46,
  queen: 0x1e3a8a,
  king: 0x581c87,
  ace: 0x7c2d12,
  raven: 0x0f172a,
  cat: 0x4c1d95,
  potion: 0x166534,
  cauldron: 0x92400e,
  wild: 0xca8a04,
  bonuswild: 0xdc2626
}
const SYMBOL_LABEL: Record<SlotSymbol, string> = {
  ten: '10',
  jack: 'J',
  queen: 'Q',
  king: 'K',
  ace: 'A',
  raven: 'RAV',
  cat: 'CAT',
  potion: 'POT',
  cauldron: 'CLD',
  wild: 'BOOK',
  bonuswild: 'WILD'
}

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const stepDelay = (ms: number) => wait(turbo.value ? Math.round(ms * 0.55) : ms)
const cellKey = (c: Cell) => `${c.col}:${c.row}`

function makeSymbolClass() {
  const { Graphics, Text } = PIXI
  const Base = REELS.ReelSymbol

  class BlockSymbol extends Base {
    bg = new Graphics()
    label: any
    w = CELL
    h = CELL

    constructor() {
      super()
      this.label = new Text({
        text: '',
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 16, fontWeight: '900', fill: 0xffffff, align: 'center' }
      })
      this.label.anchor.set(0.5)
      this.view.addChild(this.bg)
      this.view.addChild(this.label)
    }

    _render(id: string) {
      const color = SYMBOL_COLOR[id as SlotSymbol] ?? 0x334155
      this.bg.clear()
      this.bg.roundRect(2, 2, this.w - 4, this.h - 4, 10).fill({ color }).stroke({ color: 0xffffff, width: 2, alpha: 0.15 })
      this.label.text = SYMBOL_LABEL[id as SlotSymbol] ?? id
      this.label.x = this.w / 2
      this.label.y = this.h / 2
    }

    onActivate(id: string) { this.view.alpha = 1; this.view.scale.set(1, 1); this._render(id) }
    onDeactivate() { /* no-op: nothing to tear down */ }
    resize(w: number, h: number) { this.w = w; this.h = h; if (this.symbolId) this._render(this.symbolId) }
    stopAnimation() { this.view.scale.set(1, 1) }
    playWin() { return Promise.resolve() }
  }

  return BlockSymbol
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
    await app.init({ width: APP_W, height: APP_H, background: '#0a0d14', antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) })
    if (destroyed) { app.destroy(true); return }
    canvasWrap.value?.appendChild(app.canvas)

    const BlockSymbol = makeSymbolClass()

    reelSet = new REELS.ReelSetBuilder()
      .reels(BOS_COLS).visibleRows(BOS_ROWS).symbolSize(CELL, CELL).symbolGap(GAP, GAP)
      .symbols((r: any) => {
        for (const id of Object.keys(SYMBOL_WEIGHTS)) r.register(id, BlockSymbol, {})
        r.register('bonuswild', BlockSymbol, {}) // bonus-only: never drawn by .weights(), placed via setSymbolAt
      })
      .weights(SYMBOL_WEIGHTS)
      .speed('normal', REELS.SpeedPresets.NORMAL)
      .speed('turbo', REELS.SpeedPresets.TURBO)
      .ticker(app.ticker)
      .build()

    reelSet.x = (APP_W - REEL_W) / 2
    reelSet.y = (APP_H - REEL_H) / 2
    app.stage.addChild(reelSet)

    linesLayer = new PIXI.Graphics()
    app.stage.addChild(linesLayer)

    ready.value = true
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load the slot engine'
  }
})

onUnmounted(() => {
  destroyed = true
  try { reelSet?.destroy?.() } catch { /* ignore */ }
  try { app?.destroy?.(true) } catch { /* ignore */ }
})

function allCells(): Cell[] {
  const cells: Cell[] = []
  for (let col = 0; col < BOS_COLS; col++) {
    for (let row = 0; row < BOS_ROWS; row++) cells.push({ col, row })
  }
  return cells
}

// Snap every cell back to its neutral look before a new spin, killing any
// leftover tween first so nothing overwrites the reset a frame later.
function resetCellLooks() {
  for (const { col, row } of allCells()) {
    const view = reelSet.getReel(col).getSymbolAt(row).view
    GSAP.killTweensOf(view)
    view.alpha = 1
  }
}

// Dim every cell not in `keepKeys` (built from `cellKey`), leaving the rest at full opacity.
async function dimAllExcept(keepKeys: Set<string>) {
  await Promise.all(allCells().map(cell => new Promise<void>((res) => {
    const sym = reelSet.getReel(cell.col).getSymbolAt(cell.row)
    GSAP.to(sym.view, { alpha: keepKeys.has(cellKey(cell)) ? 1 : 0.4, duration: 0.25, onComplete: () => res() })
  })))
}

async function restoreAlpha() {
  await Promise.all(allCells().map(cell => new Promise<void>((res) => {
    const sym = reelSet.getReel(cell.col).getSymbolAt(cell.row)
    GSAP.to(sym.view, { alpha: 1, duration: 0.2, onComplete: () => res() })
  })))
}

// Dim everything that didn't connect, flash the total win big and centered,
// then settle back to normal.
async function celebrateWins(result: BookOfShadowsResult) {
  if (!result.wins.length) return

  const winKeys = new Set(result.wins.flatMap(w => w.cells.map(cellKey)))
  await dimAllExcept(winKeys)

  bigWinValue.value = result.payout
  showBigWin.value = true
  await stepDelay(1200)
  showBigWin.value = false

  await restoreAlpha()
}

// Reveals a newly-locked column's BONUS_WILD cells outward from the cell that
// actually landed, so it reads as cascading up and down rather than a flat wipe.
async function expandColumn(col: number, triggerRow: number) {
  const order: number[] = []
  for (let d = 1; d < BOS_ROWS; d++) {
    const up = triggerRow - d
    const down = triggerRow + d
    if (up >= 0) order.push(up)
    if (down < BOS_ROWS) order.push(down)
  }

  for (const row of order) {
    reelSet.setSymbolAt(col, row, 'bonuswild')
    const sym = reelSet.getReel(col).getSymbolAt(row)
    GSAP.fromTo(sym.view.scale, { x: 1.3, y: 1.3 }, { x: 1, y: 1, duration: 0.18, ease: 'back.out(2)' })
    await stepDelay(45)
  }
}

function cellCenter(col: number, row: number) {
  return {
    x: reelSet.x + col * (CELL + GAP) + CELL / 2,
    y: reelSet.y + row * (CELL + GAP) + CELL / 2
  }
}

// Every adjacent-column pair inside a connection's cells (row ±1 or same
// row) — the full zigzag mesh, diagonals included.
function winEdges(win: ConnectionWin): [Cell, Cell][] {
  const edges: [Cell, Cell][] = []
  for (const a of win.cells) {
    for (const b of win.cells) {
      if (b.col === a.col + 1 && Math.abs(b.row - a.row) <= 1) edges.push([a, b])
    }
  }
  return edges
}

let activePartials = new Map<string, { from: { x: number, y: number }, to: { x: number, y: number }, t: number }>()

function redrawLines() {
  linesLayer.clear()
  for (const seg of completedSegments) {
    linesLayer.moveTo(seg.from.x, seg.from.y).lineTo(seg.to.x, seg.to.y).stroke({ width: 4, color: 0xffd700, alpha: 0.95 })
  }
  for (const p of activePartials.values()) {
    const x = p.from.x + (p.to.x - p.from.x) * p.t
    const y = p.from.y + (p.to.y - p.from.y) * p.t
    linesLayer.moveTo(p.from.x, p.from.y).lineTo(x, y).stroke({ width: 4, color: 0xffd700, alpha: 0.95 })
  }
}

function drawEdge(a: Cell, b: Cell): Promise<void> {
  const key = `${a.col}:${a.row}-${b.col}:${b.row}`
  const from = cellCenter(a.col, a.row)
  const to = cellCenter(b.col, b.row)

  return new Promise((resolve) => {
    const obj = { t: 0 }
    activePartials.set(key, { from, to, t: 0 })
    GSAP.to(obj, {
      t: 1,
      duration: 0.12,
      ease: 'power1.out',
      onUpdate: () => { activePartials.get(key)!.t = obj.t; redrawLines() },
      onComplete: () => { activePartials.delete(key); completedSegments.push({ from, to }); redrawLines(); resolve() }
    })
  })
}

let drawnEdgeKeys = new Set<string>()

// Traces the win's connection path one column-step at a time: every edge
// starting in a given column draws simultaneously (so a whole wild-filled
// column's fan of diagonals pops in together), then the next column's edges
// start. Fast regardless of how tangled a step is, since the step count
// (at most 4) drives the total time, not the edge count.
async function drawConnectionLines(win: ConnectionWin) {
  const byStartCol = new Map<number, [Cell, Cell][]>()
  for (const edge of winEdges(win)) {
    const key = `${edge[0].col}:${edge[0].row}-${edge[1].col}:${edge[1].row}`
    if (drawnEdgeKeys.has(key)) continue // already traced this segment this spin
    drawnEdgeKeys.add(key)
    if (!byStartCol.has(edge[0].col)) byStartCol.set(edge[0].col, [])
    byStartCol.get(edge[0].col)!.push(edge)
  }

  for (const col of [...byStartCol.keys()].sort((x, y) => x - y)) {
    await Promise.all(byStartCol.get(col)!.map(([a, b]) => drawEdge(a, b)))
  }
}

// Counts up from 0 to `target` over `durationMs`, holds briefly, then hides.
async function countUpFlash(target: number, durationMs: number) {
  showBonusFlash.value = true
  const scaledMs = turbo.value ? Math.round(durationMs * 0.55) : durationMs
  await new Promise<void>((resolve) => {
    const obj = { v: 0 }
    GSAP.to(obj, {
      v: target,
      duration: scaledMs / 1000,
      ease: 'power1.out',
      onUpdate: () => { bonusFlashValue.value = Math.round(obj.v * 10000) / 10000 },
      onComplete: () => resolve()
    })
  })
  await stepDelay(350)
  showBonusFlash.value = false
}

// Dims non-winners, traces every connection's path, then shows only the
// spin's total (not each individual connection — too noisy when there are
// many). Bigger wins (5x bet+) get a count-up flourish instead of a flat flash.
async function celebrateBonusSpin(spinResult: BonusSpinResult) {
  if (!spinResult.wins.length) return

  const winKeys = new Set(spinResult.wins.flatMap(w => w.cells.map(cellKey)))
  await dimAllExcept(winKeys)

  completedSegments = []
  drawnEdgeKeys = new Set()
  for (const win of spinResult.wins) {
    await drawConnectionLines(win)
  }

  if (spinResult.spinPayout > bet.value * 5) {
    await countUpFlash(spinResult.spinPayout, 1000)
  } else {
    bonusFlashValue.value = spinResult.spinPayout
    showBonusFlash.value = true
    await stepDelay(380)
    showBonusFlash.value = false
  }

  linesLayer.clear()
  completedSegments = []
  activePartials = new Map()
  await restoreAlpha()
}

async function playBonusSpin(bonusSpin: BonusSpinResult) {
  // Columns already fully bonuswild from an earlier spin stay put instead of
  // spinning through symbols they're just going to show again.
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

  await celebrateBonusSpin(bonusSpin)
}

async function runBonus(bonus: BonusResult, tier: BonusTier) {
  bonusRunning.value = true
  bonusTotal.value = 0
  bonusSpinIndex.value = 0

  for (const bonusSpin of bonus.spins) {
    await playBonusSpin(bonusSpin)
    bonusTotal.value += bonusSpin.spinPayout
    bonusSpinIndex.value++
  }

  let finalPayout = 0
  try {
    const data = await $fetch('/api/games/play-game', {
      method: 'POST',
      body: { bet: bet.value, game: 'bookofshadows', options: { resolveBonus: { ordinaryPayout: bonus.ordinaryPayout, wildBaseline: bonus.wildBaseline, tierId: tier.id } } }
    }) as { gameData: BookOfShadowsResult, balance: number }
    finalPayout = data.gameData.payout
    balance.value = data.balance
    setBalance(data.balance)
    await fetchSession()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Bonus resolve failed'
  }

  lastWin.value = finalPayout
  bigWinValue.value = finalPayout
  showBigWin.value = true
  await stepDelay(1200)
  showBigWin.value = false

  bonusRunning.value = false
  isSpinning.value = false

  resumeAutoSpin?.()
  resumeAutoSpin = null
}

// Purely cosmetic: the tier was already decided server-side (`bonusData.tier`).
// This just flickers through random tiers before settling on the real one.
async function rollTier() {
  if (rolling.value || !bonusData.value) return
  rolling.value = true

  for (let i = 0; i < 10; i++) {
    rolledTier.value = BONUS_TIERS[Math.floor(Math.random() * BONUS_TIERS.length)]!
    await stepDelay(60)
  }
  rolledTier.value = bonusData.value.tier
  rolling.value = false

  await stepDelay(600)
  showBonusPick.value = false
  void runBonus(bonusData.value, bonusData.value.tier)
}

async function spin(buy = false) {
  if (!ready.value || isSpinning.value || showBonusPick.value || bonusRunning.value) return
  const cost = buy ? buyBonusCost.value : bet.value
  if (balance.value < cost) return

  isSpinning.value = true
  errorMsg.value = ''
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
    balance.value = balanceBeforeSpin
    setBalance(balanceBeforeSpin)
    isSpinning.value = false
    stopAutoSpin()
    return
  }

  const result = data.gameData

  try {
    reelSet.setSpeed(turbo.value ? 'turbo' : 'normal')
    const spinPromise = reelSet.spin()
    reelSet.setResult(result.grid.map((col: SlotSymbol[]) => ({ visible: col })))
    await spinPromise
    lastWin.value = result.payout
    await celebrateWins(result)

    balance.value = data.balance
    setBalance(data.balance)
    await fetchSession()

    if (result.bonusTriggered && result.bonus) {
      bonusData.value = result.bonus
      rolledTier.value = null
      rolling.value = false
      showBonusPick.value = true

      if (autoSpinEnabled.value) {
        autoSpinPaused.value = true
        await new Promise<void>((resolve) => { resumeAutoSpin = resolve })
      }
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    stopAutoSpin()
  } finally {
    isSpinning.value = false
  }

  if (autoSpinEnabled.value) {
    autoSpinsLeft.value--
    if (autoSpinsLeft.value > 0 && balance.value >= bet.value) void spin()
    else stopAutoSpin()
  }
}
</script>

<template>
  <div class="flex flex-col items-center gap-4 p-6">
    <h1 class="text-xl font-bold">
      Book of Shadows
    </h1>

    <div
      ref="canvasWrap"
      class="relative"
    >
      <Transition name="pop">
        <div
          v-if="showBigWin"
          class="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
        >
          <span class="big-win-text">{{ formatNumber(bigWinValue, false) }}</span>
        </div>
      </Transition>

      <Transition name="pop">
        <div
          v-if="showBonusPick"
          class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/85"
        >
          <p class="text-lg font-black text-amber-400 tracking-wide">
            BONUS TRIGGERED!
          </p>
          <p class="text-xs text-white/60">
            Roll for your bonus wild value
          </p>

          <div class="tier-tile flex items-center justify-center">
            <span class="text-sm font-black text-center px-2">{{ rolledTier?.label ?? '?' }}</span>
          </div>
          <p
            v-if="rolledTier"
            class="text-amber-300 font-bold"
          >
            ×{{ rolledTier.multiplier }}
          </p>

          <button
            :disabled="rolling || !!rolledTier"
            class="px-6 py-2 rounded bg-primary text-white font-bold disabled:opacity-40"
            @click="rollTier"
          >
            {{ rolling ? 'Rolling...' : 'Roll' }}
          </button>
        </div>
      </Transition>

      <Transition name="pop">
        <div
          v-if="showBonusFlash"
          class="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
        >
          <span class="bonus-flash-text">{{ formatNumber(bonusFlashValue, false) }}</span>
        </div>
      </Transition>
    </div>

    <p
      v-if="!ready && !errorMsg"
      class="text-sm text-muted"
    >
      Loading reels...
    </p>
    <p
      v-if="errorMsg"
      class="text-sm text-red-400"
    >
      {{ errorMsg }}
    </p>
    <p
      v-if="bonusRunning"
      class="text-sm text-amber-400 font-bold"
    >
      Bonus spin {{ bonusSpinIndex }} / 10 — total {{ formatNumber(bonusTotal, false) }}
    </p>
    <p
      v-else-if="autoSpinPaused"
      class="text-sm text-amber-400 font-bold"
    >
      Auto spin paused — roll to continue
    </p>

    <p class="text-sm">
      Win: {{ formatNumber(lastWin, false) }}
    </p>

    <div class="flex w-full max-w-md flex-col gap-3 rounded-lg border border-default bg-elevated p-4">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted">Balance</span>
        <strong><CoinBalance
          :value="balance"
          :compact="false"
        /></strong>
      </div>

      <div class="flex items-center justify-between gap-3">
        <span class="text-sm text-muted">Bet</span>
        <div class="flex items-center gap-1.5">
          <UTooltip text="Halve bet">
            <button
              class="rounded bg-white/10 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40"
              :disabled="locked() || bet <= MIN_BET"
              @click="betDown"
            >
              1/2
            </button>
          </UTooltip>
          <input
            v-model="betInput"
            :disabled="locked()"
            inputmode="numeric"
            aria-label="Bet amount"
            class="w-20 rounded border border-default bg-transparent px-2 py-1 text-right text-sm font-bold outline-none"
            @blur="commitBetInput"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          >
          <UTooltip text="Double bet">
            <button
              class="rounded bg-white/10 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40"
              :disabled="locked() || bet >= MAX_BET"
              @click="betUp"
            >
              2x
            </button>
          </UTooltip>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          class="flex-1 rounded bg-primary py-2.5 font-bold text-white disabled:opacity-50"
          :disabled="!ready || isSpinning || showBonusPick || bonusRunning || (!autoSpinEnabled && balance < bet)"
          @click="autoSpinEnabled ? stopAutoSpin() : spin()"
        >
          <span v-if="autoSpinEnabled">{{ autoSpinsLeft }}x STOP</span>
          <span v-else>{{ isSpinning ? 'Spinning...' : 'Spin' }}</span>
        </button>

        <UTooltip text="Auto spin">
          <button
            v-if="!autoSpinEnabled"
            class="rounded bg-white/10 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40"
            :disabled="!ready || isSpinning || showBonusPick || bonusRunning || balance < bet"
            @click="showAutoSpinModal = true"
          >
            AUTO
          </button>
        </UTooltip>

        <UTooltip text="Turbo mode">
          <button
            class="rounded px-3 py-2.5 text-xs font-bold disabled:opacity-40"
            :class="turbo ? 'bg-primary text-white' : 'bg-white/10 text-white'"
            @click="turbo = !turbo"
          >
            <UIcon
              name="i-lucide-zap"
              class="size-4"
            />
          </button>
        </UTooltip>
      </div>

      <button
        class="rounded bg-white/10 py-2 text-sm font-bold text-amber-300 disabled:opacity-40"
        :disabled="!ready || isSpinning || showBonusPick || bonusRunning || autoSpinEnabled || balance < buyBonusCost"
        @click="spin(true)"
      >
        Buy Bonus · {{ formatNumber(buyBonusCost, false) }}
      </button>
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
            @click="startAutoSpin(count)"
          >
            {{ count }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.tier-tile {
  width: 96px;
  height: 96px;
  border-radius: 12px;
  background: linear-gradient(180deg, #dc2626, #7f1d1d);
  border: 2px solid rgba(255, 255, 255, 0.25);
  color: white;
}

.big-win-text {
  font-size: 4rem;
  font-weight: 900;
  line-height: 1;
  background-image: linear-gradient(180deg, #ff5252 0%, #7f0f0f 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.6));
}

.bonus-flash-text {
  font-size: 2.75rem;
  font-weight: 900;
  line-height: 1;
  background-image: linear-gradient(180deg, #ffe066 0%, #b8860b 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.6));
}

.pop-enter-active,
.pop-leave-active {
  transition: all 0.25s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: scale(0.7);
}
</style>
