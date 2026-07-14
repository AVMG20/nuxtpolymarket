<script setup lang="ts">
import {
  MAX_TRAIT_PCT,
  MAX_YIELD_LEVEL,
  SOCIAL_BONUS_PER_PEER,
  SOCIAL_MAX_BONUS,
  SOLITARY_BONUS_ALONE,
  SOLITARY_PENALTY_PER_PEER
} from '#shared/utils/colony'
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
        A quick guide to production, traits, nutrition and colony growth.
      </p>
    </div>

    <UAlert
      color="primary"
      variant="subtle"
      icon="i-lucide-lightbulb"
      title="The colony loop"
      description="Buy bugs, place them in the terrarium, keep nutrition stocked, collect their forage, then decide what to sell and what to save for Habitat upgrades."
    />

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
            Rolled 0–{{ MAX_TRAIT_PCT }}% on purchase. It shortens cycle time, so faster bugs produce and eat more often. Habitat speed adds a flat colony-wide bonus.
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
            A fixed level rolled on purchase. Each cycle drops between 1 and yield level + 1 items. Research raises future roll ranges up to level {{ MAX_YIELD_LEVEL }}.
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
            Nutrition spent when the bug finishes a cycle. Yield never changes the meal; speed only increases consumption by completing cycles more often.
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
            Social species gain +{{ (SOCIAL_BONUS_PER_PEER * 100).toFixed(0) }}% speed per same-species neighbor, up to +{{ (SOCIAL_MAX_BONUS * 100).toFixed(0) }}%. Solitary bugs get +{{ (SOLITARY_BONUS_ALONE * 100).toFixed(0) }}% alone and lose {{ (SOLITARY_PENALTY_PER_PEER * 100).toFixed(0) }}% per neighbor.
          </p>
        </UCard>
      </div>
    </div>

    <div>
      <h2 class="text-sm font-semibold uppercase tracking-wider mb-2">
        Useful rules
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <UCard variant="soft">
          <UIcon
            name="i-lucide-package-open"
            class="size-5 text-warning mb-2"
          />
          <p class="font-semibold text-sm">
            Loot waits safely
          </p>
          <p class="text-xs text-muted mt-1">
            Finished cycles add forage to the loot chest. Collecting moves everything into storage; only stored items can be sold or spent on upgrades.
          </p>
        </UCard>
        <UCard variant="soft">
          <UIcon
            name="i-lucide-heart-pulse"
            class="size-5 text-error mb-2"
          />
          <p class="font-semibold text-sm">
            No food, no progress
          </p>
          <p class="text-xs text-muted mt-1">
            If the colony cannot pay a bug's meal, its production pauses just before completion until nutrition becomes available.
          </p>
        </UCard>
        <UCard variant="soft">
          <UIcon
            name="i-lucide-hammer"
            class="size-5 text-primary mb-2"
          />
          <p class="font-semibold text-sm">
            One builder
          </p>
          <p class="text-xs text-muted mt-1">
            Track upgrades and Habitat levels share one builder. Keep early bugs working because later construction still needs their materials.
          </p>
        </UCard>
      </div>
    </div>
  </UContainer>
</template>
