<script setup lang="ts">
import { RESOURCES, resourceColor, resourceIcon } from '#shared/utils/caravan/config'

/**
 * One resource, as an icon and a number.
 *
 * Costs and stocks used to be rendered as plain names, which meant reading a
 * five-line list to answer "do I have the ore for this". A glyph in the
 * category's colour answers it at a glance, and the name is still there for
 * anything unfamiliar.
 */

const props = withDefaults(defineProps<{
    id: string
    amount?: number
    /** Shows a have/need pair and colours the number red when short. */
    have?: number
    showName?: boolean
    size?: 'sm' | 'md'
}>(), { showName: true, size: 'md' })

const def = computed(() => RESOURCES[props.id])
const short = computed(() => props.have !== undefined && props.amount !== undefined && props.have < props.amount)
</script>

<template>
    <span
        class="inline-flex items-center gap-1.5"
        :class="size === 'sm' ? 'text-[11px]' : 'text-xs'"
        :title="def?.name ?? id"
    >
        <span
            class="grid shrink-0 place-items-center rounded"
            :class="size === 'sm' ? 'size-4' : 'size-5'"
            :style="{ backgroundColor: resourceColor(id) + '24' }"
        >
            <UIcon
                :name="resourceIcon(id)"
                :class="size === 'sm' ? 'size-2.5' : 'size-3'"
                :style="{ color: resourceColor(id) }"
            />
        </span>
        <span v-if="showName" class="truncate text-muted">{{ def?.name ?? id }}</span>
        <span v-if="have !== undefined && amount !== undefined" class="font-mono" :class="short ? 'text-error' : 'text-default'">
            {{ formatNumber(have) }}<span class="text-muted">/{{ formatNumber(amount) }}</span>
        </span>
        <span v-else-if="amount !== undefined" class="font-mono text-default">{{ formatNumber(amount) }}</span>
    </span>
</template>
