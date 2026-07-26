<script setup lang="ts">
import { voidHex, voidResource } from '#shared/utils/gamelogic/void'

const props = withDefaults(defineProps<{
    resource: string
    amount: number
    /** Renders in the error palette instead — you can't afford this much of it. */
    short?: boolean
    /** Drops the name and keeps only the icon and the number. */
    compact?: boolean
    size?: 'xs' | 'sm'
}>(), { short: false, compact: true, size: 'xs' })

const def = computed(() => voidResource(props.resource))
const hex = computed(() => voidHex(def.value.color))
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-md font-semibold tabular-nums"
    :class="size === 'sm' ? 'px-2 py-1 text-xs' : 'px-1.5 py-0.5 text-[11px]'"
    :style="short
      ? { color: 'var(--ui-error)', backgroundColor: 'color-mix(in oklab, var(--ui-error) 12%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--ui-error) 35%, transparent)' }
      : { color: hex, backgroundColor: `${hex}1f`, boxShadow: `inset 0 0 0 1px ${hex}3d` }"
    :title="`${def.name} — ${def.description}`"
  >
    <UIcon :name="def.icon" :class="size === 'sm' ? 'size-3.5' : 'size-3'" />
    <span v-if="!compact" class="font-medium opacity-80">{{ def.name }}</span>
    {{ formatNumber(amount) }}
  </span>
</template>
