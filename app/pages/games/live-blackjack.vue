<script setup lang="ts">
import LiveBlackjackGame from '~/components/games/LiveBlackjackGame.client.vue'
import { LB_RULES } from '#shared/utils/live-blackjack/rules'
import { LB_21P3_PAYS, LB_PERFECT_PAIRS_PAYS } from '#shared/utils/live-blackjack/sidebets'

useHead({ title: 'Blackjack' })

const showRules = ref(false)

// Written out rather than derived so the wording can explain *why* a rule is
// unusual, which is the point of the panel.
const houseRules = [
    {
        label: 'Blackjack pays 3 to 2',
        detail: 'A two-card 21 returns two and a half times your bet. A 21 made after splitting pays even money instead.'
    },
    {
        label: 'Dealer stands on all 17',
        detail: 'Including soft 17 (an ace and a six). The dealer never draws to a 17.'
    },
    {
        label: 'Split aces keep playing',
        detail: 'Most casinos give split aces exactly one card each and freeze them. Here they are ordinary hands — hit them, double them, split them again.'
    },
    {
        label: `Split up to ${LB_RULES.maxHands} hands`,
        detail: 'Any pair by value, so a king and a ten can be split. Each new hand costs another bet.'
    },
    {
        label: 'Double after split',
        detail: 'Doubling is allowed on any fresh two-card hand, split or not.'
    },
    {
        label: 'Perfect Pairs side bet',
        detail: `Pick up a chip, then click the small PP circle. Pays on your first two cards being a pair: `
            + `${LB_PERFECT_PAIRS_PAYS.perfect} to 1 for a perfect pair (same rank and suit), `
            + `${LB_PERFECT_PAIRS_PAYS.coloured} to 1 for a coloured pair (same rank and colour), `
            + `${LB_PERFECT_PAIRS_PAYS.mixed} to 1 for a mixed pair. Settled off the deal, win or lose the hand.`
    },
    {
        label: '21+3 side bet',
        detail: `Your two cards plus the dealer's upcard, scored as a three-card poker hand: `
            + `${LB_21P3_PAYS.suitedTrips} to 1 suited three of a kind, `
            + `${LB_21P3_PAYS.straightFlush} to 1 straight flush, `
            + `${LB_21P3_PAYS.trips} to 1 three of a kind, `
            + `${LB_21P3_PAYS.straight} to 1 straight, `
            + `${LB_21P3_PAYS.flush} to 1 flush. Aces play high or low in a straight.`
    },
    {
        label: 'Surrender any two-card hand',
        detail: 'Give up half your bet and sit the hand out — allowed even on hands you have just split, which almost nowhere permits.'
    },
    {
        label: 'Insurance pays 2 to 1',
        detail: 'Offered when the dealer shows an ace, and costs half your bet. Taking it on your own blackjack is the even-money play.'
    },
    {
        label: 'The dealer checks for blackjack',
        detail: 'On an ace or a ten the hole card is checked before you act, so you can never lose a doubled or split bet to a dealer blackjack.'
    },
    {
        label: `One ${LB_RULES.decks}-deck shoe, shuffled at ${Math.round(LB_RULES.penetration * 100)}%`,
        detail: 'Cards are not reshuffled between hands, so the shoe genuinely runs down — count it if you like. The cut card on the shoe shows how far off the shuffle is.'
    }
]
</script>

<template>
  <div class="mx-auto w-full max-w-[1500px] px-2 py-3 sm:px-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="flex items-center gap-2 text-xl font-bold text-highlighted sm:text-2xl">
          <UIcon name="i-lucide-spade" class="text-primary" />
          Blackjack
        </h1>
        <p class="text-xs text-muted sm:text-sm">
          One shoe, five seats, everyone plays the same cards — with house rules a little friendlier than usual.
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
      <LiveBlackjackGame />
      <template #fallback>
        <div class="w-full animate-pulse rounded-2xl bg-elevated" style="aspect-ratio: 1600 / 1120;" />
      </template>
    </ClientOnly>

    <UModal v-model:open="showRules" title="House rules">
      <template #body>
        <p class="mb-3 text-sm text-muted">
          This is standard blackjack with a few rules bent in the player's favour — most of them around
          splitting, which is where the usual rules are meanest.
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
