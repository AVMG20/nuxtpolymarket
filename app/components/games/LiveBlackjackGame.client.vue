<script setup lang="ts">
import { chipRackFor } from '#shared/utils/live-blackjack/chips'
import { canDouble, canSplit, canSurrender } from '#shared/utils/live-blackjack/rules'
import { basicStrategy } from '#shared/utils/live-blackjack/strategy'
import { buildTextures } from '~/utils/live-blackjack/art'
import { LiveBlackjackScene, STAGE_H, STAGE_W } from '~/utils/live-blackjack/scene'

const table = useLiveBlackjack()
const { state, actionPulse, youId, balance, connected, feed, mySeat, myHand, isMyTurn } = table

const canvasWrap = ref<HTMLDivElement | null>(null)
const showHints = useCookie<boolean>('lb-show-hint', { default: () => false })
const autoPlay = ref(false)
// Auto-play is a testing aid rather than a feature, so the control only exists
// for someone who has deliberately opted in from the console:
//   localStorage.setItem('BLACKJACK_AUTOPLAY', 'true')
const autoPlayUnlocked = import.meta.client && localStorage.getItem('BLACKJACK_AUTOPLAY') === 'true'
const chatDraft = ref('')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any = null
let scene: LiveBlackjackScene | null = null
let destroyed = false

const rack = computed(() => chipRackFor(balance.value).map(c => c.value))

const decksLeft = computed(() => {
    const shoe = state.value?.shoe
    if (!shoe) return 0
    return Math.max(0.5, (shoe.total - shoe.dealt) / 52)
})

const cardsLeft = computed(() => {
    const shoe = state.value?.shoe
    if (!shoe) return 0
    return Math.max(0, shoe.total - shoe.dealt)
})

const pendingBet = computed(() => mySeat.value?.pendingBet ?? 0)
const pendingSideTotal = computed(() =>
    (mySeat.value?.pendingSide?.perfectPairs ?? 0) + (mySeat.value?.pendingSide?.twentyOnePlusThree ?? 0))
/** Anything on the layout, so undo and clear stay live for a side-bet-only board. */
const staked = computed(() => pendingBet.value + pendingSideTotal.value)
const isBetting = computed(() => state.value?.phase === 'betting' && !!mySeat.value)

const seatedPlayers = computed(() => state.value?.seats.filter(Boolean) ?? [])
// Offered once you have chips down; the round only starts early when every
// seated player has bet and agreed.
const canVoteStart = computed(() => isBetting.value && pendingBet.value > 0 && !mySeat.value?.votedStart)
const startVotes = computed(() => seatedPlayers.value.filter(s => s!.votedStart).length)
const showVotePanel = computed(() => isBetting.value && pendingBet.value > 0)

const needsInsurance = computed(() =>
    state.value?.phase === 'insurance' && !!mySeat.value?.hands.length && !mySeat.value.insuranceDecided)
const insuranceCost = computed(() => (mySeat.value?.hands[0]?.bet ?? 0) / 2)

const seatHands = computed(() => mySeat.value?.hands ?? [])
const canDoubleNow = computed(() =>
    !!myHand.value && canDouble(myHand.value) && balance.value >= myHand.value.bet)
const canSplitNow = computed(() =>
    !!myHand.value && canSplit(myHand.value, seatHands.value) && balance.value >= myHand.value.bet)
const canSurrenderNow = computed(() =>
    !!myHand.value && canSurrender(myHand.value, seatHands.value))

// Only ever the play basic strategy calls for, and only while it is your turn.
const hintAction = computed(() => {
    const up = state.value?.dealer.cards[0]?.rank
    if (!showHints.value || !isMyTurn.value || !myHand.value || !up) return null
    return basicStrategy(myHand.value, up, seatHands.value, balance.value)
})

// Auto-play needs a previous bet to repeat, so it stays off until you make one.
const canAutoPlay = computed(() => !!mySeat.value && (mySeat.value.lastBet > 0 || pendingBet.value > 0))

// Losing the seat stops it; it must never keep acting on a seat you no longer hold.
watch(mySeat, (seat) => {
    if (!seat) autoPlay.value = false
})

/**
 * Plays your seat from the same strategy the hints draw. Keyed on the hand
 * state so a re-broadcast cannot act twice, and delayed a beat so the table
 * reads as a player thinking rather than a script.
 */
let lastAutoKey = ''
function auto(key: string, act: () => void) {
    if (key === lastAutoKey) return
    lastAutoKey = key
    setTimeout(() => {
        if (autoPlay.value) act()
    }, 450)
}

watch(state, (snapshot) => {
    if (!autoPlay.value || !snapshot) return
    const seat = mySeat.value
    if (!seat) return

    if (snapshot.phase === 'betting' && seat.pendingBet === 0 && seat.lastBet > 0) {
        auto(`bet:${snapshot.roundId}`, () => {
            table.repeatBet()
            table.voteStart()
        })
        return
    }
    if (snapshot.phase === 'insurance' && seat.hands.length && !seat.insuranceDecided) {
        auto(`ins:${snapshot.roundId}`, () => table.insurance(false))
        return
    }
    if (snapshot.phase === 'playing' && myHand.value) {
        const up = snapshot.dealer.cards[0]?.rank
        const hand = myHand.value
        if (!up || hand.status !== 'playing') return
        const key = `act:${snapshot.roundId}:${snapshot.activeHand}:${hand.cards.map(c => c.id).join()}`
        auto(key, () => table.act(basicStrategy(hand, up, seatHands.value, balance.value)))
    }
})

// Sound is derived from the same state the scene renders, so no individual
// action has to remember to make a noise.
const { play: playSound, unlock: unlockSound, preload: preloadSound, stop: stopSound, soundEnabled } = useLiveBlackjackSound()

type Snapshot = NonNullable<typeof state.value>

/** Cards on the felt, and how many of those are still face down. */
function cardTally(snapshot: Snapshot) {
    let total = snapshot.dealer.cards.length
    for (const seat of snapshot.seats) {
        if (!seat) continue
        for (const hand of seat.hands) total += hand.cards.length
    }
    return { total, hidden: snapshot.dealer.cards.filter(c => c.hidden).length }
}

let clockSkew = 0
let lastTally = { total: 0, hidden: 0 }
let lastPhase = ''
let lastPending = 0
let lastBusted = 0
let wasMyTurn = false

watch(state, (snapshot) => {
    if (!snapshot) return
    clockSkew = snapshot.now - Date.now()

    const tally = cardTally(snapshot)
    // A card arriving and the hole card turning over are the same total, so
    // only a drop in face-down cards distinguishes the flip.
    if (tally.total > lastTally.total) playSound('card-deal')
    else if (tally.total === lastTally.total && tally.hidden < lastTally.hidden) playSound('card-flip')
    lastTally = tally

    const seat = mySeat.value
    const busted = seat?.hands.filter(h => h.status === 'busted').length ?? 0
    if (busted > lastBusted) playSound('bust')
    lastBusted = busted

    // Side bets share the click sound: the chip landing is the same gesture
    // wherever on the layout it lands.
    const pending = (seat?.pendingBet ?? 0)
        + (seat?.pendingSide?.perfectPairs ?? 0)
        + (seat?.pendingSide?.twentyOnePlusThree ?? 0)
    if (pending > lastPending) playSound('chip-place')
    else if (pending < lastPending && pending > 0) playSound('chip-undo')
    lastPending = pending

    const myTurn = !!seat && snapshot.activeSeat === seat.index
    if (myTurn && !wasMyTurn) playSound('turn-start')
    wasMyTurn = myTurn

    if (snapshot.phase !== lastPhase) {
        lastPhase = snapshot.phase
        if (snapshot.phase === 'payout' && seat && seat.lastNet !== null) {
            const net = seat.lastNet
            if (seat.hands.some(h => h.status === 'blackjack')) playSound('blackjack')
            else if (net > 0) playSound('win')
            // The bust already announced itself when the hand died.
            else if (net < 0 && !seat.hands.some(h => h.status === 'busted')) playSound('lose')
            else if (net === 0) playSound('push')

            if (net > 0) playSound('chip-payout')
            else if (net < 0) playSound('chip-collect')
        }
    }
})

watch(() => feed.value.length, () => {
    const latest = feed.value[feed.value.length - 1]
    if (latest?.kind === 'sideBet') playSound('chip-payout')
    if (latest?.kind === 'shuffle') playSound('shuffle')
    else if (latest?.kind === 'sit') playSound('player-join')
})

// Browsers keep an AudioContext suspended until a gesture, so the first click
// anywhere on the table is what makes everything after it audible.
function onTableClick(event: MouseEvent) {
    unlockSound()
    if ((event.target as HTMLElement | null)?.closest('button')) playSound('button-press')
}

const visibleFeed = computed(() => feed.value.slice(-7))

/**
 * What each seat made on the round that just ended, best first. Only lives for
 * the payout phase — the running session figure is on each player's nameplate.
 */
const roundResults = computed(() => {
    const seats = state.value?.seats ?? []
    return seats
        .filter(seat => !!seat && seat.lastNet !== null)
        .map(seat => ({
            userId: seat!.userId,
            name: seat!.name,
            emblem: seat!.emblem,
            net: seat!.lastNet!,
            blackjack: seat!.hands.some(hand => hand.status === 'blackjack'),
            sideWins: (seat!.sideResults ?? []).filter(result => result.payout > 0)
        }))
        .sort((a, b) => b.net - a.net)
})

const showRoundResults = computed(() =>
    state.value?.phase === 'payout' && roundResults.value.length > 0)

function sendChat() {
    const text = chatDraft.value.trim()
    if (!text) return
    table.chat(text)
    chatDraft.value = ''
}

watch([state, balance], () => {
    if (!scene || !state.value) return
    scene.update(state.value, youId.value, balance.value, rack.value)
})

watch(actionPulse, (pulse) => {
    if (pulse) scene?.flashAction(pulse.seat, pulse.action)
})

let warningTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
    preloadSound()
    // Only the clocks you can act on tick — the dealer drawing does not need
    // a countdown over the top of it.
    warningTimer = setInterval(() => {
        const snapshot = state.value
        const seat = mySeat.value
        if (!snapshot?.phaseEndsAt || !seat) return
        if (!isMyTurn.value && !(snapshot.phase === 'betting' && seat.pendingBet === 0)) return
        const left = snapshot.phaseEndsAt - (Date.now() + clockSkew)
        if (left > 0 && left <= 5000) playSound('timer-warning')
    }, 1000)

    const PIXI = await import('pixi.js')
    if (destroyed) return

    app = new PIXI.Application()
    await app.init({
        width: STAGE_W,
        height: STAGE_H,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(2, window.devicePixelRatio || 1)
    })
    if (destroyed) {
        app.destroy(true)
        return
    }

    app.canvas.style.width = '100%'
    app.canvas.style.height = '100%'
    app.canvas.style.display = 'block'
    canvasWrap.value?.appendChild(app.canvas)

    const textures = buildTextures(PIXI, app.renderer)
    scene = new LiveBlackjackScene(PIXI, app, textures, {
        onSit: seat => table.sit(seat),
        onChip: () => {},
        onPlace: (spot, amount) => table.bet(amount, spot)
    })
    if (state.value) scene.update(state.value, youId.value, balance.value, rack.value)
})

onBeforeUnmount(() => {
    destroyed = true
    if (warningTimer) clearInterval(warningTimer)
    stopSound()
    scene?.destroy()
    scene = null
    app?.destroy(true, { children: true, texture: true })
    app = null
})
</script>

<template>
  <div
    class="relative w-full overflow-hidden rounded-2xl bg-[#0b0806] ring-1 ring-white/10"
    @click.capture="onTableClick"
  >
    <div ref="canvasWrap" class="w-full" style="aspect-ratio: 1600 / 1120;" />

    <!-- What the round just paid. Up between hands only, so it can afford the room. -->
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="-translate-x-3 opacity-0"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="-translate-x-3 opacity-0"
    >
      <div
        v-if="showRoundResults"
        class="absolute left-3 top-3 w-[28%] min-w-60 rounded-xl bg-black/80 p-3 backdrop-blur-sm ring-1 ring-amber-400/25"
      >
        <div class="mb-2 flex items-center justify-between border-b border-white/10 pb-1.5">
          <span class="text-xs font-bold uppercase tracking-wider text-amber-300">Round results</span>
          <span class="text-[10px] text-muted">Hand {{ state?.roundId }}</span>
        </div>
        <ul class="space-y-1">
          <li
            v-for="entry in roundResults"
            :key="entry.userId"
            class="flex items-center gap-2 rounded-md px-1.5 py-1"
            :class="entry.userId === youId ? 'bg-amber-400/10 ring-1 ring-amber-400/30' : ''"
          >
            <ProfileEmblem :emblem="entry.emblem" :name="entry.name" class="size-5 shrink-0 text-[9px]" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-[13px] font-semibold text-default">
                {{ entry.name }}
              </div>
              <div v-if="entry.blackjack || entry.sideWins.length" class="flex flex-wrap gap-1 pt-0.5">
                <span
                  v-if="entry.blackjack"
                  class="rounded-sm bg-amber-500/20 px-1 text-[9px] font-bold uppercase text-amber-300"
                >Blackjack</span>
                <span
                  v-for="win in entry.sideWins"
                  :key="win.key"
                  class="rounded-sm bg-emerald-500/20 px-1 text-[9px] font-bold text-emerald-300"
                >{{ win.label }}</span>
              </div>
            </div>
            <span
              class="shrink-0 font-mono text-sm font-bold tabular-nums"
              :class="entry.net > 0 ? 'text-green-400' : entry.net < 0 ? 'text-red-400' : 'text-muted'"
            >{{ entry.net > 0 ? '+' : entry.net < 0 ? '−' : '' }}{{ formatNumber(Math.abs(entry.net)) }}</span>
          </li>
        </ul>
      </div>
    </Transition>

    <!-- Deal-now vote, centred on the felt where the round is about to happen -->
    <div
      v-if="showVotePanel"
      class="absolute bottom-[50%] left-1/2 -translate-x-1/2 text-center"
    >
      <button
        v-if="canVoteStart"
        class="lb-tile lb-tile-green px-5 shadow-lg"
        @click="table.voteStart()"
      >
        DEAL NOW
        <span v-if="seatedPlayers.length > 1" class="ml-1 font-normal opacity-80">
          ({{ startVotes }}/{{ seatedPlayers.length }})
        </span>
      </button>
      <div v-else class="rounded-xl bg-black/70 px-4 py-2 text-xs font-semibold text-emerald-300 backdrop-blur-sm">
        Ready — waiting for {{ seatedPlayers.length - startVotes }} more
      </div>
    </div>

    <!-- Live feed + table chat -->
    <div class="absolute bottom-2 left-2 w-[20%] min-w-46.5 rounded-xl bg-black/70 p-2 backdrop-blur-sm ring-1 ring-white/10">
      <ul class="mb-1.5 h-26 space-y-0.5 overflow-hidden text-[11px] leading-tight">
        <li
          v-for="item in visibleFeed"
          :key="item.id"
          :class="item.tone === 'win' ? 'text-green-400' : item.tone === 'loss' ? 'text-red-400' : 'text-muted'"
        >
          <span v-if="item.kind === 'chat'" class="text-default">
            <span class="font-bold text-amber-300/90">{{ item.name }}:</span> {{ item.text }}
          </span>
          <span v-else>{{ item.text }}</span>
        </li>
      </ul>
      <form class="flex gap-1" @submit.prevent="sendChat">
        <input
          v-model="chatDraft"
          maxlength="120"
          placeholder="Say something…"
          class="min-w-0 flex-1 rounded-md bg-white/5 px-2 py-1 text-[11px] text-default placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-amber-400/40"
        >
        <UButton type="submit" size="xs" color="neutral" variant="soft" icon="i-lucide-send" />
      </form>
    </div>

    <!--
      One control zone for everything. While chips are on the rail it sits in the
      band above them; every other phase hides the rail and it drops into its
      place, so controls and chips can never share the same space.
    -->
    <div
      class="absolute left-1/2 w-[54%] min-w-75 -translate-x-1/2"
      :class="isBetting ? 'bottom-[14%]' : 'bottom-[4%]'"
    >
      <div v-if="!connected" class="rounded-xl bg-black/70 py-3 text-center text-sm text-muted backdrop-blur-sm">
        <UIcon name="i-lucide-loader-circle" class="animate-spin" /> Connecting…
      </div>

      <div v-else-if="!mySeat" class="rounded-xl bg-black/60 py-3 text-center text-sm text-muted backdrop-blur-sm">
        Click an open <span class="font-bold text-default">SIT</span> spot to join the table
      </div>

      <div
        v-else-if="needsInsurance"
        class="rounded-xl bg-amber-500/15 p-2.5 text-center ring-2 ring-amber-400/70 backdrop-blur-sm"
      >
        <p class="mb-2 text-sm font-bold text-amber-200">
          Dealer shows an Ace — insure for {{ formatNumber(insuranceCost) }}?
        </p>
        <div class="mx-auto flex max-w-90 gap-2">
          <button class="lb-tile lb-tile-amber flex-1" @click="table.insurance(true)">
            Insurance
          </button>
          <button class="lb-tile lb-tile-slate flex-1" @click="table.insurance(false)">
            No thanks
          </button>
        </div>
      </div>

      <div v-else-if="isMyTurn" class="flex gap-2">
        <button class="lb-tile lb-tile-green flex-1" :class="{ 'lb-hint': hintAction === 'hit' }" @click="table.act('hit')">
          HIT
        </button>
        <button class="lb-tile lb-tile-blue flex-1" :class="{ 'lb-hint': hintAction === 'stand' }" @click="table.act('stand')">
          STAND
        </button>
        <button class="lb-tile lb-tile-amber flex-1" :disabled="!canDoubleNow" :class="{ 'lb-hint': hintAction === 'double' }" @click="table.act('double')">
          DOUBLE
        </button>
        <button class="lb-tile lb-tile-yellow flex-1" :disabled="!canSplitNow" :class="{ 'lb-hint': hintAction === 'split' }" @click="table.act('split')">
          SPLIT
        </button>
        <button
          v-if="canSurrenderNow"
          class="lb-tile lb-tile-red flex-1"
          :class="{ 'lb-hint': hintAction === 'surrender' }"
          @click="table.act('surrender')"
        >
          FOLD
        </button>
      </div>

      <div v-else-if="isBetting" class="flex items-center gap-2">
        <div class="rounded-xl bg-black/70 px-3 py-2 text-center backdrop-blur-sm ring-1 ring-white/10">
          <div class="text-[9px] uppercase tracking-wider text-muted">Your bet</div>
          <div class="font-mono text-lg font-bold leading-tight tabular-nums text-amber-300">
            {{ formatNumber(pendingBet) }}
          </div>
          <div v-if="pendingSideTotal" class="text-[9px] leading-tight text-muted">
            +{{ formatNumber(pendingSideTotal) }} side
          </div>
        </div>
        <button class="lb-tile lb-tile-amber flex-1" :disabled="!mySeat.lastBet" @click="table.repeatBet()">
          REPEAT
        </button>
        <button class="lb-tile lb-tile-slate flex-1" :disabled="!staked" @click="table.undoBet()">
          UNDO
        </button>
        <button class="lb-tile lb-tile-red flex-1" :disabled="!staked" @click="table.clearBet()">
          CLEAR
        </button>
      </div>

      <div v-else class="rounded-xl bg-black/60 py-3 text-center text-sm font-semibold text-default backdrop-blur-sm">
        {{ state?.message }}
      </div>
    </div>

    <!-- Shoe depth and hints; counting the cards is left to the player -->
    <div class="absolute bottom-2 right-2 w-[19%] min-w-41 rounded-xl bg-black/70 p-2.5 backdrop-blur-sm ring-1 ring-white/10">
      <div class="flex items-baseline justify-between text-[11px]">
        <span class="font-bold uppercase tracking-wider text-amber-300/80">Shoe</span>
        <span class="font-mono tabular-nums text-default">{{ cardsLeft }} cards</span>
      </div>
      <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          class="h-full bg-amber-400/70 transition-[width] duration-500"
          :style="{ width: `${Math.round((cardsLeft / (state?.shoe.total || 312)) * 100)}%` }"
        />
      </div>
      <div class="mt-1 flex items-center justify-between text-[10px] text-muted">
        <span>{{ state?.watching ?? 0 }} watching</span>
        <span>{{ decksLeft.toFixed(1) }} of {{ state?.shoe.decks ?? 6 }} decks left</span>
      </div>

      <button
        class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition"
        :class="showHints
          ? 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/60'
          : 'bg-white/5 text-muted hover:bg-white/10 hover:text-default'"
        @click="showHints = !showHints"
      >
        <UIcon :name="showHints ? 'i-lucide-lightbulb' : 'i-lucide-lightbulb-off'" />
        Hints {{ showHints ? 'on' : 'off' }}
      </button>

      <button
        class="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition"
        :class="soundEnabled
          ? 'bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/60'
          : 'bg-white/5 text-muted hover:bg-white/10 hover:text-default'"
        @click="soundEnabled = !soundEnabled"
      >
        <UIcon :name="soundEnabled ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" />
        Sound {{ soundEnabled ? 'on' : 'off' }}
      </button>

      <button
        v-if="mySeat && autoPlayUnlocked"
        class="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
        :class="autoPlay
          ? 'bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/60'
          : 'bg-white/5 text-muted hover:bg-white/10 hover:text-default'"
        :disabled="!canAutoPlay"
        :title="canAutoPlay ? 'Play this seat with basic strategy' : 'Place a bet first'"
        @click="autoPlay = !autoPlay"
      >
        <UIcon :name="autoPlay ? 'i-lucide-circle-pause' : 'i-lucide-circle-play'" />
        Auto-play {{ autoPlay ? 'on' : 'off' }}
      </button>

      <div v-if="mySeat" class="mt-2 flex items-center justify-between border-t border-white/10 pt-1.5">
        <span class="text-[10px] text-muted">Seat {{ mySeat.index + 1 }}</span>
        <UButton v-if="!mySeat.leaving" size="xs" color="error" variant="ghost" @click="table.leave()">
          Leave
        </UButton>
        <span v-else class="text-[10px] text-amber-300">Standing up</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Translucent so the felt reads through, but with a solid colour edge that
   stays legible over cards, chips and the dark rail alike. */
.lb-tile {
  padding: 0.7rem 0.5rem;
  border-radius: 0.75rem;
  border-width: 2px;
  border-style: solid;
  font-size: 0.9rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #f8fafc;
  backdrop-filter: blur(6px);
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
  transition: transform 0.12s ease, filter 0.12s ease;
}
.lb-tile:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: brightness(1.3);
}
.lb-tile:active:not(:disabled) {
  transform: translateY(1px);
}
.lb-tile:disabled {
  opacity: 0.32;
  cursor: not-allowed;
}
.lb-tile-green {
  background: rgb(34 197 94 / 0.28);
  border-color: rgb(74 222 128 / 0.75);
}
.lb-tile-blue {
  background: rgb(59 130 246 / 0.28);
  border-color: rgb(96 165 250 / 0.75);
}
.lb-tile-amber {
  background: rgb(245 158 11 / 0.28);
  border-color: rgb(251 191 36 / 0.75);
}
.lb-tile-yellow {
  background: rgb(234 179 8 / 0.3);
  border-color: rgb(253 224 71 / 0.8);
  color: #fefce8;
}
.lb-tile-red {
  background: rgb(239 68 68 / 0.28);
  border-color: rgb(248 113 113 / 0.75);
}
.lb-hint {
  box-shadow: 0 0 0 3px rgb(255 255 255 / 0.85), 0 0 18px 2px rgb(255 255 255 / 0.45);
  animation: lb-hint-pulse 1.1s ease-in-out infinite;
}
@keyframes lb-hint-pulse {
  50% {
    box-shadow: 0 0 0 3px rgb(255 255 255 / 0.5), 0 0 10px 1px rgb(255 255 255 / 0.25);
  }
}
.lb-tile-slate {
  background: rgb(100 116 139 / 0.3);
  border-color: rgb(148 163 184 / 0.7);
}
</style>
