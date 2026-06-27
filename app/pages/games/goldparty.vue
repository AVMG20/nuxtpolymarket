<script setup lang="ts">
import type { GoldPartyResult, ColumnRoll } from '#shared/utils/gamelogic/goldparty'

const { user, setBalance } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))
watch(() => user.value?.balance, (v) => {
  if (v !== undefined) balance.value = parseFloat(v ?? '0')
})

const COLS = 5
const ROWS = 8
const TILES = COLS * ROWS
const MAX_HANDS = 10
const tiles = Array.from({ length: TILES }, (_, i) => i)

// --- bet config -------------------------------------------------------------
const handCount = ref(5)
const handValue = ref(5)
const totalStake = computed(() => handCount.value * handValue.value)

// --- placement --------------------------------------------------------------
const placements = ref<number[]>([])
const placedSet = computed(() => new Set(placements.value))
const handsLeft = computed(() => handCount.value - placements.value.length)

// Trim placements if the hand count drops below what's already placed.
watch(handCount, (n) => {
  if (placements.value.length > n) placements.value = placements.value.slice(0, n)
})

// --- round state ------------------------------------------------------------
type ColDisplay = 'pending' | 'rolling' | 'reroll' | ColumnRoll
const phase = ref<'idle' | 'fetching' | 'columns' | 'winners' | 'done'>('idle')
const columnStates = ref<ColDisplay[]>(Array(COLS).fill('pending'))
const revealedMult = ref<Set<number>>(new Set())
const revealedWinners = ref<Set<number>>(new Set())
const result = ref<GoldPartyResult | null>(null)
const showPayout = ref(false)
const showHelp = ref(false)
const errorMsg = ref('')

const history = ref<{ won: boolean, payout: number, stake: number, net: number }[]>([])

const isBusy = computed(() => phase.value === 'fetching' || phase.value === 'columns' || phase.value === 'winners')
const canEdit = computed(() => phase.value === 'idle' || phase.value === 'done')
const canPlay = computed(() =>
  canEdit.value
  && placements.value.length === handCount.value
  && balance.value >= totalStake.value
  && totalStake.value > 0
)

// --- helpers ----------------------------------------------------------------
function sleep(ms: number) {
  return new Promise<void>((r) => {
    timers.push(setTimeout(r, ms))
  })
}
let timers: ReturnType<typeof setTimeout>[] = []
function clearTimers() {
  timers.forEach(clearTimeout)
  timers = []
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function multValue(i: number): number | undefined {
  return revealedMult.value.has(i) ? result.value?.multiplierTiles[i] : undefined
}

function resetBoard() {
  clearTimers()
  columnStates.value = Array(COLS).fill('pending')
  revealedMult.value = new Set()
  revealedWinners.value = new Set()
  result.value = null
  showPayout.value = false
  phase.value = 'idle'
}

// --- placement actions ------------------------------------------------------
function toggleTile(i: number) {
  if (!canEdit.value) return
  if (phase.value === 'done') resetBoard()
  const idx = placements.value.indexOf(i)
  if (idx >= 0) {
    placements.value.splice(idx, 1)
  } else if (placements.value.length < handCount.value) {
    placements.value.push(i)
  }
}

function clearPlacements() {
  if (!canEdit.value) return
  if (phase.value === 'done') resetBoard()
  placements.value = []
}

function autoPlace() {
  if (!canEdit.value) return
  if (phase.value === 'done') resetBoard()
  placements.value = shuffle(tiles).slice(0, handCount.value)
}

// --- round flow -------------------------------------------------------------
async function play() {
  if (!canPlay.value) {
    if (placements.value.length !== handCount.value) {
      errorMsg.value = `Place exactly ${handCount.value} hand${handCount.value > 1 ? 's' : ''} before playing`
    }
    return
  }

  resetBoard()
  phase.value = 'fetching'
  errorMsg.value = ''
  const stake = totalStake.value

  try {
    const data = await $fetch('/api/games/play-game', {
      method: 'POST',
      body: {
        bet: stake,
        game: 'goldparty',
        options: {
          handCount: handCount.value,
          handValue: handValue.value,
          placements: [...placements.value]
        }
      }
    }) as { gameData: GoldPartyResult, balance: number }

    result.value = data.gameData
    await runReveal(data)
  } catch (e: unknown) {
    clearTimers()
    phase.value = 'idle'
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
  }
}

async function runReveal(data: { gameData: GoldPartyResult, balance: number }) {
  const res = data.gameData

  // 1. Top bar — reveal one column at a time, left to right.
  phase.value = 'columns'
  await sleep(300)
  for (let col = 0; col < COLS; col++) {
    const colRes = res.columns[col]!
    columnStates.value[col] = 'rolling'
    await sleep(450)

    // Reroll columns flash the reroll state then spin again.
    if (colRes.rolls[0] === 'reroll') {
      columnStates.value[col] = 'reroll'
      await sleep(650)
      columnStates.value[col] = 'rolling'
      await sleep(400)
    }

    columnStates.value[col] = colRes.type
    await sleep(280)

    // Pop multiplier tiles one by one.
    if (colRes.type === 'multiplier') {
      for (const m of colRes.multipliers) {
        revealedMult.value.add(m.tile)
        await sleep(300)
      }
    }
    await sleep(160)
  }

  // 2. Reveal winning tiles one by one — save the player's hits for the climax.
  phase.value = 'winners'
  await sleep(450)
  const placed = new Set(res.placements)
  const blanks = shuffle(res.winnerTiles.filter(t => !placed.has(t)))
  const hits = res.winnerTiles.filter(t => placed.has(t))
  for (const t of blanks) {
    revealedWinners.value.add(t)
    await sleep(70)
  }
  await sleep(250)
  for (const t of hits) {
    revealedWinners.value.add(t)
    await sleep(320)
  }

  // 3. Settle.
  await sleep(500)
  phase.value = 'done'
  balance.value = data.balance
  setBalance(data.balance)
  history.value.unshift({
    won: res.won,
    payout: res.payout,
    stake: res.totalStake,
    net: res.payout - res.totalStake
  })
  if (history.value.length > 10) history.value.pop()
  showPayout.value = true
}

// --- payout summary ---------------------------------------------------------
const winningHands = computed(() => result.value?.wins ?? [])
const bestMultiplier = computed(() =>
  winningHands.value.reduce((m, w) => Math.max(m, w.multiplier), 0)
)
const profit = computed(() => (result.value ? result.value.payout - result.value.totalStake : 0))

function onKeydown(e: KeyboardEvent) {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault()
    play()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  clearTimers()
})
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon
          name="i-lucide-party-popper"
          class="size-6 text-warning"
        />
        Gold Party
      </h1>
      <p class="text-sm text-muted mt-0.5">
        98% RTP · place your hands and chase the gold
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
          <!-- Hand value -->
          <div>
            <label class="text-xs text-muted uppercase tracking-wide font-medium block mb-1.5">Hand Value</label>
            <div class="flex items-center gap-2">
              <UInput
                v-model.number="handValue"
                type="number"
                min="1"
                :disabled="isBusy"
                class="flex-1 font-mono"
                size="lg"
              />
              <div class="flex gap-1">
                <UButton
                  color="neutral"
                  variant="soft"
                  :disabled="isBusy"
                  @click="handValue = Math.max(1, Math.floor(handValue / 2))"
                >
                  ½
                </UButton>
                <UButton
                  color="neutral"
                  variant="soft"
                  :disabled="isBusy"
                  @click="handValue = handValue * 2"
                >
                  2×
                </UButton>
              </div>
            </div>
          </div>

          <!-- Hand count -->
          <div>
            <div class="flex justify-between items-center mb-1.5">
              <label class="text-xs text-muted uppercase tracking-wide font-medium">Hand Count</label>
              <span class="font-bold font-mono text-sm">{{ handCount }}</span>
            </div>
            <input
              v-model.number="handCount"
              :disabled="isBusy"
              type="range"
              min="1"
              :max="MAX_HANDS"
              step="1"
              class="w-full accent-primary disabled:opacity-40"
            >
            <div class="flex justify-between text-xs text-muted font-mono mt-1">
              <span>1</span><span>{{ MAX_HANDS }}</span>
            </div>
          </div>

          <!-- Placement controls -->
          <div class="grid grid-cols-2 gap-1.5">
            <UButton
              color="neutral"
              variant="soft"
              size="sm"
              icon="i-lucide-shuffle"
              :disabled="!canEdit"
              class="justify-center"
              @click="autoPlace"
            >
              Auto place
            </UButton>
            <UButton
              color="neutral"
              variant="soft"
              size="sm"
              icon="i-lucide-eraser"
              :disabled="!canEdit || placements.length === 0"
              class="justify-center"
              @click="clearPlacements"
            >
              Clear
            </UButton>
          </div>

          <!-- Stats -->
          <div class="rounded-lg bg-elevated border border-default p-3 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Hands placed</span>
              <span
                class="font-bold tabular-nums"
                :class="placements.length === handCount ? 'text-success' : 'text-warning'"
              >
                {{ placements.length }} / {{ handCount }}
              </span>
            </div>
            <USeparator />
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Total stake</span>
              <span class="font-bold tabular-nums">${{ formatNumber(totalStake, false) }}</span>
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
            <span class="font-bold text-sm">
              <CoinBalance
                :value="balance"
                :compact="false"
              />
            </span>
          </div>
        </div>
      </UCard>

      <!-- Game Area -->
      <div class="lg:col-span-2 flex flex-col gap-4">
        <UCard :ui="{ body: 'relative overflow-hidden flex flex-col p-4 sm:p-6' }">
          <div class="w-full max-w-md mx-auto">
            <!-- Top bar -->
            <div class="grid grid-cols-5 gap-2 mb-3">
              <div
                v-for="col in COLS"
                :key="`top-${col}`"
                class="aspect-square rounded-lg flex items-center justify-center transition-all duration-300 border"
                :class="[
                  columnStates[col - 1] === 'multiplier' ? 'bg-warning/15 border-warning text-warning shadow-[0_0_20px_-4px_var(--ui-warning)]'
                  : columnStates[col - 1] === 'reroll' ? 'bg-info/15 border-info text-info'
                    : columnStates[col - 1] === 'nothing' ? 'bg-elevated border-default text-muted'
                      : columnStates[col - 1] === 'rolling' ? 'bg-elevated border-primary/50 text-primary'
                        : 'bg-elevated/40 border-default text-muted/40'
                ]"
              >
                <UIcon
                  v-if="columnStates[col - 1] === 'rolling'"
                  name="i-lucide-loader-2"
                  class="size-5 sm:size-6 animate-spin"
                />
                <UIcon
                  v-else-if="columnStates[col - 1] === 'reroll'"
                  name="i-lucide-refresh-cw"
                  class="size-5 sm:size-6 animate-spin"
                />
                <UIcon
                  v-else-if="columnStates[col - 1] === 'multiplier'"
                  name="i-lucide-sparkles"
                  class="size-5 sm:size-6"
                />
                <UIcon
                  v-else-if="columnStates[col - 1] === 'nothing'"
                  name="i-lucide-minus"
                  class="size-5 sm:size-6"
                />
                <UIcon
                  v-else
                  name="i-lucide-circle-help"
                  class="size-4 sm:size-5"
                />
              </div>
            </div>

            <!-- Grid -->
            <div class="grid grid-cols-5 gap-2">
              <button
                v-for="i in tiles"
                :key="i"
                type="button"
                :disabled="!canEdit"
                class="relative aspect-square rounded-lg border flex items-center justify-center transition-all duration-200 select-none"
                :class="[
                  // winner + placed hand = jackpot tile
                  revealedWinners.has(i) && placedSet.has(i) ? 'bg-success/25 border-success text-success shadow-[0_0_18px_-2px_var(--ui-success)] scale-[1.04] z-10'
                  // winner tile (no hand)
                  : revealedWinners.has(i) ? (multValue(i) !== undefined ? 'bg-warning/15 border-warning/70 text-warning' : 'bg-success/10 border-success/40 text-success/80')
                    // multiplier revealed (not yet a winner)
                    : multValue(i) !== undefined ? 'bg-warning/15 border-warning text-warning shadow-[0_0_14px_-4px_var(--ui-warning)]'
                      // placed hand, round over and it lost
                      : placedSet.has(i) && phase === 'done' ? 'bg-error/10 border-error/40 text-error/60'
                        // placed hand, idle / playing
                        : placedSet.has(i) ? 'bg-primary/15 border-primary text-primary'
                          // empty
                          : 'bg-elevated border-default text-muted',
                  canEdit ? 'cursor-pointer hover:border-primary/60' : 'cursor-default'
                ]"
                @click="toggleTile(i)"
              >
                <!-- multiplier value -->
                <Transition name="pop">
                  <span
                    v-if="multValue(i) !== undefined"
                    class="font-black text-base sm:text-xl tabular-nums leading-none"
                  >
                    {{ multValue(i) }}×
                  </span>
                </Transition>

                <!-- winner coin (winner tile with no multiplier) -->
                <Transition name="pop">
                  <UIcon
                    v-if="revealedWinners.has(i) && multValue(i) === undefined"
                    name="i-lucide-coins"
                    class="size-5 sm:size-6"
                  />
                </Transition>

                <!-- hand marker -->
                <div
                  v-if="placedSet.has(i)"
                  class="absolute top-0.5 right-0.5 rounded-full p-0.5"
                  :class="revealedWinners.has(i) && phase === 'done' ? 'bg-success text-inverted'
                    : placedSet.has(i) && phase === 'done' ? 'bg-error/70 text-inverted'
                      : 'bg-primary text-inverted'"
                >
                  <UIcon
                    name="i-lucide-hand"
                    class="size-3 sm:size-3.5"
                  />
                </div>
              </button>
            </div>

            <!-- Status line -->
            <div class="mt-4 text-center text-sm font-mono h-6">
              <span
                v-if="phase === 'idle'"
                class="text-muted"
              >
                <template v-if="handsLeft > 0">Place {{ handsLeft }} more hand{{ handsLeft > 1 ? 's' : '' }}</template>
                <template v-else>Ready — press Play</template>
              </span>
              <span
                v-else-if="phase === 'fetching'"
                class="text-muted animate-pulse"
              >Dealing…</span>
              <span
                v-else-if="phase === 'columns'"
                class="text-primary"
              >Revealing columns…</span>
              <span
                v-else-if="phase === 'winners'"
                class="text-warning"
              >Picking winning tiles…</span>
              <span
                v-else-if="phase === 'done' && result"
                :class="result.won ? 'text-success font-bold' : 'text-muted'"
              >
                {{ result.won ? `You won $${formatNumber(result.payout, false)}!` : `Paid $${formatNumber(result.payout, false)}` }}
              </span>
            </div>
          </div>
        </UCard>

        <!-- History strip -->
        <UCard :ui="{ body: 'p-3' }">
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted uppercase tracking-wide font-medium shrink-0">Last 10</span>
            <div class="flex gap-1.5 flex-wrap min-h-[26px] items-center">
              <TransitionGroup name="pill-slide">
                <span
                  v-for="(h, idx) in history"
                  :key="`${idx}-${h.payout}`"
                  class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-mono font-bold"
                  :class="h.won ? 'bg-success/20 text-success' : 'bg-elevated text-muted'"
                >
                  <UIcon
                    :name="h.won ? 'i-lucide-trending-up' : 'i-lucide-trending-down'"
                    class="size-3"
                  />
                  {{ h.net >= 0 ? '+' : '' }}{{ formatNumber(h.net, false) }}
                </span>
              </TransitionGroup>
              <span
                v-if="history.length === 0"
                class="text-xs text-muted/50 font-mono"
              >No rounds yet</span>
            </div>
          </div>
        </UCard>

        <!-- Play Button -->
        <UCard>
          <div class="flex items-center gap-4">
            <UButton
              block
              :loading="isBusy"
              :disabled="!canPlay && !isBusy"
              color="primary"
              size="xl"
              class="flex-1 h-16 text-lg font-black uppercase tracking-widest transition-transform active:scale-[0.98]"
              @click="play"
            >
              {{ isBusy ? 'Playing…' : `Play · $${formatNumber(totalStake, false)}` }}
            </UButton>
            <div class="hidden sm:flex flex-col items-end px-4 text-sm font-mono text-muted whitespace-nowrap">
              <span>Press <kbd class="px-2 py-1 bg-elevated rounded text-xs font-sans font-bold border border-default">SPACE</kbd></span>
            </div>
          </div>
        </UCard>
      </div>
    </div>

    <!-- Payout popup -->
    <UModal
      v-model:open="showPayout"
      :ui="{ content: 'max-w-sm' }"
    >
      <template #content>
        <div class="p-6 text-center space-y-4">
          <div
            class="mx-auto size-16 rounded-full flex items-center justify-center"
            :class="result?.won ? 'bg-success/15 text-success' : 'bg-elevated text-muted'"
          >
            <UIcon
              :name="result?.won ? 'i-lucide-party-popper' : 'i-lucide-circle-slash'"
              class="size-8"
            />
          </div>

          <div>
            <p class="text-xs text-muted uppercase tracking-widest font-medium">
              {{ result?.won ? 'You won' : 'Round over' }}
            </p>
            <p
              class="text-4xl font-black tabular-nums mt-1"
              :class="result?.won ? 'text-success' : 'text-highlighted'"
            >
              ${{ formatNumber(result?.payout ?? 0, false) }}
            </p>
            <p
              v-if="result"
              class="text-sm font-mono mt-1"
              :class="profit >= 0 ? 'text-success' : 'text-error'"
            >
              {{ profit >= 0 ? '+' : '' }}{{ formatNumber(profit, false) }} net
            </p>
          </div>

          <div class="grid grid-cols-2 gap-2 text-sm">
            <div class="rounded-lg bg-elevated border border-default p-2">
              <p class="text-muted text-xs">
                Winning hands
              </p>
              <p class="font-bold tabular-nums">
                {{ winningHands.length }} / {{ result?.handCount ?? 0 }}
              </p>
            </div>
            <div class="rounded-lg bg-elevated border border-default p-2">
              <p class="text-muted text-xs">
                Best multiplier
              </p>
              <p
                class="font-bold tabular-nums"
                :class="bestMultiplier > 1 ? 'text-warning' : ''"
              >
                {{ bestMultiplier > 0 ? `${bestMultiplier}×` : '—' }}
              </p>
            </div>
          </div>

          <UButton
            block
            color="primary"
            size="lg"
            class="font-bold"
            @click="showPayout = false"
          >
            Continue
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Help -->
    <UModal
      v-model:open="showHelp"
      title="How Gold Party works"
      :ui="{ content: 'max-w-md' }"
    >
      <template #body>
        <ul class="text-sm text-muted space-y-2 list-disc list-inside">
          <li>Pick a <strong class="text-default">hand value</strong> (bet per hand) and a <strong class="text-default">hand count</strong> (1–10). Total stake = count × value.</li>
          <li>Click tiles on the 5×8 grid to place exactly that many <strong class="text-default">hands</strong>.</li>
          <li>On Play, each of the 5 columns reveals a result: nothing, a <strong class="text-warning">multiplier</strong> (lands on 1–3 tiles in that column), or a <strong class="text-info">reroll</strong>.</li>
          <li>Then random tiles are revealed as <strong class="text-success">winners</strong>.</li>
          <li>Every hand on a winning tile pays <strong class="text-default">hand value × tile multiplier</strong> (1× by default).</li>
          <li>Max win is 2500× your total stake.</li>
        </ul>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.fade-up-enter-active, .fade-up-leave-active { transition: all 0.2s ease; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(5px); }

.pill-slide-enter-active { transition: all 0.25s ease; }
.pill-slide-enter-from { opacity: 0; transform: translateX(-8px); }

.pop-enter-active { transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.pop-enter-from { opacity: 0; transform: scale(0.3); }

input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
</style>
