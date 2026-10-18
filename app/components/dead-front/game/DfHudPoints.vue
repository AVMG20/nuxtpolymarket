<template>
    <div class="df-points">
        <div
            v-for="p in players"
            :key="p.pid"
            class="row"
            :class="{ me: p.me, down: p.life === 'down', dead: p.life === 'dead' || !p.connected }"
            :style="{ '--c': p.color }"
        >
            <span class="pops">
                <span
                    v-for="pop in popsFor(p.pid)"
                    :key="pop.id"
                    class="pop"
                    :class="{ gold: pop.gold, neg: pop.amount < 0, big: Math.abs(pop.amount) >= 50 }"
                    :style="{ '--dx': `${pop.dx * 14}px` }"
                >{{ pop.amount > 0 ? '+' : '' }}{{ pop.amount }}</span>
            </span>
            <span class="name">
                <svg v-if="p.life === 'down'" class="cross" viewBox="0 0 5 5" width="10" height="10" shape-rendering="crispEdges" aria-label="down"><path d="M2 0h1v2h2v1H3v2H2V3H0V2h2z" /></svg>
                {{ p.name }}
            </span>
            <span :key="`${p.pid}-${bumpKey(p.pid, p.points)}`" class="score">{{ p.points.toLocaleString('en-US') }}</span>
            <span class="chip" aria-hidden="true" />
        </div>
    </div>
</template>

<script setup lang="ts">
// Squad points, bottom right: a block chip in each soldier's colour, the
// score in stencil numerals and the classic floating "+10" (kills pop bigger).
import type { DfHudPlayer, DfHudPopup } from '~/utils/dead-front/engine/hud'

const props = defineProps<{
    players: DfHudPlayer[]
    popups: DfHudPopup[]
}>()

function popsFor(pid: number): DfHudPopup[] {
    return props.popups.filter(p => p.pid === pid)
}

// Re-key the score on gains so it gives a little bump (not on every 20 Hz tick).
const last = new Map<number, { points: number, key: number }>()
function bumpKey(pid: number, points: number): number {
    const prev = last.get(pid)
    if (!prev) {
        last.set(pid, { points, key: 0 })
        return 0
    }
    if (points > prev.points) prev.key++
    prev.points = points
    return prev.key
}
</script>

<style scoped>
.df-points {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
}

.row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.15rem 0.5rem 0.1rem 0.8rem;
    background: var(--df-hud-bg);
    box-shadow: 0 -2px 0 #000, 0 2px 0 #000, -2px 0 0 #000, 2px 0 0 #000;
    transition: opacity 0.3s;
}

.row.dead {
    opacity: 0.4;
}

.chip {
    align-self: stretch;
    width: 8px;
    margin: -0.15rem -0.5rem -0.1rem 0;
    background: var(--c);
    box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.35), inset 0 -3px 0 rgba(0, 0, 0, 0.35);
}

.name {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    max-width: 8rem;
    overflow: hidden;
    font-family: var(--df-font-type);
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--c) 45%, #f1e8cf);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.cross {
    fill: #ff3b24;
}

.row.down .cross {
    animation: df-blink 0.8s steps(2) infinite;
}

.score {
    min-width: 4.2rem;
    font-family: var(--df-font-stencil);
    font-size: 1.35rem;
    line-height: 1.15;
    letter-spacing: 0.04em;
    text-align: right;
    color: #f6efdc;
    font-variant-numeric: tabular-nums;
    animation: df-bump 0.22s steps(3, end);
}

.row.me {
    padding: 0.2rem 0.6rem 0.15rem 0.9rem;
}

.row.me .score {
    font-size: 1.9rem;
    color: #fff;
}

.row.me .chip {
    width: 10px;
    margin: -0.2rem -0.6rem -0.15rem 0;
}

.pops {
    position: absolute;
    right: 100%;
    top: 0;
    width: 0;
    height: 100%;
    pointer-events: none;
}

.pop {
    position: absolute;
    right: 0.5rem;
    top: 0.1rem;
    font-family: var(--df-font-stencil);
    font-size: 1.15rem;
    letter-spacing: 0.04em;
    color: #f6efdc;
    text-shadow: var(--df-outline);
    white-space: nowrap;
    animation: df-pop 1.2s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
}

.pop.big {
    font-size: 1.5rem;
    color: color-mix(in srgb, var(--c) 35%, #fff);
    animation-name: df-pop-big;
}

.pop.gold {
    color: #ffd23f;
}

.pop.neg {
    color: #ff5a3c;
}

@keyframes df-pop {
    0% { transform: translate(0, 6px) scale(0.5); opacity: 0; }
    10% { transform: translate(calc(var(--dx) * 0.3), -2px) scale(1.25); opacity: 1; }
    20% { transform: translate(calc(var(--dx) * 0.4), -4px) scale(1); }
    100% { transform: translate(calc(var(--dx) - 30px), -30px) scale(0.9); opacity: 0; }
}

@keyframes df-pop-big {
    0% { transform: translate(0, 6px) scale(0.4); opacity: 0; }
    12% { transform: translate(calc(var(--dx) * 0.3), -4px) scale(1.5); opacity: 1; }
    24% { transform: translate(calc(var(--dx) * 0.4), -6px) scale(1); }
    100% { transform: translate(calc(var(--dx) - 40px), -38px) scale(1); opacity: 0; }
}

@keyframes df-bump {
    0% { transform: scale(1.14); color: #ffd978; }
    100% { transform: none; }
}

@keyframes df-blink {
    to { visibility: hidden; }
}
</style>
