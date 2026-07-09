<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getItem } from '#shared/utils/colony'
import { formatDuration, progressPct } from '~/utils/colony-format'

const colony = useColony()
const { upgrades, builder, builderCount, inventory, habitatLevel, maxTier, habitatLevelUpCost } = colony

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

const now = ref(Date.now())
let interval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  interval = setInterval(() => {
    now.value = Date.now()
  }, 500)
})
onUnmounted(() => {
  if (interval) clearInterval(interval)
})

const builderReady = computed(() => {
  if (!builder.value) return false
  return now.value >= new Date(builder.value.completesAt).getTime()
})

const tracksMeetingRequirement = computed(() => upgrades.value.filter((t: any) => t.meetsHabitatRequirement).length)
const habitatUpgradeReady = computed(() => tracksMeetingRequirement.value === upgrades.value.length && upgrades.value.length > 0)
const canAffordHabitatLevelUp = computed(() => balance.value >= habitatLevelUpCost.value)

function ownedQty(itemTypeId: string) {
  const owned = inventory.value.find((i: any) => i.id === itemTypeId)
  return owned?.quantity ?? 0
}

function affordCost(cost: { coins: number, items: { itemTypeId: string, quantity: number }[] } | null) {
  if (!cost) return false
  if (balance.value < cost.coins) return false
  return cost.items.every(need => ownedQty(need.itemTypeId) >= need.quantity)
}
</script>

<template>
  <div class="p-4 md:p-6 w-full space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <h1 class="text-lg font-bold flex items-center gap-2">
          <UIcon
            name="i-lucide-home"
            class="text-primary"
          />
          Habitat
        </h1>
        <p class="text-sm text-muted">
          Every track has to reach its required level before you can raise your Habitat Level and unlock the next bug tier.
        </p>
      </div>
      <UBadge
        color="neutral"
        variant="subtle"
        size="lg"
        class="gap-1.5"
      >
        <UIcon
          name="i-lucide-hammer"
          class="size-4"
        />
        {{ builder ? 1 : 0 }} / {{ builderCount }} builders busy
      </UBadge>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Habitat Level -->
      <UCard>
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-medium text-muted flex items-center gap-1.5">
            <UIcon
              name="i-lucide-castle"
              class="size-4"
            />
            Habitat Level
          </span>
          <span class="text-lg font-bold font-mono">{{ habitatLevel }} <span class="text-muted text-sm font-normal">/ {{ maxTier }}</span></span>
        </div>

        <div
          v-if="habitatLevel < maxTier"
          class="space-y-3"
        >
          <p class="text-xs text-muted uppercase tracking-wider font-medium">
            Requirements for Level {{ habitatLevel + 1 }}
          </p>
          <div class="space-y-1.5">
            <div
              v-for="track in upgrades"
              :key="track.id"
              class="flex items-center justify-between text-sm rounded-lg px-2.5 py-1.5"
              :class="track.meetsHabitatRequirement ? 'bg-success/10' : 'bg-elevated'"
            >
              <span class="flex items-center gap-2">
                <UIcon
                  :name="track.icon"
                  class="size-3.5 text-muted"
                />
                {{ track.name }}
              </span>
              <span
                class="flex items-center gap-1.5 font-mono text-xs"
                :class="track.meetsHabitatRequirement ? 'text-success' : 'text-error'"
              >
                Lv {{ track.level }} / {{ track.requiredLevel }}
                <UIcon
                  :name="track.meetsHabitatRequirement ? 'i-lucide-check-circle-2' : 'i-lucide-x-circle'"
                  class="size-4"
                />
              </span>
            </div>
          </div>
          <UButton
            block
            size="sm"
            color="primary"
            :disabled="!habitatUpgradeReady || !canAffordHabitatLevelUp"
            @click="colony.upgradeHabitatLevel"
          >
            <span v-if="!habitatUpgradeReady">Requirements not met</span>
            <span v-else>
              Upgrade to Level {{ habitatLevel + 1 }} —
              <span :class="canAffordHabitatLevelUp ? 'text-success' : 'text-muted'">{{ canAffordHabitatLevelUp ? 'affordable' : 'need more coins' }}</span>
            </span>
          </UButton>
        </div>
        <p
          v-else
          class="text-sm text-center text-muted py-2"
        >
          Habitat is at maximum level.
        </p>
      </UCard>

      <!-- Builder -->
      <UCard>
        <div class="flex items-center gap-2 mb-2">
          <UIcon
            name="i-lucide-hammer"
            class="text-primary size-4"
          />
          <span class="text-sm font-medium text-muted">Builder</span>
        </div>
        <template v-if="builder">
          <p class="text-sm font-medium mb-1.5">
            Building {{ builder.trackName }} → Level {{ builder.level }}
          </p>
          <div class="h-2 rounded-full bg-elevated overflow-hidden mb-1.5">
            <div
              class="h-full bg-primary transition-all"
              :style="{ width: progressPct(builder.startedAt, builder.completesAt, now) + '%' }"
            />
          </div>
          <p class="text-xs text-muted mb-3">
            {{ builderReady ? 'Ready to collect!' : formatDuration(new Date(builder.completesAt).getTime() - now) + ' remaining' }}
          </p>
          <UButton
            block
            size="sm"
            color="primary"
            :disabled="!builderReady"
            @click="colony.collectUpgrade"
          >
            Collect
          </UButton>
        </template>
        <div
          v-else
          class="flex flex-col items-center justify-center py-4 gap-1.5 text-center"
        >
          <UIcon
            name="i-lucide-coffee"
            class="size-6 text-muted"
          />
          <p class="text-sm text-muted">
            Idle — start an upgrade below.
          </p>
        </div>
      </UCard>
    </div>

    <!-- Tracks -->
    <div>
      <h2 class="text-sm font-semibold text-muted uppercase tracking-wider mb-2">
        Upgrade Tracks
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <UCard
          v-for="track in upgrades"
          :key="track.id"
          :ui="{ body: 'p-0' }"
        >
          <div class="p-4 space-y-3">
            <div class="flex items-start gap-3">
              <div class="size-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <UIcon
                  :name="track.icon"
                  class="size-5 text-primary"
                />
              </div>
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-sm flex items-center gap-1.5">
                  {{ track.name }}
                  <UBadge
                    size="xs"
                    variant="subtle"
                    :color="track.meetsHabitatRequirement ? 'success' : 'neutral'"
                  >
                    Lv {{ track.level }}{{ track.atMax ? ' (max)' : '' }}
                  </UBadge>
                </p>
                <p class="text-xs text-muted mt-0.5">
                  {{ track.description }}
                </p>
              </div>
            </div>

            <div class="rounded-lg bg-elevated p-2.5 space-y-1">
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted">Currently</span>
                <span class="font-mono font-medium text-highlighted">{{ track.currentEffect }}</span>
              </div>
              <div
                v-if="!track.atMax"
                class="flex items-center justify-between text-xs"
              >
                <span class="text-muted flex items-center gap-1">
                  <UIcon
                    name="i-lucide-arrow-right"
                    class="size-3"
                  />
                  Next level
                </span>
                <span class="font-mono font-medium text-primary">{{ track.nextEffect }}</span>
              </div>
            </div>
          </div>

          <template v-if="!track.atMax">
            <USeparator />
            <div class="p-4 space-y-2">
              <div class="flex flex-wrap items-center gap-1.5">
                <UBadge
                  :color="balance >= track.nextCost.coins ? 'success' : 'neutral'"
                  variant="subtle"
                  size="sm"
                >
                  <UIcon
                    name="i-lucide-coins"
                    class="size-3 mr-0.5"
                  />
                  {{ balance >= track.nextCost.coins ? 'Enough' : 'Short' }}
                </UBadge>
                <UBadge
                  v-for="need in track.nextCost.items"
                  :key="need.itemTypeId"
                  :color="ownedQty(need.itemTypeId) >= need.quantity ? 'success' : 'neutral'"
                  variant="subtle"
                  size="sm"
                >
                  {{ getItem(need.itemTypeId)?.emoji }} {{ formatNumber(ownedQty(need.itemTypeId), false) }}/{{ formatNumber(need.quantity, false) }}
                </UBadge>
                <UBadge
                  color="neutral"
                  variant="subtle"
                  size="sm"
                >
                  <UIcon
                    name="i-lucide-clock"
                    class="size-3 mr-0.5"
                  />
                  {{ formatDuration(track.nextDurationMs) }}
                </UBadge>
              </div>
              <UButton
                block
                size="sm"
                color="primary"
                :disabled="!!builder || !affordCost(track.nextCost)"
                @click="colony.startUpgrade(track.id)"
              >
                {{ builder ? 'Builder busy' : !affordCost(track.nextCost) ? 'Not enough resources' : 'Build' }}
              </UButton>
            </div>
          </template>
          <div
            v-else
            class="p-4"
          >
            <p class="text-xs text-success flex items-center gap-1">
              <UIcon
                name="i-lucide-check-circle"
                class="size-3.5"
              />
              Maxed out
            </p>
          </div>
        </UCard>
      </div>
    </div>
  </div>
</template>
