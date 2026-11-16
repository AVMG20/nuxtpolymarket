<script setup lang="ts">
import { BUILDINGS, type Kind } from '#shared/utils/gridworks/defs'

const props = defineProps<{ kind: Kind, turn?: number }>()

const src = computed(() => {
    const s = BUILDINGS[props.kind].sprite
    return s ? `/gridworks/sprites/${s}` : ''
})
const style = computed(() => props.turn ? { transform: `rotate(${props.turn * 90}deg)` } : {})
</script>

<template>
  <img v-if="src" :src="src" class="pointer-events-none max-h-10 max-w-10 object-contain transition-transform duration-150" :style="style" alt="" draggable="false">
  <svg v-else viewBox="0 0 64 64" class="pointer-events-none size-10 transition-transform duration-150" :style="style">
    <rect x="0" y="12" width="64" height="40" fill="#5d6570" />
    <rect x="0" y="12" width="64" height="5" fill="#9aa3ae" />
    <rect x="0" y="47" width="64" height="5" fill="#9aa3ae" />
    <path d="M20 25 L28 32 L20 39 M38 25 L46 32 L38 39" stroke="#d9dee5" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
