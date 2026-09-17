<script setup lang="ts">
const { muted, toggle } = useXenoSound()
</script>

<template>
  <UTooltip :text="muted ? 'Unmute sound effects' : 'Mute sound effects'">
    <UButton
      :icon="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
      size="sm"
      variant="ghost"
      color="neutral"
      :aria-label="muted ? 'Unmute' : 'Mute'"
      @click="toggle"
    />
  </UTooltip>
</template>
