<script setup lang="ts">
/**
 * The corner panel (top-left by default) every table hangs its reference
 * material off — paytables, the baccarat roadmap, rule reminders. Dimmed and
 * collapsed to its header by default so it never competes with the hands, and
 * it brightens on hover.
 *
 * Stacked when a table needs more than one: pass an increasing `offset`, since
 * the panels are absolutely positioned in stage coordinates and cannot flow.
 */
const props = withDefaults(defineProps<{
    title: string
    offset?: number
    open?: boolean
    side?: 'left' | 'right'
}>(), { offset: 0, open: false, side: 'left' })

const expanded = ref(props.open)
</script>

<template>
    <div class="lt-corner" :class="{ 'open': expanded, 'lt-corner-r': side === 'right' }" :style="{ top: `${62 + offset}px` }">
        <div class="lt-corner-head" @click="expanded = !expanded">
            <UIcon :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" />
            <span>{{ title }}</span>
        </div>
        <div v-if="expanded" class="lt-corner-body">
            <slot />
        </div>
    </div>
</template>
