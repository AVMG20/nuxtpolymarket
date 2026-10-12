<script setup lang="ts">
import NeighcassoGame from '~/components/games/NeighcassoGame.client.vue'

useHead({ title: 'Neighcasso Derby' })
</script>

<template>
  <div class="mx-auto w-full max-w-[1500px] px-2 py-3 sm:px-4">
    <ClientOnly>
      <NeighcassoGame />
      <template #fallback>
        <div class="w-full animate-pulse rounded-2xl bg-elevated" style="aspect-ratio: 16 / 9;" />
      </template>
    </ClientOnly>
  </div>
</template>
