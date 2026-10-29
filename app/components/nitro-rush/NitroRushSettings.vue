<script setup lang="ts">
defineProps<{ musicOn: boolean, sfxOn: boolean, isFullscreen: boolean }>()
defineEmits<{ music: [], sfx: [], fullscreen: [] }>()
</script>

<template>
  <div class="absolute right-3 top-3 flex gap-1.5 sm:right-5 sm:top-5">
    <button class="nr-icon-btn" :aria-label="musicOn ? 'Mute music' : 'Unmute music'" @click="$emit('music')">
      <UIcon :name="musicOn ? 'i-lucide-music' : 'i-lucide-music-2'" class="size-4" :class="{ 'opacity-40': !musicOn }" />
    </button>
    <button class="nr-icon-btn" :aria-label="sfxOn ? 'Mute sound' : 'Unmute sound'" @click="$emit('sfx')">
      <UIcon :name="sfxOn ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" class="size-4" />
    </button>
    <button class="nr-icon-btn" aria-label="Fullscreen" @click="$emit('fullscreen')">
      <UIcon :name="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'" class="size-4" />
    </button>
  </div>
</template>
