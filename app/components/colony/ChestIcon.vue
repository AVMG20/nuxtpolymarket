<script setup lang="ts">
withDefaults(defineProps<{
  /** How far the lid is lifted, 0 (shut) to 1 (wide open). */
  open?: number
  width?: number
}>(), { open: 0, width: 104 })
</script>

<template>
  <svg
    :width="width"
    :height="width * 88 / 104"
    viewBox="0 0 104 88"
    aria-hidden="true"
    overflow="visible"
  >
    <ellipse cx="52" cy="82" rx="44" ry="6" fill="#000" opacity=".5" />
    <!-- Glow spilling out of the gap under a lifted lid -->
    <ellipse
      v-if="open > 0"
      cx="52"
      cy="38"
      rx="40"
      :ry="4 + open * 8"
      fill="#fde68a"
      :opacity="0.35 + open * 0.4"
    />
    <rect x="8" y="38" width="88" height="44" rx="8" fill="#7c4a26" stroke="#2a1708" stroke-width="3" />
    <rect x="10" y="40" width="84" height="8" fill="#5e3618" />
    <rect x="20" y="38" width="10" height="44" fill="#fbbf24" stroke="#2a1708" stroke-width="2" />
    <rect x="74" y="38" width="10" height="44" fill="#fbbf24" stroke="#2a1708" stroke-width="2" />
    <g :transform="`rotate(${-open * 14} 8 36) translate(0 ${-open * 4})`">
      <path d="M8 38 L 96 38 L 96 32 Q 52 4 8 32 Z" fill="#9a5e30" stroke="#2a1708" stroke-width="3" stroke-linejoin="round" />
      <path d="M20 37 L 20 22 Q 25 19 30 18 L 30 37 Z" fill="#fbbf24" stroke="#2a1708" stroke-width="2" stroke-linejoin="round" />
      <path d="M74 37 L 74 18 Q 79 19 84 22 L 84 37 Z" fill="#fbbf24" stroke="#2a1708" stroke-width="2" stroke-linejoin="round" />
    </g>
    <rect x="44" y="44" width="16" height="18" rx="3" fill="#fde68a" stroke="#2a1708" stroke-width="2" />
    <circle cx="52" cy="52" r="2.5" fill="#2a1708" />
  </svg>
</template>
