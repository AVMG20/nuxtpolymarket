<template>
    <div class="df-round" :class="{ intermission: phase === 'intermission' && round > 0 }">
        <div :key="roundKey" class="inner" :class="{ flash: roundKey > 1 }">
            <svg
                v-if="round > 0 && round <= 5"
                class="tally"
                viewBox="0 0 64 48"
                width="128"
                height="96"
                shape-rendering="crispEdges"
                aria-hidden="true"
            >
                <rect
                    v-for="i in Math.min(round, 4)"
                    :key="i"
                    class="bar"
                    :class="{ fresh: i === round }"
                    :x="BARS[i - 1]![0]"
                    :y="BARS[i - 1]![1]"
                    width="6"
                    :height="BARS[i - 1]![2]"
                />
                <g v-if="round === 5" class="slash">
                    <rect v-for="(b, i) in SLASH" :key="i" :x="b[0]" :y="b[1]" width="5" height="5" :style="{ animationDelay: `${350 + i * 28}ms` }" />
                </g>
            </svg>
            <div v-else-if="round > 5" class="numeral" :class="{ long: round >= 100 }">{{ round }}</div>
            <span v-if="round > 0" class="sr-only">Round {{ round }}</span>
        </div>
        <div v-if="phase === 'intermission' && round > 0 && phaseTimer > 0" class="next">
            <span class="lamp" /> Next wave <b>{{ Math.ceil(phaseTimer) }}</b>
        </div>
    </div>
</template>

<script setup lang="ts">
// The round counter, the classic way: blood-red block tallies for rounds 1-5
// (the fifth slashes across in a staircase of blocks), then big red stencil
// numerals. A new round flashes white and settles back to red.
defineProps<{
    round: number
    roundKey: number
    phase: 'intermission' | 'active'
    phaseTimer: number
}>()

// [x, y, height] per vertical stroke: slightly uneven, like they were hacked in
const BARS: [number, number, number][] = [[6, 5, 39], [19, 3, 41], [32, 6, 38], [45, 4, 40]]
const SLASH: [number, number][] = Array.from({ length: 14 }, (_, i) => [1 + i * 4.3, 37 - i * 2.4] as [number, number])
</script>

<style scoped>
.df-round {
    position: relative;
    min-height: 96px;
    min-width: 128px;
}

.inner.flash {
    animation: df-round-flash 1.8s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.tally {
    display: block;
    overflow: visible;
    filter: drop-shadow(2px 0 0 #000) drop-shadow(-2px 0 0 #000) drop-shadow(0 2px 0 #000) drop-shadow(0 -2px 0 #000) drop-shadow(0 4px 0 rgba(0, 0, 0, 0.45));
}

.tally .bar,
.tally .slash rect {
    fill: #d42a1c;
}

.tally .bar.fresh {
    transform-box: fill-box;
    transform-origin: 50% 0;
    transform: scaleY(0);
    animation: df-draw 0.6s 0.3s steps(8, end) forwards;
}

.tally .slash rect {
    opacity: 0;
    animation: df-block 0.05s steps(1, end) forwards;
}

.numeral {
    font-family: var(--df-font-stencil);
    font-weight: 700;
    font-size: 5.4rem;
    line-height: 1;
    letter-spacing: 0.02em;
    padding: 0 0.05em;
    color: #d42a1c;
    text-shadow: 3px 0 0 #000, -3px 0 0 #000, 0 3px 0 #000, 0 -3px 0 #000, 3px 3px 0 #000, -3px 3px 0 #000, 3px -3px 0 #000, -3px -3px 0 #000, 0 7px 0 rgba(0, 0, 0, 0.45);
    font-variant-numeric: tabular-nums;
}

.numeral.long {
    font-size: 4.2rem;
}

.intermission .inner {
    animation: df-pulse 1.2s steps(2, end) infinite;
}

.next {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.35rem;
    font-family: var(--df-font-stencil);
    font-size: 0.85rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #f1e8cf;
    text-shadow: var(--df-outline);
}

.next b {
    font-weight: 400;
    color: #ffb45c;
    font-variant-numeric: tabular-nums;
}

.next .lamp {
    width: 8px;
    height: 8px;
    background: #ffb45c;
    box-shadow: 0 0 0 2px #000;
    animation: df-pulse 1s steps(2, end) infinite;
}

@keyframes df-draw {
    to { transform: scaleY(1); }
}

@keyframes df-block {
    to { opacity: 1; }
}

@keyframes df-round-flash {
    0% { filter: brightness(6) saturate(0); transform: scale(1.4); opacity: 0; }
    10% { opacity: 1; }
    35% { filter: brightness(4) saturate(0.1); transform: scale(1.12); }
    60% { filter: brightness(1.6); transform: scale(1.02); }
    100% { filter: none; transform: none; }
}

@keyframes df-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
}
</style>
