<script setup lang="ts">
import BaccaratGame from '~/components/games/BaccaratGame.client.vue'
import { BAC_PAYOUTS } from '#shared/utils/baccarat/payouts'

useHead({ title: 'Baccarat' })

const showRules = ref(false)

const houseRules = [
    {
        label: `Banker pays ${BAC_PAYOUTS.banker} to 1`,
        detail: 'A 5% commission on Banker wins — the only thing keeping its edge below Player\'s despite winning more often.'
    },
    {
        label: `Player pays ${BAC_PAYOUTS.player} to 1`,
        detail: 'Even money, no commission.'
    },
    {
        label: `Tie pays ${BAC_PAYOUTS.tie} to 1`,
        detail: 'Player and Banker bets push — you get your stake back — rather than losing on a tie.'
    },
    {
        label: `Player Pair and Banker Pair each pay ${BAC_PAYOUTS.playerPair} to 1`,
        detail: 'Settled on that side\'s first two cards being the same rank, regardless of the hand\'s outcome.'
    },
    {
        label: 'Fixed drawing rules, zero decisions',
        detail: 'Either side totalling 8 or 9 on the first two cards is a natural and ends the hand immediately. Otherwise Player draws on 0–5 and stands on 6–7. Banker\'s third card follows the real punto banco table, reacting to both its own total and whatever card Player drew third.'
    },
    {
        label: 'One 6-deck shoe, shuffled at 75%',
        detail: 'Cards are dealt off the top and only reshuffled once the cut card is reached — watch the shoe panel to see how far off the shuffle is.'
    }
]
</script>

<template>
  <div class="mx-auto w-full max-w-[1800px] px-2 py-3 sm:px-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="flex items-center gap-2 text-xl font-bold text-highlighted sm:text-2xl">
          <UIcon name="i-lucide-diamond" class="text-primary" />
          Baccarat
        </h1>
        <p class="text-xs text-muted sm:text-sm">
          Punto banco off a shared six-deck shoe — five seats, fixed drawing rules, zero decisions.
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
      <BaccaratGame />
      <template #fallback>
        <div class="w-full animate-pulse rounded-2xl bg-elevated" style="aspect-ratio: 1720 / 1200;" />
      </template>
    </ClientOnly>

    <UModal v-model:open="showRules" title="House rules">
      <template #body>
        <p class="mb-3 text-sm text-muted">
          Punto banco: bet on Player, Banker or a Tie before the cards come out. Nobody at the
          table — including the house — makes a single decision once the betting clock closes.
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
