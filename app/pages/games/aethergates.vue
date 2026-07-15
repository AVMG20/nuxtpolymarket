<script setup lang="ts">
import AethergatesGame from '~/components/games/AethergatesGame.client.vue'
</script>

<template>
  <ClientOnly>
    <AethergatesGame />
    <template #fallback>
      <div class="min-h-[460px] animate-pulse rounded-xl bg-elevated" />
    </template>
  </ClientOnly>
</template>
