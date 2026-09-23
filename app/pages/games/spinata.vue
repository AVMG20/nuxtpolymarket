<script setup lang="ts">
import SpinataGame from '~/components/games/SpinataGame.client.vue'

useHead({
  title: 'Spiñata Slots',
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Lilita+One&display=swap' }
  ]
})
</script>

<template>
  <ClientOnly>
    <SpinataGame />
    <template #fallback>
      <div class="min-h-[460px] animate-pulse rounded-xl bg-elevated" />
    </template>
  </ClientOnly>
</template>
