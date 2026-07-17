<script setup lang="ts">
import ShapezzGame from '~/components/shapezz/ShapezzGame.client.vue'

definePageMeta({ title: 'SHAPEZZ Arena' })
</script>

<template>
  <ClientOnly>
    <ShapezzGame />
    <template #fallback>
      <UContainer class="space-y-4 pb-12">
        <USkeleton class="h-12 w-56" />
        <USkeleton class="aspect-video w-full rounded-xl" />
      </UContainer>
    </template>
  </ClientOnly>
</template>
