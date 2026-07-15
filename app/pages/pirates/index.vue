<script setup lang="ts">
import PirateRaidGame from '~/components/pirates/PirateRaidGame.client.vue'

definePageMeta({ title: 'Pirate Raid' })
</script>

<template>
  <ClientOnly>
    <PirateRaidGame />
    <template #fallback>
      <div class="min-h-[460px] animate-pulse rounded-xl bg-elevated" />
    </template>
  </ClientOnly>
</template>
