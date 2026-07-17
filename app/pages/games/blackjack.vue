<script setup lang="ts">
import type { BlackjackClientState, BlackjackAction, Card } from '#shared/utils/gamelogic/blackjack'
import { getHint } from '#shared/utils/gamelogic/blackjack'
import BlackjackCard from "~/components/games/blackjack/BlackjackCard.vue";

const { setBalance, balanceNum: balance } = useAuth()

const bet = ref(10)
const isPlaying = ref(false)
const isFetching = ref(false)
const errorMsg = ref('')
const showHelp = ref(false)
const gameState = ref<BlackjackClientState | null>(null)
const history = ref<{ won: boolean; payout: number; bet: number }[]>([])
const showHint = useCookie<boolean>('bj-show-hint', { default: () => false })
const showResults = ref(false)
const isDealerAnimating = ref(false)
const pendingBalance = ref<number | null>(null)

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

// ── Helpers ──

const DEALER_CARD_DELAY = 800

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function applyBalance(bal: number) {
  setBalance(bal)
}

type GameResponse = {
  clientState: BlackjackClientState
  balance: number
  finished: boolean
}

/** Shared handler for start / action API responses */
async function handleGameResponse(data: GameResponse, opts?: { preserveDealerHand: boolean }) {
  if (data.finished) {
    // Defer balance update until animations finish so the outcome isn't spoiled
    pendingBalance.value = data.balance
    isDealerAnimating.value = true

    // Optionally keep the current dealer hand (hole card hidden) during the pre-animation pause
    if (opts?.preserveDealerHand && gameState.value) {
      gameState.value = { ...data.clientState, dealerHand: gameState.value.dealerHand }
      await sleep(DEALER_CARD_DELAY)
    }

    await animateDealerTurn(data.clientState)
  } else {
    applyBalance(data.balance)
    gameState.value = data.clientState
  }
}

// ── Lifecycle ──

onMounted(async () => {
  try {
    const data = await $fetch('/api/games/blackjack/resume') as {
      active: boolean; clientState: BlackjackClientState | null; balance: number
    }
    applyBalance(data.balance)
    if (data.active && data.clientState) {
      gameState.value = data.clientState
      isPlaying.value = true
    }
  } catch { /* ignore */ }
})

// ── Game actions ──

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
    }) as GameResponse

    gameState.value = data.clientState
    await handleGameResponse(data)
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
    isPlaying.value = false
  } finally {
    isFetching.value = false
  }
}

async function doAction(action: BlackjackAction) {
  if (isFetching.value || !isPlaying.value) return
  isFetching.value = true
  errorMsg.value = ''

  try {
    const data = await $fetch('/api/games/blackjack/action', {
      method: 'POST',
      body: { action },
    }) as GameResponse

    await handleGameResponse(data, { preserveDealerHand: true })
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
  } finally {
    isFetching.value = false
  }
}

// ── Dealer animation ──

async function animateDealerTurn(finalState: BlackjackClientState) {
  const finalCards = finalState.dealerHand.cards

  // Reveal hole card (show the 2 initial cards, all face-up)
  gameState.value = {
    ...finalState,
    dealerHand: { ...finalState.dealerHand, cards: finalCards.slice(0, 2) },
  }
  await sleep(DEALER_CARD_DELAY)

  // Draw each extra card one by one
  for (let i = 2; i < finalCards.length; i++) {
    gameState.value = {
      ...finalState,
      dealerHand: { ...finalState.dealerHand, cards: finalCards.slice(0, i + 1) },
    }
    await sleep(DEALER_CARD_DELAY)
  }

  gameState.value = finalState
  isDealerAnimating.value = false
  finishGame()
}

function finishGame() {
  if (!gameState.value) return

  // Apply the deferred balance now that animations are done
  if (pendingBalance.value !== null) {
    applyBalance(pendingBalance.value)
    pendingBalance.value = null
  }

  const gs = gameState.value
  const totalBet = gs.playerHands.reduce((s, h) => s + h.bet, 0)
  const won = gs.playerHands.some(h => h.status === 'won' || h.status === 'blackjack')
  history.value.unshift({ won, payout: 0, bet: totalBet })
  if (history.value.length > 8) history.value.pop()
  setTimeout(() => { showResults.value = true }, 200)
}

function newGame() {
  gameState.value = null
  isPlaying.value = false
  showResults.value = false
  isDealerAnimating.value = false
  pendingBalance.value = null
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
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Controls</h2>
            <UButton icon="i-lucide-circle-help" color="neutral" variant="ghost" size="xs" @click="showHelp = true" />
          </div>
        </template>

        <div class="space-y-4">
          <BetControls v-model="bet" :disabled="isPlaying && !showResults" />

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
                <span v-if="hand.status !== 'playing' && hand.status !== 'stood' && (showResults || !['won', 'lost', 'push'].includes(hand.status))" :class="statusColor(hand.status)" class="text-xs ml-1">{{ statusLabel(hand.status) }}</span>
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
        <UCard :ui="{ body: 'relative overflow-hidden flex flex-col p-6' }" class="game-table">
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

          <!-- Game frame (betting placeholder + active game share the same layout) -->
          <div class="flex-1 flex flex-col gap-6">
            <!-- Dealer hand -->
            <div>
              <div class="flex justify-center items-center gap-2 mb-3">
                <span class="font-bold tabular-nums text-sm" :class="gameState ? '' : 'opacity-30'">
                  {{ gameState ? scoreDisplay(gameState.dealerHand.cards) : '?' }}
                </span>
              </div>
              <div class="flex justify-center">
                <template v-if="gameState">
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
                </template>
                <template v-else>
                  <div class="card-container opacity-20" style="z-index: 0">
                    <BlackjackCard :card="{ rank: 'A', suit: 'spades', isHidden: true }" />
                  </div>
                  <div class="card-container opacity-20" style="z-index: 1; margin-left: -3rem">
                    <BlackjackCard :card="{ rank: 'A', suit: 'spades', isHidden: true }" />
                  </div>
                </template>
              </div>
            </div>

            <!-- Separator -->
            <div class="table-divider relative flex items-center gap-3 my-2 h-10">
              <div class="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div v-if="showResults && gameState" class="flex items-center gap-2">
                  <template v-for="hand in gameState.playerHands" :key="hand.id">
                    <div v-if="hand.status === 'won'" class="text-success font-bold flex items-center gap-1 text-base bg-success/15 px-3 py-1 rounded-full border border-success/20">
                      <UIcon name="i-lucide-coins" class="size-4" />
                      +{{ formatNumber(hand.bet * 2, false) }}
                    </div>
                    <div v-else-if="hand.status === 'blackjack'" class="text-success font-bold flex items-center gap-1 text-base bg-success/15 px-3 py-1 rounded-full border border-success/20">
                      <span class="text-xs text-success/70 font-medium uppercase tracking-wider mr-1">BJ</span>
                      <UIcon name="i-lucide-coins" class="size-4" />
                      +{{ formatNumber(hand.bet * 2.5, false) }}
                    </div>
                    <div v-else-if="hand.status === 'push'" class="text-warning font-bold flex items-center gap-1 text-base bg-warning/15 px-3 py-1 rounded-full border border-warning/20">
                      <UIcon name="i-lucide-coins" class="size-4" />
                      +{{ formatNumber(hand.bet, false) }}
                    </div>
                    <div v-else-if="hand.status === 'surrendered'" class="text-error font-bold flex items-center gap-1 text-base bg-error/15 px-3 py-1 rounded-full border border-error/20">
                      <UIcon name="i-lucide-coins" class="size-4" />
                      -{{ formatNumber(Math.floor(hand.bet / 2), false) }}
                    </div>
                    <div v-else class="text-error font-bold flex items-center gap-1 text-base bg-error/15 px-3 py-1 rounded-full border border-error/20">
                      <UIcon name="i-lucide-coins" class="size-4" />
                      -{{ formatNumber(hand.bet, false) }}
                    </div>
                  </template>
                </div>
                <span v-else class="text-[10px] text-muted/50 uppercase tracking-widest">vs</span>

              <div class="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>

            <!-- Player hands -->
            <template v-if="gameState">
              <div v-for="(hand, hi) in gameState.playerHands" :key="hand.id" class="player-hand-area transition-all duration-300" :class="{ 'player-hand-active': hi === gameState.currentHandIndex && phase === 'playing' }">
                <div class="flex justify-center items-center gap-2 mb-3">
                  <span v-if="hi === gameState.currentHandIndex && phase === 'playing'" class="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span class="font-bold tabular-nums text-sm">{{ scoreDisplay(hand.cards) }}</span>

                  <!-- Bet chip -->
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-warning/15 text-warning border border-warning/20">
                    <UIcon name="i-lucide-coins" class="size-3" />
                    {{ formatNumber(hand.bet, false) }}
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
            </template>
            <!-- Placeholder player hand when no game -->
            <div v-else class="player-hand-area">
              <div class="flex justify-center items-center gap-2 mb-3">
                <span class="font-bold tabular-nums text-sm opacity-30">?</span>
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-warning/10 text-warning/30 border border-warning/10">
                  <UIcon name="i-lucide-coins" class="size-3" />
                  {{ formatNumber(bet, false) }}
                </span>
              </div>
              <div class="flex justify-center mt-2">
                <div class="card-container opacity-20" style="z-index: 0">
                  <BlackjackCard :card="{ rank: 'A', suit: 'spades', isHidden: true }" />
                </div>
                <div class="card-container opacity-20" style="z-index: 1; margin-left: -3rem">
                  <BlackjackCard :card="{ rank: 'A', suit: 'spades', isHidden: true }" />
                </div>
              </div>
            </div>

            <!-- Message -->
            <div>
              <Transition name="fade" mode="out-in">
                <div :key="gameState ? (isDealerAnimating ? 'dealer' : (showResults ? 'results' : gameState.message)) : 'idle'" class="text-center mt-auto pt-4">
                  <p class="font-medium text-sm inline-block px-5 py-2.5 rounded-full border transition-all duration-300"
                     :class="!gameState
                    ? 'bg-elevated/50 border-default text-muted'
                    : showResults
                      ? (gameState.playerHands.some(h => h.status === 'won' || h.status === 'blackjack')
                        ? 'bg-success/10 border-success/20 text-success'
                        : gameState.playerHands.every(h => h.status === 'push')
                          ? 'bg-warning/10 border-warning/20 text-warning'
                          : 'bg-error/10 border-error/20 text-error')
                      : 'bg-elevated/50 border-default text-muted'"
                  >
                    {{ !gameState ? 'Place your bet to start' : isDealerAnimating ? 'Waiting for dealer...' : gameState.message }}
                  </p>
                </div>
              </Transition>
            </div>
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

    <GameHelpModal v-model:open="showHelp" title="How Blackjack works">
      <li>Beat the dealer's hand without going over 21.</li>
      <li>Face cards = 10. Aces = 1 or 11.</li>
      <li><strong class="text-default">Blackjack</strong> (Ace + 10-value on deal) pays 2.5×.</li>
      <li><strong class="text-default">Double</strong>: double your bet and take exactly one more card.</li>
      <li><strong class="text-default">Split</strong>: split a pair into two separate hands.</li>
      <li><strong class="text-default">Surrender</strong>: fold and recover half your bet.</li>
      <li>Dealer must hit until 17 or more.</li>
    </GameHelpModal>
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

/* Active hand */
.player-hand-active {
  padding: 0.75rem;
  margin: -0.75rem;
  border-radius: 1rem;
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

/* General transitions */
.fade-up-enter-active, .fade-up-leave-active { transition: all 0.2s ease; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(5px); }

.pill-slide-enter-active { transition: all 0.25s ease; }
.pill-slide-enter-from { opacity: 0; transform: translateX(-8px); }

input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
</style>
