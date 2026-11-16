<script setup lang="ts">
import GridworksGame from '~/components/gridworks/GridworksGame.client.vue'

definePageMeta({ title: 'Gridworks' })
</script>

<template>
  <ClientOnly>
    <GridworksGame />
    <template #fallback>
      <div class="h-full min-h-[560px] w-full animate-pulse bg-[#15181d]" />
    </template>
  </ClientOnly>
</template>
