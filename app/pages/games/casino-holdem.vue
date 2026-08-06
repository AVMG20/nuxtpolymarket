<script setup lang="ts">
import CasinoHoldemGame from '~/components/games/CasinoHoldemGame.client.vue'
import { CH_AA_TABLE, CH_ANTE_TABLE, CH_CALL_MULTIPLIER } from '#shared/utils/casino-holdem/rules'

useHead({ title: "Casino Hold'em" })

const showRules = ref(false)

const antePays = CH_ANTE_TABLE.map(row => `${row.label.toLowerCase()} ${row.pays} to 1`).join(', ')
const aaPays = CH_AA_TABLE.map(row => `${row.label.toLowerCase()} ${row.pays} to 1`).join(', ')

const houseRules = [
    {
        label: 'You only ever play the dealer',
        detail: 'Seats never play each other, so every seat can win the same hand. Nobody is taking your pot.'
    },
    {
        label: 'One decision a hand, on a shared clock',
        detail: `After the flop every seat calls or folds at the same time. Calling costs ${CH_CALL_MULTIPLIER} times `
            + 'your ante; folding gives up the ante. A seat that runs out the clock folds.'
    },
    {
        label: 'The dealer qualifies with a pair of fours',
        detail: 'Anything weaker and the dealer is out of the hand: your ante pays on the ante scale and your call bet '
            + 'comes straight back, whatever you are holding.'
    },
    {
        label: 'Beating a qualified dealer',
        detail: 'The call bet pays even money and the ante pays on the ante scale. Equal hands push — both bets return.'
    },
    {
        label: 'Ante scale',
        detail: `Paid on your own best five cards, win or lose the comparison: ${antePays}.`
    },
    {
        label: 'AA bonus',
        detail: `An optional side bet, capped at your ante, on your two hole cards plus the flop making a pair of aces `
            + `or better: ${aaPays}. It is decided on the flop, so it still pays if you later fold.`
    },
    {
        label: 'A fresh deck every hand',
        detail: 'One deck, shuffled before each deal, so nothing carries over between hands and there is no shoe to count.'
    }
]
</script>

<template>
  <div class="mx-auto w-full max-w-[1800px] px-2 py-3 sm:px-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="flex items-center gap-2 text-xl font-bold text-highlighted sm:text-2xl">
          <UIcon name="i-lucide-club" class="text-primary" />
          Casino Hold'em
        </h1>
        <p class="text-xs text-muted sm:text-sm">
          House-banked hold'em — call or fold your two cards against the dealer's board.
        </p>
      </div>
      <UButton
        size="sm"
        color="neutral"
        variant="soft"
        icon="i-lucide-help-circle"
        aria-label="House rules"
        @click="showRules = true"
      >
        Rules
      </UButton>
    </div>

    <ClientOnly>
      <CasinoHoldemGame />
      <template #fallback>
        <div class="w-full animate-pulse rounded-2xl bg-elevated" style="aspect-ratio: 1720 / 1200;" />
      </template>
    </ClientOnly>

    <UModal v-model:open="showRules" title="House rules">
      <template #body>
        <p class="mb-3 text-sm text-muted">
          Hold'em against the house. Two cards each, a five-card board, and one call-or-fold after the flop.
        </p>
        <dl class="space-y-3">
          <div v-for="rule in houseRules" :key="rule.label">
            <dt class="text-sm font-semibold text-highlighted">
              {{ rule.label }}
            </dt>
            <dd class="text-xs leading-relaxed text-muted">
              {{ rule.detail }}
            </dd>
          </div>
        </dl>
      </template>
    </UModal>
  </div>
</template>
