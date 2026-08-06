<script setup lang="ts">
import { chipRackFor } from '#shared/utils/live-blackjack/chips'
import { BAC_BET_KEYS, BAC_PAYOUTS, totalStaked } from '#shared/utils/baccarat/payouts'
import { bigEyeBoyMarks, bigRoadCells, bigRoadColumns } from '#shared/utils/baccarat/roadmap'
import type { BacAction, BacBetKey, BacSeatState, BacSharedState } from '#shared/utils/baccarat/types'
import type { LtSeat } from '#shared/utils/live-table/types'
import { cardBack, cardFace, chip, chipStack } from '~/utils/live-table/art'
import type { LtFeedItem } from '~/composables/live-table'

const SEAT_POS = [
    { x: 222, y: 546 },
    { x: 541, y: 604 },
    { x: 860, y: 630 },
    { x: 1179, y: 604 },
    { x: 1498, y: 546 }
]

/** Shared across the whole live-table suite so a layout reads the same on every game's felt. */
const SHOE_POS = { x: 1431, y: 196 }
const DISCARD_POS = { x: 289, y: 196 }
const PLAYER_HAND_POS = { x: 688, y: 196 }
const BANKER_HAND_POS = { x: 1032, y: 196 }

/** Matches the chip size Three Card Poker lays on its spots, so the two felts read the same. */
const CHIP_SIZE = 56

/**
 * Player/Banker/Tie are the three real outcomes and share the main spot chip
 * size; the pair side bets get their own smaller cluster above the side they
 * ride on. The 10px gap between the three main spots and the 14px gap between
 * a pair spot and its own main spot are sized for their *current* radii, not
 * carried over from a smaller table -- both grew along with the chips they
 * now have to hold legibly.
 *
 * A label is only drawn inside the ring when it actually fits one; PLAYER,
 * TIE and BANKER print below their spot instead, since a bet sitting in the
 * circle would otherwise cover the label.
 */
const SPOT_DEFS: { key: BacBetKey, dx: number, dy: number, r: number, chip: number, label: string, labelBelow: boolean }[] = [
    { key: 'playerPair', dx: -96, dy: -98, r: 38, chip: CHIP_SIZE, label: 'PR', labelBelow: false },
    { key: 'player', dx: -96, dy: 0, r: 46, chip: CHIP_SIZE, label: 'PLAYER', labelBelow: true },
    { key: 'tie', dx: 0, dy: 0, r: 40, chip: CHIP_SIZE, label: 'TIE', labelBelow: true },
    { key: 'banker', dx: 96, dy: 0, r: 46, chip: CHIP_SIZE, label: 'BANKER', labelBelow: true },
    { key: 'bankerPair', dx: 96, dy: -98, r: 38, chip: CHIP_SIZE, label: 'PR', labelBelow: false }
]

/**
 * Cards animate between the shoe and a hand's own resting spot rather than
 * each card's exact fanned-out position -- the fan spread (a few tens of
 * pixels) is trivial next to the few hundred pixels of travel from the shoe,
 * so every card in a hand sharing one vector still reads as dealt from there.
 */
function handStyle(pos: { x: number, y: number }) {
    return {
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        '--deal-from': `translate(${SHOE_POS.x - pos.x}px, ${SHOE_POS.y - pos.y}px)`,
        '--discard-to': `translate(${DISCARD_POS.x - pos.x}px, ${DISCARD_POS.y - pos.y}px)`
    }
}

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
    const data = payload as { type: string, name?: string, spot?: BacBetKey, amount?: number, verb?: string }
    if (data.type === 'shuffle') {
        feedRef.value.push({ id: -(++localFeedSeq), kind: 'game', tone: 'neutral', text: 'Shoe reshuffled · 6 decks in play' })
    } else if (data.type === 'bet' && data.name && data.spot && data.amount) {
        feedRef.value.push({
            id: -(++localFeedSeq),
            kind: 'game',
            tone: 'neutral',
            text: `${data.name} bet ${formatNumber(data.amount)} on ${SPOT_LABEL[data.spot]}`
        })
    } else if (data.type === 'rebet' && data.name && data.verb && data.amount) {
        feedRef.value.push({
            id: -(++localFeedSeq),
            kind: 'game',
            tone: 'neutral',
            text: `${data.name} ${data.verb} their bet (${formatNumber(data.amount)})`
        })
    }
}

const table = useLiveTable<BacSeatState, BacSharedState, BacAction>('baccarat', onGameEvent)
const { state, youId, balance, connected, feed, chat, mySeat, skew } = table
feedRef = feed

// Rejections (seat taken, can't afford it) only otherwise land as a line in
// the sidebar feed, easy to miss right after a click that visibly did nothing.
const toast = useToast()
watch(() => feed.value.length, () => {
    const latest = feed.value[feed.value.length - 1]
    if (latest?.kind === 'error') toast.add({ title: latest.text, color: 'error' })
})

// settle() -- and so a fresh lastNet -- only lands the instant the phase
// becomes 'payout'; during 'resolve' the hand total is already known but the
// money has not moved yet. A player who sat out the round keeps lastNet null.
watch(() => state.value?.phase, (phase, previous) => {
    if (phase !== 'payout' || previous === 'payout') return
    const seat = mySeat.value
    const net = seat?.lastNet
    if (net === null || net === undefined) return
    if (net > 0) {
        // Which spots actually paid, so "you won" reads as more than a number.
        const wins = BAC_BET_KEYS
            .filter(key => seat!.game.bets[key] > 0 && spotWins(key))
            .map(key => `${SPOT_LABEL[key]} +${formatNumber(seat!.game.bets[key] * BAC_PAYOUTS[key])}`)
        toast.add({
            title: `You won ${formatNumber(net)}`,
            description: wins.join(' · ') || undefined,
            color: 'success'
        })
    } else if (net < 0) {
        toast.add({ title: `You lost ${formatNumber(Math.abs(net))}`, color: 'error' })
    } else {
        toast.add({ title: 'Push — bet returned', color: 'neutral' })
    }
})

const round = computed(() => state.value?.game.round ?? null)
/**
 * Read off the round rather than gated behind a v-if on it: the hands have to
 * stay mounted for their TransitionGroup to animate at all. A group that mounts
 * with its cards already in it runs no enter transition, and one unmounted with
 * the round runs no leave transition, which left the whole deal instant.
 */
const playerCards = computed(() => round.value?.playerCards ?? [])
const bankerCards = computed(() => round.value?.bankerCards ?? [])

/** Player and banker alternate on a real deal, so banker rides half a beat behind. */
const DEAL_STAGGER_MS = 130
function dealDelay(index: number, banker = false): string {
    return `${index * DEAL_STAGGER_MS + (banker ? DEAL_STAGGER_MS / 2 : 0)}ms`
}

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

const myTotalBet = computed(() => mySeat.value ? totalStaked(mySeat.value.game.bets) : 0)
const hasLastBet = computed(() => !!mySeat.value && totalStaked(mySeat.value.game.lastBets) > 0)
const canRepeat = computed(() => isBetting.value && hasLastBet.value)
const canScale = computed(() => isBetting.value && (myTotalBet.value > 0 || hasLastBet.value))
const canClear = computed(() => isBetting.value && myTotalBet.value > 0)

// Offered once you have chips down, same as Live Blackjack -- voting with
// nothing staked would let an empty seat skip the clock for everyone else.
const seatedPlayers = computed(() => state.value?.seats.filter(Boolean) ?? [])
const startVotes = computed(() => seatedPlayers.value.filter(s => s!.votedStart).length)
const canVoteStart = computed(() => isBetting.value && myTotalBet.value > 0 && !mySeat.value?.votedStart)
const showVotePanel = computed(() => isBetting.value && myTotalBet.value > 0)

const cardsRemaining = computed(() => {
    const shoe = state.value?.game.shoe
    return shoe ? Math.max(0, shoe.total - shoe.dealt) : 0
})
const hasDiscards = computed(() => (state.value?.game.shoe.dealt ?? 0) > 0)
const untilShuffle = computed(() => state.value?.game.shoe.untilShuffle ?? 0)

const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => { clockTimer = setInterval(() => { now.value = Date.now() }, 250) })
onBeforeUnmount(() => { if (clockTimer) clearInterval(clockTimer) })

const secondsLeft = computed(() => {
    const snapshot = state.value
    if (!snapshot?.phaseEndsAt) return null
    return Math.max(0, Math.ceil((snapshot.phaseEndsAt - (now.value + skew.value)) / 1000))
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

function scaleBets(factor: number) {
    table.act({ kind: 'scale', factor })
}
</script>

<template>
  <div class="flex flex-col gap-3 lg:flex-row lg:items-start">
    <div class="min-w-0 flex-1">
      <LiveTableStage>
        <TransitionGroup name="lt-deal" tag="div" class="lt-hand" :style="handStyle(PLAYER_HAND_POS)">
          <span
            v-for="(card, idx) in playerCards"
            :key="card.id"
            :style="{ transitionDelay: dealDelay(idx) }"
            v-html="cardFace(card.rank!, card.suit!)"
          />
        </TransitionGroup>
        <TransitionGroup name="lt-deal" tag="div" class="lt-hand" :style="handStyle(BANKER_HAND_POS)">
          <span
            v-for="(card, idx) in bankerCards"
            :key="card.id"
            :style="{ transitionDelay: dealDelay(idx, true) }"
            v-html="cardFace(card.rank!, card.suit!)"
          />
        </TransitionGroup>

        <template v-if="showTotals && round">
          <div
            class="lt-badge"
            :class="badgeClass('player')"
            :style="{ left: `${PLAYER_HAND_POS.x}px`, top: '300px', fontSize: '24px', padding: '6px 18px' }"
          >
            PLAYER {{ round.playerTotal }}<span v-if="round.playerNatural"> · NATURAL</span>
          </div>
          <div
            class="lt-badge"
            :class="badgeClass('banker')"
            :style="{ left: `${BANKER_HAND_POS.x}px`, top: '300px', fontSize: '24px', padding: '6px 18px' }"
          >
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

        <!-- Betting is the only phase with no cards on the felt, so the empty
             dealer area is where a vote to skip the rest of the clock lives. -->
        <div v-if="showVotePanel" class="bac-vote" style="top:270px">
          <button v-if="canVoteStart" class="bac-vote-btn" @click="table.voteStart()">
            DEAL NOW
            <span v-if="seatedPlayers.length > 1" class="bac-vote-count">({{ startVotes }}/{{ seatedPlayers.length }})</span>
          </button>
          <div v-else class="bac-vote-waiting">
            Ready — waiting for {{ seatedPlayers.length - startVotes }} more
          </div>
          <div v-if="seatedPlayers.length > 1" class="bac-vote-list">
            <span
              v-for="s in seatedPlayers"
              :key="s!.userId"
              class="bac-vote-chip"
              :class="{ voted: s!.votedStart }"
            >
              {{ s!.name }}
              <UIcon v-if="s!.votedStart" name="i-lucide-check" class="size-3" />
            </span>
          </div>
        </div>

        <template v-for="(pos, i) in SEAT_POS" :key="i">
          <div
            v-if="!seatAt(i)"
            class="lt-sit"
            :class="{ 'bac-sit-taken': mySeat }"
            :style="{ left: `${pos.x}px`, top: `${pos.y + 106}px` }"
            @click="!mySeat && table.sit(i)"
          >
            <span class="lbl">SIT</span>
          </div>
          <template v-if="seatAt(i)">
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
                top: `${pos.y + 106 + def.dy}px`,
                width: `${def.r * 2}px`,
                height: `${def.r * 2}px`,
                margin: `${-def.r}px 0 0 ${-def.r}px`,
                cursor: canBetHere(seatAt(i)) ? 'pointer' : 'default'
              }"
              @click="canBetHere(seatAt(i)) && placeBet(def.key)"
            >
              <span v-if="!def.labelBelow" class="lt-spot-label" style="font-size:12px">{{ def.label }}</span>
              <div
                v-if="seatAt(i)!.game.bets[def.key] > 0"
                style="position:absolute;bottom:6px"
                v-html="chipStack(seatAt(i)!.game.bets[def.key], { size: def.chip, max: 3 })"
              />
            </div>
            <div
              v-for="def in SPOT_DEFS.filter(d => d.labelBelow)"
              :key="`${def.key}-caption`"
              class="bac-spot-caption"
              :style="{ left: `${pos.x + def.dx}px`, top: `${pos.y + 106 + def.dy + def.r + 10}px` }"
            >
              {{ def.label }}
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

        <LiveTableCorner title="Roadmap">
          <div style="width:340px">
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
        </LiveTableCorner>

        <template v-if="!connected">
          <div class="lt-status">
            <UIcon name="i-lucide-loader-circle" class="animate-spin" /> Connecting&hellip;
          </div>
        </template>
        <template v-else-if="mySeat">
          <LiveTableBetBar
            :can-repeat="canRepeat"
            :can-scale="canScale"
            :can-clear="canClear"
            :show-undo="false"
            @repeat="table.act({ kind: 'repeat' })"
            @scale="scaleBets"
            @clear="clearBets"
          />
          <div class="lt-rack" :class="{ 'bac-rack-muted': !isBetting }">
            <span
              v-for="value in rack"
              :key="value"
              :class="{ sel: value === selectedChip }"
              @click="selectedChip = value"
              v-html="chip(value)"
            />
          </div>
          <div class="lt-panel lt-panel-l">
            <span class="lt-panel-label">Your bet</span>
            <span class="lt-panel-value lt-mono">{{ formatNumber(myTotalBet) }}</span>
          </div>
          <div class="lt-panel lt-panel-r">
            <div class="flex items-center justify-between">
              <span class="lt-panel-label">Seat {{ mySeat.index + 1 }}</span>
              <span class="bac-watching">{{ state?.watching ?? 0 }} watching</span>
            </div>
            <button v-if="!mySeat.leaving" class="bac-clear-btn self-start" @click="table.leave()">
              Leave
            </button>
            <span v-else class="self-start text-xs text-amber-300">Standing up</span>
          </div>
        </template>
        <template v-else>
          <div class="lt-status">
            Click an open <span class="bac-sit-word">SIT</span> spot to join the table
          </div>
        </template>

        <!-- Discard pile: purely presentational, collects the cards the felt
             animates away at the end of a round. Aligned to the coordinate
             every game in this suite discards to, so a layout reads the same
             on the Pixi blackjack table as it does here. -->
        <div class="bac-tray" :style="{ left: `${DISCARD_POS.x}px`, top: `${DISCARD_POS.y}px` }">
          <template v-if="hasDiscards">
            <span class="bac-tray-card" style="left:12px;top:8px" v-html="cardBack()" />
            <span class="bac-tray-card" style="left:6px;top:4px" v-html="cardBack()" />
          </template>
        </div>
        <div class="bac-tray-label" :style="{ left: `${DISCARD_POS.x}px`, top: `${DISCARD_POS.y + 96}px` }">
          Discard
        </div>

        <!-- Shoe: the actual draw point every dealt card animates out from,
             aligned to the coordinate the Pixi blackjack table also uses. -->
        <div class="bac-tray" :style="{ left: `${SHOE_POS.x}px`, top: `${SHOE_POS.y}px` }">
          <span class="bac-tray-card" style="left:12px;top:8px" v-html="cardBack()" />
          <span class="bac-tray-card" style="left:6px;top:4px" v-html="cardBack()" />
          <span class="bac-tray-card" style="left:0;top:0" v-html="cardBack()" />
          <div class="bac-shoe-cut" />
        </div>
        <div class="bac-tray-label" :style="{ left: `${SHOE_POS.x}px`, top: `${SHOE_POS.y + 96}px` }">
          Shoe
        </div>

        <LiveTableCorner title="Shoe" side="right" open>
          <div class="lt-mono text-2xl font-extrabold leading-none" style="color:var(--lt-gold)">
            {{ cardsRemaining }}
          </div>
          <div class="mt-0.5 text-[10px] text-muted">
            cards remaining
          </div>
          <div class="mt-1.5 text-[10px]" style="color:var(--lt-gold)">
            cut card &middot; {{ untilShuffle }} to go
          </div>
        </LiveTableCorner>
      </LiveTableStage>
    </div>

    <div class="flex h-[min(820px,calc(100vh-140px))] w-full shrink-0 flex-col gap-2 lg:w-80">
      <LiveTableFeed :items="feed" title="Table feed" class="min-h-0 flex-[3]" />
      <LiveTableChat :messages="chat" class="min-h-0 flex-[4]" @send="table.chatSend($event)" />
      <LiveTableScoreboard :entries="state?.scoreboard ?? []" :you-id="youId" class="min-h-0 flex-[3]" />
    </div>
  </div>
</template>

<style scoped>
.bac-sit-word {
  color: var(--lt-gold);
  font-weight: 800;
}
/* A seated player still sees which other seats are open, just dimmed and
   inert -- clicking another seat while you already hold one only earns a
   rejection toast. */
.bac-sit-taken {
  opacity: 0.4;
  animation: none;
  cursor: default;
}
.bac-sit-taken:hover {
  transform: none;
  background: rgba(0, 0, 0, 0.4);
}

.bac-vote {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
}
.bac-vote-btn {
  background: rgba(34, 197, 94, 0.28);
  border: 2px solid rgba(74, 222, 128, 0.75);
  border-radius: 999px;
  padding: 10px 22px;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #f8fafc;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  cursor: pointer;
  transition: transform 0.12s ease, filter 0.12s ease;
}
.bac-vote-btn:hover {
  transform: translateY(-2px);
  filter: brightness(1.25);
}
.bac-vote-count {
  font-weight: 600;
  opacity: 0.85;
}
.bac-vote-waiting {
  background: rgba(0, 0, 0, 0.7);
  border-radius: 999px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ui-success);
  backdrop-filter: blur(4px);
}
.bac-vote-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 5px;
  margin-top: 8px;
  max-width: 420px;
}
.bac-vote-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(217, 177, 103, 0.3);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 700;
  color: rgba(247, 243, 232, 0.7);
}
.bac-vote-chip.voted {
  border-color: var(--ui-success);
  color: var(--ui-success);
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
.bac-watching {
  font-size: 11px;
  color: rgba(247, 243, 232, 0.55);
}

/* Dimmed rather than swapped out once betting closes, so the layout does not
   jump between phases -- only how lit and clickable the rack is changes. */
.lt-rack {
  transition: opacity 0.25s ease;
}
.bac-rack-muted {
  opacity: 0.3;
  pointer-events: none;
}

/* Centred exactly on its (x,y) stage coordinate -- the shoe and discard tray
   both anchor here so the card-dealing animation's start/end point lines up
   with where the sprite actually sits. */
/* Sized off the cards themselves: the tray holds them at the same size they are
   dealt at, so the shoe reads as the stack the hands actually came out of. */
.bac-tray {
  position: absolute;
  width: 124px;
  height: 164px;
  transform: translate(-50%, -50%);
}
.bac-tray-card {
  position: absolute;
}
.bac-tray-label {
  position: absolute;
  transform: translate(-50%, 0);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--lt-gold);
  opacity: 0.75;
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}
.bac-shoe-cut {
  position: absolute;
  left: -8px;
  top: 76px;
  width: 132px;
  height: 4px;
  background: var(--lt-gold);
  box-shadow: 0 0 6px var(--lt-gold);
}

.bac-spot-caption {
  position: absolute;
  transform: translate(-50%, 0);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: var(--lt-gold);
  opacity: 0.85;
  white-space: nowrap;
  pointer-events: none;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}

.bac-road-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lt-gold);
  opacity: 0.8;
  margin: 6px 0 3px;
}
.bac-grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(6, var(--cell, 18px));
  grid-auto-columns: var(--cell, 18px);
  gap: 2px;
  overflow: hidden;
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

/* --deal-from and --discard-to are set per-hand (see handStyle()) and
   inherited from the .lt-hand container onto each card span they animate. */
.lt-deal-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.lt-deal-enter-from {
  opacity: 0;
  transform: var(--deal-from);
}
/* position:absolute takes the leaving card out of the fan's flex flow while
   keeping its just-computed spot as the static position CSS falls back to
   when left/top are unset -- it starts the discard animation exactly where
   the card was sitting instead of snapping to the hand's own corner. */
.lt-deal-leave-active {
  position: absolute;
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.lt-deal-leave-to {
  opacity: 0;
  transform: var(--discard-to);
}
</style>
