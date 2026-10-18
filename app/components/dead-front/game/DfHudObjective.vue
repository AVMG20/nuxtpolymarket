<template>
    <div>
        <Transition name="df-obj">
            <div v-if="objective.visible" :key="objective.step" class="df-orders">
                <div class="head">
                    <span>Orders</span>
                    <span class="pips" :aria-label="`Step ${stepNo} of ${STEPS.length - 1}`">
                        <i v-for="(s, i) in STEPS.slice(0, -1)" :key="s" :class="{ done: i < stepNo - 1, now: i === stepNo - 1 }" />
                    </span>
                </div>
                <div class="text">{{ text }}</div>
                <div v-if="objective.fuses" class="fuses">
                    <svg
                        v-for="i in fuseTotal"
                        :key="i"
                        class="fuse"
                        :class="{ on: i <= fuseFound }"
                        viewBox="0 0 5 9"
                        width="10"
                        height="18"
                        shape-rendering="crispEdges"
                        aria-hidden="true"
                    >
                        <path class="cap" d="M1 0h3v1H1zM1 8h3v1H1z" />
                        <path class="glass" d="M0 1h5v7H0z" />
                        <path class="wire" d="M2 2h1v2h1v1H3v2H2V5H1V4h1z" />
                    </svg>
                    <span class="count">{{ objective.fuses }}</span>
                </div>
                <div v-if="objective.charge !== null" class="df-seg charge" :style="{ '--p': objective.charge, '--c': '#7f93ff', '--seg': '6px' }" />
                <div v-if="objective.hasTarget && objective.label" class="where">
                    <span class="arrow" aria-hidden="true" />{{ objective.label }} · {{ objective.distance }} m
                </div>
            </div>
        </Transition>

        <!-- 3D waypoint, positioned by the engine through CSS variables -->
        <div v-if="objective.visible && objective.hasTarget" class="df-waypoint">
            <div class="marker">
                <svg viewBox="0 0 9 9" width="22" height="22" shape-rendering="crispEdges" aria-hidden="true">
                    <path class="rim" d="M4 0h1v1h1v1h1v1h1v1h1v1H8v1H7v1H6v1H5v1H4V8H3V7H2V6H1V5H0V4h1V3h1V2h1V1h1z" />
                    <path class="core" d="M4 2h1v1h1v1h1v1H6v1H5v1H4V6H3V5H2V4h1V3h1z" />
                </svg>
                <div class="arrow" />
            </div>
            <div class="dist">{{ objective.distance }} m</div>
        </div>
    </div>
</template>

<script setup lang="ts">
// The easter-egg objective: a compact orders panel (step pips, the current
// step, fuses and the generator's charge) plus the block waypoint the engine
// positions through --df-wp-* variables.
import type { DfHudState } from '~/utils/dead-front/engine/hud'

const props = defineProps<{ objective: DfHudState['objective'] }>()

const STEPS = ['power', 'fuses', 'install', 'charge', 'claim', 'done']
const stepNo = computed(() => STEPS.indexOf(props.objective.step) + 1)
const text = computed(() => props.objective.text.trim().replace(/[.!]+$/, ''))
const fuseFound = computed(() => Number((props.objective.fuses ?? '0/3').split('/')[0]) || 0)
const fuseTotal = computed(() => Number((props.objective.fuses ?? '0/3').split('/')[1]) || 3)
</script>

<style scoped>
.df-orders {
    width: 16.5rem;
    max-width: 40vw;
    padding-bottom: 0.55rem;
    background: var(--df-hud-bg);
    box-shadow: 0 -3px 0 #000, 0 3px 0 #000, -3px 0 0 #000, 3px 0 0 #000;
}

.head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0.6rem 0.2rem;
    font-family: var(--df-font-stencil);
    font-size: 0.72rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: #fff2dc;
    background: #a8241a;
    box-shadow: inset 0 2px 0 rgba(255, 170, 140, 0.35), inset 0 -3px 0 rgba(60, 0, 0, 0.45);
}

.pips {
    display: flex;
    gap: 3px;
}

.pips i {
    width: 8px;
    height: 8px;
    background: rgba(0, 0, 0, 0.45);
}

.pips i.done {
    background: #ffd978;
}

.pips i.now {
    background: #fff;
    animation: df-blink 1s steps(2) infinite;
}

.text {
    padding: 0.5rem 0.65rem 0;
    font-family: var(--df-font-type);
    font-size: 0.88rem;
    line-height: 1.3;
    color: #f1e8cf;
}

.fuses {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 0.45rem 0.65rem 0;
}

.fuse .cap {
    fill: #8a7a58;
}

.fuse .glass {
    fill: #1d2430;
}

.fuse .wire {
    fill: #3b4a6a;
}

.fuse.on .glass {
    fill: #7f93ff;
}

.fuse.on .wire {
    fill: #fff;
}

.fuse.on {
    animation: df-fuse 0.4s steps(3, end);
}

.count {
    margin-left: 0.3rem;
    font-family: var(--df-font-stencil);
    font-size: 0.9rem;
    color: #b9c4ff;
    font-variant-numeric: tabular-nums;
}

.charge {
    height: 7px;
    margin: 0.6rem 0.65rem 0.1rem;
}

.where {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.45rem 0.65rem 0;
    font-family: var(--df-font-stencil);
    font-size: 0.72rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #ffd978;
}

.where .arrow {
    width: 6px;
    height: 6px;
    background: #ffd978;
    transform: rotate(45deg);
}

.df-waypoint {
    position: fixed;
    left: 0;
    top: 0;
    transform: translate(calc(var(--df-wp-x, -100px) - 50%), calc(var(--df-wp-y, -100px) - 50%));
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
    will-change: transform;
}

.marker {
    position: relative;
    animation: df-wp 1.6s steps(2, end) infinite;
}

.marker svg {
    display: block;
    filter: drop-shadow(2px 2px 0 rgba(0, 0, 0, 0.7));
}

.rim {
    fill: #000;
}

.core {
    fill: #ffd978;
}

.arrow {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0;
    height: 0;
    border-left: 8px solid #ffd978;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    opacity: calc(1 - var(--df-wp-on, 1));
    transform: translate(-50%, -50%) rotate(calc(var(--df-wp-ang, 0) * 1rad)) translateX(19px);
}

.dist {
    margin-top: 3px;
    padding: 0.05rem 0.3rem;
    font-family: var(--df-font-stencil);
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    color: #ffd978;
    background: rgba(0, 0, 0, 0.7);
    font-variant-numeric: tabular-nums;
}

@keyframes df-wp {
    0%, 100% { transform: none; }
    50% { transform: translateY(-2px); }
}

@keyframes df-fuse {
    0% { transform: scale(1.6); }
    100% { transform: none; }
}

@keyframes df-blink {
    to { visibility: hidden; }
}

.df-obj-enter-active {
    animation: df-obj-in 0.4s cubic-bezier(0.2, 1.4, 0.3, 1);
}

.df-obj-leave-active {
    transition: opacity 0.25s, transform 0.25s steps(3);
}

.df-obj-leave-to {
    opacity: 0;
    transform: translateX(-24px);
}

@keyframes df-obj-in {
    0% { transform: translateX(-30px); opacity: 0; }
    100% { transform: none; opacity: 1; }
}
</style>
