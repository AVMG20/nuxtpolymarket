<script setup lang="ts">
import HackerzGame from '~/components/hackerz/HackerzGame.client.vue'

definePageMeta({ title: 'Hackerz' })
</script>

<template>
  <ClientOnly>
    <HackerzGame />
    <template #fallback>
      <div class="p-6 max-w-[1500px] mx-auto">
        <div class="w-full aspect-[16/9] animate-pulse rounded-xl bg-elevated" />
      </div>
    </template>
  </ClientOnly>
</template>
