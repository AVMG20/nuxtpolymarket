<script setup lang="ts">
import { BUG_TYPES, TIER_NAMES, getItem } from '#shared/utils/colony'

const colony = useColony()
const { habitatLevel } = colony

const tiers = computed(() => {
  const grouped = new Map<number, typeof BUG_TYPES>()
  for (const bug of BUG_TYPES) {
    const list = grouped.get(bug.tier) ?? []
    list.push(bug)
    grouped.set(bug.tier, list)
  }
  return [...grouped.entries()].sort((a, b) => a[0] - b[0])
})

function isUnlocked(tier: number, isStarter?: boolean) {
  return !!isStarter || tier <= habitatLevel.value
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
        Every species in the colony. Higher tiers unlock as you raise your Habitat Level in the Market.
      </p>
    </div>

    <div
      v-for="[tier, species] in tiers"
      :key="tier"
    >
      <h2 class="text-sm font-semibold text-muted uppercase tracking-wider mb-2">
        Tier {{ tier }} — {{ TIER_NAMES[tier] }}
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <UCard
          v-for="bug in species"
          :key="bug.id"
          :class="!isUnlocked(bug.tier, bug.isStarter) && 'opacity-60'"
        >
          <div class="flex items-start gap-3">
            <span class="text-2xl leading-none">{{ isUnlocked(bug.tier, bug.isStarter) ? bug.emoji : '❔' }}</span>
            <div class="min-w-0 flex-1">
              <p class="font-medium text-sm">
                {{ isUnlocked(bug.tier, bug.isStarter) ? bug.name : '???' }}
              </p>
              <p class="text-xs text-muted mt-0.5">
                {{ isUnlocked(bug.tier, bug.isStarter) ? bug.description : `Requires Habitat Level ${bug.tier}` }}
              </p>
              <p
                v-if="isUnlocked(bug.tier, bug.isStarter)"
                class="text-xs text-muted mt-1.5 flex items-center gap-1"
              >
                Forages {{ getItem(bug.itemId)?.emoji }} {{ getItem(bug.itemId)?.name }}
                <UIcon
                  :name="bug.social ? 'i-lucide-users' : 'i-lucide-user'"
                  class="size-3 ml-1"
                />
                {{ bug.social ? 'Social' : 'Solitary' }}
              </p>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </UContainer>
</template>
