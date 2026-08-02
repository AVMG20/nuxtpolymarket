<script setup lang="ts">
import LiveBlackjackGame from '~/components/games/LiveBlackjackGame.client.vue'

useHead({ title: 'Live Blackjack' })
</script>

<template>
  <div class="mx-auto w-full max-w-[1500px] px-2 py-3 sm:px-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="flex items-center gap-2 text-xl font-bold text-highlighted sm:text-2xl">
          <UIcon name="i-lucide-spade" class="text-primary" />
          Live Blackjack
        </h1>
        <p class="text-xs text-muted sm:text-sm">
          One shoe, five seats, everyone plays the same cards — 6 decks, blackjack pays 3:2, dealer stands on all 17.
        </p>
      </div>
      <UButton to="/games/blackjack" size="sm" color="neutral" variant="soft" icon="i-lucide-user">
        Solo table
      </UButton>
    </div>

    <ClientOnly>
      <LiveBlackjackGame />
      <template #fallback>
        <div class="w-full animate-pulse rounded-2xl bg-elevated" style="aspect-ratio: 8 / 5;" />
      </template>
    </ClientOnly>
  </div>
</template>
