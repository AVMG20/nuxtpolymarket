<script setup lang="ts">
import '~/assets/css/live-table.css'
import { LB_CHIPS, chipRackFor } from '#shared/utils/live-blackjack/chips'
import { betKey, describeBet, getBet, numberAt } from '#shared/utils/roulette/layout'
import type {
    RouletteAction,
    RouletteGameEvent,
    RouletteSeatState,
    RouletteSharedState
} from '#shared/utils/roulette/types'
import { pocketColor, WHEEL_ORDER, type PocketColor } from '#shared/utils/roulette/wheel'
import { chip, chipStack } from '~/utils/live-table/art'
import type { LtFeedItem } from '~/composables/live-table'

// Matches the server's own SPINNING_MS in server/utils/live-table/roulette.ts —
// the animation only plays back the server's result, so it has no way to read
// the constant off the table itself.
const SPIN_ANIMATION_MS = 5000

// ─── felt geometry — a 1600x1120 stage, ported from the approved mockup ────
const NUM_LEFT = 750
const COL_W = 58
const ROW_H = 64
const GRID_TOP = 460
const ZERO_LEFT = 690
const ZERO_WIDTH = 60
const COLBET_LEFT = NUM_LEFT + 12 * COL_W
const COLBET_WIDTH = 90
const DOZENS_TOP = GRID_TOP + ROW_H * 3 + 10
const DOZEN_WIDTH = (COLBET_LEFT - NUM_LEFT) / 3
const OUTSIDE_TOP = DOZENS_TOP + 70
const OUTSIDE_WIDTH = (COLBET_LEFT - NUM_LEFT) / 6
const GRID_BOTTOM = GRID_TOP + ROW_H * 3

function streetNumbers(col: number): number[] {
    return [numberAt(0, col), numberAt(1, col), numberAt(2, col)]
}

interface FeltBox { key: string, x: number, y: number, w: number, h: number, label: string, cls: string }
interface FeltDot { key: string, x: number, y: number }

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
    h: 60,
    label: dozenLabels[i]!,
    cls: 'outside'
})))

const outsideBets = [
    { key: 'low', label: '1 – 18', cls: 'outside' },
    { key: 'even', label: 'EVEN', cls: 'outside' },
    { key: 'red', label: 'RED', cls: 'red' },
    { key: 'black', label: 'BLACK', cls: 'black' },
    { key: 'odd', label: 'ODD', cls: 'outside' },
    { key: 'high', label: '19 – 36', cls: 'outside' }
]
const outsideBoxes = computed<FeltBox[]>(() => outsideBets.map((b, i) => ({
    key: b.key,
    x: NUM_LEFT + i * OUTSIDE_WIDTH,
    y: OUTSIDE_TOP,
    w: OUTSIDE_WIDTH,
    h: 60,
    label: b.label,
    cls: b.cls
})))

// Inside bets too fiddly to click as a full box get a small marker at the
// junction they actually sit on, sized generously since exact casino
// geometry is not the point — placing the bet correctly is.
const splitMarkers = computed<FeltDot[]>(() => {
    const dots: FeltDot[] = []
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 11; col++) {
            const key = `split:${betKey([numberAt(row, col), numberAt(row, col + 1)])}`
            dots.push({ key, x: NUM_LEFT + (col + 1) * COL_W, y: GRID_TOP + row * ROW_H + ROW_H / 2 })
        }
    }
    for (let col = 0; col < 12; col++) {
        for (let row = 0; row < 2; row++) {
            const key = `split:${betKey([numberAt(row, col), numberAt(row + 1, col)])}`
            dots.push({ key, x: NUM_LEFT + col * COL_W + COL_W / 2, y: GRID_TOP + (row + 1) * ROW_H })
        }
    }
    for (let row = 0; row < 3; row++) {
        const key = `split:${betKey([0, numberAt(row, 0)])}`
        dots.push({ key, x: NUM_LEFT, y: GRID_TOP + row * ROW_H + ROW_H / 2 })
    }
    return dots
})

const cornerMarkers = computed<FeltDot[]>(() => {
    const dots: FeltDot[] = []
    for (let col = 0; col < 11; col++) {
        for (let row = 0; row < 2; row++) {
            const numbers = [numberAt(row, col), numberAt(row, col + 1), numberAt(row + 1, col), numberAt(row + 1, col + 1)]
            dots.push({ key: `corner:${betKey(numbers)}`, x: NUM_LEFT + (col + 1) * COL_W, y: GRID_TOP + (row + 1) * ROW_H })
        }
    }
    return dots
})

const streetMarkers = computed<FeltDot[]>(() => Array.from({ length: 12 }, (_, col) => ({
    key: `street:${betKey(streetNumbers(col))}`,
    x: NUM_LEFT + col * COL_W + COL_W / 2,
    y: GRID_BOTTOM
})))

const lineMarkers = computed<FeltDot[]>(() => {
    const dots: FeltDot[] = []
    for (let col = 0; col < 11; col++) {
        const numbers = [...streetNumbers(col), ...streetNumbers(col + 1)]
        dots.push({ key: `line:${betKey(numbers)}`, x: NUM_LEFT + (col + 1) * COL_W, y: GRID_BOTTOM })
    }
    return dots
})

/** Centre point of every bet key on the felt, for both markers and chip piles. */
const spotPositions = computed<Record<string, { x: number, y: number }>>(() => {
    const positions: Record<string, { x: number, y: number }> = {}
    for (const box of [zeroBox, ...numberBoxes.value, ...columnBoxes.value, ...dozenBoxes.value, ...outsideBoxes.value]) {
        positions[box.key] = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    }
    for (const dot of [...splitMarkers.value, ...cornerMarkers.value, ...streetMarkers.value, ...lineMarkers.value]) {
        positions[dot.key] = { x: dot.x, y: dot.y }
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

const wheelRotation = ref(0)
function spinWheelTo(number: number) {
    const idx = WHEEL_ORDER.indexOf(number)
    const step = 360 / WHEEL_ORDER.length
    const targetWithinTurn = (((360 - idx * step) % 360) + 360) % 360
    const currentWithinTurn = ((wheelRotation.value % 360) + 360) % 360
    let delta = targetWithinTurn - currentWithinTurn
    if (delta <= 0) delta += 360
    wheelRotation.value += delta + 360 * 3
}

function onGameEvent(payload: unknown) {
    const event = payload as RouletteGameEvent
    if (event.type === 'bet') {
        const bet = getBet(event.key)
        const label = bet ? describeBet(bet) : event.key
        pushLocalFeed({ kind: 'game', tone: 'neutral', name: event.name, text: `${event.name} bet ${formatNumber(event.amount)} on ${label}` })
    } else if (event.type === 'spin') {
        pushLocalFeed({ kind: 'game', tone: 'neutral', text: `Wheel spun — ${event.number} ${event.color}` })
        spinWheelTo(event.number)
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
    }
}

const table = useLiveTable<RouletteSeatState, RouletteSharedState, RouletteAction>('roulette', onGameEvent)
const { state, balance, feed, skew, act } = table

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

const rack = computed(() => chipRackFor(balance.value).map(c => c.value))
const selectedChip = ref(LB_CHIPS[0]!.value)
watch(rack, (values) => {
    if (!values.includes(selectedChip.value)) selectedChip.value = values[values.length - 1] ?? values[0]!
}, { immediate: true })

function placeBet(key: string) {
    if (!isBettingOpen.value) return
    act({ type: 'bet', key, amount: selectedChip.value })
}

interface FeltGroup { key: string, x: number, y: number, total: number, colors: string[], primaryColor: string }

const feltGroups = computed<FeltGroup[]>(() => {
    const byKey = new Map<string, { total: number, colors: string[] }>()
    for (const b of state.value?.game.bets ?? []) {
        const existing = byKey.get(b.key)
        if (existing) {
            existing.total += b.amount
            if (!existing.colors.includes(b.color)) existing.colors.push(b.color)
        } else {
            byKey.set(b.key, { total: b.amount, colors: [b.color] })
        }
    }
    return [...byKey.entries()].map(([key, v]) => {
        const pos = spotPositions.value[key]
        return { key, x: pos?.x ?? 0, y: pos?.y ?? 0, total: v.total, colors: v.colors, primaryColor: v.colors[0]! }
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

const wheelSize = 380
const wheelSvg = computed(() => buildWheelSvg(wheelSize))

function buildWheelSvg(size: number): string {
    const r = size / 2
    const rimWidth = 12
    const outerR = r - rimWidth
    const innerR = outerR - 44
    const hubR = innerR - 6
    const n = WHEEL_ORDER.length
    const step = 360 / n
    let pockets = ''
    let labels = ''
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
        pockets += `<path d="M ${x0o.toFixed(2)},${y0o.toFixed(2)} A ${outerR} ${outerR} 0 0 1 ${x1o.toFixed(2)},${y1o.toFixed(2)} L ${x1i.toFixed(2)},${y1i.toFixed(2)} A ${innerR} ${innerR} 0 0 0 ${x0i.toFixed(2)},${y0i.toFixed(2)} Z" fill="${color}" stroke="rgba(217,177,103,.45)" stroke-width="1"/>`
        const mid = (a0 + a1) / 2
        const labelR = (outerR + innerR) / 2
        const lx = Math.cos(mid) * labelR
        const ly = Math.sin(mid) * labelR
        const deg = mid * 180 / Math.PI + 90
        labels += `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" transform="rotate(${deg.toFixed(2)} ${lx.toFixed(2)} ${ly.toFixed(2)})" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="800" fill="#f7f3e8" font-family="system-ui,sans-serif">${num}</text>`
    })
    return `<svg width="${size}" height="${size}" viewBox="${-r} ${-r} ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`
        + `<circle cx="0" cy="0" r="${r}" fill="#1c1109"/>`
        + `<circle cx="0" cy="0" r="${r - rimWidth / 2}" fill="none" stroke="#d9b167" stroke-width="${rimWidth}"/>`
        + pockets + labels
        + `<circle cx="0" cy="0" r="${hubR}" fill="#8b8e94" stroke="#d9b167" stroke-width="3"/>`
        + `<circle cx="0" cy="0" r="${(hubR * 0.35).toFixed(2)}" fill="#3a3c40" stroke="#d9b167" stroke-width="2"/>`
        + '</svg>'
}
</script>

<template>
    <div class="rl-wrap">
        <div class="rl-main">
            <LiveTableStage>
                <div class="lt-rules" style="top:88px">
                    SINGLE ZERO &middot; {{ Number(state?.watching ?? 0) }} WATCHING
                </div>

                <div class="lt-phase" style="top:170px">
                    <span class="label">{{ phaseLabel }}</span>
                    <span v-if="secondsLeft !== null" class="count" :class="{ urgent: secondsLeft <= 5 }">{{ secondsLeft }}</span>
                </div>

                <div class="rl-history">
                    <span class="rl-history-label">LAST</span>
                    <span v-for="(n, i) in lastNumbers.slice(0, 12)" :key="i" class="rl-pill" :class="pocketLabel(n)">{{ n }}</span>
                    <span v-if="!lastNumbers.length" class="rl-history-empty">No spins yet</span>
                </div>

                <div class="rl-wheel-wrap">
                    <div class="rl-wheel-spin" :style="{ transform: `rotate(${wheelRotation}deg)` }" v-html="wheelSvg" />
                    <div class="rl-wheel-pointer" />
                </div>

                <!-- betting layout -->
                <div
                    class="rl-layout"
                    :class="{ closed: !isBettingOpen }"
                    :style="{ left: `${ZERO_LEFT - 4}px`, top: `${GRID_TOP - 4}px`, width: `${COLBET_LEFT + COLBET_WIDTH - ZERO_LEFT + 8}px`, height: `${OUTSIDE_TOP + 60 - GRID_TOP + 8}px` }"
                />

                <div
                    class="rl-cell zero"
                    :style="{ left: `${zeroBox.x}px`, top: `${zeroBox.y}px`, width: `${zeroBox.w}px`, height: `${zeroBox.h}px`, fontSize: '26px' }"
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
                    :style="{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, fontSize: '15px' }"
                    @click="placeBet(box.key)"
                >
                    {{ box.label }}
                </div>

                <div
                    v-for="box in outsideBoxes"
                    :key="box.key"
                    class="rl-cell"
                    :class="box.cls"
                    :style="{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, fontSize: '15px' }"
                    @click="placeBet(box.key)"
                >
                    {{ box.label }}
                </div>

                <div
                    v-for="dot in splitMarkers"
                    :key="dot.key"
                    class="rl-dot split"
                    :style="{ left: `${dot.x}px`, top: `${dot.y}px` }"
                    :title="`Split ${dot.key.split(':')[1]}`"
                    @click="placeBet(dot.key)"
                />
                <div
                    v-for="dot in cornerMarkers"
                    :key="dot.key"
                    class="rl-dot corner"
                    :style="{ left: `${dot.x}px`, top: `${dot.y}px` }"
                    :title="`Corner ${dot.key.split(':')[1]}`"
                    @click="placeBet(dot.key)"
                />
                <div
                    v-for="dot in streetMarkers"
                    :key="dot.key"
                    class="rl-dot street"
                    :style="{ left: `${dot.x}px`, top: `${dot.y}px` }"
                    :title="`Street ${dot.key.split(':')[1]}`"
                    @click="placeBet(dot.key)"
                />
                <div
                    v-for="dot in lineMarkers"
                    :key="dot.key"
                    class="rl-dot line"
                    :style="{ left: `${dot.x}px`, top: `${dot.y}px` }"
                    :title="`Line ${dot.key.split(':')[1]}`"
                    @click="placeBet(dot.key)"
                />

                <!-- chips: rendered after the layout so they always sit on top of it -->
                <div
                    v-for="group in feltGroups"
                    :key="group.key"
                    class="rl-spot-chip"
                    :style="{ left: `${group.x}px`, top: `${group.y}px` }"
                >
                    <div
                        class="rl-chip-ring"
                        :style="{ boxShadow: group.colors.map(c => `0 0 0 3px ${c}`).join(', ') }"
                        v-html="chipStack(group.total, { size: 44 })"
                    />
                    <span v-if="group.colors.length > 1" class="rl-badge-count" :style="{ background: group.primaryColor }">
                        &times;{{ group.colors.length }}
                    </span>
                </div>

                <div class="lt-overlay rl-legend" style="left:60px;top:920px;width:420px">
                    <h4>Chip colours</h4>
                    <div class="rl-legend-rows">
                        <span v-for="p in legend" :key="p.name" class="rl-legend-row">
                            <span class="rl-legend-dot" :style="{ background: p.color }" />
                            {{ p.name }}
                        </span>
                        <span v-if="!legend.length" class="rl-legend-empty">No bets yet this round</span>
                    </div>
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
    height: min(780px, calc(100vh - 300px));
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
    font-size: 18px;
    cursor: pointer;
    user-select: none;
    z-index: 2;
}
.rl-cell:hover { filter: brightness(1.25); }
.rl-cell.red { background: rgba(176, 32, 46, 0.88); }
.rl-cell.black { background: rgba(15, 18, 24, 0.88); }
.rl-cell.green { background: rgba(13, 99, 54, 0.88); }
.rl-cell.outside { background: rgba(217, 177, 103, 0.12); font-size: 14px; }
.rl-cell.zero { border-radius: 10px 0 0 10px; }

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

.rl-dot {
    position: absolute;
    width: 18px;
    height: 18px;
    margin: -9px 0 0 -9px;
    border-radius: 999px;
    background: rgba(247, 243, 232, 0.18);
    border: 1.5px solid rgba(217, 177, 103, 0.55);
    cursor: pointer;
    z-index: 3;
}
.rl-dot:hover { background: rgba(247, 243, 232, 0.55); }

.lt-rules {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
}

.rl-history {
    position: absolute;
    left: 60px;
    top: 130px;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(11, 8, 6, 0.6);
    border: 1.5px solid rgba(217, 177, 103, 0.3);
    border-radius: 999px;
    padding: 6px 14px;
    max-width: 560px;
    overflow: hidden;
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

.rl-wheel-wrap {
    position: absolute;
    left: 60px;
    top: 280px;
    width: v-bind('wheelSize + "px"');
    height: v-bind('wheelSize + "px"');
}
.rl-wheel-spin {
    width: 100%;
    height: 100%;
    transition: transform v-bind('SPIN_ANIMATION_MS / 1000 + "s"') cubic-bezier(0.11, 0.75, 0.2, 1);
}
.rl-wheel-pointer {
    position: absolute;
    left: 50%;
    top: -4px;
    width: 0;
    height: 0;
    transform: translateX(-50%);
    border-left: 9px solid transparent;
    border-right: 9px solid transparent;
    border-top: 16px solid var(--lt-gold);
}

.rl-spot-chip {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 6;
}
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
</style>
