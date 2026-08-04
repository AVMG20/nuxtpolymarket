<script setup lang="ts">
import { CH_AA_TABLE, CH_ANTE_TABLE, CH_CALL_MULTIPLIER } from '#shared/utils/casino-holdem/rules'
import { shouldCall } from '#shared/utils/casino-holdem/strategy'
import type { ChCard } from '#shared/utils/casino-holdem/evaluator'
import type { ChAction, ChBetSpot, ChSeatState, ChSharedState } from '#shared/utils/casino-holdem/types'
import { chipRackFor } from '#shared/utils/live-blackjack/chips'
import type { LtCard } from '#shared/utils/live-table/types'
import { cardBack, cardFace, chip, chipStack } from '~/utils/live-table/art'

const table = useLiveTable<ChSeatState, ChSharedState, ChAction>('casino-holdem')
const { state, youId, balance, connected, feed, chat, mySeat, skew } = table

/** Stage coordinates, shared with the Pixi blackjack scene. */
const SEATS = [
    { x: 208, y: 546 },
    { x: 504, y: 604 },
    { x: 800, y: 630 },
    { x: 1096, y: 604 },
    { x: 1392, y: 546 }
]
const BOARD_X = [544, 672, 800, 928, 1056]
const SLOT_LABEL = ['FLOP', 'FLOP', 'FLOP', 'TURN', 'RIVER']

const PHASE_LABEL: Record<string, string> = {
    idle: 'WAITING',
    betting: 'PLACE YOUR ANTE',
    deal: 'DEALING',
    decision: 'CALL OR FOLD',
    board: 'TURN & RIVER',
    reveal: 'SHOWDOWN',
    payout: 'PAYOUT'
}

const showHints = useCookie<boolean>('ch-show-hint', { default: () => true })
const selectedChip = ref(0)
const now = ref(Date.now())

// The feed already carries every rejection, but it sits in a rail the player
// is not looking at right after a click — a toast is what puts a "seat taken"
// or "insufficient balance" in front of the thing they just clicked.
const toast = useToast()
watch(() => feed.value.length, () => {
    const latest = feed.value[feed.value.length - 1]
    if (latest?.kind === 'error') toast.add({ title: latest.text, color: 'error' })
})

let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => {
    ticker = setInterval(() => {
        now.value = Date.now()
    }, 200)
})
onBeforeUnmount(() => {
    if (ticker) clearInterval(ticker)
})

const rack = computed(() => chipRackFor(balance.value).map(c => c.value))
watch(rack, (values) => {
    if (!values.includes(selectedChip.value)) selectedChip.value = values[Math.min(2, values.length - 1)] ?? 0
}, { immediate: true })

const phase = computed(() => state.value?.phase ?? 'idle')
const isBetting = computed(() => phase.value === 'betting')
const seats = computed(() => state.value?.seats ?? [])
const board = computed(() => state.value?.game.board ?? [])
const dealer = computed(() => state.value?.game.dealer ?? { cards: [], label: null, qualified: null })

const countdown = computed(() => {
    const ends = state.value?.phaseEndsAt
    if (!ends) return null
    return Math.max(0, Math.ceil((ends - (now.value + skew.value)) / 1000))
})

const myAnte = computed(() => mySeat.value?.game.pendingAnte ?? 0)
const myAa = computed(() => mySeat.value?.game.pendingAa ?? 0)
const staked = computed(() => myAnte.value + myAa.value)
const needsDecision = computed(() =>
    phase.value === 'decision' && !!mySeat.value?.game.cards.length && !mySeat.value.game.decision)
const callCost = computed(() => (mySeat.value?.game.ante ?? 0) * CH_CALL_MULTIPLIER)

/** What basic strategy calls for, and only while there is something to call. */
const hint = computed<'call' | 'fold' | null>(() => {
    if (!showHints.value || !needsDecision.value) return null
    const hole = faces(mySeat.value?.game.cards ?? [])
    const flop = faces(board.value.slice(0, 3))
    if (hole.length !== 2 || flop.length !== 3) return null
    return shouldCall(hole, flop) ? 'call' : 'fold'
})

function faces(cards: LtCard[]): ChCard[] {
    return cards.filter((c): c is LtCard & ChCard => !!c.rank && !!c.suit)
        .map(c => ({ rank: c.rank, suit: c.suit }))
}

// Card backs carry a random clip-path id, so they are memoised per card —
// re-rolling one on every snapshot would repaint the whole hand.
const backs = new Map<string, string>()
function renderCard(card: LtCard): string {
    if (card.rank && card.suit) return cardFace(card.rank, card.suit)
    let back = backs.get(card.id)
    if (!back) {
        back = cardBack()
        backs.set(card.id, back)
    }
    return back
}

function stackFor(amount: number, size: number): string {
    return chipStack(amount, { size, max: 6 })
}

function place(spot: ChBetSpot) {
    if (!isBetting.value || !mySeat.value || !selectedChip.value) return
    table.act({ t: 'bet', spot, amount: selectedChip.value })
}

function badgeFor(seat: ChSeatState): { text: string, tone: string } | null {
    if (seat.outcome === 'folded') return { text: 'FOLDED', tone: 'lose' }
    if (seat.outcome === 'push') return { text: 'PUSH', tone: 'push' }
    if (seat.outcome === 'lose') return { text: 'LOSE', tone: 'lose' }
    if (seat.outcome === 'win') {
        const amount = `+${formatNumber(seat.net ?? 0)}`
        return seat.dealerQualified
            ? { text: `WIN ${amount}`, tone: 'win' }
            : { text: `DEALER OUT ${amount}`, tone: 'gold' }
    }
    if (seat.decision === 'call') return { text: 'CALLED', tone: 'win' }
    if (seat.decision === 'fold') return { text: 'FOLDED', tone: 'lose' }
    return null
}
</script>

<template>
  <div class="flex flex-col gap-3 lg:flex-row">
    <div class="min-w-0 flex-1">
      <LiveTableStage>
        <!-- Dealer, scaled down so the hole cards clear the board row below them -->
        <div
          class="lt-hand"
          style="left: 800px; top: 142px; transform: translate(-50%, -50%) scale(0.82)"
        >
          <div v-for="card in dealer.cards" :key="card.id" v-html="renderCard(card)" />
        </div>
        <div class="ch-caption" style="left: 890px; top: 142px">
          <span class="ch-caption-tag">DEALER</span>
          <span v-if="dealer.label">{{ dealer.label }}</span>
          <span v-else class="opacity-50">two cards down</span>
        </div>

        <!-- Community board: dealt cards, then dashed slots for what is still to come -->
        <div
          v-for="(card, i) in board"
          :key="card.id"
          class="ch-board-card"
          :style="{ left: `${BOARD_X[i]}px`, top: '292px' }"
          v-html="renderCard(card)"
        />
        <div
          v-for="i in 5 - board.length"
          :key="`slot-${i}`"
          class="ch-slot"
          :style="{ left: `${BOARD_X[board.length + i - 1]}px`, top: '292px' }"
        >
          <span>{{ SLOT_LABEL[board.length + i - 1] }}</span>
        </div>

        <div class="lt-rules" style="top: 372px">
          DEALER QUALIFIES WITH A PAIR OF FOURS OR BETTER
        </div>
        <div class="lt-phase" style="top: 398px">
          <span class="label">{{ PHASE_LABEL[phase] ?? phase.toUpperCase() }}</span>
          <span v-if="countdown !== null" class="count" :class="{ urgent: countdown <= 5 }">{{ countdown }}</span>
        </div>

        <!-- Paytables -->
        <div class="lt-overlay" style="left: 40px; top: 64px; width: 440px">
          <h4>Side bet paytables</h4>
          <div class="flex gap-5">
            <div class="flex-1">
              <div class="ch-paytitle">
                AA Bonus
              </div>
              <div v-for="row in CH_AA_TABLE" :key="`aa-${row.label}`" class="ch-payrow">
                {{ row.label }}<span>{{ row.pays }}:1</span>
              </div>
            </div>
            <div class="flex-1">
              <div class="ch-paytitle">
                Ante bonus
              </div>
              <div v-for="row in CH_ANTE_TABLE" :key="`ante-${row.label}`" class="ch-payrow">
                {{ row.label }}<span>{{ row.pays }}:1</span>
              </div>
            </div>
          </div>
        </div>

        <div class="lt-overlay amber" style="left: 1160px; top: 64px; width: 360px">
          <h4>Simultaneous action</h4>
          <p class="text-[15px] leading-relaxed text-[#f7f3e8]">
            Every seat plays the dealer, never each other, and all five decide on one shared clock.
            Several seats can win the same hand.
          </p>
        </div>

        <!-- Seats -->
        <template v-for="(spot, index) in SEATS" :key="index">
          <template v-if="seats[index]">
            <div
              class="lt-hand"
              :style="{
                left: `${spot.x}px`,
                top: `${spot.y - 100}px`,
                opacity: seats[index]!.game.decision === 'fold' ? 0.4 : 1
              }"
            >
              <div v-for="card in seats[index]!.game.cards" :key="card.id" v-html="renderCard(card)" />
            </div>

            <div
              v-if="badgeFor(seats[index]!.game)"
              class="lt-badge"
              :class="badgeFor(seats[index]!.game)!.tone"
              :style="{ left: `${spot.x}px`, top: `${spot.y + 10}px` }"
            >
              {{ badgeFor(seats[index]!.game)!.text }}
            </div>
            <div
              v-else-if="needsDecision && seats[index]!.userId === youId"
              class="ch-decision"
              :style="{ left: `${spot.x}px`, top: `${spot.y + 14}px` }"
            >
              <button
                class="ch-tile ch-tile-green"
                :class="{ 'ch-hint': hint === 'call' }"
                @click="table.act({ t: 'decide', decision: 'call' })"
              >
                CALL {{ formatNumber(callCost) }}
              </button>
              <button
                class="ch-tile ch-tile-red"
                :class="{ 'ch-hint': hint === 'fold' }"
                @click="table.act({ t: 'decide', decision: 'fold' })"
              >
                FOLD
              </button>
            </div>

            <div
              v-if="seats[index]!.game.handLabel"
              class="ch-readout"
              :style="{
                left: `${spot.x}px`,
                top: `${spot.y + 52}px`,
                opacity: seats[index]!.game.decision === 'fold' ? 0.55 : 1
              }"
            >
              {{ seats[index]!.game.handLabel }}
            </div>

            <!-- AA bonus, then ante and call -->
            <div
              class="lt-spot ch-spot-small"
              :class="{ you: seats[index]!.userId === youId && isBetting, 'ch-clickable': seats[index]!.userId === youId && isBetting }"
              :style="{ left: `${spot.x - 110}px`, top: `${spot.y + 132}px` }"
              @click="seats[index]!.userId === youId && place('aa')"
            >
              <div
                v-if="seats[index]!.game.aa || seats[index]!.game.pendingAa"
                class="ch-chips"
                v-html="stackFor(seats[index]!.game.aa || seats[index]!.game.pendingAa, 30)"
              />
              <span v-else class="lt-spot-label" style="font-size: 11px">AA<br>BONUS</span>
            </div>
            <div
              v-if="seats[index]!.game.aaMultiplier"
              class="ch-aa-win"
              :style="{ left: `${spot.x - 110}px`, top: `${spot.y + 178}px` }"
            >
              AA {{ seats[index]!.game.aaMultiplier }}:1
            </div>

            <div class="ch-spotlabel" :style="{ left: `${spot.x - 20}px`, top: `${spot.y + 70}px` }">
              ANTE
            </div>
            <div
              class="lt-spot"
              :class="{ you: seats[index]!.userId === youId, lit: !!seats[index]!.game.ante, 'ch-clickable': seats[index]!.userId === youId && isBetting }"
              :style="{ left: `${spot.x - 20}px`, top: `${spot.y + 132}px` }"
              @click="seats[index]!.userId === youId && place('ante')"
            >
              <div
                v-if="seats[index]!.game.ante || seats[index]!.game.pendingAnte"
                class="ch-chips"
                v-html="stackFor(seats[index]!.game.ante || seats[index]!.game.pendingAnte, 52)"
              />
            </div>

            <div class="ch-spotlabel" :style="{ left: `${spot.x + 90}px`, top: `${spot.y + 70}px` }">
              CALL
            </div>
            <div
              class="lt-spot"
              :class="{ you: seats[index]!.userId === youId }"
              :style="{ left: `${spot.x + 90}px`, top: `${spot.y + 132}px` }"
            >
              <div
                v-if="seats[index]!.game.call"
                class="ch-chips"
                v-html="stackFor(seats[index]!.game.call, 52)"
              />
              <span v-else class="lt-spot-label">CALL<br>{{ CH_CALL_MULTIPLIER }}&times;</span>
            </div>

            <div
              class="lt-plate"
              :class="{ you: seats[index]!.userId === youId }"
              :style="{ left: `${spot.x}px`, top: `${spot.y + 226}px` }"
            >
              <span class="nm">{{ seats[index]!.name }}</span>
              <span v-if="seats[index]!.winStreak > 1" class="lt-streak">{{ seats[index]!.winStreak }}</span>
              <span
                class="net lt-mono"
                :class="seats[index]!.sessionNet > 0 ? 'up' : seats[index]!.sessionNet < 0 ? 'down' : ''"
              >{{ seats[index]!.sessionNet > 0 ? '+' : '' }}{{ formatNumber(seats[index]!.sessionNet) }}</span>
            </div>
          </template>

          <div
            v-else-if="!mySeat"
            class="lt-spot ch-sit"
            :style="{ left: `${spot.x}px`, top: `${spot.y + 106}px` }"
            @click="table.sit(index)"
          >
            <span class="lt-spot-label">SIT</span>
          </div>
        </template>

        <!-- Chip rail, or the phase message once betting closes -->
        <div v-if="isBetting && mySeat" class="lt-rack">
          <span
            v-for="value in rack"
            :key="value"
            :class="{ sel: value === selectedChip }"
            @click="selectedChip = value"
            v-html="chip(value)"
          />
        </div>
        <div v-else class="ch-status">
          <template v-if="!connected">Connecting…</template>
          <template v-else-if="!mySeat">Click an open <span class="ch-status-sit">SIT</span> spot to join the table</template>
          <template v-else>{{ state?.message }}</template>
        </div>

        <div v-if="isBetting && mySeat" class="ch-panel" style="left: 40px; top: 986px; width: 300px">
          <div class="flex items-baseline justify-between">
            <span class="ch-panel-label">Ante</span>
            <span class="lt-mono text-[22px] font-bold text-[#f0c674]">{{ formatNumber(myAnte) }}</span>
          </div>
          <div class="flex items-baseline justify-between">
            <span class="ch-panel-label">AA bonus</span>
            <span class="lt-mono text-[17px] font-bold text-[#f7f3e8]">{{ formatNumber(myAa) }}</span>
          </div>
          <div class="mt-1.5 flex gap-1.5">
            <button class="ch-tile ch-tile-amber flex-1" :disabled="!mySeat.game.lastAnte" @click="table.act({ t: 'repeat' })">
              REPEAT
            </button>
            <button class="ch-tile ch-tile-slate flex-1" :disabled="!staked" @click="table.act({ t: 'undo' })">
              UNDO
            </button>
            <button class="ch-tile ch-tile-red flex-1" :disabled="!staked" @click="table.act({ t: 'clear' })">
              CLEAR
            </button>
          </div>
        </div>

        <div class="ch-panel" style="left: 1260px; top: 986px; width: 300px">
          <div class="flex items-center justify-between">
            <span class="ch-panel-label">{{ mySeat ? `Seat ${mySeat.index + 1}` : 'Watching' }}</span>
            <span class="lt-mono text-[15px] text-[#f7f3e8]/70">{{ state?.watching ?? 0 }} watching</span>
          </div>
          <div class="mt-1.5 flex gap-1.5">
            <button class="ch-tile ch-tile-slate flex-1" @click="showHints = !showHints">
              HINTS {{ showHints ? 'ON' : 'OFF' }}
            </button>
            <button v-if="mySeat && !mySeat.leaving" class="ch-tile ch-tile-red flex-1" @click="table.leave()">
              LEAVE
            </button>
            <span v-else-if="mySeat" class="ch-tile ch-tile-slate flex-1 text-center opacity-70">STANDING UP</span>
          </div>
        </div>
      </LiveTableStage>
    </div>

    <aside class="ch-rail flex w-full shrink-0 flex-col gap-3 lg:w-75">
      <LiveTableFeed :items="feed" class="flex-1" />
      <LiveTableChat :messages="chat" class="flex-[1.2]" @send="table.chatSend" />
      <LiveTableScoreboard :entries="state?.scoreboard ?? []" :you-id="youId" class="flex-1" />
    </aside>
  </div>
</template>

<style scoped>
.ch-rail {
  height: min(780px, calc(100vh - 300px));
}

.ch-caption {
  position: absolute;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 250px;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #d9b167;
}
.ch-caption-tag {
  font-size: 13px;
  letter-spacing: 0.16em;
  color: rgba(217, 177, 103, 0.6);
}

.lt-overlay h4 {
  font-size: 14px;
}

.ch-board-card {
  position: absolute;
  transform: translate(-50%, -50%);
}

.ch-slot {
  position: absolute;
  width: 112px;
  height: 156px;
  transform: translate(-50%, -50%);
  border: 2px dashed rgba(217, 177, 103, 0.35);
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.12);
}
.ch-slot span {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: rgba(217, 177, 103, 0.5);
}

.ch-paytitle {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ui-warning);
  margin-bottom: 6px;
}
.ch-payrow {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 14px;
  color: #f7f3e8;
  padding: 1.5px 0;
}
.ch-payrow span {
  color: #d9b167;
  font-weight: 800;
  font-family: ui-monospace, Menlo, monospace;
}

.ch-readout {
  position: absolute;
  transform: translate(-50%, -50%);
  white-space: nowrap;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #d9b167;
}

.ch-spotlabel {
  position: absolute;
  transform: translate(-50%, -50%);
  white-space: nowrap;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: rgba(217, 177, 103, 0.65);
}

.ch-aa-win {
  position: absolute;
  transform: translate(-50%, -50%);
  white-space: nowrap;
  font-size: 14px;
  font-weight: 800;
  color: var(--ui-success);
}

/* Chips sit on the floor of a spot rather than centred, the way a real pile does. */
.ch-chips {
  position: absolute;
  bottom: 8px;
}

.ch-spot-small {
  width: 60px;
  height: 60px;
  margin: -30px 0 0 -30px;
}
.ch-spot-small .ch-chips {
  bottom: 4px;
}

.ch-clickable {
  cursor: pointer;
}

/* Wider than a bet spot and pulsing so an empty seat reads as clickable
   furniture rather than a stray circle on the felt. */
.ch-sit {
  width: 116px;
  height: 116px;
  margin: -58px 0 0 -58px;
  cursor: pointer;
  border-width: 3px;
  border-color: rgba(217, 177, 103, 0.75);
  background: rgba(217, 177, 103, 0.08);
  animation: ch-sit-pulse 1.8s ease-in-out infinite;
}
.ch-sit .lt-spot-label {
  font-size: 16px;
  opacity: 1;
}
.ch-sit:hover {
  border-color: #d9b167;
  background: rgba(217, 177, 103, 0.16);
  box-shadow: 0 0 26px rgba(217, 177, 103, 0.55);
}
@keyframes ch-sit-pulse {
  50% {
    box-shadow: 0 0 18px rgba(217, 177, 103, 0.4);
  }
}

.ch-status-sit {
  font-weight: 800;
  color: #d9b167;
}

.ch-decision {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  gap: 10px;
}

.ch-status {
  position: absolute;
  left: 50%;
  top: 1048px;
  transform: translate(-50%, -50%);
  white-space: nowrap;
  font-size: 24px;
  font-weight: 700;
  color: #f7f3e8;
  background: rgba(0, 0, 0, 0.55);
  border: 1.5px solid rgba(217, 177, 103, 0.3);
  border-radius: 999px;
  padding: 10px 28px;
}

.ch-panel {
  position: absolute;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.6);
  box-shadow: inset 0 0 0 1px rgba(217, 177, 103, 0.2);
  padding: 10px 12px;
}
.ch-panel-label {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(217, 177, 103, 0.75);
}

/* Same tiles as the blackjack table's controls, sized for stage coordinates. */
.ch-tile {
  padding: 10px 18px;
  border-radius: 10px;
  border-width: 2px;
  border-style: solid;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #f8fafc;
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
  transition: filter 0.12s ease;
  white-space: nowrap;
}
.ch-tile:hover:not(:disabled) {
  filter: brightness(1.3);
}
.ch-tile:disabled {
  opacity: 0.32;
  cursor: not-allowed;
}
.ch-tile-green {
  background: rgb(34 197 94 / 0.4);
  border-color: rgb(74 222 128 / 0.85);
}
.ch-tile-red {
  background: rgb(239 68 68 / 0.4);
  border-color: rgb(248 113 113 / 0.85);
}
.ch-tile-amber {
  background: rgb(245 158 11 / 0.4);
  border-color: rgb(251 191 36 / 0.85);
}
.ch-tile-slate {
  background: rgb(100 116 139 / 0.4);
  border-color: rgb(148 163 184 / 0.8);
}
.ch-hint {
  box-shadow: 0 0 0 3px rgb(255 255 255 / 0.85), 0 0 18px 2px rgb(255 255 255 / 0.45);
}
</style>
