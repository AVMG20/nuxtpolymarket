<script setup lang="ts">
import CandyMadnessGame from '~/components/games/CandyMadnessGame.client.vue'
</script>

<template>
  <ClientOnly>
    <CandyMadnessGame />
    <template #fallback>
      <div class="min-h-[460px] animate-pulse rounded-xl bg-elevated" />
    </template>
  </ClientOnly>
</template>
