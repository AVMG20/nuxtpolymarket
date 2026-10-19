<template>
    <div class="df-hitpops" aria-hidden="true">
        <div
            v-for="p in pops"
            :key="p.id"
            class="anchor"
            :style="{
                'transform': `translate(var(--df-hp${p.slot}-x, -100px), var(--df-hp${p.slot}-y, -100px))`,
                'opacity': `var(--df-hp${p.slot}-on, 0)`
            }"
        >
            <span class="pop" :class="[p.kind, { gold: p.gold }]" :style="{ '--dx': `${p.dx * 22}px` }">+{{ p.amount }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
// Classic zombies hit points: a "+10" (kills "+60"/"+100"/"+130") that pops off
// the zombie where it was hit and floats up. The engine places slot i every
// frame through --df-hp{i}-x/-y/-on on the HUD root; the rise and fade are CSS.
import type { DfHudHitPop } from '~/utils/dead-front/engine/hud'

defineProps<{ pops: DfHudHitPop[] }>()
</script>

<style scoped>
.df-hitpops {
    position: fixed;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
}

.anchor {
    position: fixed;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    will-change: transform;
}

.pop {
    position: absolute;
    left: 0;
    bottom: 0;
    font-family: var(--df-font-stencil);
    font-size: 1.05rem;
    letter-spacing: 0.04em;
    line-height: 1;
    color: #f6efdc;
    text-shadow: var(--df-outline);
    white-space: nowrap;
    animation: df-hitpop 1s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
}

.pop.kill {
    font-size: 1.4rem;
    color: #ffe9a8;
    animation-name: df-hitpop-big;
}

.pop.head {
    font-size: 1.55rem;
    color: #ffc23a;
    animation-name: df-hitpop-big;
}

.pop.gold {
    color: #ffd23f;
}

@keyframes df-hitpop {
    0% { transform: translate(-50%, 0) scale(0.5); opacity: 0; }
    12% { transform: translate(calc(-50% + var(--dx) * 0.2), -10px) scale(1.2); opacity: 1; }
    24% { transform: translate(calc(-50% + var(--dx) * 0.35), -16px) scale(1); opacity: 1; }
    100% { transform: translate(calc(-50% + var(--dx)), -56px) scale(0.9); opacity: 0; }
}

@keyframes df-hitpop-big {
    0% { transform: translate(-50%, 0) scale(0.4); opacity: 0; }
    14% { transform: translate(calc(-50% + var(--dx) * 0.2), -14px) scale(1.45); opacity: 1; }
    28% { transform: translate(calc(-50% + var(--dx) * 0.35), -22px) scale(1); opacity: 1; }
    100% { transform: translate(calc(-50% + var(--dx)), -70px) scale(1); opacity: 0; }
}
</style>
