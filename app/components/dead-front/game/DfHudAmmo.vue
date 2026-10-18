<template>
    <div class="df-ammo" :class="{ low: low && !ammo.reloading, reloading: ammo.reloading, pap: ammo.pap > 0 }" :style="papStyle">
        <!-- name plate with Pack-a-Punch tier blocks; pops on every weapon change -->
        <div :key="swapKey" class="plate">
            <span class="name">{{ ammo.name }}</span>
            <span v-if="ammo.pap > 0" class="gems" :aria-label="`Pack-a-Punch tier ${ammo.pap}`">
                <i v-for="i in 3" :key="i" :class="{ on: i <= ammo.pap }" :style="{ '--g': DF_PAP_COLORS[i - 1] }" />
            </span>
        </div>

        <!-- the counter -->
        <div class="counter">
            <span :key="ammo.mag" class="mag">{{ ammo.mag }}</span>
            <span class="reserve">
                <span class="sep">/</span>{{ ammo.infinite ? '∞' : ammo.reserve }}
            </span>
        </div>

        <!-- cartridges in the magazine (a block gauge for big drums) -->
        <div v-if="ammo.magSize > 0 && ammo.magSize <= 40" class="rounds" :class="{ dense: ammo.magSize > 20, big: ammo.magSize <= 10 }">
            <i v-for="i in ammo.magSize" :key="i" :class="{ spent: i > ammo.mag }" />
        </div>
        <div v-else-if="ammo.magSize > 0" class="df-seg gauge" :style="{ '--p': Math.min(1, ammo.mag / ammo.magSize), '--c': low ? '#ff5a3c' : '#ffd978', '--seg': '4px' }" />

        <div class="foot">
            <span v-if="ammo.reloading" class="hint">Reloading</span>
            <span v-else-if="ammo.mag === 0 && (ammo.reserve > 0 || ammo.infinite)" class="hint warn"><kbd class="df-key">R</kbd> Reload</span>
            <span v-else-if="ammo.mag === 0 && ammo.reserve === 0 && !ammo.infinite" class="hint warn">No ammo</span>
            <span class="grenades" :aria-label="`${grenades} grenades`">
                <svg v-for="i in grenades" :key="i" viewBox="0 0 7 10" width="14" height="20" shape-rendering="crispEdges" aria-hidden="true">
                    <path class="pin" d="M2 0h3v1H2zM5 1h1v2H5z" />
                    <path class="body" d="M2 1h3v1h1v1h1v6H6v1H1V9H0V3h1V2h1z" />
                    <path class="mesh" d="M1 5h5v1H1zM3 3h1v6H3z" />
                </svg>
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
// Bottom-right ammo: the weapon's name plate (with Pack-a-Punch tier blocks),
// a big magazine count over the reserve, and the cartridges left as blocks.
import { DF_PAP_COLORS } from '#shared/utils/dead-front/weapons'
import type { DfHudState } from '~/utils/dead-front/engine/hud'

const props = defineProps<{
    ammo: DfHudState['ammo']
    grenades: number
    low: boolean
    swapKey: number
}>()

const papStyle = computed(() => (props.ammo.pap > 0 ? { '--pap': DF_PAP_COLORS[Math.min(3, props.ammo.pap) - 1] } : {}))
</script>

<style scoped>
.df-ammo {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
}

.plate {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.28rem 0.6rem 0.24rem;
    color: #261a05;
    background: #e2b24f;
    box-shadow: 0 -2px 0 #000, 0 2px 0 #000, -2px 0 0 #000, 2px 0 0 #000, inset 0 2px 0 rgba(255, 250, 220, 0.6), inset 0 -3px 0 rgba(110, 70, 10, 0.5);
    animation: df-plate 0.35s cubic-bezier(0.2, 1.6, 0.4, 1);
}

.pap .plate {
    background: color-mix(in srgb, var(--pap) 55%, #e2b24f);
}

.name {
    max-width: 15rem;
    overflow: hidden;
    font-family: var(--df-font-stencil);
    font-size: 0.86rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.gems {
    display: inline-flex;
    gap: 3px;
}

.gems i {
    width: 8px;
    height: 8px;
    background: rgba(40, 25, 5, 0.35);
    box-shadow: 0 0 0 1px #261a05;
}

.gems i.on {
    background: var(--g);
}

.counter {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    line-height: 1;
}

.mag {
    display: inline-block;
    font-family: var(--df-font-stencil);
    font-size: 3.2rem;
    color: #fff;
    font-variant-numeric: tabular-nums;
    text-shadow: 3px 0 0 #000, -3px 0 0 #000, 0 3px 0 #000, 0 -3px 0 #000, 3px 3px 0 #000, -3px 3px 0 #000, 3px -3px 0 #000, -3px -3px 0 #000, 0 6px 0 rgba(0, 0, 0, 0.45);
    animation: df-tick 0.12s steps(2, end);
}

.pap .mag {
    color: color-mix(in srgb, var(--pap) 35%, #fff);
}

.low .mag {
    color: #ff5a3c;
    animation: df-low 0.7s steps(2, end) infinite;
}

.reloading .mag {
    opacity: 0.4;
}

.reserve {
    font-family: var(--df-font-stencil);
    font-size: 1.5rem;
    color: #d8ccac;
    font-variant-numeric: tabular-nums;
    text-shadow: var(--df-outline);
}

.sep {
    margin-right: 0.2rem;
    color: #8f866c;
}

.rounds {
    display: flex;
    flex-wrap: wrap-reverse;
    justify-content: flex-end;
    gap: 2px;
    max-width: 13rem;
    padding: 2px;
    background: rgba(0, 0, 0, 0.45);
}

.rounds i {
    width: 4px;
    height: 12px;
    background: linear-gradient(180deg, #ffe6a0 0 3px, #d39a36 3px);
    transition: opacity 0.1s;
}

.rounds.big i {
    width: 7px;
    height: 18px;
    background: linear-gradient(180deg, #ffe6a0 0 5px, #d39a36 5px);
}

.rounds.dense i {
    width: 3px;
    height: 9px;
}

.rounds i.spent {
    opacity: 0.16;
}

.gauge {
    width: 11rem;
    height: 7px;
}

.foot {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    min-height: 22px;
}

.grenades {
    display: flex;
    gap: 4px;
    filter: drop-shadow(1px 0 0 #000) drop-shadow(-1px 0 0 #000) drop-shadow(0 1px 0 #000) drop-shadow(0 -1px 0 #000);
}

.grenades .body {
    fill: #6d7446;
}

.grenades .mesh {
    fill: #3f4426;
}

.grenades .pin {
    fill: #c9b27a;
}

.hint {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--df-font-stencil);
    font-size: 0.85rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #e2d8bc;
    text-shadow: var(--df-outline);
}

.hint .df-key {
    font-size: 0.75rem;
    text-shadow: none;
}

.hint.warn {
    color: #ff5a3c;
    animation: df-low 0.9s steps(2, end) infinite;
}

@keyframes df-tick {
    0% { transform: translateY(-4px); }
    100% { transform: none; }
}

@keyframes df-plate {
    0% { transform: translateX(14px) scale(1.1); opacity: 0; }
    100% { transform: none; opacity: 1; }
}

@keyframes df-low {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
}
</style>
