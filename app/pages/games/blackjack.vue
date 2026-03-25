<script setup lang="ts">
import type { BlackjackClientState, BlackjackAction, Card } from '#shared/utils/gamelogic/blackjack'
import { getHint } from '#shared/utils/gamelogic/blackjack'
import BlackjackCard from "~/components/games/blackjack/BlackjackCard.vue";

const { user, setBalance } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))
watch(() => user.value?.balance, v => { if (v !== undefined) balance.value = parseFloat(v ?? '0') })

const bet = ref(10)
const isPlaying = ref(false)
const isFetching = ref(false)
const errorMsg = ref('')
const gameToken = ref<string | null>(null)
const gameState = ref<BlackjackClientState | null>(null)
const history = ref<{ won: boolean; payout: number; bet: number }[]>([])
const showHint = ref(false)
const resumeChecked = ref(false)
const showResults = ref(false)

const phase = computed(() => gameState.value?.phase ?? 'betting')
const currentHand = computed(() => {
  if (!gameState.value) return null
  return gameState.value.playerHands[gameState.value.currentHandIndex] ?? null
})

const canHit = computed(() => phase.value === 'playing' && currentHand.value?.status === 'playing')
const canStand = computed(() => phase.value === 'playing' && currentHand.value?.status === 'playing')
const canDouble = computed(() => {
  if (phase.value !== 'playing' || !currentHand.value) return false
  return currentHand.value.status === 'playing' && currentHand.value.cards.length === 2 && balance.value >= currentHand.value.bet
})
const canSplit = computed(() => {
  if (phase.value !== 'playing' || !currentHand.value) return false
  const h = currentHand.value
  if (h.status !== 'playing' || h.cards.length !== 2) return false
  const v1 = cardValue(h.cards[0]!)
  const v2 = cardValue(h.cards[1]!)
  return v1 === v2 && balance.value >= h.bet
})
const canSurrender = computed(() => {
  if (phase.value !== 'playing' || !currentHand.value) return false
  return currentHand.value.status === 'playing' && currentHand.value.cards.length === 2
})

const hintAction = computed<BlackjackAction | null>(() => {
  if (phase.value !== 'playing' || !currentHand.value || !gameState.value) return null
  const dealerUpcard = gameState.value.dealerHand.cards[0]
  if (!dealerUpcard || dealerUpcard.isHidden) return null
  return getHint(currentHand.value, dealerUpcard, canDouble.value, canSurrender.value, canSplit.value)
})

const hintLabel = computed(() => {
  if (!hintAction.value) return ''
  const labels: Record<string, string> = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender' }
  return labels[hintAction.value] ?? hintAction.value
})

function cardValue(card: Card): number {
  if (['J', 'Q', 'K'].includes(card.rank)) return 10
  if (card.rank === 'A') return 11
  return parseInt(card.rank)
}

function scoreDisplay(cards: Card[]): string {
  const visible = cards.filter(c => !c.isHidden)
  let hard = 0
  let hasAce = false
  for (const card of visible) {
    if (card.rank === 'A') { hard += 1; hasAce = true }
    else if (['J', 'Q', 'K'].includes(card.rank)) hard += 10
    else hard += parseInt(card.rank)
  }
  const soft = hasAce && hard + 10 <= 21 ? hard + 10 : null
  return soft !== null ? `${hard}/${soft}` : `${hard}`
}


function statusLabel(status: string): string {
  switch (status) {
    case 'blackjack': return 'Blackjack!'
    case 'busted': return 'Bust'
    case 'won': return 'Won'
    case 'lost': return 'Lost'
    case 'push': return 'Push'
    case 'surrendered': return 'Surrendered'
    default: return ''
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'blackjack': case 'won': return 'text-success'
    case 'busted': case 'lost': case 'surrendered': return 'text-error'
    case 'push': return 'text-warning'
    default: return 'text-muted'
  }
}

// Resume active game on page load
onMounted(async () => {
  try {
    const data = await $fetch('/api/games/blackjack/resume') as {
      active: boolean; clientState: BlackjackClientState | null; token: string | null; balance: number
    }
    balance.value = data.balance
    setBalance(data.balance)
    if (data.active && data.clientState && data.token) {
      gameState.value = data.clientState
      gameToken.value = data.token
      isPlaying.value = true
    }
  } catch { /* ignore */ }
  resumeChecked.value = true
})

async function startGame() {
  if (isFetching.value || balance.value < bet.value) return
  isFetching.value = true
  isPlaying.value = true
  errorMsg.value = ''
  gameState.value = null

  try {
    const data = await $fetch('/api/games/blackjack/start', {
      method: 'POST',
      body: { bet: bet.value },
    }) as { clientState: BlackjackClientState; token: string | null; balance: number; finished: boolean }

    gameState.value = data.clientState
    gameToken.value = data.token
    balance.value = data.balance
    setBalance(data.balance)

    if (data.finished) {
      await animateDealerTurn(data.clientState)
    }
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
    isPlaying.value = false
  } finally {
    isFetching.value = false
  }
}

async function doAction(action: BlackjackAction) {
  if (isFetching.value || !gameToken.value) return
  isFetching.value = true
  errorMsg.value = ''

  try {
    const data = await $fetch('/api/games/blackjack/action', {
      method: 'POST',
      body: { token: gameToken.value, action },
    }) as { clientState: BlackjackClientState; token: string | null; balance: number; finished: boolean }

    gameToken.value = data.token
    balance.value = data.balance
    setBalance(data.balance)

    if (data.finished) {
      // Show player's resolved hand but keep dealer hole card hidden during the pause
      gameState.value = { ...data.clientState, dealerHand: gameState.value!.dealerHand }
      isFetching.value = false
      await sleep(800)
      await animateDealerTurn(data.clientState)
    } else {
      gameState.value = data.clientState
    }
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
  } finally {
    isFetching.value = false
  }
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function animateDealerTurn(finalState: BlackjackClientState) {
  const finalCards = finalState.dealerHand.cards

  // Step 1: reveal hole card (show only the 2 initial cards, all visible)
  gameState.value = {
    ...finalState,
    dealerHand: { ...finalState.dealerHand, cards: finalCards.slice(0, 2) },
  }

  const extraCards = finalCards.slice(2)

  if (extraCards.length > 0) {
    // Pause after reveal, then draw each extra card
    await sleep(800)
    for (let i = 0; i < extraCards.length; i++) {
      gameState.value = {
        ...finalState,
        dealerHand: { ...finalState.dealerHand, cards: finalCards.slice(0, 3 + i) },
      }
      await sleep(800)
    }
  } else {
    // No extra draws needed — short pause then finish
    await sleep(800)
  }

  gameState.value = finalState
  finishGame()
}

function finishGame() {
  if (!gameState.value) return
  const gs = gameState.value
  const totalBet = gs.playerHands.reduce((s, h) => s + h.bet, 0)
  const won = gs.playerHands.some(h => h.status === 'won' || h.status === 'blackjack')
  history.value.unshift({ won, payout: 0, bet: totalBet })
  if (history.value.length > 8) history.value.pop()
  gameToken.value = null
  setTimeout(() => { showResults.value = true }, 200)
}

function newGame() {
  gameState.value = null
  gameToken.value = null
  isPlaying.value = false
  showResults.value = false
}
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-spade" class="size-6 text-primary" />
        Blackjack
      </h1>
      <p class="text-sm text-muted mt-0.5">Classic 21 · 6-deck shoe</p>
    </div>

    <div class="grid lg:grid-cols-3 gap-6">

      <!-- Controls -->
      <UCard>
        <template #header>
          <h2 class="font-semibold">Controls</h2>
        </template>

        <div class="space-y-4">
          <!-- Bet Amount -->
          <div>
            <label class="text-xs text-muted uppercase tracking-wide font-medium block mb-1.5">Bet Amount</label>
            <div class="flex items-center gap-2">
              <UInput v-model.number="bet" type="number" min="1" :disabled="isPlaying && !showResults" class="flex-1 font-mono" size="lg" />
              <div class="flex gap-1">
                <UButton color="neutral" variant="soft" :disabled="isPlaying && !showResults" @click="bet = Math.max(1, Math.floor(bet / 2))">½</UButton>
                <UButton color="neutral" variant="soft" :disabled="isPlaying && !showResults" @click="bet = bet * 2">2×</UButton>
              </div>
            </div>
          </div>

          <!-- Strategy Hint -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs text-muted uppercase tracking-wide font-medium flex items-center gap-1.5 cursor-pointer" @click="showHint = !showHint">
                <UIcon name="i-lucide-lightbulb" class="size-3.5" />
                Strategy Hint
              </label>
              <USwitch v-model="showHint" size="sm" />
            </div>
          </div>

          <!-- Game Info -->
          <div v-if="gameState" class="rounded-lg bg-elevated border border-default p-3 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Phase</span>
              <span class="font-bold capitalize">{{ phase }}</span>
            </div>
            <USeparator />
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Dealer Score</span>
              <span class="font-bold tabular-nums">{{ scoreDisplay(gameState.dealerHand.cards) }}</span>
            </div>
            <USeparator />
            <div v-for="(hand, i) in gameState.playerHands" :key="hand.id" class="flex items-center justify-between text-sm">
              <span class="text-muted">Hand {{ i + 1 }} <span v-if="i === gameState.currentHandIndex && phase === 'playing'" class="text-primary">●</span></span>
              <span class="font-bold tabular-nums">{{ scoreDisplay(hand.cards) }}
                <span v-if="hand.status !== 'playing' && hand.status !== 'stood'" :class="statusColor(hand.status)" class="text-xs ml-1">{{ statusLabel(hand.status) }}</span>
              </span>
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

        <!-- Table -->
        <UCard :ui="{ body: 'relative overflow-hidden min-h-[460px] flex flex-col p-6' }" class="game-table">
          <!-- History pills -->
          <div class="flex gap-1.5 flex-wrap mb-3 min-h-[26px]">
            <TransitionGroup name="pill-slide">
              <span
                v-for="(h, i) in history"
                :key="i"
                class="inline-flex items-center px-2 py-1 rounded text-xs font-mono font-bold"
                :class="h.won ? 'bg-success/20 text-success' : 'bg-elevated text-muted'"
              >{{ h.won ? 'W' : 'L' }}</span>
            </TransitionGroup>
          </div>

          <!-- Loading state -->
          <div v-if="!resumeChecked" class="flex-1 flex items-center justify-center">
            <span class="text-muted animate-pulse">Loading...</span>
          </div>

          <!-- Betting state -->
          <div v-else-if="!gameState" class="flex-1 flex flex-col items-center justify-center gap-6">
            <div class="text-6xl select-none opacity-20 animate-bounce-short">🃏</div>
            <p class="text-muted text-lg">Place your bet to start</p>
          </div>

          <!-- Active game -->
          <div v-else class="flex-1 flex flex-col gap-6">
            <!-- Dealer hand -->
            <div>
              <div class="flex justify-center items-center gap-2 mb-3">
                <span class="font-bold tabular-nums text-sm">{{ scoreDisplay(gameState.dealerHand.cards) }}</span>
              </div>
              <div class="flex justify-center">
                <TransitionGroup name="deal-pop">
                  <div
                    v-for="(card, ci) in gameState.dealerHand.cards"
                    :key="`dealer-${ci}`"
                    class="card-container transition-all duration-500"
                    :style="{
                      marginLeft: ci > 0 ? '-3rem' : '0',
                      zIndex: ci,
                      transitionDelay: ci === 0 ? '150ms' : (ci === 1 ? '450ms' : '0ms')
                    }"
                  >
                    <BlackjackCard :card="card" />
                  </div>
                </TransitionGroup>
              </div>
            </div>

            <!-- Separator -->
            <div class="table-divider relative flex items-center gap-3 my-2 h-10">
              <div class="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div v-if="showResults" class="flex items-center gap-2">
                  <template v-for="hand in gameState.playerHands" :key="hand.id">
                    <div v-if="hand.status === 'won'" class="text-success font-bold flex items-center gap-1 text-base bg-success/15 px-3 py-1 rounded-full border border-success/20">
                      <UIcon name="i-lucide-coins" class="size-4" />
                      +{{ hand.bet * 2 }}
                    </div>
                    <div v-else-if="hand.status === 'blackjack'" class="text-success font-bold flex items-center gap-1 text-base bg-success/15 px-3 py-1 rounded-full border border-success/20">
                      <span class="text-xs text-success/70 font-medium uppercase tracking-wider mr-1">BJ</span>
                      <UIcon name="i-lucide-coins" class="size-4" />
                      +{{ hand.bet * 2.5 }}
                    </div>
                    <div v-else-if="hand.status === 'push'" class="text-warning font-bold flex items-center gap-1 text-base bg-warning/15 px-3 py-1 rounded-full border border-warning/20">
                      <UIcon name="i-lucide-coins" class="size-4" />
                      +{{ hand.bet }}
                    </div>
                    <div v-else-if="hand.status === 'surrendered'" class="text-error font-bold flex items-center gap-1 text-base bg-error/15 px-3 py-1 rounded-full border border-error/20">
                      <UIcon name="i-lucide-coins" class="size-4" />
                      -{{ Math.floor(hand.bet / 2) }}
                    </div>
                    <div v-else class="text-error font-bold flex items-center gap-1 text-base bg-error/15 px-3 py-1 rounded-full border border-error/20">
                      <UIcon name="i-lucide-coins" class="size-4" />
                      -{{ hand.bet }}
                    </div>
                  </template>
                </div>
                <span v-else class="text-[10px] text-muted/50 uppercase tracking-widest">vs</span>

              <div class="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>

            <!-- Player hands -->
            <div v-for="(hand, hi) in gameState.playerHands" :key="hand.id" class="player-hand-area transition-all duration-300" :class="{ 'player-hand-active': hi === gameState.currentHandIndex && phase === 'playing' }">
              <div class="flex justify-center items-center gap-2 mb-3">
                <span v-if="hi === gameState.currentHandIndex && phase === 'playing'" class="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span class="font-bold tabular-nums text-sm">{{ scoreDisplay(hand.cards) }}</span>

                <!-- Bet chip -->
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-warning/15 text-warning border border-warning/20">
                  <UIcon name="i-lucide-coins" class="size-3" />
                  {{ hand.bet }}
                </span>
              </div>
              <div class="flex justify-center mt-2">
                <TransitionGroup name="deal-pop">
                  <div
                    v-for="(card, ci) in hand.cards"
                    :key="`hand-${hi}-${ci}-${card.rank}-${card.suit}`"
                    class="card-container transition-all duration-500"
                    :style="{
                      marginLeft: ci > 0 ? '-3rem' : '0',
                      zIndex: ci,
                      transitionDelay: ci === 0 ? '0ms' : (ci === 1 ? '300ms' : '0ms')
                    }"
                  >
                    <BlackjackCard :card="card" />
                  </div>
                </TransitionGroup>
              </div>

            </div>

            <!-- Message -->
            <Transition name="fade" mode="out-in">
              <div :key="gameState.message" class="text-center mt-auto pt-4">
                <p class="font-medium text-sm inline-block px-5 py-2.5 rounded-full border transition-all duration-300"
                  :class="showResults
                    ? (gameState.playerHands.some(h => h.status === 'won' || h.status === 'blackjack')
                      ? 'bg-success/10 border-success/20 text-success'
                      : gameState.playerHands.every(h => h.status === 'push')
                        ? 'bg-warning/10 border-warning/20 text-warning'
                        : 'bg-error/10 border-error/20 text-error')
                    : 'bg-elevated/50 border-default text-muted'"
                >
                  {{ gameState.message }}
                </p>
              </div>
            </Transition>
          </div>
        </UCard>

        <!-- Action Buttons -->
        <UCard>
          <!-- Betting phase -->
          <div v-if="!isPlaying || showResults" class="flex items-center gap-4">
            <UButton
              block
              :loading="isFetching"
              :disabled="balance < bet"
              color="primary"
              size="xl"
              class="flex-1 h-16 text-lg font-black uppercase tracking-widest transition-transform active:scale-[0.98]"
              @click="showResults ? newGame() : startGame()"
            >
              {{ showResults ? 'New Game' : 'Deal' }}
            </UButton>
          </div>

          <!-- Insurance phase -->
          <div v-else-if="phase === 'insurance'" class="flex items-center gap-3">
            <UButton
              block
              :loading="isFetching"
              color="warning"
              size="xl"
              class="flex-1 h-14 font-bold uppercase tracking-wide"
              @click="doAction('insurance')"
            >
              Buy Insurance
            </UButton>
            <UButton
              block
              :loading="isFetching"
              color="neutral"
              variant="soft"
              size="xl"
              class="flex-1 h-14 font-bold uppercase tracking-wide"
              @click="doAction('no-insurance')"
            >
              No Insurance
            </UButton>
          </div>

          <!-- Playing phase -->
          <div v-else-if="phase === 'playing'" class="flex items-center gap-2 flex-wrap">
            <UButton
              :loading="isFetching"
              :disabled="!canHit"
              color="primary"
              size="xl"
              class="flex-1 h-14 font-bold uppercase tracking-wide min-w-[80px] transition-transform active:scale-[0.97]"
              :class="hintAction === 'hit' && showHint ? 'ring-2 ring-primary ring-offset-2 ring-offset-elevated animate-pulse' : ''"
              @click="doAction('hit')"
            >
              Hit
            </UButton>
            <UButton
              :loading="isFetching"
              :disabled="!canStand"
              color="neutral"
              variant="soft"
              size="xl"
              class="flex-1 h-14 font-bold uppercase tracking-wide min-w-[80px] transition-transform active:scale-[0.97]"
              :class="hintAction === 'stand' && showHint ? 'ring-2 ring-primary ring-offset-2 ring-offset-elevated animate-pulse' : ''"
              @click="doAction('stand')"
            >
              Stand
            </UButton>
            <UButton
              :loading="isFetching"
              :disabled="!canDouble"
              color="warning"
              variant="soft"
              size="xl"
              class="flex-1 h-14 font-bold uppercase tracking-wide min-w-[80px] transition-transform active:scale-[0.97]"
              :class="hintAction === 'double' && showHint ? 'ring-2 ring-primary ring-offset-2 ring-offset-elevated animate-pulse' : ''"
              @click="doAction('double')"
            >
              Double
            </UButton>
            <UButton
              v-if="canSplit"
              :loading="isFetching"
              color="info"
              variant="soft"
              size="xl"
              class="flex-1 h-14 font-bold uppercase tracking-wide min-w-[80px] transition-transform active:scale-[0.97]"
              :class="hintAction === 'split' && showHint ? 'ring-2 ring-primary ring-offset-2 ring-offset-elevated animate-pulse' : ''"
              @click="doAction('split')"
            >
              Split
            </UButton>
            <UButton
              v-if="canSurrender"
              :loading="isFetching"
              color="error"
              variant="ghost"
              size="xl"
              class="h-14 font-bold uppercase tracking-wide min-w-[80px] transition-transform active:scale-[0.97]"
              :class="hintAction === 'surrender' && showHint ? 'ring-2 ring-primary ring-offset-2 ring-offset-elevated animate-pulse' : ''"
              @click="doAction('surrender')"
            >
              Surrender
            </UButton>
          </div>

          <!-- Dealer turn / waiting -->
          <div v-else class="flex items-center justify-center h-14">
            <span class="text-muted animate-pulse">Dealer playing...</span>
          </div>
        </UCard>

      </div>
    </div>
  </div>
</template>

<style scoped>
/* Card wrapper */
.card-container {
  position: relative;
  width: 5rem;
  height: 7rem;
  perspective: 1000px;
}
@media (min-width: 640px) {
  .card-container {
    width: 6rem;
    height: 9rem;
  }
}

/* Active hand glow */
.player-hand-active {
  padding: 0.75rem;
  margin: -0.75rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(var(--color-primary-500), 0.05), transparent);
  border: 1px solid rgba(var(--color-primary-500), 0.1);
}

/* Deal animation */
.deal-smooth-enter-active,
.deal-smooth-leave-active {
  transition: all 0.5s ease-out;
}
.deal-smooth-enter-from {
  opacity: 0;
  transform: translateY(-150px) scale(0.8);
}
.deal-smooth-leave-to {
  opacity: 0;
  transform: translateY(100px) scale(0.8);
}

.deal-pop-enter-active,
.deal-pop-leave-active {
  transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.deal-pop-leave-active {
  transition: all 0.3s ease;
}
.deal-pop-enter-from {
  opacity: 0;
  transform: translateY(-100px) translateX(50px) scale(0.8) rotate(15deg);
}
.deal-pop-leave-to {
  opacity: 0;
  transform: translateY(100px) scale(0.8);
}

/* Result slide per hand */
.result-slide-enter-active {
  transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.result-slide-leave-active {
  transition: all 0.3s ease;
}
.result-slide-enter-from {
  opacity: 0;
  transform: translateY(-10px) scale(0.9);
}
.result-slide-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.9);
}

/* Status pop */
.status-pop-enter-active {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.status-pop-leave-active {
  transition: all 0.2s ease;
}
.status-pop-enter-from {
  opacity: 0;
  transform: scale(0);
}
.status-pop-leave-to {
  opacity: 0;
  transform: scale(0);
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: all 0.4s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* Bounce animation */
@keyframes bounce-short {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
.animate-bounce-short {
  animation: bounce-short 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 1;
}

/* General transitions */
.fade-up-enter-active, .fade-up-leave-active { transition: all 0.2s ease; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(5px); }

.pill-slide-enter-active { transition: all 0.25s ease; }
.pill-slide-enter-from { opacity: 0; transform: translateX(-8px); }

input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
</style>
