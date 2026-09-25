<script setup lang="ts">
import NeighcassoTrack from '~/components/games/neighcasso/NeighcassoTrack.client.vue'
import NeighcassoHorseCanvas from '~/components/games/neighcasso/NeighcassoHorseCanvas.vue'
import NeighcassoStable from '~/components/games/neighcasso/NeighcassoStable.vue'
import NeighcassoSharedHorseModal from '~/components/games/neighcasso/NeighcassoSharedHorseModal.vue'
import { botDrawing } from '#shared/utils/neighcasso/bots'
import { NC_LANES } from '#shared/utils/neighcasso/types'
import type {
    NcAction,
    NcBot,
    NcDrawing,
    NcHorse,
    NcSeatState,
    NcSharedHorse,
    NcSharedState
} from '#shared/utils/neighcasso/types'
import type { LtSeat } from '#shared/utils/live-table/types'

const PREFS_KEY = 'neighcasso:prefs'
/** One colour per gate, so a lane, its gate card and its label always match. */
const LANE_COLORS = ['#e4572e', '#2e86ab', '#f2a541', '#6a994e', '#9d4edd', '#ef476f']

const toast = useToast()
const route = useRoute()
const router = useRouter()

const table = useLiveTable<NcSeatState, NcSharedState, NcAction>('neighcasso')
const { state, mySeat, seated, skew, balance } = table

watch(table.lastError, (message) => {
    if (message) toast.add({ title: message, color: 'error' })
    table.lastError.value = ''
})

// ─── clock ─────────────────────────────────────────────────────────────────

const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => {
    clock = setInterval(() => { now.value = Date.now() }, 250)
})
onBeforeUnmount(() => {
    if (clock) clearInterval(clock)
})

const secondsLeft = computed(() => {
    const ends = state.value?.phaseEndsAt
    if (!ends) return null
    return Math.max(0, Math.ceil((ends - (now.value + skew.value)) / 1000))
})

const phase = computed(() => state.value?.phase ?? 'idle')
const inLobby = computed(() => phase.value === 'idle' || phase.value === 'lobby')
const game = computed(() => state.value?.game ?? null)
const pot = computed(() => game.value?.pot ?? 0)

const statusLine = computed(() => {
    const s = secondsLeft.value
    switch (phase.value) {
        case 'lobby':
            if (s !== null) return `${state.value?.message} · ${s}s`
            return state.value?.message ?? ''
        case 'gates': return 'They\'re in the gates!'
        case 'racing': return 'AND THEY\'RE OFF!'
        case 'finish': return s !== null ? `Next race in ${s}s` : 'Photo finish!'
        default: return 'Grab a gate to open the lobby'
    }
})

// ─── drawings ──────────────────────────────────────────────────────────────

const drawings = reactive(new Map<string, NcDrawing | null>())
const pending = new Set<string>()

function drawingKey(seat: NcSeatState) {
    return seat.horseId ? `${seat.horseId}:${seat.horseRev}` : ''
}

async function loadDrawing(seat: NcSeatState) {
    const key = drawingKey(seat)
    if (!key || drawings.has(key) || pending.has(key)) return
    pending.add(key)
    try {
        const horse = await $fetch<NcSharedHorse>(`/api/neighcasso/horses/${seat.horseId}`)
        drawings.set(key, horse.drawing)
    } catch {
        // Deleted since it entered: the renderer falls back to its own doodle.
        drawings.set(key, null)
    } finally {
        pending.delete(key)
    }
}

watch(() => state.value?.seats, (seats) => {
    for (const seat of seats ?? []) if (seat) void loadDrawing(seat.game)
}, { immediate: true })

function drawingFor(seat: LtSeat<NcSeatState>) {
    return drawings.get(drawingKey(seat.game)) ?? null
}

const botDrawings = new Map<number, NcDrawing>()
function drawingForBot(bot: NcBot) {
    let drawing = botDrawings.get(bot.seed)
    if (!drawing) {
        drawing = botDrawing(bot.seed)
        botDrawings.set(bot.seed, drawing)
    }
    return drawing
}

const bots = computed(() => game.value?.bots ?? [])
const humansSeated = computed(() => (state.value?.seats ?? []).filter(Boolean).length)
const maxBots = computed(() => NC_LANES - humansSeated.value)
const fee = computed(() => game.value?.fee ?? 0)

const gates = computed(() => {
    const seats = state.value?.seats ?? Array.from({ length: NC_LANES }, () => null)
    return seats.map((seat, index) => ({
        index,
        seat,
        bot: seat ? null : bots.value.find(b => b.seat === index) ?? null,
        color: LANE_COLORS[index]!
    }))
})

const trackHorses = computed(() => gates.value.flatMap((g) => {
    if (g.seat && (!game.value?.race || g.seat.game.racing)) {
        return [{
            seat: g.index,
            horseName: g.seat.game.horseName || 'Mystery Horse',
            playerName: g.seat.name,
            drawing: drawingFor(g.seat),
            color: g.color,
            isMe: g.seat.userId === table.youId.value
        }]
    }
    if (g.bot) {
        return [{ seat: g.index, horseName: g.bot.name, playerName: 'house bot', drawing: drawingForBot(g.bot), color: g.color, isMe: false }]
    }
    return []
}))

const matched = computed(() => game.value?.matched ?? 0)

/** Every horse in the gates with a stake behind it. */
const slip = computed(() => gates.value.flatMap((g) => {
    if (g.seat && (!game.value?.race || g.seat.game.racing) && g.seat.game.bet > 0) {
        const { horseName, horseWins, horseRaces, bet } = g.seat.game
        return [{
            seat: g.index,
            color: g.color,
            player: g.seat.name,
            horse: horseName || 'no horse yet',
            bet,
            plays: Math.min(bet, matched.value),
            wins: horseWins,
            races: horseRaces,
            sessionNet: g.seat.sessionNet as number | null,
            isMe: g.seat.userId === table.youId.value,
            bot: false
        }]
    }
    if (g.bot) {
        return [{
            seat: g.index,
            color: g.color,
            player: 'house bot',
            horse: g.bot.name,
            bet: g.bot.bet,
            plays: g.bot.bet,
            wins: 0,
            races: 0,
            sessionNet: null,
            isMe: false,
            bot: true
        }]
    }
    return []
}))

/** Matched bets make every horse an equal shot. */
const chance = computed(() => (slip.value.length ? 1 / slip.value.length : 0))

function oddsOf(bet: number) {
    return bet > 0 ? chance.value : 0
}

/** What my horse pays if it wins, as the lobby stands. */
const winnerGets = computed(() => pot.value * (bots.value.length ? 1 - fee.value : 1))
const myWin = computed(() => (mySeat.value?.game.bet ? winnerGets.value : 0))

function toggleBot(seat: number, on: boolean) {
    if (!seated.value || !inLobby.value) return
    table.act({ type: 'bot', seat, on })
}

function setBots(count: number) {
    if (!seated.value || !inLobby.value) return
    table.act({ type: 'bots', count: Math.max(0, Math.min(maxBots.value, count)) })
}

// ─── my gate ───────────────────────────────────────────────────────────────

interface Prefs { horseId: string | null, bet: number }

function readPrefs(): Prefs {
    try {
        const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null
        return { horseId: raw?.horseId ?? null, bet: Number(raw?.bet) || 100 }
    } catch {
        return { horseId: null, bet: 100 }
    }
}

function savePrefs(prefs: Prefs) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch { /* private mode: the prefs just aren't remembered */ }
}

const prefs = ref<Prefs>({ horseId: null, bet: 100 })
const betAmount = ref(100)
const betText = useAmountInput(betAmount, { shorthand: true })
const betHint = computed(() => amountPreview(betText.value))
const pickedHorse = ref<NcHorse | null>(null)

onMounted(() => {
    prefs.value = readPrefs()
    betAmount.value = prefs.value.bet
})

watch(() => mySeat.value?.game.bet, (bet) => {
    if (bet) betAmount.value = bet
})

const myReady = computed(() => !!mySeat.value?.votedStart)
const myHorseName = computed(() => mySeat.value?.game.horseName || pickedHorse.value?.name || '')

function sitAt(index: number) {
    if (seated.value || !inLobby.value) return
    table.sit(index)
    // The socket processes these in order, so the horse and bet land on the
    // seat the sit just claimed.
    if (prefs.value.horseId) table.act({ type: 'horse', horseId: prefs.value.horseId })
    if (betAmount.value >= 1) table.act({ type: 'bet', amount: betAmount.value })
}

function pickHorse(horse: NcHorse) {
    pickedHorse.value = horse
    prefs.value = { ...prefs.value, horseId: horse.id }
    savePrefs(prefs.value)
    if (seated.value && inLobby.value) table.act({ type: 'horse', horseId: horse.id })
}

function commitBet() {
    if (!seated.value || !inLobby.value) return
    if (!(betAmount.value >= 1)) return
    prefs.value = { ...prefs.value, bet: betAmount.value }
    savePrefs(prefs.value)
    if (mySeat.value?.game.bet !== betAmount.value) table.act({ type: 'bet', amount: betAmount.value })
}

function scaleBet(factor: number) {
    betAmount.value = Math.max(1, Math.floor(betAmount.value * factor))
}

function allIn() {
    betAmount.value = Math.max(1, Math.floor(balance.value))
}

function toggleReady() {
    if (!mySeat.value) return
    if (myReady.value) {
        table.act({ type: 'unready' })
        return
    }
    commitBet()
    table.voteStart()
}

const canReady = computed(() => !!mySeat.value?.game.horseId && betAmount.value >= 1)

// ─── stable + share links ─────────────────────────────────────────────────

const stable = ref<{ refresh: () => void } | null>(null)
const sharedId = ref<string | null>(null)
const sharedOpen = computed({
    get: () => !!sharedId.value,
    set: (open) => {
        if (open) return
        sharedId.value = null
        const { horse: _horse, ...rest } = route.query
        void router.replace({ query: rest })
    }
})

watch(() => route.query.horse, (id) => {
    sharedId.value = typeof id === 'string' && id ? id : null
}, { immediate: true })

function onAdopted(horse: NcHorse) {
    stable.value?.refresh()
    // Swapping the horse under a seated player would quietly change their race.
    if (!seated.value) pickHorse(horse)
}

</script>

<template>
    <div class="ncg">
        <!-- marquee -->
        <header class="ncg-marquee">
            <div class="ncg-title">
                <span class="ncg-title-main">Neighcasso Derby</span>
                <span class="ncg-title-sub">draw a horse · bet the farm · pray</span>
            </div>
            <div class="ncg-pot" :class="{ 'is-hot': pot > 0 }">
                <span class="ncg-pot-label">the pot</span>
                <span class="ncg-pot-value">{{ formatNumber(pot) }}</span>
            </div>
            <div class="ncg-status">
                <span class="ncg-dot" :class="table.connected.value ? 'is-on' : 'is-off'" />
                {{ table.connected.value ? statusLine : 'Reconnecting to the racetrack…' }}
            </div>
        </header>

        <!-- track -->
        <div class="ncg-track">
            <NeighcassoTrack
                :race="game?.race ?? null"
                :horses="trackHorses"
                :phase="phase"
                :result="game?.result ?? null"
                :skew="skew"
            />
        </div>

        <div class="ncg-grid">
            <!-- gates -->
            <section class="ncg-card ncg-gates">
                <div class="ncg-card-head">
                    <h2>Starting gates</h2>
                    <span class="ncg-muted">Everyone races for the smallest bet, so every horse has the same odds. Winner takes the pot{{ bots.length ? `, less the ${Math.round(fee * 100)}% house fee when bots run` : '' }}.</span>
                </div>
                <div class="ncg-gate-grid">
                    <div
                        v-for="gate in gates"
                        :key="gate.index"
                        class="ncg-gate"
                        :class="{
                            'is-me': gate.seat?.userId === table.youId.value,
                            'is-ready': gate.seat?.votedStart || gate.seat?.game.racing,
                            'is-empty': !gate.seat && !gate.bot,
                            'is-bot': !!gate.bot
                        }"
                        :style="{ '--lane': gate.color }"
                    >
                        <span class="ncg-gate-num">{{ gate.index + 1 }}</span>

                        <template v-if="gate.seat">
                            <div class="ncg-gate-horse">
                                <NeighcassoHorseCanvas
                                    :drawing="drawingFor(gate.seat)"
                                    :height="64"
                                    :gait="gate.seat.votedStart ? 0.6 : 0"
                                    :pose="game?.result?.winnerSeat === gate.index ? 'win' : 'idle'"
                                />
                            </div>
                            <div class="ncg-gate-name">
                                {{ gate.seat.game.horseName || 'no horse yet' }}
                            </div>
                            <div class="ncg-gate-owner">
                                {{ gate.seat.name }}<span v-if="!gate.seat.connected"> (gone?)</span>
                            </div>
                            <div class="ncg-gate-bet">
                                <span>{{ formatNumber(Math.min(gate.seat.game.bet, matched || gate.seat.game.bet)) }}</span>
                                <span class="ncg-odds">{{ Math.round(oddsOf(gate.seat.game.bet) * 100) }}%</span>
                            </div>
                            <span v-if="gate.seat.game.racing" class="ncg-badge">racing</span>
                            <span v-else-if="gate.seat.votedStart" class="ncg-badge">ready!</span>
                            <span v-else class="ncg-badge is-idle">thinking…</span>
                        </template>

                        <template v-else-if="gate.bot">
                            <div class="ncg-gate-horse">
                                <NeighcassoHorseCanvas
                                    :drawing="drawingForBot(gate.bot)"
                                    :height="64"
                                    :pose="game?.result?.winnerSeat === gate.index ? 'win' : 'idle'"
                                />
                            </div>
                            <div class="ncg-gate-name">
                                {{ gate.bot.name }}
                            </div>
                            <div class="ncg-gate-owner">
                                house bot · matches the smallest bet
                            </div>
                            <div class="ncg-gate-bet">
                                <span>{{ formatNumber(gate.bot.bet) }}</span>
                                <span class="ncg-odds">{{ Math.round(oddsOf(gate.bot.bet) * 100) }}%</span>
                            </div>
                            <button
                                v-if="!seated && inLobby"
                                type="button"
                                class="ncg-badge ncg-badge-btn"
                                :disabled="!table.connected.value"
                                @click="sitAt(gate.index)"
                            >
                                take this gate
                            </button>
                            <button
                                v-else-if="seated && inLobby"
                                type="button"
                                class="ncg-badge ncg-badge-btn is-remove"
                                @click="toggleBot(gate.index, false)"
                            >
                                ✕ send bot home
                            </button>
                            <span v-else class="ncg-badge is-bot">beep boop</span>
                        </template>

                        <button
                            v-else-if="seated && inLobby"
                            type="button"
                            class="ncg-gate-join is-bot"
                            :disabled="!table.connected.value"
                            @click="toggleBot(gate.index, true)"
                        >
                            <span class="ncg-gate-plus">🤖</span>
                            <span>add a bot</span>
                        </button>
                        <button
                            v-else
                            type="button"
                            class="ncg-gate-join"
                            :disabled="seated || !inLobby || !table.connected.value"
                            @click="sitAt(gate.index)"
                        >
                            <span class="ncg-gate-plus">+</span>
                            <span>{{ !inLobby ? 'next race' : 'enter here' }}</span>
                        </button>
                    </div>
                </div>

                <!-- my controls -->
                <div v-if="mySeat && !inLobby" class="ncg-controls">
                    <strong>{{ mySeat.game.racing ? `${myHorseName} is running for ${formatNumber(mySeat.game.bet)}. Hold your hat!` : 'Sitting this one out.' }}</strong>
                </div>
                <div v-else-if="mySeat" class="ncg-controls">
                    <div class="ncg-controls-horse">
                        <span class="ncg-muted">Racing with</span>
                        <strong>{{ myHorseName || 'pick a horse from your stable ↓' }}</strong>
                    </div>
                    <div class="ncg-bet">
                        <label class="ncg-muted" for="ncg-bet">Bet</label>
                        <div class="ncg-bet-field">
                            <input
                                id="ncg-bet"
                                v-model="betText"
                                inputmode="decimal"
                                autocomplete="off"
                                :disabled="!inLobby || myReady"
                                @keydown.enter="commitBet"
                                @blur="commitBet"
                            >
                            <span v-if="betHint" class="ncg-bet-hint">{{ betHint }}</span>
                        </div>
                        <button type="button" class="ncg-chip" :disabled="!inLobby || myReady" @click="scaleBet(0.5)">
                            ½
                        </button>
                        <button type="button" class="ncg-chip" :disabled="!inLobby || myReady" @click="scaleBet(2)">
                            2×
                        </button>
                        <button type="button" class="ncg-chip" :disabled="!inLobby || myReady" @click="allIn">
                            all in
                        </button>
                    </div>
                    <div class="ncg-bots">
                        <span class="ncg-muted">Bots</span>
                        <button type="button" class="ncg-chip" :disabled="bots.length <= 0" aria-label="Remove a bot" @click="setBots(bots.length - 1)">
                            −
                        </button>
                        <strong class="ncg-bots-count">{{ bots.length }}</strong>
                        <button type="button" class="ncg-chip" :disabled="bots.length >= maxBots" aria-label="Add a bot" @click="setBots(bots.length + 1)">
                            +
                        </button>
                        <span v-if="mySeat.game.bet" class="ncg-muted">
                            {{ Math.round(oddsOf(mySeat.game.bet) * 100) }}% to win {{ formatNumber(myWin) }}
                        </span>
                    </div>
                    <div class="ncg-controls-actions">
                        <button
                            type="button"
                            class="ncg-ready"
                            :class="{ 'is-ready': myReady }"
                            :disabled="!inLobby || (!myReady && !canReady)"
                            @click="toggleReady"
                        >
                            {{ myReady ? 'Ready! (click to wait)' : 'Ready up' }}
                        </button>
                        <button type="button" class="ncg-leave" :disabled="!!mySeat.game.racing" @click="table.leave()">
                            leave gate
                        </button>
                    </div>
                </div>
                <p v-else class="ncg-hint">
                    <template v-if="inLobby">
                        Pick an empty gate to enter a horse. The race starts once every horse in the gates says ready. Nobody around? Add bots and race them solo.
                    </template>
                    <template v-else>
                        A race is on. Grab a gate as soon as it finishes.
                    </template>
                </p>
            </section>

            <aside class="ncg-side">
                <!-- bet slip -->
                <section class="ncg-card">
                    <div class="ncg-card-head">
                        <h2>The bet slip</h2>
                        <span class="ncg-muted">{{ state?.watching ?? 0 }} watching</span>
                    </div>
                    <ul v-if="slip.length" class="ncg-slip">
                        <li v-for="row in slip" :key="row.seat" :class="{ 'is-me': row.isMe, 'is-bot': row.bot }" :style="{ '--lane': row.color }">
                            <span class="ncg-slip-dot">{{ row.seat + 1 }}</span>
                            <div class="ncg-slip-who">
                                <span class="ncg-slip-horse">{{ row.horse }}</span>
                                <span class="ncg-muted">
                                    {{ row.player }}
                                    <template v-if="row.races"> · won {{ row.wins }}/{{ row.races }} ({{ Math.round(row.wins / row.races * 100) }}%)</template>
                                    <template v-else-if="!row.bot"> · first race</template>
                                </span>
                            </div>
                            <div class="ncg-slip-money">
                                <strong>{{ formatNumber(row.plays) }}</strong>
                                <span v-if="row.bet > row.plays" class="ncg-muted" :title="`Bet ${formatNumber(row.bet, false)}, but only the smallest bet in the gates plays`">
                                    of {{ formatNumber(row.bet) }}
                                </span>
                                <span v-else-if="row.sessionNet" class="ncg-slip-net" :class="row.sessionNet > 0 ? 'is-up' : 'is-down'">
                                    {{ row.sessionNet > 0 ? '+' : '−' }}{{ formatNumber(Math.abs(row.sessionNet)) }}
                                </span>
                            </div>
                            <span class="ncg-slip-chance">{{ Math.round(chance * 100) }}%</span>
                        </li>
                    </ul>
                    <p v-else class="ncg-muted">
                        No bets yet. Take a gate and place one.
                    </p>
                    <dl class="ncg-slip-total">
                        <div>
                            <dt>Pot</dt>
                            <dd>{{ formatNumber(pot) }}</dd>
                        </div>
                        <div v-if="bots.length">
                            <dt>House fee</dt>
                            <dd>{{ Math.round(fee * 100) }}%</dd>
                        </div>
                        <div class="is-win">
                            <dt>Winner gets</dt>
                            <dd>{{ formatNumber(winnerGets) }}</dd>
                        </div>
                    </dl>
                </section>

                <!-- winners -->
                <section v-if="game?.history.length" class="ncg-card">
                    <div class="ncg-card-head">
                        <h2>Hall of hooves</h2>
                    </div>
                    <ul class="ncg-history">
                        <li v-for="h in game.history" :key="h.roundId">
                            <span class="ncg-history-horse">{{ h.horseName }}</span>
                            <span class="ncg-muted">{{ h.botWon ? 'house bot' : h.winnerName }} · {{ Math.round(h.odds * 100) }}% shot</span>
                            <span class="ncg-history-pot" :class="{ 'is-house': h.botWon }">{{ h.botWon ? 'house' : `+${formatNumber(h.payout)}` }}</span>
                        </li>
                    </ul>
                </section>
            </aside>
        </div>

        <section class="ncg-card">
            <NeighcassoStable
                ref="stable"
                :selected-id="mySeat?.game.horseId ?? prefs.horseId"
                selectable
                @select="pickHorse"
            />
        </section>

        <NeighcassoSharedHorseModal v-model:open="sharedOpen" :horse-id="sharedId" @adopted="onAdopted" />
    </div>
</template>

<style scoped>
.ncg {
    --paper: #fdf8ec;
    --paper-2: #f6eed8;
    --ink: #2b2a33;
    --ink-soft: #6b6474;
    --line: #c9d7ef;
    --accent: #e4572e;
    --good: #3a8a3a;
    --bad: #c0392b;
    --wobble: 255px 15px 225px 15px / 15px 225px 15px 255px;
    --wobble-2: 15px 225px 15px 255px / 255px 15px 225px 15px;
    font-family: 'Comic Neue', 'Chalkboard SE', 'Comic Sans MS', cursive;
    color: var(--ink);
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.ncg-card,
.ncg-marquee {
    background:
        repeating-linear-gradient(to bottom, transparent 0 27px, var(--line) 27px 28px),
        var(--paper);
    border: 3px solid var(--ink);
    border-radius: var(--wobble);
    box-shadow: 4px 5px 0 rgb(0 0 0 / 0.18);
    padding: 12px 16px;
}

.ncg-card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px 12px;
    margin-bottom: 8px;
}

.ncg-card-head h2 {
    font-size: 1.25rem;
    font-weight: 800;
    transform: rotate(-1deg);
}

.ncg-muted {
    color: var(--ink-soft);
    font-size: 0.8rem;
}

/* marquee */
.ncg-marquee {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas: 'title pot' 'status status';
    align-items: center;
    gap: 6px 12px;
    background:
        radial-gradient(circle at 12% 30%, #ffd16655 0 40px, transparent 41px),
        radial-gradient(circle at 88% 70%, #ef476f33 0 50px, transparent 51px),
        var(--paper);
}

.ncg-title {
    grid-area: title;
    display: flex;
    flex-direction: column;
}

.ncg-title-main {
    font-size: clamp(1.6rem, 5vw, 2.6rem);
    font-weight: 900;
    line-height: 1;
    letter-spacing: 0.02em;
    color: var(--accent);
    text-shadow: 2px 2px 0 var(--ink), -1px -1px 0 #ffd166;
    transform: rotate(-2deg);
    transform-origin: left;
}

.ncg-title-sub {
    font-size: 0.85rem;
    color: var(--ink-soft);
    margin-top: 4px;
}

.ncg-pot {
    grid-area: pot;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 14px;
    border: 3px dashed var(--ink);
    border-radius: var(--wobble-2);
    background: #fff5c2;
    transform: rotate(2deg);
}

.ncg-pot.is-hot {
    animation: ncg-wiggle 1.6s ease-in-out infinite;
}

.ncg-pot-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
}

.ncg-pot-value {
    font-size: 1.6rem;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
}

.ncg-status {
    grid-area: status;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
}

.ncg-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--ink);
}

.ncg-dot.is-on {
    background: #6a994e;
}

.ncg-dot.is-off {
    background: var(--bad);
}

.ncg-track {
    border: 3px solid var(--ink);
    border-radius: var(--wobble-2);
    overflow: hidden;
    box-shadow: 4px 5px 0 rgb(0 0 0 / 0.18);
    background: var(--paper);
}

.ncg-grid {
    display: grid;
    gap: 14px;
    grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 1024px) {
    .ncg-grid {
        grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
    }
}

.ncg-side {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
}

/* gates */
.ncg-gate-grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (min-width: 640px) {
    .ncg-gate-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}

.ncg-gate {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-height: 168px;
    padding: 10px 8px 8px;
    background: #fff;
    border: 3px solid var(--lane);
    border-radius: var(--wobble);
    text-align: center;
    transition: transform 0.15s;
}

.ncg-gate:nth-child(odd) {
    transform: rotate(-0.8deg);
}

.ncg-gate:nth-child(even) {
    transform: rotate(0.7deg);
}

.ncg-gate.is-me {
    box-shadow: 0 0 0 3px #ffd166, 3px 4px 0 rgb(0 0 0 / 0.2);
}

.ncg-gate.is-empty {
    background: var(--paper-2);
    border-style: dashed;
}

.ncg-gate-num {
    position: absolute;
    top: -12px;
    left: -8px;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: 3px solid var(--ink);
    border-radius: 50%;
    background: var(--lane);
    color: #fff;
    font-weight: 900;
    text-shadow: 1px 1px 0 var(--ink);
}

.ncg-gate-horse {
    height: 64px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
}

.ncg-gate-name {
    font-weight: 800;
    line-height: 1.1;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ncg-gate-owner {
    font-size: 0.75rem;
    color: var(--ink-soft);
}

.ncg-gate-bet {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
}

.ncg-odds {
    font-size: 0.75rem;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--lane);
    color: #fff;
}

.ncg-badge {
    margin-top: 2px;
    font-size: 0.7rem;
    font-weight: 900;
    text-transform: uppercase;
    padding: 1px 8px;
    border: 2px solid var(--ink);
    border-radius: 999px;
    background: #b7e4a6;
    transform: rotate(-3deg);
}

.ncg-badge.is-bot {
    background: #cfe3f7;
}

.ncg-badge-btn {
    cursor: pointer;
    background: #ffd166;
}

.ncg-badge-btn.is-remove {
    background: #fff;
    transform: none;
}

.ncg-gate-join.is-bot .ncg-gate-plus {
    font-size: 2rem;
    filter: grayscale(0.6);
    opacity: 0.7;
}

.ncg-gate-join.is-bot:hover .ncg-gate-plus {
    filter: none;
    opacity: 1;
    transform: rotate(-10deg) scale(1.15);
}

.ncg-badge-btn:disabled {
    opacity: 0.5;
    cursor: default;
}

.ncg-gate.is-bot {
    background:
        repeating-linear-gradient(45deg, transparent 0 10px, rgb(0 0 0 / 0.03) 10px 20px),
        #f3f6fa;
    border-style: dotted;
}

.ncg-bots {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}

.ncg-bots-count {
    min-width: 1.2em;
    text-align: center;
    font-size: 1.1rem;
}

.ncg-badge.is-idle {
    background: #eee;
    color: var(--ink-soft);
}

.ncg-gate-join {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-weight: 800;
    color: var(--ink-soft);
    cursor: pointer;
}

.ncg-gate-join:disabled {
    cursor: default;
    opacity: 0.55;
}

.ncg-gate-join:not(:disabled):hover {
    color: var(--lane);
}

.ncg-gate-join:not(:disabled):hover .ncg-gate-plus {
    transform: rotate(90deg) scale(1.1);
}

.ncg-gate-plus {
    font-size: 2.4rem;
    line-height: 1;
    transition: transform 0.2s;
}

/* controls */
.ncg-controls {
    margin-top: 14px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    padding: 10px 12px;
    border: 3px dashed var(--ink);
    border-radius: var(--wobble-2);
    background: #fff9e0;
}

.ncg-controls-horse {
    display: flex;
    flex-direction: column;
    min-width: 140px;
}

.ncg-bet {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}

.ncg-bet-field {
    position: relative;
}

.ncg-bet-field input {
    width: 130px;
    padding: 4px 10px;
    font-weight: 800;
    font-size: 1.05rem;
    background: #fff;
    color: var(--ink);
    border: 2px solid var(--ink);
    border-radius: var(--wobble);
    outline: none;
}

.ncg-bet-field input:focus {
    box-shadow: 0 0 0 3px #ffd166;
}

.ncg-bet-hint {
    position: absolute;
    left: 10px;
    top: 100%;
    font-size: 0.7rem;
    color: var(--ink-soft);
}

.ncg-chip,
.ncg-leave {
    padding: 3px 10px;
    font-weight: 800;
    font-size: 0.85rem;
    border: 2px solid var(--ink);
    border-radius: var(--wobble-2);
    background: #fff;
    color: var(--ink);
    cursor: pointer;
    box-shadow: 2px 2px 0 var(--ink);
}

.ncg-chip:active,
.ncg-leave:active,
.ncg-ready:active {
    transform: translate(2px, 2px);
    box-shadow: none;
}

.ncg-chip:disabled,
.ncg-leave:disabled,
.ncg-ready:disabled {
    opacity: 0.5;
    cursor: default;
}

.ncg-controls-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-left: auto;
}

.ncg-ready {
    padding: 8px 20px;
    font-weight: 900;
    font-size: 1.1rem;
    border: 3px solid var(--ink);
    border-radius: var(--wobble);
    background: #ffd166;
    color: var(--ink);
    cursor: pointer;
    box-shadow: 3px 3px 0 var(--ink);
    transform: rotate(-1.5deg);
}

.ncg-ready:not(:disabled):not(.is-ready) {
    animation: ncg-wiggle 2s ease-in-out infinite;
}

.ncg-ready.is-ready {
    background: #b7e4a6;
}

.ncg-hint {
    margin-top: 12px;
    font-size: 0.9rem;
    color: var(--ink-soft);
}

/* history + slip */
.ncg-history {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.ncg-history li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'horse pot' 'who pot';
    column-gap: 8px;
}

.ncg-history-horse {
    grid-area: horse;
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ncg-history li .ncg-muted {
    grid-area: who;
}

.ncg-history-pot {
    grid-area: pot;
    align-self: center;
    font-weight: 900;
    color: var(--good);
}

.ncg-history-pot.is-house {
    color: var(--ink-soft);
}

.ncg-slip {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.ncg-slip li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    background: #fff;
    border: 2px solid var(--lane);
    border-radius: var(--wobble-2);
}

.ncg-slip li.is-me {
    box-shadow: 0 0 0 2px #ffd166;
}

.ncg-slip li.is-bot {
    background: #f3f6fa;
    border-style: dotted;
}

.ncg-slip-dot {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 2px solid var(--ink);
    background: var(--lane);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 900;
}

.ncg-slip-who {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.15;
}

.ncg-slip-who > * {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ncg-slip-horse {
    font-weight: 800;
}

.ncg-slip-money {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
}

.ncg-slip-net {
    font-size: 0.75rem;
    font-weight: 700;
}

.ncg-slip-net.is-up {
    color: var(--good);
}

.ncg-slip-net.is-down {
    color: var(--bad);
}

.ncg-slip-chance {
    min-width: 3.2em;
    text-align: center;
    font-size: 0.8rem;
    font-weight: 900;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--lane);
    color: #fff;
}

.ncg-slip-total {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 2px dashed var(--ink);
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.ncg-slip-total div {
    display: flex;
    justify-content: space-between;
    font-weight: 700;
}

.ncg-slip-total .is-win {
    font-size: 1.2rem;
    font-weight: 900;
    color: var(--good);
}

@keyframes ncg-wiggle {
    0%, 100% { transform: rotate(-1.5deg); }
    50% { transform: rotate(1.5deg) scale(1.03); }
}

@media (prefers-reduced-motion: reduce) {
    .ncg-pot.is-hot,
    .ncg-ready:not(:disabled):not(.is-ready) {
        animation: none;
    }
}
</style>
