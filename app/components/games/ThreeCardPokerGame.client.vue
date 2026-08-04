<script setup lang="ts">
import LiveTableChat from '~/components/live-table/LiveTableChat.vue'
import LiveTableFeed from '~/components/live-table/LiveTableFeed.vue'
import LiveTableScoreboard from '~/components/live-table/LiveTableScoreboard.vue'
import LiveTableStage from '~/components/live-table/LiveTableStage.vue'
import { chipRackFor } from '#shared/utils/live-blackjack/chips'
import {
    TCP_ANTE_BONUS_LABELS,
    TCP_ANTE_BONUS_PAYS,
    TCP_PAIR_PLUS_LABELS,
    TCP_PAIR_PLUS_PAYS
} from '#shared/utils/three-card-poker/payouts'
import { shouldPlay } from '#shared/utils/three-card-poker/strategy'
import type { TcpAction, TcpSeatState, TcpSharedState, TcpSpot } from '#shared/utils/three-card-poker/types'
import type { LtCard } from '#shared/utils/live-table/types'
import { cardBack, cardFace, chip, chipStack } from '~/utils/live-table/art'

/** Stage coordinates, shared with the Pixi blackjack table. */
const SEAT_POSITIONS = [
    { x: 208, y: 546 },
    { x: 504, y: 604 },
    { x: 800, y: 630 },
    { x: 1096, y: 604 },
    { x: 1392, y: 546 }
]

const PHASE_LABELS: Record<string, string> = {
    idle: 'WAITING',
    betting: 'PLACE YOUR BETS',
    dealing: 'DEALING',
    decision: 'PLAY OR FOLD',
    reveal: 'SHOWDOWN',
    payout: 'PAYOUT'
}

// One back for the whole table: the art mints a fresh clip-path id per call, so
// rebuilding it on every snapshot would thrash the DOM for nothing.
const CARD_BACK = cardBack()

const table = useLiveTable<TcpSeatState, TcpSharedState, TcpAction>('three-card-poker')
const { state, youId, balance, connected, feed, chat, mySeat, skew } = table

const showHints = useCookie<boolean>('tcp-show-hint', { default: () => false })
const selected = ref(0)
const now = ref(Date.now())

// Rejections (seat taken, insufficient balance, ...) land in the feed as a new
// item every time, even on a repeated message — a toast is the surface a
// player actually sees, the sidebar feed is easy to miss.
const toast = useToast()
watch(() => feed.value.at(-1), (item) => {
    if (item?.kind === 'error') toast.add({ title: item.text, color: 'error' })
})

const phase = computed(() => state.value?.phase ?? 'idle')
const isBetting = computed(() => phase.value === 'betting')
const isShowdown = computed(() => phase.value === 'reveal' || phase.value === 'payout')
const dealer = computed(() => state.value?.game.dealer ?? null)

const rack = computed(() => chipRackFor(balance.value))
watch(rack, (chips) => {
    if (chips.some(c => c.value === selected.value)) return
    selected.value = chips[Math.max(0, chips.length - 4)]?.value ?? 0
}, { immediate: true })

function badgeFor(game: TcpSeatState) {
    const result = game.result
    if (isShowdown.value && result) {
        if (result.ante === 'fold') return { text: 'FOLD', tone: 'lose' }
        if (result.ante === 'push') return { text: 'PUSH', tone: 'push' }
        if (!result.dealerQualified) return { text: 'NO QUALIFY', tone: 'win' }
        return result.net >= 0 ? { text: 'WIN', tone: 'win' } : { text: 'LOSE', tone: 'lose' }
    }
    if (game.decision === 'play') return { text: 'PLAY', tone: 'win' }
    if (game.decision === 'fold') return { text: 'FOLD', tone: 'lose' }
    return null
}

function sideWinOf(game: TcpSeatState) {
    const result = game.result
    if (!result?.pairPlusTier || result.pairPlusPayout <= 0) return null
    return { label: TCP_PAIR_PLUS_LABELS[result.pairPlusTier], amount: result.pairPlusPayout }
}

const seats = computed(() => SEAT_POSITIONS.map((position, index) => {
    const seat = state.value?.seats[index] ?? null
    return {
        ...position,
        index,
        seat,
        mine: !!seat && seat.userId === youId.value,
        badge: seat ? badgeFor(seat.game) : null,
        sideWin: seat && isShowdown.value ? sideWinOf(seat.game) : null
    }
}))

const secondsLeft = computed(() => {
    const snapshot = state.value
    if (!snapshot?.phaseEndsAt) return null
    return Math.max(0, Math.ceil((snapshot.phaseEndsAt - (now.value + skew.value)) / 1000))
})

const pairPlusRows = (Object.keys(TCP_PAIR_PLUS_PAYS) as (keyof typeof TCP_PAIR_PLUS_PAYS)[])
    .map(tier => ({ label: TCP_PAIR_PLUS_LABELS[tier], pays: TCP_PAIR_PLUS_PAYS[tier] }))
const anteBonusRows = (Object.keys(TCP_ANTE_BONUS_PAYS) as (keyof typeof TCP_ANTE_BONUS_PAYS)[])
    .map(tier => ({ label: TCP_ANTE_BONUS_LABELS[tier], pays: TCP_ANTE_BONUS_PAYS[tier] }))

const myGame = computed(() => mySeat.value?.game ?? null)
const canDecide = computed(() => phase.value === 'decision' && !!myGame.value?.ante && !myGame.value.decision)
const staked = computed(() => (myGame.value?.pendingAnte ?? 0) + (myGame.value?.pendingPairPlus ?? 0))

/** Optimal play is a single Q-6-4 threshold, so the hint is one boolean. */
const hint = computed(() => {
    const cards = myGame.value?.cards ?? []
    if (!showHints.value || !canDecide.value || cards.length !== 3) return null
    return shouldPlay(cards.map(card => ({ rank: card.rank!, suit: card.suit! })))
})

const pos = (x: number, y: number) => ({ left: `${x}px`, top: `${y}px` })

function faceHtml(card: LtCard): string {
    return card.rank && card.suit ? cardFace(card.rank, card.suit) : CARD_BACK
}

function stackHtml(amount: number): string {
    return amount > 0 ? chipStack(amount, { size: 56, max: 3 }) : ''
}

function onSpot(index: number, spot: TcpSpot) {
    const seat = state.value?.seats[index]
    if (!seat) {
        table.sit(index)
        return
    }
    if (seat.userId !== youId.value || !isBetting.value || !selected.value) return
    table.act({ t: 'bet', spot, amount: selected.value })
}

let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => {
    ticker = setInterval(() => {
        now.value = Date.now()
    }, 200)
})
onBeforeUnmount(() => {
    if (ticker) clearInterval(ticker)
})
</script>

<template>
  <div class="flex flex-col gap-3 xl:flex-row">
    <div class="min-w-0 flex-1">
      <LiveTableStage>
        <!-- Paytables, where blackjack keeps its shoe and discard trays -->
        <div class="lt-overlay" style="left: 70px; top: 66px; width: 216px">
          <h4>Pair Plus</h4>
          <div class="tcp-pay">
            <div v-for="row in pairPlusRows" :key="row.label" class="tcp-pay-row">
              <span>{{ row.label }}</span><span class="lt-mono">{{ row.pays }}:1</span>
            </div>
          </div>
        </div>
        <div class="lt-overlay" style="left: 1314px; top: 66px; width: 216px">
          <h4>Ante Bonus</h4>
          <div class="tcp-pay">
            <div v-for="row in anteBonusRows" :key="row.label" class="tcp-pay-row">
              <span>{{ row.label }}</span><span class="lt-mono">{{ row.pays }}:1</span>
            </div>
          </div>
        </div>

        <!-- Dealer -->
        <div v-if="dealer?.cards.length" class="lt-hand" style="left: 800px; top: 196px">
          <div v-for="card in dealer.cards" :key="card.id" v-html="faceHtml(card)" />
        </div>
        <div v-if="dealer?.hand" class="tcp-strength lt-mono" style="left: 800px; top: 300px">
          {{ dealer.hand.label }}<span v-if="!dealer.qualified" class="tcp-nq"> · does not qualify</span>
        </div>

        <div class="lt-rules" style="top: 338px">
          {{ isShowdown ? state?.message : 'DEALER QUALIFIES WITH QUEEN HIGH OR BETTER' }}
        </div>

        <div class="lt-phase" style="top: 386px">
          <span class="label">{{ PHASE_LABELS[phase] ?? phase.toUpperCase() }}</span>
          <span v-if="secondsLeft !== null" class="count" :class="{ urgent: secondsLeft <= 5 }">
            {{ secondsLeft }}
          </span>
        </div>

        <template v-for="s in seats" :key="s.index">
          <template v-if="s.seat">
            <div
              v-if="s.seat.game.cards.length"
              class="lt-hand"
              :class="{ 'tcp-folded': s.seat.game.decision === 'fold' }"
              :style="pos(s.x, s.y - 100)"
            >
              <div v-for="card in s.seat.game.cards" :key="card.id" v-html="faceHtml(card)" />
            </div>

            <div v-if="s.sideWin" class="lt-badge gold tcp-side" :style="pos(s.x, s.y - 46)">
              {{ s.sideWin.label }} +{{ formatNumber(s.sideWin.amount) }}
            </div>

            <div v-if="s.seat.game.hand" class="tcp-strength lt-mono" :style="pos(s.x, s.y - 8)">
              {{ s.seat.game.hand.label }}
            </div>

            <div v-if="canDecide && s.mine" class="tcp-decide" :style="pos(s.x, s.y + 26)">
              <button
                class="tcp-tile tcp-tile-green"
                :class="{ 'tcp-hint': hint === true }"
                @click="table.act({ t: 'decide', play: true })"
              >
                PLAY {{ formatNumber(s.seat.game.ante) }}
              </button>
              <button
                class="tcp-tile tcp-tile-red"
                :class="{ 'tcp-hint': hint === false }"
                @click="table.act({ t: 'decide', play: false })"
              >
                FOLD
              </button>
            </div>
            <div v-else-if="s.badge" class="lt-badge" :class="s.badge.tone" :style="pos(s.x, s.y + 26)">
              {{ s.badge.text }}
            </div>

            <div class="tcp-cap" :style="pos(s.x - 96, s.y + 58)">
              Pair Plus
            </div>
            <div class="tcp-cap" :style="pos(s.x, s.y + 58)">
              Ante
            </div>
            <div class="tcp-cap" :style="pos(s.x + 96, s.y + 58)">
              Play
            </div>

            <div
              class="lt-spot tcp-spot"
              :class="{ you: s.mine, clickable: s.mine && isBetting }"
              :style="pos(s.x - 96, s.y + 108)"
              @click="onSpot(s.index, 'pairPlus')"
            >
              <div class="tcp-chips" v-html="stackHtml(s.seat.game.pairPlus || s.seat.game.pendingPairPlus)" />
            </div>
            <div
              class="lt-spot tcp-spot"
              :class="{ you: s.mine, clickable: s.mine && isBetting }"
              :style="pos(s.x, s.y + 108)"
              @click="onSpot(s.index, 'ante')"
            >
              <div class="tcp-chips" v-html="stackHtml(s.seat.game.ante || s.seat.game.pendingAnte)" />
            </div>
            <div
              class="lt-spot tcp-spot"
              :class="{ 'tcp-pulse': phase === 'decision' && !s.seat.game.decision }"
              :style="pos(s.x + 96, s.y + 108)"
            >
              <div class="tcp-chips" v-html="stackHtml(s.seat.game.play)" />
            </div>

            <div
              v-if="s.seat.game.pairPlus || s.seat.game.pendingPairPlus"
              class="tcp-amt lt-mono"
              :style="pos(s.x - 96, s.y + 162)"
            >
              {{ formatNumber(s.seat.game.pairPlus || s.seat.game.pendingPairPlus) }}
            </div>
            <div
              v-if="s.seat.game.ante || s.seat.game.pendingAnte"
              class="tcp-amt lt-mono"
              :style="pos(s.x, s.y + 162)"
            >
              {{ formatNumber(s.seat.game.ante || s.seat.game.pendingAnte) }}
            </div>
            <div v-if="s.seat.game.play" class="tcp-amt lt-mono" :style="pos(s.x + 96, s.y + 162)">
              {{ formatNumber(s.seat.game.play) }}
            </div>

            <div class="lt-plate" :class="{ you: s.mine }" :style="pos(s.x, s.y + 226)">
              <ProfileEmblem :emblem="s.seat.emblem" :name="s.seat.name" class="size-6 shrink-0 text-[9px]" />
              <span class="nm">{{ s.seat.name }}</span>
              <span v-if="s.seat.winStreak > 1" class="lt-streak">{{ s.seat.winStreak }}</span>
              <span
                class="net lt-mono"
                :class="s.seat.sessionNet > 0 ? 'up' : s.seat.sessionNet < 0 ? 'down' : ''"
              >{{ s.seat.sessionNet > 0 ? '+' : '' }}{{ formatNumber(s.seat.sessionNet) }}</span>
            </div>
          </template>

          <template v-else>
            <div class="lt-spot tcp-spot" :style="pos(s.x - 96, s.y + 108)" />
            <div class="lt-spot tcp-spot clickable" :style="pos(s.x, s.y + 108)" @click="onSpot(s.index, 'ante')">
              <span class="lt-spot-label">SIT</span>
            </div>
            <div class="lt-spot tcp-spot" :style="pos(s.x + 96, s.y + 108)" />
          </template>
        </template>

        <!-- Your seat, left of the rack -->
        <div class="lt-overlay tcp-panel" style="left: 40px; top: 986px; width: 310px">
          <div v-if="!connected" class="tcp-panel-note">
            <UIcon name="i-lucide-loader-circle" class="animate-spin" /> Connecting…
          </div>
          <template v-else-if="mySeat">
            <div class="tcp-panel-row">
              <span class="tcp-panel-label">Seat {{ mySeat.index + 1 }}</span>
              <span class="grow" />
              <button class="tcp-mini" @click="showHints = !showHints">
                <UIcon :name="showHints ? 'i-lucide-lightbulb' : 'i-lucide-lightbulb-off'" />
                Hints
              </button>
              <button v-if="!mySeat.leaving" class="tcp-mini danger" @click="table.leave()">
                Leave
              </button>
              <span v-else class="tcp-panel-label">Standing up</span>
            </div>
            <div class="tcp-panel-row">
              <span class="tcp-panel-label">Ante</span>
              <span class="tcp-panel-value lt-mono">
                {{ formatNumber(myGame?.ante || myGame?.pendingAnte || 0) }}
              </span>
              <span class="grow" />
              <span class="tcp-panel-label">Pair+</span>
              <span class="tcp-panel-value lt-mono">
                {{ formatNumber(myGame?.pairPlus || myGame?.pendingPairPlus || 0) }}
              </span>
            </div>
          </template>
          <div v-else class="tcp-panel-note">
            Click an open <strong>SIT</strong> ring to join the table
          </div>
        </div>

        <div class="lt-rack">
          <span
            v-for="c in rack"
            :key="c.value"
            :class="{ sel: c.value === selected }"
            @click="selected = c.value"
            v-html="chip(c.value)"
          />
        </div>

        <!-- Bet controls, right of the rack -->
        <div class="lt-overlay tcp-panel" style="left: 1250px; top: 986px; width: 310px">
          <div v-if="isBetting && mySeat" class="tcp-panel-row">
            <button
              class="tcp-tile tcp-tile-amber grow"
              :disabled="!myGame?.lastAnte"
              @click="table.act({ t: 'repeat' })"
            >
              REPEAT
            </button>
            <button class="tcp-tile tcp-tile-slate grow" :disabled="!staked" @click="table.act({ t: 'undo' })">
              UNDO
            </button>
            <button class="tcp-tile tcp-tile-red grow" :disabled="!staked" @click="table.act({ t: 'clear' })">
              CLEAR
            </button>
          </div>
          <div v-else class="tcp-panel-note">
            {{ state?.message ?? 'Waiting for players' }}
          </div>
        </div>
      </LiveTableStage>
    </div>

    <div class="flex min-h-0 shrink-0 flex-col gap-3 xl:w-72">
      <LiveTableFeed :items="feed" class="min-h-32 flex-1" />
      <LiveTableChat :messages="chat" class="min-h-32 flex-1" @send="table.chatSend" />
      <LiveTableScoreboard :entries="state?.scoreboard ?? []" :you-id="youId" class="min-h-28 flex-1" />
    </div>
  </div>
</template>

<style scoped>
/* Three spots per seat instead of blackjack's one, so the ring shrinks; the
   gold styling is still live-table.css's. */
.lt-spot.tcp-spot {
    width: 76px;
    height: 76px;
    margin: -38px 0 0 -38px;
}
.lt-spot.tcp-spot::before {
    inset: 6px;
}
.tcp-spot.clickable {
    cursor: pointer;
}
.tcp-spot.clickable:hover {
    border-color: var(--lt-gold);
    box-shadow: 0 0 18px rgba(217, 177, 103, 0.4);
}
.tcp-chips {
    position: absolute;
    bottom: 4px;
    left: 50%;
    transform: translateX(-50%);
}

.tcp-pulse {
    border-color: rgba(217, 177, 103, 0.7);
    animation: tcp-pulse-anim 1.3s ease-in-out infinite;
}
@keyframes tcp-pulse-anim {
    0%, 100% { box-shadow: 0 0 0 0 rgba(217, 177, 103, 0.5); }
    50% { box-shadow: 0 0 20px 6px rgba(217, 177, 103, 0.4); }
}

.tcp-strength {
    position: absolute;
    transform: translate(-50%, -50%);
    font-size: 16px;
    font-weight: 800;
    color: var(--lt-gold);
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
    white-space: nowrap;
}
.tcp-nq {
    color: #fca5a5;
}
.tcp-cap {
    position: absolute;
    transform: translate(-50%, -50%);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--lt-gold);
    opacity: 0.75;
    white-space: nowrap;
}
.tcp-amt {
    position: absolute;
    transform: translate(-50%, -50%);
    font-size: 15px;
    font-weight: 700;
    color: var(--lt-gold);
    opacity: 0.92;
    white-space: nowrap;
}
.tcp-folded {
    filter: grayscale(1) opacity(0.45);
}
.tcp-side {
    font-size: 13px;
    padding: 3px 10px;
}

.tcp-pay {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.tcp-pay-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 13px;
    color: #f7f3e8;
}
.tcp-pay-row span:last-child {
    color: var(--lt-gold);
    font-weight: 800;
}

.tcp-decide {
    position: absolute;
    display: flex;
    gap: 8px;
    transform: translate(-50%, -50%);
}

.tcp-panel {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 10px;
    height: 108px;
    padding: 10px 14px;
}
.tcp-panel-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.tcp-panel-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--lt-gold);
    opacity: 0.8;
}
.tcp-panel-value {
    font-size: 17px;
    font-weight: 800;
    color: #f7f3e8;
}
.tcp-panel-note {
    font-size: 13px;
    line-height: 1.35;
    color: #cfc7b6;
}
.tcp-mini {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.08);
    padding: 3px 9px;
    font-size: 11px;
    font-weight: 700;
    color: #e7e0d1;
}
.tcp-mini:hover {
    background: rgb(255 255 255 / 0.16);
}
.tcp-mini.danger {
    color: #fca5a5;
}

/* The same tiles as the blackjack table, so the two games read as one suite. */
.tcp-tile {
    padding: 0.42rem 0.7rem;
    border-radius: 0.6rem;
    border-width: 2px;
    border-style: solid;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #f8fafc;
    backdrop-filter: blur(6px);
    text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
    white-space: nowrap;
    transition: transform 0.12s ease, filter 0.12s ease;
}
.tcp-tile.grow {
    flex: 1;
    text-align: center;
}
.tcp-tile:hover:not(:disabled) {
    transform: translateY(-2px);
    filter: brightness(1.3);
}
.tcp-tile:active:not(:disabled) {
    transform: translateY(1px);
}
.tcp-tile:disabled {
    opacity: 0.32;
    cursor: not-allowed;
}
.tcp-tile-green {
    background: rgb(34 197 94 / 0.3);
    border-color: rgb(74 222 128 / 0.75);
}
.tcp-tile-red {
    background: rgb(239 68 68 / 0.3);
    border-color: rgb(248 113 113 / 0.75);
}
.tcp-tile-amber {
    background: rgb(245 158 11 / 0.3);
    border-color: rgb(251 191 36 / 0.75);
}
.tcp-tile-slate {
    background: rgb(100 116 139 / 0.32);
    border-color: rgb(148 163 184 / 0.7);
}
.tcp-hint {
    box-shadow: 0 0 0 3px rgb(255 255 255 / 0.85), 0 0 18px 2px rgb(255 255 255 / 0.45);
    animation: tcp-hint-pulse 1.1s ease-in-out infinite;
}
@keyframes tcp-hint-pulse {
    50% { box-shadow: 0 0 0 3px rgb(255 255 255 / 0.5), 0 0 10px 1px rgb(255 255 255 / 0.25); }
}

.lt-rack span {
    cursor: pointer;
}
</style>
