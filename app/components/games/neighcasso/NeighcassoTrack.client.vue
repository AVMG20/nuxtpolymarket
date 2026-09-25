<script setup lang="ts">
import { NC_LANES } from '#shared/utils/neighcasso/types'
import type { NcDrawing, NcRaceEvent, NcRaceEventKind, NcRaceLane, NcRaceScript, NcResult } from '#shared/utils/neighcasso/types'
import { DEFAULT_HORSE, drawHorse, gaitRate, ncHash, prepareHorse, type NcPose, type PreparedHorse } from '~/utils/neighcasso/render'

/**
 * The race stage. Plays back the server's scripted race on a canvas: parallax
 * doodle scenery, a camera that follows the pack, gates and countdown,
 * photo finish, confetti. Everything is derived from `race` and the clock, so
 * a client that mounts mid-race lands on the right frame.
 */

interface TrackHorse {
    seat: number
    horseName: string
    playerName: string
    drawing: NcDrawing | null
    color: string
    isMe: boolean
}

const props = defineProps<{
    race: NcRaceScript | null
    horses: TrackHorse[]
    phase: string
    result: NcResult | null
    /** serverNow - Date.now() */
    skew: number
}>()

const FONT = '\'Comic Neue\', \'Chalkboard SE\', \'Comic Sans MS\', cursive'
const PAPER = '#fbf5e6'
const INK = '#2f2a24'
const CROWD = ['#e8590c', '#1c7ed6', '#2f9e44', '#f08c00', '#ae3ec9', '#e03131', '#0ca678', '#5c7cfa', '#d6336c']

// Photo finish: the last second of the race plays at 0.55x, then the frame
// holds for a beat before the post-race trot.
const SLOW_FROM = 1
const SLOW_REAL = 1.8
const HOLD = 0.75

const wrap = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const cssHeight = ref(0)

interface OrderRow { seat: number, name: string, color: string, isMe: boolean }
const order = ref<OrderRow[]>([])
const ticker = ref<{ id: string, text: string } | null>(null)
const banner = ref<string | null>(null)

const activeRace = computed(() => {
    if (!props.race) return null
    return props.phase === 'gates' || props.phase === 'racing' || props.phase === 'finish' ? props.race : null
})

// ---------------------------------------------------------------------------
// Drawings
// ---------------------------------------------------------------------------

const prepared = new WeakMap<NcDrawing, PreparedHorse>()
const fallback = prepareHorse(DEFAULT_HORSE)
function horseFor(drawing: NcDrawing | null | undefined): PreparedHorse {
    if (!drawing) return fallback
    let horse = prepared.get(drawing)
    if (!horse) {
        try {
            horse = prepareHorse(drawing)
        } catch {
            horse = fallback
        }
        prepared.set(drawing, horse)
    }
    return horse
}

function horseBySeat(seat: number) {
    return props.horses.find(h => h.seat === seat)
}
function nameOf(seat: number) {
    return horseBySeat(seat)?.horseName || `Horse #${seat + 1}`
}
function winnerName(race: NcRaceScript) {
    return props.result?.horseName || nameOf(props.result?.winnerSeat ?? race.winnerSeat)
}

// ---------------------------------------------------------------------------
// Script playback
// ---------------------------------------------------------------------------

function displayTime(t: number, d: number) {
    const a = d - SLOW_FROM
    if (t < a) return t
    if (t < a + SLOW_REAL) return a + (t - a) * (SLOW_FROM / SLOW_REAL)
    if (t < a + SLOW_REAL + HOLD) return d
    return d + (t - (a + SLOW_REAL + HOLD))
}

function interp(frames: number[], step: number, t: number) {
    const n = frames.length - 1
    if (t <= 0) return frames[0] ?? 0
    const u = t / step
    const i = Math.min(n, Math.floor(u))
    if (i >= n) return frames[n]!
    const f = u - i
    const p0 = frames[Math.max(0, i - 1)]!
    const p1 = frames[i]!
    const p2 = frames[i + 1]!
    const p3 = frames[Math.min(n, i + 2)]!
    const f2 = f * f
    const v = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f2 * f)
    // Clamp between the neighbouring keyframes: no overshoot, so nobody but
    // the winner ever touches 1.
    return Math.min(Math.max(p1, p2), Math.max(Math.min(p1, p2), v))
}

function easeOut(v: number) {
    const k = Math.min(1, Math.max(0, v))
    return 1 - (1 - k) * (1 - k)
}

function lanePos(race: NcRaceScript, lane: NcRaceLane, t: number) {
    const frames = lane.frames
    const end = (frames.length - 1) * race.step
    if (t <= end) return interp(frames, race.step, t)
    // Cosmetic trot after the post, starting at roughly race pace.
    const last = frames[frames.length - 1] ?? 0
    const target = lane.seat === race.winnerSeat ? 1.035 : 1.05 + ncHash(lane.seat, 5) * 0.05
    const span = Math.max(1.2, 2 * (target - last) * race.duration)
    return last + (target - last) * easeOut((t - end) / span)
}

function activeEvent(race: NcRaceScript, seat: number, t: number): NcRaceEvent | null {
    for (const e of race.events) {
        if (e.seat === seat && t >= e.at && t < e.at + e.duration) return e
    }
    return null
}

// ---------------------------------------------------------------------------
// Commentary
// ---------------------------------------------------------------------------

type Line = { at: number, text: string, key: string }
let lines: Line[] = []

const LEAD_LINES = [
    (n: string) => `${n} takes the lead!`,
    (n: string) => `${n} noses in front!`,
    (n: string) => `It's ${n} out in front now!`,
    (n: string) => `${n} surges to the front!`,
    (n: string) => `Would you look at ${n} go!`,
    (n: string) => `${n} grabs the lead with both hooves!`
]
const EVENT_LINES: Record<NcRaceEventKind, ((n: string) => string)[]> = {
    zoomies: [
        n => `${n} has entered ZOOMIES MODE`,
        n => `${n} just remembered it left the oven on!`,
        n => `Somebody gave ${n} an espresso!`
    ],
    nap: [
        n => `${n}... a nap?! In THIS economy?`,
        n => `${n} has fallen asleep mid-race!`,
        n => `Shh! ${n} is having a little lie-down.`
    ],
    stumble: [
        n => `${n} trips over absolutely nothing!`,
        n => `Whoopsie daisy from ${n}!`,
        n => `${n} faceplants! Still majestic.`
    ],
    moonwalk: [
        n => `${n} is MOONWALKING. Backwards. On purpose?`,
        n => `${n} busts out the moonwalk!`
    ],
    spin: [
        n => `${n} does a full 360! For the fans!`,
        n => `${n} spins! The judges love it!`
    ]
}

function buildLines(race: NcRaceScript) {
    const out: Line[] = []
    const salt = race.startsAt % 100_000
    const pick = <T,>(list: T[], i: number) => list[Math.floor(ncHash(salt, i) * list.length)]!
    out.push({ at: -999, text: 'The doodles are in the gates...', key: 'gates' })
    out.push({ at: 0, text: 'AND THEY\'RE OFF!', key: 'off' })

    const lanes = race.lanes
    const frames = lanes[0]?.frames.length ?? 0
    let leader = -1
    for (let i = Math.round(1.5 / race.step); i < frames; i++) {
        let best = lanes[0]!
        for (const lane of lanes) if (lane.frames[i]! > best.frames[i]!) best = lane
        let margin = Infinity
        for (const lane of lanes) if (lane !== best) margin = Math.min(margin, best.frames[i]! - lane.frames[i]!)
        if (best.seat !== leader && margin > 0.004) {
            leader = best.seat
            const at = i * race.step
            if (at < race.duration - 0.5) {
                out.push({ at, text: pick(LEAD_LINES, i)(nameOf(best.seat)), key: `lead-${i}` })
            }
        }
    }

    race.events.forEach((e, i) => {
        out.push({ at: e.at, text: pick(EVENT_LINES[e.kind], i + 50)(nameOf(e.seat)), key: `ev-${i}` })
    })
    out.push({ at: race.duration - 3.2, text: 'Down the home stretch they come!', key: 'stretch' })
    out.push({ at: race.duration, text: '', key: 'win' })
    out.push({ at: race.duration + 3.5, text: 'What a race. Truly a masterpiece.', key: 'post' })
    out.sort((a, b) => a.at - b.at)

    // Lead calls give way to anything else that happens close by.
    lines = out.filter((line, i) => {
        if (!line.key.startsWith('lead')) return true
        return !out.some((o, j) => j !== i && Math.abs(o.at - line.at) < 1.3 && (!o.key.startsWith('lead') || j < i))
    })
}

function updateTicker(race: NcRaceScript | null, tv: number) {
    let next: { id: string, text: string }
    if (!race) {
        next = { id: `lobby-${props.phase}`, text: props.horses.length ? 'Horses prancing in the paddock...' : 'Waiting for doodles to enter the paddock...' }
    } else {
        let line: Line | null = null
        for (const l of lines) {
            if (l.at <= tv) line = l
            else break
        }
        if (!line) return
        const text = line.key === 'win' ? `${winnerName(race)} WINS IT!!` : line.text
        next = { id: `${race.startsAt}-${line.key}`, text }
    }
    if (ticker.value?.id !== next.id || ticker.value.text !== next.text) ticker.value = next
}

watch(() => [props.race, props.horses], () => {
    if (props.race) buildLines(props.race)
}, { immediate: true, deep: false })

// ---------------------------------------------------------------------------
// Runtime state (not reactive)
// ---------------------------------------------------------------------------

interface Runner { stride: number, gait: number, dust: number }
const runners = new Map<number, Runner>()
function runner(seat: number) {
    let r = runners.get(seat)
    if (!r) {
        r = { stride: ncHash(seat, 3), gait: 0, dust: 0 }
        runners.set(seat, r)
    }
    return r
}

interface Dust { x: number, y: number, vx: number, vy: number, r: number, life: number, max: number }
interface Confetti { x: number, y: number, vx: number, vy: number, rot: number, vr: number, color: string, life: number, w: number }
let dust: Dust[] = []
let confetti: Confetti[] = []

let raf = 0
let last = 0
let clock = 0
let anim = 0
let lastTv = Number.NaN
let cam = 0
let camReady = false
let raceKey: NcRaceScript | null = null
let flashAt = -1
let wonAt = -1
let orderKey = ''
let W = 0
let H = 0
let dpr = 1
let observer: ResizeObserver | null = null

function resetRace(race: NcRaceScript | null) {
    raceKey = race
    lastTv = Number.NaN
    camReady = false
    flashAt = -1
    wonAt = -1
    dust = []
    confetti = []
    banner.value = null
    orderKey = ''
    order.value = []
    if (race) buildLines(race)
}

function resize() {
    const el = wrap.value
    const c = canvas.value
    if (!el || !c) return
    W = el.clientWidth
    H = Math.round(W < 640 ? W * 0.62 : (W * 7) / 16)
    cssHeight.value = H
    dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    c.width = Math.round(W * dpr)
    c.height = Math.round(H * dpr)
}

// ---------------------------------------------------------------------------
// Scenery
// ---------------------------------------------------------------------------

function scribbleLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, seed: number, amp: number) {
    const boil = Math.floor(anim * 4)
    const mx = (x1 + x2) / 2 + (ncHash(seed, boil, 1) - 0.5) * amp
    const my = (y1 + y2) / 2 + (ncHash(seed, boil, 2) - 0.5) * amp
    ctx.moveTo(x1, y1)
    ctx.quadraticCurveTo(mx, my, x2, y2)
}

function drawPaper(ctx: CanvasRenderingContext2D, u: number) {
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(80, 140, 220, 0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    const gap = Math.max(14, 20 * u)
    for (let y = gap; y < H; y += gap) {
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(W, Math.round(y) + 0.5)
    }
    ctx.stroke()
    ctx.strokeStyle = 'rgba(220, 80, 80, 0.25)'
    ctx.beginPath()
    ctx.moveTo(Math.round(28 * u) + 0.5, 0)
    ctx.lineTo(Math.round(28 * u) + 0.5, H)
    ctx.stroke()
}

function drawSun(ctx: CanvasRenderingContext2D, u: number) {
    const x = W - 46 * u
    const y = 34 * u
    const r = 16 * u
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(anim * 0.3)
    ctx.strokeStyle = '#f08c00'
    ctx.lineWidth = 2 * u
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2
        ctx.moveTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3)
        ctx.lineTo(Math.cos(a) * r * (1.65 + (i % 2) * 0.25), Math.sin(a) * r * (1.65 + (i % 2) * 0.25))
    }
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = '#ffd43b'
    ctx.strokeStyle = '#f08c00'
    ctx.lineWidth = 2 * u
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    // Sunglasses and a smirk.
    ctx.fillStyle = INK
    ctx.fillRect(x - r * 0.7, y - r * 0.35, r * 0.6, r * 0.3)
    ctx.fillRect(x + r * 0.1, y - r * 0.35, r * 0.6, r * 0.3)
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.5 * u
    ctx.beginPath()
    ctx.moveTo(x - r * 0.1, y - r * 0.25)
    ctx.lineTo(x + r * 0.1, y - r * 0.25)
    ctx.moveTo(x - r * 0.4, y + r * 0.3)
    ctx.quadraticCurveTo(x, y + r * 0.65, x + r * 0.45, y + r * 0.25)
    ctx.stroke()
}

function drawClouds(ctx: CanvasRenderingContext2D, u: number) {
    const par = 0.08
    const sp = 220 * u
    const off = cam * par - anim * 6 * u
    const first = Math.floor(off / sp) - 1
    ctx.lineWidth = 1.8 * u
    ctx.strokeStyle = 'rgba(60, 60, 80, 0.55)'
    ctx.fillStyle = '#ffffff'
    for (let k = first; k * sp - off < W + sp; k++) {
        const x = k * sp - off + ncHash(k, 11) * sp * 0.5
        const y = H * (0.07 + ncHash(k, 12) * 0.1)
        const s = (0.7 + ncHash(k, 13) * 0.6) * u
        ctx.beginPath()
        ctx.arc(x, y, 12 * s, Math.PI * 0.5, Math.PI * 1.5)
        ctx.arc(x + 14 * s, y - 8 * s, 13 * s, Math.PI, Math.PI * 1.9)
        ctx.arc(x + 32 * s, y - 4 * s, 11 * s, Math.PI * 1.2, Math.PI * 0.1)
        ctx.arc(x + 40 * s, y + 3 * s, 9 * s, Math.PI * 1.5, Math.PI * 0.5)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
    }
}

function drawHills(ctx: CanvasRenderingContext2D, horizon: number, par: number, amp: number, fill: string, line: string, seed: number, u: number) {
    const off = cam * par
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W + 16; x += 16) {
        const wx = (x + off) / u
        const y = horizon - (Math.sin(wx * 0.006 + seed) * 0.5 + 0.5) * amp - Math.sin(wx * 0.017 + seed * 3) * amp * 0.25
        ctx.lineTo(x, y)
    }
    ctx.lineTo(W + 16, H)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = line
    ctx.lineWidth = 2 * u
    ctx.stroke()
}

function drawCrowd(ctx: CanvasRenderingContext2D, top: number, bottom: number, u: number, excite: number) {
    const par = 0.55
    const sp = 13 * u
    const off = cam * par
    // Stands
    ctx.fillStyle = '#f1e3c8'
    ctx.fillRect(0, top, W, bottom - top)
    ctx.strokeStyle = 'rgba(47, 42, 36, 0.35)'
    ctx.lineWidth = 1.2 * u
    ctx.beginPath()
    const rowH = (bottom - top) / 2
    for (let r = 0; r <= 2; r++) {
        ctx.moveTo(0, top + r * rowH)
        ctx.lineTo(W, top + r * rowH)
    }
    ctx.stroke()

    ctx.lineCap = 'round'
    for (let row = 0; row < 2; row++) {
        const shift = row * sp * 0.5
        const first = Math.floor((off - shift) / sp) - 1
        for (let k = first; k * sp + shift - off < W + sp; k++) {
            if (ncHash(k, row, 21) < 0.12) continue
            const x = k * sp + shift - off
            const baseY = top + (row + 1) * rowH - 1.5 * u
            const hop = Math.max(0, Math.sin(anim * (5 + ncHash(k, row, 22) * 4) + k)) * (1 + excite * 3) * u
            const y = baseY - hop
            const color = CROWD[Math.floor(ncHash(k, row, 23) * CROWD.length)]!
            const hr = 3.2 * u
            // Body
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(x, y, 5 * u, Math.PI, 0)
            ctx.fill()
            // Arms up when excited
            if (excite > 0.3 && ncHash(k, row, 24) < 0.5 + excite * 0.3) {
                ctx.strokeStyle = color
                ctx.lineWidth = 1.5 * u
                ctx.beginPath()
                const wave = Math.sin(anim * 10 + k) * 2 * u
                ctx.moveTo(x - 4 * u, y - 3 * u)
                ctx.lineTo(x - 6 * u + wave, y - 10 * u)
                ctx.moveTo(x + 4 * u, y - 3 * u)
                ctx.lineTo(x + 6 * u - wave, y - 10 * u)
                ctx.stroke()
            }
            // Head
            ctx.fillStyle = '#fff4e0'
            ctx.strokeStyle = INK
            ctx.lineWidth = 1.1 * u
            ctx.beginPath()
            ctx.arc(x, y - 7.5 * u, hr, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = INK
            ctx.fillRect(x - 1.4 * u, y - 8.3 * u, 0.9 * u, 0.9 * u)
            ctx.fillRect(x + 0.6 * u, y - 8.3 * u, 0.9 * u, 0.9 * u)
            // A few signs
            if (ncHash(k, row, 25) < 0.05) {
                const signs = ['GO!', 'NEIGH', '$$$', 'WOW', 'art!']
                const text = signs[Math.floor(ncHash(k, row, 26) * signs.length)]!
                ctx.font = `bold ${Math.max(7, 6 * u)}px ${FONT}`
                const tw = ctx.measureText(text).width + 4 * u
                ctx.fillStyle = '#ffffff'
                ctx.fillRect(x - tw / 2, y - 22 * u, tw, 9 * u)
                ctx.strokeRect(x - tw / 2, y - 22 * u, tw, 9 * u)
                ctx.fillStyle = color
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.fillText(text, x, y - 17.5 * u)
            }
        }
    }
}

function drawFence(ctx: CanvasRenderingContext2D, y: number, u: number) {
    const sp = 46 * u
    const first = Math.floor(cam / sp) - 1
    ctx.strokeStyle = INK
    ctx.lineCap = 'round'
    ctx.lineWidth = 2 * u
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    scribbleLine(ctx, 0, y - 9 * u, W, y - 9 * u, 1, 3 * u)
    scribbleLine(ctx, 0, y - 3 * u, W, y - 3 * u, 2, 3 * u)
    ctx.stroke()
    ctx.beginPath()
    for (let k = first; k * sp - cam < W + sp; k++) {
        const x = k * sp - cam
        scribbleLine(ctx, x, y - 14 * u, x + (ncHash(k, 31) - 0.5) * 2 * u, y, k + 100, 2 * u)
    }
    ctx.stroke()
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

interface Drawn {
    seat: number
    lane: number
    info: TrackHorse | undefined
    horse: PreparedHorse
    p: number
    x: number
    y: number
    hh: number
    halfW: number
    pose: NcPose
    poseT: number
    poseDur: number
    gait: number
    hop: number
    stride: number
}

function frame(now: number) {
    raf = requestAnimationFrame(frame)
    const c = canvas.value
    const ctx = c?.getContext('2d')
    if (!c || !ctx || W <= 0 || H <= 0) return

    const dtReal = last ? Math.min(0.1, (now - last) / 1000) : 0
    last = now
    clock += dtReal

    const race = activeRace.value
    if (race !== raceKey) resetRace(race)

    const d = race?.duration ?? 0
    const t = race ? (Date.now() + props.skew - race.startsAt) / 1000 : 0
    const tv = race ? displayTime(t, d) : 0
    const slowmo = !!race && t >= d - SLOW_FROM && t < d - SLOW_FROM + SLOW_REAL
    const frozen = !!race && tv === d && t < d - SLOW_FROM + SLOW_REAL + HOLD && t >= d - SLOW_FROM + SLOW_REAL
    const dtv = race ? (Number.isNaN(lastTv) ? 0 : Math.max(0, Math.min(0.1, tv - lastTv))) : dtReal
    lastTv = tv
    const dt = frozen ? 0 : slowmo ? dtReal * (SLOW_FROM / SLOW_REAL) : dtReal
    anim += dt

    const u = H / 300
    const trackTop = H * 0.44
    const trackBot = H * 0.985
    const laneH = (trackBot - trackTop) / NC_LANES
    const L = Math.max(W * 3.5, 1400)
    const X = (p: number) => p * L
    const stall = laneH * 3.3

    // --- Runners -------------------------------------------------------------
    const drawn: Drawn[] = []
    const seats = race ? race.lanes.map(l => l.seat) : props.horses.map(h => h.seat)
    for (const seat of seats) {
        const info = horseBySeat(seat)
        const horse = horseFor(info?.drawing)
        const lane = ((seat % NC_LANES) + NC_LANES) % NC_LANES
        const r = runner(seat)
        const maxW = laneH * 3.2
        const hh = Math.min(laneH * 1.55, (maxW * horse.h) / horse.w)
        const halfW = (horse.w * (hh / horse.h)) / 2
        let p = 0
        let gaitTarget = 0
        let pose: NcPose = 'idle'
        let poseT = 0
        let poseDur = 1
        let hop = 0
        let noseX: number
        const laneData = race?.lanes.find(l => l.seat === seat)
        if (race && laneData) {
            p = lanePos(race, laneData, tv)
            if (tv > 0) {
                const v = (lanePos(race, laneData, tv + 0.08) - lanePos(race, laneData, Math.max(0, tv - 0.08))) / (tv >= 0.08 ? 0.16 : tv + 0.08)
                gaitTarget = Math.min(3, Math.abs(v) * d)
            } else {
                // Impatient in the gates.
                const burst = Math.sin(clock * 1.3 + seat * 1.7) > 0.3
                hop = burst ? Math.abs(Math.sin(clock * 9 + seat)) * laneH * 0.3 : 0
            }
            const ev = activeEvent(race, seat, tv)
            if (ev) {
                pose = ev.kind
                poseT = tv - ev.at
                poseDur = ev.duration
                if (ev.kind === 'nap') gaitTarget = 0
            } else if (seat === race.winnerSeat && tv >= d) {
                pose = 'win'
            }
            noseX = X(p)
        } else {
            // Paddock behind the gates.
            p = 0
            gaitTarget = Math.max(0, Math.sin(clock * 0.6 + seat * 1.3)) * 0.45
            noseX = X(0) - stall - 6 * u - (lane % 2) * laneH * 1.2 + Math.sin(clock * 0.4 + seat) * 8 * u
            if (Math.sin(clock * 0.9 + seat * 2.1) > 0.85) hop = Math.abs(Math.sin(clock * 8 + seat)) * laneH * 0.25
        }
        r.gait += (gaitTarget - r.gait) * (1 - Math.exp(-(race ? dtv : dtReal) * 8))
        r.stride += (race ? dtv : dtReal) * gaitRate(r.gait)

        drawn.push({
            seat,
            lane,
            info,
            horse,
            p,
            x: noseX - halfW,
            y: trackTop + (lane + 0.82) * laneH,
            hh,
            halfW,
            pose,
            poseT,
            poseDur,
            gait: r.gait,
            hop,
            stride: r.stride
        })
    }

    // --- Camera ----------------------------------------------------------------
    let camTarget = X(0) - W * 0.45
    if (race && tv > 0 && drawn.length) {
        const ps = drawn.map(h => h.p)
        const lead = Math.max(...ps)
        const mean = ps.reduce((a, b) => a + b, 0) / ps.length
        if (tv >= d) {
            camTarget = X(1) - W * 0.62
        } else {
            camTarget = X((lead + mean) / 2) - W * 0.5
            camTarget = Math.max(camTarget, X(lead) - W * 0.8)
        }
    }
    camTarget = Math.max(camTarget, X(0) - W * 0.45)
    if (!camReady) {
        cam = camTarget
        camReady = true
    } else {
        cam += (camTarget - cam) * (1 - Math.exp(-Math.max(dt, dtReal * 0.2) * 3))
    }

    // --- Particles ---------------------------------------------------------------
    if (dt > 0) {
        for (const h of drawn) {
            const r = runner(h.seat)
            if (h.gait > 0.35 && h.pose !== 'nap') {
                r.dust += dt * h.gait * 14
                while (r.dust >= 1 && dust.length < 500) {
                    r.dust -= 1
                    const life = 0.45 + Math.random() * 0.45
                    dust.push({
                        x: h.x - h.halfW * 0.75 + (Math.random() - 0.5) * h.halfW * 0.3,
                        y: h.y - Math.random() * 3 * u,
                        vx: -(15 + Math.random() * 45) * u,
                        vy: -(4 + Math.random() * 14) * u,
                        r: (2 + Math.random() * 3) * u * (0.7 + h.gait * 0.3),
                        life,
                        max: life
                    })
                }
                r.dust = Math.min(r.dust, 1)
            }
        }
        for (const p of dust) {
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.vx *= 1 - dt * 2
            p.vy += 12 * u * dt
            p.life -= dt
        }
        dust = dust.filter(p => p.life > 0)
        for (const p of confetti) {
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.vy += 180 * u * dt
            p.vx *= 1 - dt * 0.8
            p.rot += p.vr * dt
            p.life -= dt
        }
        confetti = confetti.filter(p => p.life > 0 && p.y < H + 20)
    }

    // --- Finish moments ----------------------------------------------------------
    if (race && tv >= d && flashAt < 0) {
        flashAt = clock
    }
    if (race && tv >= d && !frozen && wonAt < 0) {
        wonAt = clock
        // Late joiners long after the finish skip the burst.
        if (t - d < 8) burstConfetti(u, 180)
        banner.value = winnerName(race)
    }
    if (race && wonAt >= 0 && clock - wonAt < 4 && dt > 0 && Math.random() < dt * 30) burstConfetti(u, 3)
    if (race && banner.value && banner.value !== winnerName(race)) banner.value = winnerName(race)

    // --- Scene ---------------------------------------------------------------------
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawPaper(ctx, u)
    drawSun(ctx, u)
    drawClouds(ctx, u)
    drawHills(ctx, H * 0.31, 0.12, H * 0.08, '#e3f0cf', 'rgba(90, 130, 70, 0.6)', 1.3, u)
    drawHills(ctx, H * 0.33, 0.25, H * 0.06, '#c6e2a4', 'rgba(70, 110, 50, 0.8)', 4.1, u)
    const excite = race ? (tv < 0 ? 0.3 : tv < d ? 0.6 + Math.min(0.4, tv / d) : 1) : 0.1
    drawCrowd(ctx, H * 0.315, H * 0.415, u, excite)
    drawFence(ctx, trackTop, u)

    // Track
    ctx.fillStyle = 'rgba(236, 206, 158, 0.9)'
    ctx.fillRect(0, trackTop, W, trackBot - trackTop)
    ctx.strokeStyle = 'rgba(47, 42, 36, 0.3)'
    ctx.lineWidth = 1.5 * u
    ctx.setLineDash([12 * u, 10 * u])
    ctx.lineDashOffset = cam
    ctx.beginPath()
    for (let i = 1; i < NC_LANES; i++) {
        const y = Math.round(trackTop + i * laneH) + 0.5
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = INK
    ctx.lineWidth = 2 * u
    ctx.beginPath()
    scribbleLine(ctx, 0, trackBot, W, trackBot, 7, 2 * u)
    ctx.stroke()

    drawMarkers(ctx, u, trackTop, trackBot, X)
    drawFinish(ctx, u, trackTop, trackBot, X(1) - cam)

    // Dust
    for (const p of dust) {
        const k = p.life / p.max
        const sx = p.x - cam
        if (sx < -20 || sx > W + 20) continue
        ctx.globalAlpha = k * 0.7
        ctx.fillStyle = '#e2c79a'
        ctx.strokeStyle = 'rgba(120, 90, 50, 0.6)'
        ctx.lineWidth = 1 * u
        ctx.beginPath()
        ctx.arc(sx, p.y, p.r * (1.6 - k * 0.6), 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
    }
    ctx.globalAlpha = 1

    // Horses, far lane first.
    drawn.sort((a, b) => a.lane - b.lane)
    const haloW = Math.max(2, 2.5 * u)
    for (const h of drawn) {
        const sx = h.x - cam
        if (sx + h.halfW * 2 < -40 || sx - h.halfW * 2 > W + 40) continue
        if (h.info?.isMe) {
            ctx.fillStyle = 'rgba(255, 212, 59, 0.45)'
            ctx.beginPath()
            ctx.ellipse(sx, h.y, h.halfW * 1.1, laneH * 0.28, 0, 0, Math.PI * 2)
            ctx.fill()
        }
        // Shadow
        ctx.fillStyle = 'rgba(80, 60, 30, 0.18)'
        ctx.beginPath()
        ctx.ellipse(sx, h.y + 1, h.halfW * 0.85 * (1 - Math.min(0.5, h.hop / laneH)), laneH * 0.14, 0, 0, Math.PI * 2)
        ctx.fill()
        drawHorse(ctx, h.horse, {
            x: sx,
            y: h.y - h.hop,
            height: h.hh,
            time: anim + h.seat * 0.37,
            gait: h.gait,
            stride: h.stride,
            pose: h.pose,
            poseT: h.poseT,
            poseDur: h.poseDur,
            halo: '#fffaf0',
            haloWidth: haloW,
            seed: h.seat * 131
        })
    }

    drawGates(ctx, u, trackTop, laneH, X(0) - cam, stall, race ? tv : -1)

    // Labels on top of everything on the track.
    const labelSize = Math.max(9, Math.min(14, 9 * u))
    for (const h of drawn) {
        const sx = h.x - cam
        const name = h.info?.horseName || `Horse #${h.seat + 1}`
        const color = h.info?.color || '#868e96'
        if (sx + h.halfW < 0 || sx - h.halfW > W) {
            offscreenTag(ctx, sx < 0 ? 'left' : 'right', h.y - h.hh * 0.5, name, color, labelSize, !!h.info?.isMe)
            continue
        }
        label(ctx, sx, h.y - h.hh - h.hop - 4 * u, name, laneH >= 20 ? h.info?.playerName ?? '' : '', color, labelSize, !!h.info?.isMe)
    }

    // Confetti
    for (const p of confetti) {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.w * 0.3, p.w, p.w * 0.6)
        ctx.restore()
    }

    if (race) drawCountdown(ctx, t)

    // Photo finish flash and frame
    if (race && flashAt >= 0) {
        const k = clock - flashAt
        if (k < 0.6) {
            ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * (1 - k / 0.6)})`
            ctx.fillRect(0, 0, W, H)
        }
        if (frozen || k < HOLD + 0.2) {
            photoFrame(ctx, u)
        }
    }

    // HTML overlays
    updateTicker(race, tv)
    if (race) updateOrder(race, drawn, tv >= d)
}

function burstConfetti(u: number, count: number) {
    for (let i = 0; i < count; i++) {
        confetti.push({
            x: Math.random() * W,
            y: -10 - Math.random() * H * 0.3,
            vx: (Math.random() - 0.5) * 120 * u,
            vy: Math.random() * 60 * u,
            rot: Math.random() * Math.PI,
            vr: (Math.random() - 0.5) * 12,
            color: CROWD[Math.floor(Math.random() * CROWD.length)]!,
            life: 3 + Math.random() * 2,
            w: (4 + Math.random() * 4) * u
        })
    }
    if (confetti.length > 600) confetti.splice(0, confetti.length - 600)
}

function drawMarkers(ctx: CanvasRenderingContext2D, u: number, top: number, bottom: number, X: (p: number) => number) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let i = 1; i < 10; i++) {
        const p = i / 10
        const x = X(p) - cam
        if (x < -40 || x > W + 40) continue
        const big = i % 5 === 0 || i === 7 || i === 9
        // Chalk line across the track
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
        ctx.lineWidth = 2 * u
        ctx.beginPath()
        ctx.moveTo(x, top + 2 * u)
        ctx.lineTo(x, bottom - 2 * u)
        ctx.stroke()
        // Post with a sign
        ctx.strokeStyle = INK
        ctx.lineWidth = 2 * u
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, top - 22 * u)
        ctx.stroke()
        const text = `${Math.round((1 - p) * 1000)}m`
        ctx.font = `bold ${Math.max(8, (big ? 9 : 7) * u)}px ${FONT}`
        const tw = ctx.measureText(text).width + 6 * u
        const sh = (big ? 12 : 10) * u
        ctx.fillStyle = big ? '#ffec99' : '#ffffff'
        ctx.fillRect(x - tw / 2, top - 22 * u - sh, tw, sh)
        ctx.lineWidth = 1.4 * u
        ctx.strokeRect(x - tw / 2, top - 22 * u - sh, tw, sh)
        ctx.fillStyle = INK
        ctx.fillText(text, x, top - 22 * u - sh / 2)
    }
}

function drawFinish(ctx: CanvasRenderingContext2D, u: number, top: number, bottom: number, x: number) {
    if (x < -60 || x > W + 60) return
    const sq = Math.max(4, 6 * u)
    const rows = Math.ceil((bottom - top) / sq)
    for (let r = 0; r < rows; r++) {
        for (let col = 0; col < 2; col++) {
            ctx.fillStyle = (r + col) % 2 ? INK : '#ffffff'
            ctx.fillRect(x + col * sq - sq, top + r * sq, sq, Math.min(sq, bottom - top - r * sq))
        }
    }
    // Posts and banner
    ctx.strokeStyle = INK
    ctx.lineWidth = 2.5 * u
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, top - 52 * u)
    ctx.stroke()
    const wob = Math.sin(anim * 3) * 2 * u
    ctx.fillStyle = '#ff6b6b'
    ctx.beginPath()
    ctx.moveTo(x, top - 52 * u)
    ctx.lineTo(x + 42 * u, top - 48 * u + wob)
    ctx.lineTo(x + 42 * u, top - 32 * u + wob)
    ctx.lineTo(x, top - 36 * u)
    ctx.closePath()
    ctx.fill()
    ctx.lineWidth = 1.5 * u
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${Math.max(8, 8 * u)}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('FINISH', x + 21 * u, top - 42 * u + wob / 2)
}

function drawGates(ctx: CanvasRenderingContext2D, u: number, top: number, laneH: number, x: number, depth: number, tv: number) {
    if (x < -depth - 40 || x - depth > W + 40) return
    const open = tv < 0 ? 0 : Math.min(1, tv * 3)
    ctx.lineCap = 'round'
    for (let i = 0; i < NC_LANES; i++) {
        const y0 = top + i * laneH - laneH * 0.9
        const y1 = top + (i + 1) * laneH
        // Stall frame
        ctx.strokeStyle = '#495057'
        ctx.lineWidth = 2 * u
        ctx.beginPath()
        ctx.moveTo(x - depth, y1)
        ctx.lineTo(x - depth, y0)
        ctx.lineTo(x, y0)
        ctx.lineTo(x, y1)
        ctx.stroke()
        // Door: bars that swing open
        ctx.save()
        ctx.translate(x, y0)
        ctx.rotate(-open * Math.PI * 0.45)
        ctx.strokeStyle = '#e03131'
        ctx.lineWidth = 2.5 * u
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, y1 - y0)
        for (let b = 1; b < 4; b++) {
            const yy = ((y1 - y0) * b) / 4
            ctx.moveTo(0, yy)
            ctx.lineTo(4 * u, yy)
        }
        ctx.stroke()
        ctx.restore()
    }
    // Number boards on top
    ctx.font = `bold ${Math.max(8, 8 * u)}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const y = top - laneH * 0.9 - 5 * u
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.5 * u
    ctx.fillRect(x - depth, y - 6 * u, depth, 11 * u)
    ctx.strokeRect(x - depth, y - 6 * u, depth, 11 * u)
    ctx.fillStyle = INK
    ctx.fillText('START', x - depth / 2, y)
}

function label(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, player: string, color: string, size: number, me: boolean) {
    ctx.font = `bold ${size}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const text = me ? `${name} (you)` : name
    const tw = ctx.measureText(text).width
    let pw = 0
    const small = Math.max(8, size * 0.78)
    if (player) {
        ctx.font = `${small}px ${FONT}`
        pw = ctx.measureText(player).width
    }
    const w = Math.max(tw, pw) + size
    const h = size * 1.35 + (player ? small * 1.1 : 0)
    const top = y - h
    ctx.fillStyle = me ? '#fff3bf' : '#ffffff'
    ctx.strokeStyle = me ? '#f08c00' : color
    ctx.lineWidth = me ? 2.5 : 1.5
    ctx.beginPath()
    ctx.roundRect(x - w / 2, top, w, h, h / 3)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = color
    ctx.fillRect(x - w / 2 + 3, top + 3, 3, h - 6)
    ctx.font = `bold ${size}px ${FONT}`
    ctx.fillStyle = INK
    ctx.fillText(text, x + 2, top + size * 0.72)
    if (player) {
        ctx.font = `${small}px ${FONT}`
        ctx.fillStyle = '#6c6258'
        ctx.fillText(player, x + 2, top + size * 1.35 + small * 0.45)
    }
    if (me) {
        const bob = Math.sin(anim * 6) * 2
        ctx.fillStyle = '#f08c00'
        ctx.beginPath()
        ctx.moveTo(x - 5, top - 9 + bob)
        ctx.lineTo(x + 5, top - 9 + bob)
        ctx.lineTo(x, top - 2 + bob)
        ctx.closePath()
        ctx.fill()
    }
}

function offscreenTag(ctx: CanvasRenderingContext2D, side: 'left' | 'right', y: number, name: string, color: string, size: number, me: boolean) {
    ctx.font = `bold ${size}px ${FONT}`
    ctx.textBaseline = 'middle'
    const text = side === 'left' ? `< ${name}` : `${name} >`
    const w = ctx.measureText(text).width + size
    const h = size * 1.4
    const x = side === 'left' ? 4 : W - 4 - w
    ctx.fillStyle = me ? '#fff3bf' : 'rgba(255, 255, 255, 0.9)'
    ctx.strokeStyle = me ? '#f08c00' : color
    ctx.lineWidth = me ? 2 : 1.5
    ctx.beginPath()
    ctx.roundRect(x, y - h / 2, w, h, h / 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.textAlign = 'left'
    ctx.fillText(text, x + size / 2, y)
}

function drawCountdown(ctx: CanvasRenderingContext2D, t: number) {
    let text = ''
    let scale = 1
    let alpha = 1
    let color = '#e03131'
    if (t < -3) {
        text = 'GET READY...'
        scale = 0.4 + Math.sin(clock * 4) * 0.02
        color = '#1c7ed6'
    } else if (t < 0) {
        const n = Math.ceil(-t)
        const k = n + t // 0..1 elapsed within this number
        text = String(n)
        scale = 1.5 - 0.5 * easeOut(k * 4)
        alpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1
        color = ['#2f9e44', '#f08c00', '#e03131'][n - 1] ?? '#e03131'
    } else if (t < 0.9) {
        text = 'GO!'
        scale = 0.8 + t * 0.9
        alpha = 1 - Math.max(0, t - 0.5) / 0.4
        color = '#2f9e44'
    } else {
        return
    }
    const size = H * 0.3 * scale
    ctx.save()
    ctx.globalAlpha = Math.max(0, alpha)
    ctx.translate(W / 2, H * 0.4)
    ctx.rotate(Math.sin(clock * 5) * 0.06)
    ctx.font = `bold ${size}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(4, size * 0.12)
    ctx.strokeStyle = '#ffffff'
    ctx.strokeText(text, 0, 0)
    ctx.lineWidth = Math.max(2, size * 0.04)
    ctx.strokeStyle = INK
    ctx.strokeText(text, 0, 0)
    ctx.fillStyle = color
    ctx.fillText(text, 0, 0)
    ctx.restore()
}

function photoFrame(ctx: CanvasRenderingContext2D, u: number) {
    const m = 14 * u
    const len = 28 * u
    ctx.strokeStyle = INK
    ctx.lineWidth = 3 * u
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (const [cx, cy, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
        ctx.moveTo(cx, cy + sy * len)
        ctx.lineTo(cx, cy)
        ctx.lineTo(cx + sx * len, cy)
    }
    ctx.stroke()
    const size = Math.max(14, 22 * u)
    ctx.save()
    ctx.translate(W / 2, m + size)
    ctx.rotate(-0.04)
    ctx.font = `bold ${size}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = size * 0.18
    ctx.strokeStyle = '#ffffff'
    ctx.strokeText('PHOTO FINISH!', 0, 0)
    ctx.fillStyle = '#e03131'
    ctx.fillText('PHOTO FINISH!', 0, 0)
    ctx.restore()
}

function updateOrder(race: NcRaceScript, drawn: Drawn[], finished: boolean) {
    const sorted = drawn.slice().sort((a, b) => {
        if (finished) {
            if (a.seat === race.winnerSeat) return -1
            if (b.seat === race.winnerSeat) return 1
        }
        return b.p - a.p
    })
    const key = sorted.map(h => h.seat).join(',')
    if (key === orderKey) return
    orderKey = key
    order.value = sorted.map(h => ({
        seat: h.seat,
        name: h.info?.horseName || `Horse #${h.seat + 1}`,
        color: h.info?.color || '#868e96',
        isMe: !!h.info?.isMe
    }))
}

watch(() => props.horses, () => {
    // Names or colours changed: force the strip to rebuild.
    orderKey = ''
}, { deep: true })

onMounted(() => {
    resize()
    observer = new ResizeObserver(() => resize())
    if (wrap.value) observer.observe(wrap.value)
    raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    if (raf) cancelAnimationFrame(raf)
    raf = 0
})

const PLACES = ['1st', '2nd', '3rd', '4th', '5th', '6th']
</script>

<template>
    <div class="nc-track">
        <div ref="wrap" class="nc-track-stage" :style="{ height: cssHeight ? `${cssHeight}px` : undefined }">
            <canvas ref="canvas" class="nc-track-canvas" :style="{ height: cssHeight ? `${cssHeight}px` : undefined }" />

            <div v-if="order.length" class="nc-order">
                <div
                    v-for="(row, i) in order"
                    :key="row.seat"
                    class="nc-order-row"
                    :class="{ 'is-me': row.isMe }"
                >
                    <span class="nc-order-place">{{ PLACES[i] ?? `${i + 1}th` }}</span>
                    <span class="nc-order-dot" :style="{ background: row.color }" />
                    <span class="nc-order-name">{{ row.name }}</span>
                </div>
            </div>

            <Transition name="nc-banner">
                <div v-if="banner" class="nc-banner">
                    <span>{{ banner }} WINS!</span>
                </div>
            </Transition>
        </div>

        <div class="nc-ticker">
            <span class="nc-ticker-mic">MIC</span>
            <Transition name="nc-tick" mode="out-in">
                <span v-if="ticker" :key="ticker.id" class="nc-ticker-text">{{ ticker.text }}</span>
            </Transition>
        </div>
    </div>
</template>

<style scoped>
.nc-track {
    --nc-font: 'Comic Neue', 'Chalkboard SE', 'Comic Sans MS', cursive;
    --nc-ink: #2f2a24;
    font-family: var(--nc-font);
    width: 100%;
}

.nc-track-stage {
    position: relative;
    width: 100%;
    overflow: hidden;
    border: 3px solid var(--nc-ink);
    border-radius: 14px 18px 12px 20px / 18px 12px 20px 14px;
    background: #fbf5e6;
    box-shadow: 3px 4px 0 rgba(47, 42, 36, 0.25);
}

.nc-track-canvas {
    display: block;
    width: 100%;
}

.nc-order {
    position: absolute;
    top: 6px;
    left: 6px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px 6px;
    background: rgba(255, 255, 255, 0.85);
    border: 2px solid var(--nc-ink);
    border-radius: 10px 6px 12px 8px;
    font-size: 11px;
    line-height: 1.25;
    color: var(--nc-ink);
    max-width: 44%;
    pointer-events: none;
}

.nc-order-row {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    transition: transform 0.2s;
}

.nc-order-row.is-me {
    font-weight: 700;
    color: #d9480f;
}

.nc-order-place {
    width: 2.2em;
    font-weight: 700;
}

.nc-order-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid var(--nc-ink);
    flex: none;
}

.nc-order-name {
    overflow: hidden;
    text-overflow: ellipsis;
}

@media (max-width: 640px) {
    .nc-order {
        font-size: 9px;
        padding: 2px 4px;
    }

    .nc-order-row:nth-child(n + 4) {
        display: none;
    }
}

.nc-banner {
    position: absolute;
    left: 50%;
    top: 38%;
    transform: translate(-50%, -50%) rotate(-3deg);
    pointer-events: none;
    padding: 0.3em 0.9em;
    background: #ffe066;
    border: 3px solid var(--nc-ink);
    border-radius: 18px 10px 20px 12px / 12px 20px 10px 18px;
    box-shadow: 4px 5px 0 rgba(47, 42, 36, 0.35);
    font-size: clamp(18px, 4.5vw, 46px);
    font-weight: 700;
    color: var(--nc-ink);
    text-align: center;
    max-width: 90%;
    animation: nc-wiggle 0.9s ease-in-out infinite;
}

@keyframes nc-wiggle {
    0%,
    100% {
        transform: translate(-50%, -50%) rotate(-3deg) scale(1);
    }

    50% {
        transform: translate(-50%, -50%) rotate(2deg) scale(1.05);
    }
}

.nc-banner-enter-active {
    transition: opacity 0.3s, scale 0.4s cubic-bezier(0.3, 1.8, 0.5, 1);
}

.nc-banner-enter-from {
    opacity: 0;
    scale: 0.3;
}

.nc-banner-leave-active {
    transition: opacity 0.3s;
}

.nc-banner-leave-to {
    opacity: 0;
}

.nc-ticker {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    padding: 4px 10px;
    min-height: 2em;
    background: #fffdf6;
    border: 2px dashed var(--nc-ink);
    border-radius: 10px;
    color: var(--nc-ink);
    font-size: 14px;
    overflow: hidden;
}

.nc-ticker-mic {
    flex: none;
    padding: 0 6px;
    background: #e03131;
    color: #fff;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
}

.nc-ticker-text {
    display: inline-block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 700;
}

.nc-tick-enter-active,
.nc-tick-leave-active {
    transition: transform 0.25s, opacity 0.25s;
}

.nc-tick-enter-from {
    transform: translateY(100%);
    opacity: 0;
}

.nc-tick-leave-to {
    transform: translateY(-100%);
    opacity: 0;
}
</style>
