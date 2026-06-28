<script setup lang="ts">
import type { GoldPartyResult, TopBarPass, PassSlot } from '#shared/utils/gamelogic/goldparty'
import { GOLD_PARTY_MAX_HANDS, GOLD_PARTY_MULTIPLIERS } from '#shared/utils/gamelogic/goldparty'

const { user, setBalance } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))
watch(() => user.value?.balance, (v) => {
  if (v !== undefined) balance.value = parseFloat(v ?? '0')
})

const COLS = 5
const ROWS = 8
const TILES = COLS * ROWS
const MAX_HANDS = GOLD_PARTY_MAX_HANDS
const tiles = Array.from({ length: TILES }, (_, i) => i)

// Reel geometry for the slot-machine top bar.
const TOP_CELL = 56
const REEL_LEN = 28
const FINAL_INDEX = 24
const SPIN_MS = 850
const STAGGER = 110

// Multiplier colour by magnitude — a game-style rarity ladder that deliberately
// avoids green (win) and red (loss). Covers stacked values too.
//   2,5 → common (slate) · 10,15 → uncommon (blue) · 25 → rare (purple)
//   50 → epic (pink) · 100+ → legendary (gold) · 500+ → mythic (bright gold glow)
function tierColors(v: number): { bg: string, border: string, text: string, glow: string } {
  if (v >= 500) return { bg: 'bg-amber-400/25', border: 'border-amber-300', text: 'text-amber-200', glow: 'shadow-[0_0_24px_-2px_var(--ui-warning)]' }
  if (v >= 100) return { bg: 'bg-amber-500/20', border: 'border-amber-400', text: 'text-amber-300', glow: 'shadow-[0_0_16px_-3px_var(--ui-warning)]' }
  if (v >= 50) return { bg: 'bg-fuchsia-500/15', border: 'border-fuchsia-400', text: 'text-fuchsia-300', glow: '' }
  if (v >= 25) return { bg: 'bg-violet-500/15', border: 'border-violet-400', text: 'text-violet-300', glow: '' }
  if (v >= 10) return { bg: 'bg-sky-500/15', border: 'border-sky-400', text: 'text-sky-300', glow: '' }
  return { bg: 'bg-slate-500/15', border: 'border-slate-400', text: 'text-slate-300', glow: '' }
}
function tierClass(v: number): string {
  const t = tierColors(v)
  return `${t.bg} ${t.border} ${t.text} ${t.glow}`.trim()
}

// --- bet config -------------------------------------------------------------
const handValue = ref(5)
const placements = ref<number[]>([])
const placedSet = computed(() => new Set(placements.value))
const totalStake = computed(() => placements.value.length * handValue.value)

// --- round state ------------------------------------------------------------
type ReelSym = { kind: 'pending' | 'nothing' | 'reroll' | 'mult', value?: number }
type Reel = { items: ReelSym[], offset: number, transition: boolean }

function placeholderReels(): Reel[] {
  return Array.from({ length: COLS }, () => ({ items: [{ kind: 'pending' }], offset: 0, transition: false }))
}

const phase = ref<'idle' | 'fetching' | 'topbar' | 'winners' | 'done'>('idle')
const subPhase = ref<'' | 'spinning' | 'applying' | 'reroll'>('')
const topReels = ref<Reel[]>(placeholderReels())
const topLocked = ref<(PassSlot | null)[]>(Array(COLS).fill(null))
const activeApplyCol = ref(-1)
const passLabel = ref('')
const tileMult = ref<Record<number, number>>({})
const stampedTile = ref<number | null>(null)
const revealedWinners = ref<Set<number>>(new Set())
const result = ref<GoldPartyResult | null>(null)
const showPayout = ref(false)
const showHelp = ref(false)
const errorMsg = ref('')

const history = ref<{ won: boolean, payout: number, stake: number, net: number }[]>([])

const isBusy = computed(() => ['fetching', 'topbar', 'winners'].includes(phase.value))
const canEdit = computed(() => phase.value === 'idle' || phase.value === 'done')
const canPlay = computed(() =>
  canEdit.value
  && placements.value.length >= 1
  && balance.value >= totalStake.value
  && totalStake.value > 0
)

// --- helpers ----------------------------------------------------------------
let timers: ReturnType<typeof setTimeout>[] = []
function sleep(ms: number) {
  return new Promise<void>((r) => {
    timers.push(setTimeout(r, ms))
  })
}
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
  return tileMult.value[i]
}

// Tile background reflects the board (multipliers / winners). The bright green
// celebration is reserved for the player's OWN winning hand; other winning tiles
// just get a muted green border so they read as "a winner, not your win".
function tileClass(i: number): string {
  const mv = multValue(i)
  const isWin = revealedWinners.value.has(i)
  const placed = placedSet.value.has(i)

  // Your own winning hand — the only bright, celebratory state.
  if (isWin && placed) {
    return mv !== undefined
      ? `${tierColors(mv).bg} ${tierColors(mv).text} border-success ring-2 ring-success scale-[1.05] z-10 shadow-[0_0_18px_-2px_var(--ui-success)]`
      : 'bg-success/25 border-success text-success ring-2 ring-success scale-[1.05] z-10 shadow-[0_0_16px_-3px_var(--ui-success)]'
  }
  // A winning tile you have no hand on — keep its fill but use a muted green border.
  if (isWin) {
    return mv !== undefined
      ? `${tierColors(mv).bg} ${tierColors(mv).text} border-success/40`
      : 'bg-success/5 border-success/40 text-success/60'
  }
  // A multiplier tile that didn't win.
  if (mv !== undefined) return tierClass(mv)
  return 'bg-elevated border-default text-muted'
}

// Hand icon colour: primary when placed, success once its tile is a revealed winner,
// danger once the round is over and it lost.
function handColor(i: number): string {
  if (revealedWinners.value.has(i)) return 'text-success'
  if (phase.value === 'done') return 'text-error'
  return 'text-primary'
}

function topCellClass(c: number): string {
  if (activeApplyCol.value === c) return 'border-primary ring-2 ring-primary/50'
  const slot = topLocked.value[c]
  if (!slot) return 'border-default'
  if (slot.type === 'multiplier') return tierClass(slot.value ?? 0)
  if (slot.type === 'reroll') return 'bg-info/15 border-info text-info'
  if (slot.type === 'nothing') return 'border-default text-muted'
  return 'border-default'
}

function randomSym(): ReelSym {
  const r = Math.random()
  if (r < 0.30) return { kind: 'nothing' }
  if (r < 0.40) return { kind: 'reroll' }
  return { kind: 'mult', value: GOLD_PARTY_MULTIPLIERS[Math.floor(Math.random() * GOLD_PARTY_MULTIPLIERS.length)] }
}
function symFor(slot: PassSlot): ReelSym {
  if (slot.type === 'multiplier') return { kind: 'mult', value: slot.value ?? 0 }
  if (slot.type === 'reroll') return { kind: 'reroll' }
  return { kind: 'nothing' }
}

function resetBoard() {
  clearTimers()
  topReels.value = placeholderReels()
  topLocked.value = Array(COLS).fill(null)
  activeApplyCol.value = -1
  passLabel.value = ''
  tileMult.value = {}
  stampedTile.value = null
  revealedWinners.value = new Set()
  result.value = null
  showPayout.value = false
  subPhase.value = ''
  phase.value = 'idle'
}

// --- placement actions ------------------------------------------------------
function toggleTile(i: number) {
  if (!canEdit.value) return
  if (phase.value === 'done') resetBoard()
  errorMsg.value = ''
  const idx = placements.value.indexOf(i)
  if (idx >= 0) {
    placements.value.splice(idx, 1)
  } else if (placements.value.length < MAX_HANDS) {
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
  placements.value = shuffle(tiles).slice(0, 10)
}

// --- round flow -------------------------------------------------------------
async function play() {
  if (!canPlay.value) {
    if (placements.value.length === 0) errorMsg.value = 'Place at least one hand before playing'
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

async function spinTopBar(pass: TopBarPass) {
  subPhase.value = 'spinning'
  topLocked.value = Array(COLS).fill(null)
  // Build a fresh reel per column with the real result fixed at FINAL_INDEX.
  topReels.value = pass.slots.map((slot) => {
    const items = Array.from({ length: REEL_LEN }, (_, i) => (i === FINAL_INDEX ? symFor(slot) : randomSym()))
    return { items, offset: 0, transition: false }
  })
  await nextTick()
  await sleep(40)
  for (let c = 0; c < COLS; c++) {
    topReels.value[c]!.transition = true
    topReels.value[c]!.offset = -(FINAL_INDEX * TOP_CELL)
  }
  await sleep(SPIN_MS + STAGGER * (COLS - 1) + 220)
  topLocked.value = pass.slots.map(s => s)
}

async function applyPass(pass: TopBarPass) {
  subPhase.value = 'applying'
  for (let c = 0; c < COLS; c++) {
    activeApplyCol.value = c
    const slot = pass.slots[c]!
    await sleep(150)
    if (slot.type === 'multiplier') {
      for (const tile of slot.tiles) {
        const cur = tileMult.value[tile] ?? 1
        tileMult.value = { ...tileMult.value, [tile]: Math.min(cur * (slot.value ?? 1), result.value!.tileCap) }
        stampedTile.value = tile
        await sleep(230)
      }
    } else if (slot.type === 'reroll') {
      await sleep(160)
    }
    await sleep(90)
  }
  activeApplyCol.value = -1
  stampedTile.value = null
}

async function runReveal(data: { gameData: GoldPartyResult, balance: number }) {
  const res = data.gameData

  // 1. Top bar — spin, process, and re-spin on each reroll pass.
  phase.value = 'topbar'
  await sleep(250)
  for (let p = 0; p < res.passes.length; p++) {
    const pass = res.passes[p]!
    passLabel.value = res.passes.length > 1 ? `Spin ${p + 1}` : ''
    await spinTopBar(pass)
    await sleep(250)
    await applyPass(pass)
    if (pass.hasReroll && p < res.passes.length - 1) {
      subPhase.value = 'reroll'
      await sleep(950)
    }
  }
  passLabel.value = ''
  subPhase.value = ''

  // 2. Reveal the winning tiles one by one — save the player's hits for the climax.
  phase.value = 'winners'
  await sleep(450)
  const placed = new Set(res.placements)
  const blanks = shuffle(res.winnerTiles.filter(t => !placed.has(t)))
  const hits = res.winnerTiles.filter(t => placed.has(t))
  for (const t of blanks) {
    revealedWinners.value.add(t)
    await sleep(160)
  }
  await sleep(250)
  for (const t of hits) {
    revealedWinners.value.add(t)
    await sleep(380)
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
const bestHand = computed(() =>
  winningHands.value.reduce((mx, w) => Math.max(mx, w.multiplier), 0)
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
        98% RTP · place hands, chase stacking gold multipliers
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
              Auto 10
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
                :class="placements.length > 0 ? 'text-primary' : 'text-muted'"
              >
                {{ placements.length }} / {{ MAX_HANDS }}
              </span>
            </div>
            <USeparator />
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Total cost</span>
              <span class="font-bold tabular-nums">${{ formatNumber(totalStake, false) }}</span>
            </div>
          </div>

          <!-- Multiplier legend -->
          <div class="rounded-lg bg-elevated border border-default p-3">
            <p class="text-xs text-muted uppercase tracking-wide font-medium mb-2">
              Multipliers · stack &amp; cap 2500×
            </p>
            <div class="grid grid-cols-5 gap-1.5">
              <span
                v-for="m in GOLD_PARTY_MULTIPLIERS"
                :key="m"
                class="text-center text-xs font-bold font-mono rounded border py-1"
                :class="tierClass(m)"
              >{{ m }}×</span>
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
            <!-- Top bar (slot-machine reels) -->
            <div class="relative">
              <div class="grid grid-cols-5 gap-2 mb-3">
                <div
                  v-for="(reel, c) in topReels"
                  :key="c"
                  class="relative rounded-lg border overflow-hidden transition-all duration-200 font-black font-mono"
                  :style="{ height: `${TOP_CELL}px` }"
                  :class="topCellClass(c)"
                >
                  <div
                    class="flex flex-col"
                    :style="{
                      transform: `translateY(${reel.offset}px)`,
                      transition: reel.transition ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.12, 1) ${c * STAGGER}ms` : 'none'
                    }"
                  >
                    <div
                      v-for="(sym, si) in reel.items"
                      :key="si"
                      class="shrink-0 flex items-center justify-center"
                      :style="{ height: `${TOP_CELL}px` }"
                      :class="sym.kind === 'mult' ? tierClass(sym.value ?? 0).split(' ').filter(x => x.startsWith('text-')).join(' ') : ''"
                    >
                      <UIcon
                        v-if="sym.kind === 'pending'"
                        name="i-lucide-circle-help"
                        class="size-5 text-muted/40"
                      />
                      <UIcon
                        v-else-if="sym.kind === 'reroll'"
                        name="i-lucide-refresh-cw"
                        class="size-5 text-info"
                      />
                      <UIcon
                        v-else-if="sym.kind === 'nothing'"
                        name="i-lucide-minus"
                        class="size-5 text-muted"
                      />
                      <span
                        v-else
                        class="text-sm sm:text-base"
                      >{{ sym.value }}×</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Reroll flash -->
              <Transition name="pop">
                <div
                  v-if="subPhase === 'reroll'"
                  class="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  <span class="px-4 py-1.5 rounded-full bg-info text-inverted font-black text-sm uppercase tracking-wider shadow-lg animate-pulse">
                    <UIcon
                      name="i-lucide-refresh-cw"
                      class="size-4 -mt-0.5 mr-1 inline animate-spin"
                    />Reroll — spin again!
                  </span>
                </div>
              </Transition>
            </div>

            <!-- Grid -->
            <div class="grid grid-cols-5 gap-2">
              <button
                v-for="i in tiles"
                :key="i"
                type="button"
                :disabled="!canEdit"
                class="relative aspect-square rounded-lg border flex items-center justify-center transition-all duration-200 select-none"
                :class="[tileClass(i), canEdit ? 'cursor-pointer hover:border-primary/60' : 'cursor-default', stampedTile === i ? 'animate-pulse' : '']"
                @click="toggleTile(i)"
              >
                <!-- multiplier value -->
                <span
                  v-if="multValue(i) !== undefined"
                  :key="`m-${i}-${multValue(i)}`"
                  class="font-black text-xs sm:text-base tabular-nums leading-none pop-in"
                >{{ multValue(i) }}×</span>

                <!-- winner coin (winner tile, no multiplier) -->
                <Transition name="pop">
                  <UIcon
                    v-if="revealedWinners.has(i) && multValue(i) === undefined"
                    name="i-lucide-coins"
                    class="size-5 sm:size-6"
                  />
                </Transition>

                <!-- hand marker -->
                <UIcon
                  v-if="placedSet.has(i)"
                  name="i-lucide-hand"
                  class="absolute top-0.5 right-0.5 size-4 sm:size-5 transition-colors duration-200"
                  :class="handColor(i)"
                />
              </button>
            </div>

            <!-- Status line -->
            <div class="mt-4 text-center text-sm font-mono h-6">
              <span
                v-if="phase === 'idle'"
                class="text-muted"
              >
                <template v-if="placements.length === 0">Click tiles to place your hands</template>
                <template v-else>{{ placements.length }} hand{{ placements.length > 1 ? 's' : '' }} · ${{ formatNumber(totalStake, false) }} — press Play</template>
              </span>
              <span
                v-else-if="phase === 'fetching'"
                class="text-muted animate-pulse"
              >Dealing…</span>
              <span
                v-else-if="phase === 'topbar' && subPhase === 'spinning'"
                class="text-primary"
              >Spinning the top bar… {{ passLabel }}</span>
              <span
                v-else-if="phase === 'topbar' && subPhase === 'applying'"
                class="text-warning"
              >Stamping multipliers…</span>
              <span
                v-else-if="phase === 'topbar' && subPhase === 'reroll'"
                class="text-info"
              >Reroll! Another top bar incoming…</span>
              <span
                v-else-if="phase === 'winners'"
                class="text-success"
              >Picking winning tiles…</span>
              <span
                v-else-if="phase === 'done' && result"
                :class="result.won ? 'text-success font-bold' : 'text-muted'"
              >
                {{ result.won ? `You won $${formatNumber(result.payout, false)}!` : `Paid $${formatNumber(result.payout, false)}` }}
              </span>
            </div>
          </div>

          <!-- Result overlay — sits over the board, click anywhere outside (or Play) to dismiss -->
          <Transition name="result-pop">
            <div
              v-if="showPayout && result"
              class="absolute inset-0 z-30 flex items-center justify-center p-4 bg-default/85 backdrop-blur-sm cursor-pointer"
              @click="showPayout = false"
            >
              <div
                class="w-full max-w-xs rounded-2xl border border-default bg-elevated shadow-2xl p-5 text-center space-y-3 cursor-default"
                @click.stop
              >
                <div
                  class="mx-auto size-14 rounded-full flex items-center justify-center"
                  :class="result.won ? 'bg-success/15 text-success' : 'bg-default text-muted'"
                >
                  <UIcon
                    :name="result.won ? 'i-lucide-party-popper' : 'i-lucide-circle-slash'"
                    class="size-7"
                  />
                </div>

                <div>
                  <p class="text-xs text-muted uppercase tracking-widest font-medium">
                    {{ result.won ? 'You won' : 'Round over' }}
                  </p>
                  <p
                    class="text-3xl font-black tabular-nums mt-1"
                    :class="result.won ? 'text-success' : 'text-highlighted'"
                  >
                    ${{ formatNumber(result.payout, false) }}
                  </p>
                  <p
                    class="text-sm font-mono mt-1"
                    :class="profit >= 0 ? 'text-success' : 'text-error'"
                  >
                    {{ profit >= 0 ? '+' : '' }}{{ formatNumber(profit, false) }} net
                  </p>
                </div>

                <div class="grid grid-cols-2 gap-2 text-sm">
                  <div class="rounded-lg bg-default border border-default p-2">
                    <p class="text-muted text-xs">
                      Winning hands
                    </p>
                    <p class="font-bold tabular-nums">
                      {{ winningHands.length }} / {{ result.handCount }}
                    </p>
                  </div>
                  <div class="rounded-lg bg-default border border-default p-2">
                    <p class="text-muted text-xs">
                      Best winning hand
                    </p>
                    <p
                      class="font-bold tabular-nums"
                      :class="bestHand > 1 ? 'text-warning' : ''"
                    >
                      {{ bestHand > 0 ? `${bestHand}×` : '—' }}
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
                <p class="text-xs text-muted/70">
                  Click outside or press Play
                </p>
              </div>
            </div>
          </Transition>
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

    <!-- Help -->
    <UModal
      v-model:open="showHelp"
      title="How Gold Party works"
      :ui="{ content: 'max-w-md' }"
    >
      <template #body>
        <ul class="text-sm text-muted space-y-2 list-disc list-inside">
          <li>Pick a <strong class="text-default">hand value</strong> and click tiles to place hands (up to the whole board). Cost = hands × value.</li>
          <li>On Play the <strong class="text-default">top bar</strong> spins like a slot. Each of the 5 slots lands on nothing, a <strong class="text-warning">multiplier</strong>, or a <strong class="text-info">reroll</strong>.</li>
          <li>Each multiplier stamps its value onto <strong class="text-default">1–4 tiles</strong> in that column.</li>
          <li>A <strong class="text-info">reroll</strong> spins a whole new top bar after the current one finishes. Multipliers landing on the same tile <strong class="text-default">stack</strong> (e.g. 50× then 10× = 500×) — capped at 2500× per tile.</li>
          <li>Then <strong class="text-success">2–8 tiles</strong> are revealed as winners. A hand on a winning tile pays <strong class="text-default">hand value × that tile's multiplier</strong> (a plain winner returns your 1×).</li>
          <li>Max win 2500× total stake — and the odds are identical no matter how many hands you place.</li>
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

.result-pop-enter-active, .result-pop-leave-active { transition: opacity 0.2s ease; }
.result-pop-enter-from, .result-pop-leave-to { opacity: 0; }
.result-pop-enter-active > div, .result-pop-leave-active > div { transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
.result-pop-enter-from > div, .result-pop-leave-to > div { transform: scale(0.85); }

.pop-in { animation: pop-in 0.32s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes pop-in {
  0% { opacity: 0; transform: scale(0.3); }
  100% { opacity: 1; transform: scale(1); }
}

input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
</style>
