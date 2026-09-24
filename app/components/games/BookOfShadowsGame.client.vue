<script setup lang="ts">
import type { BonusResult, BonusTier, BookOfShadowsResult, Cell, SlotSymbol } from '#shared/utils/gamelogic/bookofshadows'
import {
  BONUS_RETRIGGER_SPINS,
  BONUS_SPINS,
  BONUS_TIERS,
  BONUS_TRIGGER_COUNT,
  BOS_BUY_BONUS_COST,
  BOS_COLS,
  BOS_MAX_WIN_MULT,
  PAYTABLE,
  playBookOfShadows
} from '#shared/utils/gamelogic/bookofshadows'
import { bosIconStyle } from '~/utils/bookofshadows-sprite'
import { BosAudio } from '~/utils/slots/bookofshadows-audio'
import { BosStage } from '~/utils/slots/bookofshadows-stage'
import BosAutoplay from './bookofshadows/BosAutoplay.vue'
import BosBigWin from './bookofshadows/BosBigWin.vue'
import BosFeatureIntro from './bookofshadows/BosFeatureIntro.vue'
import BosInfo from './bookofshadows/BosInfo.vue'

const toast = useToast()
const { bet, isSpinning, errorMsg, balance, setBalance, history, pushHistory, spin: requestSpin } = useSlotGame<BookOfShadowsResult, { payout: number, bet: number, bonus: boolean }>('bookofshadows')

// --- bet ------------------------------------------------------------------------

const MIN_BET = 1
const MAX_BET = 100_000_000_000
const BIG_WIN_X = 15
const BET_STEPS: number[] = []
for (let e = 0; e <= 11; e++) {
  for (const m of [1, 2, 5]) {
    const v = m * 10 ** e
    if (v <= MAX_BET) BET_STEPS.push(v)
  }
}

const betDraft = ref(bet.value)
const betText = useAmountInput(betDraft, { integer: true, shorthand: true })
const betFocused = ref(false)
watch(bet, (v) => {
  betDraft.value = v
})

const buyCost = computed(() => Math.round(bet.value * BOS_BUY_BONUS_COST * 100) / 100)
const turbo = ref(false)
const showInfo = ref(false)
const showAutoplay = ref(false)
const confirmBuy = ref(false)
const soundOpen = ref(false)

const auto = reactive({ on: false, left: 0, stopOnFeature: true, stopOnBigWin: false })

// --- round state ----------------------------------------------------------------

const ready = ref(false)
const winMeter = ref(0)
const lastWin = ref(0)
const winFlash = ref(0)
const feature = reactive({
  active: false,
  spin: 0,
  total: BONUS_SPINS,
  tier: null as BonusTier | null,
  locked: [] as number[],
  won: 0
})
const intro = ref<{ tier: BonusTier, spins: number, bet: number } | null>(null)
const celebration = ref<{ amount: number, bet: number, mode: 'win' | 'feature', spins?: number } | null>(null)
const retrigger = ref(false)
const introRef = ref<InstanceType<typeof BosFeatureIntro> | null>(null)
const bigWinRef = ref<InstanceType<typeof BosBigWin> | null>(null)
let introResolve: (() => void) | null = null
let celebrationResolve: (() => void) | null = null

const busy = computed(() => isSpinning.value || feature.active || Boolean(intro.value) || Boolean(celebration.value))
const locked = computed(() => busy.value || auto.on)

const canvasHost = ref<HTMLDivElement | null>(null)
const rootEl = ref<HTMLDivElement | null>(null)
const soundEl = ref<HTMLDivElement | null>(null)
let stage: BosStage | null = null
let destroyed = false

const audio = new BosAudio()
const volume = audio.volume
const muted = audio.muted
const music = audio.music

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const pace = (ms: number) => wait(turbo.value ? Math.round(ms * 0.5) : ms)

function fmt(value: number) {
  return formatNumber(value)
}

const touchOnly = import.meta.client && window.matchMedia?.('(hover: none)').matches

const statusLine = computed(() => {
  if (auto.on) return `Autoplay · ${auto.left} left`
  if (feature.active) return `Free spin ${feature.spin} of ${feature.total}`
  if (lastWin.value > 0 && !isSpinning.value) return `Last win ${fmt(lastWin.value)}`
  return touchOnly ? 'Tap spin to play' : 'Press Space to spin'
})

const TOP_PAYS: SlotSymbol[] = ['book', 'hood', 'scythe', 'orb', 'sword']
const topTier = BONUS_TIERS.reduce((a, b) => (b.multiplier > a.multiplier ? b : a))
const DRAW_PREVIEW = [...BONUS_TIERS].sort((a, b) => b.multiplier - a.multiplier).slice(0, 3)

// --- bet controls ---------------------------------------------------------------

function clampBet(value: number) {
  if (!Number.isFinite(value) || value < MIN_BET) return MIN_BET
  return Math.min(MAX_BET, Math.floor(value))
}

function setBet(value: number) {
  if (locked.value) return
  bet.value = clampBet(value)
  confirmBuy.value = false
}

function commitBet() {
  betFocused.value = false
  setBet(betDraft.value)
  betDraft.value = bet.value
  betText.value = amountShorthand(bet.value)
}

function betUp() {
  if (locked.value) return
  audio.synth('bet-up')
  setBet(BET_STEPS.find(s => s > bet.value) ?? MAX_BET)
}

function betDown() {
  if (locked.value) return
  audio.synth('bet-down')
  setBet([...BET_STEPS].reverse().find(s => s < bet.value) ?? MIN_BET)
}

function maxBet() {
  if (locked.value) return
  audio.synth('bet-up')
  const affordable = [...BET_STEPS].reverse().find(s => s <= balance.value)
  setBet(affordable ?? MIN_BET)
}

function toggleTurbo() {
  turbo.value = !turbo.value
  audio.synth('toggle')
  try {
    localStorage.setItem('bos_turbo', turbo.value ? '1' : '0')
  } catch { /* ignore */ }
}

// --- win meter ------------------------------------------------------------------

let countRaf = 0

function countWin(target: number, betAmount: number) {
  cancelAnimationFrame(countRaf)
  const from = winMeter.value
  const diff = target - from
  if (diff <= 0) {
    winMeter.value = target
    return
  }
  winFlash.value++
  const ratio = diff / Math.max(betAmount, 0.0001)
  const duration = turbo.value ? 380 : Math.min(1900, 480 + Math.log10(1 + ratio) * 650)
  const start = performance.now()
  let lastTick = 0
  const frame = (now: number) => {
    const k = Math.min(1, (now - start) / duration)
    winMeter.value = from + diff * (1 - Math.pow(1 - k, 3))
    if (now - lastTick > 65 && k < 1) {
      lastTick = now
      audio.synth('tick', k)
    }
    if (k < 1) {
      countRaf = requestAnimationFrame(frame)
    } else {
      winMeter.value = target
      if (ratio >= 2) audio.synth('count-end')
    }
  }
  countRaf = requestAnimationFrame(frame)
}

// --- overlays -------------------------------------------------------------------

function celebrate(amount: number, betAmount: number, mode: 'win' | 'feature', spins?: number) {
  audio.duck(true)
  if (amount >= betAmount * BIG_WIN_X) audio.play('bigWin')
  audio.synth('whoosh')
  celebration.value = { amount, bet: betAmount, mode, spins }
  return new Promise<void>((resolve) => {
    celebrationResolve = resolve
  })
}

function onCelebrationDone() {
  celebration.value = null
  audio.duck(false)
  celebrationResolve?.()
  celebrationResolve = null
}

function onIntroDone() {
  intro.value = null
  introResolve?.()
  introResolve = null
}

// --- autoplay -------------------------------------------------------------------

function startAuto(settings: { count: number, stopOnFeature: boolean, stopOnBigWin: boolean }) {
  showAutoplay.value = false
  auto.on = true
  auto.left = settings.count
  auto.stopOnFeature = settings.stopOnFeature
  auto.stopOnBigWin = settings.stopOnBigWin
  audio.play('button')
  if (!busy.value) void spin()
}

function toggleAutoplay() {
  if (auto.on) {
    stopAuto()
    return
  }
  audio.play('button')
  showAutoplay.value = true
}

function stopAuto() {
  auto.on = false
  auto.left = 0
}

// --- feature --------------------------------------------------------------------

async function runFeature(bonus: BonusResult, baseWin: number, betAmount: number) {
  audio.duck(true)
  intro.value = { tier: bonus.tier, spins: BONUS_SPINS, bet: betAmount }
  await new Promise<void>((resolve) => {
    introResolve = resolve
  })
  audio.duck(false)
  if (destroyed || !stage) return

  const tier = bonus.tier
  stage.setBonusSymbol(tier.symbol)
  stage.setLocked([])
  Object.assign(feature, { active: true, spin: 0, total: BONUS_SPINS, tier, locked: [], won: 0 })
  let booksAllowed = true

  for (const sp of bonus.spins) {
    if (destroyed || !stage) return
    feature.spin++
    const hold = sp.landedGrid
      .map((col, i) => (col.every(s => s === 'bonuswild') && !sp.newlyLocked.includes(i) ? i : -1))
      .filter(i => i >= 0)
    await stage.spin(sp.landedGrid, { turbo: turbo.value, holdReels: hold, anticipate: booksAllowed })

    for (const col of sp.newlyLocked) {
      const row = Math.max(0, sp.landedGrid[col]!.findIndex(s => s === 'bonuswild'))
      audio.synth('column-boom')
      await stage.expandColumn(col, row, turbo.value)
      feature.locked = [...feature.locked, col]
    }

    if (sp.wins.length) {
      const amounts = sp.wins.map(w => (w.symbol === 'bonuswild' ? w.amount * tier.multiplier : w.amount))
      const blood = sp.wins.map(w => w.symbol === 'bonuswild')
      const spinPay = sp.ordinaryPayout + sp.wildPayout * tier.multiplier
      feature.won += spinPay
      countWin(baseWin + feature.won, betAmount)
      audio.synth('win-chime', Math.min(3, Math.floor(Math.log10(1 + spinPay / betAmount) * 2)))
      await stage.showWins(sp.wins, { turbo: turbo.value, amounts, bloodWins: blood, hold: turbo.value ? 300 : 650 })
      stage.clearWins()
    }

    if (sp.retriggered) {
      booksAllowed = false
      feature.total += BONUS_RETRIGGER_SPINS
      retrigger.value = true
      audio.play('bonus')
      stage.flash(0x9dff6a, 0.3)
      await pace(1700)
      retrigger.value = false
    }
    await pace(220)
  }
  stage.setLocked([])
}

// --- spin -----------------------------------------------------------------------

function bookCells(grid: SlotSymbol[][]): Cell[] {
  const cells: Cell[] = []
  grid.forEach((col, c) => col.forEach((s, r) => {
    if (s === 'book') cells.push({ col: c, row: r })
  }))
  return cells
}

async function spin(buy = false) {
  if (!ready.value || busy.value || !stage) return
  audio.unlock()
  confirmBuy.value = false
  const cost = buy ? buyCost.value : bet.value
  if (balance.value < cost) {
    stopAuto()
    toast.add({ title: 'Not enough coins', description: `This ${buy ? 'feature buy' : 'spin'} costs ${fmt(cost)}.`, color: 'warning' })
    return
  }
  const before = balance.value
  let debited = false

  const data = await requestSpin(cost, buy ? { buyBonus: true } : undefined, () => {
    setBalance(before - cost)
    debited = true
    cancelAnimationFrame(countRaf)
    winMeter.value = 0
  })

  if (!data) {
    if (debited) {
      setBalance(before)
      stopAuto()
      toast.add({ title: 'Spin failed', description: errorMsg.value || 'Please try again.', color: 'error' })
    }
    return
  }

  const result = data.gameData
  const betAmount = result.bet
  try {
    await stage.spin(result.grid, { turbo: turbo.value, anticipate: true })

    if (result.wins.length) {
      countWin(result.basePayout, betAmount)
      audio.synth('win-chime', Math.min(3, Math.floor(Math.log10(1 + result.basePayout / betAmount) * 2)))
      await stage.showWins(result.wins, { turbo: turbo.value, amounts: result.wins.map(w => w.amount) })
      stage.clearWins()
    }

    if (result.bonusTriggered && result.bonus) {
      audio.play('bonus')
      await stage.celebrateBooks(bookCells(result.grid), turbo.value)
      await runFeature(result.bonus, result.basePayout, betAmount)
      const featureWin = Math.max(0, result.payout - result.basePayout)
      countWin(result.payout, betAmount)
      await celebrate(featureWin, betAmount, 'feature', feature.total)
      feature.active = false
    } else if (result.payout >= betAmount * BIG_WIN_X) {
      await celebrate(result.payout, betAmount, 'win')
    }

    cancelAnimationFrame(countRaf)
    winMeter.value = result.payout
    lastWin.value = result.payout
    pushHistory({ payout: result.payout, bet: cost, bonus: Boolean(result.bonusTriggered) })
    setBalance(data.balance)

    if (auto.on && ((auto.stopOnFeature && result.bonusTriggered) || (auto.stopOnBigWin && result.payout >= betAmount * BIG_WIN_X))) stopAuto()
  } catch (e) {
    feature.active = false
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    setBalance(data.balance)
    stopAuto()
  }

  isSpinning.value = false

  if (auto.on && !destroyed) {
    auto.left--
    if (auto.left > 0 && balance.value >= bet.value) setTimeout(() => void spin(), turbo.value ? 120 : 320)
    else stopAuto()
  }
}

function spinPress() {
  audio.unlock()
  if (auto.on) {
    audio.play('button')
    stopAuto()
    return
  }
  if (isSpinning.value) {
    stage?.quickStop()
    return
  }
  audio.play('button')
  void spin()
}

function buyPress() {
  audio.unlock()
  audio.play('button')
  if (!confirmBuy.value) {
    confirmBuy.value = true
    return
  }
  void spin(true)
}

// --- keyboard + outside clicks ---------------------------------------------------

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function onKeyDown(e: KeyboardEvent) {
  if (e.code !== 'Space' || isTyping(e.target) || showInfo.value || showAutoplay.value) return
  e.preventDefault()
  if (e.repeat) return
  audio.unlock()
  if (celebration.value) bigWinRef.value?.skip()
  else if (intro.value) introRef.value?.press()
  else spinPress()
}

// Stop a focused button from also "clicking" on Space.
function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space' && !isTyping(e.target) && !showInfo.value && !showAutoplay.value) e.preventDefault()
}

function onPointerDown(e: PointerEvent) {
  audio.unlock()
  if (soundOpen.value && soundEl.value && !soundEl.value.contains(e.target as Node)) soundOpen.value = false
}

// --- lifecycle ------------------------------------------------------------------

onMounted(async () => {
  try {
    turbo.value = localStorage.getItem('bos_turbo') === '1'
  } catch { /* ignore */ }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('pointerdown', onPointerDown)
  void audio.load()
  if (!canvasHost.value) return
  stage = await BosStage.create(canvasHost.value, {
    onReelStart: () => audio.play('reel'),
    onReelLanded: (_col, booksSoFar, booksOnReel) => {
      audio.synth('reel-stop')
      if (booksOnReel > 0) audio.synth('book-land', booksSoFar - 1)
    },
    onAnticipate: () => audio.synth('anticipation'),
    onThreadStep: (step) => {
      audio.play('drawLine')
      audio.synth('rune', step)
    },
    onWildCell: () => audio.play('wildSpawn')
  }, playBookOfShadows(1).grid, () => destroyed)
  if (stage && !destroyed) ready.value = true
})

onBeforeUnmount(() => {
  destroyed = true
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('pointerdown', onPointerDown)
  cancelAnimationFrame(countRaf)
  stage?.destroy()
  stage = null
  audio.dispose()
  introResolve?.()
  celebrationResolve?.()
})
</script>

<template>
  <div
    ref="rootEl"
    class="bos-root"
    :class="{ 'bos-in-feature': feature.active }"
  >
    <div
      class="bos-scene"
      aria-hidden="true"
    >
      <div class="bos-scene-img" />
      <div class="bos-scene-tint" />
      <div class="bos-scene-fog" />
      <span
        v-for="i in 14"
        :key="i"
        class="bos-scene-ember"
        :style="{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 1.7) % 9}s`, animationDuration: `${9 + (i % 5) * 2}s` }"
      />
    </div>

    <div class="bos-stagewrap">
      <div class="bos-cabinet">
        <div class="bos-cab-inner">
          <div class="bos-plaque-glow" />

          <!-- phone status strip (the side panels collapse into this) -->
          <div class="bos-strip">
            <template v-if="feature.active && feature.tier">
              <span class="bos-strip-item"><em>Spin</em> {{ feature.spin }}/{{ feature.total }}</span>
              <span class="bos-strip-item">
                <span
                  class="bos-strip-icon"
                  :style="bosIconStyle(feature.tier.symbol, true, 20)"
                />
                ×{{ feature.tier.multiplier }}
              </span>
              <span class="bos-strip-item"><em>Wilds</em> {{ feature.locked.length }}/{{ BOS_COLS }}</span>
            </template>
            <template v-else>
              <span class="bos-strip-item">
                <span
                  class="bos-strip-icon"
                  :style="bosIconStyle('book', false, 20)"
                />
                {{ BONUS_TRIGGER_COUNT }}+ Books = {{ BONUS_SPINS }} free spins
              </span>
            </template>
          </div>

          <aside class="bos-side bos-side-left">
            <template v-if="feature.active && feature.tier">
              <div class="bos-panel bos-panel-hot">
                <p class="bos-panel-title">
                  Free Spins
                </p>
                <p class="bos-spincount">
                  <strong>{{ feature.spin }}</strong><span>/{{ feature.total }}</span>
                </p>
                <div class="bos-progress">
                  <div :style="{ width: `${(feature.spin / feature.total) * 100}%` }" />
                </div>
              </div>
              <div class="bos-panel bos-panel-hot">
                <p class="bos-panel-title">
                  Drawn symbol
                </p>
                <div class="bos-drawn">
                  <span :style="bosIconStyle(feature.tier.symbol, true, 92)" />
                  <strong>×{{ feature.tier.multiplier }}</strong>
                  <em>{{ feature.tier.label }}</em>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="bos-panel">
                <p class="bos-panel-title">
                  Free Spins
                </p>
                <div class="bos-books">
                  <span
                    v-for="i in BONUS_TRIGGER_COUNT"
                    :key="i"
                    :style="bosIconStyle('book', false, 40)"
                  />
                </div>
                <p class="bos-panel-big">
                  {{ BONUS_TRIGGER_COUNT }}+ Books
                </p>
                <p class="bos-panel-sub">
                  {{ BONUS_SPINS }} free spins with sticky wild columns
                </p>
                <div class="bos-draw-preview">
                  <span
                    v-for="t in DRAW_PREVIEW"
                    :key="t.id"
                    :style="bosIconStyle(t.symbol, true, 34)"
                  />
                </div>
                <p class="bos-panel-sub">
                  Wild runs pay up to <strong>×{{ topTier.multiplier }}</strong>
                </p>
              </div>
              <div class="bos-panel bos-buy">
                <template v-if="!confirmBuy">
                  <button
                    type="button"
                    class="bos-buy-btn"
                    :disabled="!ready || locked || balance < buyCost"
                    @click="buyPress"
                  >
                    <span class="bos-buy-label">Buy Feature</span>
                    <strong>{{ fmt(buyCost) }}</strong>
                  </button>
                </template>
                <template v-else>
                  <p class="bos-buy-q">
                    Buy {{ BONUS_SPINS }} free spins for <strong>{{ fmt(buyCost) }}</strong>?
                  </p>
                  <div class="bos-buy-row">
                    <button
                      type="button"
                      class="bos-buy-yes"
                      :disabled="locked || balance < buyCost"
                      @click="buyPress"
                    >
                      Buy
                    </button>
                    <button
                      type="button"
                      class="bos-buy-no"
                      @click="confirmBuy = false"
                    >
                      Cancel
                    </button>
                  </div>
                </template>
              </div>
            </template>
          </aside>

          <div class="bos-reels">
            <div
              ref="canvasHost"
              class="bos-canvas-host"
            />
            <div
              v-if="!ready"
              class="bos-loading"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-10 animate-spin"
              />
            </div>
            <Transition name="bos-pop">
              <div
                v-if="retrigger"
                class="bos-retrigger"
              >
                <strong>+{{ BONUS_RETRIGGER_SPINS }}</strong>
                <span>Free spins</span>
              </div>
            </Transition>
          </div>

          <aside class="bos-side bos-side-right">
            <template v-if="feature.active && feature.tier">
              <div class="bos-panel bos-panel-hot">
                <p class="bos-panel-title">
                  Wild columns
                </p>
                <div class="bos-pips">
                  <span
                    v-for="c in BOS_COLS"
                    :key="c"
                    :class="{ 'bos-pip-on': feature.locked.includes(c - 1) }"
                  >{{ c }}</span>
                </div>
                <p class="bos-panel-title mt-3">
                  Wild run pays
                </p>
                <ul class="bos-mini-pays">
                  <li
                    v-for="(p, i) in PAYTABLE.bonuswild"
                    :key="i"
                  >
                    <span>{{ i + 3 }} reels</span>
                    <strong>{{ fmt(p * feature.tier.multiplier * bet) }}</strong>
                  </li>
                </ul>
              </div>
              <div class="bos-panel bos-panel-hot">
                <p class="bos-panel-title">
                  Feature win
                </p>
                <p class="bos-feature-win">
                  {{ fmt(feature.won) }}
                </p>
              </div>
            </template>
            <template v-else>
              <div class="bos-panel">
                <p class="bos-panel-title">
                  Top pays · 5 reels
                </p>
                <ul class="bos-mini-pays">
                  <li
                    v-for="id in TOP_PAYS"
                    :key="id"
                  >
                    <span
                      class="bos-mini-icon"
                      :style="bosIconStyle(id, false, 36)"
                    />
                    <strong>{{ fmt(PAYTABLE[id][2] * bet) }}</strong>
                  </li>
                </ul>
                <button
                  type="button"
                  class="bos-link"
                  @click="showInfo = true"
                >
                  Full paytable
                </button>
              </div>
              <div class="bos-panel">
                <p class="bos-panel-title">
                  Max win
                </p>
                <p class="bos-panel-big">
                  {{ formatNumber(BOS_MAX_WIN_MULT, false) }}×
                </p>
                <p class="bos-panel-title mt-2">
                  Volatility
                </p>
                <div
                  class="bos-vol"
                  aria-label="Volatility 5 of 5"
                >
                  <span
                    v-for="i in 5"
                    :key="i"
                  />
                </div>
              </div>
            </template>
          </aside>

          <BosFeatureIntro
            v-if="intro"
            ref="introRef"
            :tier="intro.tier"
            :spins="intro.spins"
            :bet="intro.bet"
            :auto="auto.on"
            :fast="turbo"
            @tick="audio.synth('roll-tick')"
            @reveal="audio.synth('reveal')"
            @done="onIntroDone"
          />
          <BosBigWin
            v-if="celebration"
            ref="bigWinRef"
            :amount="celebration.amount"
            :bet="celebration.bet"
            :mode="celebration.mode"
            :spins="celebration.spins"
            :fast="turbo || auto.on"
            @tier="audio.synth('tier-up', $event)"
            @tick="audio.synth('tick', $event)"
            @settled="audio.synth('count-end')"
            @done="onCelebrationDone"
          />
        </div>
        <div
          class="bos-frame"
          aria-hidden="true"
        />
      </div>

      <!-- control deck -->
      <div class="bos-deck">
        <div class="bos-deck-left">
          <div class="bos-meter bos-meter-balance">
            <span>Balance</span>
            <strong class="bos-full">{{ fmt(balance) }}</strong>
            <strong class="bos-compact">{{ formatNumber(balance) }}</strong>
          </div>

          <div
            class="bos-meter bos-bet"
            :class="{ 'bos-bet-locked': locked }"
          >
            <span>Bet</span>
            <div class="bos-bet-row">
              <button
                type="button"
                class="bos-step"
                aria-label="Lower bet"
                :disabled="locked || bet <= MIN_BET"
                @click="betDown"
              >
                <UIcon
                  name="i-lucide-minus"
                  class="size-4"
                />
              </button>
              <input
                v-model="betText"
                class="bos-bet-input"
                inputmode="decimal"
                aria-label="Bet amount"
                :disabled="locked"
                @focus="betFocused = true"
                @blur="commitBet"
                @keydown.enter="($event.target as HTMLInputElement).blur()"
              >
              <button
                type="button"
                class="bos-step"
                aria-label="Raise bet"
                :disabled="locked || bet >= MAX_BET"
                @click="betUp"
              >
                <UIcon
                  name="i-lucide-plus"
                  class="size-4"
                />
              </button>
            </div>
            <output
              v-if="betFocused && amountPreview(betText)"
              class="bos-bet-preview"
            >{{ amountPreview(betText, true) }}</output>
          </div>
          <button
            type="button"
            class="bos-max"
            :disabled="locked"
            @click="maxBet"
          >
            Max
          </button>
        </div>

        <div
          :key="winFlash"
          class="bos-win"
          :class="{ 'bos-win-on': winMeter > 0 }"
        >
          <span>{{ feature.active ? 'Total win' : 'Win' }}</span>
          <strong>{{ fmt(winMeter) }}</strong>
          <em>{{ statusLine }}</em>
        </div>

        <div class="bos-deck-right">
          <button
            type="button"
            class="bos-pill bos-pill-buy"
            :disabled="!ready || locked || balance < buyCost"
            @click="buyPress"
          >
            {{ confirmBuy ? `Confirm ${fmt(buyCost)}` : 'Buy' }}
          </button>
          <button
            type="button"
            class="bos-pill"
            :class="{ 'bos-pill-on': auto.on }"
            :disabled="!ready || (!auto.on && busy)"
            @click="toggleAutoplay"
          >
            <UIcon
              name="i-lucide-repeat"
              class="size-4"
            />
            <span :class="{ 'bos-pill-text': !auto.on }">{{ auto.on ? auto.left : 'Auto' }}</span>
          </button>
          <button
            type="button"
            class="bos-spin"
            :class="{ 'bos-spin-busy': isSpinning, 'bos-spin-auto': auto.on }"
            :disabled="!ready || ((feature.active || !!intro || !!celebration) && !auto.on)"
            :aria-label="auto.on ? 'Stop autoplay' : isSpinning ? 'Stop reels' : 'Spin'"
            @click="spinPress"
          >
            <span class="bos-spin-ring" />
            <span class="bos-spin-core">
              <UIcon
                v-if="auto.on"
                name="i-lucide-square"
                class="size-7"
              />
              <UIcon
                v-else-if="isSpinning"
                name="i-lucide-hand"
                class="size-8"
              />
              <UIcon
                v-else
                name="i-lucide-refresh-cw"
                class="size-9"
              />
            </span>
          </button>
          <button
            type="button"
            class="bos-pill"
            :class="{ 'bos-pill-on': turbo }"
            :aria-pressed="turbo"
            @click="toggleTurbo"
          >
            <UIcon
              name="i-lucide-zap"
              class="size-4"
            />
            <span class="bos-pill-text">Turbo</span>
          </button>
          <button
            type="button"
            class="bos-round-btn"
            aria-label="Paytable and rules"
            @click="audio.play('button'); showInfo = true"
          >
            <UIcon
              name="i-lucide-scroll-text"
              class="size-[18px]"
            />
          </button>
          <div
            ref="soundEl"
            class="bos-sound"
          >
            <button
              type="button"
              class="bos-round-btn"
              :aria-label="muted ? 'Sound off' : 'Sound settings'"
              @click="soundOpen = !soundOpen"
            >
              <UIcon
                :name="muted || volume === 0 ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
                class="size-[18px]"
              />
            </button>
            <Transition name="bos-pop">
              <div
                v-if="soundOpen"
                class="bos-sound-pop"
              >
                <label class="bos-sound-row">
                  <span>Volume</span>
                  <input
                    v-model.number="volume"
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    :disabled="muted"
                    aria-label="Volume"
                  >
                </label>
                <button
                  type="button"
                  class="bos-sound-toggle"
                  :class="{ 'bos-on': !muted }"
                  @click="muted = !muted"
                >
                  <span>Sound</span><em>{{ muted ? 'Off' : 'On' }}</em>
                </button>
                <button
                  type="button"
                  class="bos-sound-toggle"
                  :class="{ 'bos-on': music }"
                  @click="music = !music"
                >
                  <span>Music</span><em>{{ music ? 'On' : 'Off' }}</em>
                </button>
              </div>
            </Transition>
          </div>

        </div>
      </div>
    </div>

    <BosInfo
      v-model:open="showInfo"
      :bet="bet"
      :history="history"
    />
    <BosAutoplay
      v-model:open="showAutoplay"
      :bet="bet"
      :balance="balance"
      @start="startAuto"
    />
  </div>
</template>

<style scoped>
.bos-root {
  --gold: #f0c36a;
  --gold-hi: #ffe6a8;
  --gold-lo: #8a5a1c;
  --ink: #0b0705;
  --parch: #e8d9bd;
  --blood: #ff4a3a;
  --arcane: #9dff6a;
  --u: calc(min(100cqw - 24px, 560px) / 1300);

  position: relative;
  min-height: 100%;
  overflow: hidden;
  container: bosroot / inline-size;
  background: #070504;
  color: var(--parch);
}

/* --- scene ---------------------------------------------------------------- */

.bos-scene {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.bos-scene-img {
  position: absolute;
  inset: 0;
  background: url('/slots/bookofshadows/background.png') center 35% / cover no-repeat;
  filter: saturate(0.85);
}

.bos-scene-tint {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 50% at 50% 42%, rgba(80, 45, 14, 0.25), transparent 70%),
    radial-gradient(ellipse 120% 90% at 50% 40%, transparent 40%, rgba(3, 2, 1, 0.85) 100%),
    linear-gradient(180deg, rgba(5, 3, 2, 0.35), rgba(5, 3, 2, 0.7));
  transition: background 800ms ease;
}

.bos-in-feature .bos-scene-tint {
  background:
    radial-gradient(ellipse 60% 50% at 50% 42%, rgba(140, 20, 10, 0.35), transparent 70%),
    radial-gradient(ellipse 120% 90% at 50% 40%, transparent 40%, rgba(8, 1, 1, 0.9) 100%),
    linear-gradient(180deg, rgba(20, 3, 2, 0.45), rgba(8, 2, 1, 0.75));
}

.bos-scene-fog {
  position: absolute;
  inset: -10% -20%;
  background:
    radial-gradient(ellipse 30% 18% at 20% 70%, rgba(200, 190, 170, 0.07), transparent 70%),
    radial-gradient(ellipse 35% 20% at 80% 80%, rgba(200, 190, 170, 0.06), transparent 70%);
  animation: bos-fog 22s ease-in-out infinite alternate;
}

@keyframes bos-fog {
  to {
    transform: translateX(6%);
  }
}

.bos-scene-ember {
  position: absolute;
  bottom: -10px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #ffb45a;
  box-shadow: 0 0 8px 2px rgba(255, 150, 60, 0.7);
  opacity: 0;
  animation: bos-ember linear infinite;
}

@keyframes bos-ember {
  0% {
    opacity: 0;
    transform: translate(0, 0);
  }

  10% {
    opacity: 0.8;
  }

  100% {
    opacity: 0;
    transform: translate(40px, -95vh);
  }
}

/* --- cabinet ----------------------------------------------------------------- */

.bos-stagewrap {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 16px 16px;
}

.bos-cabinet {
  position: relative;
  width: min(100%, calc((100dvh - 150px) * 1.5), 1500px);
  aspect-ratio: 1536 / 1024;
  filter: drop-shadow(0 30px 40px rgba(0, 0, 0, 0.75));
}

.bos-frame {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: url('/slots/bookofshadows/frame.png') center / 100% 100% no-repeat;
  pointer-events: none;
}

.bos-cab-inner {
  position: absolute;
  inset: 17.2% 13.6% 12.4% 13.5%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: stretch;
  gap: 1.4%;
  padding: 1.2% 1.4% 1%;
  border-radius: 6px;
  background:
    radial-gradient(ellipse 50% 60% at 50% 50%, rgba(90, 55, 20, 0.35), transparent 75%),
    linear-gradient(180deg, #120c08, #070504);
  box-shadow: inset 0 0 50px rgba(0, 0, 0, 0.95);
  transition: background 600ms ease;
  container: cab / size;
}

/* Side panels shrink with short cabinets (laptops) instead of clipping. */
@container cab (max-height: 560px) {
  .bos-side {
    zoom: 0.86;
  }
}

@container cab (max-height: 470px) {
  .bos-side {
    zoom: 0.74;
  }
}

@container cab (max-height: 400px) {
  .bos-side {
    zoom: 0.62;
  }
}

.bos-in-feature .bos-cab-inner {
  background:
    radial-gradient(ellipse 50% 60% at 50% 50%, rgba(140, 25, 12, 0.4), transparent 75%),
    linear-gradient(180deg, #160806, #070303);
}

.bos-plaque-glow {
  position: absolute;
  left: 50%;
  top: -22%;
  width: 46%;
  height: 26%;
  translate: -50% 0;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(255, 170, 70, 0.28), transparent 70%);
  animation: bos-candle 5s ease-in-out infinite;
  pointer-events: none;
  z-index: 51;
  mix-blend-mode: screen;
}

@keyframes bos-candle {
  0%, 100% {
    opacity: 0.7;
  }

  40% {
    opacity: 1;
  }

  46% {
    opacity: 0.55;
  }

  52% {
    opacity: 0.95;
  }
}

.bos-reels {
  position: relative;
  height: 100%;
  aspect-ratio: 648 / 744;
  min-height: 0;
}

.bos-canvas-host {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bos-canvas-host :deep(canvas) {
  display: block;
}

.bos-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--gold);
}

.bos-retrigger {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at center, rgba(20, 40, 8, 0.85), rgba(0, 0, 0, 0.6) 70%);
  pointer-events: none;
}

.bos-retrigger strong {
  font-family: 'Cinzel Decorative', Cinzel, Georgia, serif;
  font-size: clamp(56px, 8vw, 110px);
  font-weight: 900;
  line-height: 1;
  color: #eaffd8;
  text-shadow: 0 0 30px rgba(157, 255, 106, 0.8), 0 4px 0 #0b1a04;
}

.bos-retrigger span {
  font-family: Cinzel, Georgia, serif;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #c4ff9e;
}

/* --- side panels ------------------------------------------------------------ */

.bos-side {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  overflow: hidden;
}

.bos-panel {
  position: relative;
  border: 1px solid rgba(214, 170, 90, 0.32);
  border-radius: 12px;
  background:
    radial-gradient(ellipse 100% 60% at 50% 0%, rgba(120, 75, 25, 0.22), transparent 70%),
    linear-gradient(180deg, rgba(28, 18, 10, 0.92), rgba(10, 6, 4, 0.92));
  padding: 12px 12px 14px;
  text-align: center;
  box-shadow: inset 0 1px 0 rgba(255, 220, 150, 0.1), 0 6px 16px rgba(0, 0, 0, 0.5);
}

.bos-panel::before,
.bos-panel::after {
  content: '';
  position: absolute;
  top: 6px;
  width: 6px;
  height: 6px;
  rotate: 45deg;
  background: var(--gold);
  opacity: 0.6;
}

.bos-panel::before {
  left: 6px;
}

.bos-panel::after {
  right: 6px;
}

.bos-panel-hot {
  border-color: rgba(255, 90, 60, 0.5);
  background:
    radial-gradient(ellipse 100% 60% at 50% 0%, rgba(170, 35, 15, 0.3), transparent 70%),
    linear-gradient(180deg, rgba(34, 12, 8, 0.94), rgba(12, 4, 3, 0.94));
  box-shadow: inset 0 1px 0 rgba(255, 170, 140, 0.12), 0 0 22px rgba(255, 60, 30, 0.18);
}

.bos-panel-title {
  color: #d6b27a;
  font-family: Cinzel, Georgia, serif;
  font-size: clamp(10px, 0.85vw, 12px);
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.bos-panel-big {
  margin-top: 2px;
  font-family: Cinzel, Georgia, serif;
  font-size: clamp(18px, 1.7vw, 26px);
  font-weight: 900;
  line-height: 1.1;
  background: linear-gradient(180deg, #fff6d8, #f0c36a 55%, #a86a1c);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 2px 0 rgba(0, 0, 0, 0.8));
}

.bos-panel-sub {
  margin-top: 4px;
  color: rgba(232, 217, 189, 0.72);
  font-size: clamp(11px, 0.85vw, 12.5px);
  line-height: 1.4;
}

.bos-panel-sub strong {
  color: var(--gold-hi);
}

.bos-books {
  display: flex;
  justify-content: center;
  gap: 2px;
  margin: 8px 0 4px;
}

.bos-books > span {
  display: block;
  filter: drop-shadow(0 0 8px rgba(157, 255, 106, 0.55));
  animation: bos-bob 2.4s ease-in-out infinite;
}

.bos-books > span:nth-child(2) {
  animation-delay: 0.3s;
}

.bos-books > span:nth-child(3) {
  animation-delay: 0.6s;
}

@keyframes bos-bob {
  50% {
    transform: translateY(-4px);
  }
}

.bos-draw-preview {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 10px;
}

.bos-draw-preview > span {
  display: block;
  border-radius: 4px;
  box-shadow: 0 0 10px rgba(255, 120, 40, 0.35);
}

.bos-buy {
  padding: 10px;
}

.bos-buy-btn {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  border: 1px solid #f0a35a;
  border-radius: 10px;
  background: linear-gradient(180deg, #a3261a, #5a0e08 60%, #300604);
  padding: 9px 6px;
  color: #fff1e0;
  box-shadow: 0 0 18px rgba(255, 80, 40, 0.3), inset 0 1px 0 rgba(255, 210, 180, 0.35);
  cursor: pointer;
  transition: transform 140ms ease, filter 140ms ease;
}

.bos-buy-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.15);
}

.bos-buy-btn:disabled,
.bos-buy-yes:disabled {
  cursor: not-allowed;
  filter: grayscale(0.6);
  opacity: 0.5;
}

.bos-buy-label {
  font-family: Cinzel, Georgia, serif;
  font-size: clamp(11px, 0.95vw, 13px);
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.bos-buy-btn strong {
  font-size: clamp(13px, 1.1vw, 16px);
  font-weight: 900;
  color: #ffe6a8;
}

.bos-buy-q {
  font-size: 12.5px;
  line-height: 1.4;
}

.bos-buy-q strong {
  color: var(--gold-hi);
}

.bos-buy-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.bos-buy-yes,
.bos-buy-no {
  flex: 1;
  border-radius: 8px;
  padding: 7px 0;
  font-family: Cinzel, Georgia, serif;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.1em;
  cursor: pointer;
}

.bos-buy-yes {
  border: 1px solid #f0a35a;
  background: linear-gradient(180deg, #a3261a, #4a0b06);
  color: #fff1e0;
}

.bos-buy-no {
  border: 1px solid rgba(214, 170, 90, 0.35);
  background: rgba(0, 0, 0, 0.35);
  color: var(--parch);
}

.bos-spincount {
  margin-top: 2px;
  font-family: Cinzel, Georgia, serif;
  font-weight: 900;
  line-height: 1;
}

.bos-spincount strong {
  font-size: clamp(34px, 3.4vw, 52px);
  color: #fff1e0;
  text-shadow: 0 0 18px rgba(255, 80, 50, 0.7), 0 3px 0 #1a0402;
}

.bos-spincount span {
  font-size: clamp(16px, 1.5vw, 22px);
  color: rgba(255, 210, 190, 0.6);
}

.bos-progress {
  height: 6px;
  margin-top: 10px;
  overflow: hidden;
  border: 1px solid rgba(255, 90, 60, 0.35);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.5);
}

.bos-progress > div {
  height: 100%;
  background: linear-gradient(90deg, #5a0e08, #ff4a3a, #ffc08a);
  box-shadow: 0 0 10px rgba(255, 80, 50, 0.7);
  transition: width 360ms ease;
}

.bos-drawn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-top: 8px;
}

.bos-drawn > span {
  display: block;
  max-width: 100%;
  filter: drop-shadow(0 0 14px rgba(255, 110, 50, 0.55));
  animation: bos-bob 3s ease-in-out infinite;
}

.bos-drawn strong {
  font-family: Cinzel, Georgia, serif;
  font-size: clamp(24px, 2.4vw, 36px);
  font-weight: 900;
  color: #ffe6a8;
  text-shadow: 0 0 16px rgba(255, 170, 70, 0.7), 0 3px 0 #1a0a02;
}

.bos-drawn em {
  font-style: normal;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255, 220, 200, 0.7);
}

.bos-mini-pays {
  display: grid;
  gap: 4px;
  margin-top: 8px;
}

.bos-mini-pays li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid rgba(214, 170, 90, 0.12);
  padding: 2px 4px 4px;
  font-size: clamp(11px, 0.9vw, 13px);
}

.bos-mini-pays li:last-child {
  border-bottom: 0;
}

.bos-mini-pays strong {
  color: var(--gold-hi);
  font-variant-numeric: tabular-nums;
  font-weight: 800;
}

.bos-mini-icon {
  display: block;
  flex: 0 0 auto;
}

.bos-link {
  margin-top: 8px;
  color: var(--gold);
  font-size: 12px;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.bos-vol {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin-top: 6px;
}

.bos-vol span {
  width: 14px;
  height: 14px;
  rotate: 45deg;
  border: 1px solid #ff9a6a;
  background: linear-gradient(135deg, #ff6a3a, #8a1a0a);
  box-shadow: 0 0 6px rgba(255, 90, 50, 0.6);
}

.bos-pips {
  display: flex;
  justify-content: center;
  gap: 5px;
  margin-top: 8px;
}

.bos-pips span {
  display: grid;
  width: 24px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(255, 120, 90, 0.35);
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 210, 190, 0.45);
  font-size: 11px;
  font-weight: 800;
  transition: all 300ms ease;
}

.bos-pips .bos-pip-on {
  border-color: #ffb08a;
  background: linear-gradient(180deg, #ff6a3a, #7a1206);
  color: #fff;
  box-shadow: 0 0 12px rgba(255, 80, 40, 0.8);
}

.bos-feature-win {
  margin-top: 4px;
  font-family: Cinzel, Georgia, serif;
  font-size: clamp(20px, 2vw, 30px);
  font-weight: 900;
  color: #fff1e0;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 16px rgba(255, 80, 50, 0.6);
}

.bos-strip,
.bos-compact {
  display: none;
}

/* --- deck ------------------------------------------------------------------ */

.bos-deck {
  position: relative;
  z-index: 2;
  display: grid;
  width: min(100%, 1240px);
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  border: 1px solid rgba(214, 170, 90, 0.45);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 220, 150, 0.06), transparent 40%),
    linear-gradient(180deg, #1d130b, #0b0705);
  padding: 10px 14px;
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.6), 0 18px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 220, 150, 0.14);
}

.bos-deck-left,
.bos-deck-right {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.bos-deck-right {
  justify-content: flex-end;
}

.bos-round-btn {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(214, 170, 90, 0.45);
  border-radius: 999px;
  background: radial-gradient(circle at 50% 30%, #2e2014, #0e0906);
  color: var(--gold);
  cursor: pointer;
  transition: transform 140ms ease, border-color 140ms ease;
}

.bos-round-btn:hover {
  transform: translateY(-1px);
  border-color: var(--gold);
}

.bos-sound {
  position: relative;
}

.bos-sound-pop {
  position: absolute;
  bottom: calc(100% + 10px);
  right: -8px;
  z-index: 60;
  display: grid;
  width: 210px;
  gap: 8px;
  border: 1px solid rgba(214, 170, 90, 0.5);
  border-radius: 12px;
  background: linear-gradient(180deg, #21160d, #0e0906);
  padding: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
}

.bos-sound-row {
  display: grid;
  gap: 6px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #d6b27a;
}

.bos-sound-row input {
  width: 100%;
  accent-color: var(--gold);
}

.bos-sound-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid rgba(214, 170, 90, 0.25);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  padding: 7px 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.bos-sound-toggle em {
  font-style: normal;
  color: rgba(232, 217, 189, 0.5);
}

.bos-sound-toggle.bos-on em {
  color: var(--gold-hi);
}

.bos-meter {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  border: 1px solid rgba(214, 170, 90, 0.25);
  border-radius: 10px;
  background: linear-gradient(180deg, #050302, #120b06);
  padding: 5px 12px 6px;
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.8);
}

.bos-meter > span {
  color: #a88a5c;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.bos-meter > strong {
  overflow: hidden;
  color: var(--gold-hi);
  font-size: 16px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bos-meter-balance {
  flex: 1 1 auto;
  min-width: 118px;
  max-width: 200px;
}

.bos-bet {
  flex: 0 0 auto;
}

.bos-bet-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bos-step {
  display: grid;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(214, 170, 90, 0.5);
  border-radius: 999px;
  background: radial-gradient(circle at 50% 30%, #3a2814, #140d07);
  color: var(--gold-hi);
  cursor: pointer;
}

.bos-step:hover:not(:disabled) {
  border-color: var(--gold);
  background: radial-gradient(circle at 50% 30%, #5a3c18, #1c1209);
}

.bos-step:disabled,
.bos-max:disabled,
.bos-pill:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.bos-bet-input {
  width: 92px;
  border: 0;
  background: transparent;
  color: #fff3d0;
  font-size: 17px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  text-align: center;
  outline: none;
}

.bos-bet-input:focus {
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(240, 195, 106, 0.5);
}

.bos-bet-preview {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  translate: -50% 0;
  border: 1px solid rgba(214, 170, 90, 0.4);
  border-radius: 6px;
  background: #140d07;
  padding: 2px 8px;
  color: var(--gold-hi);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.bos-max {
  flex: 0 0 auto;
  border: 1px solid rgba(214, 170, 90, 0.45);
  border-radius: 8px;
  background: linear-gradient(180deg, #3a2814, #140d07);
  padding: 9px 10px;
  color: var(--gold-hi);
  font-family: Cinzel, Georgia, serif;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}

.bos-win {
  display: flex;
  min-width: 210px;
  flex-direction: column;
  align-items: center;
  border: 1px solid rgba(214, 170, 90, 0.35);
  border-radius: 12px;
  background: radial-gradient(ellipse at 50% 0%, rgba(110, 70, 20, 0.35), transparent 70%), #070403;
  padding: 4px 22px 5px;
  box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.9);
}

.bos-win > span {
  color: #a88a5c;
  font-family: Cinzel, Georgia, serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
}

.bos-win > strong {
  color: rgba(255, 230, 168, 0.35);
  font-family: Cinzel, Georgia, serif;
  font-size: 30px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
}

.bos-win-on > strong {
  color: #fff1c8;
  text-shadow: 0 0 18px rgba(255, 170, 60, 0.75), 0 2px 0 #2a1204;
  animation: bos-win-pop 380ms cubic-bezier(0.2, 1.6, 0.4, 1);
}

@keyframes bos-win-pop {
  from {
    transform: scale(1.25);
  }
}

.bos-win > em {
  color: rgba(232, 217, 189, 0.5);
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
  white-space: nowrap;
}

.bos-pill {
  display: inline-flex;
  height: 40px;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(214, 170, 90, 0.45);
  border-radius: 999px;
  background: radial-gradient(circle at 50% 30%, #2e2014, #0e0906);
  padding: 0 14px;
  color: var(--gold-hi);
  font-family: Cinzel, Georgia, serif;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}

.bos-pill:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: var(--gold);
}

.bos-pill-on {
  border-color: var(--gold);
  background: radial-gradient(circle at 50% 30%, #7a5418, #2a1a08);
  box-shadow: 0 0 16px rgba(240, 180, 80, 0.45);
}

.bos-pill-buy {
  display: none;
}

.bos-spin {
  position: relative;
  display: grid;
  width: 92px;
  height: 92px;
  flex: 0 0 auto;
  margin: -24px 0 -24px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: none;
  cursor: pointer;
}

.bos-spin-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    conic-gradient(from 0deg, #ffe6a8, #8a5a1c, #f0c36a, #5a3810, #ffe6a8, #8a5a1c, #f0c36a, #5a3810, #ffe6a8);
  box-shadow: 0 0 0 3px #0b0705, 0 0 26px rgba(240, 170, 60, 0.5), 0 10px 22px rgba(0, 0, 0, 0.7);
  animation: bos-ring 12s linear infinite;
}

.bos-spin-core {
  position: relative;
  display: grid;
  width: 78px;
  height: 78px;
  place-items: center;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 28%, #6fbf3a 0%, #2d6a12 42%, #0f2a05 100%);
  box-shadow: inset 0 3px 6px rgba(255, 255, 255, 0.35), inset 0 -8px 16px rgba(0, 0, 0, 0.6);
  color: #f4ffe8;
  filter: drop-shadow(0 0 6px rgba(157, 255, 106, 0.5));
  transition: transform 120ms ease, filter 160ms ease;
}

.bos-spin:hover:not(:disabled) .bos-spin-core {
  filter: drop-shadow(0 0 14px rgba(157, 255, 106, 0.8)) brightness(1.1);
}

.bos-spin:active:not(:disabled) .bos-spin-core {
  transform: scale(0.94);
}

.bos-spin-busy .bos-spin-ring {
  animation-duration: 1.4s;
}

.bos-spin-busy .bos-spin-core {
  background: radial-gradient(circle at 50% 28%, #a0782a 0%, #5a3a10 45%, #2a1805 100%);
}

.bos-spin-auto .bos-spin-core {
  background: radial-gradient(circle at 50% 28%, #d8483a 0%, #7a140a 45%, #2a0503 100%);
}

.bos-spin:disabled {
  cursor: not-allowed;
}

.bos-spin:disabled .bos-spin-core {
  filter: grayscale(0.7) brightness(0.7);
}

@keyframes bos-ring {
  to {
    rotate: 360deg;
  }
}

.bos-pop-enter-active,
.bos-pop-leave-active {
  transition: opacity 200ms ease, transform 240ms cubic-bezier(0.2, 1.4, 0.4, 1);
}

.bos-pop-enter-from,
.bos-pop-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* --- narrower desktop: tighten the deck ------------------------------------ */

@container bosroot (max-width: 1180px) {
  .bos-meter-balance {
    max-width: 150px;
  }

  .bos-win {
    min-width: 180px;
    padding: 4px 14px 5px;
  }

  .bos-win > strong {
    font-size: 24px;
  }

  .bos-pill-text {
    display: none;
  }

  .bos-pill {
    min-width: 40px;
    justify-content: center;
    padding: 0 10px;
  }
}

/* --- portrait layout (phones, small tablets) ------------------------------- */

@container bosroot (max-width: 860px) {
  .bos-stagewrap {
    padding: 8px 12px 16px;
  }

  .bos-cabinet {
    width: min(100cqw - 24px, 560px);
    aspect-ratio: auto;
    padding: calc(var(--u) * 196) calc(var(--u) * 70) calc(var(--u) * 150);
  }

  /* 9-slice the same frame so it wraps a portrait window */
  .bos-frame {
    inset: 0 calc(var(--u) * -150) 0;
    border-style: solid;
    border-color: transparent;
    border-width: calc(var(--u) * 184) calc(var(--u) * 270) calc(var(--u) * 144);
    border-image: url('/slots/bookofshadows/frame.png') 184 270 144 stretch;
    background: none;
  }

  .bos-cab-inner {
    position: relative;
    inset: auto;
    container-type: normal;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
  }

  .bos-side {
    display: none;
  }

  .bos-strip {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 14px;
    border-bottom: 1px solid rgba(214, 170, 90, 0.2);
    padding: 2px 4px 6px;
    font-family: Cinzel, Georgia, serif;
    font-size: 12px;
    font-weight: 900;
    color: var(--gold-hi);
  }

  .bos-strip-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .bos-strip-item em {
    font-style: normal;
    color: #a88a5c;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-size: 10px;
  }

  .bos-strip-icon {
    display: inline-block;
  }

  .bos-reels {
    width: 100%;
    height: auto;
  }

  .bos-plaque-glow {
    top: calc(var(--u) * -190);
    height: calc(var(--u) * 180);
  }

  .bos-deck {
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 10px;
  }

  .bos-win {
    order: -1;
    width: 100%;
  }

  .bos-deck-left {
    flex-wrap: wrap;
    justify-content: center;
  }

  .bos-meter-balance {
    max-width: none;
  }

  .bos-deck-right {
    justify-content: center;
    gap: 8px;
  }

  .bos-pill-buy {
    display: inline-flex;
    border-color: #f0a35a;
    background: linear-gradient(180deg, #a3261a, #4a0b06);
  }

  .bos-spin {
    width: 84px;
    height: 84px;
    margin: 0 2px;
  }

  .bos-spin-core {
    width: 70px;
    height: 70px;
  }

  .bos-deck-right .bos-pill,
  .bos-deck-right .bos-round-btn {
    width: 38px;
    height: 38px;
  }

  .bos-pill-buy {
    width: auto !important;
    padding: 0 12px;
  }

  .bos-deck-left {
    flex-wrap: nowrap;
    width: 100%;
  }

  .bos-meter-balance {
    min-width: 0;
  }

  .bos-bet-input {
    width: 64px;
  }
}

@container bosroot (max-width: 420px) {
  .bos-full {
    display: none;
  }

  .bos-compact {
    display: block;
  }

  .bos-bet-input {
    width: 76px;
  }
}
</style>
