<script setup lang="ts">
import type { Cost, Resources } from '#shared/utils/holdfast/config'
import { costEntries } from '#shared/utils/holdfast/sim'
import { RESOURCE_META, shortAmount } from '~/utils/holdfast/ui'

const props = defineProps<{ cost: Cost, have?: Resources, size?: 'xs' | 'sm', stack?: boolean }>()

const entries = computed(() => costEntries(props.cost).map(([res, amount]) => ({
    res,
    amount,
    short: !!props.have && props.have[res] + 1e-9 < amount
})))
</script>

<template>
    <span
        class="hf-cost inline-flex tabular-nums"
        :class="[
            stack ? 'flex-col items-start gap-px' : 'flex-wrap items-center gap-x-2 gap-y-0.5',
            size === 'sm' ? 'text-xs' : 'text-[10.5px]'
        ]"
    >
        <span v-if="entries.length === 0" class="font-semibold text-(--hf-muted)">Free</span>
        <span
            v-for="e in entries"
            :key="e.res"
            class="inline-flex items-center gap-[3px] font-semibold leading-none"
            :class="e.short ? 'hf-cost-short' : 'text-(--hf-text)'"
        >
            <UIcon :name="RESOURCE_META[e.res].icon" :class="[RESOURCE_META[e.res].color, size === 'sm' ? 'size-3.5' : 'size-3']" />
            {{ shortAmount(e.amount) }}
        </span>
    </span>
</template>

<style scoped>
.hf-cost-short {
    color: #f87171;
    text-shadow: 0 0 6px rgba(248, 113, 113, 0.25);
}
</style>
