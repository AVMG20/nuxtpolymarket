<script setup lang="ts">
import HoldfastGame from '~/components/holdfast/HoldfastGame.client.vue'

definePageMeta({ layout: false })
useHead({ title: 'Holdfast' })
</script>

<template>
  <ClientOnly>
    <HoldfastGame />
    <template #fallback>
      <div class="flex h-dvh w-full items-center justify-center bg-default">
        <UIcon name="i-lucide-castle" class="size-10 animate-pulse text-warning" />
      </div>
    </template>
  </ClientOnly>
</template>
