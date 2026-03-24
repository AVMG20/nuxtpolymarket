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
const animRoll = ref<number | null>(null)
const history = ref<{ roll: number; won: boolean; payout: number; multiplier: number; bet: number }[]>([])
const errorMsg = ref('')

const multiplier = computed(() => 98 / winChance.value)
const profitOnWin = computed(() => (multiplier.value - 1) * bet.value)
const displayRoll = computed(() => animRoll.value ?? lastResult.value?.roll ?? null)

// --- Slider drag ---
const barRef = ref<HTMLElement | null>(null)
let isDragging = false

function clampWC(v: number) {
  return Math.round(Math.min(96, Math.max(2, v)) * 10) / 10
}

function updateWCFromPointer(e: PointerEvent) {
  if (!barRef.value) return
  const { left, width } = barRef.value.getBoundingClientRect()
  winChance.value = clampWC(((e.clientX - left) / width) * 100)
}

function onPointerDown(e: PointerEvent) {
  if (isRolling.value) return
  isDragging = true
  barRef.value?.setPointerCapture(e.pointerId)
  updateWCFromPointer(e)
}
function onPointerMove(e: PointerEvent) { if (isDragging) updateWCFromPointer(e) }
function onPointerUp(e: PointerEvent) {
  isDragging = false
  barRef.value?.releasePointerCapture(e.pointerId)
}

// --- Roll with smooth count-up animation ---
let animTimer: ReturnType<typeof setTimeout> | null = null

async function roll() {
  if (isRolling.value || balance.value < bet.value) return
  isRolling.value = true
  isFetching.value = true
  lastResult.value = null
  errorMsg.value = ''

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
        history.value.unshift({
          roll: data.gameData.roll,
          won: data.gameData.won,
          payout: data.gameData.payout,
          multiplier: data.gameData.multiplier,
          bet: bet.value
        })
        if (history.value.length > 10) history.value.pop()
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
  <div class="min-h-screen bg-background flex items-center justify-center p-4 lg:p-8">
    <div class="flex items-start gap-5 w-full max-w-3xl">

      <!-- Game card -->
      <div class="flex-1 flex flex-col gap-6 min-w-0">

        <!-- Header -->
        <div>
          <h1 class="text-4xl font-black tracking-tight">Dice</h1>
          <p class="text-muted font-medium uppercase tracking-[0.2em] mt-1">98% RTP · Roll Under</p>
        </div>

        <div class="bg-elevated border border-default rounded-2xl p-5 flex flex-col gap-5 shadow-xl">

          <!-- Result display -->
          <div class="flex flex-col items-center gap-3 py-1">
            <div
              class="text-6xl font-black font-mono tabular-nums leading-none transition-colors duration-300 h-[1.15em] flex items-center"
              :class="[
                isFetching ? 'text-muted' : '',
                (isRolling && !isFetching) || (!isRolling && !lastResult) ? 'text-highlighted' : ''
              ]"
            >
              <span v-if="isFetching" class="animate-pulse tracking-widest text-4xl">···</span>
              <span v-else>{{ displayRoll !== null ? displayRoll.toFixed(2) : '—' }}</span>
            </div>

            <!-- Win / loss feedback -->
            <div class="min-h-[4.5rem] flex flex-col items-center justify-center">
              <Transition name="win-reveal">
                <div v-if="lastResult?.won && !isRolling" class="flex flex-col items-center gap-0.5 text-center">
                  <p class="text-success font-bold uppercase tracking-[0.25em]">You Won</p>
                  <p class="text-success text-4xl font-black font-mono leading-tight">
                    +${{ formatNumber(lastResult.payout - bet) }}
                  </p>
                </div>
                <div v-else-if="lastResult && !lastResult.won && !isRolling" class="flex flex-col items-center gap-0.5">
                  <p class="text-error font-bold uppercase tracking-[0.25em]">No Luck</p>
                  <p class="text-muted font-mono">-${{ bet.toFixed(2) }}</p>
                </div>
              </Transition>
            </div>
          </div>

          <!-- Interactive progress bar -->
          <div class="select-none">
            <div class="flex justify-between text-muted font-mono mb-2 px-0.5">
              <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
            </div>

            <div
              ref="barRef"
              class="relative h-8 rounded-full touch-none"
              :class="isRolling ? 'cursor-default' : 'cursor-col-resize'"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
            >
              <div class="absolute inset-0 rounded-full overflow-hidden flex">
                <div
                  class="h-full transition-[width] duration-75"
                  :class="!isRolling && lastResult?.won ? 'bg-success' : 'bg-success/35'"
                  :style="{ width: `${winChance}%` }"
                />
                <div
                  class="h-full flex-1 transition-colors duration-300"
                  :class="!isRolling && lastResult && !lastResult.won ? 'bg-error/50' : 'bg-default'"
                />
              </div>

              <div
                v-if="displayRoll !== null"
                class="absolute inset-y-0 w-0.5 rounded-full z-20 pointer-events-none transition-colors duration-300"
                :class="isRolling ? 'bg-primary/50' : lastResult?.won ? 'bg-success' : 'bg-error'"
                :style="{ left: `clamp(1px, ${displayRoll}%, calc(100% - 2px))` }"
              />

              <div
                class="absolute top-1/2 z-30 -translate-y-1/2 pointer-events-none transition-[left] duration-75"
                :style="{ left: `${winChance}%` }"
              >
                <div class="w-5 h-5 -translate-x-1/2 rounded-full bg-background border-2 border-default shadow-lg ring-1 ring-white/10" />
              </div>
            </div>

            <div class="flex justify-between font-mono mt-1.5 px-0.5">
              <span class="text-success/70">Win &lt; {{ winChance.toFixed(1) }}</span>
              <span class="text-error/60">Lose ≥ {{ winChance.toFixed(1) }}</span>
            </div>
          </div>

          <!-- Stats -->
          <div class="grid grid-cols-3 gap-2">
            <div class="bg-background rounded-xl border border-default p-3">
              <p class="text-muted text-xs uppercase font-semibold tracking-wider mb-1.5">Win Chance</p>
              <div class="flex items-baseline gap-0.5">
                <input
                  v-model.number="winChance"
                  :disabled="isRolling"
                  type="number" min="2" max="96" step="0.1"
                  class="bg-transparent font-bold font-mono w-full focus:outline-none [appearance:textfield] disabled:opacity-40"
                  @change="winChance = clampWC(Number(winChance))"
                />
                <span class="text-muted shrink-0">%</span>
              </div>
            </div>
            <div class="bg-background rounded-xl border border-default p-3">
              <p class="text-muted text-xs uppercase font-semibold tracking-wider mb-1.5">Multiplier</p>
              <p class="font-bold font-mono">{{ multiplier.toFixed(4) }}×</p>
            </div>
            <div class="bg-background rounded-xl border border-default p-3">
              <p class="text-muted text-xs uppercase font-semibold tracking-wider mb-1.5">Profit</p>
              <p class="text-success font-bold font-mono">${{ formatNumber(profitOnWin, false) }}</p>
            </div>
          </div>

          <!-- Bet -->
          <div>
            <p class="text-muted text-xs uppercase font-semibold tracking-wider mb-2">Bet Amount</p>
            <div class="flex items-center gap-2">
              <UButton variant="outline" color="neutral" :disabled="isRolling" @click="bet = Math.max(1, Math.floor(bet / 2))">½</UButton>
              <UInput
                v-model.number="bet"
                type="number" min="1"
                :disabled="isRolling"
                class="flex-1"
                :ui="{ base: 'text-center font-mono' }"
              />
              <UButton variant="outline" color="neutral" :disabled="isRolling" @click="bet = bet * 2">2×</UButton>
            </div>
          </div>

          <!-- Error -->
          <Transition name="fade-up">
            <UAlert
              v-if="errorMsg"
              color="error" variant="soft"
              :description="errorMsg"
              :close-button="{ icon: 'i-lucide-x', color: 'neutral', variant: 'ghost' }"
              @close="errorMsg = ''"
            />
          </Transition>

          <!-- Roll button -->
          <UButton
            block
            :loading="isRolling"
            :disabled="balance < bet"
            color="primary"
            class="font-bold tracking-wider"
            @click="roll"
          >
            {{ isRolling ? 'Rolling…' : 'Roll Dice' }}
          </UButton>

          <!-- Balance + hint -->
          <div class="flex justify-between items-center">
            <span class="text-muted">Balance  <span class="font-mono font-semibold text-default">${{ formatNumber(balance, false) }}</span></span>
            <span class="text-muted opacity-50">Space to roll</span>
          </div>
        </div>
      </div>

      <!-- History sidebar -->
      <div class="hidden lg:flex flex-col gap-3 w-44 shrink-0 pt-18">
        <p class="text-muted text-xs uppercase font-semibold tracking-wider">History</p>
        <div class="flex flex-col gap-1.5 max-h-150 overflow-y-auto overflow-x-hidden">
          <TransitionGroup name="history-slide">
            <div
              v-for="(h, i) in history"
              :key="i"
              class="flex items-center justify-between rounded-lg px-3 py-2 border"
              :class="h.won
                ? 'bg-success/10 border-success/20'
                : 'bg-error/5 border-error/15'"
            >
              <div class="flex items-center gap-2">
                <div class="w-1.5 h-1.5 rounded-full shrink-0" :class="h.won ? 'bg-success' : 'bg-error'" />
                <span class="font-mono font-semibold" :class="h.won ? 'text-success' : 'text-error'">
                  {{ h.won ? '+' : '-' }}${{ formatNumber(h.won ? h.payout - h.bet : h.bet, false) }}
                </span>
              </div>
            </div>
          </TransitionGroup>
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

.history-slide-enter-active { transition: all 0.3s ease; }
.history-slide-enter-from { opacity: 0; transform: translateX(12px); }

input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
</style>
