<script setup lang="ts">
definePageMeta({
    title: 'Pirate Raid Leaderboard'
})

const { data: captains, pending } = await useFetch('/api/pirates/leaderboard')

// Gold, silver and bronze for the podium.
const RANK_COLORS = ['#f3c35a', '#cbd5e1', '#d08a4f']

</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-6 px-3 sm:px-6">
    <header>
      <p class="pr-heading text-xs">
        Hall of
      </p>
      <h1 class="pr-display text-5xl leading-none sm:text-6xl">
        Legends
      </h1>
      <p class="pr-muted mt-2 text-sm">
        Ranked by the highest difficulty survived for all six minutes. Sunk and abandoned voyages never count.
      </p>
    </header>

    <div v-if="pending" class="space-y-2">
      <div v-for="i in 6" :key="i" class="pr-skeleton h-24" />
    </div>

    <div v-else-if="captains?.length" class="space-y-2">
      <div
        v-for="(captain, index) in captains"
        :key="captain.rank"
        class="pr-panel legend-row"
        :class="{ 'pr-glow': index < 3 || captain.isCurrentUser }"
        :style="{ '--glow': index < 3 ? RANK_COLORS[index] : '#2dd4bf', '--rank': RANK_COLORS[index] ?? '#5f7686' }"
      >
        <div class="legend-rank">
          <UIcon v-if="index === 0" name="i-lucide-crown" class="size-6" />
          <span v-else>{{ captain.rank }}</span>
        </div>

        <div class="flex min-w-0 items-center gap-3">
          <div class="legend-ship">
            <PiratesShipPreview :skin-id="captain.skin.id" :animate="index === 0" class="h-full w-full" />
          </div>
          <div class="min-w-0">
            <p class="flex items-center gap-1.5 truncate font-bold">
              <PrestigeBadge :level="captain.prestige" size="xs" /> {{ captain.name }}
              <LeaderboardYouBadge :show="captain.isCurrentUser" />
            </p>
            <p class="pr-muted truncate text-xs">
              {{ captain.skin.name }}
            </p>
            <span v-if="captain.skin.id === 'crown-of-tides'" class="pr-tag mt-1"><UIcon name="i-lucide-gem" class="size-3" />Ultimate flex</span>
          </div>
        </div>

        <div class="legend-stat">
          <span>Difficulty</span>
          <b class="pr-gold">{{ captain.difficulty }}</b>
        </div>
        <div class="legend-stat">
          <span>Ship power</span>
          <b>{{ captain.power }}</b>
        </div>
        <div class="legend-stat sm:text-right">
          <span>Best haul</span>
          <CoinBalance :value="captain.loot" class="text-lg font-black sm:justify-end" />
        </div>
      </div>
    </div>

    <div v-else class="pr-parchment py-12 text-center">
      <UIcon name="i-lucide-waves" class="mx-auto size-10 opacity-60" />
      <p class="mt-3 text-xl font-bold" style="font-family: Cinzel, serif">
        No legends yet
      </p>
      <p class="mt-1 text-sm opacity-75">
        Survive all six minutes at difficulty 0 to take the first place.
      </p>
      <PiratesButton class="mt-4" variant="gold" to="/pirates" icon="i-lucide-sailboat" label="Set sail" />
    </div>
  </div>
</template>

<style scoped>
.legend-row {
  display: grid;
  align-items: center;
  gap: 0.75rem;
  padding: 0.8rem 1rem;
}
@media (min-width: 640px) {
  .legend-row { grid-template-columns: 44px minmax(190px, 1fr) repeat(3, minmax(80px, 0.45fr)); }
}
.legend-rank {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  font-family: 'Cinzel', serif;
  font-size: 1.1rem;
  font-weight: 900;
  color: var(--rank);
  background: radial-gradient(circle, color-mix(in srgb, var(--rank) 20%, transparent), rgba(0, 0, 0, 0.4));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--rank) 70%, transparent);
}
.legend-ship {
  width: 7.5rem;
  height: 4.75rem;
  flex-shrink: 0;
  border-radius: 0.6rem;
  background: radial-gradient(ellipse at 50% 60%, rgba(45, 212, 191, 0.15), transparent 70%), linear-gradient(180deg, #0f2b3d, #081723);
  box-shadow: inset 0 0 0 1px rgba(201, 151, 60, 0.3);
}
.legend-stat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.legend-stat span { font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #5f7686; }
.legend-stat b { font-size: 1.15rem; font-weight: 900; }
@media (min-width: 640px) {
  .legend-stat { display: grid; justify-content: stretch; text-align: center; }
}
</style>
