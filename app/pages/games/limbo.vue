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
  <div class="min-h-screen bg-background flex flex-col p-4 lg:p-8">
    <div class="w-full max-w-6xl mx-auto flex flex-col gap-4">

      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-black tracking-tight flex items-center gap-2">
            <span class="text-primary">Limbo</span>
          </h1>
          <p class="text-muted text-xs font-bold uppercase tracking-[0.2em] mt-1">98% RTP</p>
        </div>
      </div>

      <div class="flex flex-col lg:flex-row gap-4">

        <!-- LEFT: Controls -->
        <div class="w-full lg:w-[320px] shrink-0 bg-elevated border border-default rounded-2xl p-4 flex flex-col gap-4">

          <!-- Bet Amount -->
          <div class="bg-background rounded-xl p-3 border border-default">
            <div class="flex justify-between items-center mb-2">
              <span class="text-muted text-xs font-bold uppercase tracking-wider">Bet Amount</span>
            </div>
            <div class="flex items-center gap-2">
              <UInput v-model.number="bet" type="number" min="1" :disabled="isRolling" class="flex-1 font-mono" size="lg" />
              <div class="flex gap-1">
                <UButton color="neutral" variant="soft" :disabled="isRolling" @click="bet = Math.max(1, Math.floor(bet / 2))">½</UButton>
                <UButton color="neutral" variant="soft" :disabled="isRolling" @click="bet = bet * 2">2×</UButton>
              </div>
            </div>
          </div>

          <!-- Target Multiplier -->
          <div class="bg-background rounded-xl p-3 border border-default">
            <p class="text-muted text-xs font-bold uppercase tracking-wider mb-2">Target Multiplier</p>
            <div class="relative">
              <input
                v-model.number="target"
                :disabled="isRolling"
                type="number" min="1.01" max="10000" step="0.01"
                class="w-full bg-elevated border border-default rounded-lg px-3 py-2 font-bold font-mono text-lg focus:outline-none focus:border-primary/60 [appearance:textfield] disabled:opacity-40 transition-colors"
                @change="target = clampTarget(Number(target))"
              />
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-muted font-bold pointer-events-none">×</span>
            </div>
            <div class="grid grid-cols-5 gap-1.5 mt-2">
              <UButton
                v-for="t in [1.5, 2, 3, 5, 10, 100, 500, 1000, 5000, 10000]"
                :key="t"
                variant="ghost" color="neutral" size="2xs"
                :disabled="isRolling"
                class="justify-center font-mono text-[10px]"
                :class="target === t ? 'bg-primary/20 text-primary hover:bg-primary/30' : 'bg-elevated hover:bg-default'"
                @click="target = t"
              >{{ t >= 1000 ? (t/1000) + 'k' : t }}×</UButton>
            </div>
          </div>

          <!-- Stats -->
          <div class="bg-background rounded-xl p-3 border border-default flex flex-col gap-2">
            <div class="flex justify-between items-center">
              <span class="text-muted text-xs font-bold uppercase tracking-wider">Win Chance</span>
              <span class="font-mono font-bold">{{ winChance.toFixed(2) }}%</span>
            </div>
            <div class="flex justify-between items-center pt-2 border-t border-default">
              <span class="text-muted text-xs font-bold uppercase tracking-wider">Payout on Win</span>
              <span class="font-mono font-bold text-success">${{ formatNumber(totalPayout, false) }}</span>
            </div>
          </div>

          <!-- Error -->
          <Transition name="fade-up">
            <UAlert v-if="errorMsg" color="error" variant="soft" :description="errorMsg"
              :close-button="{ icon: 'i-lucide-x', color: 'neutral', variant: 'ghost' }" @close="errorMsg = ''" />
          </Transition>

          <div class="mt-auto bg-background rounded-xl p-3 border border-default flex justify-between items-center">
            <span class="text-muted text-xs font-bold uppercase tracking-wider">Balance</span>
            <span class="font-mono font-bold text-primary">${{ formatNumber(balance, false) }}</span>
          </div>

        </div>

        <!-- RIGHT: Game Area -->
        <div class="flex-1 flex flex-col gap-4">

          <!-- Game display -->
          <div class="bg-[#0f172a] border border-[#1e293b] rounded-2xl p-6 flex flex-col relative overflow-hidden min-h-[400px]">

            <!-- History pills -->
            <div class="absolute top-4 right-4 flex gap-1.5 flex-wrap justify-end max-w-[60%]">
              <TransitionGroup name="pill-slide">
                <span
                  v-for="(h, i) in history"
                  :key="i"
                  class="inline-flex items-center px-2 py-1 rounded text-xs font-mono font-bold"
                  :class="h.won ? 'bg-success/20 text-success' : 'bg-default/50 text-muted'"
                >{{ h.result.toFixed(2) }}×</span>
              </TransitionGroup>
            </div>

            <!-- Main animation area -->
            <div class="flex-1 flex flex-col items-center justify-center relative z-10">
              <div
                class="text-8xl md:text-[140px] font-black font-mono tabular-nums leading-none tracking-tighter"
                :class="[
                  isFetching ? 'text-muted' : '',
                  (isRolling && !isFetching) ? 'text-white' : '',
                  !isRolling && !lastResult ? 'text-white' : '',
                  !isRolling && lastResult?.won ? 'text-success drop-shadow-[0_0_30px_rgba(34,197,94,0.4)]' : '',
                  !isRolling && lastResult && !lastResult.won ? 'text-error drop-shadow-[0_0_30px_rgba(239,68,68,0.4)]' : '',
                ]"
              >
                <span v-if="isFetching" class="animate-pulse opacity-50">...</span>
                <template v-else>
                  <span>{{ displayResult !== null ? (displayResult >= 1000 ? displayResult.toFixed(0) : displayResult.toFixed(2)) : '1.00' }}</span>
                  <span class="text-4xl md:text-6xl align-top ml-2 text-muted-foreground/50">×</span>
                </template>
              </div>

              <div class="mt-6 text-muted font-mono bg-black/20 px-4 py-2 rounded-full border border-white/5">
                Target: <span class="text-white font-bold">{{ target.toFixed(2) }}×</span>
              </div>

              <Transition name="fade-up">
                <div v-if="!isRolling && lastResult?.won" class="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-24 md:translate-y-32 text-success font-black text-3xl md:text-4xl drop-shadow-[0_0_15px_rgba(34,197,94,0.5)] z-20 whitespace-nowrap pointer-events-none">
                  +${{ formatNumber(lastResult.payout - lastBet, false) }}
                </div>
              </Transition>
            </div>

            <!-- Decorative background elements -->
            <div class="absolute inset-0 pointer-events-none opacity-20"
                 :class="isRolling ? 'animate-pulse bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent' : ''">
            </div>

          </div>

          <!-- Play Button below game -->
          <div class="bg-elevated border border-default rounded-2xl p-4 flex items-center gap-4">
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
              <span>Press <kbd class="px-2 py-1 bg-default rounded text-xs font-sans font-bold">SPACE</kbd></span>
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
