<script setup lang="ts">
import { formatHq } from '#shared/utils/hero-quest/numbers'

/**
 * The prestige shop's route, drawn on the stage as the Prestige scene. Prestiging itself happens on
 * the bridge a cleared run stands on, and the class tree has its own route.
 */
const { initialized, shop, voidShards, nextPrestigeReward, buyUpgrade } = useHeroQuest()

const busy = ref(false)

async function withBusy(action: () => Promise<unknown>) {
    busy.value = true
    try {
        await action()
    } finally {
        busy.value = false
    }
}
</script>

<template>
  <div class="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
    <div
      v-if="!initialized"
      class="text-center py-16 text-muted"
    >
      Start a run first.
    </div>

    <template v-else>
      <div class="rounded-lg border border-default bg-elevated/40 p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-xs text-muted">
            Void Shards
          </p>
          <p class="text-xl font-semibold text-primary">
            {{ formatHq(voidShards) }}
          </p>
        </div>
        <div class="text-right">
          <p class="text-xs text-muted">
            Next full clear pays
          </p>
          <p class="text-lg font-medium text-highlighted">
            {{ formatHq(nextPrestigeReward) }}
          </p>
        </div>
      </div>

      <div>
        <h2 class="text-sm font-medium text-highlighted mb-3">
          Prestige shop
        </h2>
        <HeroQuestPrestigeShop
          :tracks="shop"
          :void-shards="voidShards"
          :busy="busy"
          @buy="id => withBusy(() => buyUpgrade(id))"
        />
      </div>

    </template>
  </div>
</template>
