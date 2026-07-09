<script setup lang="ts">
import { RARITY_ACCENT, RARITY_LABEL, RARITY_ORDER, RARITY_STYLE, type HackRarity } from '#shared/utils/hack-config'

// Odds stay real and unobscured here on purpose — PLAN.md §6.4: hiding drop
// rates on a paid pull would be a dark pattern. Reused by the Black Market
// grid cards and both opening modals' pitch stage.
const props = defineProps<{ weights: Record<HackRarity, number> }>()

const total = computed(() => Object.values(props.weights).reduce((a, b) => a + b, 0))
const segments = computed(() =>
  RARITY_ORDER.filter(r => props.weights[r] > 0).map(r => ({
    rarity: r,
    pct: Math.round(props.weights[r] / total.value * 100)
  })))
</script>

<template>
  <div>
    <div class="hack-odds-bar">
      <span
        v-for="seg in segments"
        :key="seg.rarity"
        :class="RARITY_ACCENT[seg.rarity]"
        :style="{ width: `${seg.pct}%` }"
      />
    </div>
    <div class="hack-odds-legend">
      <span
        v-for="seg in segments"
        :key="seg.rarity"
        :class="RARITY_STYLE[seg.rarity].text"
      >
        <i :class="RARITY_ACCENT[seg.rarity]" />{{ RARITY_LABEL[seg.rarity] }} {{ seg.pct }}%
      </span>
    </div>
  </div>
</template>
