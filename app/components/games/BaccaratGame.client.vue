<script setup lang="ts">
import { chipRackFor } from '#shared/utils/live-blackjack/chips'
import { bigEyeBoyMarks, bigRoadCells, bigRoadColumns } from '#shared/utils/baccarat/roadmap'
import type { BacAction, BacBetKey, BacSeatState, BacSharedState } from '#shared/utils/baccarat/types'
import type { LtSeat } from '#shared/utils/live-table/types'
import { cardBack, cardFace, chip, chipStack } from '~/utils/live-table/art'
import type { LtFeedItem } from '~/composables/live-table'

const SEAT_POS = [
    { x: 208, y: 546 },
    { x: 504, y: 604 },
    { x: 800, y: 630 },
    { x: 1096, y: 604 },
    { x: 1392, y: 546 }
]

const SPOT_DEFS: { key: BacBetKey, dx: number, r: number, chip: number, label: string }[] = [
    { key: 'playerPair', dx: -126, r: 16, chip: 16, label: 'PR' },
    { key: 'player', dx: -68, r: 36, chip: 26, label: 'PLAYER' },
    { key: 'tie', dx: 0, r: 26, chip: 22, label: 'TIE' },
    { key: 'banker', dx: 68, r: 36, chip: 26, label: 'BANKER' },
    { key: 'bankerPair', dx: 126, r: 16, chip: 16, label: 'PR' }
]

const SPOT_LABEL: Record<BacBetKey, string> = {
    player: 'Player',
    banker: 'Banker',
    tie: 'Tie',
    playerPair: 'Player Pair',
    bankerPair: 'Banker Pair'
}

let feedRef: Ref<LtFeedItem[]> | null = null
let localFeedSeq = 0

function onGameEvent(payload: unknown) {
    if (!feedRef) return
    const data = payload as { type: string, name?: string, spot?: BacBetKey, amount?: number }
    if (data.type === 'shuffle') {
        feedRef.value.push({ id: -(++localFeedSeq), kind: 'game', tone: 'neutral', text: 'Shoe reshuffled · 6 decks in play' })
    } else if (data.type === 'bet' && data.name && data.spot && data.amount) {
        feedRef.value.push({
            id: -(++localFeedSeq),
            kind: 'game',
            tone: 'neutral',
            text: `${data.name} bet ${formatNumber(data.amount)} on ${SPOT_LABEL[data.spot]}`
        })
    }
}

const table = useLiveTable<BacSeatState, BacSharedState, BacAction>('baccarat', onGameEvent)
const { state, youId, balance, connected, feed, chat, mySeat } = table
feedRef = feed

const round = computed(() => state.value?.game.round ?? null)
const history = computed(() => state.value?.game.history ?? [])
const bigRoad = computed(() => bigRoadCells(history.value))
const eyeBoy = computed(() => bigEyeBoyMarks(bigRoadColumns(history.value)))

const showTotals = computed(() => state.value?.phase === 'resolve' || state.value?.phase === 'payout')
const isBetting = computed(() => state.value?.phase === 'betting')

const rack = computed(() => chipRackFor(balance.value).map(c => c.value))
const selectedChip = ref(rack.value[3] ?? rack.value[0] ?? 25)
watch(rack, (values) => {
    if (!values.includes(selectedChip.value)) selectedChip.value = values[Math.min(3, values.length - 1)] ?? values[0] ?? 25
})

const myTotalBet = computed(() => {
    const bets = mySeat.value?.game.bets
    if (!bets) return 0
    return Object.values(bets).reduce((sum, amount) => sum + amount, 0)
})

const cardsRemaining = computed(() => {
    const shoe = state.value?.game.shoe
    return shoe ? Math.max(0, shoe.total - shoe.dealt) : 0
})
const untilShuffle = computed(() => state.value?.game.shoe.untilShuffle ?? 0)

const clockTick = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => { clockTimer = setInterval(() => { clockTick.value = Date.now() }, 250) })
onBeforeUnmount(() => { if (clockTimer) clearInterval(clockTimer) })

const secondsLeft = computed(() => {
    const snapshot = state.value
    if (!snapshot?.phaseEndsAt) return null
    const skewed = clockTick.value + (snapshot.now - Date.now())
    return Math.max(0, Math.ceil((snapshot.phaseEndsAt - skewed) / 1000))
})

const phaseLabel = computed(() => {
    const phase = state.value?.phase
    if (phase === 'betting') return 'PLACE YOUR BETS'
    if (phase === 'dealing') return 'DEALING'
    if ((phase === 'resolve' || phase === 'payout') && round.value) {
        if (round.value.winner === 'tie') return 'TIE'
        return round.value.winner === 'player' ? 'PLAYER WINS' : 'BANKER WINS'
    }
    return state.value?.message.toUpperCase() ?? 'WAITING FOR PLAYERS'
})

function seatAt(index: number): LtSeat<BacSeatState> | null {
    return state.value?.seats[index] ?? null
}

function canBetHere(seat: LtSeat<BacSeatState> | null): boolean {
    return !!seat && seat.userId === youId.value && isBetting.value
}

function spotWins(spot: BacBetKey): boolean {
    if (!round.value) return false
    if (spot === 'player') return round.value.winner === 'player'
    if (spot === 'banker') return round.value.winner === 'banker'
    if (spot === 'tie') return round.value.winner === 'tie'
    if (spot === 'playerPair') return round.value.playerPair
    return round.value.bankerPair
}

function badgeClass(side: 'player' | 'banker'): string {
    if (!round.value) return ''
    if (round.value.winner === 'tie') return 'push'
    return round.value.winner === side ? 'win' : 'lose'
}

function placeBet(spot: BacBetKey) {
    if (!isBetting.value || !mySeat.value) return
    table.act({ kind: 'bet', spot, amount: selectedChip.value })
}

function clearBets() {
    table.act({ kind: 'clear' })
}
</script>

<template>
  <div class="flex flex-col gap-3 lg:flex-row lg:items-start">
    <div class="min-w-0 flex-1">
      <LiveTableStage>
        <template v-if="round">
          <TransitionGroup name="lt-deal" tag="div" class="lt-hand" style="left:640px;top:196px">
            <span v-for="card in round.playerCards" :key="card.id" v-html="cardFace(card.rank!, card.suit!)" />
          </TransitionGroup>
          <TransitionGroup name="lt-deal" tag="div" class="lt-hand" style="left:960px;top:196px">
            <span v-for="card in round.bankerCards" :key="card.id" v-html="cardFace(card.rank!, card.suit!)" />
          </TransitionGroup>
        </template>

        <template v-if="showTotals && round">
          <div class="lt-badge" :class="badgeClass('player')" style="left:640px;top:300px;font-size:24px;padding:6px 18px">
            PLAYER {{ round.playerTotal }}<span v-if="round.playerNatural"> · NATURAL</span>
          </div>
          <div class="lt-badge" :class="badgeClass('banker')" style="left:960px;top:300px;font-size:24px;padding:6px 18px">
            BANKER {{ round.bankerTotal }}<span v-if="round.bankerNatural"> · NATURAL</span>
          </div>
        </template>

        <div class="lt-rules" style="top:348px">
          PLAYER PAYS 1:1 &middot; BANKER PAYS 0.95:1 &middot; TIE PAYS 8:1 &middot; PAIRS PAY 11:1
        </div>

        <div class="lt-phase" style="top:394px">
          <span class="label">{{ phaseLabel }}</span>
          <span v-if="secondsLeft !== null" class="count" :class="{ urgent: secondsLeft <= 5 }">{{ secondsLeft }}</span>
        </div>

        <template v-for="(pos, i) in SEAT_POS" :key="i">
          <div
            v-if="!seatAt(i)"
            class="lt-plate bac-sit"
            :style="{ left: `${pos.x}px`, top: `${pos.y + 226}px` }"
            @click="table.sit(i)"
          >
            <span class="nm">SIT HERE</span>
          </div>
          <template v-else>
            <div
              v-for="def in SPOT_DEFS"
              :key="def.key"
              class="lt-spot"
              :class="{
                lit: showTotals && spotWins(def.key),
                you: seatAt(i)!.userId === youId && seatAt(i)!.game.bets[def.key] > 0
              }"
              :style="{
                left: `${pos.x + def.dx}px`,
                top: `${pos.y + 106}px`,
                width: `${def.r * 2}px`,
                height: `${def.r * 2}px`,
                margin: `${-def.r}px 0 0 ${-def.r}px`,
                cursor: canBetHere(seatAt(i)) ? 'pointer' : 'default'
              }"
              @click="canBetHere(seatAt(i)) && placeBet(def.key)"
            >
              <span class="lt-spot-label" :style="{ fontSize: `${def.r >= 30 ? 11 : 9}px` }">{{ def.label }}</span>
              <div
                v-if="seatAt(i)!.game.bets[def.key] > 0"
                style="position:absolute;bottom:6px"
                v-html="chipStack(seatAt(i)!.game.bets[def.key], { size: def.chip })"
              />
            </div>
            <div
              class="lt-plate"
              :class="{ you: seatAt(i)!.userId === youId }"
              :style="{ left: `${pos.x}px`, top: `${pos.y + 226}px` }"
            >
              <span class="nm">{{ seatAt(i)!.name }}</span>
              <span v-if="seatAt(i)!.winStreak > 1" class="lt-streak">{{ seatAt(i)!.winStreak }}</span>
              <span
                class="net lt-mono"
                :class="seatAt(i)!.sessionNet > 0 ? 'up' : seatAt(i)!.sessionNet < 0 ? 'down' : ''"
              >{{ seatAt(i)!.sessionNet > 0 ? '+' : '' }}{{ formatNumber(seatAt(i)!.sessionNet) }}</span>
            </div>
          </template>
        </template>

        <div v-if="mySeat && isBetting" class="lt-rack">
          <span
            v-for="value in rack"
            :key="value"
            :class="{ sel: value === selectedChip }"
            @click="selectedChip = value"
            v-html="chip(value)"
          />
        </div>
        <div v-if="mySeat && isBetting" class="bac-bet-readout">
          <span class="lt-mono">Bet {{ formatNumber(myTotalBet) }}</span>
          <button class="bac-clear-btn" :disabled="!myTotalBet" @click="clearBets">
            Clear
          </button>
        </div>
        <div v-else-if="mySeat" class="bac-bet-readout">
          <span class="lt-mono">Seat {{ mySeat.index + 1 }}</span>
          <button v-if="!mySeat.leaving" class="bac-clear-btn" @click="table.leave()">
            Leave
          </button>
          <span v-else class="text-amber-300">Standing up</span>
        </div>

        <div class="lt-overlay" style="left:56px;top:78px;width:400px">
          <h4>Roadmap</h4>
          <div class="bac-road-label">
            Bead Plate
          </div>
          <div class="bac-grid" style="--cell:18px">
            <span
              v-for="(entry, idx) in history"
              :key="idx"
              class="bac-dot"
              :class="`bac-fill-${entry.winner}`"
            >{{ entry.winner === 'tie' ? 'T' : entry.winner === 'player' ? 'P' : 'B' }}</span>
          </div>
          <div class="bac-road-label">
            Big Road
          </div>
          <div class="bac-grid" style="--cell:16px">
            <span
              v-for="(cell, idx) in bigRoad"
              :key="idx"
              class="bac-dot"
              :class="cell.result ? `bac-ring bac-ring-${cell.result} ${cell.tie ? 'tie' : ''}` : 'empty'"
            />
          </div>
          <div class="bac-road-label">
            Big Eye Boy
          </div>
          <div class="bac-eye-row">
            <span v-for="(mark, idx) in eyeBoy" :key="idx" class="bac-eye" :class="mark" />
            <span v-if="!eyeBoy.length" class="text-[10px] text-muted">Not enough hands yet</span>
          </div>
        </div>

        <div class="lt-overlay" style="left:1300px;top:64px;width:222px">
          <h4>Shoe</h4>
          <div class="flex items-center gap-3">
            <div class="bac-shoe-stack">
              <span class="bac-shoe-card" style="left:6px;top:4px" v-html="cardBack()" />
              <span class="bac-shoe-card" style="left:3px;top:2px" v-html="cardBack()" />
              <span class="bac-shoe-card" style="left:0;top:0" v-html="cardBack()" />
              <div class="bac-shoe-cut" />
            </div>
            <div>
              <div class="lt-mono text-2xl font-extrabold leading-none" style="color:var(--lt-gold)">
                {{ cardsRemaining }}
              </div>
              <div class="mt-0.5 text-[10px] text-muted">
                cards remaining
              </div>
              <div class="mt-1.5 text-[10px]" style="color:var(--lt-gold)">
                cut card &middot; {{ untilShuffle }} to go
              </div>
            </div>
          </div>
        </div>

        <div v-if="!connected" class="bac-connecting">
          <UIcon name="i-lucide-loader-circle" class="animate-spin" /> Connecting&hellip;
        </div>
      </LiveTableStage>
    </div>

    <div class="flex h-[min(780px,calc(100vh-300px))] w-full shrink-0 flex-col gap-2 lg:w-80">
      <LiveTableFeed :items="feed" title="Table feed" class="min-h-0 flex-[3]" />
      <LiveTableChat :messages="chat" class="min-h-0 flex-[4]" @send="table.chatSend($event)" />
      <LiveTableScoreboard :entries="state?.scoreboard ?? []" :you-id="youId" class="min-h-0 flex-[3]" />
    </div>
  </div>
</template>

<style scoped>
.bac-sit {
  cursor: pointer;
  justify-content: center;
  border-style: dashed;
  opacity: 0.65;
  transition: opacity 0.15s ease, border-color 0.15s ease;
}
.bac-sit:hover {
  opacity: 1;
  border-color: var(--lt-gold);
}
.bac-sit .nm {
  flex: none;
  text-align: center;
  width: 100%;
  letter-spacing: 0.08em;
  font-size: 12px;
}

.bac-bet-readout {
  position: absolute;
  left: 50%;
  top: 972px;
  transform: translate(-50%, -100%);
  display: flex;
  align-items: center;
  gap: 10px;
  background: color-mix(in srgb, var(--lt-shell) 80%, transparent);
  border: 1.5px solid rgba(217, 177, 103, 0.35);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 700;
  color: #f7f3e8;
  white-space: nowrap;
}
.bac-clear-btn {
  background: rgba(239, 68, 68, 0.25);
  border: 1.5px solid rgba(248, 113, 113, 0.7);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 800;
  color: #fecaca;
  cursor: pointer;
}
.bac-clear-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.bac-shoe-stack {
  position: relative;
  width: 60px;
  height: 78px;
  flex-shrink: 0;
}
.bac-shoe-card {
  position: absolute;
}
.bac-shoe-card :deep(.lt-card) {
  width: 50px;
  height: 70px;
}
.bac-shoe-cut {
  position: absolute;
  left: -4px;
  top: 34px;
  width: 66px;
  height: 3px;
  background: var(--lt-gold);
  box-shadow: 0 0 6px var(--lt-gold);
}

.bac-connecting {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 12px;
  padding: 10px 18px;
  font-size: 14px;
  color: #f7f3e8;
  backdrop-filter: blur(4px);
}

.bac-road-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lt-gold);
  opacity: 0.8;
  margin: 8px 0 4px;
}
.bac-grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(6, var(--cell, 18px));
  grid-auto-columns: var(--cell, 18px);
  gap: 3px;
}
.bac-dot {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 800;
  color: #fff;
}
.bac-dot.empty {
  visibility: hidden;
}
.bac-fill-banker {
  background: var(--ui-error);
}
.bac-fill-player {
  background: var(--ui-info);
}
.bac-fill-tie {
  background: var(--ui-success);
  color: #052e16;
}
.bac-ring {
  background: transparent;
  border-width: 2px;
  border-style: solid;
  position: relative;
}
.bac-ring-banker {
  border-color: var(--ui-error);
}
.bac-ring-player {
  border-color: var(--ui-info);
}
.bac-ring.tie::after {
  content: '';
  position: absolute;
  left: 8%;
  top: 48%;
  width: 84%;
  height: 2px;
  background: var(--ui-success);
  transform: rotate(-30deg);
}
.bac-eye-row {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
  align-items: center;
  min-height: 14px;
}
.bac-eye {
  width: 9px;
  height: 9px;
  border-radius: 999px;
}
.bac-eye.red {
  background: var(--ui-error);
}
.bac-eye.blue {
  background: var(--ui-info);
}

.lt-deal-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.lt-deal-enter-from {
  opacity: 0;
  transform: translateY(-14px) scale(0.9);
}
</style>
