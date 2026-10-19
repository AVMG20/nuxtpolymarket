<template>
    <div class="df-markers" aria-hidden="true">
        <div
            v-for="(m, i) in markers"
            :key="m.key"
            class="mk"
            :class="m.kind"
            :style="{
                'transform': `translate(calc(var(--df-mk${i}-x, -100px) - 50%), calc(var(--df-mk${i}-y, -100px) - 50%))`,
                '--on': `var(--df-mk${i}-on, 1)`,
                '--ang': `var(--df-mk${i}-ang, 0)`
            }"
        >
            <div class="pip">
                <svg v-if="m.kind === 'zombie'" viewBox="0 0 7 7" width="14" height="14" shape-rendering="crispEdges">
                    <path class="rim" d="M1 0h5v1h1v4H6v2H1V5H0V1h1z" />
                    <path class="face" d="M2 1h3v1h1v2H5v1H2V4H1V2h1zM2 2v1h1V2zM4 2v1h1V2z" />
                </svg>
                <svg v-else viewBox="0 0 7 7" width="16" height="16" shape-rendering="crispEdges">
                    <path class="rim" d="M2 0h3v2h2v3H5v2H2V5H0V2h2z" />
                    <path class="cross" d="M3 1h1v2h2v1H4v2H3V4H1V3h2z" />
                </svg>
                <i class="arrow" />
            </div>
            <div v-if="m.kind === 'revive'" class="lbl">{{ m.label }} · {{ m.distance }} m</div>
            <div v-else class="lbl dim">{{ m.distance }} m</div>
        </div>
    </div>
</template>

<script setup lang="ts">
// Edge-clamped markers for the last zombies of a round and downed teammates.
// The engine positions marker i through --df-mk{i}-x/-y/-on/-ang on the HUD
// root (like the objective waypoint); off screen they hug the edge and point.
import type { DfHudMarker } from '~/utils/dead-front/engine/hud'

defineProps<{ markers: DfHudMarker[] }>()
</script>

<style scoped>
.df-markers {
    position: fixed;
    inset: 0;
    pointer-events: none;
}

.mk {
    position: fixed;
    left: 0;
    top: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    will-change: transform;
    animation: df-mk-in 0.25s steps(3, end);
}

.pip {
    position: relative;
    filter: drop-shadow(2px 2px 0 rgba(0, 0, 0, 0.7));
}

.pip svg {
    display: block;
}

.rim {
    fill: #000;
}

.zombie .face {
    fill: #e2412f;
}

.zombie {
    opacity: calc(0.55 + (1 - var(--on)) * 0.35);
}

.revive .cross {
    fill: #8fe07f;
}

.revive .pip {
    animation: df-mk-pulse 0.9s steps(2, end) infinite;
}

.arrow {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0;
    height: 0;
    border-left: 6px solid #f1e8cf;
    border-top: 4px solid transparent;
    border-bottom: 4px solid transparent;
    opacity: calc(1 - var(--on));
    transform: translate(-50%, -50%) rotate(calc(var(--ang) * 1rad)) translateX(14px);
}

.zombie .arrow {
    border-left-color: #e2412f;
}

.revive .arrow {
    border-left-color: #8fe07f;
}

.lbl {
    margin-top: 2px;
    padding: 0 0.25rem;
    font-family: var(--df-font-stencil);
    font-size: 0.66rem;
    letter-spacing: 0.06em;
    color: #8fe07f;
    background: rgba(0, 0, 0, 0.65);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}

.lbl.dim {
    color: #e8a090;
}

@keyframes df-mk-in {
    from { opacity: 0; }
}

@keyframes df-mk-pulse {
    50% { transform: scale(1.18); }
}

@media (prefers-reduced-motion: reduce) {
    .revive .pip {
        animation: none;
    }
}
</style>
