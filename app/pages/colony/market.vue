<script setup lang="ts">
import { TIER_NAMES } from '#shared/utils/colony'

const colony = useColony()
const { speciesCatalog, inventory, feedCost, nutrition, nutritionMax } = colony

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

const tab = ref('buy')
const tabItems = [
  { label: 'Buy bugs', value: 'buy', icon: 'i-lucide-shopping-basket' },
  { label: 'Sell items', value: 'sell', icon: 'i-lucide-coins' },
  { label: 'Feed', value: 'feed', icon: 'i-lucide-heart-pulse' }
]
</script>

<template>
  <UContainer class="py-4 space-y-4">
    <UTabs
      v-model="tab"
      :items="tabItems"
      class="w-full"
    />

    <!-- Buy -->
    <p
      v-if="tab === 'buy'"
      class="text-xs text-muted"
    >
      Bought bugs go to your inventory — place them in the terrarium from the main game page.
    </p>
    <div
      v-if="tab === 'buy'"
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
    >
      <UCard
        v-for="species in speciesCatalog"
        :key="species.id"
        :class="!species.buyable && 'opacity-60'"
      >
        <div class="flex items-start gap-3">
          <span class="text-2xl leading-none">{{ species.buyable ? species.emoji : '❔' }}</span>
          <div class="min-w-0 flex-1">
            <p class="font-medium text-sm truncate flex items-center gap-1.5">
              {{ species.buyable ? species.name : '???' }}
              <UBadge
                size="xs"
                variant="subtle"
                color="neutral"
              >
                {{ TIER_NAMES[species.tier] }}
              </UBadge>
            </p>
            <p class="text-xs text-muted mt-0.5">
              {{ species.buyable ? species.description : `Requires Habitat Level ${species.tier}` }}
            </p>
            <p
              v-if="species.buyable"
              class="text-xs text-muted mt-1"
            >
              Owned: {{ species.owned }}
            </p>
          </div>
        </div>
        <UButton
          block
          size="xs"
          class="mt-3"
          color="primary"
          :disabled="!species.buyable || balance < species.spawnCost"
          @click="colony.buyBug(species.id)"
        >
          {{ species.buyable ? `Buy — ${formatNumber(species.spawnCost, false)} coins` : 'Locked' }}
        </UButton>
      </UCard>
    </div>

    <!-- Sell -->
    <div
      v-if="tab === 'sell'"
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
    >
      <UCard
        v-for="item in inventory"
        :key="item.id"
        :class="item.quantity <= 0 && 'opacity-50'"
      >
        <div class="flex items-center gap-3">
          <span class="text-2xl leading-none">{{ item.emoji }}</span>
          <div class="min-w-0 flex-1">
            <p class="font-medium text-sm">
              {{ item.name }}
            </p>
            <p class="text-xs text-muted">
              Owned: {{ formatNumber(item.quantity, false) }} · {{ item.sellValue }} coins each
            </p>
          </div>
        </div>
        <UButton
          block
          size="xs"
          class="mt-3"
          color="primary"
          :disabled="item.quantity <= 0"
          @click="colony.sellItem(item.id)"
        >
          Sell all — {{ formatNumber(item.quantity * item.sellValue, false) }} coins
        </UButton>
      </UCard>
    </div>

    <!-- Feed -->
    <UCard
      v-if="tab === 'feed'"
      class="max-w-md"
    >
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-medium text-muted">Colony Nutrition</span>
        <span class="text-sm font-mono">{{ nutrition }} / {{ nutritionMax }}</span>
      </div>
      <div class="h-2 rounded-full bg-elevated overflow-hidden mb-3">
        <div
          class="h-full bg-primary transition-all"
          :style="{ width: (nutrition / nutritionMax) * 100 + '%' }"
        />
      </div>
      <p class="text-sm text-muted mb-3">
        Every bug eats over time — the bigger and rarer your colony, the faster nutrition drains. Feeding refills the tank all the way. Upgrade Nutrition Storage and Nutrition Efficiency in the Habitat tab to make it last longer.
      </p>
      <UButton
        block
        color="primary"
        icon="i-lucide-heart-pulse"
        :disabled="balance < feedCost"
        @click="colony.feedSwarm"
      >
        Feed colony — {{ formatNumber(feedCost, false) }} coins
      </UButton>
    </UCard>
  </UContainer>
</template>
