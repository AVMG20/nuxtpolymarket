<script setup lang="ts">
definePageMeta({ title: 'Polytown' })
useHead({ title: 'Polytown' })
</script>

<template>
  <ClientOnly>
    <TownGame />
    <template #fallback>
      <div class="h-full w-full animate-pulse bg-elevated" />
    </template>
  </ClientOnly>
</template>
