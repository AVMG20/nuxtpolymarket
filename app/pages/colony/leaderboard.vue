<script setup lang="ts">
import { MAX_TIER } from '#shared/utils/colony'

const { data: players, pending } = await useFetch('/api/colony/leaderboard')

type Player = NonNullable<typeof players.value>[number]

const TIER_HEX = ['#4ade80', '#60a5fa', '#facc15', '#c084fc', '#fb923c', '#f87171']
const MEDALS = [
  { fill: 'linear-gradient(180deg,#fde68a,#f59e0b)', glow: 'rgba(251,191,36,.7)' },
  { fill: 'linear-gradient(180deg,#f1f5f9,#94a3b8)', glow: 'rgba(203,213,225,.5)' },
  { fill: 'linear-gradient(180deg,#fdba74,#c2410c)', glow: 'rgba(251,146,60,.5)' }
]

/** Podium order is 2nd, 1st, 3rd so the winner stands in the middle. */
const podium = computed(() => {
  const top = (players.value ?? []).slice(0, 3).map((player, rank) => ({ player, rank }))
  return top.length === 3 ? [top[1]!, top[0]!, top[2]!] : top
})
const rest = computed(() => (players.value ?? []).slice(3))

/** Anthill height follows the Habitat Level, so the deepest colony stands tallest. */
function moundHeight(player: Player, rank: number) {
  return `${96 + Math.min(player.habitatLevel, MAX_TIER) * 18 + (rank === 0 ? 16 : 0)}px`
}

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?'
}
</script>

<template>
  <div class="max-w-[1100px] mx-auto px-4 py-4 md:p-6 space-y-6">
    <div class="text-center">
      <p class="cl-eyebrow">
        Deepest colonies
      </p>
      <h1 class="cl-display text-3xl sm:text-[34px] font-bold">
        Leaderboard
      </h1>
      <p class="text-[13px] text-muted">
        Ranked by Habitat level, then total bug and stored-item value.
      </p>
    </div>

    <LeaderboardSkeleton
      v-if="pending"
      :rows="6"
    />

    <template v-else-if="players?.length">
      <!-- Anthill podium -->
      <div
        class="grid gap-2.5 sm:gap-3.5 items-end pt-4"
        :class="podium.length === 3 ? 'grid-cols-3' : podium.length === 2 ? 'grid-cols-2' : 'grid-cols-1 max-w-xs mx-auto w-full'"
      >
        <div
          v-for="{ player, rank } in podium"
          :key="player.name"
          class="flex flex-col items-center gap-1.5 sm:gap-2 min-w-0"
        >
          <div class="relative">
            <span
              class="size-12 sm:size-16 rounded-full grid place-items-center cl-display text-xl sm:text-2xl font-bold text-[#1a1205]"
              :style="{ background: MEDALS[rank]!.fill, boxShadow: `0 0 0 4px #2a2019, 0 0 26px ${MEDALS[rank]!.glow}` }"
            >{{ initial(player.name) }}</span>
            <span class="cl-chip absolute left-1/2 -bottom-2.5 -translate-x-1/2 px-2 py-px text-[11px] bg-[#1e1712]">#{{ rank + 1 }}</span>
          </div>
          <div class="flex items-center gap-1 mt-1.5 max-w-full min-w-0">
            <PrestigeBadge
              :level="player.prestige"
              size="xs"
            />
            <span class="cl-display text-[15px] sm:text-lg font-bold truncate">{{ player.name }}</span>
          </div>
          <span
            v-if="player.isCurrentUser"
            class="cl-chip cl-chip-gold -mt-1"
          >You</span>
          <span class="cl-display cl-num text-lg sm:text-xl font-bold text-amber-400">{{ formatNumber(player.colonyValue) }}</span>
          <div
            class="cl-mound w-full grid place-items-center pt-9 sm:pt-10"
            :style="{ height: moundHeight(player, rank) }"
          >
            <span class="grid justify-items-center gap-0.5 text-center px-1">
              <span class="cl-lvl w-9 h-10 sm:w-11 sm:h-[50px] text-lg sm:text-xl">{{ player.habitatLevel }}</span>
              <span class="text-xs font-extrabold text-amber-100/90">Habitat {{ player.habitatLevel }}</span>
              <span class="text-[11px] sm:text-xs font-bold text-muted hidden min-[400px]:block">{{ formatNumber(player.bugCount) }} bugs · {{ player.speciesOwned }} species</span>
            </span>
          </div>
        </div>
      </div>

      <!-- Everyone else -->
      <ol
        v-if="rest.length"
        class="flex flex-col gap-2"
      >
        <li
          v-for="(player, index) in rest"
          :key="player.name"
          class="cl-panel flex items-center gap-3 sm:gap-3.5 px-3.5 sm:px-4 py-3 flex-wrap"
          :class="player.isCurrentUser && 'cl-you-glow'"
        >
          <span class="cl-display cl-num w-8 text-xl font-bold text-muted">{{ index + 4 }}</span>
          <span class="flex-[1_1_140px] min-w-0">
            <span class="flex items-center gap-1.5 min-w-0">
              <PrestigeBadge
                :level="player.prestige"
                size="xs"
              />
              <span class="cl-display text-[17px] font-semibold truncate">{{ player.name }}</span>
              <span
                v-if="player.isCurrentUser"
                class="cl-chip cl-chip-gold"
              >You</span>
            </span>
            <span class="block text-xs text-muted cl-num">
              {{ formatNumber(player.bugCount) }} bugs · {{ player.placedBugCount }} active · {{ player.speciesOwned }} species · {{ formatNumber(player.itemCount) }} items
            </span>
          </span>
          <span class="order-last sm:order-none w-full sm:w-auto sm:flex-[0_1_200px] grid gap-1">
            <span
              class="grid grid-cols-6 gap-[3px]"
              :aria-label="`Habitat ${player.habitatLevel} of ${MAX_TIER}`"
              role="img"
            >
              <span
                v-for="(hex, i) in TIER_HEX.slice(0, MAX_TIER)"
                :key="i"
                class="h-2.5 rounded-[3px]"
                :style="{ background: i < player.habitatLevel ? hex : 'rgba(255,236,210,0.1)' }"
              />
            </span>
            <span class="cl-num text-[11.5px] font-extrabold text-muted">Habitat {{ player.habitatLevel }} / {{ MAX_TIER }}</span>
          </span>
          <span class="cl-display cl-num min-w-20 text-right text-lg font-bold text-amber-400">{{ formatNumber(player.colonyValue) }}</span>
        </li>
      </ol>
    </template>

    <div
      v-else
      class="cl-panel py-12 text-center"
    >
      <span class="text-4xl opacity-60">🐜</span>
      <p class="text-sm text-muted mt-2">
        No one has founded a colony yet.
      </p>
    </div>
  </div>
</template>
