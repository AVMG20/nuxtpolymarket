<script setup lang="ts">
/**
 * The prestige shop.
 *
 * **Two currencies.** Loadout slots are priced in Gems (`loadouts.md` §3), everything else in
 * Void Shards, so affordability is checked against whichever balance the track names and the icon
 * says which one is being spent.
 */
defineProps<{
    tracks: {
        id: string
        name: string
        description: string
        level: number
        maxLevel: number | null
        nextCost: number | null
        currency: 'voidShards' | 'gems'
        effect: { current: string; next: string | null }
    }[]
    voidShards: string
    busy?: boolean
}>()

const emit = defineEmits<{ buy: [upgradeId: string] }>()

const { user } = useAuth()
const gems = computed(() => user.value?.gems ?? 0)

function affordable(cost: number | null, currency: 'voidShards' | 'gems', shards: string) {
    if (cost === null) return false
    return currency === 'gems' ? gems.value >= cost : Number(shards) >= cost
}
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="track in tracks"
      :key="track.id"
      class="rounded-lg border border-default bg-elevated/40 p-4"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-medium text-highlighted">{{ track.name }}</span>
            <UBadge
              color="neutral"
              variant="subtle"
              size="sm"
            >
              {{ track.maxLevel === null ? `Level ${track.level}` : `${track.level} / ${track.maxLevel}` }}
            </UBadge>
          </div>
          <p class="text-sm text-muted mt-0.5">
            {{ track.description }}
          </p>
          <p class="text-sm mt-1.5">
            <span class="text-highlighted font-medium">{{ track.effect.current }}</span>
            <template v-if="track.effect.next">
              <UIcon
                name="i-lucide-arrow-right"
                class="size-3 mx-1 text-muted align-middle"
              />
              <span class="text-primary font-medium">{{ track.effect.next }}</span>
            </template>
          </p>
        </div>

        <div class="shrink-0 text-right">
          <UButton
            :disabled="!affordable(track.nextCost, track.currency, voidShards) || busy"
            :icon="track.nextCost === null
              ? 'i-lucide-check'
              : track.currency === 'gems' ? 'i-lucide-gem' : 'i-lucide-sparkles'"
            size="sm"
            @click="emit('buy', track.id)"
          >
            {{ track.nextCost === null ? 'Maxed' : formatNumber(track.nextCost) }}
          </UButton>
          <p
            v-if="track.nextCost !== null"
            class="text-xs text-muted mt-1"
          >
            {{ track.currency === 'gems' ? 'Gems' : 'Void Shards' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
