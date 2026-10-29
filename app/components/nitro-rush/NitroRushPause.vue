<script setup lang="ts">
defineEmits<{ resume: [], restart: [], quit: [] }>()
</script>

<template>
  <div class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div class="flex flex-col items-center gap-4">
      <div class="nr-title !text-5xl">PAUSED</div>
      <button class="nr-play" @click="$emit('resume')">
        <UIcon name="i-lucide-play" class="size-6" />
        RESUME
      </button>
      <div class="flex gap-2">
        <button class="nr-ghost" @click="$emit('restart')">Restart</button>
        <button class="nr-ghost" @click="$emit('quit')">Quit</button>
      </div>
    </div>
  </div>
</template>
