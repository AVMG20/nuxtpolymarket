<script setup lang="ts">
import VoidRunGame from '~/components/void/VoidRunGame.client.vue'

definePageMeta({ title: 'Void Runner' })
</script>

<template>
  <ClientOnly>
    <VoidRunGame />
    <template #fallback>
      <div class="min-h-[460px] animate-pulse rounded-xl bg-elevated" />
    </template>
  </ClientOnly>
</template>
