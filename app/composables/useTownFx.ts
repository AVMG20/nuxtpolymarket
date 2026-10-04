// Polytown reward effects: floating "+355.7K" amounts, bursts of coins and
// gems, and coins flying home to the wallet.
//
// A module-level queue drained by the one <TownFx /> layer that TownGame
// mounts, so any panel can celebrate a gain without owning DOM of its own.
// Everything here is cosmetic, so Math.random is fine. With reduced motion
// (the town's switch or the OS setting) only the amount text shows, as a fade.

export type TownFxAnchor = Element | DOMRect | { x: number, y: number } | null | undefined
/** 'coin', 'gem', or a resource id drawn with its TownAsset. */
export type TownFxIcon = 'coin' | 'gem' | (string & {})
export type TownFxTone = 'gold' | 'gem' | 'green'
export type TownFxKind = 'coin' | 'gem' | 'spark'
/** Where flying items go: an element or point, or the wallet chip for that currency. */
export type TownFxTarget = TownFxAnchor | 'coins' | 'gems'

export interface TownFxFloatItem {
    icon?: TownFxIcon
    text: string
    tone?: TownFxTone
}

export interface TownFxBurstPart { id: number, angle: number, speed: number, spin: number, scale: number, dur: number, delay: number }
export interface TownFxFlyPart { id: number, sx: number, sy: number, lift: number, sway: number, dur: number, delay: number }

interface FxBase { id: number, x: number, y: number }
export type TownFxEntry
    = | FxBase & { type: 'float', items: TownFxFloatItem[], big: boolean, calm: boolean }
      | FxBase & { type: 'burst', kind: TownFxKind, gravity: number, parts: TownFxBurstPart[] }
      | FxBase & { type: 'fly', kind: TownFxKind, tx: number, ty: number, target: Element | null, parts: TownFxFlyPart[] }
      | FxBase & { type: 'flash', tone: TownFxTone, size: number }

/** Hard ceilings, so a burst of claims can never stack into hundreds of nodes. */
const MAX_BURST = 28
const MAX_FLY = 12
const MAX_LIVE_PARTS = 120

const entries = shallowRef<TownFxEntry[]>([])
let nextId = 0

function partCount() {
    let n = 0
    for (const e of entries.value) {
        if (e.type === 'burst' || e.type === 'fly') n += e.parts.length
    }
    return n
}

function push(entry: TownFxEntry, life: number) {
    entries.value = [...entries.value, entry]
    setTimeout(() => {
        entries.value = entries.value.filter(e => e.id !== entry.id)
    }, life)
}

function isCalm(): boolean {
    if (useTownMotion().reduced.value) return true
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
        return false
    }
}

function pointOf(anchor: TownFxAnchor): { x: number, y: number } {
    if (!anchor) return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    if (anchor instanceof Element) return pointOf(anchor.getBoundingClientRect())
    if (typeof DOMRect !== 'undefined' && anchor instanceof DOMRect) {
        return { x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height / 2 }
    }
    return { x: anchor.x, y: anchor.y }
}

function visible(el: Element): boolean {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) return false
    const check = (el as Element & { checkVisibility?: () => boolean }).checkVisibility
    return check ? check.call(el) : true
}

/**
 * The wallet chip for a currency (`data-wallet` in the layout's sidebar), else
 * the town's home button (`data-fx-home`, the Daily dock button), else nothing.
 */
function walletElement(currency: 'coins' | 'gems'): Element | null {
    const picks = [
        ...document.querySelectorAll(`[data-wallet="${currency}"]`),
        ...document.querySelectorAll('[data-fx-home]')
    ]
    return picks.find(visible) ?? null
}

/** Cosmetic jitter. */
const jitter = (a: number, b: number) => a + Math.random() * (b - a)

/** Floating amounts that pop, drift up and fade; several stagger in a column. */
function float(anchor: TownFxAnchor, items: TownFxFloatItem[], opts: { big?: boolean, dy?: number } = {}) {
    if (!import.meta.client || !items.length) return
    const p = pointOf(anchor)
    const calm = isCalm()
    const shown = items.slice(0, 4)
    // Keep the pills on screen when the anchor hugs an edge (a phone, a corner button).
    const x = Math.min(Math.max(p.x, 72), window.innerWidth - 72)
    const y = Math.max(p.y + (opts.dy ?? -8), 40 + shown.length * 34)
    push({ id: ++nextId, type: 'float', x, y, items: shown, big: !!opts.big, calm }, 1_700 + shown.length * 140)
}

/** A radial pop of coins, gems or sparks that arcs out and falls under gravity. */
function burst(anchor: TownFxAnchor, opts: { kind: TownFxKind, count: number, power?: number, spread?: number }) {
    if (!import.meta.client || isCalm()) return
    const room = MAX_LIVE_PARTS - partCount()
    const count = Math.min(MAX_BURST, Math.max(0, Math.round(opts.count)), room)
    if (count <= 0) return
    const p = pointOf(anchor)
    const power = opts.power ?? 1
    // Coins and gems fountain upward; sparks fan the whole way round.
    const spread = opts.spread ?? (opts.kind === 'spark' ? Math.PI * 2 : Math.PI * 1.25)
    const parts: TownFxBurstPart[] = []
    for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1)
        parts.push({
            id: i,
            angle: -Math.PI / 2 + (t - 0.5) * spread + jitter(-0.18, 0.18),
            speed: jitter(260, 520) * power,
            spin: jitter(-540, 540),
            scale: jitter(0.75, 1.2),
            dur: jitter(820, 1_150),
            delay: jitter(0, 70)
        })
    }
    push({ id: ++nextId, type: 'burst', kind: opts.kind, x: p.x, y: p.y, gravity: opts.kind === 'spark' ? 900 : 1_500, parts }, 1_300)
}

/** Coins or gems that scatter, then arc into the target (by default the wallet). */
function fly(from: TownFxAnchor, to: TownFxTarget, kind: TownFxKind, count: number) {
    if (!import.meta.client || isCalm()) return
    const targetEl = to === 'coins' || to === 'gems'
        ? walletElement(to)
        : to instanceof Element ? to : null
    if ((to === 'coins' || to === 'gems') && !targetEl) return
    const room = MAX_LIVE_PARTS - partCount()
    const n = Math.min(MAX_FLY, Math.max(0, Math.round(count)), room)
    if (n <= 0) return
    const a = pointOf(from)
    const b = pointOf(targetEl ?? (to as TownFxAnchor))
    const parts: TownFxFlyPart[] = []
    for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2
        const r = jitter(16, 46)
        parts.push({
            id: i,
            sx: Math.cos(ang) * r,
            sy: Math.sin(ang) * r - 10,
            lift: jitter(90, 190),
            sway: jitter(-90, 90),
            dur: jitter(780, 980),
            delay: 120 + i * 48
        })
    }
    const life = 120 + n * 48 + 1_100
    push({ id: ++nextId, type: 'fly', kind, x: a.x, y: a.y, tx: b.x, ty: b.y, target: targetEl, parts }, life)
}

/** A soft radial bloom behind a big moment (a chest bursting, a bonus claimed). */
function flash(anchor: TownFxAnchor, tone: TownFxTone = 'gold', size = 260) {
    if (!import.meta.client || isCalm()) return
    const p = pointOf(anchor)
    push({ id: ++nextId, type: 'flash', x: p.x, y: p.y, tone, size }, 800)
}

export interface TownFxReward {
    coins?: number
    gems?: number
    resources?: Record<string, number>
}

/**
 * The usual celebration for a gain: floating amounts, a burst of what was won,
 * and the coins and gems flying to the wallet. `scale` grows the burst.
 */
function reward(anchor: TownFxAnchor, r: TownFxReward, opts: { scale?: number, big?: boolean, fly?: boolean } = {}) {
    if (!import.meta.client) return
    const scale = opts.scale ?? 1
    const coins = r.coins ?? 0
    const gems = r.gems ?? 0
    const goods = Object.entries(r.resources ?? {}).filter(([, q]) => q > 0)
    const items: TownFxFloatItem[] = []
    if (gems > 0) items.push({ icon: 'gem', text: `+${formatNumber(gems)}`, tone: 'gem' })
    if (coins > 0) items.push({ icon: 'coin', text: `+${formatNumber(coins)}`, tone: 'gold' })
    for (const [id, q] of goods.slice(0, 3)) items.push({ icon: id, text: `+${formatNumber(q)}`, tone: 'green' })

    // Resolve the anchor once: the element may be gone by the time a later effect runs.
    const at = pointOf(anchor)
    float(at, items, { big: opts.big })
    if (coins > 0) burst(at, { kind: 'coin', count: 9 * scale, power: Math.min(1.4, 0.85 + scale * 0.15) })
    if (gems > 0) burst(at, { kind: 'gem', count: Math.min(18, 5 + gems) * scale, power: Math.min(1.4, 0.85 + scale * 0.15) })
    if (!coins && !gems) burst(at, { kind: 'spark', count: 12 * scale, power: 0.7 })
    if (opts.fly !== false) {
        if (coins > 0) fly(at, 'coins', 'coin', 5 + 2 * scale)
        if (gems > 0) fly(at, 'gems', 'gem', Math.min(10, Math.max(3, gems)))
    }
}

export function useTownFx() {
    return { entries, float, burst, fly, flash, reward, isCalm }
}
