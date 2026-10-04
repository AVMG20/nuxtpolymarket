<script setup lang="ts">
// The town's reward effects layer: one fixed, click-through sheet over every
// window, drained from useTownFx's queue. Every effect animates transform and
// opacity only, through the Web Animations API, and removes itself.
import TownAsset from '~/components/town/TownAsset.vue'
import TownCoin from '~/components/town/TownCoin.vue'
import type { TownFxBurstPart, TownFxEntry, TownFxFlyPart } from '~/composables/useTownFx'

const { entries } = useTownFx()
const sound = useTownSound()

/** Elements already animated: a re-render calls the function refs again. */
const started = new WeakSet<Element>()

function once(el: unknown): el is HTMLElement {
    if (!(el instanceof HTMLElement) || started.has(el)) return false
    started.add(el)
    return true
}

const round = (n: number) => Math.round(n * 10) / 10

function at(e: { x: number, y: number }) {
    return { transform: `translate3d(${Math.round(e.x)}px, ${Math.round(e.y)}px, 0)` }
}

// ── Float ──
function animFloat(el: unknown, e: Extract<TownFxEntry, { type: 'float' }>, i: number) {
    if (!once(el)) return
    const delay = i * 140
    if (e.calm) {
        el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: 1_400, delay, fill: 'both' })
        return
    }
    el.animate([
        { opacity: 0, transform: 'translate3d(0, 14px, 0) scale(0.55)' },
        { opacity: 1, transform: 'translate3d(0, -4px, 0) scale(1.14)', offset: 0.14, easing: 'cubic-bezier(.2, .8, .3, 1)' },
        { opacity: 1, transform: 'translate3d(0, -10px, 0) scale(1)', offset: 0.26 },
        { opacity: 1, transform: 'translate3d(0, -30px, 0) scale(1)', offset: 0.72 },
        { opacity: 0, transform: 'translate3d(0, -52px, 0) scale(0.96)' }
    ], { duration: 1_550, delay, fill: 'both', easing: 'linear' })
}

// ── Burst ──
function animBurst(el: unknown, e: Extract<TownFxEntry, { type: 'burst' }>, p: TownFxBurstPart) {
    if (!once(el)) return
    const vx = Math.cos(p.angle) * p.speed
    const vy = Math.sin(p.angle) * p.speed
    const frames: Keyframe[] = []
    const steps = 10
    for (let k = 0; k <= steps; k++) {
        const f = k / steps
        const t = (f * p.dur) / 1_000
        const x = vx * t
        const y = vy * t + 0.5 * e.gravity * t * t
        const s = k === 0 ? 0.3 : p.scale * (f > 0.7 ? 1 - (f - 0.7) * 1.2 : 1)
        frames.push({
            offset: f,
            opacity: f > 0.72 ? Math.max(0, 1 - (f - 0.72) / 0.28) : 1,
            transform: `translate3d(${round(x)}px, ${round(y)}px, 0) rotate(${round(p.spin * t)}deg) scale(${round(s * 100) / 100})`
        })
    }
    el.animate(frames, { duration: p.dur, delay: p.delay, fill: 'both', easing: 'linear' })
}

// ── Fly ──
let lastBump = 0
let landStreak = 0
let landStreakAt = 0

function bump(target: Element | null) {
    if (!(target instanceof HTMLElement)) return
    const now = performance.now()
    if (now - lastBump < 110) return
    lastBump = now
    if (getComputedStyle(target).display === 'inline') return
    target.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(1.16)', offset: 0.35 },
        { transform: 'scale(1)' }
    ], { duration: 260, easing: 'ease-out' })
}

function land(e: Extract<TownFxEntry, { type: 'fly' }>) {
    const now = performance.now()
    landStreak = now - landStreakAt < 400 ? landStreak + 1 : 0
    landStreakAt = now
    // Each coin landing pings a touch higher, so a stream reads as filling up.
    sound.play('land', Math.pow(2, Math.min(12, landStreak) / 12) * (e.kind === 'gem' ? 1.25 : 1))
    bump(e.target)
}

function animFly(el: unknown, e: Extract<TownFxEntry, { type: 'fly' }>, p: TownFxFlyPart) {
    if (!once(el)) return
    if (p.id === 0) sound.play('whoosh')
    const dx = e.tx - e.x
    const dy = e.ty - e.y
    // Scatter out from the source, hang a beat, then arc home on a quadratic curve.
    const sx = p.sx
    const sy = p.sy
    const cx = sx + (dx - sx) * 0.5 + p.sway
    const cy = Math.min(sy, dy) - p.lift
    const frames: Keyframe[] = [
        { offset: 0, opacity: 0, transform: 'translate3d(0, 0, 0) scale(0.4)' },
        { offset: 0.16, opacity: 1, transform: `translate3d(${round(sx)}px, ${round(sy)}px, 0) scale(1.1)`, easing: 'ease-out' },
        { offset: 0.26, opacity: 1, transform: `translate3d(${round(sx)}px, ${round(sy - 4)}px, 0) scale(1)` }
    ]
    const steps = 9
    for (let k = 1; k <= steps; k++) {
        const t = k / steps
        // Ease in along the path: slow off the hang, fast into the wallet.
        const u = t * t * (3 - 2 * t) * 0.35 + t * t * 0.65
        const x = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cx + u * u * dx
        const y = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cy + u * u * dy
        const s = 1 - u * 0.45
        frames.push({
            offset: 0.26 + 0.74 * t,
            opacity: t > 0.92 ? 0.2 : 1,
            transform: `translate3d(${round(x)}px, ${round(y)}px, 0) scale(${round(s * 100) / 100})`
        })
    }
    const anim = el.animate(frames, { duration: p.dur, delay: p.delay, fill: 'both', easing: 'linear' })
    anim.onfinish = () => {
        el.style.visibility = 'hidden'
        land(e)
    }
}

// ── Flash ──
function animFlash(el: unknown) {
    if (!once(el)) return
    el.animate([
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.2)' },
        { opacity: 0.95, transform: 'translate(-50%, -50%) scale(0.9)', offset: 0.25 },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6)' }
    ], { duration: 700, fill: 'both', easing: 'ease-out' })
}
</script>

<template>
    <div class="tfx" aria-hidden="true">
        <template v-for="e in entries" :key="e.id">
            <div v-if="e.type === 'float'" class="tfx-at" :style="at(e)">
                <div class="tfx-stack" :class="{ 'is-big': e.big }">
                    <span
                        v-for="(it, i) in e.items"
                        :key="i"
                        :ref="(el) => animFloat(el, e, i)"
                        class="tfx-pill"
                        :class="`tone-${it.tone ?? 'gold'}`"
                    >
                        <TownCoin v-if="it.icon === 'coin'" />
                        <UIcon v-else-if="it.icon === 'gem'" name="i-lucide-gem" class="tfx-gem" />
                        <TownAsset v-else-if="it.icon" :id="it.icon" class="tfx-asset" />
                        {{ it.text }}
                    </span>
                </div>
            </div>

            <div v-else-if="e.type === 'flash'" class="tfx-at" :style="at(e)">
                <span :ref="(el) => animFlash(el)" class="tfx-flash" :class="`tone-${e.tone}`" :style="{ width: `${e.size}px`, height: `${e.size}px` }" />
            </div>

            <div v-else class="tfx-at" :style="at(e)">
                <span
                    v-for="p in e.parts"
                    :key="p.id"
                    :ref="(el) => e.type === 'burst' ? animBurst(el, e, p as TownFxBurstPart) : animFly(el, e, p as TownFxFlyPart)"
                    class="tfx-part"
                    :class="`kind-${e.kind}`"
                >
                    <TownCoin v-if="e.kind === 'coin'" />
                    <UIcon v-else-if="e.kind === 'gem'" name="i-lucide-gem" />
                    <i v-else />
                </span>
            </div>
        </template>
    </div>
</template>

<style scoped>
/* Above every window and backdrop (z 20 to 25) and the chest reveal. */
.tfx {
    position: fixed;
    inset: 0;
    z-index: 90;
    pointer-events: none;
    overflow: hidden;
    contain: layout style;
}
.tfx-at {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
}

/* Floating amounts */
.tfx-stack {
    position: absolute;
    left: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    transform: translateX(-50%);
}
.tfx-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 11px 4px 9px;
    border-radius: 999px;
    background: var(--g-bg-2);
    border: 1px solid color-mix(in srgb, currentColor 35%, var(--g-line));
    box-shadow: var(--g-shadow), 0 0 18px color-mix(in srgb, currentColor 25%, transparent);
    font-size: 15px;
    font-weight: 800;
    line-height: 1.2;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    opacity: 0;
    will-change: transform, opacity;
}
.tfx-stack.is-big .tfx-pill { font-size: 20px; padding: 6px 14px 6px 11px; }
.tfx-pill.tone-gold { color: var(--g-gold); }
.tfx-pill.tone-gem { color: var(--g-gem); }
.tfx-pill.tone-green { color: var(--g-green); }
.tfx-gem { width: 1em; height: 1em; }
.tfx-asset { width: 1.3em; height: 1.3em; }

/* Particles */
.tfx-part {
    position: absolute;
    left: -10px;
    top: -10px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    opacity: 0;
    will-change: transform, opacity;
}
.tfx-part.kind-gem { color: var(--g-gem); }
.tfx-part.kind-coin :deep(.town-coin) { width: 20px; height: 20px; }
.tfx-part.kind-spark i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--g-gold);
    transform: rotate(45deg);
    box-shadow: 0 0 6px color-mix(in srgb, var(--g-gold) 70%, transparent);
}
.tfx-part.kind-spark:nth-child(3n) i { background: var(--g-gem); }

/* Bloom */
.tfx-flash {
    position: absolute;
    left: 0;
    top: 0;
    border-radius: 50%;
    opacity: 0;
    will-change: transform, opacity;
}
.tfx-flash.tone-gold { background: radial-gradient(circle, color-mix(in srgb, white 70%, var(--g-gold)) 0%, color-mix(in srgb, var(--g-gold) 45%, transparent) 35%, transparent 70%); }
.tfx-flash.tone-gem { background: radial-gradient(circle, color-mix(in srgb, white 70%, var(--g-gem)) 0%, color-mix(in srgb, var(--g-gem) 45%, transparent) 35%, transparent 70%); }
.tfx-flash.tone-green { background: radial-gradient(circle, color-mix(in srgb, white 70%, var(--g-green)) 0%, color-mix(in srgb, var(--g-green) 45%, transparent) 35%, transparent 70%); }
</style>
