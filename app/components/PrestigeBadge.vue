<script setup lang="ts">
import { prestigeBonusPercent, prestigeTitle } from '#shared/utils/prestige'

const props = withDefaults(defineProps<{
  level: number
  compact?: boolean
}>(), {
  compact: false
})

const normalizedLevel = computed(() => Math.min(3, Math.max(0, Math.floor(props.level))))
const styles = [
  '',
  'border-amber-400/50 bg-amber-400/15 text-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.18)]',
  'border-violet-400/50 bg-violet-400/15 text-violet-300 shadow-[0_0_16px_rgba(167,139,250,0.22)]',
  'border-cyan-300/60 bg-gradient-to-r from-cyan-400/20 via-violet-400/20 to-fuchsia-400/20 text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.28)]'
]
</script>

<template>
  <UTooltip
    v-if="normalizedLevel > 0"
    :text="`${prestigeTitle(normalizedLevel)} · +${prestigeBonusPercent(normalizedLevel)}% to earned credits`"
  >
    <span
      class="inline-flex shrink-0 items-center gap-1 rounded-full border font-black uppercase tracking-wider"
      :class="[
        styles[normalizedLevel],
        compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]'
      ]"
    >
      <UIcon name="i-lucide-crown" :class="compact ? 'size-2.5' : 'size-3'" />
      P{{ normalizedLevel }}
      <span v-if="!compact">{{ prestigeTitle(normalizedLevel) }}</span>
    </span>
  </UTooltip>
</template>
