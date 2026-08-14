<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  sub?: string
  icon?: string
  tone?: 'gold' | 'cyan' | 'steel'
  disabled?: boolean
  loading?: boolean
  /** Renders the chip as the primary call to action — pulses while ready. */
  ready?: boolean
}>(), { tone: 'gold' })

const emit = defineEmits<{ click: [] }>()

const toneClasses = computed(() => {
  if (props.disabled) return 'border-default/70 bg-default/70 text-muted'
  switch (props.tone) {
    case 'cyan': return 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20 hover:border-cyan-300'
    case 'steel': return 'border-default bg-default/80 text-highlighted hover:border-neutral-400 hover:bg-elevated'
    default: return 'border-amber-400/60 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20 hover:border-amber-300'
  }
})
</script>

<template>
  <button
    type="button"
    class="miner-chip group flex items-center gap-2 rounded-full border px-3 py-1.5 backdrop-blur-md transition-all shadow-lg shadow-black/40"
    :class="[toneClasses, disabled ? 'cursor-not-allowed' : 'hover:scale-105 active:scale-95', ready && !disabled ? 'miner-chip--ready' : '']"
    :disabled="disabled || loading"
    @click.stop="emit('click')"
  >
    <UIcon
      :name="loading ? 'i-lucide-loader-circle' : (icon ?? 'i-lucide-chevron-up')"
      class="size-4 shrink-0"
      :class="loading ? 'animate-spin' : ''"
    />
    <span class="flex flex-col items-start leading-tight">
      <span class="text-xs font-semibold whitespace-nowrap">{{ label }}</span>
      <span v-if="sub" class="text-[10px] opacity-70 whitespace-nowrap">{{ sub }}</span>
    </span>
  </button>
</template>

<style scoped>
.miner-chip--ready {
  animation: miner-chip-pulse 2s ease-in-out infinite;
}

@keyframes miner-chip-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.35); }
  50% { box-shadow: 0 0 0 8px rgba(251, 191, 36, 0); }
}
</style>
