<script setup lang="ts">
import RiftbornGame from '~/components/riftborn/RiftbornGame.client.vue'

definePageMeta({ title: 'Riftborn' })
</script>

<template>
  <ClientOnly>
    <RiftbornGame />
    <template #fallback>
      <div class="p-6 max-w-[1500px] mx-auto">
        <div class="w-full aspect-[16/9] animate-pulse rounded-xl bg-elevated" />
      </div>
    </template>
  </ClientOnly>
</template>
