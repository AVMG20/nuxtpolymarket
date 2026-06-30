<script setup lang="ts">
import type { CandyMadnessResult, TumbleSequence, TumbleStep, MultSpot, CandySymbol, Cell } from '#shared/utils/gamelogic/candymadness'
import {
  CM_COLS, CM_ROWS, CM_MIN_CLUSTER, CM_FREE_SPINS, CM_SCATTER_TRIGGER,
  CM_MAX_WIN_MULT, CM_MULT_CAP, CM_CELLS, CANDY_KEYS, CANDY_WEIGHTS, SCATTER_WEIGHT,
  clusterPayMult
} from '#shared/utils/gamelogic/candymadness'

const { user, setBalance } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))
watch(() => user.value?.balance, (v) => { if (v !== undefined) balance.value = parseFloat(v ?? '0') })

// --- bet / round state ------------------------------------------------------
const bet = ref(10)
const turbo = ref(false)
const isSpinning = ref(false)
const errorMsg = ref('')
const showHelp = ref(false)
const ready = ref(false)

const lastWin = ref(0)
const winFlash = ref(false)

// bonus HUD
const inBonus = ref(false)
const bonusBanner = ref(false)
const bonusSpinsLeft = ref(0)
const bonusTotal = ref(0)
const bonusStatus = ref('')

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

// Approx odds of triggering the bonus (3+ scatters across the 30 cells).
const bonusOdds = computed(() => {
  const total = CANDY_KEYS.reduce((a, k) => a + CANDY_WEIGHTS[k], 0) + SCATTER_WEIGHT
  const p = SCATTER_WEIGHT / total
  const q = 1 - p
  const choose = (n: number, k: number) => {
    let r = 1
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1)
    return r
  }
  let pLess = 0
  for (let k = 0; k < CM_SCATTER_TRIGGER; k++) pLess += choose(CM_CELLS, k) * p ** k * q ** (CM_CELLS - k)
  const pTrigger = 1 - pLess
  return pTrigger > 0 ? Math.round(1 / pTrigger) : 0
})

// --- pixi (non-reactive on purpose; Vue proxies break PixiJS objects) -------
const canvasWrap = ref<HTMLDivElement>()
let app: any = null
let reelSet: any = null
let REELS: any = null
let PIXI: any = null
let GSAP: any = null
let multLayer: any = null // overlay container for multiplier-spot badges
let particleLayer: any = null // candy-pop particle bursts (above everything)
const TEX: Record<string, any> = {} // loaded sprite textures, keyed by symbol id
let destroyed = false

const CELL = 76
const GAP = 6
const REEL_W = CM_COLS * CELL + (CM_COLS - 1) * GAP
const REEL_H = CM_ROWS * CELL + (CM_ROWS - 1) * GAP
const APP_W = REEL_W + 28
const APP_H = REEL_H + 28
const OFFSET_X = (APP_W - REEL_W) / 2
const OFFSET_Y = (APP_H - REEL_H) / 2

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// All symbol ids — low → high paying candies, then the scatter.
const SYMBOL_IDS: CandySymbol[] = [...CANDY_KEYS, 'scatter']

// Emoji used only in the help-modal paytable (the board itself uses sprites).
const GLYPH: Record<CandySymbol, string> = {
  grape: '🍇', blue: '🫐', green: '🍉', orange: '🍊', red: '🍓', scatter: '🍭'
}

// Particle-burst colour per candy, sampled from the sprite art.
const POP_COLOR: Record<CandySymbol, number> = {
  grape: 0x9b3fc4, blue: 0x2f7fd0, green: 0x4caf2e, orange: 0xf0921a, red: 0xe2392a, scatter: 0xff5cae
}

// Help-modal paytable: a few representative cluster sizes per candy (× bet).
const PAY_SIZES = [5, 8, 12, 15] as const
const paytableRows = ([...CANDY_KEYS].reverse()).map(sym => ({
  sym,
  glyph: GLYPH[sym],
  pays: PAY_SIZES.map(n => Math.round(clusterPayMult(sym, n) * 1000) / 1000)
}))

// Multiplier badge colour ramp — climbs pink → fuchsia → purple → blue → cyan
// → green → amber → red as the value doubles (×2 … ×2048), so a hotter colour
// always means a bigger multiplier.
const MULT_RAMP: Record<number, number> = {
  2: 0xf9a8d4, 4: 0xf472b6, 8: 0xec4899, 16: 0xd946ef, 32: 0xa855f7,
  64: 0x6366f1, 128: 0x3b82f6, 256: 0x22d3ee, 512: 0x22c55e, 1024: 0xf59e0b, 2048: 0xef4444
}
function multColor(v: number): number { return MULT_RAMP[v] ?? MULT_RAMP[2048]! }

// --- candy symbol class -----------------------------------------------------
function makeSymbolClass() {
  const { Sprite } = PIXI
  const Base = REELS.ReelSymbol

  class CandyTile extends Base {
    sprite = new Sprite()
    w = CELL
    h = CELL
    _tween: any = null

    constructor() {
      super()
      this.sprite.anchor.set(0.5)
      this.view.addChild(this.sprite)
    }

    // Just the candy art — no tile background or border. Scaled to fit the cell
    // while preserving each sprite's own aspect ratio.
    _render(id: string) {
      const t = TEX[id]
      if (!t) return
      this.sprite.texture = t
      const max = Math.min(this.w, this.h) * 0.94
      const s = Math.min(max / t.width, max / t.height)
      this.sprite.scale.set(s)
      this.sprite.x = this.w / 2
      this.sprite.y = this.h / 2
    }

    onActivate(id: string) { this.view.alpha = 1; this._render(id) }
    onDeactivate() { this._kill() }
    resize(w: number, h: number) { this.w = w; this.h = h; if (this.symbolId) this._render(this.symbolId) }
    stopAnimation() { this._kill(); this.view.scale.set(1, 1) }
    _kill() { if (this._tween) { this._tween.kill(); this._tween = null } this.view.scale.set(1, 1) }
    playWin() {
      this._kill()
      return new Promise<void>((res) => {
        this._tween = GSAP.to(this.view.scale, { x: 1.14, y: 1.14, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut', onComplete: res })
      })
    }
  }

  return CandyTile
}

// --- candy-pop particles ----------------------------------------------------
// A little burst of candy-coloured dots at every cell that just matched.
function spawnPops(step: TumbleStep) {
  if (!particleLayer) return
  const { Graphics } = PIXI
  const count = turbo.value ? 4 : 7
  for (const wc of step.winCells) {
    const sym = step.grid[wc.col]?.[wc.row] as CandySymbol | undefined
    const color = sym ? (POP_COLOR[sym] ?? 0xffffff) : 0xffffff
    const p = cellLocal(wc.col, wc.row)
    for (let k = 0; k < count; k++) {
      const g = new Graphics()
      g.circle(0, 0, 2.5 + Math.random() * 4).fill({ color })
      g.position.set(p.x, p.y)
      particleLayer.addChild(g)
      const ang = Math.random() * Math.PI * 2
      const dist = 16 + Math.random() * 30
      const dur = 0.4 + Math.random() * 0.25
      GSAP.to(g, { x: p.x + Math.cos(ang) * dist, y: p.y + Math.sin(ang) * dist - 8, duration: dur, ease: 'power2.out' })
      GSAP.to(g.scale, { x: 0.1, y: 0.1, duration: dur, ease: 'power1.in' })
      GSAP.to(g, { alpha: 0, duration: dur, ease: 'power1.in', onComplete: () => { try { g.destroy() } catch { /* ignore */ } } })
    }
  }
}

// --- multiplier badge overlay -----------------------------------------------
// One badge per grid position that has earned a multiplier. Persists for the
// whole tumble sequence (base) or the whole bonus (free spins).
const badges = new Map<string, { value: number, view: any, label: any, bg: any }>()

function cellLocal(col: number, row: number): { x: number, y: number } {
  return { x: col * (CELL + GAP) + CELL / 2, y: row * (CELL + GAP) + CELL / 2 }
}

function styleBadge(b: { value: number, label: any, bg: any }) {
  const c = multColor(b.value)
  b.label.text = `×${b.value}`
  // Faint translucent backer in the tier hue — bigger so it fills the tile.
  const w = Math.max(50, b.label.width + 16)
  const h = 38
  b.bg.clear()
  b.bg.roundRect(-w / 2, -h / 2, w, h, 12).fill({ color: c, alpha: 0.22 }).stroke({ color: c, width: 2, alpha: 0.7 })
}

function makeBadge(col: number, row: number, value: number) {
  const { Container, Graphics, Text } = PIXI
  const view = new Container()
  const bg = new Graphics()
  // White number with a dark outline + drop shadow so it stays legible on any
  // candy, regardless of the tier colour behind it.
  const label = new Text({
    text: '',
    style: {
      fontFamily: 'system-ui, sans-serif', fontSize: 21, fontWeight: '900', fill: 0xffffff, align: 'center',
      stroke: { color: 0x2a0612, width: 4, join: 'round' },
      dropShadow: { color: 0x000000, blur: 3, distance: 1, alpha: 0.55, angle: Math.PI / 2 }
    }
  })
  label.anchor.set(0.5)
  view.addChild(bg)
  view.addChild(label)
  const p = cellLocal(col, row)
  view.position.set(p.x, p.y) // centred in the cell
  multLayer.addChild(view)
  const b = { value, view, label, bg }
  styleBadge(b)
  badges.set(`${col}:${row}`, b)
  GSAP.fromTo(view.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2)' })
}

function bumpBadge(b: { value: number, view: any, label: any, bg: any }, value: number) {
  b.value = value
  styleBadge(b)
  GSAP.fromTo(b.view.scale, { x: 1.5, y: 1.5 }, { x: 1, y: 1, duration: 0.32, ease: 'back.out(2.5)' })
}

// Sync badges to the server's spot snapshot (spots only ever appear or grow).
function syncBadges(spots: MultSpot[]) {
  for (const s of spots) {
    const k = `${s.col}:${s.row}`
    const existing = badges.get(k)
    if (!existing) makeBadge(s.col, s.row, s.value)
    else if (existing.value !== s.value) bumpBadge(existing, s.value)
  }
}

// A celebratory pulse across every badge at the end of a winning sequence.
function pulseBadges() {
  for (const b of badges.values()) {
    GSAP.fromTo(b.view.scale, { x: 1.28, y: 1.28 }, { x: 1, y: 1, duration: 0.38, ease: 'back.out(2)' })
  }
}

function clearBadges() {
  for (const b of badges.values()) {
    try { b.view.destroy({ children: true }) } catch { /* ignore */ }
  }
  badges.clear()
}

// --- pixi bootstrap ---------------------------------------------------------
function toTargets(grid: CandySymbol[][]) {
  return grid.map(col => ({ visible: col }))
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
    await app.init({ width: APP_W, height: APP_H, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) })
    if (destroyed) { app.destroy(true); return }
    canvasWrap.value?.appendChild(app.canvas)

    // Preload the candy sprite cutouts before any symbol renders.
    await Promise.all(SYMBOL_IDS.map(async (id) => {
      TEX[id] = await PIXI.Assets.load(`/slots/candyblast/${id}.png`)
    }))
    if (destroyed) { app.destroy(true); return }

    const CandyTile = makeSymbolClass()

    const weights: Record<string, number> = { scatter: SCATTER_WEIGHT }
    for (const k of CANDY_KEYS) weights[k] = CANDY_WEIGHTS[k]

    reelSet = new REELS.ReelSetBuilder()
      .reels(CM_COLS).visibleRows(CM_ROWS).symbolSize(CELL, CELL).symbolGap(GAP, GAP)
      .symbols((r: any) => {
        for (const id of SYMBOL_IDS) r.register(id, CandyTile, {})
      })
      .weights(weights)
      .tumble({
        fall: { duration: 260, ease: 'sine.in', rowStagger: 0 },
        dropIn: { duration: 420, ease: 'back.out(1.4)', rowStagger: 45, distance: 'perHole' }
      })
      .speed('normal', REELS.SpeedPresets.NORMAL)
      .speed('turbo', REELS.SpeedPresets.TURBO)
      .ticker(app.ticker)
      .build()

    reelSet.x = OFFSET_X
    reelSet.y = OFFSET_Y
    app.stage.addChild(reelSet)

    multLayer = new PIXI.Container()
    multLayer.x = OFFSET_X
    multLayer.y = OFFSET_Y
    app.stage.addChild(multLayer)

    particleLayer = new PIXI.Container()
    particleLayer.x = OFFSET_X
    particleLayer.y = OFFSET_Y
    particleLayer.eventMode = 'none'
    app.stage.addChild(particleLayer)

    // Cosmetic resting board so the grid isn't empty before the first spin.
    reelSet.setResult(toTargets(randomGrid()))
    ready.value = true
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load the slot engine'
  }
})

onUnmounted(() => {
  destroyed = true
  try { clearBadges() } catch { /* ignore */ }
  try { multLayer?.destroy?.({ children: true }) } catch { /* ignore */ }
  try { particleLayer?.destroy?.({ children: true }) } catch { /* ignore */ }
  try { reelSet?.destroy?.() } catch { /* ignore */ }
  try { app?.destroy?.(true) } catch { /* ignore */ }
})

// A purely-cosmetic no-stakes grid for the idle board.
function randomGrid(): CandySymbol[][] {
  const grid: CandySymbol[][] = []
  for (let c = 0; c < CM_COLS; c++) {
    const col: CandySymbol[] = []
    for (let r = 0; r < CM_ROWS; r++) col.push(CANDY_KEYS[Math.floor(Math.random() * CANDY_KEYS.length)]!)
    grid.push(col)
  }
  return grid
}

// --- spin flow --------------------------------------------------------------
async function spin() {
  if (!ready.value || isSpinning.value || balance.value < bet.value) return
  isSpinning.value = true
  errorMsg.value = ''
  lastWin.value = 0
  winFlash.value = false

  let data: { gameData: CandyMadnessResult, balance: number }
  try {
    data = await $fetch('/api/games/play-game', {
      method: 'POST',
      body: { bet: bet.value, game: 'candymadness' }
    }) as { gameData: CandyMadnessResult, balance: number }
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
    isSpinning.value = false
    stopAutoSpin()
    return
  }

  const result = data.gameData

  try {
    // 1. Base spin: spots reset every paid spin.
    clearBadges()
    const baseWin = await spinAndCascade(result.base)
    lastWin.value = baseWin * result.bet

    // 2. Bonus.
    if (result.bonusTriggered && result.bonus) {
      await reelSet.spotlight.show(result.scatterCells.map((c: Cell) => ({ reelIndex: c.col, rowIndex: c.row })), { displayDuration: 700 } as any)
      if (autoSpinEnabled.value) {
        autoSpinPaused.value = true
        await new Promise<void>(res => { _resumeAutoSpin = res })
      }
      await runBonus(result)
    }

    // 3. Settle.
    lastWin.value = result.payout
    winFlash.value = result.payout > 0
    balance.value = data.balance
    setBalance(data.balance)
    history.value.unshift({ payout: result.payout, bet: result.bet, bonus: result.bonusTriggered })
    if (history.value.length > 10) history.value.pop()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    balance.value = data.balance
    setBalance(data.balance)
    stopAutoSpin()
  } finally {
    isSpinning.value = false
    if (autoSpinEnabled.value) {
      if (autoSpinPaused.value) {
        await new Promise<void>(res => { _resumeAutoSpin = res })
      }
      if (autoSpinEnabled.value) {
        autoSpinsLeft.value--
        if (autoSpinsLeft.value > 0 && balance.value >= bet.value) spin()
        else stopAutoSpin()
      }
    }
  }
}

// Drop a grid and replay its precomputed tumble chain. Returns the sequence win
// (× bet). Badges already on `multLayer` (bonus carry-over) are preserved.
async function spinAndCascade(seq: TumbleSequence): Promise<number> {
  reelSet.setSpeed?.(turbo.value ? 'turbo' : 'normal')
  const first = seq.steps[0]?.grid ?? seq.restGrid
  const spinPromise = reelSet.spin({ mode: 'cascade' })
  reelSet.setResult(toTargets(first))
  await spinPromise

  await reelSet.runCascade({
    detectWinners: (_g: string[][], lvl: number) =>
      (seq.steps[lvl]?.winCells ?? []).map((c: Cell) => ({ reel: c.col, row: c.row })),
    nextGrid: (_g: string[][], _w: any, lvl: number) =>
      (seq.steps[lvl + 1]?.grid ?? seq.restGrid) as unknown as string[][],
    onCascade: ({ chain }: { chain: number }) => onTumble(seq.steps[chain - 1]),
    pauseAfterDestroyMs: turbo.value ? 130 : 300,
    maxChain: 64
  })

  // End-of-sequence flourish: pulse the stacked multipliers before paying out.
  if (seq.basePay > 0 && seq.multiplierSum > 1 && badges.size) {
    pulseBadges()
    await wait(turbo.value ? 250 : 550)
  }
  return seq.win
}

// Fired once per tumble, after the winners faded and before the refill: pop the
// new/upgraded multiplier badges into place.
function onTumble(step: TumbleStep | undefined) {
  if (!step) return
  spawnPops(step)
  syncBadges(step.spotsAfter)
}

// --- bonus ------------------------------------------------------------------
async function runBonus(result: CandyMadnessResult) {
  const bonus = result.bonus!
  inBonus.value = true
  bonusBanner.value = true
  bonusTotal.value = 0
  bonusSpinsLeft.value = CM_FREE_SPINS
  bonusStatus.value = 'Free Spins!'
  // Multipliers persist for the whole feature — wipe the base game's spots once.
  clearBadges()
  await wait(1200)
  bonusBanner.value = false

  try {
    for (const fs of bonus.spins) {
      bonusStatus.value = `Spin ${fs.round} / ${CM_FREE_SPINS}`
      bonusSpinsLeft.value = CM_FREE_SPINS - fs.round
      const win = await spinAndCascade(fs.sequence)
      bonusTotal.value += win * result.bet
      await wait(turbo.value ? 150 : 380)
    }

    bonusTotal.value = result.bonusPayout
    bonusSpinsLeft.value = 0
    bonusStatus.value = result.bonusPayout > 0 ? 'Bonus complete!' : 'No win this time'
    await wait(1400)
  } finally {
    clearBadges()
    inBonus.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); if (!autoSpinEnabled.value) spin() }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon
          name="i-lucide-candy"
          class="size-6 text-primary"
        />
        Candy Madness
      </h1>
      <p class="text-sm text-muted mt-0.5">
        6×5 cluster-pays cascade · ~98% RTP
      </p>
    </div>

    <div class="grid lg:grid-cols-3 gap-6">
      <!-- Controls -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">
              Controls
            </h2>
            <UButton
              icon="i-lucide-circle-help"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="showHelp = true"
            />
          </div>
        </template>

        <div class="space-y-4">
          <!-- Bet -->
          <div>
            <label class="text-xs text-muted uppercase tracking-wide font-medium block mb-1.5">Bet Amount</label>
            <div class="flex items-center gap-2">
              <UInput
                v-model.number="bet"
                type="number"
                min="1"
                :disabled="isSpinning"
                class="flex-1 font-mono"
                size="lg"
              />
              <div class="flex gap-1">
                <UButton
                  color="neutral"
                  variant="soft"
                  :disabled="isSpinning"
                  @click="bet = Math.max(1, Math.floor(bet / 2))"
                >
                  ½
                </UButton>
                <UButton
                  color="neutral"
                  variant="soft"
                  :disabled="isSpinning"
                  @click="bet = bet * 2"
                >
                  2×
                </UButton>
              </div>
            </div>
          </div>

          <!-- Turbo -->
          <div class="flex items-center justify-between rounded-lg bg-elevated border border-default p-3">
            <div class="min-w-0">
              <p class="text-sm font-medium flex items-center gap-1.5">
                <UIcon
                  name="i-lucide-zap"
                  class="size-4 text-warning"
                /> Turbo spin
              </p>
            </div>
            <USwitch v-model="turbo" />
          </div>

          <!-- Stats -->
          <div class="rounded-lg bg-elevated border border-default p-3 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Min cluster</span>
              <span class="font-bold tabular-nums">{{ CM_MIN_CLUSTER }}</span>
            </div>
            <USeparator />
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Max multiplier</span>
              <span class="font-bold tabular-nums text-primary">×{{ formatNumber(CM_MULT_CAP, true, 0) }}</span>
            </div>
            <USeparator />
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Max win</span>
              <span class="font-bold tabular-nums text-warning">{{ formatNumber(CM_MAX_WIN_MULT * bet, true, 0) }}</span>
            </div>
          </div>

          <!-- Error -->
          <Transition name="fade-up">
            <UAlert
              v-if="errorMsg"
              color="error"
              variant="soft"
              :description="errorMsg"
              :close-button="{ icon: 'i-lucide-x', color: 'neutral', variant: 'ghost' }"
              @close="errorMsg = ''"
            />
          </Transition>

          <!-- Balance -->
          <div class="rounded-lg bg-elevated border border-default p-3 flex justify-between items-center">
            <span class="text-xs text-muted uppercase tracking-wide font-medium">Balance</span>
            <span class="font-bold text-sm"><CoinBalance
              :value="balance"
              :compact="false"
            /></span>
          </div>

          <!-- Recent -->
          <div
            v-if="history.length"
            class="space-y-1.5"
          >
            <p class="text-xs text-muted uppercase tracking-wide font-medium">
              Recent
            </p>
            <div class="flex gap-1.5 flex-wrap">
              <span
                v-for="(h, i) in history"
                :key="i"
                class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-mono font-bold"
                :class="h.payout > h.bet ? 'bg-success/20 text-success' : 'bg-elevated text-muted'"
              >
                <UIcon
                  v-if="h.bonus"
                  name="i-lucide-gift"
                  class="size-3"
                />
                {{ h.payout > 0 ? formatNumber(h.payout) : '—' }}
              </span>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Game area -->
      <div class="lg:col-span-2 flex flex-col gap-4">
        <UCard :ui="{ body: 'relative overflow-hidden p-4 bg-gradient-to-br from-fuchsia-950/40 to-purple-950/30' }">
          <!-- Bonus banner -->
          <Transition name="pop">
            <div
              v-if="bonusBanner"
              class="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
            >
              <div class="bg-gradient-to-br from-pink-500 to-fuchsia-600 px-8 py-5 rounded-2xl shadow-2xl shadow-fuchsia-500/40 text-center -rotate-3">
                <p class="text-3xl font-black text-white tracking-tight">
                  CANDY MADNESS
                </p>
                <p class="text-sm text-pink-100 font-bold">
                  {{ CM_FREE_SPINS }} free spins — multipliers stay & grow!
                </p>
              </div>
            </div>
          </Transition>

          <!-- Pixi canvas -->
          <div
            class="relative flex items-center justify-center min-h-75"
            @click="onCanvasClick"
          >
            <div
              ref="canvasWrap"
              class="w-full max-w-140 [&>canvas]:w-full [&>canvas]:h-auto [&>canvas]:block"
            />
            <div
              v-if="!ready && !errorMsg"
              class="absolute inset-0 flex items-center justify-center"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-8 text-muted animate-spin"
              />
            </div>

            <!-- Auto-spin pause overlay -->
            <Transition name="pop">
              <div
                v-if="autoSpinPaused"
                class="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-sm cursor-pointer"
              >
                <div class="text-center px-6 py-4 rounded-xl bg-elevated border border-default shadow-xl">
                  <p class="font-black text-default text-base">
                    🍭 Bonus! Tap to play
                  </p>
                  <p class="text-xs text-muted mt-1">
                    {{ autoSpinsLeft }} spin{{ autoSpinsLeft !== 1 ? 's' : '' }} remaining
                  </p>
                </div>
              </div>
            </Transition>
          </div>

          <!-- Below-grid readout -->
          <div class="mt-3 min-h-12 flex items-center justify-center">
            <div
              v-if="inBonus"
              class="text-center"
            >
              <p class="text-[10px] uppercase tracking-wide text-muted leading-none mb-0.5">
                {{ bonusStatus }}
              </p>
              <p class="text-3xl font-black tabular-nums text-success leading-none">
                ${{ formatNumber(bonusTotal, false) }}
              </p>
            </div>
            <Transition
              v-else
              name="pop"
            >
              <span
                v-if="winFlash && lastWin > 0"
                class="text-success font-black text-2xl"
              >
                +${{ formatNumber(lastWin, false) }}
              </span>
            </Transition>
          </div>
        </UCard>

        <!-- Play button -->
        <UCard>
          <div class="flex items-center gap-3">
            <UButton
              block
              :loading="isSpinning"
              :disabled="!ready || balance < bet || autoSpinEnabled"
              color="primary"
              size="xl"
              class="flex-1 h-16 text-lg font-black uppercase tracking-widest transition-transform active:scale-[0.98]"
              @click="spin"
            >
              {{ isSpinning ? 'Tumbling…' : 'Spin' }}
            </UButton>
            <template v-if="autoSpinEnabled">
              <div class="flex flex-col items-center justify-center gap-1 w-16 shrink-0">
                <span class="text-xs font-black tabular-nums text-primary">{{ autoSpinsLeft }}×</span>
                <UButton
                  icon="i-lucide-square"
                  color="error"
                  variant="soft"
                  size="sm"
                  @click="stopAutoSpin"
                />
              </div>
            </template>
            <UButton
              v-else
              icon="i-lucide-repeat"
              color="neutral"
              variant="soft"
              class="h-16 w-16 shrink-0 flex items-center justify-center"
              :disabled="!ready || balance < bet || isSpinning"
              @click="showAutoSpinModal = true"
            />
            <div class="hidden sm:flex flex-col items-end px-2 text-sm font-mono text-muted whitespace-nowrap">
              <span>Press <kbd class="px-2 py-1 bg-elevated rounded text-xs font-sans font-bold border border-default">SPACE</kbd></span>
            </div>
          </div>
        </UCard>
      </div>
    </div>

    <!-- Auto-spin -->
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
              color="neutral"
              variant="soft"
              class="font-bold"
              @click="startAutoSpin(count)"
            >
              {{ count }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Help -->
    <UModal
      v-model:open="showHelp"
      title="How Candy Madness works"
    >
      <template #body>
        <div class="space-y-4 text-sm text-muted">
          <ul class="space-y-1.5 list-disc list-inside">
            <li>Land <strong class="text-default">{{ CM_MIN_CLUSTER }}+</strong> matching candies connected up/down/left/right to win a <strong class="text-default">cluster</strong>.</li>
            <li>Winning candies pop and <strong class="text-default">tumble</strong> — new candies drop in, so one spin can chain many wins.</li>
            <li>Every popped position leaves a <strong class="text-primary">multiplier</strong> starting at <strong class="text-default">×2</strong>, doubling each time it wins again (up to <strong class="text-default">×{{ formatNumber(CM_MULT_CAP, true, 0) }}</strong>). When tumbling stops, the <strong class="text-default">sum of all multipliers</strong> multiplies the whole spin's win.</li>
            <li>Land <strong class="text-default">{{ CM_SCATTER_TRIGGER }}+ 🍭</strong> to win <strong class="text-default">{{ CM_FREE_SPINS }} free spins</strong> (~1 in {{ formatNumber(bonusOdds, true, 0) }}). During free spins the multipliers <strong class="text-default">stay on the grid and keep growing</strong> all feature long.</li>
          </ul>

          <div>
            <p class="text-xs uppercase tracking-wide text-muted font-medium mb-2">
              Cluster pays × your bet
            </p>
            <div class="rounded-lg border border-default overflow-hidden">
              <div class="grid grid-cols-[auto_1fr] text-xs text-muted bg-elevated/60 border-b border-default">
                <div class="px-3 py-1" />
                <div class="px-3 py-1 flex justify-end gap-3 font-medium">
                  <span class="w-12 text-right">5</span>
                  <span class="w-12 text-right">8</span>
                  <span class="w-12 text-right">12</span>
                  <span class="w-12 text-right text-default">15+</span>
                </div>
              </div>
              <div class="grid grid-cols-[auto_1fr] items-center text-sm">
                <template
                  v-for="(row, i) in paytableRows"
                  :key="row.sym"
                >
                  <div
                    class="px-3 py-1.5 text-center text-xl"
                    :class="i % 2 ? 'bg-elevated/40' : ''"
                  >
                    {{ row.glyph }}
                  </div>
                  <div
                    class="px-3 py-1.5 font-mono tabular-nums flex justify-end gap-3"
                    :class="i % 2 ? 'bg-elevated/40' : ''"
                  >
                    <span class="w-12 text-right text-muted">{{ row.pays[0] }}×</span>
                    <span class="w-12 text-right text-muted">{{ row.pays[1] }}×</span>
                    <span class="w-12 text-right text-muted">{{ row.pays[2] }}×</span>
                    <span class="w-12 text-right font-bold text-default">{{ row.pays[3] }}×</span>
                  </div>
                </template>
              </div>
            </div>
            <p class="text-[11px] text-muted mt-1.5">
              Base pays are small on purpose — the stacked multipliers are where the big wins come from.
            </p>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.fade-up-enter-active, .fade-up-leave-active { transition: all 0.2s ease; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(5px); }

.pop-enter-active { transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
.pop-leave-active { transition: all 0.2s ease; }
.pop-enter-from { opacity: 0; transform: scale(0.7); }
.pop-leave-to { opacity: 0; transform: scale(0.9); }

input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
</style>
