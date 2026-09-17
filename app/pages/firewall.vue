<script setup lang="ts">
import FirewallGame from '~/components/firewall/FirewallGame.client.vue'

definePageMeta({ title: 'Firewall' })
</script>

<template>
  <ClientOnly>
    <FirewallGame />
    <template #fallback>
      <div class="p-6 max-w-[1500px] mx-auto">
        <div class="w-full aspect-[16/9] animate-pulse rounded-xl bg-elevated" />
      </div>
    </template>
  </ClientOnly>
</template>
