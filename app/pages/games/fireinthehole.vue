<script setup lang="ts">
import FireInTheHoleGame from '~/components/games/FireInTheHoleGame.client.vue'

definePageMeta({ title: 'Fire in the Hole' })
</script>

<template>
  <ClientOnly>
    <FireInTheHoleGame />
    <template #fallback>
      <div class="min-h-[460px] animate-pulse rounded-xl bg-elevated" />
    </template>
  </ClientOnly>
</template>
