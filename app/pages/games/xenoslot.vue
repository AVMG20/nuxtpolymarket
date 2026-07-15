<script setup lang="ts">
import XenoSlotGame from '~/components/games/XenoSlotGame.client.vue'
</script>

<template>
  <ClientOnly>
    <XenoSlotGame />
    <template #fallback>
      <div class="min-h-[460px] animate-pulse rounded-xl bg-elevated" />
    </template>
  </ClientOnly>
</template>
