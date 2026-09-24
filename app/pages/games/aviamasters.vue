<script setup lang="ts">
import AviamastersGame from '~/components/games/AviamastersGame.client.vue'

useHead({
  title: 'Aviamasters',
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Lilita+One&family=Nunito:wght@600;800;900&display=swap' }
  ]
})
</script>

<template>
  <div class="px-3 py-4 sm:px-6 sm:py-6">
    <ClientOnly>
      <AviamastersGame />
      <template #fallback>
        <div class="mx-auto aspect-video min-h-[480px] w-full max-w-[calc((100svh-8rem)*16/9)] animate-pulse rounded-xl bg-elevated" />
      </template>
    </ClientOnly>
  </div>
</template>
