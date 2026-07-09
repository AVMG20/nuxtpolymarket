<script setup lang="ts">
withDefaults(defineProps<{
  /** Tighter corner-cut, for compact chips/rows instead of full cards. */
  tight?: boolean
  /** Accent glow ring — for the currently-selected or highlighted frame. */
  accent?: boolean
}>(), {
  tight: false,
  accent: false
})
</script>

<template>
  <div
    class="hack-frame"
    :class="[tight && 'hack-frame-tight', accent && 'hack-frame-accent']"
  >
    <slot />
  </div>
</template>
