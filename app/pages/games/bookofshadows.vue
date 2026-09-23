<script setup lang="ts">
import BookOfShadowsGame from '~/components/games/BookOfShadowsGame.client.vue'

definePageMeta({ title: 'Book of Shadows' })

useHead({
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Cinzel+Decorative:wght@700;900&display=swap' }
  ]
})
</script>

<template>
  <ClientOnly>
    <BookOfShadowsGame />
    <template #fallback>
      <div class="min-h-[100dvh] bg-[#070504]" />
    </template>
  </ClientOnly>
</template>
