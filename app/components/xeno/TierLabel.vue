<script setup lang="ts">
import { roman, tierClass } from '~/lib/xeno-ui'

// Tier as a small leaf in the tier colour plus its roman numeral.
withDefaults(defineProps<{ tier: number, isVoid?: boolean, label?: string }>(), { isVoid: false, label: '' })
</script>

<template>
  <span class="xg-tier" :class="tierClass(tier, isVoid)" :title="`Tier ${roman(tier)}${isVoid ? ' · void' : ''}`">{{ label || roman(tier) }}</span>
</template>
