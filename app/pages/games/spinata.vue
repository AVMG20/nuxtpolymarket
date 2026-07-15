<script setup lang="ts">
import SpinataGame from '~/components/games/SpinataGame.client.vue'
</script>

<template>
  <ClientOnly>
    <SpinataGame />
    <template #fallback>
      <div class="min-h-[460px] animate-pulse rounded-xl bg-elevated" />
    </template>
  </ClientOnly>
</template>
