<script setup lang="ts">
import ThreeCardPokerGame from '~/components/games/ThreeCardPokerGame.client.vue'
import { TCP_ANTE_BONUS_PAYS, TCP_PAIR_PLUS_PAYS } from '#shared/utils/three-card-poker/payouts'

useHead({ title: 'Three Card Poker' })

const showRules = ref(false)

const houseRules = [
    {
        label: 'A straight beats a flush',
        detail: 'Three-card ranking is not five-card ranking. There are 720 three-card straights against 1,096 flushes, '
            + 'so the straight is the rarer hand and outranks it. High to low: straight flush, three of a kind, straight, '
            + 'flush, pair, high card.'
    },
    {
        label: 'Ante, then one decision',
        detail: 'Post an ante, take three cards, then either play — matching the ante with a second bet — or fold and '
            + 'give up the ante. There is no drawing, no raising and no turn order: every seat decides inside the same window.'
    },
    {
        label: 'The dealer qualifies on queen high',
        detail: 'If the dealer misses that, your ante pays even money and your play bet pushes, whatever you are holding. '
            + 'If the dealer qualifies, both bets are settled against their hand together — even money each on a win, both lost on a loss.'
    },
    {
        label: 'Ante Bonus pays whatever the dealer has',
        detail: `Paid on the ante for a big hand, win or lose: ${TCP_ANTE_BONUS_PAYS.straightFlush} to 1 for a straight flush, `
            + `${TCP_ANTE_BONUS_PAYS.trips} to 1 for three of a kind, ${TCP_ANTE_BONUS_PAYS.straight} to 1 for a straight. `
            + 'You have to play the hand to collect it — folding forfeits the ante and the bonus with it.'
    },
    {
        label: 'Pair Plus ignores the dealer entirely',
        detail: `An independent bet on your own three cards: ${TCP_PAIR_PLUS_PAYS.straightFlush} to 1 straight flush, `
            + `${TCP_PAIR_PLUS_PAYS.trips} to 1 three of a kind, ${TCP_PAIR_PLUS_PAYS.straight} to 1 straight, `
            + `${TCP_PAIR_PLUS_PAYS.flush} to 1 flush, ${TCP_PAIR_PLUS_PAYS.pair} to 1 a pair. It pays even on a hand you folded.`
    },
    {
        label: 'Play Q-6-4 or better',
        detail: 'That single threshold is the whole optimal strategy — everything below it is worth less than the second bet '
            + 'it costs. Turn Hints on and the right button lights up.'
    },
    {
        label: 'A fresh deck every hand',
        detail: 'One deck, shuffled before each deal, so nothing carries between hands and there is nothing to count.'
    },
    {
        label: 'Miss the timer and you fold',
        detail: 'The play-or-fold window is shared by the whole table, so a seat that does not answer it folds and the round moves on.'
    }
]
</script>

<template>
  <div class="mx-auto w-full max-w-[1800px] px-2 py-3 sm:px-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="flex items-center gap-2 text-xl font-bold text-highlighted sm:text-2xl">
          <UIcon name="i-lucide-diamond" class="text-primary" />
          Three Card Poker
        </h1>
        <p class="text-xs text-muted sm:text-sm">
          House-banked — ante and play settle together against the dealer's hand, and a straight beats a flush.
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
      <ThreeCardPokerGame />
      <template #fallback>
        <div class="w-full animate-pulse rounded-2xl bg-elevated" style="aspect-ratio: 1720 / 1200;" />
      </template>
    </ClientOnly>

    <UModal v-model:open="showRules" title="House rules">
      <template #body>
        <p class="mb-3 text-sm text-muted">
          Five seats, each playing its own three cards against the dealer and never against each other.
          One ante, one decision, and two side ways to get paid.
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
