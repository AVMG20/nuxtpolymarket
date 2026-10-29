<script setup lang="ts">
const { muted, toggle } = useXenoSound()
</script>

<template>
  <UTooltip :text="muted ? 'Unmute sound effects' : 'Mute sound effects'">
    <button
      type="button"
      class="xg-btn ghost sm ico"
      :aria-label="muted ? 'Unmute sound effects' : 'Mute sound effects'"
      :aria-pressed="!muted"
      @click="toggle"
    >
      <UIcon :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" class="size-4.5" />
    </button>
  </UTooltip>
</template>
