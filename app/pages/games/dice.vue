<script setup lang="ts">
import type { DiceResult } from '#shared/utils/gamelogic/dice'

const { user, setBalance } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))
watch(() => user.value?.balance, v => { if (v !== undefined) balance.value = parseFloat(v ?? '0') })

const bet = ref(10)
const winChance = ref(50)
const isRolling = ref(false)
const isFetching = ref(false)
const lastResult = ref<DiceResult | null>(null)
const lastBet = ref(0)
const animRoll = ref<number | null>(null)
const history = ref<{ roll: number; won: boolean; payout: number; multiplier: number; bet: number }[]>([])
const errorMsg = ref('')

const multiplier = computed(() => 98 / winChance.value)
const totalPayout = computed(() => bet.value * multiplier.value)
const displayRoll = computed(() => animRoll.value ?? lastResult.value?.roll ?? null)

function clampWC(v: number) {
  return Math.round(Math.min(96, Math.max(2, v)) * 10) / 10
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
      body: { bet: bet.value, game: 'dice', options: { winChance: winChance.value } }
    }) as { gameData: DiceResult; balance: number }

    isFetching.value = false
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
        balance.value = data.balance
        setBalance(data.balance)
        history.value.unshift({ roll: data.gameData.roll, won: data.gameData.won, payout: data.gameData.payout, multiplier: data.gameData.multiplier, bet: lastBet.value })
        if (history.value.length > 8) history.value.pop()
        isRolling.value = false
      }
    }
    countUp()
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
            <span class="text-primary">Dice</span>
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
              <span class="text-muted text-xs font-mono">${{ formatNumber(balance, false) }}</span>
            </div>
            <div class="flex items-center gap-2">
              <UInput v-model.number="bet" type="number" min="1" :disabled="isRolling" class="flex-1 font-mono" size="lg" />
              <div class="flex gap-1">
                <UButton color="neutral" variant="soft" :disabled="isRolling" @click="bet = Math.max(1, Math.floor(bet / 2))">½</UButton>
                <UButton color="neutral" variant="soft" :disabled="isRolling" @click="bet = bet * 2">2×</UButton>
              </div>
            </div>
          </div>

          <!-- Win Chance -->
          <div class="bg-background rounded-xl p-3 border border-default">
            <div class="flex justify-between items-center mb-2">
              <span class="text-muted text-xs font-bold uppercase tracking-wider">Win Chance</span>
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
              class="w-full accent-primary disabled:opacity-40 mt-2"
              @input="winChance = clampWC(Number(winChance))"
            />

            <div class="flex justify-between text-[10px] text-muted font-mono uppercase font-bold mt-2">
              <span>Win &lt; {{ winChance.toFixed(1) }}</span>
              <span>Lose &ge; {{ winChance.toFixed(1) }}</span>
            </div>
          </div>

          <!-- Stats -->
          <div class="bg-background rounded-xl p-3 border border-default flex flex-col gap-2">
            <div class="flex justify-between items-center">
              <span class="text-muted text-xs font-bold uppercase tracking-wider">Multiplier</span>
              <span class="font-mono font-bold">{{ multiplier.toFixed(4) }}×</span>
            </div>
            <div class="flex justify-between items-center pt-2 border-t border-default">
              <span class="text-muted text-xs font-bold uppercase tracking-wider">Payout on Win</span>
              <span class="font-mono font-bold text-success">${{ formatNumber(totalPayout, false) }}</span>
            </div>
          </div>

          <!-- Error -->
          <Transition name="fade-up">
            <UAlert v-if="errorMsg" color="error" variant="soft" :description="errorMsg"
              :close-button="{ icon: 'i-lucide-x', color: 'neutral', variant: 'ghost' }" @close="errorMsg = ''" class="mt-auto" />
          </Transition>

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
                >{{ h.roll.toFixed(2) }}</span>
              </TransitionGroup>
            </div>

            <!-- Big roll display -->
            <div class="flex-1 flex flex-col items-center justify-center gap-8 relative z-10 w-full max-w-2xl mx-auto">

              <div
                class="text-8xl md:text-[140px] font-black font-mono tabular-nums leading-none select-none transition-colors duration-300"
                :class="[
                  isFetching ? 'text-muted' : '',
                  (isRolling && !isFetching) ? 'text-white' : '',
                  !isRolling && !lastResult ? 'text-white' : '',
                  !isRolling && lastResult?.won ? 'text-success drop-shadow-[0_0_30px_rgba(34,197,94,0.4)]' : '',
                  !isRolling && lastResult && !lastResult.won ? 'text-error drop-shadow-[0_0_30px_rgba(239,68,68,0.4)]' : '',
                ]"
              >
                <span v-if="isFetching" class="animate-pulse opacity-50">...</span>
                <span v-else>{{ displayRoll !== null ? displayRoll.toFixed(2) : '50.00' }}</span>
              </div>

              <Transition name="fade-up">
                <div v-if="!isRolling && lastResult?.won" class="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-32 md:translate-y-38 text-success font-black text-3xl md:text-4xl drop-shadow-[0_0_15px_rgba(34,197,94,0.5)] z-20 whitespace-nowrap pointer-events-none">
                  +${{ formatNumber(lastResult.payout - lastBet, false) }}
                </div>
              </Transition>

              <!-- Result bar -->
              <div class="w-full">
                <div class="relative h-4 md:h-6 rounded-full overflow-hidden flex shadow-inner">
                  <!-- Win zone -->
                  <div
                    class="h-full transition-[width] duration-150 transition-colors duration-300"
                    :class="!isRolling && lastResult?.won ? 'bg-success' : 'bg-success/30'"
                    :style="{ width: `${winChance}%` }"
                  />
                  <!-- Lose zone -->
                  <div
                    class="h-full flex-1 transition-colors duration-300"
                    :class="!isRolling && lastResult && !lastResult.won ? 'bg-error/40' : 'bg-white/10'"
                  />
                </div>

                <!-- Roll position marker -->
                <div class="relative h-0" v-if="displayRoll !== null">
                  <div
                    class="absolute -top-6 md:-top-8 w-1 h-8 md:h-10 rounded-full pointer-events-none transition-colors duration-300 shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                    :class="isRolling ? 'bg-white' : lastResult?.won ? 'bg-success' : 'bg-error'"
                    :style="{ left: `clamp(2px, ${displayRoll}%, calc(100% - 4px))` }"
                  />
                </div>

                <div class="flex justify-between text-xs text-muted font-mono mt-4 font-bold">
                  <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
                </div>
              </div>

              <div class="text-muted font-mono bg-black/20 px-4 py-2 rounded-full border border-white/5">
                Target: <span class="text-white font-bold">&lt; {{ winChance.toFixed(2) }}</span>
              </div>

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
