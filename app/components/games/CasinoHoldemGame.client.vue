<script setup lang="ts">
import { CH_AA_TABLE, CH_ANTE_TABLE, CH_CALL_MULTIPLIER } from '#shared/utils/casino-holdem/rules'
import { shouldCall } from '#shared/utils/casino-holdem/strategy'
import type { ChCard } from '#shared/utils/casino-holdem/evaluator'
import type { ChAction, ChBetSpot, ChSeatState, ChSharedState } from '#shared/utils/casino-holdem/types'
import { chipRackFor } from '#shared/utils/live-blackjack/chips'
import type { LtCard } from '#shared/utils/live-table/types'
import { LT_DISCARD_POS, LT_SHOE_POS, cardBack, cardFace, chip, chipStack } from '~/utils/live-table/art'

const table = useLiveTable<ChSeatState, ChSharedState, ChAction>('casino-holdem')
const { state, youId, balance, connected, feed, chat, mySeat, skew } = table

/** Seats on the shared 1720x1200 felt. */
const SEATS = [
    { x: 222, y: 546 },
    { x: 541, y: 604 },
    { x: 860, y: 630 },
    { x: 1179, y: 604 },
    { x: 1498, y: 546 }
]
const BOARD_X = [584, 722, 860, 998, 1136]
const SLOT_LABEL = ['FLOP', 'FLOP', 'FLOP', 'TURN', 'RIVER']

/** Mirrors --lt-chip-size-spot / --lt-chip-size-side in live-table.css — chipStack()
 *  needs a pixel number to compute its stack lift, so it can't read the tokens itself. */
const CHIP_SPOT = 84
const CHIP_SIDE = 64

const PHASE_LABEL: Record<string, string> = {
    idle: 'WAITING',
    betting: 'PLACE YOUR ANTE',
    deal: 'DEALING',
    decision: 'CALL OR FOLD',
    board: 'TURN & RIVER',
    reveal: 'SHOWDOWN',
    payout: 'PAYOUT'
}

/** Worked examples for the side-bet paytable, rank + suit letter, space separated. */
const ANTE_EXAMPLES: Record<string, string> = {
    'Straight or less': '10h Jc Qd Ks Ah',
    'Flush': '2h 5h 9h Jh Kh',
    'Full house': 'Ks Kc Kd 4h 4s',
    'Four of a kind': '9s 9h 9d 9c 2h',
    'Straight flush': '5h 6h 7h 8h 9h',
    'Royal flush': '10s Js Qs Ks As'
}
const AA_EXAMPLES: Record<string, string> = {
    'Royal flush': '10d Jd Qd Kd Ad',
    'Straight flush': '5c 6c 7c 8c 9c',
    'Four of a kind': '7s 7h 7d 7c 2s',
    'Full house': 'Qh Qc Qd 5s 5h',
    'Flush': '2d 6d 8d 10d Kd',
    'Straight': '4h 5c 6d 7s 8h',
    'Three of a kind': 'Ah Ac As 4d 2h',
    'Two pair': 'Ah As Kd Kc 2h',
    'Pair of aces': 'Ah As 3d 7c Kh'
}
const antePayRows = CH_ANTE_TABLE.map(row => ({ label: row.label, example: ANTE_EXAMPLES[row.label], pays: `${row.pays}:1` }))
const aaPayRows = CH_AA_TABLE.map(row => ({ label: row.label, example: AA_EXAMPLES[row.label], pays: `${row.pays}:1` }))

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

/**
 * Settling a hand spans two phases, so counting the current one down would
 * reset halfway. The server publishes when betting reopens instead.
 */
const nextRoundIn = computed(() => {
    const at = state.value?.nextRoundAt
    if (!at) return null
    return Math.max(0, Math.ceil((at - (now.value + skew.value)) / 1000))
})

/** Once the dealer is up, the result is worth more than the phase's name. */
const phaseLabel = computed(() => {
    const settling = phase.value === 'reveal' || phase.value === 'payout'
    if (settling && state.value?.message) return state.value.message.toUpperCase()
    return PHASE_LABEL[phase.value] ?? phase.value.toUpperCase()
})

const myAnte = computed(() => mySeat.value?.game.pendingAnte ?? 0)
const myAa = computed(() => mySeat.value?.game.pendingAa ?? 0)
const staked = computed(() => myAnte.value + myAa.value)
const needsDecision = computed(() =>
    phase.value === 'decision' && !!mySeat.value?.game.cards.length && !mySeat.value.game.decision)
const callCost = computed(() => (mySeat.value?.game.ante ?? 0) * CH_CALL_MULTIPLIER)

const canRepeat = computed(() => !!mySeat.value?.game.lastAnte)
const canScale = computed(() => myAnte.value > 0 || !!mySeat.value?.game.lastAnte)

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

function scaleBet(factor: number) {
    table.act({ t: 'scale', factor })
}

// ─── deal / discard animation ───────────────────────────────────────────
// Presentation only: the server has already settled by the time a card lands
// or leaves, so this only ever decorates a snapshot that already happened.

interface ChFlight {
    id: string
    html: string
    x: number
    y: number
    fx: number
    fy: number
    rot: number
    delay: number
    duration: number
}

interface ChCardLoc {
    card: LtCard
    x: number
    y: number
}

const DEAL_STAGGER = 90
const DEAL_STAGGER_CAP = 550
const DEAL_DURATION = 420
const DISCARD_STAGGER = 35
const DISCARD_STAGGER_CAP = 320
const DISCARD_DURATION = 380

/** A fanned hand overlaps its 112px-wide cards by 50px, so 62px separates centres. */
function fanOffset(index: number, total: number, scale = 1): number {
    return (index - (total - 1) / 2) * 62 * scale
}

function collectLocations(snapshot: NonNullable<typeof state.value>): ChCardLoc[] {
    const locs: ChCardLoc[] = []
    const dealerCards = snapshot.game.dealer.cards
    dealerCards.forEach((card, i) => locs.push({ card, x: 860 + fanOffset(i, dealerCards.length, 0.82), y: 142 }))
    snapshot.game.board.forEach((card, i) => locs.push({ card, x: BOARD_X[i]!, y: 292 }))
    snapshot.seats.forEach((seat, si) => {
        if (!seat) return
        const spot = SEATS[si]!
        seat.game.cards.forEach((card, i, all) => locs.push({ card, x: spot.x + fanOffset(i, all.length), y: spot.y - 100 }))
    })
    return locs
}

/** Cards that have finished flying in — only these render at their felt position. */
const arrived = reactive(new Set<string>())
const pendingDeal = new Set<string>()
const flights = ref<ChFlight[]>([])
let prevLocs: ChCardLoc[] = []
let flightSeq = 0

function spawnDeal(loc: ChCardLoc, order: number) {
    pendingDeal.add(loc.card.id)
    const delay = Math.min(DEAL_STAGGER_CAP, order * DEAL_STAGGER)
    const key = `deal:${loc.card.id}`
    flights.value.push({
        id: key,
        html: renderCard(loc.card),
        x: loc.x,
        y: loc.y,
        fx: LT_SHOE_POS.x - loc.x,
        fy: LT_SHOE_POS.y - loc.y,
        rot: -16,
        delay,
        duration: DEAL_DURATION
    })
    setTimeout(() => {
        pendingDeal.delete(loc.card.id)
        arrived.add(loc.card.id)
        flights.value = flights.value.filter(f => f.id !== key)
    }, delay + DEAL_DURATION + 40)
}

function spawnDiscard(loc: ChCardLoc, order: number) {
    const delay = Math.min(DISCARD_STAGGER_CAP, order * DISCARD_STAGGER)
    const key = `discard:${loc.card.id}:${++flightSeq}`
    flights.value.push({
        id: key,
        html: renderCard(loc.card),
        x: LT_DISCARD_POS.x,
        y: LT_DISCARD_POS.y,
        fx: loc.x - LT_DISCARD_POS.x,
        fy: loc.y - LT_DISCARD_POS.y,
        rot: 20,
        delay,
        duration: DISCARD_DURATION
    })
    setTimeout(() => {
        flights.value = flights.value.filter(f => f.id !== key)
    }, delay + DISCARD_DURATION + 40)
}

watch(state, (snapshot) => {
    if (!snapshot) return
    const locs = collectLocations(snapshot)
    const seen = new Set(locs.map(l => l.card.id))

    let discardOrder = 0
    for (const loc of prevLocs) {
        if (!seen.has(loc.card.id)) spawnDiscard(loc, discardOrder++)
    }

    let dealOrder = 0
    for (const loc of locs) {
        if (!arrived.has(loc.card.id) && !pendingDeal.has(loc.card.id)) spawnDeal(loc, dealOrder++)
    }

    prevLocs = locs
})

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
          style="left: 860px; top: 142px; transform: translate(-50%, -50%) scale(0.82)"
        >
          <template v-for="card in dealer.cards" :key="card.id">
            <div v-if="arrived.has(card.id)" v-html="renderCard(card)" />
          </template>
        </div>
        <div class="ch-caption" style="left: 957px; top: 142px">
          <span class="ch-caption-tag">DEALER</span>
          <span v-if="dealer.label">{{ dealer.label }}</span>
          <span v-else class="opacity-50">two cards down</span>
        </div>

        <!-- Shoe and discard pile: the deal/discard animation's two anchor points -->
        <div class="ch-tray" :style="{ left: `${LT_SHOE_POS.x}px`, top: `${LT_SHOE_POS.y}px` }">
          <div class="ch-tray-stack">
            <span class="ch-tray-card ch-tray-under" v-html="cardBack()" />
            <span class="ch-tray-card" v-html="cardBack()" />
          </div>
          <span class="ch-tray-label">SHOE</span>
        </div>
        <div class="ch-tray" :style="{ left: `${LT_DISCARD_POS.x}px`, top: `${LT_DISCARD_POS.y}px` }">
          <div class="ch-tray-stack">
            <span class="ch-tray-card ch-tray-under" v-html="cardBack()" />
            <span class="ch-tray-card" v-html="cardBack()" />
          </div>
          <span class="ch-tray-label">DISCARD</span>
        </div>

        <!-- Cards in flight between the shoe, the felt and the discard pile -->
        <div
          v-for="f in flights"
          :key="f.id"
          class="ch-flying"
          :style="{
            'left': `${f.x}px`,
            'top': `${f.y}px`,
            '--fx': `${f.fx}px`,
            '--fy': `${f.fy}px`,
            '--frot': `${f.rot}deg`,
            'animationDelay': `${f.delay}ms`,
            'animationDuration': `${f.duration}ms`
          }"
          v-html="f.html"
        />

        <!-- Community board: dealt cards, then dashed slots for what is still to come -->
        <template v-for="(card, i) in board" :key="card.id">
          <div
            v-if="arrived.has(card.id)"
            class="ch-board-card"
            :style="{ left: `${BOARD_X[i]}px`, top: '292px' }"
            v-html="renderCard(card)"
          />
        </template>
        <div
          v-for="i in 5 - board.length"
          :key="`slot-${i}`"
          class="ch-slot"
          :style="{ left: `${BOARD_X[board.length + i - 1]}px`, top: '292px' }"
        >
          <span>{{ SLOT_LABEL[board.length + i - 1] }}</span>
        </div>

        <div class="lt-rules" style="top: 380px">
          DEALER QUALIFIES WITH A PAIR OF FOURS OR BETTER
        </div>
        <div class="lt-phase" style="top: 412px">
          <span class="label">{{ phaseLabel }}</span>
          <template v-if="nextRoundIn !== null">
            <span class="next">NEW ROUND IN</span>
            <span class="count">{{ nextRoundIn }}</span>
          </template>
          <span v-else-if="countdown !== null" class="count" :class="{ urgent: countdown <= 5 }">{{ countdown }}</span>
        </div>

        <!-- Side-bet paytables: top-left corner, dimmed and collapsed until asked for,
             so they sit above the felt without competing with it. -->
        <LiveTableCorner title="Side bets">
          <LiveTablePaytable :rows="antePayRows" :head="['Ante — best 5 cards', 'Pays']" />
          <div class="ch-pay-gap">
            <LiveTablePaytable :rows="aaPayRows" :head="['AA bonus — hole + flop', 'Pays']" />
          </div>
        </LiveTableCorner>

        <LiveTableCorner title="Simultaneous action" side="right">
          <p class="text-[15px] leading-relaxed text-[#f7f3e8]" style="width: 340px">
            Every seat plays the dealer, never each other, and all five decide on one shared clock.
            Several seats can win the same hand.
          </p>
        </LiveTableCorner>

        <!-- Seats -->
        <template v-for="(spot, index) in SEATS" :key="index">
          <template v-if="seats[index]">
            <div
              class="lt-hand"
              :style="{
                left: `${spot.x}px`,
                top: `${spot.y - 90}px`,
                opacity: seats[index]!.game.decision === 'fold' ? 0.4 : 1
              }"
            >
              <template v-for="card in seats[index]!.game.cards" :key="card.id">
                <div v-if="arrived.has(card.id)" v-html="renderCard(card)" />
              </template>
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
                class="lb-tile lb-tile-green"
                :class="{ 'lb-hint': hint === 'call' }"
                @click="table.act({ t: 'decide', decision: 'call' })"
              >
                CALL {{ formatNumber(callCost) }}
              </button>
              <button
                class="lb-tile lb-tile-red"
                :class="{ 'lb-hint': hint === 'fold' }"
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
                top: `${spot.y + 202}px`,
                opacity: seats[index]!.game.decision === 'fold' ? 0.55 : 1
              }"
            >
              {{ seats[index]!.game.handLabel }}
            </div>

            <!-- AA bonus, then ante and call -->
            <div
              class="lt-spot ch-spot-small"
              :class="{ 'you': seats[index]!.userId === youId && isBetting, 'ch-clickable': seats[index]!.userId === youId && isBetting }"
              :style="{ left: `${spot.x - 119}px`, top: `${spot.y + 132}px` }"
              @click="seats[index]!.userId === youId && place('aa')"
            >
              <div
                v-if="seats[index]!.game.aa || seats[index]!.game.pendingAa"
                class="ch-chips"
                v-html="stackFor(seats[index]!.game.aa || seats[index]!.game.pendingAa, CHIP_SIDE)"
              />
              <span v-else class="lt-spot-label" style="font-size: 11px">AA<br>BONUS</span>
            </div>
            <div
              v-if="seats[index]!.game.aaMultiplier"
              class="ch-aa-win"
              :style="{ left: `${spot.x - 119}px`, top: `${spot.y + 178}px` }"
            >
              AA {{ seats[index]!.game.aaMultiplier }}:1
            </div>

            <div class="ch-spotlabel" :style="{ left: `${spot.x - 22}px`, top: `${spot.y + 70}px` }">
              ANTE
            </div>
            <div
              class="lt-spot"
              :class="{ 'you': seats[index]!.userId === youId, 'lit': !!seats[index]!.game.ante, 'ch-clickable': seats[index]!.userId === youId && isBetting }"
              :style="{ left: `${spot.x - 22}px`, top: `${spot.y + 132}px` }"
              @click="seats[index]!.userId === youId && place('ante')"
            >
              <div
                v-if="seats[index]!.game.ante || seats[index]!.game.pendingAnte"
                class="ch-chips"
                v-html="stackFor(seats[index]!.game.ante || seats[index]!.game.pendingAnte, CHIP_SPOT)"
              />
            </div>
            <div
              v-if="seats[index]!.game.ante || seats[index]!.game.pendingAnte"
              class="ch-bet-total"
              :style="{ left: `${spot.x - 22}px`, top: `${spot.y + 56}px` }"
            >
              {{ formatNumber(seats[index]!.game.ante || seats[index]!.game.pendingAnte) }}
            </div>

            <div class="ch-spotlabel" :style="{ left: `${spot.x + 97}px`, top: `${spot.y + 70}px` }">
              CALL
            </div>
            <div
              class="lt-spot"
              :class="{ you: seats[index]!.userId === youId }"
              :style="{ left: `${spot.x + 97}px`, top: `${spot.y + 132}px` }"
            >
              <div
                v-if="seats[index]!.game.call"
                class="ch-chips"
                v-html="stackFor(seats[index]!.game.call, CHIP_SPOT)"
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
            class="lt-sit"
            :style="{ left: `${spot.x}px`, top: `${spot.y + 106}px` }"
            @click="table.sit(index)"
          >
            <span class="lbl">SIT</span>
          </div>
        </template>

        <!-- Bet bar, then the chip rail, or the phase message once betting closes -->
        <LiveTableBetBar
          v-if="isBetting && mySeat"
          :can-repeat="canRepeat"
          :can-scale="canScale"
          :can-undo="!!staked"
          :can-clear="!!staked"
          @repeat="table.act({ t: 'repeat' })"
          @scale="scaleBet"
          @undo="table.act({ t: 'undo' })"
          @clear="table.act({ t: 'clear' })"
        />

        <div v-if="isBetting && mySeat" class="lt-rack">
          <span
            v-for="value in rack"
            :key="value"
            :class="{ sel: value === selectedChip }"
            @click="selectedChip = value"
            v-html="chip(value)"
          />
        </div>
        <div v-else class="lt-status">
          <template v-if="!connected">Connecting…</template>
          <template v-else-if="!mySeat">Click an open <span class="ch-status-sit">SIT</span> spot to join the table</template>
          <template v-else>{{ state?.message }}</template>
        </div>

        <div v-if="isBetting && mySeat" class="lt-panel lt-panel-l">
          <div class="flex items-baseline justify-between">
            <span class="lt-panel-label">Ante</span>
            <span class="lt-panel-value lt-mono">{{ formatNumber(myAnte) }}</span>
          </div>
          <div class="flex items-baseline justify-between">
            <span class="lt-panel-label">AA bonus</span>
            <span class="lt-panel-value lt-mono" style="font-size: 17px">{{ formatNumber(myAa) }}</span>
          </div>
        </div>

        <div class="lt-panel lt-panel-r">
          <div class="flex items-center justify-between">
            <span class="lt-panel-label">{{ mySeat ? `Seat ${mySeat.index + 1}` : 'Watching' }}</span>
            <span class="lt-mono text-[15px] text-[#f7f3e8]/70">{{ state?.watching ?? 0 }} watching</span>
          </div>
          <div class="mt-1.5 flex gap-1.5">
            <button class="lb-tile flex-1" :class="showHints ? 'lb-tile-amber' : 'lb-tile-slate'" @click="showHints = !showHints">
              HINTS {{ showHints ? 'ON' : 'OFF' }}
            </button>
            <button v-if="mySeat && !mySeat.leaving" class="lb-tile lb-tile-red flex-1" @click="table.leave()">
              LEAVE
            </button>
            <span v-else-if="mySeat" class="lb-tile lb-tile-slate flex-1 text-center opacity-70">STANDING UP</span>
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
/* Matches .lt-stage-wrap so the rail is never taller or shorter than the felt beside it. */
.ch-rail {
  height: min(900px, calc(100vh - 110px));
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

.ch-pay-gap {
  margin-top: 14px;
}

/* The shoe and discard tray are decorative anchors for the deal/discard flight. */
.ch-tray {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  opacity: 0.85;
  pointer-events: none;
}
.ch-tray-stack {
  position: relative;
  width: 96px;
  height: 134px;
}
.ch-tray-card {
  position: absolute;
  inset: 0;
}
.ch-tray-card :deep(svg) {
  display: block;
  width: 96px;
  height: 134px;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5));
}
.ch-tray-under {
  transform: translate(5px, -5px);
  opacity: 0.75;
}
.ch-tray-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  color: rgba(217, 177, 103, 0.55);
}

/* A card in transit between the shoe, the felt and the discard pile — --fx/--fy
   is where it starts relative to where it ends up, so one keyframe runs both
   directions. */
.ch-flying {
  position: absolute;
  transform: translate(-50%, -50%);
  z-index: 6;
  pointer-events: none;
  animation-name: ch-fly;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}
@keyframes ch-fly {
  from { transform: translate(-50%, -50%) translate(var(--fx), var(--fy)) rotate(var(--frot)); }
  to { transform: translate(-50%, -50%) translate(0, 0) rotate(0deg); }
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

/* The combined value of a chip stack — three 5K chips read as chips, not as 15K. */
.ch-bet-total {
  position: absolute;
  transform: translate(-50%, -50%);
  white-space: nowrap;
  padding: 2px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--lt-shell) 88%, transparent);
  border: 1.5px solid rgba(217, 177, 103, 0.55);
  font-size: 13px;
  font-weight: 800;
  color: var(--lt-gold);
  font-variant-numeric: tabular-nums;
}

/* Chips sit on the floor of a spot rather than centred, the way a real pile does.
   Each chip in the stack carries its own z-index to layer above the one below it —
   isolate contains that layering here, or it leaks past .lt-spot and climbs above
   a later sibling like .ch-bet-total regardless of DOM order. */
.ch-chips {
  position: absolute;
  bottom: 8px;
  isolation: isolate;
}

.ch-spot-small {
  width: 80px;
  height: 80px;
  margin: -40px 0 0 -40px;
}
.ch-spot-small .ch-chips {
  bottom: 4px;
}

.ch-clickable {
  cursor: pointer;
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
</style>
