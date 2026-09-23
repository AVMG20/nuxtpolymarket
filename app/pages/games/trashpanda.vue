<script setup lang="ts">
import TrashPandaGame from '~/components/games/TrashPandaGame.client.vue'

useHead({
  title: 'Trash Panda Heist',
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Bangers&family=Fredoka:wght@400;500;600;700&family=Lilita+One&display=swap' }
  ]
})
</script>

<template>
  <ClientOnly>
    <TrashPandaGame />
    <template #fallback>
      <div class="min-h-[460px] animate-pulse rounded-xl bg-elevated" />
    </template>
  </ClientOnly>
</template>
