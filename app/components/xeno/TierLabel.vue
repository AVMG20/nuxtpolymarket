<script setup lang="ts">
import { tierLabel, tierColor } from '#shared/utils/xeno'
defineProps<{ tier: number }>()
</script>

<template>
  <span class="text-xs font-bold leading-none" :class="tierColor(tier)">{{ tierLabel(tier) }}</span>
</template>
