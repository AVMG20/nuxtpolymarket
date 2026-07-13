<script setup lang="ts">
import {
  ITEM_TYPES,
  BUG_TYPES,
  TIER_NAMES,
  MAX_TRAIT_PCT,
  MAX_YIELD_LEVEL,
  SOCIAL_BONUS_PER_PEER,
  SOCIAL_MAX_BONUS,
  SOLITARY_BONUS_ALONE,
  SOLITARY_PENALTY_PER_PEER
} from '#shared/utils/colony'
import { tierColor, tierBg } from '#shared/utils/xeno'

const colony = useColony()
const { habitatLevel, inventory } = colony

const tiers = computed(() => {
  const grouped = new Map<number, typeof ITEM_TYPES>()
  for (const item of ITEM_TYPES) {
    const list = grouped.get(item.tier) ?? []
    list.push(item)
    grouped.set(item.tier, list)
  }
  return [...grouped.entries()].sort((a, b) => a[0] - b[0])
})

function foragedBy(itemId: string) {
  return BUG_TYPES.find(b => b.itemId === itemId)
}

function isUnlocked(tier: number) {
  return tier <= habitatLevel.value
}

function ownedQty(itemId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return inventory.value.find((i: any) => i.id === itemId)?.quantity ?? 0
}
</script>

<template>
  <UContainer class="py-4 space-y-6">
    <div>
      <h1 class="text-lg font-bold flex items-center gap-2">
        <UIcon
          name="i-lucide-book-open"
          class="text-primary"
        />
        Colonopedia
      </h1>
      <p class="text-sm text-muted">
        Every resource your bugs can forage. Sell them in the Market for coins, or hoard them — Habitat upgrades demand serious stockpiles.
      </p>
    </div>

    <!-- Bug traits explainer -->
    <div>
      <h2 class="text-sm font-semibold uppercase tracking-wider mb-2">
        Bug traits
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <UCard>
          <div class="flex items-center gap-2 mb-1.5">
            <UIcon
              name="i-lucide-zap"
              class="text-warning size-4"
            />
            <p class="font-semibold text-sm">
              Speed
            </p>
          </div>
          <p class="text-xs text-muted">
            Rolled 0–{{ MAX_TRAIT_PCT }}% on purchase, unique to that bug. Shortens its cycle time — a 20% roll finishes cycles 20% faster. Habitat's Foraging Speed upgrade adds a flat colony-wide bonus on top, after each bug's own roll.
          </p>
        </UCard>
        <UCard>
          <div class="flex items-center gap-2 mb-1.5">
            <UIcon
              name="i-lucide-gem"
              class="text-primary size-4"
            />
            <p class="font-semibold text-sm">
              Yield
            </p>
          </div>
          <p class="text-xs text-muted">
            A fixed level rolled on purchase, ranging from 1–2 for the earliest bugs up to {{ MAX_YIELD_LEVEL - 2 }}–{{ MAX_YIELD_LEVEL }} for the rarest. It's a ceiling, not a flat number: every cycle drops 1 up to level+1 items, so a level-5 bug drops somewhere between 1 and 6 each time.
          </p>
        </UCard>
        <UCard>
          <div class="flex items-center gap-2 mb-1.5">
            <UIcon
              name="i-lucide-utensils"
              class="text-muted size-4"
            />
            <p class="font-semibold text-sm">
              Eat
            </p>
          </div>
          <p class="text-xs text-muted">
            A fixed rate rolled on purchase — nutrition spent every time the bug finishes a cycle, not per hour. Faster bugs (higher Speed) complete more cycles, so they eat more often. Higher tiers roll a hungrier rate.
          </p>
        </UCard>
        <UCard>
          <div class="flex items-center gap-2 mb-1.5">
            <UIcon
              name="i-lucide-users"
              class="text-success size-4"
            />
            <p class="font-semibold text-sm">
              Social
            </p>
          </div>
          <p class="text-xs text-muted">
            A speed effect, not a yield effect. Social species gain +{{ (SOCIAL_BONUS_PER_PEER * 100).toFixed(0) }}% speed per same-species neighbor placed, up to +{{ (SOCIAL_MAX_BONUS * 100).toFixed(0) }}%. Solitary species get +{{ (SOLITARY_BONUS_ALONE * 100).toFixed(0) }}% alone but lose {{ (SOLITARY_PENALTY_PER_PEER * 100).toFixed(0) }}% speed per neighbor of their own kind. Added directly on top of the bug's own rolled Speed, not stacked as a multiplier.
          </p>
        </UCard>
      </div>
    </div>

    <div
      v-for="[tier, tierItems] in tiers"
      :key="tier"
    >
      <h2 class="text-sm font-semibold uppercase tracking-wider mb-2 flex items-center gap-2">
        <span :class="tierColor(tier)">Tier {{ tier }} — {{ TIER_NAMES[tier] }}</span>
        <UBadge
          v-if="!isUnlocked(tier)"
          size="sm"
          color="neutral"
          variant="subtle"
        >
          <UIcon
            name="i-lucide-lock"
            class="size-3 mr-0.5"
          />
          Habitat {{ tier }}
        </UBadge>
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <UCard
          v-for="item in tierItems"
          :key="item.id"
          :class="!isUnlocked(item.tier) && 'opacity-60'"
        >
          <div class="flex items-start gap-3">
            <span
              class="text-2xl leading-none size-11 flex items-center justify-center rounded-xl border shrink-0"
              :class="tierBg(item.tier)"
            >{{ item.emoji }}</span>
            <div class="min-w-0 flex-1">
              <p class="font-medium text-sm flex items-center gap-1.5">
                {{ item.name }}
                <span
                  class="text-xs font-black"
                  :class="tierColor(item.tier)"
                >T{{ item.tier }}</span>
              </p>
              <p class="text-xs text-muted mt-0.5">
                <template v-if="isUnlocked(item.tier)">
                  Foraged by {{ foragedBy(item.id)?.emoji }} {{ foragedBy(item.id)?.name }}
                </template>
                <template v-else>
                  Foraged by ❔ ??? — unlock Habitat {{ item.tier }}
                </template>
              </p>
            </div>
          </div>
          <div class="rounded-lg bg-elevated p-2.5 mt-3 space-y-1 text-xs">
            <div class="flex items-center justify-between">
              <span class="text-muted">Sells for</span>
              <span class="font-medium">{{ formatNumber(item.sellValue, false) }} coins</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted">In storage</span>
              <span class="font-mono">{{ formatNumber(ownedQty(item.id), false) }}</span>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </UContainer>
</template>
