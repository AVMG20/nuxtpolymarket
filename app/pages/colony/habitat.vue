<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getItem, BUG_TYPES } from '#shared/utils/colony'
import { tierColor } from '#shared/utils/xeno'
import { formatDuration, progressPct } from '~/utils/colony-format'

// Rich stat-block tooltip content, matching the terrarium page's convention —
// UTooltip's default content class clips multi-line #content slots to a
// fixed 24px height, so it needs overriding to size to content.
const TOOLTIP_CONTENT_UI = 'h-auto max-w-64 p-3 flex-col items-start bg-default ring ring-default rounded-lg shadow-lg z-50'

function foragedBy(itemId: string) {
  return BUG_TYPES.find(b => b.itemId === itemId)
}

const colony = useColony()
const { upgrades, builder, builderCount, inventory, habitatLevel, maxTier, habitatLevelUpCost, habitatLevelUpGemCost } = colony

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)

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
const canAffordHabitatLevelUp = computed(() =>
  habitatLevelUpCost.value !== null
  && balance.value >= habitatLevelUpCost.value
  && gems.value >= (habitatLevelUpGemCost.value ?? 0)
)

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
              Upgrade to Level {{ habitatLevel + 1 }} — {{ formatNumber(habitatLevelUpCost ?? 0) }} coins + {{ formatNumber(habitatLevelUpGemCost ?? 0, false) }} 💎{{ canAffordHabitatLevelUp ? '' : ' (not enough)' }}
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
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <UCard
          v-for="track in upgrades"
          :key="track.id"
          :ui="{ body: 'p-0' }"
        >
          <div class="p-3 space-y-2.5">
            <div class="flex items-center gap-2.5">
              <div class="flex flex-col items-center leading-none shrink-0 w-9">
                <span class="text-[9px] font-bold text-muted uppercase tracking-wider">Lv</span>
                <span class="text-2xl font-black text-primary tabular-nums">{{ track.level }}</span>
              </div>
              <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <UIcon
                  :name="track.icon"
                  class="size-4.5 text-primary"
                />
              </div>
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-sm">
                  {{ track.name }}
                  <span
                    v-if="track.atMax"
                    class="text-[10px] text-muted font-normal"
                  >(max)</span>
                </p>
                <p class="text-xs text-muted mt-0.5 line-clamp-1">
                  {{ track.description }}
                </p>
              </div>
            </div>

            <div class="rounded-lg bg-elevated p-2 space-y-1">
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
            <div class="p-3 space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <UBadge
                  :color="balance >= (track.nextCost?.coins ?? 0) ? 'success' : 'neutral'"
                  variant="subtle"
                  size="lg"
                  class="text-sm font-semibold"
                >
                  <UIcon
                    name="i-lucide-coins"
                    class="size-4 mr-1"
                  />
                  {{ formatNumber(track.nextCost?.coins ?? 0, false) }}
                </UBadge>
                <UTooltip
                  v-for="need in track.nextCost?.items ?? []"
                  :key="need.itemTypeId"
                  :delay-duration="150"
                  :content="{ side: 'top', sideOffset: 6 }"
                  :ui="{ content: TOOLTIP_CONTENT_UI }"
                >
                  <template #content>
                    <div class="flex items-center gap-2 mb-1.5">
                      <span class="text-xl leading-none">{{ getItem(need.itemTypeId)?.emoji }}</span>
                      <div class="min-w-0">
                        <p class="font-bold text-sm flex items-center gap-1.5">
                          {{ getItem(need.itemTypeId)?.name }}
                          <span
                            class="text-xs font-black"
                            :class="tierColor(getItem(need.itemTypeId)?.tier ?? 1)"
                          >T{{ getItem(need.itemTypeId)?.tier }}</span>
                        </p>
                      </div>
                    </div>
                    <USeparator class="mb-1.5" />
                    <div class="w-full space-y-1 text-xs">
                      <div class="flex justify-between gap-4">
                        <span class="text-muted uppercase tracking-wider font-semibold">Foraged by</span>
                        <span class="font-mono">{{ foragedBy(need.itemTypeId)?.emoji }} {{ foragedBy(need.itemTypeId)?.name ?? '???' }}</span>
                      </div>
                      <div class="flex justify-between gap-4">
                        <span class="text-muted uppercase tracking-wider font-semibold">Have</span>
                        <span class="font-mono">{{ formatNumber(ownedQty(need.itemTypeId), false) }} / {{ formatNumber(need.quantity, false) }}</span>
                      </div>
                      <div class="flex justify-between gap-4">
                        <span class="text-muted uppercase tracking-wider font-semibold">Sells for</span>
                        <span class="font-mono">{{ formatNumber(getItem(need.itemTypeId)?.sellValue ?? 0, false) }} coins</span>
                      </div>
                    </div>
                  </template>
                  <UBadge
                    :color="ownedQty(need.itemTypeId) >= need.quantity ? 'success' : 'neutral'"
                    variant="subtle"
                    size="lg"
                    class="text-sm font-semibold cursor-default"
                  >
                    {{ getItem(need.itemTypeId)?.emoji }} {{ formatNumber(ownedQty(need.itemTypeId), false) }}/{{ formatNumber(need.quantity, false) }}
                  </UBadge>
                </UTooltip>
                <UBadge
                  color="neutral"
                  variant="subtle"
                  size="lg"
                  class="text-sm font-semibold"
                >
                  <UIcon
                    name="i-lucide-clock"
                    class="size-4 mr-1"
                  />
                  {{ formatDuration(track.nextDurationMs ?? 0) }}
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
