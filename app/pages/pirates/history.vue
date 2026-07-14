<script setup lang="ts">
definePageMeta({
    title: 'Pirate Raid History'
})

const { data: voyages, pending, error, refresh } = await useFetch('/api/pirates/history')

const totalLoot = computed(() => voyages.value?.reduce((sum, voyage) => sum + voyage.loot, 0) ?? 0)
const totalKills = computed(() => voyages.value?.reduce((sum, voyage) => sum + voyage.kills, 0) ?? 0)
const bestSurvivalMs = computed(() => voyages.value?.reduce((best, voyage) => Math.max(best, voyage.durationMs), 0) ?? 0)

function durationLabel(ms: number) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function dateLabel(value: string | Date) {
    return new Intl.DateTimeFormat('nl-NL', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Amsterdam'
    }).format(new Date(value))
}

function outcome(voyage: NonNullable<typeof voyages.value>[number]) {
    if (voyage.survived || voyage.reason === 'timeout') {
        return { label: 'Survived', icon: 'i-lucide-shield-check', color: 'success' as const }
    }
    if (voyage.reason === 'cancelled') {
        return { label: 'Returned early', icon: 'i-lucide-flag', color: 'neutral' as const }
    }
    return { label: 'Ship sunk', icon: 'i-lucide-skull', color: 'error' as const }
}
</script>

<template>
  <UContainer class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="flex items-center gap-2 text-2xl font-bold">
          <UIcon name="i-lucide-scroll-text" class="size-6 text-primary" />
          Captain's Log
        </h1>
        <p class="mt-0.5 text-sm text-muted">
          Your latest 50 server-verified voyages, newest first.
        </p>
      </div>
      <UButton color="neutral" variant="subtle" icon="i-lucide-refresh-cw" label="Refresh" :loading="pending" @click="refresh()" />
    </div>

    <div v-if="pending" class="space-y-3">
      <div class="grid gap-3 sm:grid-cols-3">
        <USkeleton v-for="i in 3" :key="i" class="h-24 rounded-xl" />
      </div>
      <USkeleton v-for="i in 8" :key="i" class="h-32 rounded-xl" />
    </div>

    <template v-else-if="voyages?.length">
      <div class="grid gap-3 sm:grid-cols-3">
        <UCard :ui="{ body: 'p-4' }">
          <div class="flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UIcon name="i-lucide-map" class="size-5" />
            </div>
            <div>
              <p class="text-xs font-bold uppercase tracking-wide text-muted">Voyages shown</p>
              <p class="text-xl font-black tabular-nums">{{ formatNumber(voyages.length, false, 0) }}</p>
            </div>
          </div>
        </UCard>
        <UCard :ui="{ body: 'p-4' }">
          <div class="flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <UIcon name="i-lucide-coins" class="size-5" />
            </div>
            <div>
              <p class="text-xs font-bold uppercase tracking-wide text-muted">Loot secured</p>
              <CoinBalance :value="totalLoot" class="text-xl font-black tabular-nums" />
            </div>
          </div>
        </UCard>
        <UCard :ui="{ body: 'p-4' }">
          <div class="flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-lg bg-success/10 text-success">
              <UIcon name="i-lucide-skull" class="size-5" />
            </div>
            <div>
              <p class="text-xs font-bold uppercase tracking-wide text-muted">Ships sunk · best time</p>
              <p class="text-xl font-black tabular-nums">{{ formatNumber(totalKills, true, 0) }} · {{ durationLabel(bestSurvivalMs) }}</p>
            </div>
          </div>
        </UCard>
      </div>

      <div class="space-y-2">
        <UCard
          v-for="voyage in voyages"
          :key="voyage.id"
          class="overflow-hidden"
          :ui="{ body: 'p-3 sm:p-4' }"
        >
          <div class="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div class="flex min-w-0 items-center gap-3 lg:w-2/5">
              <div class="flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-default bg-gradient-to-br from-info/15 via-elevated to-primary/10 p-2.5 shadow-sm">
                <img :src="voyage.skin.sprite" :alt="voyage.skin.name" class="h-full w-full object-contain drop-shadow-lg">
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-1.5">
                  <UBadge v-bind="outcome(voyage)" variant="subtle" size="sm" />
                  <UBadge color="primary" variant="subtle" size="sm" :label="`Difficulty ${voyage.difficulty}`" />
                  <span class="text-[10px] font-bold uppercase tracking-wide text-muted">Recent #{{ voyage.recentNumber }}</span>
                </div>
                <p class="mt-1.5 truncate text-base font-bold">{{ voyage.skin.name }}</p>
                <p class="truncate text-xs text-muted">{{ dateLabel(voyage.createdAt) }}</p>
                <UBadge
                  class="mt-2"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  icon="i-lucide-crosshair"
                  :label="`${formatNumber(voyage.shotsFired, true, 0)} shots fired`"
                />
              </div>
            </div>

            <div class="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
              <div class="rounded-xl bg-elevated/60 px-3 py-3">
                <div class="flex items-center gap-1.5 text-muted">
                  <UIcon name="i-lucide-timer" class="size-3.5" />
                  <span class="text-[10px] font-bold uppercase tracking-wide">Survived</span>
                </div>
                <p class="mt-1 text-xl font-black tabular-nums">{{ durationLabel(voyage.durationMs) }}</p>
              </div>
              <div class="rounded-xl bg-primary/10 px-3 py-3">
                <div class="flex items-center gap-1.5 text-primary">
                  <UIcon name="i-lucide-gauge" class="size-3.5" />
                  <span class="text-[10px] font-bold uppercase tracking-wide">Power</span>
                </div>
                <p class="mt-1 text-xl font-black tabular-nums text-primary">{{ voyage.power }}</p>
              </div>
              <div class="rounded-xl bg-elevated/60 px-3 py-3">
                <div class="flex items-center gap-1.5 text-muted">
                  <UIcon name="i-lucide-skull" class="size-3.5" />
                  <span class="text-[10px] font-bold uppercase tracking-wide">Ships sunk</span>
                </div>
                <p class="mt-1 text-xl font-black tabular-nums">{{ formatNumber(voyage.kills, true, 0) }}</p>
              </div>
              <div class="rounded-xl bg-warning/10 px-3 py-3">
                <div class="flex items-center gap-1.5 text-warning">
                  <UIcon name="i-lucide-coins" class="size-3.5" />
                  <span class="text-[10px] font-bold uppercase tracking-wide">Loot</span>
                </div>
                <CoinBalance :value="voyage.loot" class="mt-1 text-xl font-black tabular-nums" />
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </template>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Could not load the captain's log"
      description="Try refreshing the page in a moment."
    />

    <UCard v-else>
      <div class="py-10 text-center">
        <UIcon name="i-lucide-scroll-text" class="mx-auto size-10 text-muted" />
        <p class="mt-3 font-semibold">Your captain's log is empty</p>
        <p class="mt-1 text-sm text-muted">Complete a voyage and its results will appear here.</p>
        <UButton class="mt-4" to="/pirates" icon="i-lucide-anchor" label="Set Sail" />
      </div>
    </UCard>
  </UContainer>
</template>
