<script setup lang="ts">
import NitroRushGame from '~/components/nitro-rush/NitroRushGame.client.vue'

useHead({
    title: 'Nitro Rush',
    link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Tilt+Neon&display=swap' }
    ]
})
</script>

<template>
  <div class="h-[calc(100svh-3.5rem)] p-2 sm:p-3 lg:h-svh">
    <ClientOnly>
      <NitroRushGame />
      <template #fallback>
        <div class="h-full w-full animate-pulse rounded-xl bg-elevated" />
      </template>
    </ClientOnly>
  </div>
</template>
