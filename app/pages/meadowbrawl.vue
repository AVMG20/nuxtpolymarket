<script setup lang="ts">
import MeadowbrawlGame from '~/components/meadowbrawl/MeadowbrawlGame.client.vue'

definePageMeta({ title: 'Meadowbrawl' })
useHead({ title: 'Meadowbrawl' })
</script>

<template>
  <ClientOnly>
    <MeadowbrawlGame />
    <template #fallback>
      <div class="p-6 max-w-[1500px] mx-auto">
        <div class="w-full aspect-video animate-pulse rounded-xl bg-elevated" />
      </div>
    </template>
  </ClientOnly>
</template>
