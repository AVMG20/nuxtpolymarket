<script setup lang="ts">
import RouletteGame from '~/components/games/RouletteGame.client.vue'

useHead({ title: 'Roulette' })
</script>

<template>
  <div class="mx-auto w-full max-w-[1800px] px-2 py-3 sm:px-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="flex items-center gap-2 text-xl font-bold text-highlighted sm:text-2xl">
          <UIcon name="i-lucide-circle-dot" class="text-primary" />
          Roulette
        </h1>
        <p class="text-xs text-muted sm:text-sm">
          Single-zero European wheel — everyone bets the same layout, one spin settles every bet.
        </p>
      </div>
    </div>

    <ClientOnly>
      <RouletteGame />
      <template #fallback>
        <div class="w-full animate-pulse rounded-2xl bg-elevated" style="aspect-ratio: 1720 / 1200;" />
      </template>
    </ClientOnly>
  </div>
</template>
