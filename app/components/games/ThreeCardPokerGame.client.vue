<script setup lang="ts">
import LiveTableBetBar from '~/components/live-table/LiveTableBetBar.vue'
import LiveTableChat from '~/components/live-table/LiveTableChat.vue'
import LiveTableCorner from '~/components/live-table/LiveTableCorner.vue'
import LiveTableFeed from '~/components/live-table/LiveTableFeed.vue'
import LiveTablePaytable from '~/components/live-table/LiveTablePaytable.vue'
import LiveTableScoreboard from '~/components/live-table/LiveTableScoreboard.vue'
import LiveTableStage from '~/components/live-table/LiveTableStage.vue'
import { chipRackFor } from '#shared/utils/live-blackjack/chips'
import {
    TCP_ANTE_BONUS_LABELS,
    TCP_ANTE_BONUS_PAYS,
    TCP_PAIR_PLUS_LABELS,
    TCP_PAIR_PLUS_PAYS
} from '#shared/utils/three-card-poker/payouts'
import type { TcpAnteBonusTier, TcpPairPlusTier } from '#shared/utils/three-card-poker/payouts'
import { shouldPlay } from '#shared/utils/three-card-poker/strategy'
import type {
    TcpAction,
    TcpSeatState,
    TcpSharedState,
    TcpSpot
} from '#shared/utils/three-card-poker/types'
import type { LtCard } from '#shared/utils/live-table/types'
import { cardBack, cardFace, chip, chipStack } from '~/utils/live-table/art'

/** Stage coordinates, shared with every live-table game — seats at (222,546) (541,604) (860,630) (1179,604) (1498,546). */
const SEAT_POSITIONS = [
    { x: 222, y: 546 },
    { x: 541, y: 604 },
    { x: 860, y: 630 },
    { x: 1179, y: 604 },
    { x: 1498, y: 546 }
]

const PHASE_LABELS: Record<string, string> = {
    idle: 'WAITING',
    betting: 'PLACE YOUR BETS',
    dealing: 'DEALING',
    decision: 'PLAY OR FOLD',
    reveal: 'SHOWDOWN',
    payout: 'PAYOUT'
}

/** Shoe and discard anchors, pinned to the live blackjack table so every game in the suite agrees. */
const SHOE_POS = { x: 1431, y: 140 }
const DISCARD_POS = { x: 289, y: 140 }
const DEAL_STAGGER_MS = 90
const DISCARD_MS = 520

/** A worked example for each tier — genuinely valid hands, not just illustrative suits. */
const PAIR_PLUS_EXAMPLES: Record<TcpPairPlusTier, string> = {
    straightFlush: 'As Ks Qs',
    trips: 'Kc Kh Kd',
    straight: 'Kc Qh Jd',
    flush: 'Qh Jh 3h',
    pair: 'As Ah 4c'
}
const ANTE_BONUS_EXAMPLES: Record<TcpAnteBonusTier, string> = {
    straightFlush: 'As Ks Qs',
    trips: 'Kc Kh Kd',
    straight: 'Kc Qh Jd'
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
    if (isShowdown.value && state.value?.message) return state.value.message.toUpperCase()
    return PHASE_LABELS[phase.value] ?? phase.value.toUpperCase()
})

const pairPlusRows = (Object.keys(TCP_PAIR_PLUS_PAYS) as TcpPairPlusTier[])
    .map(tier => ({
        label: TCP_PAIR_PLUS_LABELS[tier],
        example: PAIR_PLUS_EXAMPLES[tier],
        pays: `${TCP_PAIR_PLUS_PAYS[tier]}:1`
    }))
const anteBonusRows = (Object.keys(TCP_ANTE_BONUS_PAYS) as TcpAnteBonusTier[])
    .map(tier => ({
        label: TCP_ANTE_BONUS_LABELS[tier],
        example: ANTE_BONUS_EXAMPLES[tier],
        pays: `${TCP_ANTE_BONUS_PAYS[tier]}:1`
    }))

const myGame = computed(() => mySeat.value?.game ?? null)
const canDecide = computed(() => phase.value === 'decision' && !!myGame.value?.ante && !myGame.value.decision)
const staked = computed(() => (myGame.value?.pendingAnte ?? 0) + (myGame.value?.pendingPairPlus ?? 0))

// Offered once the ante is down, so one seat cannot deal the table out from
// under someone who has not decided how much to risk yet.
const seatedPlayers = computed(() => (state.value?.seats ?? []).filter(s => s !== null))
const startVotes = computed(() => seatedPlayers.value.filter(s => s.votedStart).length)
const canVoteStart = computed(() => isBetting.value && !!myGame.value?.pendingAnte && !mySeat.value?.votedStart)
const showVotePanel = computed(() => isBetting.value && !!myGame.value?.pendingAnte)
const waitingOnNames = computed(() => seatedPlayers.value.filter(s => !s.votedStart).map(s => s.name))

const canRepeatBet = computed(() => isBetting.value && !!mySeat.value && !!myGame.value?.lastAnte)
const canScaleBet = computed(() =>
    isBetting.value && !!mySeat.value && !!(myGame.value?.pendingAnte || myGame.value?.lastAnte))
const canUndoBet = computed(() => isBetting.value && !!mySeat.value && !!staked.value)

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

/**
 * Cards are dealt and cleared three at a time in the snapshot, all at once —
 * there is nothing to animate off the data itself. Instead a card id freshly
 * added to `flyingIds` renders offset toward the shoe, then two frames later
 * the offset is dropped so the CSS transition carries it into place; a hand
 * that clears is snapshotted into a ghost that flies the other way, toward the
 * discard pile, before it is dropped. Presentation only — it never touches the
 * server-driven phase clock.
 */
const flyingIds = ref(new Set<string>())
interface DiscardGhost { id: number, x: number, y: number, cards: LtCard[], flying: boolean }
const ghosts = ref<DiscardGhost[]>([])
let ghostSeq = 0

function handAnchor(key: string): { x: number, y: number } {
    if (key === 'dealer') return { x: 860, y: 196 }
    const seat = SEAT_POSITIONS[Number(key.slice(5))]!
    return { x: seat.x, y: seat.y - 100 }
}

function cardStyle(cardId: string, index: number, targetX: number, targetY: number) {
    const style: Record<string, string> = { transitionDelay: `${index * DEAL_STAGGER_MS}ms` }
    if (flyingIds.value.has(cardId)) {
        style.transform = `translate(${SHOE_POS.x - targetX}px, ${SHOE_POS.y - targetY}px) scale(0.7)`
        style.opacity = '0'
    }
    return style
}

function dealIn(cards: LtCard[]) {
    for (const card of cards) flyingIds.value.add(card.id)
    // Two frames, so the browser paints the offset once before it is dropped —
    // drop it in the same frame it was set and there is nothing to transition from.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        for (const card of cards) flyingIds.value.delete(card.id)
    }))
}

function discardHand(key: string, cards: LtCard[]) {
    if (!cards.length) return
    const { x, y } = handAnchor(key)
    const id = ++ghostSeq
    ghosts.value.push({ id, x, y, cards, flying: false })
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const ghost = ghosts.value.find(g => g.id === id)
        if (ghost) ghost.flying = true
    }))
    setTimeout(() => {
        ghosts.value = ghosts.value.filter(g => g.id !== id)
    }, DISCARD_MS + 80)
}

// Seeded rather than animated on the first snapshot a client ever sees — a
// round already in progress on connect should not fly in out of nowhere.
const seenHands = new Set<string>()
const prevHandCards: Record<string, LtCard[]> = {}

watch(state, (snapshot) => {
    if (!snapshot) return
    const hands: Record<string, LtCard[]> = { dealer: snapshot.game.dealer.cards }
    for (let i = 0; i < SEAT_POSITIONS.length; i++) {
        hands[`seat:${i}`] = snapshot.seats[i]?.game.cards ?? []
    }
    for (const key of Object.keys(hands)) {
        const cur = hands[key]!
        if (!seenHands.has(key)) {
            seenHands.add(key)
            prevHandCards[key] = cur
            continue
        }
        const prev = prevHandCards[key] ?? []
        if (prev.length === 0 && cur.length > 0) dealIn(cur)
        else if (prev.length > 0 && cur.length === 0) discardHand(key, prev)
        prevHandCards[key] = cur
    }
})

function onSpot(index: number, spot: TcpSpot) {
    const seat = state.value?.seats[index]
    if (!seat || seat.userId !== youId.value || !isBetting.value || !selected.value) return
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
        <!-- Bonus rules, dimmed and collapsed until asked for -->
        <LiveTableCorner title="Bonus paytables">
          <div class="tcp-paytable-section">
            <h5 class="tcp-paytable-title">Pair Plus</h5>
            <LiveTablePaytable :rows="pairPlusRows" :head="['HAND', 'PAYS']" />
          </div>
          <div class="tcp-paytable-section">
            <h5 class="tcp-paytable-title">Ante Bonus</h5>
            <LiveTablePaytable :rows="anteBonusRows" :head="['HAND', 'PAYS']" />
          </div>
        </LiveTableCorner>

        <!-- Dealer -->
        <div v-if="dealer?.cards.length" class="lt-hand" style="left: 860px; top: 196px">
          <div
            v-for="(card, i) in dealer.cards"
            :key="card.id"
            class="tcp-deal"
            :style="cardStyle(card.id, i, 860, 196)"
            v-html="faceHtml(card)"
          />
        </div>
        <div v-if="dealer?.hand" class="tcp-strength lt-mono" style="left: 860px; top: 300px">
          {{ dealer.hand.label }}<span v-if="!dealer.qualified" class="tcp-nq"> · does not qualify</span>
        </div>

        <div class="lt-rules" style="top: 338px">
          DEALER QUALIFIES WITH QUEEN HIGH OR BETTER
        </div>

        <div class="lt-phase" style="top: 386px">
          <span class="label">{{ phaseLabel }}</span>
          <template v-if="nextRoundIn !== null">
            <span class="next">NEW ROUND IN</span>
            <span class="count">{{ nextRoundIn }}</span>
          </template>
          <span v-else-if="secondsLeft !== null" class="count" :class="{ urgent: secondsLeft <= 5 }">
            {{ secondsLeft }}
          </span>
        </div>

        <!-- Deal-now vote, in the open felt between the phase pill and the seats -->
        <div v-if="showVotePanel" class="tcp-vote" style="left: 860px; top: 468px">
          <button v-if="canVoteStart" class="lb-tile lb-tile-green tcp-vote-btn" @click="table.voteStart()">
            DEAL NOW
            <span v-if="seatedPlayers.length > 1" class="tcp-vote-count">
              ({{ startVotes }}/{{ seatedPlayers.length }})
            </span>
          </button>
          <div v-else class="tcp-vote-ready">
            Ready — waiting on {{ waitingOnNames.join(', ') }}
          </div>
        </div>

        <!-- Cards on their way to the discard pile, collected from a hand that just cleared -->
        <div
          v-for="g in ghosts"
          :key="g.id"
          class="lt-hand tcp-ghost"
          :style="{
            left: `${g.x}px`,
            top: `${g.y}px`,
            transform: g.flying
              ? `translate(-50%, -50%) translate(${DISCARD_POS.x - g.x}px, ${DISCARD_POS.y - g.y}px) scale(0.5)`
              : 'translate(-50%, -50%)',
            opacity: g.flying ? 0 : 1
          }"
        >
          <div v-for="card in g.cards" :key="card.id" v-html="faceHtml(card)" />
        </div>

        <template v-for="s in seats" :key="s.index">
          <template v-if="s.seat">
            <div
              v-if="s.seat.game.cards.length"
              class="lt-hand"
              :class="{ 'tcp-folded': s.seat.game.decision === 'fold' }"
              :style="pos(s.x, s.y - 100)"
            >
              <div
                v-for="(card, i) in s.seat.game.cards"
                :key="card.id"
                class="tcp-deal"
                :style="cardStyle(card.id, i, s.x, s.y - 100)"
                v-html="faceHtml(card)"
              />
            </div>

            <div v-if="s.sideWin" class="lt-badge gold tcp-side" :style="pos(s.x, s.y - 46)">
              {{ s.sideWin.label }} +{{ formatNumber(s.sideWin.amount) }}
            </div>

            <div v-if="s.seat.game.hand" class="tcp-strength lt-mono" :style="pos(s.x, s.y - 8)">
              {{ s.seat.game.hand.label }}
            </div>

            <div v-if="canDecide && s.mine" class="tcp-decide" :style="pos(s.x, s.y + 26)">
              <button
                class="lb-tile lb-tile-green"
                :class="{ 'lb-hint': hint === true }"
                @click="table.act({ t: 'decide', play: true })"
              >
                PLAY {{ formatNumber(s.seat.game.ante) }}
              </button>
              <button
                class="lb-tile lb-tile-red"
                :class="{ 'lb-hint': hint === false }"
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
              <UIcon
                v-if="isBetting && s.seat.votedStart"
                name="i-lucide-check-circle-2"
                class="tcp-voted"
                title="Voted to deal"
              />
              <span v-if="s.seat.winStreak > 1" class="lt-streak">{{ s.seat.winStreak }}</span>
              <span
                class="net lt-mono"
                :class="s.seat.sessionNet > 0 ? 'up' : s.seat.sessionNet < 0 ? 'down' : ''"
              >{{ s.seat.sessionNet > 0 ? '+' : '' }}{{ formatNumber(s.seat.sessionNet) }}</span>
            </div>
          </template>

          <template v-else>
            <div class="lt-sit" :style="pos(s.x, s.y + 108)" @click="table.sit(s.index)">
              <span class="lbl">SIT</span>
            </div>
          </template>
        </template>

        <!-- Your bets, left of the rack -->
        <div class="lt-panel lt-panel-l">
          <div v-if="!connected" class="tcp-panel-note">
            <UIcon name="i-lucide-loader-circle" class="animate-spin" /> Connecting…
          </div>
          <div v-else-if="!mySeat" class="tcp-panel-note">
            Click an open <strong>SIT</strong> ring to join the table
          </div>
          <template v-else>
            <div class="tcp-panel-row">
              <span class="tcp-seat-label">Ante</span>
              <span class="grow" />
              <span class="tcp-seat-value lt-mono">
                {{ formatNumber(myGame?.ante || myGame?.pendingAnte || 0) }}
              </span>
            </div>
            <div class="tcp-panel-row">
              <span class="tcp-seat-label">Pair+</span>
              <span class="grow" />
              <span class="tcp-seat-value lt-mono">
                {{ formatNumber(myGame?.pairPlus || myGame?.pendingPairPlus || 0) }}
              </span>
            </div>
          </template>
        </div>

        <template v-if="isBetting">
          <LiveTableBetBar
            :can-repeat="canRepeatBet"
            :can-scale="canScaleBet"
            :can-undo="canUndoBet"
            :can-clear="canUndoBet"
            @repeat="table.act({ t: 'repeat' })"
            @scale="factor => table.act({ t: 'scale', factor })"
            @undo="table.act({ t: 'undo' })"
            @clear="table.act({ t: 'clear' })"
          />
          <div class="lt-rack">
            <span
              v-for="c in rack"
              :key="c.value"
              :class="{ sel: c.value === selected }"
              @click="selected = c.value"
              v-html="chip(c.value)"
            />
          </div>
        </template>
        <div v-else class="lt-status">
          {{ state?.message ?? 'Waiting for players' }}
        </div>

        <!-- Your seat, right of the rack -->
        <div class="lt-panel lt-panel-r">
          <div class="tcp-panel-row">
            <span class="tcp-seat-label">{{ mySeat ? `Seat ${mySeat.index + 1}` : 'Watching' }}</span>
            <span class="grow" />
            <span class="lt-panel-label">Watching</span>
            <span class="lt-panel-value lt-mono">{{ state?.watching ?? 0 }}</span>
          </div>
          <div v-if="mySeat" class="tcp-panel-row">
            <button class="tcp-mini" @click="showHints = !showHints">
              <UIcon :name="showHints ? 'i-lucide-lightbulb' : 'i-lucide-lightbulb-off'" />
              Hints
            </button>
            <button v-if="!mySeat.leaving" class="tcp-mini danger" @click="table.leave()">
              Leave
            </button>
            <span v-else class="tcp-seat-label">Standing up</span>
          </div>
          <div v-else class="tcp-panel-note">
            Take a seat to play
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

/* Section title inside the corner, above each worked paytable. */
.tcp-paytable-section + .tcp-paytable-section {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid rgba(217, 177, 103, 0.25);
}
.tcp-paytable-title {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--lt-gold);
    opacity: 0.85;
}

.tcp-decide {
    position: absolute;
    display: flex;
    gap: 8px;
    transform: translate(-50%, -50%);
}

.tcp-panel-row {
    display: flex;
    align-items: center;
    gap: 10px;
}
.tcp-panel-note {
    font-size: 15px;
    line-height: 1.4;
    color: #cfc7b6;
}

/* The bottom-right seat panel reads at a glance or not at all — this used to
   be the smallest text on the felt. */
.tcp-seat-label {
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--lt-gold);
    opacity: 0.85;
}
.tcp-seat-value {
    font-size: 28px;
    font-weight: 800;
    color: #f7f3e8;
}
.tcp-mini {
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.08);
    padding: 7px 14px;
    font-size: 16px;
    font-weight: 700;
    color: #e7e0d1;
}
.tcp-mini:hover {
    background: rgb(255 255 255 / 0.16);
}
.tcp-mini.danger {
    color: #fca5a5;
}

.tcp-voted {
    color: var(--ui-success);
    flex-shrink: 0;
}

/* Dealt from the shoe: cardStyle() sets the offset, dropping it two frames
   later is what the transition below actually animates. */
.tcp-deal {
    transition: transform 480ms cubic-bezier(0.16, 0.85, 0.3, 1), opacity 260ms ease-out;
}

/* A hand snapshotted at the moment it cleared, flying off to the discard pile. */
.tcp-ghost {
    transition: transform v-bind('`${DISCARD_MS}ms`') ease-in, opacity v-bind('`${DISCARD_MS}ms`') ease-in;
    pointer-events: none;
}

.tcp-vote {
    position: absolute;
    transform: translate(-50%, -50%);
    text-align: center;
}
.tcp-vote-btn {
    padding-inline: 1.1rem;
}
.tcp-vote-count {
    margin-left: 2px;
    font-weight: 600;
    opacity: 0.85;
}
.tcp-vote-ready {
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.7);
    padding: 8px 18px;
    font-size: 14px;
    font-weight: 700;
    color: #6ee7a8;
    backdrop-filter: blur(4px);
    white-space: nowrap;
}
</style>
