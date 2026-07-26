<script setup lang="ts">
definePageMeta({ title: 'Void Leaderboard' })

const { data: rows } = await useFetch('/api/void/leaderboard')
</script>

<template>
  <UContainer class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold">
        Deepest runners
      </h1>
      <p class="mt-0.5 text-sm text-muted">
        Ranked by the deepest sector successfully extracted from, then by the most valuable haul ever brought home.
      </p>
    </div>

    <UCard v-if="!rows?.length" :ui="{ body: 'p-10' }">
      <div class="text-center text-sm text-muted">
        <UIcon name="i-lucide-trophy" class="mx-auto mb-2 size-8" />
        Nobody has docked with a haul yet. Be first.
      </div>
    </UCard>

    <div v-else class="space-y-1.5">
      <UCard
        v-for="row in rows"
        :key="row.rank"
        :ui="{ body: 'p-3' }"
        :class="row.isCurrentUser ? 'ring-2 ring-primary' : ''"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <span
              class="flex size-8 items-center justify-center rounded-full text-sm font-black tabular-nums"
              :class="row.rank <= 3 ? 'bg-warning/20 text-warning' : 'bg-elevated text-muted'"
            >
              {{ row.rank }}
            </span>
            <div>
              <p class="font-bold">
                {{ row.name }}
              </p>
              <p class="text-xs text-muted">
                {{ row.shipName }} · {{ row.extractions }} extractions
              </p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <UBadge color="primary" variant="subtle" :label="`Sector ${row.sector} · ${row.sectorName}`" icon="i-lucide-radar" />
            <UBadge color="neutral" variant="subtle" :label="`${row.bestUnits} units`" icon="i-lucide-package" />
            <UBadge color="warning" variant="subtle" icon="i-lucide-hand-coins">
              <CoinBalance :value="row.bestCredits" />
            </UBadge>
          </div>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
