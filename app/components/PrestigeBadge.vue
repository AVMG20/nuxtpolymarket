<script setup lang="ts">
import { prestigeTier } from '#shared/utils/prestige'

const props = withDefaults(defineProps<{
  /** 0-4. Renders nothing at 0 so call sites need no v-if of their own. */
  level?: number | null
  size?: 'xs' | 'sm' | 'md'
}>(), { size: 'sm' })

const tier = computed(() => prestigeTier(props.level))

const sizing = {
  xs: { wrap: 'gap-px px-1 py-px text-[9px]', icon: 'size-2.5' },
  sm: { wrap: 'gap-0.5 px-1.5 py-px text-[10px]', icon: 'size-3' },
  md: { wrap: 'gap-1 px-2 py-0.5 text-xs', icon: 'size-3.5' }
} as const

const style = computed(() => tier.value && {
  backgroundImage: tier.value.badge,
  boxShadow: `0 0 8px -1px ${tier.value.accent}`
})
</script>

<template>
  <UTooltip v-if="tier" :text="`Prestige ${tier.roman} — ${tier.name}`">
    <span
      class="inline-flex shrink-0 select-none items-center rounded-full font-bold uppercase leading-none tracking-wide text-white/95 align-middle"
      :class="sizing[size].wrap"
      :style="style"
    >
      <UIcon class="shrink-0" :class="sizing[size].icon" name="i-lucide-crown" />
      {{ tier.roman }}
    </span>
  </UTooltip>
</template>
