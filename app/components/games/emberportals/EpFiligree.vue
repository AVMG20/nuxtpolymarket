<script setup lang="ts">
// A thin ornate gold rule with a teal gem in the middle: the divider used
// instead of boxes to group the HUD. Pure SVG, scales to any width.
defineProps<{ gem?: string }>()
const id = useId()
</script>

<template>
  <svg class="ep-fil" viewBox="0 0 240 16" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient :id="`${id}-g`" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#7a4608" stop-opacity="0" />
        <stop offset="0.2" stop-color="#b8802a" />
        <stop offset="0.42" stop-color="#fff3c4" />
        <stop offset="0.5" stop-color="#e9b64a" />
        <stop offset="0.58" stop-color="#fff3c4" />
        <stop offset="0.8" stop-color="#b8802a" />
        <stop offset="1" stop-color="#7a4608" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path :fill="`url(#${id}-g)`" d="M0 7.5 L104 6.6 Q110 6 113 3.6 L120 8 L113 12.4 Q110 10 104 9.4 L0 8.5 Z M240 7.5 L136 6.6 Q130 6 127 3.6 L120 8 L127 12.4 Q130 10 136 9.4 L240 8.5 Z" />
    <circle cx="96" cy="8" r="1.4" fill="#e9b64a" />
    <circle cx="144" cy="8" r="1.4" fill="#e9b64a" />
    <path d="M120 2 L126 8 L120 14 L114 8 Z" fill="#6b3a07" />
    <path d="M120 3.4 L124.6 8 L120 12.6 L115.4 8 Z" :fill="gem ?? '#78f0ff'" />
    <path d="M120 3.4 L124.6 8 L120 8 Z" fill="#ffffff" fill-opacity="0.55" />
  </svg>
</template>

<style scoped>
.ep-fil {
  display: block;
  width: 100%;
  height: 16px;
  overflow: visible;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 4px rgba(232, 181, 74, 0.35));
}
</style>
