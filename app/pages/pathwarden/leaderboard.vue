<script setup lang="ts">
definePageMeta({ title: 'Pathwarden Rankings' })
const { data, pending } = await useApiState('/api/pathwarden/leaderboard')
</script>

<template>
  <UContainer class="space-y-6 py-8">
    <header>
      <h1 class="flex items-center gap-2 text-2xl font-black">
        <UIcon name="i-lucide-trophy" class="size-7 text-warning" />
        Pathwarden Rankings
      </h1>
      <p class="mt-1 text-sm text-muted">Ranked by completed Realm, attempted Realm, wave reached, and score. Abandoned marches do not qualify.</p>
    </header>
    <LeaderboardSkeleton v-if="pending" height="h-24" />
    <div v-else-if="data?.entries.length" class="space-y-2">
      <UCard
        v-for="entry in data.entries"
        :key="entry.userId"
        :class="[entry.rank <= 3 ? 'border-warning/30 bg-warning/5' : '', entry.isCurrentUser ? 'ring-1 ring-primary/50' : '']"
        :ui="{ body: 'p-3 sm:p-4' }"
      >
        <div class="grid items-center gap-3 sm:grid-cols-[48px_minmax(150px,1fr)_repeat(4,minmax(80px,.45fr))]">
          <div class="flex size-10 items-center justify-center rounded-full border border-default bg-elevated font-black">
            <UIcon v-if="entry.rank === 1" name="i-lucide-crown" class="size-6 text-warning" />
            <span v-else>#{{ entry.rank }}</span>
          </div>
          <div class="min-w-0">
            <p class="truncate font-bold"><PrestigeBadge :level="entry.prestige" size="xs" /> {{ entry.name }} <LeaderboardYouBadge :show="entry.isCurrentUser" /></p>
            <p class="text-xs text-muted">{{ entry.runsPlayed }} ranked marches</p>
          </div>
          <div><span class="block text-[10px] uppercase text-muted">Secured realm</span><strong class="text-primary">{{ entry.completedRealm }}/5</strong></div>
          <div><span class="block text-[10px] uppercase text-muted">Best wave</span><strong>{{ entry.bestWave }}/12</strong></div>
          <div><span class="block text-[10px] uppercase text-muted">Score</span><strong>{{ formatNumber(entry.bestScore) }}</strong></div>
          <div><span class="block text-[10px] uppercase text-muted">Coins banked</span><strong class="text-warning">{{ formatNumber(entry.totalCoinsEarned) }}</strong></div>
        </div>
      </UCard>
    </div>
    <UCard v-else>
      <div class="py-10 text-center">
        <UIcon name="i-lucide-mountain-snow" class="mx-auto size-10 text-muted" />
        <p class="mt-3 font-bold">The hall is waiting for its first Warden</p>
        <UButton class="mt-4" to="/pathwarden" icon="i-lucide-castle">Defend the realm</UButton>
      </div>
    </UCard>
  </UContainer>
</template>
