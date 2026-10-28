<template>
    <div class="df-bench" aria-live="polite">
        <div class="head">
            <span>Workbench</span>
            <span class="pool">{{ scrap }} scrap · {{ parts }} parts</span>
        </div>
        <ul>
            <li v-for="it in bench.items" :key="it.key" :class="{ sel: it.selected, no: !it.ok }">
                <span class="name" :style="it.tint ? { color: it.tint } : undefined">{{ it.name }}</span>
                <span class="cost">{{ it.cost }}</span>
                <div v-if="it.selected" class="why">{{ it.ok ? 'Hold F to make it' : it.why }}</div>
                <div v-if="it.selected && bench.hold > 0" class="df-seg hold" :style="{ '--p': bench.hold, '--c': '#ffd978', '--seg': '6px' }" />
            </li>
        </ul>
        <div class="foot">Scroll or ↑/↓ to pick · hold F to make it</div>
    </div>
</template>

<script setup lang="ts">
// The workbench's list, beside the prompt while you stand at one: every
// recipe and the rarity upgrade of the weapon in hand, the selected one
// marked, greyed when you can't make it (and why), the hold bar filling.
import type { DfHudArsenal } from '~/utils/dead-front/engine/arsenal-prompt'

defineProps<{ bench: NonNullable<DfHudArsenal['bench']>, scrap: number, parts: number }>()
</script>

<style scoped>
.df-bench {
    width: min(19rem, 80vw);
    padding: 8px 10px 7px;
    font-family: var(--df-font-type);
    color: var(--df-chalk);
    background: rgba(22, 26, 29, 0.86);
    box-shadow: 0 0 0 2px #000, inset 0 0 0 2px #3a3024;
}

.head {
    display: flex;
    justify-content: space-between;
    padding-bottom: 5px;
    margin-bottom: 4px;
    font-family: var(--df-font-stencil);
    font-size: 0.8rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--df-brass-hi);
    border-bottom: 2px solid #000;
}

.head .pool {
    font-family: var(--df-font-type);
    letter-spacing: 0.04em;
    text-transform: none;
    color: var(--df-chalk-2);
}

ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

li {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 8px;
    padding: 3px 6px;
    font-size: 0.82rem;
}

li.no {
    color: var(--df-chalk-3);
}

li.sel {
    background: rgba(226, 178, 79, 0.16);
    box-shadow: inset 3px 0 0 var(--df-brass-hi);
    color: var(--df-chalk);
}

li.sel.no {
    box-shadow: inset 3px 0 0 var(--df-blood-hi);
}

.cost {
    color: var(--df-chalk-2);
    font-size: 0.75rem;
}

.why {
    grid-column: 1 / -1;
    font-size: 0.72rem;
    color: var(--df-chalk-2);
}

li.sel.no .why {
    color: #ff8a70;
}

.hold {
    grid-column: 1 / -1;
    margin-top: 4px;
    height: 5px;
}

.foot {
    margin-top: 5px;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    color: var(--df-chalk-3);
    text-align: center;
}
</style>
