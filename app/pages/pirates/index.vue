<script setup lang="ts">
import PirateRaidGame from '~/components/pirates/PirateRaidGame.client.vue'

definePageMeta({ title: 'Pirate Raid' })
</script>

<template>
  <ClientOnly>
    <PirateRaidGame />
    <template #fallback>
      <div class="mx-3 h-[60svh] animate-pulse rounded-xl bg-elevated sm:mx-4" />
    </template>
  </ClientOnly>
</template>
