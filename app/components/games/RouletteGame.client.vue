<script setup lang="ts">
import '~/assets/css/live-table.css'
import { LB_CHIPS, chipRackFor } from '#shared/utils/live-blackjack/chips'
import { describeBet, getBet, numberAt } from '#shared/utils/roulette/layout'
import type {
    RouletteAction,
    RouletteGameEvent,
    RouletteSeatState,
    RouletteSharedState
} from '#shared/utils/roulette/types'
import { pocketColor, WHEEL_ORDER, type PocketColor } from '#shared/utils/roulette/wheel'
import { chip, chipStack } from '~/utils/live-table/art'
import { wheelRotationFor } from '~/utils/roulette/wheel-spin'
import type { LtFeedItem } from '~/composables/live-table'

// Matches the server's own SPINNING_MS in server/utils/live-table/roulette.ts —
// the animation only plays back the server's result, so it has no way to read
// the constant off the table itself.
const SPIN_ANIMATION_MS = 5000

// ─── felt geometry — a 1720x1200 stage ─────────────────────────────────────
// Classic layout: wheel and betting layout side by side, centred on the same
// horizontal axis. Outside bets run along the top of the number grid, dozens
// along the bottom, 0 full-height on the left, 2-to-1 columns full-height on
// the right. Raised 80px off the old centre (620) so the block clears the felt
// with room to spare below it — the bet bar, rack and side panels now live
// under the felt rather than sharing it, per the shared control band.
const CENTER_Y = 540

const COL_W = 60
const ROW_H = 92
const ZERO_WIDTH = 66
const COLBET_WIDTH = 94
const GRID_WIDTH = 12 * COL_W
const OUTSIDE_HEIGHT = 82
const DOZEN_HEIGHT = 82
const BETTING_HEIGHT = OUTSIDE_HEIGHT + 3 * ROW_H + DOZEN_HEIGHT
const BETTING_WIDTH = ZERO_WIDTH + GRID_WIDTH + COLBET_WIDTH

// Shrunk from 620 (and 520 before that) — a smaller outer size next to the
// same 80px number band leaves the digits a bigger share of the wheel, on
// top of the bigger font below.
const WHEEL_SIZE = 460
const WHEEL_GAP = 60
const CONTENT_WIDTH = WHEEL_SIZE + WHEEL_GAP + BETTING_WIDTH
const WHEEL_LEFT = (1720 - CONTENT_WIDTH) / 2
const WHEEL_TOP = CENTER_Y - WHEEL_SIZE / 2

const ZERO_LEFT = WHEEL_LEFT + WHEEL_SIZE + WHEEL_GAP
const NUM_LEFT = ZERO_LEFT + ZERO_WIDTH
const COLBET_LEFT = NUM_LEFT + GRID_WIDTH
const BETTING_LEFT = ZERO_LEFT

const BETTING_TOP = CENTER_Y - BETTING_HEIGHT / 2
const OUTSIDE_TOP = BETTING_TOP
const GRID_TOP = OUTSIDE_TOP + OUTSIDE_HEIGHT
const DOZENS_TOP = GRID_TOP + 3 * ROW_H
const OUTSIDE_WIDTH = GRID_WIDTH / 6
const DOZEN_WIDTH = GRID_WIDTH / 3

// The phase banner and chip legend stack directly above the betting area
// (feedback: "NO MORE BETS" used to float independently of it), narrower than
// the wheel+betting block so they read as belonging to the layout below them.
const LEGEND_TOP = BETTING_TOP - 76
const PHASE_TOP = LEGEND_TOP - 62

interface FeltBox { key: string, x: number, y: number, w: number, h: number, label?: string, diamond?: string, cls: string }

const zeroBox: FeltBox = { key: 'straight:0', x: ZERO_LEFT, y: GRID_TOP, w: ZERO_WIDTH, h: ROW_H * 3, label: '0', cls: 'green zero' }

const numberBoxes = computed<FeltBox[]>(() => {
    const boxes: FeltBox[] = []
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 12; col++) {
            const n = numberAt(row, col)
            boxes.push({
                key: `straight:${n}`,
                x: NUM_LEFT + col * COL_W,
                y: GRID_TOP + row * ROW_H,
                w: COL_W,
                h: ROW_H,
                label: String(n),
                cls: pocketColor(n)
            })
        }
    }
    return boxes
})

const columnBoxes = computed<FeltBox[]>(() => Array.from({ length: 3 }, (_, row) => ({
    key: `column:${row}`,
    x: COLBET_LEFT,
    y: GRID_TOP + row * ROW_H,
    w: COLBET_WIDTH,
    h: ROW_H,
    label: '2:1',
    cls: 'outside'
})))

const dozenLabels = ['1st 12', '2nd 12', '3rd 12']
const dozenBoxes = computed<FeltBox[]>(() => Array.from({ length: 3 }, (_, i) => ({
    key: `dozen:${i}`,
    x: NUM_LEFT + i * DOZEN_WIDTH,
    y: DOZENS_TOP,
    w: DOZEN_WIDTH,
    h: DOZEN_HEIGHT,
    label: dozenLabels[i]!,
    cls: 'outside'
})))

// Red and black are diamonds on the real felt, not the words — the colour
// alone reads faster and matches the reference layout.
const outsideBets: { key: string, label?: string, diamond?: string }[] = [
    { key: 'low', label: '1 – 18' },
    { key: 'even', label: 'EVEN' },
    { key: 'red', diamond: '#c02434' },
    { key: 'black', diamond: '#14181f' },
    { key: 'odd', label: 'ODD' },
    { key: 'high', label: '19 – 36' }
]
const outsideBoxes = computed<FeltBox[]>(() => outsideBets.map((b, i) => ({
    key: b.key,
    x: NUM_LEFT + i * OUTSIDE_WIDTH,
    y: OUTSIDE_TOP,
    w: OUTSIDE_WIDTH,
    h: OUTSIDE_HEIGHT,
    label: b.label,
    diamond: b.diamond,
    cls: 'outside'
})))

/** Centre point of every bet key on the felt, for both cells and chip piles. */
const spotPositions = computed<Record<string, { x: number, y: number }>>(() => {
    const positions: Record<string, { x: number, y: number }> = {}
    for (const box of [zeroBox, ...numberBoxes.value, ...columnBoxes.value, ...dozenBoxes.value, ...outsideBoxes.value]) {
        positions[box.key] = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    }
    return positions
})

// ─── table state ────────────────────────────────────────────────────────────

const localFeed = ref<LtFeedItem[]>([])
let feedSeq = 0
function pushLocalFeed(item: Omit<LtFeedItem, 'id'>) {
    localFeed.value.push({ ...item, id: ++feedSeq })
    if (localFeed.value.length > 40) localFeed.value.splice(0, localFeed.value.length - 40)
}

// The wheel and the ball are two independently animated layers: the wheel
// turns one way, the ball the other, and both are timed to stop with the
// winning pocket under the fixed pointer at the same moment. Pure playback —
// the number is already decided by the time either animation starts.
const wheelRotation = ref(0)
const ballRotation = ref(0)

function spinTo(number: number) {
    wheelRotation.value = wheelRotationFor(wheelRotation.value, number)

    // The ball always settles at the fixed pointer (angle 0) — exactly where
    // the wheel's own rotation is bringing the winning pocket's centre to —
    // but spins backward and faster, the way a ball runs against the wheel's
    // spin.
    const ballWithinTurn = ((ballRotation.value % 360) + 360) % 360
    ballRotation.value -= ballWithinTurn + 360 * 5
}

const table = useLiveTable<RouletteSeatState, RouletteSharedState, RouletteAction>('roulette', onGameEvent)
const { state, balance, feed, skew, act } = table

const showResult = ref(false)
const resultNumber = ref<number | null>(null)
const resultNet = ref(0)

function onGameEvent(payload: unknown) {
    const event = payload as RouletteGameEvent
    if (event.type === 'bet') {
        const bet = getBet(event.key)
        const label = bet ? describeBet(bet) : event.key
        pushLocalFeed({ kind: 'game', tone: 'neutral', name: event.name, text: `${event.name} bet ${formatNumber(event.amount)} on ${label}` })
    } else if (event.type === 'spin') {
        pushLocalFeed({ kind: 'game', tone: 'neutral', text: `Wheel spun — ${event.number} ${event.color}` })
        spinTo(event.number)
    } else if (event.type === 'result') {
        for (const r of event.results) {
            if (r.net === 0) continue
            pushLocalFeed({
                kind: 'game',
                tone: r.net > 0 ? 'win' : 'loss',
                name: r.name,
                text: `${r.name} ${r.net > 0 ? 'won' : 'lost'} ${formatNumber(Math.abs(r.net))}`
            })
        }
        const mine = event.results.find(r => r.userId === table.youId.value)
        if (mine) {
            resultNumber.value = event.winningNumber
            resultNet.value = mine.net
            showResult.value = true
        }
    }
}

// The popup is presentation of the same phase the felt already mutes on —
// closing it when payout ends is a read of server state, not a new timer.
watch(() => state.value?.phase, (phase) => {
    if (phase !== 'payout') showResult.value = false
})

// The base's generic 'settled' event names a seat, and roulette has none —
// it always reads back "Player". The table's own 'result' game event above
// carries the real name, so the generic line is dropped rather than shown wrong.
let lastFeedId = 0
watch(feed, (list) => {
    for (const item of list) {
        if (item.id <= lastFeedId) continue
        lastFeedId = item.id
        if (item.kind !== 'settled') pushLocalFeed(item)
    }
}, { deep: true })

const isBettingOpen = computed(() => state.value?.phase === 'betting' || state.value?.phase === 'idle')
const hasOwnBet = computed(() => (state.value?.game.bets ?? []).some(b => b.userId === table.youId.value))

const yourTotal = computed(() => (state.value?.game.bets ?? [])
    .filter(b => b.userId === table.youId.value)
    .reduce((sum, b) => sum + b.amount, 0))

const rack = computed(() => chipRackFor(balance.value).map(c => c.value))
const selectedChip = ref(LB_CHIPS[0]!.value)
watch(rack, (values) => {
    if (!values.includes(selectedChip.value)) selectedChip.value = values[values.length - 1] ?? values[0]!
}, { immediate: true })

function placeBet(key: string) {
    if (!isBettingOpen.value) return
    act({ type: 'bet', key, amount: selectedChip.value })
}

function repeatBet() {
    if (!isBettingOpen.value) return
    act({ type: 'repeat' })
}

function scaleBet(factor: number) {
    if (!isBettingOpen.value || (factor !== 0.5 && factor !== 2)) return
    act({ type: 'scale', factor })
}

function undoBet() {
    if (!isBettingOpen.value || !hasOwnBet.value) return
    act({ type: 'undo' })
}

function clearBets() {
    if (!isBettingOpen.value || !hasOwnBet.value) return
    act({ type: 'clear' })
}

// Roulette is seatless, so `state.seats` is always empty and votedStart never
// reaches the client that way — the table's own gameState carries it instead.
const votes = computed(() => state.value?.game.votes ?? [])
const votesTotal = computed(() => state.value?.game.votesTotal ?? 0)
const hasVoted = computed(() => votes.value.some(v => v.userId === table.youId.value))
const canVoteStart = computed(() => state.value?.phase === 'betting' && hasOwnBet.value && !hasVoted.value)

function voteStart() {
    if (!canVoteStart.value) return
    table.voteStart()
}

interface ChipRing { color: string, spread: number }
interface FeltGroup { key: string, x: number, y: number, total: number, rings: ChipRing[] }

const feltGroups = computed<FeltGroup[]>(() => {
    const byKey = new Map<string, { total: number, contributors: Map<string, string> }>()
    for (const b of state.value?.game.bets ?? []) {
        const existing = byKey.get(b.key)
        if (existing) {
            existing.total += b.amount
            existing.contributors.set(b.userId, b.color)
        } else {
            byKey.set(b.key, { total: b.amount, contributors: new Map([[b.userId, b.color]]) })
        }
    }
    const you = table.youId.value
    return [...byKey.entries()].map(([key, v]) => {
        const pos = spotPositions.value[key]
        // The local player's ring always renders innermost (smallest spread,
        // painted on top), so betting a spot someone else already has never
        // hides your own colour.
        const ids = [...v.contributors.keys()].sort((a, b) => (a === you ? -1 : b === you ? 1 : 0))
        const rings = ids.map((id, i) => ({ color: v.contributors.get(id)!, spread: 3 + i * 3 }))
        return { key, x: pos?.x ?? 0, y: pos?.y ?? 0, total: v.total, rings }
    })
})

const legend = computed(() => {
    const seen = new Map<string, string>()
    for (const b of state.value?.game.bets ?? []) seen.set(b.name, b.color)
    return [...seen.entries()].map(([name, color]) => ({ name, color }))
})

const lastNumbers = computed(() => state.value?.game.lastNumbers ?? [])

// ─── phase countdown ────────────────────────────────────────────────────────

const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => { clockTimer = setInterval(() => { now.value = Date.now() }, 250) })
onBeforeUnmount(() => { if (clockTimer) clearInterval(clockTimer) })

const secondsLeft = computed(() => {
    const endsAt = state.value?.phaseEndsAt
    if (!endsAt) return null
    return Math.max(0, Math.ceil((endsAt - (now.value + skew.value)) / 1000))
})

const phaseLabel = computed(() => {
    switch (state.value?.phase) {
        case 'betting': return 'PLACE YOUR BETS'
        case 'nomorebets': return 'NO MORE BETS'
        case 'spinning': return 'SPINNING'
        case 'payout': return 'WINNERS PAID'
        default: return 'WAITING FOR PLAYERS'
    }
})

function pocketLabel(n: number): PocketColor {
    return pocketColor(n)
}

const wheelSvg = computed(() => buildWheelSvg(WHEEL_SIZE))

function buildWheelSvg(size: number): string {
    const r = size / 2
    const rimWidth = 12
    const outerR = r - rimWidth
    // Kept at the old wheel's absolute width while the wheel itself shrank
    // around it, so the number band is a bigger share of a smaller wheel.
    const innerR = outerR - 80
    const hubR = innerR - 8
    const n = WHEEL_ORDER.length
    const step = 360 / n
    let pockets = ''
    let labels = ''
    let spokes = ''
    WHEEL_ORDER.forEach((num, i) => {
        const a0 = (i * step - 90) * Math.PI / 180
        const a1 = ((i + 1) * step - 90) * Math.PI / 180
        const color = pocketColor(num) === 'red' ? '#c02434' : pocketColor(num) === 'black' ? '#14181f' : '#0f6e3c'
        const x0o = Math.cos(a0) * outerR
        const y0o = Math.sin(a0) * outerR
        const x1o = Math.cos(a1) * outerR
        const y1o = Math.sin(a1) * outerR
        const x0i = Math.cos(a0) * innerR
        const y0i = Math.sin(a0) * innerR
        const x1i = Math.cos(a1) * innerR
        const y1i = Math.sin(a1) * innerR
        pockets += `<path d="M ${x0o.toFixed(2)},${y0o.toFixed(2)} A ${outerR} ${outerR} 0 0 1 ${x1o.toFixed(2)},${y1o.toFixed(2)} L ${x1i.toFixed(2)},${y1i.toFixed(2)} A ${innerR} ${innerR} 0 0 0 ${x0i.toFixed(2)},${y0i.toFixed(2)} Z" fill="${color}" stroke="rgba(217,177,103,.5)" stroke-width="1.5"/>`
        const mid = (a0 + a1) / 2
        const labelR = (outerR + innerR) / 2
        const lx = Math.cos(mid) * labelR
        const ly = Math.sin(mid) * labelR
        const deg = mid * 180 / Math.PI + 90
        labels += `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" transform="rotate(${deg.toFixed(2)} ${lx.toFixed(2)} ${ly.toFixed(2)})" text-anchor="middle" dominant-baseline="central" font-size="20" font-weight="800" fill="#f7f3e8" font-family="system-ui,sans-serif">${num}</text>`
    })
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        spokes += `<line x1="0" y1="0" x2="${(Math.cos(a) * hubR * 0.92).toFixed(2)}" y2="${(Math.sin(a) * hubR * 0.92).toFixed(2)}" stroke="#5b5f66" stroke-width="5" stroke-linecap="round"/>`
    }
    return `<svg width="${size}" height="${size}" viewBox="${-r} ${-r} ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`
        + `<defs><radialGradient id="rlHub" cx="35%" cy="32%" r="75%">`
        + `<stop offset="0%" stop-color="#d7dade"/><stop offset="55%" stop-color="#8b8e94"/><stop offset="100%" stop-color="#4d4f54"/>`
        + `</radialGradient></defs>`
        + `<circle cx="0" cy="0" r="${r}" fill="#1c1109"/>`
        + `<circle cx="0" cy="0" r="${r - rimWidth / 2}" fill="none" stroke="#d9b167" stroke-width="${rimWidth}"/>`
        + pockets + labels
        + `<circle cx="0" cy="0" r="${hubR}" fill="url(#rlHub)" stroke="#d9b167" stroke-width="3"/>`
        + spokes
        + `<circle cx="0" cy="0" r="${(hubR * 0.32).toFixed(2)}" fill="#3a3c40" stroke="#d9b167" stroke-width="2"/>`
        + '</svg>'
}
</script>

<template>
    <div class="rl-wrap">
        <div class="rl-main">
            <LiveTableStage>
                <div class="lt-rules" style="top:52px">
                    SINGLE ZERO EUROPEAN WHEEL
                </div>

                <!-- top centre of the table, not tied to the wheel's column -->
                <div class="rl-history" style="left:50%;top:96px;transform:translateX(-50%)">
                    <span class="rl-history-label">LAST</span>
                    <span v-for="(n, i) in lastNumbers.slice(0, 10)" :key="i" class="rl-pill" :class="pocketLabel(n)">{{ n }}</span>
                    <span v-if="!lastNumbers.length" class="rl-history-empty">No spins yet</span>
                </div>

                <!-- directly above the betting area, not floating over the whole table -->
                <div
                    class="lt-phase"
                    :style="{ left: `${BETTING_LEFT + BETTING_WIDTH / 2}px`, top: `${PHASE_TOP}px` }"
                >
                    <span class="label">{{ phaseLabel }}</span>
                    <span v-if="secondsLeft !== null" class="count" :class="{ urgent: secondsLeft <= 5 }">{{ secondsLeft }}</span>
                </div>

                <!-- legend sits above the betting area, sized to match it -->
                <div
                    class="lt-overlay rl-legend"
                    :style="{ left: `${BETTING_LEFT}px`, top: `${LEGEND_TOP}px`, width: `${BETTING_WIDTH}px` }"
                >
                    <h4>Chip colours</h4>
                    <div class="rl-legend-rows">
                        <span v-for="p in legend" :key="p.name" class="rl-legend-row">
                            <span class="rl-legend-dot" :style="{ background: p.color }" />
                            {{ p.name }}
                        </span>
                        <span v-if="!legend.length" class="rl-legend-empty">No bets yet this round</span>
                    </div>
                </div>

                <div
                    class="rl-wheel-wrap"
                    :style="{ left: `${WHEEL_LEFT}px`, top: `${WHEEL_TOP}px`, width: `${WHEEL_SIZE}px`, height: `${WHEEL_SIZE}px` }"
                >
                    <div
                        class="rl-wheel-spin"
                        :style="{ transform: `rotate(${wheelRotation}deg)`, transitionDuration: `${SPIN_ANIMATION_MS}ms` }"
                        v-html="wheelSvg"
                    />
                    <div
                        class="rl-ball-orbit"
                        :style="{ transform: `rotate(${ballRotation}deg)`, transitionDuration: `${SPIN_ANIMATION_MS}ms` }"
                    >
                        <div class="rl-ball" />
                    </div>
                    <div class="rl-wheel-pointer" />
                </div>

                <!-- betting layout backdrop -->
                <div
                    class="rl-layout"
                    :class="{ closed: !isBettingOpen }"
                    :style="{ left: `${ZERO_LEFT - 4}px`, top: `${OUTSIDE_TOP - 4}px`, width: `${BETTING_WIDTH + 8}px`, height: `${BETTING_HEIGHT + 8}px` }"
                />

                <div
                    v-for="box in outsideBoxes"
                    :key="box.key"
                    class="rl-cell outside"
                    :style="{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, fontSize: '17px' }"
                    @click="placeBet(box.key)"
                >
                    <span v-if="box.diamond" class="rl-diamond" :style="{ background: box.diamond }" />
                    <template v-else>{{ box.label }}</template>
                </div>

                <div
                    class="rl-cell zero"
                    :style="{ left: `${zeroBox.x}px`, top: `${zeroBox.y}px`, width: `${zeroBox.w}px`, height: `${zeroBox.h}px`, fontSize: '30px' }"
                    @click="placeBet(zeroBox.key)"
                >
                    {{ zeroBox.label }}
                </div>

                <div
                    v-for="box in numberBoxes"
                    :key="box.key"
                    class="rl-cell"
                    :class="box.cls"
                    :style="{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }"
                    @click="placeBet(box.key)"
                >
                    {{ box.label }}
                </div>

                <div
                    v-for="box in columnBoxes"
                    :key="box.key"
                    class="rl-cell outside"
                    :style="{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }"
                    @click="placeBet(box.key)"
                >
                    {{ box.label }}
                </div>

                <div
                    v-for="box in dozenBoxes"
                    :key="box.key"
                    class="rl-cell outside"
                    :style="{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, fontSize: '16px' }"
                    @click="placeBet(box.key)"
                >
                    {{ box.label }}
                </div>

                <!-- chips: rendered after the layout so they always sit on top of it,
                     with pointer-events off so a second click reaches the cell below
                     and raises the bet instead of hitting the chip pile. -->
                <div
                    v-for="group in feltGroups"
                    :key="group.key"
                    class="rl-spot-chip"
                    :class="{ muted: !isBettingOpen }"
                    :style="{ left: `${group.x}px`, top: `${group.y}px` }"
                >
                    <div
                        class="rl-chip-ring"
                        :style="{ boxShadow: group.rings.map(r => `0 0 0 ${r.spread}px ${r.color}`).join(', ') }"
                        v-html="chipStack(group.total, { size: 44 })"
                    />
                    <span v-if="group.rings.length > 1" class="rl-badge-count" :style="{ background: group.rings[0]!.color }">
                        &times;{{ group.rings.length }}
                    </span>
                </div>

                <LiveTableBetBar
                    :can-repeat="isBettingOpen"
                    :can-scale="isBettingOpen"
                    :can-undo="isBettingOpen && hasOwnBet"
                    :can-clear="isBettingOpen && hasOwnBet"
                    @repeat="repeatBet"
                    @scale="scaleBet"
                    @undo="undoBet"
                    @clear="clearBets"
                />

                <div class="lt-panel lt-panel-l">
                    <span class="lt-panel-label">Your bets this round</span>
                    <span class="lt-panel-value">{{ formatNumber(yourTotal) }}</span>
                </div>

                <div class="lt-panel lt-panel-r rl-panel-start">
                    <span class="lt-panel-label">{{ Number(state?.watching ?? 0) }} watching</span>
                    <button
                        class="lb-tile lb-tile-green rl-vote-btn"
                        :disabled="!canVoteStart"
                        :title="votes.length ? `Voted: ${votes.map(v => v.name).join(', ')}` : ''"
                        @click="voteStart"
                    >
                        <template v-if="hasVoted">VOTED</template>
                        <template v-else>START EARLY</template>
                        <span v-if="votesTotal > 1" class="rl-vote-count">({{ votes.length }}/{{ votesTotal }})</span>
                    </button>
                </div>

                <div class="lt-rack">
                    <span
                        v-for="value in rack"
                        :key="value"
                        :class="{ sel: value === selectedChip }"
                        v-html="chip(value)"
                        @click="selectedChip = value"
                    />
                </div>
            </LiveTableStage>
        </div>

        <div class="rl-rail">
            <LiveTableFeed :items="localFeed" title="Table feed" />
            <LiveTableScoreboard :entries="state?.scoreboard ?? []" :you-id="table.youId.value" />
        </div>

        <UModal v-model:open="showResult" title="Round result">
            <template #body>
                <div class="rl-result">
                    <div class="rl-result-label">Winning number</div>
                    <div class="rl-result-pill" :class="resultNumber !== null ? pocketLabel(resultNumber) : ''">
                        {{ resultNumber }}
                    </div>
                    <div
                        class="rl-result-net"
                        :class="resultNet > 0 ? 'text-success' : resultNet < 0 ? 'text-error' : 'text-muted'"
                    >
                        <template v-if="resultNet > 0">You won {{ formatNumber(resultNet) }}</template>
                        <template v-else-if="resultNet < 0">You lost {{ formatNumber(Math.abs(resultNet)) }}</template>
                        <template v-else>You broke even</template>
                    </div>
                </div>
            </template>
        </UModal>
    </div>
</template>

<style scoped>
.rl-wrap {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 16px;
    align-items: start;
}
.rl-main { min-width: 0; }
.rl-rail {
    display: flex;
    flex-direction: column;
    gap: 12px;
    /* Matches .lt-stage-wrap's own sizing so the rail grows with the felt
       rather than leaving it looking small next to a taller table. */
    height: min(1100px, calc(100vh - 84px));
}
.rl-rail > :first-child { flex: 2; min-height: 0; }
.rl-rail > :last-child { flex: 1; min-height: 0; }

@media (max-width: 1100px) {
    .rl-wrap { grid-template-columns: 1fr; }
    .rl-rail { height: 360px; flex-direction: row; }
}

.rl-cell {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, sans-serif;
    font-weight: 800;
    letter-spacing: 0.03em;
    color: #f7f3e8;
    border: 1px solid rgba(217, 177, 103, 0.35);
    box-sizing: border-box;
    font-size: 21px;
    cursor: pointer;
    user-select: none;
    z-index: 2;
}
.rl-cell:hover { filter: brightness(1.25); }
.rl-cell.red { background: rgba(176, 32, 46, 0.88); }
.rl-cell.black { background: rgba(15, 18, 24, 0.88); }
.rl-cell.green { background: rgba(13, 99, 54, 0.88); }
.rl-cell.outside { background: rgba(217, 177, 103, 0.14); font-size: 15px; }
.rl-cell.zero { border-radius: 10px 0 0 10px; }

.rl-diamond {
    width: 22px;
    height: 22px;
    transform: rotate(45deg);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.35);
    border-radius: 3px;
}

.rl-layout {
    position: absolute;
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.18);
    box-shadow: inset 0 0 0 1.5px rgba(217, 177, 103, 0.3);
    z-index: 1;
    pointer-events: none;
    transition: opacity 0.2s;
}
.rl-layout.closed { opacity: 0.55; }

.lt-rules {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
}

.rl-history {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(11, 8, 6, 0.6);
    border: 1.5px solid rgba(217, 177, 103, 0.3);
    border-radius: 999px;
    padding: 6px 14px;
    overflow: hidden;
    box-sizing: border-box;
}
.rl-history-label { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; color: var(--lt-gold); margin-right: 4px; }
.rl-history-empty { font-size: 12px; color: #9a8f7a; }

.rl-pill {
    width: 26px;
    height: 26px;
    border-radius: 999px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 800;
    color: #f7f3e8;
    box-shadow: inset 0 0 0 1.5px rgba(0, 0, 0, 0.35);
}
.rl-pill.red { background: #c02434; }
.rl-pill.black { background: #14181f; }
.rl-pill.green { background: #0f6e3c; }

.rl-wheel-wrap { position: absolute; }
.rl-wheel-spin {
    width: 100%;
    height: 100%;
    transition-property: transform;
    transition-timing-function: cubic-bezier(0.1, 0.74, 0.2, 1);
}
.rl-ball-orbit {
    position: absolute;
    inset: 0;
    transition-property: transform;
    transition-timing-function: cubic-bezier(0.14, 0.8, 0.22, 1);
}
.rl-ball {
    position: absolute;
    left: 50%;
    top: 24px;
    width: 16px;
    height: 16px;
    margin-left: -8px;
    border-radius: 999px;
    background: radial-gradient(circle at 35% 30%, #ffffff, #d6d6d6 60%, #8c8c8c 100%);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.65);
}
/* The pointer must never share the rim's gold, or the landing spot vanishes
   into it — a dark outline behind a white triangle reads against both the
   gold rim and the dark rail. */
.rl-wheel-pointer {
    position: absolute;
    left: 50%;
    top: -8px;
    width: 0;
    height: 0;
    transform: translateX(-50%);
    z-index: 5;
}
.rl-wheel-pointer::before {
    content: '';
    position: absolute;
    left: -12px;
    top: 0;
    border-left: 12px solid transparent;
    border-right: 12px solid transparent;
    border-top: 22px solid #0b0806;
}
.rl-wheel-pointer::after {
    content: '';
    position: absolute;
    left: -8px;
    top: 3px;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-top: 15px solid #ffffff;
}

.rl-spot-chip {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 6;
    pointer-events: none;
    transition: filter 0.3s, opacity 0.3s;
}
.rl-spot-chip.muted { filter: grayscale(0.75) brightness(0.55); opacity: 0.65; }
.rl-chip-ring { position: relative; border-radius: 999px; }
.rl-badge-count {
    position: absolute;
    top: -6px;
    right: -6px;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    border-radius: 999px;
    color: #1c1109;
    font-size: 11px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 0 2px #1c1109;
    z-index: 50;
}

.rl-legend h4 {
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ui-warning);
    border-bottom: 1px solid var(--ui-border);
    padding-bottom: 6px;
    margin-bottom: 8px;
}
.rl-legend-rows { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.rl-legend-row { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: #f7f3e8; white-space: nowrap; }
.rl-legend-dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
.rl-legend-empty { font-size: 12px; color: #9a8f7a; }

.rl-panel-start { align-items: stretch; }
.rl-vote-btn { width: 100%; box-sizing: border-box; text-align: center; }
.rl-vote-count { display: block; font-size: 0.7rem; font-weight: 700; opacity: 0.85; margin-top: 2px; }

.rl-result { text-align: center; padding: 0.5rem 0 1rem; }
.rl-result-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ui-text-muted); margin-bottom: 0.75rem; }
.rl-result-pill {
    width: 64px;
    height: 64px;
    margin: 0 auto;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    font-weight: 800;
    color: #f7f3e8;
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.25);
}
.rl-result-pill.red { background: #c02434; }
.rl-result-pill.black { background: #14181f; }
.rl-result-pill.green { background: #0f6e3c; }
.rl-result-net { margin-top: 1rem; font-size: 1.25rem; font-weight: 800; }
</style>
