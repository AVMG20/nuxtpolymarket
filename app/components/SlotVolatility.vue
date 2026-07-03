<template>
  <UTooltip :text="`Volatility ${clampedLevel}/5 — ${LABELS[clampedLevel - 1]}`">
    <div class="inline-flex cursor-default items-center gap-2">
      <span class="text-[10px] font-black tracking-wide text-muted uppercase">Volatility</span>
      <span class="inline-flex items-center gap-0.5">
        <UIcon
          v-for="i in 5"
          :key="i"
          name="i-lucide-zap"
          class="size-3.5"
          :style="{ color: i <= clampedLevel ? COLORS[clampedLevel - 1] : 'var(--ui-text-muted)', opacity: i <= clampedLevel ? 1 : 0.3 }"
        />
      </span>
    </div>
  </UTooltip>
</template>

<script setup lang="ts">
const props = defineProps<{
  level: number
}>()

// Green -> red, indexed by (level - 1). Rated from real max-win observed
// across 2M simulated spins per slot, not the theoretical payout cap.
const COLORS = ['#4ade80', '#a3e635', '#facc15', '#fb923c', '#ef4444']
const LABELS = ['low', 'medium-low', 'medium', 'high', 'extreme']

const clampedLevel = computed(() => Math.min(5, Math.max(1, Math.round(props.level))))
</script>
