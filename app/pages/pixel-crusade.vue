<script setup lang="ts">
import PixelCrusadeGame from '~/components/pixelcrusade/PixelCrusadeGame.client.vue'

definePageMeta({ title: 'Pixel Crusade' })
useHead({ title: 'Pixel Crusade' })
</script>

<template>
  <ClientOnly>
    <PixelCrusadeGame />
    <template #fallback>
      <div class="p-4 max-w-[1400px] mx-auto">
        <div class="w-full aspect-video animate-pulse rounded-lg bg-elevated" />
      </div>
    </template>
  </ClientOnly>
</template>
