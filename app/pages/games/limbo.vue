<script setup lang="ts">
import type { LimboResult } from '#shared/utils/gamelogic/limbo'

const { user, setBalance } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))
watch(() => user.value?.balance, v => { if (v !== undefined) balance.value = parseFloat(v ?? '0') })

const bet = ref(10)
const target = ref(2)
const isRolling = ref(false)
const isFetching = ref(false)
const lastResult = ref<LimboResult | null>(null)
const lastBet = ref(0)
const animResult = ref<number | null>(null)
const history = ref<{ result: number; won: boolean; payout: number; target: number; bet: number }[]>([])
const errorMsg = ref('')

const winChance = computed(() => Math.min(98 / target.value, 98))
const totalPayout = computed(() => bet.value * target.value)
const displayResult = computed(() => animResult.value ?? lastResult.value?.result ?? null)

function clampTarget(v: number) {
  return Math.round(Math.min(10000, Math.max(1.01, v)) * 100) / 100
}

let animTimer: ReturnType<typeof setTimeout> | null = null

async function roll() {
  if (isRolling.value || balance.value < bet.value) return
  isRolling.value = true
  isFetching.value = true
  lastResult.value = null
  errorMsg.value = ''
  lastBet.value = bet.value

  try {
    const data = await $fetch('/api/games/play-game', {
      method: 'POST',
      body: { bet: bet.value, game: 'limbo', options: { target: target.value } }
    }) as { gameData: LimboResult; balance: number }

    isFetching.value = false
    const finalResult = data.gameData.result
    const duration = 600
    const startTime = Date.now()
    animResult.value = 0

    const animate = () => {
      const t = Math.min(1, (Date.now() - startTime) / duration)
      const ease = 1 - Math.pow(1 - t, 3)
      animResult.value = parseFloat((finalResult * ease).toFixed(2))
      if (t < 1) {
        animTimer = setTimeout(animate, 16)
      } else {
        animResult.value = null
        lastResult.value = data.gameData
        balance.value = data.balance
        setBalance(data.balance)
        history.value.unshift({ result: data.gameData.result, won: data.gameData.won, payout: data.gameData.payout, target: target.value, bet: lastBet.value })
        if (history.value.length > 8) history.value.pop()
        isRolling.value = false
      }
    }
    animate()
  } catch (e: unknown) {
    isFetching.value = false
    isRolling.value = false
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
  }
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
  <div class="min-h-screen bg-background flex items-center justify-center p-4 lg:p-8">
    <div class="w-full max-w-5xl flex flex-col gap-5">

      <!-- Header -->
      <div>
        <h1 class="text-4xl font-black tracking-tight">Limbo</h1>
        <p class="text-muted font-medium uppercase tracking-[0.2em] mt-1">98% RTP · Roll Over</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">

        <!-- LEFT: Controls -->
        <div class="bg-elevated border border-default rounded-2xl p-5 flex flex-col gap-5">

          <!-- Bet Amount -->
          <div>
            <p class="text-muted text-xs uppercase font-semibold tracking-wider mb-2">Bet Amount</p>
            <div class="flex items-center gap-2">
              <UButton variant="outline" color="neutral" :disabled="isRolling" @click="bet = Math.max(1, Math.floor(bet / 2))">½</UButton>
              <UInput v-model.number="bet" type="number" min="1" :disabled="isRolling" class="flex-1" :ui="{ base: 'text-center font-mono' }" />
              <UButton variant="outline" color="neutral" :disabled="isRolling" @click="bet = bet * 2">2×</UButton>
            </div>
          </div>

          <!-- Target Multiplier -->
          <div>
            <p class="text-muted text-xs uppercase font-semibold tracking-wider mb-2">Target Multiplier</p>
            <div class="relative">
              <input
                v-model.number="target"
                :disabled="isRolling"
                type="number" min="1.01" max="10000" step="0.01"
                class="w-full bg-background border border-muted rounded-xl px-4 pr-10 py-3 font-black font-mono text-2xl text-center focus:outline-none focus:border-primary/60 [appearance:textfield] disabled:opacity-40 transition-colors"
                @change="target = clampTarget(Number(target))"
              />
              <span class="absolute right-4 top-1/2 -translate-y-1/2 text-muted font-bold text-xl pointer-events-none">×</span>
            </div>
            <div class="flex gap-1.5 mt-2 flex-wrap">
              <UButton
                v-for="t in [1.5, 2, 3, 5, 10, 100, 500, 1000, 5000, 10_000]"
                :key="t"
                variant="outline" color="neutral" size="xs"
                :disabled="isRolling"
                :class="target === t ? 'ring-1 ring-primary border-primary' : ''"
                @click="target = t"
              >{{ t }}×</UButton>
            </div>
          </div>

          <!-- Stats -->
          <div class="flex flex-col gap-2">
            <div class="flex justify-between items-center py-2 border-b border-default">
              <span class="text-muted text-sm">Win Chance</span>
              <span class="font-mono font-semibold">{{ winChance.toFixed(2) }}%</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b border-default">
              <span class="text-muted text-sm">Multiplier</span>
              <span class="font-mono font-semibold">{{ target.toFixed(2) }}×</span>
            </div>
            <div class="flex justify-between items-center py-2">
              <span class="text-muted text-sm">Payout if Win</span>
              <span class="font-mono font-bold text-success">${{ formatNumber(totalPayout, false) }}</span>
            </div>
          </div>

          <!-- Error -->
          <Transition name="fade-up">
            <UAlert v-if="errorMsg" color="error" variant="soft" :description="errorMsg"
              :close-button="{ icon: 'i-lucide-x', color: 'neutral', variant: 'ghost' }" @close="errorMsg = ''" />
          </Transition>

        </div>

        <!-- RIGHT: Game display + Play -->
        <div class="bg-elevated border border-default rounded-2xl p-5 flex flex-col gap-4">

          <!-- History pills -->
          <div class="flex gap-1.5 flex-wrap min-h-[26px] overflow-hidden">
            <TransitionGroup name="pill-slide">
              <span
                v-for="(h, i) in history"
                :key="i"
                class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold border"
                :class="h.won ? 'bg-success/10 border-success/25 text-success' : 'bg-error/8 border-error/20 text-error'"
              >{{ h.won ? '+' : '-' }}${{ formatNumber(h.won ? h.payout : h.bet, false) }}</span>
            </TransitionGroup>
          </div>

          <!-- Big result display -->
          <div class="flex-1 flex flex-col items-center justify-center gap-3 py-10">
            <div
              class="text-8xl font-black font-mono tabular-nums leading-none select-none"
              :class="[
                isFetching ? 'text-muted' : '',
                (isRolling && !isFetching) ? 'text-highlighted' : '',
                !isRolling && !lastResult ? 'text-highlighted' : '',
                !isRolling && lastResult?.won ? 'text-success' : '',
                !isRolling && lastResult && !lastResult.won ? 'text-error' : '',
              ]"
            >
              <span v-if="isFetching" class="animate-pulse">···</span>
              <template v-else>
                <span>{{ displayResult !== null ? (displayResult >= 1000 ? displayResult.toFixed(0) : displayResult.toFixed(2)) : '—' }}</span>
                <span v-if="displayResult !== null" class="text-5xl align-baseline">×</span>
              </template>
            </div>

            <!-- Win target indicator -->
            <p class="text-muted text-sm font-mono">
              Win if rolled ≥ <span class="text-default font-semibold">{{ target.toFixed(2) }}×</span>
            </p>

            <!-- Win / loss feedback -->
            <div class="h-20 flex flex-col items-center justify-center">
              <Transition name="win-reveal">
                <div v-if="lastResult?.won && !isRolling" class="flex flex-col items-center gap-0.5 text-center">
                  <p class="text-success text-xs font-bold uppercase tracking-[0.3em]">You Won</p>
                  <p class="text-success text-5xl font-black font-mono leading-tight">
                    +${{ formatNumber(lastResult.payout, false) }}
                  </p>
                  <p class="text-muted text-xs font-mono mt-0.5">
                    {{ lastResult.target.toFixed(2) }}× on ${{ formatNumber(lastBet, false) }} bet
                  </p>
                </div>
                <div v-else-if="lastResult && !lastResult.won && !isRolling" class="flex flex-col items-center gap-1">
                  <p class="text-error text-xs font-bold uppercase tracking-[0.3em]">No Luck</p>
                  <p class="text-muted font-mono text-3xl">-${{ formatNumber(lastBet, false) }}</p>
                </div>
              </Transition>
            </div>
          </div>

          <!-- Roll button + balance -->
          <div class="flex flex-col gap-2">
            <UButton
              block
              :loading="isRolling"
              :disabled="balance < bet"
              color="primary"
              size="xl"
              class="font-bold tracking-wider"
              @click="roll"
            >
              {{ isRolling ? 'Rolling…' : 'Roll' }}
            </UButton>
            <div class="flex justify-between items-center text-sm px-0.5">
              <span class="text-muted">Balance <span class="font-mono font-semibold text-default">${{ formatNumber(balance, false) }}</span></span>
              <span class="text-muted/40 text-xs">Space to roll</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-up-enter-active, .fade-up-leave-active { transition: all 0.2s ease; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(5px); }

.win-reveal-enter-active { transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.win-reveal-leave-active { transition: all 0.15s ease; }
.win-reveal-enter-from { opacity: 0; transform: scale(0.85) translateY(8px); }
.win-reveal-leave-to { opacity: 0; transform: scale(0.95); }

.pill-slide-enter-active { transition: all 0.25s ease; }
.pill-slide-enter-from { opacity: 0; transform: translateX(-8px); }

input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
</style>
