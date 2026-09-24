<script setup lang="ts">
import EmberPortalsGame from '~/components/games/EmberPortalsGame.client.vue'
import { EP_FONTS_HREF } from '~/utils/slots/emberportals-art'

useHead({
  title: 'Ember Portals',
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    { rel: 'stylesheet', href: EP_FONTS_HREF }
  ]
})
</script>

<template>
  <ClientOnly>
    <EmberPortalsGame />
    <template #fallback>
      <div class="min-h-[460px] animate-pulse rounded-xl bg-elevated" />
    </template>
  </ClientOnly>
</template>
