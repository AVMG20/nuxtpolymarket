<script setup lang="ts">
import PathwardenGame from '~/components/games/PathwardenGame.client.vue'

definePageMeta({ title: 'Pathwarden' })
</script>

<template>
  <ClientOnly>
    <PathwardenGame />
  </ClientOnly>
</template>
