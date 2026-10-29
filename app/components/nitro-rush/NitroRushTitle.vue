<script setup lang="ts">
defineProps<{ isTouch: boolean }>()
defineEmits<{ drive: [] }>()
</script>

<template>
  <div class="absolute inset-0 flex flex-col items-center justify-center-safe gap-7 overflow-y-auto bg-gradient-to-t from-black/70 via-black/10 to-transparent p-5 text-center">
    <div>
      <h1 class="nr-title">NITRO<br>RUSH</h1>
      <p class="mt-2 text-sm font-semibold tracking-[0.3em] text-white/80">TIME TRIAL</p>
    </div>
    <button class="nr-play" @click="$emit('drive')">
      <UIcon name="i-lucide-play" class="size-6" />
      DRIVE
    </button>
    <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-semibold text-white/75" :class="isTouch ? 'sm:grid-cols-4' : 'sm:grid-cols-3'">
      <template v-if="isTouch">
        <span>◀ ▶ steer</span><span>Gas is automatic</span><span>Brake + steer: drift</span><span>Tap bar: nitro</span>
      </template>
      <template v-else>
        <span>↑ / W gas</span><span>↓ / S brake</span><span>← → / A D steer</span><span>Brake or Space + steer: drift</span><span>Shift / E nitro</span><span>R restart</span>
      </template>
    </div>
  </div>
</template>
