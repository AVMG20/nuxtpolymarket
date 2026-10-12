<script setup lang="ts">
// The chest opening: a takeover of the whole game area (not the site
// sidebar). The chest drops in, strains at its lock, bursts open in a shower
// of coins, gems and confetti, and deals its rewards out as cards that count
// up. Collect sends them home to the wallet. A tap skips to the end of the
// current phase; Esc skips to the end, a second Esc collects. The server has
// already paid by the time the chest bursts, so nothing here can lose a reward.
//
// Every effect is transform and opacity through the Web Animations API, and
// cosmetic, so Math.random is fine. With reduced motion there is no shake and
// no particles: the chest opens and the rewards fade in.
import TownAsset from '~/components/town/TownAsset.vue'
import TownBoostIcon from '~/components/town/TownBoostIcon.vue'
import TownChestArt from '~/components/town/TownChestArt.vue'
import type { TownStreakChest, TownStreakExtra, TownStreakExtraKind } from '#shared/utils/gamelogic/town-streak'
import { getTownBuilding, getTownResource } from '#shared/utils/gamelogic/town'

const { current, finish } = useTownChestOpening()
const sound = useTownSound()
const fx = useTownFx()
const { reduced } = useTownMotion()

const show = computed(() => current.value)
const loot = computed(() => current.value?.loot ?? null)

// ─── Motion ──────────────────────────────────────────────────────────────────

const osReduced = ref(false)
onMounted(() => {
    try {
        osReduced.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
        osReduced.value = false
    }
})
const calm = computed(() => reduced.value || osReduced.value)

// ─── Tiers ───────────────────────────────────────────────────────────────────

const TIER_INDEX: Record<TownStreakChest, number> = { wooden: 0, silver: 1, golden: 2 }
const CHEST_NAMES: Record<TownStreakChest, string> = { wooden: 'Wooden chest', silver: 'Silver chest', golden: 'Golden chest' }

interface TierFx {
    charge: number
    coins: number
    gems: number
    confetti: number
    shake: number
    colors: string[]
}

/** How hard each chest goes: a longer wind-up, a bigger shake, more in the air. */
const TIER_FX: Record<TownStreakChest, TierFx> = {
    wooden: { charge: 1_350, coins: 12, gems: 6, confetti: 26, shake: 0, colors: ['#ffd166', '#f4a259', '#ef476f', '#06d6a0', '#5ab0ff'] },
    silver: { charge: 1_800, coins: 16, gems: 10, confetti: 40, shake: 7, colors: ['#ffffff', '#cfe6ff', '#7fbaff', '#b9a6ff', '#7ff0e0'] },
    golden: { charge: 2_400, coins: 24, gems: 16, confetti: 60, shake: 13, colors: ['#ffd700', '#fff1a6', '#ff6b8b', '#7cf5c4', '#8fd3ff', '#ffb347'] }
}

// ─── Phase ───────────────────────────────────────────────────────────────────

type Phase = 'intro' | 'charge' | 'lucky' | 'burst' | 'cards' | 'done' | 'out'

const phase = ref<Phase>('intro')
/** The tier drawn right now: the track's, until a lucky charge upgrades it. */
const shownTier = ref<TownStreakChest>('wooden')
const opened = ref(false)
const settled = ref(false)
const luckyShown = ref(false)
/** A skip asked for while the server had not answered yet. */
let skipWhenReady: 'phase' | 'end' | null = null
/** The wind-up is done and the chest is rattling in place until the server answers. */
let holding = false

const finalTier = computed<TownStreakChest>(() => loot.value?.chest ?? show.value?.chest ?? 'wooden')
const hasChest = computed(() => !!show.value?.chest)
const tierFx = computed(() => TIER_FX[shownTier.value])

const rootEl = ref<HTMLElement | null>(null)
const shakeEl = ref<HTMLElement | null>(null)
const wrapEl = ref<HTMLElement | null>(null)
const chestEl = ref<HTMLElement | null>(null)
const slotEl = ref<HTMLElement | null>(null)
const partsEl = ref<HTMLElement | null>(null)
const flashEl = ref<HTMLElement | null>(null)
const collectEl = ref<HTMLElement | null>(null)

// ─── Timers and animations ───────────────────────────────────────────────────

const timers = new Set<ReturnType<typeof setTimeout>>()
let sparkTimer: ReturnType<typeof setTimeout> | null = null

function later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
        timers.delete(t)
        fn()
    }, ms)
    timers.add(t)
}

function clearTimers() {
    for (const t of timers) clearTimeout(t)
    timers.clear()
    if (sparkTimer) clearTimeout(sparkTimer)
    sparkTimer = null
}

/** Animations on the chest and the stage, cancelled when a phase is skipped. */
const stageAnims = new Set<Animation>()

function animate(el: Element | null | undefined, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
    if (!el) return null
    const a = el.animate(frames, opts)
    stageAnims.add(a)
    const drop = () => stageAnims.delete(a)
    a.addEventListener('finish', drop)
    a.addEventListener('cancel', drop)
    return a
}

function cancelStage() {
    for (const a of [...stageAnims]) a.cancel()
    stageAnims.clear()
}

// ─── Particles ───────────────────────────────────────────────────────────────

const MAX_PARTS = 170
let liveParts = 0
const partAnims = new Set<Animation>()

const jitter = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!
const r1 = (n: number) => Math.round(n * 10) / 10

const GEM_SVG = '<svg viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 12L2 9z" fill="currentColor" stroke="rgba(0,0,0,.35)" stroke-width="1.2" stroke-linejoin="round"/><path d="M2 9h20M9 3l3 6 3-6M12 21 9 9m3 12 3-12" stroke="rgba(255,255,255,.6)" stroke-width="1.1" fill="none"/></svg>'
const GEM_COLORS = ['#3fb6ff', '#5ad1ff', '#7aa8ff', '#9be7ff']

function spawn(cls: string, x: number, y: number, frames: Keyframe[], opts: KeyframeAnimationOptions, setup?: (el: HTMLElement) => void) {
    const box = partsEl.value
    if (!box || calm.value || liveParts >= MAX_PARTS) return
    const el = document.createElement('span')
    el.className = `tp ${cls}`
    el.style.left = `${Math.round(x)}px`
    el.style.top = `${Math.round(y)}px`
    setup?.(el)
    box.appendChild(el)
    liveParts++
    const a = el.animate(frames, { fill: 'both', easing: 'linear', ...opts })
    partAnims.add(a)
    let gone = false
    const done = () => {
        if (gone) return
        gone = true
        partAnims.delete(a)
        el.remove()
        liveParts--
    }
    a.addEventListener('finish', done)
    a.addEventListener('cancel', done)
}

function clearParts() {
    for (const a of [...partAnims]) a.cancel()
    partAnims.clear()
}

/** A thrown particle: out at (vx, vy) px/s, pulled down by `g`, spinning, fading at the end. */
function ballistic(vx: number, vy: number, g: number, dur: number, spin: number, scale: number, fadeAt = 0.7): Keyframe[] {
    const frames: Keyframe[] = []
    const steps = 12
    for (let k = 0; k <= steps; k++) {
        const f = k / steps
        const t = (f * dur) / 1_000
        const s = k === 0 ? scale * 0.3 : scale
        frames.push({
            offset: f,
            opacity: f > fadeAt ? Math.max(0, 1 - (f - fadeAt) / (1 - fadeAt)) : 1,
            transform: `translate3d(${r1(vx * t)}px, ${r1(vy * t + 0.5 * g * t * t)}px, 0) rotate(${r1(spin * t)}deg) scale(${r1(s * 100) / 100})`
        })
    }
    return frames
}

/** A point in the overlay's own coordinates. */
function local(rect: DOMRect | null | undefined, fy = 0.5): { x: number, y: number } {
    const root = rootEl.value?.getBoundingClientRect()
    if (!rect || !root) return { x: (root?.width ?? 0) / 2, y: (root?.height ?? 0) / 2 }
    return { x: rect.left - root.left + rect.width / 2, y: rect.top - root.top + rect.height * fy }
}

function chestPoint(fy = 0.5) {
    return local(chestEl.value?.getBoundingClientRect(), fy)
}

function overlaySize() {
    const r = rootEl.value?.getBoundingClientRect()
    return { w: r?.width ?? 800, h: r?.height ?? 600 }
}

function coin(x: number, y: number, vx: number, vy: number, dur: number, delay = 0) {
    spawn('tp-coin', x, y, ballistic(vx, vy, 1_500, dur, jitter(-520, 520), jitter(0.8, 1.15)), { duration: dur, delay }, (el) => {
        el.innerHTML = '<i></i>'
    })
}

function gem(x: number, y: number, vx: number, vy: number, dur: number, delay = 0) {
    spawn('tp-gem', x, y, ballistic(vx, vy, 1_500, dur, jitter(-360, 360), jitter(0.8, 1.2)), { duration: dur, delay }, (el) => {
        el.innerHTML = GEM_SVG
        el.style.color = pick(GEM_COLORS)
    })
}

function spark(x: number, y: number, vx: number, vy: number, dur: number, color: string, delay = 0) {
    spawn('tp-spark', x, y, ballistic(vx, vy, 700, dur, 0, jitter(0.6, 1.2), 0.4), { duration: dur, delay }, (el) => {
        el.style.setProperty('--c', color)
    })
}

function confetti(x: number, h: number, color: string, delay: number) {
    const dur = jitter(2_200, 3_400)
    const sway = jitter(30, 90) * (Math.random() < 0.5 ? -1 : 1)
    const rx = jitter(360, 900)
    const rz = jitter(-400, 400)
    const frames: Keyframe[] = []
    const steps = 10
    for (let k = 0; k <= steps; k++) {
        const f = k / steps
        frames.push({
            offset: f,
            opacity: f > 0.85 ? (1 - f) / 0.15 : 1,
            transform: `translate3d(${r1(Math.sin(f * Math.PI * 2.2) * sway)}px, ${r1(f * (h + 60))}px, 0) rotateX(${r1(rx * f)}deg) rotateZ(${r1(rz * f)}deg)`
        })
    }
    spawn('tp-conf', x, -24, frames, { duration: dur, delay }, (el) => {
        el.style.background = color
        if (Math.random() < 0.35) el.style.borderRadius = '50%'
    })
}

function ring(x: number, y: number, color: string, size: number, dur = 650, delay = 0) {
    spawn('tp-ring', x, y, [
        { opacity: 0.95, transform: 'translate(-50%, -50%) scale(0.15)' },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' }
    ], { duration: dur, delay, easing: 'cubic-bezier(.1, .7, .3, 1)' }, (el) => {
        el.style.width = `${size}px`
        el.style.height = `${size}px`
        el.style.setProperty('--c', color)
    })
}

function star(x: number, y: number, color: string, delay: number) {
    const s = jitter(0.6, 1.3)
    spawn('tp-star', x, y, [
        { opacity: 0, transform: `scale(0) rotate(0deg)` },
        { opacity: 1, transform: `scale(${s}) rotate(90deg)`, offset: 0.4 },
        { opacity: 0, transform: `scale(0) rotate(180deg)` }
    ], { duration: jitter(500, 800), delay, easing: 'ease-out' }, (el) => {
        el.style.setProperty('--c', color)
    })
}

function dust(x: number, y: number) {
    for (let i = 0; i < 10; i++) {
        const dir = i % 2 ? 1 : -1
        const dur = jitter(500, 800)
        spawn('tp-dust', x + dir * jitter(10, 50), y, [
            { opacity: 0.8, transform: 'translate(-50%, -50%) scale(0.4)' },
            { opacity: 0, transform: `translate(calc(-50% + ${r1(dir * jitter(40, 110))}px), calc(-50% - ${r1(jitter(6, 26))}px)) scale(${r1(jitter(1.4, 2.4))})` }
        ], { duration: dur, easing: 'cubic-bezier(.2, .8, .4, 1)' })
    }
}

// ─── Screen shake ────────────────────────────────────────────────────────────

/** Jolts the stage: `amp` px, growing in over `dur` ('in') or dying away ('out'). */
function shake(amp: number, dur: number, ramp: 'in' | 'out') {
    if (calm.value || amp <= 0) return
    const n = Math.max(4, Math.round(dur / 40))
    const frames: Keyframe[] = []
    for (let i = 0; i <= n; i++) {
        const k = i / n
        const a = i === n ? 0 : amp * (ramp === 'in' ? k * k : (1 - k) * (1 - k))
        frames.push({ transform: `translate3d(${r1(jitter(-a, a))}px, ${r1(jitter(-a, a))}px, 0) rotate(${r1(jitter(-a, a) * 0.08)}deg)` })
    }
    animate(shakeEl.value, frames, { duration: dur, easing: 'linear' })
}

// ─── Chest placement ─────────────────────────────────────────────────────────

/** The chest's width in px, sized to the game area. */
const chestSize = ref(220)
/** Where the chest's wrap sits: the middle of the screen until it settles into its slot. */
const wrapY = ref(0)
const wrapScale = ref(1)

function measure() {
    const { w, h } = overlaySize()
    const base = Math.max(140, Math.min(h * 0.34, w * 0.58, 270))
    chestSize.value = Math.round(base * (finalTier.value === 'golden' ? 1.06 : 1))
    if (!settled.value) {
        wrapY.value = h * 0.46
        wrapScale.value = 1
        return
    }
    const slot = slotEl.value?.getBoundingClientRect()
    const root = rootEl.value?.getBoundingClientRect()
    if (!slot || !root) return
    wrapY.value = slot.top - root.top + slot.height * 0.56
    const chestH = chestSize.value * 110 / 120
    wrapScale.value = Math.max(0.42, Math.min(0.85, (slot.height * 0.8) / chestH))
}

let resizeObs: ResizeObserver | null = null

// ─── Cards ───────────────────────────────────────────────────────────────────

interface Card {
    key: string
    kind: 'coins' | 'gems' | 'good' | 'extra'
    id?: string
    extra?: TownStreakExtraKind
    qty: number
    name: string
    line?: string
}

const EXTRA_NAMES: Record<TownStreakExtraKind, string> = {
    build: 'Builder\'s rush',
    production: 'Production surge',
    market: 'Market day',
    builder: 'Free builder',
    instant: 'Instant finish',
    lucky: 'Lucky!'
}
const EXTRA_VARIANT: Record<TownStreakExtraKind, number> = { build: 0, production: 1, market: 2, builder: 3, instant: 4, lucky: 5 }

/** "1h", "24h", "3h 12m", "45m". */
function shortDuration(ms: number) {
    const mins = Math.round(ms / 60_000)
    const h = Math.floor(mins / 60)
    const m = mins % 60
    if (h && m) return `${h}h ${m}m`
    if (h) return `${h}h`
    return `${Math.max(1, m)}m`
}

function extraCards(extras: readonly TownStreakExtra[]): Card[] {
    const cards: Card[] = []
    const timed: Partial<Record<TownStreakExtraKind, number>> = {}
    let lucky = 0
    const instants: TownStreakExtra[] = []
    for (const e of extras) {
        if (e.kind === 'lucky') lucky++
        else if (e.kind === 'instant') instants.push(e)
        else timed[e.kind] = (timed[e.kind] ?? 0) + (e.ms ?? 0)
    }
    const lines: Partial<Record<TownStreakExtraKind, (ms: number) => string>> = {
        build: ms => `2× build speed · ${shortDuration(ms)}`,
        production: ms => `2× production · ${shortDuration(ms)}`,
        builder: ms => `+1 builder · ${shortDuration(ms)}`,
        market: ms => `Town hall pays 1.5× · ${shortDuration(ms)}`
    }
    for (const kind of ['build', 'production', 'builder', 'market'] as const) {
        const ms = timed[kind]
        if (ms === undefined) continue
        cards.push({ key: `x-${kind}`, kind: 'extra', extra: kind, qty: 0, name: EXTRA_NAMES[kind], line: lines[kind]!(ms) })
    }
    instants.slice(0, 3).forEach((e, i) => {
        const name = e.type ? getTownBuilding(e.type)?.name ?? 'a job' : 'a job'
        const line = e.type
            ? `Finished: ${name}${e.savedMs ? ` · saved ${shortDuration(e.savedMs)}` : ''}`
            : 'Finished a running job'
        cards.push({ key: `x-instant-${i}`, kind: 'extra', extra: 'instant', qty: 0, name: EXTRA_NAMES.instant, line })
    })
    if (instants.length > 3) {
        const saved = instants.slice(3).reduce((t, e) => t + (e.savedMs ?? 0), 0)
        cards.push({ key: 'x-instant-more', kind: 'extra', extra: 'instant', qty: 0, name: EXTRA_NAMES.instant, line: `Finished ${instants.length - 3} more jobs${saved ? ` · saved ${shortDuration(saved)}` : ''}` })
    }
    if (lucky) {
        cards.push({ key: 'x-lucky', kind: 'extra', extra: 'lucky', qty: 0, name: EXTRA_NAMES.lucky, line: lucky === 1 ? 'Next chest one tier better' : `Next ${lucky} chests one tier better` })
    }
    return cards
}

const cards = computed<Card[]>(() => {
    const l = loot.value
    if (!l) return []
    const out: Card[] = []
    if (l.coins > 0) out.push({ key: 'coins', kind: 'coins', qty: l.coins, name: 'Coins' })
    if (l.gems > 0) out.push({ key: 'gems', kind: 'gems', qty: l.gems, name: l.gems === 1 ? 'Gem' : 'Gems' })
    const goods = Object.entries(l.resources).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1])
    for (const [id, qty] of goods.slice(0, 4)) out.push({ key: `g-${id}`, kind: 'good', id, qty, name: getTownResource(id)?.name ?? id })
    out.push(...extraCards(l.extras))
    return out
})

/** Cards dealt so far, and each amount as it counts up. */
const dealt = ref<Set<string>>(new Set())
const counts = ref<Record<string, number>>({})
const cardEls = new Map<string, HTMLElement>()

function setCardEl(key: string, el: unknown) {
    if (el instanceof HTMLElement) cardEls.set(key, el)
    else cardEls.delete(key)
}

/** Long totals get a smaller font, sized off the final amount so it never jumps while counting. */
function qtyClass(c: Card) {
    const n = formatNumber(c.qty).length
    return n > 8 ? 'is-xlong' : n > 6 ? 'is-long' : ''
}

function shownQty(c: Card) {
    return counts.value[c.key] ?? c.qty
}

// Count-ups: one rAF loop for every card still ticking.
const counting = new Map<string, { start: number, dur: number, qty: number }>()
let countRaf = 0
let lastTick = 0

function startCount(c: Card) {
    if (c.kind === 'extra' || calm.value) {
        counts.value = { ...counts.value, [c.key]: c.qty }
        return
    }
    counting.set(c.key, { start: performance.now(), dur: c.kind === 'gems' ? 1_000 : 750, qty: c.qty })
    counts.value = { ...counts.value, [c.key]: 0 }
    if (!countRaf) countRaf = requestAnimationFrame(countFrame)
}

function countFrame(now: number) {
    const next = { ...counts.value }
    let progress = 0
    for (const [key, c] of counting) {
        const k = Math.min(1, (now - c.start) / c.dur)
        progress = Math.max(progress, k)
        const eased = 1 - Math.pow(1 - k, 3)
        next[key] = k >= 1 ? c.qty : Number.isInteger(c.qty) ? Math.floor(c.qty * eased) : c.qty * eased
        if (k >= 1) {
            counting.delete(key)
            sound.play('land', key === 'gems' ? 1.5 : 1.2)
        }
    }
    counts.value = next
    if (counting.size && now - lastTick > 55) {
        lastTick = now
        sound.play('count', 1 + progress * 0.9)
    }
    countRaf = counting.size ? requestAnimationFrame(countFrame) : 0
}

function stopCount() {
    cancelAnimationFrame(countRaf)
    countRaf = 0
    counting.clear()
}

/** A card is dealt: it flies out of the chest, flips over and lands in its slot. */
function dealCard(c: Card, i: number) {
    const set = new Set(dealt.value)
    set.add(c.key)
    dealt.value = set
    const el = cardEls.get(c.key)
    const pitch = 1 + i * 0.09
    if (calm.value || !el) {
        startCount(c)
        sound.play(c.kind === 'extra' ? 'extraReveal' : 'cardLand', pitch, c.extra ? EXTRA_VARIANT[c.extra] : 0)
        return
    }
    const from = chestEl.value?.getBoundingClientRect()
    const to = el.getBoundingClientRect()
    const dx = from ? from.left + from.width / 2 - (to.left + to.width / 2) : 0
    const dy = from ? from.top + from.height * 0.35 - (to.top + to.height / 2) : 0
    const tilt = jitter(-24, 24)
    const fly = 560
    animate(el, [
        { transform: `translate3d(${r1(dx)}px, ${r1(dy)}px, 0) scale(0.18) rotate(${r1(tilt)}deg)`, opacity: 0 },
        { transform: `translate3d(${r1(dx * 0.45)}px, ${r1(dy * 0.45 - 70)}px, 0) scale(0.8) rotate(${r1(tilt * 0.5)}deg)`, opacity: 1, offset: 0.4 },
        { transform: 'translate3d(0, -14px, 0) scale(1.1) rotate(0deg)', opacity: 1, offset: 0.78 },
        { transform: 'translate3d(0, 3px, 0) scale(0.97)', offset: 0.9 },
        { transform: 'none', opacity: 1 }
    ], { duration: fly, easing: 'cubic-bezier(.25, .8, .35, 1)', fill: 'both' })
    const inner = el.querySelector('.tco-card-in')
    animate(inner, [
        { transform: 'rotateY(180deg)' },
        { transform: 'rotateY(180deg)', offset: 0.45 },
        { transform: 'rotateY(-12deg)', offset: 0.85 },
        { transform: 'rotateY(0deg)' }
    ], { duration: fly + 120, easing: 'ease-out', fill: 'both' })
    later(fly - 60, () => {
        startCount(c)
        sound.play(c.kind === 'extra' ? 'extraReveal' : 'cardLand', pitch, c.extra ? EXTRA_VARIANT[c.extra] : 0)
        const p = local(el.getBoundingClientRect())
        const color = c.kind === 'gems' ? '#5ad1ff' : c.kind === 'coins' ? '#ffd166' : c.kind === 'good' ? '#7ee08a' : '#fff1a6'
        ring(p.x, p.y, color, c.kind === 'extra' ? 260 : 180, 600)
        const n = c.kind === 'extra' || c.kind === 'gems' ? 10 : 5
        for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2
            spark(p.x, p.y, Math.cos(a) * jitter(180, 300), Math.sin(a) * jitter(180, 300), 600, color)
        }
        if (c.kind === 'gems') {
            for (let k = 0; k < 6; k++) gem(p.x, p.y - 20, jitter(-220, 220), jitter(-520, -320), 900)
        }
    })
}

// ─── Sequence ────────────────────────────────────────────────────────────────

function begin() {
    clearTimers()
    cancelStage()
    clearParts()
    stopCount()
    const s = show.value
    if (!s) return
    shownTier.value = s.loot?.upgradedFrom ?? s.chest ?? 'wooden'
    opened.value = false
    settled.value = false
    luckyShown.value = false
    skipWhenReady = null
    holding = false
    dealt.value = new Set()
    counts.value = {}
    measure()
    void nextTick(() => {
        measure()
        rootEl.value?.focus({ preventScroll: true })
        if (!hasChest.value) {
            phase.value = 'burst'
            opened.value = true
            later(calm.value ? 0 : 260, enterCards)
            return
        }
        enterIntro()
    })
}

function enterIntro() {
    phase.value = 'intro'
    const tier = TIER_INDEX[shownTier.value]
    if (calm.value) {
        sound.play('chestDrop', 1, tier)
        later(350, enterCharge)
        return
    }
    const { h } = overlaySize()
    // Falls, slams down with a squash, hops once and settles.
    animate(chestEl.value, [
        { transform: `translate3d(0, ${-Math.round(h * 0.75)}px, 0) scale(0.9, 1.1)`, opacity: 1, easing: 'cubic-bezier(.55, 0, 1, .45)' },
        { transform: 'translate3d(0, 0, 0) scale(0.92, 1.1)', offset: 0.5, easing: 'ease-out' },
        { transform: 'translate3d(0, 0, 0) scale(1.28, 0.72)', offset: 0.6, easing: 'ease-out' },
        { transform: 'translate3d(0, -34px, 0) scale(0.92, 1.1)', offset: 0.76, easing: 'ease-in' },
        { transform: 'translate3d(0, 0, 0) scale(1.08, 0.93)', offset: 0.88, easing: 'ease-out' },
        { transform: 'none' }
    ], { duration: 950, easing: 'linear', fill: 'both' })
    later(470, () => {
        sound.play('chestDrop', 1, tier)
        const p = chestPoint(0.98)
        dust(p.x, p.y)
        shake(4 + tier * 5, 380, 'out')
        ring(p.x, p.y, 'rgba(255,255,255,.7)', chestSize.value * 1.6, 520)
    })
    later(1_000, enterCharge)
}

function enterCharge() {
    phase.value = 'charge'
    const fxT = tierFx.value
    const tier = TIER_INDEX[shownTier.value]
    if (calm.value) {
        if (loot.value) afterCharge()
        else holding = true
        return
    }
    const d = fxT.charge
    const chest = chestEl.value
    // The rattle: small knocks that grow into a violent shake.
    const n = Math.round(d / 55)
    const frames: Keyframe[] = []
    for (let i = 0; i <= n; i++) {
        const k = i / n
        const amp = 1.5 + Math.pow(k, 1.4) * 13
        const dir = i % 2 ? 1 : -1
        frames.push({
            transform: i === n
                ? `translate3d(0, ${r1(-k * 10)}px, 0) rotate(0deg) scale(${r1((1 + k * 0.1) * 100) / 100})`
                : `translate3d(${r1(dir * amp * 0.4)}px, ${r1(-k * 10 - (i % 3 === 0 ? amp * 0.3 : 0))}px, 0) rotate(${r1(dir * amp)}deg) scale(${r1((1 + k * 0.1) * 100) / 100})`
        })
    }
    animate(chest, frames, { duration: d, easing: 'linear', fill: 'forwards' })
    const leak = chest?.querySelector('.tca-leak')
    const crack = chest?.querySelector('.tca-crack')
    animate(leak, [{ opacity: 0 }, { opacity: 0.25, offset: 0.4 }, { opacity: 1 }], { duration: d, easing: 'ease-in', fill: 'forwards' })
    animate(crack, [{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: d, easing: 'ease-in', fill: 'forwards' })
    sound.play('chestRattle', d / 1_000, tier)
    if (fxT.shake) later(d * 0.45, () => shake(fxT.shake * 0.7, d * 0.55, 'in'))
    // Sparks spit from the seam, faster and faster.
    const t0 = performance.now()
    const emit = () => {
        const k = Math.min(1, (performance.now() - t0) / d)
        const p = chestPoint(0.5)
        const w = chestSize.value
        const count = 1 + Math.round(k * 2)
        for (let i = 0; i < count; i++) {
            spark(p.x + jitter(-w * 0.42, w * 0.42), p.y + jitter(-6, 6), jitter(-160, 160), jitter(-380, -140) * (0.6 + k), jitter(450, 750), pick(fxT.colors))
        }
        sparkTimer = setTimeout(emit, 150 - k * 110)
    }
    sparkTimer = setTimeout(emit, 200)
    later(d, () => {
        if (loot.value) {
            afterCharge()
        } else {
            // The server is slow: hold at full tilt until it answers.
            holding = true
            animate(chest, [
                { transform: 'translate3d(-5px, -10px, 0) rotate(-14deg) scale(1.1)' },
                { transform: 'translate3d(5px, -12px, 0) rotate(14deg) scale(1.1)' }
            ], { duration: 110, iterations: Infinity, direction: 'alternate' })
        }
    })
}

function afterCharge() {
    skipWhenReady = null
    holding = false
    if (loot.value?.upgradedFrom && !luckyShown.value) enterLucky()
    else enterBurst()
}

function enterLucky() {
    phase.value = 'lucky'
    luckyShown.value = true
    if (sparkTimer) clearTimeout(sparkTimer)
    sparkTimer = null
    sound.stop('chestRattle')
    sound.play('luckyUpgrade')
    if (calm.value) {
        shownTier.value = finalTier.value
        later(900, enterBurst)
        return
    }
    cancelStage()
    const chest = chestEl.value
    animate(chest, [
        { transform: 'none', filter: 'brightness(1)' },
        { transform: 'scale(1.18, 0.86)', filter: 'brightness(1.6)', offset: 0.2 },
        { transform: 'scale(0.85, 1.25) translate3d(0, -20px, 0)', filter: 'brightness(4) saturate(0)', offset: 0.32 },
        { transform: 'scale(1.25) translate3d(0, -12px, 0)', filter: 'brightness(4) saturate(0)', offset: 0.4 },
        { transform: 'scale(0.94, 1.06)', filter: 'brightness(1.3)', offset: 0.62 },
        { transform: 'none', filter: 'brightness(1)' }
    ], { duration: 1_100, easing: 'ease-out' })
    later(400, () => {
        shownTier.value = finalTier.value
        flash(0.75, 380)
        const p = chestPoint(0.5)
        const colors = TIER_FX[finalTier.value].colors
        ring(p.x, p.y, '#fff', chestSize.value * 2.2, 700)
        ring(p.x, p.y, colors[0]!, chestSize.value * 3, 900, 120)
        for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2
            star(p.x + Math.cos(a) * chestSize.value * jitter(0.45, 0.8), p.y + Math.sin(a) * chestSize.value * jitter(0.35, 0.6), pick(colors), jitter(0, 300))
        }
        shake(6, 300, 'out')
    })
    later(1_500, enterBurst)
}

function flash(peak: number, dur: number) {
    if (calm.value) return
    animate(flashEl.value, [{ opacity: 0 }, { opacity: peak, offset: 0.12 }, { opacity: 0 }], { duration: dur, easing: 'ease-out' })
}

function enterBurst() {
    phase.value = 'burst'
    if (sparkTimer) clearTimeout(sparkTimer)
    sparkTimer = null
    cancelStage()
    shownTier.value = finalTier.value
    const tier = TIER_INDEX[shownTier.value]
    const fxT = TIER_FX[shownTier.value]
    sound.stop('chestRattle')
    sound.play('chestBurst', 1, tier)
    opened.value = true
    if (calm.value) {
        later(450, enterCards)
        return
    }
    flash(tier === 2 ? 1 : 0.85, tier === 2 ? 700 : 480)
    const chest = chestEl.value
    animate(chest, [
        { transform: 'translate3d(0, -8px, 0) scale(1.1)' },
        { transform: 'scale(1.3, 0.78)', offset: 0.2 },
        { transform: 'scale(0.9, 1.14) translate3d(0, -10px, 0)', offset: 0.45 },
        { transform: 'scale(1.05, 0.96)', offset: 0.7 },
        { transform: 'none' }
    ], { duration: 650, easing: 'ease-out' })
    shake(fxT.shake + 4, 520 + tier * 180, 'out')
    const p = chestPoint(0.42)
    const { w, h } = overlaySize()
    const power = Math.min(1.25, Math.max(0.8, h / 800))
    ring(p.x, p.y, '#fff', chestSize.value * 2.4, 600)
    ring(p.x, p.y, fxT.colors[0]!, chestSize.value * 3.6, 900, 90)
    if (tier === 2) ring(p.x, p.y, fxT.colors[2]!, chestSize.value * 4.6, 1_100, 220)
    // The shower: coins and gems fountaining out of the chest.
    for (let i = 0; i < fxT.coins; i++) {
        const a = -Math.PI / 2 + jitter(-0.75, 0.75)
        const v = jitter(560, 980) * power
        coin(p.x + jitter(-20, 20), p.y, Math.cos(a) * v, Math.sin(a) * v, jitter(1_300, 1_800), jitter(0, 160))
    }
    if ((loot.value?.gems ?? 0) > 0) {
        for (let i = 0; i < fxT.gems; i++) {
            const a = -Math.PI / 2 + jitter(-0.6, 0.6)
            const v = jitter(620, 1_050) * power
            gem(p.x + jitter(-16, 16), p.y, Math.cos(a) * v, Math.sin(a) * v, jitter(1_400, 1_900), jitter(40, 220))
        }
    }
    for (let i = 0; i < 16 + tier * 6; i++) {
        const a = jitter(0, Math.PI * 2)
        const v = jitter(250, 600)
        spark(p.x, p.y, Math.cos(a) * v, Math.sin(a) * v, jitter(500, 900), pick(fxT.colors))
    }
    for (let i = 0; i < fxT.confetti; i++) confetti(jitter(0, w), h, pick(fxT.colors), jitter(80, 900))
    if (tier === 2) {
        // The golden one goes twice.
        later(380, () => {
            flash(0.5, 420)
            const q = chestPoint(0.42)
            for (let i = 0; i < 10; i++) {
                const a = -Math.PI / 2 + jitter(-0.9, 0.9)
                const v = jitter(500, 900) * power
                coin(q.x, q.y, Math.cos(a) * v, Math.sin(a) * v, jitter(1_300, 1_700))
            }
            for (let i = 0; i < 12; i++) star(q.x + jitter(-w * 0.3, w * 0.3), q.y + jitter(-h * 0.3, h * 0.1), pick(fxT.colors), jitter(0, 400))
        })
    }
    later(tier === 2 ? 1_150 : 900, enterCards)
}

function enterCards() {
    phase.value = 'cards'
    settled.value = true
    measure()
    const list = cards.value
    if (calm.value) {
        list.forEach((c, i) => dealCard(c, i))
        later(450, enterDone)
        return
    }
    let at = 380
    list.forEach((c, i) => {
        later(at, () => dealCard(c, i))
        at += c.kind === 'extra' ? 620 : c.kind === 'gems' ? 480 : 360
    })
    later(at + 650, enterDone)
}

function enterDone() {
    if (phase.value === 'done' || phase.value === 'out') return
    const wasCards = phase.value === 'cards'
    clearTimers()
    if (sparkTimer) clearTimeout(sparkTimer)
    sparkTimer = null
    for (const a of [...stageAnims]) {
        // Settle every flight and flip where it lands; anything looping just stops.
        if (a.effect?.getComputedTiming().iterations === Infinity) a.cancel()
        else a.finish()
    }
    sound.stop('chestRattle')
    shownTier.value = finalTier.value
    opened.value = true
    settled.value = true
    measure()
    const missing = cards.value.filter(c => !dealt.value.has(c.key))
    if (missing.length) {
        dealt.value = new Set(cards.value.map(c => c.key))
        if (!wasCards) sound.play('cardLand', 1.2)
    }
    stopCount()
    counts.value = Object.fromEntries(cards.value.map(c => [c.key, c.qty]))
    phase.value = 'done'
    if (finalTier.value === 'golden' || show.value?.mode === 'reset') sound.play('bigcoin')
    void nextTick(() => collectEl.value?.focus({ preventScroll: true }))
}

/** A tap: skip to the end of the phase that is playing. */
function skipPhase() {
    switch (phase.value) {
        case 'intro':
            clearTimers()
            cancelStage()
            enterCharge()
            break
        case 'charge':
            if (!loot.value) {
                skipWhenReady = 'phase'
                return
            }
            clearTimers()
            cancelStage()
            afterCharge()
            break
        case 'lucky':
            clearTimers()
            cancelStage()
            enterBurst()
            break
        case 'burst':
            clearTimers()
            enterCards()
            break
        case 'cards':
            enterDone()
            break
    }
}

/** Esc: straight to the cards and the Collect button. */
function skipToEnd() {
    if (phase.value === 'done' || phase.value === 'out') return
    if (!loot.value) {
        skipWhenReady = 'end'
        return
    }
    clearTimers()
    cancelStage()
    luckyShown.value = true
    enterDone()
}

// The server answered while the chest was still rattling.
watch(loot, (l) => {
    if (!l || !show.value) return
    measure()
    if (skipWhenReady === 'end') return skipToEnd()
    if (phase.value === 'charge' && (holding || skipWhenReady === 'phase')) {
        clearTimers()
        cancelStage()
        afterCharge()
    }
})

function onTap() {
    if (phase.value === 'done' || phase.value === 'out') return
    skipPhase()
}

// ─── Collect ─────────────────────────────────────────────────────────────────

const leaving = ref(false)

function collect() {
    const s = show.value
    if (!s || phase.value === 'out') return
    if (phase.value !== 'done') enterDone()
    phase.value = 'out'
    sound.play('collect', 1, TIER_INDEX[finalTier.value])
    const home = document.querySelector('[data-fx-home]')
    for (const c of cards.value) {
        const el = cardEls.get(c.key)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (c.kind === 'coins') fx.fly(rect, 'coins', 'coin', finalTier.value === 'golden' || s.mode === 'reset' ? 12 : 8)
        else if (c.kind === 'gems') fx.fly(rect, 'gems', 'gem', Math.min(10, Math.max(4, c.qty)))
        else if (home) fx.fly(rect, home, 'spark', 4)
    }
    leaving.value = true
    if (!calm.value) {
        cardEls.forEach((el, key) => {
            const i = cards.value.findIndex(c => c.key === key)
            animate(el, [
                { transform: 'none', opacity: 1 },
                { transform: 'translate3d(0, -18px, 0) scale(1.06)', opacity: 1, offset: 0.35 },
                { transform: 'translate3d(0, 40px, 0) scale(0.4)', opacity: 0 }
            ], { duration: 420, delay: Math.max(0, i) * 35, easing: 'cubic-bezier(.5, 0, .7, .4)', fill: 'forwards' })
        })
    }
    later(calm.value ? 120 : 420, () => finish(s.id))
}

// ─── Keys ────────────────────────────────────────────────────────────────────

// Caught on the way down, before the town's own shortcuts: the show is modal.
function onKey(e: KeyboardEvent) {
    if (!show.value || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Tab') return
    e.stopImmediatePropagation()
    if (e.key === 'Escape') {
        e.preventDefault()
        if (phase.value === 'done') collect()
        else skipToEnd()
    } else if (e.key === ' ' || e.key === 'Enter') {
        // Enter on the focused Collect button clicks it.
        if (phase.value === 'done') return
        e.preventDefault()
        skipPhase()
    }
}

watch(() => show.value?.id, (id, prev) => {
    if (id === prev) return
    leaving.value = false
    if (id) begin()
    else {
        clearTimers()
        cancelStage()
        clearParts()
        stopCount()
        sound.stop('chestRattle')
    }
})

onMounted(() => {
    window.addEventListener('keydown', onKey, true)
    resizeObs = new ResizeObserver(() => measure())
    if (show.value) begin()
})

// The overlay only exists while a show runs, so follow it in and out.
watch(rootEl, (el) => {
    resizeObs?.disconnect()
    if (el) resizeObs?.observe(el)
})

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey, true)
    resizeObs?.disconnect()
    clearTimers()
    cancelStage()
    clearParts()
    stopCount()
    sound.stop('chestRattle')
    // Leaving the town mid-show still pays the wallet out.
    if (show.value) finish(show.value.id)
})

// ─── View ────────────────────────────────────────────────────────────────────

const title = computed(() => {
    const s = show.value
    if (!s) return ''
    if (s.mode === 'reset') return `Collected ${s.days} ${s.days === 1 ? 'day' : 'days'}`
    return CHEST_NAMES[shownTier.value]
})
const subtitle = computed(() => {
    const s = show.value
    if (!s) return ''
    if (s.mode === 'reset') {
        const chests = s.chests ? `${s.chests} ${s.chests === 1 ? 'chest' : 'chests'} opened · ` : ''
        return `${chests}A new run starts at day 1`
    }
    return `Day ${s.step}`
})

const wrapStyle = computed(() => ({
    transform: `translate3d(-50%, calc(${Math.round(wrapY.value)}px - 50%), 0) scale(${wrapScale.value})`
}))

function cardColor(c: Card) {
    switch (c.kind) {
        case 'coins': return 'var(--g-gold)'
        case 'gems': return 'var(--g-gem)'
        case 'good': return 'var(--g-green)'
        default: return EXTRA_COLORS[c.extra ?? 'build']
    }
}
const EXTRA_COLORS: Record<TownStreakExtraKind, string> = {
    build: '#f97316',
    production: '#22c55e',
    market: '#eab308',
    builder: '#3b82f6',
    instant: '#a855f7',
    lucky: '#14b8a6'
}
</script>

<template>
    <Transition name="tco-fade">
        <div
            v-if="show"
            ref="rootEl"
            class="tco"
            :class="[`tier-${shownTier}`, `phase-${phase}`, { 'is-calm': calm, 'is-settled': settled, 'is-leaving': leaving, 'no-chest': !hasChest }]"
            role="dialog"
            aria-modal="true"
            :aria-label="title"
            tabindex="-1"
            @click="onTap"
        >
            <div class="tco-dim" />
            <div ref="shakeEl" class="tco-shake">
                <!-- The chest and the god rays behind it. -->
                <div ref="wrapEl" class="tco-wrap" :style="wrapStyle">
                    <div class="tco-rays"><i /><i /></div>
                    <div class="tco-halo" />
                    <div v-if="hasChest" ref="chestEl" class="tco-chest">
                        <TownChestArt :tier="shownTier" :size="chestSize" stage :open="opened" />
                    </div>
                    <div v-if="luckyShown && phase === 'lucky'" class="tco-lucky">LUCKY!</div>
                </div>

                <div class="tco-layout">
                    <header class="tco-head">
                        <h2 :key="title" class="tco-title">{{ title }}</h2>
                        <p class="tco-sub">
                            <span v-if="loot?.upgradedFrom && luckyShown" class="tco-tag">
                                <TownBoostIcon kind="lucky" :size="16" /> Lucky upgrade
                            </span>
                            {{ subtitle }}
                        </p>
                    </header>
                    <div ref="slotEl" class="tco-slot" />
                    <div class="tco-cards" :class="{ 'is-many': cards.length > 6 }">
                        <div
                            v-for="c in cards"
                            :key="c.key"
                            :ref="(el) => setCardEl(c.key, el)"
                            class="tco-card"
                            :class="[`kind-${c.kind}`, { 'is-dealt': dealt.has(c.key), 'is-star': c.kind === 'gems' }]"
                            :style="{ '--cc': cardColor(c) }"
                        >
                            <div class="tco-card-in">
                                <div class="tco-face tco-front">
                                    <span class="tco-card-glow" />
                                    <span class="tco-card-icon">
                                        <svg v-if="c.kind === 'coins'" class="tco-art" viewBox="0 0 48 48" aria-hidden="true">
                                            <g stroke="#6b4100" stroke-width="2.4" stroke-linejoin="round">
                                                <ellipse cx="20" cy="36" rx="14" ry="6" fill="#e09a00" />
                                                <path d="M6 31v5a14 6 0 0 0 28 0v-5Z" fill="#c98200" />
                                                <ellipse cx="20" cy="31" rx="14" ry="6" fill="#ffd23a" />
                                                <path d="M6 24v5a14 6 0 0 0 28 0v-5Z" fill="#c98200" />
                                                <ellipse cx="20" cy="24" rx="14" ry="6" fill="#ffdc5c" />
                                                <circle cx="32" cy="17" r="12" fill="#ffd23a" />
                                            </g>
                                            <circle cx="32" cy="17" r="8" fill="none" stroke="#e09a00" stroke-width="2" />
                                            <path d="M32 11.5v11M29 14.5q0-2 3-2t3 2q0 2-3 2.5t-3 2.5q0 2 3 2t3-2" fill="none" stroke="#a86b00" stroke-width="1.8" stroke-linecap="round" />
                                            <path d="M25 10a10 10 0 0 1 8-3" fill="none" stroke="#fff8c8" stroke-width="2" stroke-linecap="round" />
                                        </svg>
                                        <svg v-else-if="c.kind === 'gems'" class="tco-art" viewBox="0 0 48 48" aria-hidden="true">
                                            <path d="M13 7h22l10 12-21 23L3 19Z" fill="#2f9be0" stroke="#0b3554" stroke-width="2.6" stroke-linejoin="round" />
                                            <path d="M13 7l5 12h12l5-12M3 19h42M18 19l6 23 6-23" fill="none" stroke="#0b3554" stroke-width="1.6" stroke-linejoin="round" />
                                            <path d="M13 7l5 12H3Z" fill="#7fd3ff" />
                                            <path d="M18 19h12l-6 23Z" fill="#53b8f5" />
                                            <path d="M30 19h15L24 42Z" fill="#1a78bd" />
                                            <path d="M18 19l6-12 6 12Z" fill="#b5ecff" />
                                            <path d="M13 7h22l10 12-21 23L3 19Z" fill="none" stroke="#0b3554" stroke-width="2.6" stroke-linejoin="round" />
                                            <path d="M9 17l5-7" stroke="#fff" stroke-width="2" stroke-linecap="round" />
                                        </svg>
                                        <TownAsset v-else-if="c.kind === 'good'" :id="c.id" :label="c.name" />
                                        <TownBoostIcon v-else :kind="c.extra ?? 'build'" :size="56" />
                                    </span>
                                    <span class="tco-card-name">{{ c.name }}</span>
                                    <b v-if="c.kind !== 'extra'" class="tco-card-qty" :class="qtyClass(c)">+{{ formatNumber(shownQty(c)) }}</b>
                                    <span v-else class="tco-card-line">{{ c.line }}</span>
                                </div>
                                <div class="tco-face tco-back"><span /></div>
                            </div>
                        </div>
                    </div>
                    <footer class="tco-foot">
                        <button
                            v-if="phase === 'done' || phase === 'out'"
                            ref="collectEl"
                            type="button"
                            class="tco-collect"
                            @click.stop="collect"
                        >
                            Collect
                        </button>
                        <span v-else class="tco-hint">Tap to skip</span>
                    </footer>
                </div>
            </div>
            <div ref="partsEl" class="tco-parts" aria-hidden="true" />
            <div ref="flashEl" class="tco-flash" aria-hidden="true" />
        </div>
    </Transition>
</template>

<style scoped>
/* The whole game area, above its windows, dock, HUD and reward effects. */
.tco {
    position: absolute;
    inset: 0;
    z-index: 95;
    overflow: hidden;
    outline: none;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    color: #fff;
    --glow: #ffd76a;
    --ray: rgba(255, 214, 102, 0.34);
    --tint: rgba(120, 70, 20, 0.5);
}
.tco.tier-silver { --glow: #c4e6ff; --ray: rgba(170, 215, 255, 0.32); --tint: rgba(40, 70, 120, 0.55); }
.tco.tier-golden { --glow: #fff1a6; --ray: rgba(255, 220, 90, 0.42); --tint: rgba(150, 90, 0, 0.55); }
.tco.no-chest { --glow: #ffd76a; }

.tco-dim {
    position: absolute;
    inset: 0;
    background:
        radial-gradient(circle at 50% 46%, var(--tint) 0%, rgba(8, 10, 22, 0.78) 58%, rgba(4, 5, 12, 0.92) 100%);
    backdrop-filter: blur(3px) saturate(0.85);
}

.tco-shake { position: absolute; inset: 0; }

/* ── Chest and rays ─────────────────────────────────────────────────────── */
.tco-wrap {
    position: absolute;
    left: 50%;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transform-origin: 50% 50%;
    pointer-events: none;
}
.tco.is-settled .tco-wrap { transition: transform 0.6s cubic-bezier(.3, 1.25, .5, 1); }
.tco-chest {
    position: relative;
    z-index: 2;
    display: flex;
    transform-origin: 50% 100%;
    will-change: transform;
}

.tco-rays {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 1500px;
    height: 1500px;
    margin: -750px 0 0 -750px;
    opacity: 0;
    transition: opacity 0.5s ease, transform 0.6s ease;
    transform: scale(0.6);
    mask-image: radial-gradient(circle, black 6%, rgba(0, 0, 0, 0.5) 24%, transparent 50%);
    pointer-events: none;
}
.tco-rays i {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: repeating-conic-gradient(from 0deg, var(--ray) 0deg 7deg, transparent 7deg 22deg);
    animation: tco-spin 26s linear infinite;
}
.tco-rays i + i {
    background: repeating-conic-gradient(from 11deg, var(--ray) 0deg 4deg, transparent 4deg 30deg);
    animation-duration: 40s;
    animation-direction: reverse;
    opacity: 0.7;
}
.phase-intro .tco-rays { opacity: 0.35; transform: scale(0.7); }
.phase-charge .tco-rays,
.phase-lucky .tco-rays { opacity: 0.6; transform: scale(0.85); }
.tco:is(.phase-burst, .phase-cards, .phase-done, .phase-out) .tco-rays { opacity: 1; transform: scale(1.1); }
.tco.tier-golden:is(.phase-burst, .phase-cards, .phase-done, .phase-out) .tco-rays { transform: scale(1.35); }
.tco.tier-golden .tco-rays i { animation-duration: 16s; }
.tco.tier-golden .tco-rays i + i { animation-duration: 24s; }

.tco-halo {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 520px;
    height: 520px;
    margin: -260px 0 0 -260px;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--glow) 60%, transparent) 0%, transparent 62%);
    opacity: 0.25;
    transition: opacity 0.5s ease, transform 0.5s ease;
    pointer-events: none;
}
.phase-charge .tco-halo { opacity: 0.55; animation: tco-throb 0.5s ease-in-out infinite alternate; }
.tco:is(.phase-burst, .phase-cards, .phase-done, .phase-out) .tco-halo { opacity: 0.85; transform: scale(1.2); }

.tco-lucky {
    position: absolute;
    left: 50%;
    top: -30%;
    z-index: 3;
    padding: 6px 22px 8px;
    border-radius: 14px;
    background: linear-gradient(180deg, #5eead4, #0d9488);
    border: 3px solid #03302b;
    box-shadow: 0 6px 0 #03302b, 0 0 40px rgba(94, 234, 212, 0.7);
    font-family: var(--g-font-display);
    font-size: clamp(30px, 6vh, 52px);
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #fff;
    text-shadow: 0 3px 0 #03302b;
    white-space: nowrap;
    transform: translateX(-50%);
    animation: tco-stamp 0.55s cubic-bezier(.2, 1.6, .4, 1) both;
}

/* ── Layout ─────────────────────────────────────────────────────────────── */
.tco-layout {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: clamp(14px, 3.5vh, 36px) 16px clamp(14px, 3vh, 28px);
    pointer-events: none;
}
.tco-head { text-align: center; text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6); }
.tco-title {
    font-family: var(--g-font-display);
    font-size: clamp(24px, 4.4vh, 40px);
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.01em;
    background: linear-gradient(180deg, #fff 30%, color-mix(in srgb, var(--glow) 80%, white));
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
    animation: tco-title-in 0.5s cubic-bezier(.2, 1.4, .4, 1) both;
}
.tco-sub {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
    font-size: 13px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.72);
    letter-spacing: 0.02em;
}
.tco-tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 9px 2px 4px;
    border-radius: 999px;
    background: rgba(20, 184, 166, 0.25);
    border: 1px solid rgba(94, 234, 212, 0.6);
    color: #ccfbf1;
    animation: tco-pop 0.4s cubic-bezier(.2, 1.6, .4, 1) both;
}
.tco-slot { flex: 1 1 auto; min-height: 90px; width: 100%; }
.tco-foot {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 64px;
    margin-top: clamp(10px, 2vh, 20px);
    pointer-events: auto;
}
.tco-hint {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
    animation: tco-hint-in 0.6s ease 1.4s both, tco-breathe 2s ease-in-out 2s infinite;
}
@keyframes tco-hint-in { from { opacity: 0; } }

.tco-collect {
    min-width: 200px;
    padding: 14px 40px;
    border-radius: 999px;
    border: 3px solid #5a3a00;
    background: linear-gradient(180deg, #ffe680 0%, #ffc21a 50%, #e08a00 100%);
    box-shadow: 0 6px 0 #5a3a00, 0 10px 30px rgba(255, 190, 40, 0.45), inset 0 2px 0 rgba(255, 255, 255, 0.7);
    color: #3d2400;
    font-family: var(--g-font-display);
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.03em;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
    cursor: pointer;
    animation: tco-pop 0.45s cubic-bezier(.2, 1.6, .4, 1) both, tco-glow 1.6s ease-in-out 0.5s infinite;
    transition: transform 0.12s ease;
}
.tco-collect:hover { transform: translateY(-2px) scale(1.03); }
.tco-collect:active { transform: translateY(4px); box-shadow: 0 2px 0 #5a3a00, 0 6px 20px rgba(255, 190, 40, 0.4); }
.tco-collect:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }

/* ── Cards ──────────────────────────────────────────────────────────────── */
.tco-cards {
    --cw: 138px;
    --ch: 178px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 14px;
    max-width: min(100%, 1100px);
    pointer-events: none;
}
.tco-card {
    position: relative;
    width: var(--cw);
    height: var(--ch);
    perspective: 700px;
    visibility: hidden;
}
.tco-card.is-star { --cw: 150px; --ch: 192px; }
.tco-card.is-dealt { visibility: visible; }
.tco-card-in {
    position: relative;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
}
.tco-face {
    position: absolute;
    inset: 0;
    border-radius: 18px;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    overflow: hidden;
}
.tco-front {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 10px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--cc) 14%, var(--g-bg-2)) 0%, var(--g-bg-2) 55%);
    border: 2px solid color-mix(in srgb, var(--cc) 60%, transparent);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), 0 0 24px color-mix(in srgb, var(--cc) 35%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.25);
    color: var(--g-text);
    text-align: center;
}
.tco-back {
    transform: rotateY(180deg);
    display: flex;
    align-items: center;
    justify-content: center;
    background:
        repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.12) 0 8px, transparent 8px 16px),
        linear-gradient(180deg, color-mix(in srgb, var(--glow) 80%, #fff), color-mix(in srgb, var(--glow) 55%, #6b3d00));
    border: 3px solid rgba(255, 255, 255, 0.7);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
}
.tco-back span {
    width: 46%;
    aspect-ratio: 1;
    clip-path: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%);
    background: rgba(255, 255, 255, 0.85);
}
.tco-card-glow {
    position: absolute;
    left: 50%;
    top: 34%;
    width: 120%;
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--cc) 40%, transparent) 0%, transparent 60%);
    pointer-events: none;
}
.tco-card-icon {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 60px;
    font-size: 46px;
    color: var(--cc);
    filter: drop-shadow(0 3px 6px color-mix(in srgb, var(--cc) 45%, transparent));
}
.tco-art { width: 1.15em; height: 1.15em; overflow: visible; }
.tco-card-name {
    position: relative;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--g-text-2);
}
.tco-card-qty {
    position: relative;
    font-family: var(--g-font-display);
    font-size: 26px;
    font-weight: 800;
    line-height: 1;
    color: var(--cc);
    font-variant-numeric: tabular-nums;
}
.tco-card-qty.is-long { font-size: 21px; }
.tco-card-qty.is-xlong { font-size: 17px; }
.tco-card-line {
    position: relative;
    text-wrap: balance;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--g-text);
}

/* Gems are the star: bigger, with a shimmer running across. */
.tco-card.is-star .tco-card-qty { font-size: 32px; }
.tco-card.is-star .tco-card-icon { font-size: 54px; }
.tco-card.is-star .tco-front::after,
.tco-card.kind-extra .tco-front::after {
    content: '';
    position: absolute;
    inset: 0;
    width: 40%;
    background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.55), transparent);
    transform: translateX(-160%) skewX(-18deg);
    animation: tco-shimmer 2.8s ease-in-out 0.8s infinite;
    pointer-events: none;
}

/* Extras: a special card with a light running round its edge. */
.tco-card.kind-extra .tco-front {
    border: none;
    padding: 14px 12px;
    background: transparent;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 34px color-mix(in srgb, var(--cc) 55%, transparent);
}
.tco-card.kind-extra .tco-front::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 160%;
    aspect-ratio: 1;
    margin: -80% 0 0 -80%;
    background: conic-gradient(from 0deg, var(--cc), #fff 10%, var(--cc) 20%, color-mix(in srgb, var(--cc) 30%, #000) 50%, var(--cc) 70%, #fff 80%, var(--cc) 90%);
    animation: tco-spin 3s linear infinite;
    z-index: -2;
}
.tco-card.kind-extra .tco-card-glow {
    inset: 3px;
    left: 3px;
    top: 3px;
    width: auto;
    aspect-ratio: auto;
    transform: none;
    border-radius: 15px;
    background:
        radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--cc) 30%, transparent) 0%, transparent 60%),
        linear-gradient(180deg, color-mix(in srgb, var(--cc) 18%, var(--g-bg-2)), var(--g-bg-2) 60%);
    z-index: -1;
}
.tco-card.kind-extra .tco-front { isolation: isolate; }
.tco-card.kind-extra .tco-card-name { color: color-mix(in srgb, var(--cc) 72%, var(--g-text)); }

/* ── Particles and flash ────────────────────────────────────────────────── */
.tco-parts { position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; }
.tco-flash { position: absolute; inset: 0; z-index: 4; background: #fff; opacity: 0; pointer-events: none; }

.tco-parts :deep(.tp) {
    position: absolute;
    display: block;
    pointer-events: none;
    will-change: transform, opacity;
}
.tco-parts :deep(.tp-coin) { width: 24px; height: 24px; margin: -12px 0 0 -12px; }
.tco-parts :deep(.tp-coin i) {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #fff8c8 0%, #ffd23a 35%, #e09a00 75%, #a86b00 100%);
    border: 2px solid #8a5600;
    box-shadow: inset 0 0 0 3px rgba(255, 236, 150, 0.7);
}
.tco-parts :deep(.tp-gem) { width: 24px; height: 24px; margin: -12px 0 0 -12px; filter: drop-shadow(0 0 6px currentColor); }
.tco-parts :deep(.tp-gem svg) { display: block; width: 100%; height: 100%; }
.tco-parts :deep(.tp-spark) {
    width: 7px;
    height: 7px;
    margin: -3.5px 0 0 -3.5px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 6px 2px var(--c), 0 0 14px 4px color-mix(in srgb, var(--c) 50%, transparent);
}
.tco-parts :deep(.tp-conf) { width: 9px; height: 15px; margin-left: -4.5px; border-radius: 2px; }
.tco-parts :deep(.tp-ring) {
    border-radius: 50%;
    border: 5px solid var(--c);
    box-shadow: 0 0 24px var(--c), inset 0 0 24px var(--c);
}
.tco-parts :deep(.tp-star) {
    width: 22px;
    height: 22px;
    margin: -11px 0 0 -11px;
    background: var(--c);
    clip-path: polygon(50% 0, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0 50%, 40% 40%);
    filter: drop-shadow(0 0 6px var(--c));
}
.tco-parts :deep(.tp-dust) {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(235, 220, 195, 0.8), rgba(235, 220, 195, 0) 70%);
}

/* ── Leaving ────────────────────────────────────────────────────────────── */
.tco.is-leaving { pointer-events: none; }
.tco.is-leaving .tco-dim,
.tco.is-leaving .tco-wrap,
.tco.is-leaving .tco-head,
.tco.is-leaving .tco-foot { opacity: 0; transition: opacity 0.35s ease 0.08s; }

.tco-fade-enter-active { transition: opacity 0.3s ease; }
.tco-fade-leave-active { transition: opacity 0.2s ease; }
.tco-fade-enter-from,
.tco-fade-leave-to { opacity: 0; }

@keyframes tco-spin { to { transform: rotate(360deg); } }
@keyframes tco-throb { to { transform: scale(1.12); } }
@keyframes tco-breathe { 50% { opacity: 0.45; } }
@keyframes tco-stamp {
    0% { opacity: 0; transform: translateX(-50%) scale(3) rotate(-12deg); }
    60% { opacity: 1; transform: translateX(-50%) scale(0.9) rotate(3deg); }
    100% { opacity: 1; transform: translateX(-50%) scale(1) rotate(-3deg); }
}
@keyframes tco-title-in {
    from { opacity: 0; transform: translateY(-12px) scale(0.9); }
}
@keyframes tco-pop {
    from { opacity: 0; transform: scale(0.5); }
}
@keyframes tco-glow {
    0%, 100% { box-shadow: 0 6px 0 #5a3a00, 0 10px 30px rgba(255, 190, 40, 0.45), inset 0 2px 0 rgba(255, 255, 255, 0.7); }
    50% { box-shadow: 0 6px 0 #5a3a00, 0 10px 46px rgba(255, 200, 60, 0.85), inset 0 2px 0 rgba(255, 255, 255, 0.7); }
}
@keyframes tco-shimmer {
    0% { transform: translateX(-160%) skewX(-18deg); }
    50%, 100% { transform: translateX(380%) skewX(-18deg); }
}

/* ── Small screens ──────────────────────────────────────────────────────── */
@media (max-width: 640px) {
    .tco-cards { --cw: 104px; --ch: 140px; gap: 10px; }
    .tco-card.is-star { --cw: 112px; --ch: 150px; }
    .tco-card-icon { height: 46px; font-size: 36px; }
    .tco-card.is-star .tco-card-icon { font-size: 40px; }
    .tco-card-qty { font-size: 21px; }
    .tco-card-qty.is-long { font-size: 17px; }
    .tco-card-qty.is-xlong { font-size: 14px; }
    .tco-card.is-star .tco-card-qty { font-size: 24px; }
    .tco-card-line { font-size: 11px; }
    .tco-card-name { font-size: 10px; }
    .tco-card.kind-extra .tco-card-icon :deep(svg) { width: 44px; height: 44px; }
    .tco-collect { min-width: 170px; padding: 12px 32px; font-size: 20px; }
}
@media (max-height: 700px) {
    .tco-cards { --cw: 112px; --ch: 146px; gap: 10px; }
    .tco-card.is-star { --cw: 120px; --ch: 156px; }
    .tco-card-icon { height: 44px; font-size: 34px; }
}

/* Reduced motion: nothing spins, throbs or shimmers; cards fade in. */
.tco.is-calm .tco-rays i,
.tco.is-calm .tco-halo,
.tco.is-calm .tco-hint,
.tco.is-calm .tco-collect,
.tco.is-calm .tco-title,
.tco.is-calm .tco-lucky,
.tco.is-calm .tco-tag,
.tco.is-calm .tco-card.kind-extra .tco-front::before,
.tco.is-calm .tco-front::after { animation: none !important; }
.tco.is-calm .tco-front::after { display: none; }
.tco.is-calm .tco-wrap { transition: none !important; }
.tco.is-calm .tco-card { visibility: visible; opacity: 0; transition: opacity 0.35s ease; }
.tco.is-calm .tco-card.is-dealt { opacity: 1; }
.tco.is-calm .tco-lucky { transform: translateX(-50%); }
.tco.is-calm :deep(.tca-lid),
.tco.is-calm :deep(.tca-back),
.tco.is-calm :deep(.tca-glow) { animation: none !important; transition: none !important; }
</style>
