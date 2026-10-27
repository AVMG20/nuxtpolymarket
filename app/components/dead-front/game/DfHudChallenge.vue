<template>
    <div class="df-challenge" :class="{ done: c.done }">
        <span class="tag">{{ c.done ? 'Done' : 'Challenge' }}</span>
        <span class="text">{{ c.text }}</span>
        <span class="n">{{ c.n }}/{{ c.goal }}</span>
        <div class="df-seg bar" :style="{ '--p': Math.min(1, c.n / Math.max(1, c.goal)), '--c': c.done ? '#8ab052' : '#e2b24f', '--seg': '4px' }" />
    </div>
</template>

<script setup lang="ts">
// The round's challenge under the objective tracker: what to do, how far the
// squad has got, green once it has paid out.
import type { DfHudArsenal } from '~/utils/dead-front/engine/arsenal-prompt'

defineProps<{ c: NonNullable<DfHudArsenal['challenge']> }>()
</script>

<style scoped>
.df-challenge {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    column-gap: 8px;
    row-gap: 4px;
    width: min(17rem, 60vw);
    margin-top: 10px;
    padding: 5px 9px 6px;
    font-family: var(--df-font-type);
    font-size: 0.78rem;
    color: var(--df-chalk);
    background: rgba(8, 10, 12, 0.7);
    box-shadow: 0 0 0 2px #000;
}

.tag {
    font-family: var(--df-font-stencil);
    font-size: 0.66rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--df-brass-hi);
}

.done .tag {
    color: var(--df-moss);
}

.n {
    color: var(--df-chalk-2);
}

.bar {
    grid-column: 1 / -1;
    height: 5px;
}
</style>
