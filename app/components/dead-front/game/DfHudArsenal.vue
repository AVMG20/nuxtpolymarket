<template>
    <div class="df-arsenal">
        <!-- killstreak: kills toward the next reward, rewards ready to call in -->
        <div class="streak">
            <TransitionGroup name="df-medal" tag="div" class="rewards">
                <div v-for="(r, i) in a.rewards" :key="`${r.id}${i}`" class="reward" :class="{ next: i === a.rewards.length - 1 }" :title="r.name">
                    <svg viewBox="0 0 9 9" width="22" height="22" shape-rendering="crispEdges" aria-hidden="true">
                        <rect v-for="(px, k) in ICONS[r.id]" :key="k" :x="px[0]" :y="px[1]" :width="px[2]" height="1" />
                    </svg>
                    <span v-if="i === a.rewards.length - 1" class="keycap"><b>X</b></span>
                </div>
            </TransitionGroup>
            <div class="meter">
                <span class="label">{{ a.next.name }}</span>
                <div class="df-seg bar" :style="{ '--p': streakFrac, '--c': '#e2412f', '--seg': '5px' }" />
                <span class="count">{{ a.streak }}/{{ a.next.at }}</span>
            </div>
        </div>

        <!-- gear: the deployable in hand, the plate, the field kit -->
        <div class="gear">
            <div v-if="a.equip" class="chip equip">
                <span class="keycap"><b>Q</b></span>
                <span>{{ a.equip === 'sentry' ? 'Lewis Sentry' : 'Gramophone' }}</span>
            </div>
            <div v-if="a.armor > 0" class="chip plate" title="Trench plate">
                <svg viewBox="0 0 7 7" width="14" height="14" shape-rendering="crispEdges" aria-hidden="true">
                    <rect v-for="(px, k) in PLATE" :key="k" :x="px[0]" :y="px[1]" :width="px[2]" height="1" />
                </svg>
                <div class="df-seg pbar" :style="{ '--p': a.armor, '--c': '#9fb4c8', '--seg': '4px' }" />
            </div>
            <div v-if="a.kit" class="chip kit" title="Field kit: you get yourself back up once">
                <svg viewBox="0 0 7 7" width="14" height="14" shape-rendering="crispEdges" aria-hidden="true">
                    <rect v-for="(px, k) in CROSS" :key="k" :x="px[0]" :y="px[1]" :width="px[2]" height="1" />
                </svg>
                <span>Field kit</span>
            </div>
        </div>

        <!-- salvage: your own scrap and rare parts -->
        <div :key="a.salvageKey" class="salvage" :class="{ pop: a.salvageKey > 0 }">
            <span class="item" title="Scrap">
                <svg viewBox="0 0 7 7" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true">
                    <rect v-for="(px, k) in COG" :key="k" :x="px[0]" :y="px[1]" :width="px[2]" height="1" />
                </svg>
                <b>{{ a.scrap }}</b>
            </span>
            <span class="item part" title="Rare parts">
                <svg viewBox="0 0 7 7" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true">
                    <rect v-for="(px, k) in VALVE" :key="k" :x="px[0]" :y="px[1]" :width="px[2]" height="1" />
                </svg>
                <b>{{ a.parts }}</b>
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
// Bottom-left, over the perks: the killstreak meter and the support ready to
// call in (X), the gear in hand (Q), the trench plate and field kit, and your
// own salvage. Pixel icons as [x, y, width] runs like the HUD's skull.
import type { DfHudArsenal } from '~/utils/dead-front/engine/arsenal-prompt'

const props = defineProps<{ a: DfHudArsenal }>()

type Runs = [number, number, number][]
const COG: Runs = [[2, 0, 3], [0, 1, 7], [1, 2, 2], [4, 2, 2], [0, 3, 2], [5, 3, 2], [1, 4, 2], [4, 4, 2], [0, 5, 7], [2, 6, 3]]
const VALVE: Runs = [[2, 0, 3], [3, 1, 1], [1, 2, 5], [1, 3, 5], [0, 4, 7], [1, 5, 5], [2, 6, 3]]
const PLATE: Runs = [[0, 0, 2], [5, 0, 2], [0, 1, 7], [1, 2, 5], [1, 3, 5], [1, 4, 5], [2, 5, 3], [3, 6, 1]]
const CROSS: Runs = [[2, 0, 3], [2, 1, 3], [0, 2, 7], [0, 3, 7], [0, 4, 7], [2, 5, 3], [2, 6, 3]]
const ICONS: Record<string, Runs> = {
    // a shell, a Zeppelin, a biplane
    barrage: [[4, 0, 1], [3, 1, 3], [3, 2, 3], [3, 3, 3], [3, 4, 3], [3, 5, 3], [2, 6, 5], [2, 7, 5], [3, 8, 3]],
    zeppelin: [[2, 2, 5], [0, 3, 9], [0, 4, 9], [1, 5, 7], [3, 6, 2], [0, 1, 1], [0, 6, 1]],
    strafe: [[4, 0, 1], [0, 2, 9], [3, 3, 3], [3, 4, 3], [0, 5, 9], [3, 6, 3], [2, 8, 5]]
}

const streakFrac = computed(() => {
    const span = Math.max(1, props.a.next.at - props.a.next.from)
    return Math.max(0, Math.min(1, (props.a.streak - props.a.next.from) / span))
})
</script>

<style scoped>
.df-arsenal {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    font-family: var(--df-font-type);
}

.streak {
    display: flex;
    align-items: center;
    gap: 10px;
}

.rewards {
    display: flex;
    gap: 6px;
}

.reward {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: rgba(18, 8, 6, 0.75);
    box-shadow: 0 0 0 2px #000, inset 0 0 0 2px #6b1a12;
    fill: #f1e8cf;
}

.reward.next {
    box-shadow: 0 0 0 2px #000, inset 0 0 0 2px var(--df-blood-hi), 0 0 14px rgba(226, 65, 47, 0.55);
    fill: #ffd978;
    animation: df-ars-glow 1.4s ease-in-out infinite;
}

.reward .keycap {
    position: absolute;
    right: -7px;
    bottom: -7px;
}

.meter {
    display: grid;
    grid-template-columns: auto auto;
    align-items: center;
    column-gap: 8px;
    row-gap: 3px;
}

.meter .label {
    grid-column: 1 / -1;
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--df-chalk-2);
    text-shadow: 1px 1px 0 #000;
}

.meter .bar {
    width: 120px;
    height: 6px;
}

.meter .count {
    font-size: 0.72rem;
    color: var(--df-chalk);
    text-shadow: 1px 1px 0 #000;
}

.gear {
    display: flex;
    gap: 6px;
}

.chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px 3px 5px;
    font-size: 0.75rem;
    color: var(--df-chalk);
    background: rgba(8, 10, 12, 0.7);
    box-shadow: 0 0 0 2px #000;
    fill: var(--df-chalk);
}

.chip.plate {
    fill: #9fb4c8;
}

.chip.plate .pbar {
    width: 52px;
    height: 5px;
}

.chip.kit {
    fill: #e2412f;
}

.salvage {
    display: flex;
    gap: 12px;
    padding: 3px 9px;
    background: rgba(8, 10, 12, 0.7);
    box-shadow: 0 0 0 2px #000;
}

.salvage.pop {
    animation: df-ars-pop 0.35s steps(4);
}

.salvage .item {
    display: flex;
    align-items: center;
    gap: 5px;
    fill: #c08a4a;
    color: var(--df-chalk);
    font-size: 0.9rem;
}

.salvage .part {
    fill: #7fc8ff;
}

.keycap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    font-size: 0.7rem;
    color: #1f170e;
    background: var(--df-paper);
    box-shadow: 0 0 0 2px #000, inset 0 -2px 0 var(--df-paper-3);
}

@keyframes df-ars-pop {
    0% { transform: scale(1.18); }
    100% { transform: scale(1); }
}

@keyframes df-ars-glow {
    0%, 100% { filter: brightness(1); }
    50% { filter: brightness(1.35); }
}
</style>
