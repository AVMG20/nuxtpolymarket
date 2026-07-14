<script setup lang="ts">
definePageMeta({
    title: 'Pirate Raid Leaderboard'
})

const { data: captains, pending } = await useFetch('/api/pirates/leaderboard')

const rankStyles = [
    'border-warning/40 bg-warning/10',
    'border-default bg-elevated',
    'border-warning/20 bg-warning/5'
]

</script>

<template>
  <UContainer class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="flex items-center gap-2 text-2xl font-bold">
          <UIcon name="i-lucide-trophy" class="size-6 text-warning" />
          Pirate Raid Hall of Captains
        </h1>
        <p class="mt-0.5 text-sm text-muted">
          Ranked by the highest eight-minute difficulty completed. Failed and abandoned voyages never enter the board.
        </p>
      </div>
    </div>

    <div v-if="pending" class="space-y-3">
      <USkeleton v-for="i in 8" :key="i" class="h-28 rounded-xl" />
    </div>

    <div v-else-if="captains?.length" class="space-y-2">
      <UCard
        v-for="(captain, index) in captains"
        :key="captain.userId"
        :class="index < 3 ? rankStyles[index] : ''"
        :ui="{ body: 'p-3 sm:p-4' }"
      >
        <div class="grid items-center gap-3 sm:grid-cols-[40px_minmax(190px,1fr)_repeat(3,minmax(80px,0.45fr))]">
          <div class="flex size-10 items-center justify-center rounded-full border border-default bg-default text-lg font-black tabular-nums">
            <UIcon v-if="index === 0" name="i-lucide-crown" class="size-6 text-warning" />
            <span v-else>#{{ captain.rank }}</span>
          </div>

          <div class="flex min-w-0 items-center gap-3">
            <div class="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-default bg-gradient-to-br from-info/15 via-elevated to-primary/10 p-2">
              <img :src="captain.skin.sprite" :alt="captain.skin.name" class="h-full w-full object-contain drop-shadow-lg">
            </div>
            <div class="min-w-0">
              <p class="truncate font-bold">
                {{ captain.name }}
              </p>
              <p class="truncate text-xs text-muted">
                {{ captain.skin.name }}
              </p>
              <UBadge v-if="captain.skin.id === 'crown-of-tides'" class="mt-1" color="warning" variant="subtle" size="sm" icon="i-lucide-gem" label="Ultimate flex" />
            </div>
          </div>

          <div class="flex items-center justify-between gap-2 sm:block sm:text-center">
            <span class="text-[10px] font-bold uppercase tracking-wide text-muted sm:block">Difficulty</span>
            <span class="text-lg font-black tabular-nums text-primary">{{ captain.difficulty }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 sm:block sm:text-center">
            <span class="text-[10px] font-bold uppercase tracking-wide text-muted sm:block">Ship power</span>
            <span class="text-lg font-black tabular-nums">{{ captain.power }}</span>
          </div>
          <div class="flex items-center justify-between gap-2 sm:block sm:text-right">
            <span class="text-[10px] font-bold uppercase tracking-wide text-muted sm:block">Loot secured</span>
            <CoinBalance :value="captain.loot" class="justify-end text-lg font-black tabular-nums" />
          </div>
        </div>
      </UCard>
    </div>

    <UCard v-else>
      <div class="py-10 text-center">
        <UIcon name="i-lucide-waves" class="mx-auto size-10 text-muted" />
        <p class="mt-3 font-semibold">
          No captains have returned yet
        </p>
        <p class="mt-1 text-sm text-muted">
          Complete all eight minutes at difficulty 0 to claim the first place on the board.
        </p>
        <UButton class="mt-4" to="/pirates" icon="i-lucide-anchor" label="Set Sail" />
      </div>
    </UCard>
  </UContainer>
</template>
