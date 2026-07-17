<script setup lang="ts">
import type { DiceResult } from '#shared/utils/gamelogic/dice'

type DiceHistoryEntry = { roll: number; won: boolean; payout: number; multiplier: number; bet: number }

const {
  bet, isPlaying: isRolling, isFetching, lastBet, errorMsg, balance, setBalance, history, pushHistory, play
} = useCasinoGame<DiceResult, DiceHistoryEntry>('dice')

const winChance = ref(50)
const lastResult = ref<DiceResult | null>(null)
const animRoll = ref<number | null>(null)
const showHelp = ref(false)

const multiplier = computed(() => 98 / winChance.value)
const totalPayout = computed(() => bet.value * multiplier.value)
const displayRoll = computed(() => animRoll.value ?? lastResult.value?.roll ?? null)

function clampWC(v: number) {
  return Math.round(Math.min(96, Math.max(2, v)) * 10) / 10
}

let animTimer: ReturnType<typeof setTimeout> | null = null

async function roll() {
  const data = await play({ winChance: winChance.value }, () => { lastResult.value = null })
  if (!data) return

  const target = data.gameData.roll
  const duration = 650
  const startTime = Date.now()
  animRoll.value = 0

  const countUp = () => {
    const t = Math.min(1, (Date.now() - startTime) / duration)
    const ease = 1 - Math.pow(1 - t, 3)
    animRoll.value = parseFloat((target * ease).toFixed(2))
    if (t < 1) {
      animTimer = setTimeout(countUp, 16)
    } else {
      animRoll.value = null
      lastResult.value = data.gameData
      setBalance(data.balance)
      pushHistory({ roll: data.gameData.roll, won: data.gameData.won, payout: data.gameData.payout, multiplier: data.gameData.multiplier, bet: lastBet.value })
      isRolling.value = false
    }
  }
  countUp()
}

function onKeydown(e: KeyboardEvent) {
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); roll() }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (animTimer) clearTimeout(animTimer)
})
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-dices" class="size-6 text-primary" />
        Dice
      </h1>
      <p class="text-sm text-muted mt-0.5">98% RTP</p>
    </div>

    <div class="grid lg:grid-cols-3 gap-6">

      <!-- Controls -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Controls</h2>
            <UButton icon="i-lucide-circle-help" color="neutral" variant="ghost" size="xs" @click="showHelp = true" />
          </div>
        </template>

        <div class="space-y-4">
          <!-- Bet Amount -->
          <BetControls v-model="bet" :disabled="isRolling" />

          <!-- Win Chance -->
          <div>
            <div class="flex justify-between items-center mb-1.5">
              <label class="text-xs text-muted uppercase tracking-wide font-medium">Win Chance</label>
              <div class="flex items-baseline gap-1">
                <input
                  v-model.number="winChance"
                  :disabled="isRolling"
                  type="number" min="2" max="96" step="0.1"
                  class="w-16 bg-elevated border border-default rounded-lg px-2 py-1 font-bold font-mono text-sm text-center focus:outline-none focus:border-primary/60 [appearance:textfield] disabled:opacity-40 transition-colors"
                  @change="winChance = clampWC(Number(winChance))"
                />
                <span class="text-muted text-sm">%</span>
              </div>
            </div>
            <input
              v-model.number="winChance"
              :disabled="isRolling"
              type="range" min="2" max="96" step="0.1"
              class="w-full accent-primary disabled:opacity-40"
              @input="winChance = clampWC(Number(winChance))"
            />
            <div class="flex justify-between text-xs text-muted font-mono mt-1.5">
              <span>Win &lt; {{ winChance.toFixed(1) }}</span>
              <span>Lose &ge; {{ winChance.toFixed(1) }}</span>
            </div>
          </div>

          <!-- Stats -->
          <div class="rounded-lg bg-elevated border border-default p-3 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Multiplier</span>
              <span class="font-bold tabular-nums">{{ multiplier.toFixed(4) }}×</span>
            </div>
            <USeparator />
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Payout on Win</span>
              <span class="font-bold tabular-nums text-success">${{ formatNumber(totalPayout, false) }}</span>
            </div>
          </div>

          <!-- Error -->
          <Transition name="fade-up">
            <UAlert v-if="errorMsg" color="error" variant="soft" :description="errorMsg"
              :close-button="{ icon: 'i-lucide-x', color: 'neutral', variant: 'ghost' }" @close="errorMsg = ''" />
          </Transition>

          <!-- Balance -->
          <div class="rounded-lg bg-elevated border border-default p-3 flex justify-between items-center">
            <span class="text-xs text-muted uppercase tracking-wide font-medium">Balance</span>
            <span class="font-bold text-sm">
              <CoinBalance :value="balance" :compact="false" />
            </span>
          </div>
        </div>
      </UCard>

      <!-- Game Area -->
      <div class="lg:col-span-2 flex flex-col gap-4">

        <!-- Game display -->
        <UCard :ui="{ body: 'relative overflow-hidden min-h-[360px] flex flex-col p-6' }">
          <!-- History pills -->
          <div class="flex gap-1.5 flex-wrap mb-3 min-h-[26px]">
            <TransitionGroup name="pill-slide">
              <span
                v-for="(h, i) in history"
                :key="i"
                class="inline-flex items-center px-2 py-1 rounded text-xs font-mono font-bold"
                :class="h.won ? 'bg-success/20 text-success' : 'bg-elevated text-muted'"
              >{{ h.roll.toFixed(2) }}</span>
            </TransitionGroup>
          </div>

          <!-- Big roll display -->
          <div class="flex-1 flex flex-col items-center justify-center gap-5 relative z-10 w-full max-w-2xl mx-auto">
            <div
              class="text-8xl md:text-[140px] font-black font-mono tabular-nums leading-none select-none transition-colors duration-300"
              :class="[
                isFetching ? 'text-muted' : '',
                (isRolling && !isFetching) ? 'text-highlighted' : '',
                !isRolling && !lastResult ? 'text-highlighted' : '',
                !isRolling && lastResult?.won ? 'text-success' : '',
                !isRolling && lastResult && !lastResult.won ? 'text-error' : '',
              ]"
            >
              <span v-if="isFetching" class="animate-pulse opacity-50">...</span>
              <span v-else>{{ displayRoll !== null ? displayRoll.toFixed(2) : '50.00' }}</span>
            </div>

            <!-- Result bar -->
            <div class="w-full">
              <div class="relative h-4 md:h-6 rounded-full overflow-hidden flex">
                <div
                  class="h-full transition-colors duration-300"
                  :class="!isRolling && lastResult?.won ? 'bg-success' : 'bg-success/30'"
                  :style="{ width: `${winChance}%` }"
                />
                <div
                  class="h-full flex-1 transition-colors duration-300"
                  :class="!isRolling && lastResult && !lastResult.won ? 'bg-error/40' : 'bg-elevated'"
                />
              </div>

              <div class="relative h-0" v-if="displayRoll !== null">
                <div
                  class="absolute -top-6 md:-top-8 w-1 h-8 md:h-10 rounded-full pointer-events-none transition-colors duration-300"
                  :class="isRolling ? 'bg-inverted' : lastResult?.won ? 'bg-success' : 'bg-error'"
                  :style="{ left: `clamp(2px, ${displayRoll}%, calc(100% - 4px))` }"
                />
              </div>

              <div class="flex justify-between text-xs text-muted font-mono mt-4">
                <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
              </div>
            </div>

            <div class="text-muted font-mono bg-elevated/50 px-4 py-2 rounded-full border border-default text-sm">
              Target: <span class="font-bold">&lt; {{ winChance.toFixed(2) }}</span>
            </div>

            <div
              class="text-success font-black text-2xl md:text-3xl whitespace-nowrap"
              :class="!isRolling && lastResult?.won ? 'opacity-100 transition-opacity duration-200' : 'opacity-0'"
            >
              +${{ formatNumber((lastResult?.payout ?? 0), false) }}
            </div>
          </div>

          <!-- Rolling pulse overlay -->
          <div
            class="absolute inset-0 pointer-events-none transition-opacity duration-300"
            :class="isRolling ? 'opacity-10 animate-pulse bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent' : 'opacity-0'"
          />
        </UCard>

        <!-- Play Button -->
        <UCard>
          <div class="flex items-center gap-4">
            <UButton
              block
              :loading="isRolling"
              :disabled="balance < bet"
              color="primary"
              size="xl"
              class="flex-1 h-16 text-lg font-black uppercase tracking-widest transition-transform active:scale-[0.98]"
              @click="roll"
            >
              {{ isRolling ? 'Rolling...' : 'Play' }}
            </UButton>
            <div class="hidden sm:flex flex-col items-end px-4 text-sm font-mono text-muted whitespace-nowrap">
              <span>Press <kbd class="px-2 py-1 bg-elevated rounded text-xs font-sans font-bold border border-default">SPACE</kbd></span>
            </div>
          </div>
        </UCard>

      </div>
    </div>

    <GameHelpModal v-model:open="showHelp" title="How Dice works">
      <li>A random number between 0 and 100 is rolled.</li>
      <li>You win if the result is <strong class="text-default">below your win chance</strong>.</li>
      <li>Lower win chance → higher multiplier.</li>
      <li>Multiplier = 98 ÷ win chance.</li>
    </GameHelpModal>
  </div>
</template>

<style scoped>
.fade-up-enter-active, .fade-up-leave-active { transition: all 0.2s ease; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(5px); }

.pill-slide-enter-active { transition: all 0.25s ease; }
.pill-slide-enter-from { opacity: 0; transform: translateX(-8px); }

input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
</style>
