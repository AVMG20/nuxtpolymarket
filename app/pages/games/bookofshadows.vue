<script setup lang="ts">
import BookOfShadowsGame from '~/components/games/BookOfShadowsGame.client.vue'

definePageMeta({ title: 'Book of Shadows' })
</script>

<template>
  <ClientOnly>
    <BookOfShadowsGame />
    <template #fallback>
      <div class="min-h-[460px] animate-pulse rounded-xl bg-elevated" />
    </template>
  </ClientOnly>
</template>
