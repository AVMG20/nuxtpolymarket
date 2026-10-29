<script setup lang="ts">
import type { Popup } from '~/utils/nitro-rush/types'

defineProps<{ popups: (Popup & { id: number })[] }>()
</script>

<template>
  <div class="pointer-events-none absolute inset-x-0 top-[20%] flex flex-col items-center gap-1">
    <div v-for="p in popups" :key="p.id" class="nr-popup" :class="[`tone-${p.tone}`, { 'is-big': p.big }]">
      <div class="nr-popup-text tabular-nums">{{ p.text }}</div>
      <div v-if="p.sub" class="nr-popup-sub">{{ p.sub }}</div>
    </div>
  </div>
</template>
