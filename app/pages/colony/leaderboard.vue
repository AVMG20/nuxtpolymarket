<script setup lang="ts">
import { MAX_TIER } from '#shared/utils/colony'

const { data: players, pending } = await useFetch('/api/colony/leaderboard')

const medalColors = ['text-yellow-400', 'text-muted', 'text-warning']
const rankBg = [
  'bg-gradient-to-r from-warning/10 to-warning/5 border-warning/30',
  'bg-gradient-to-r from-muted/10 to-elevated/20 border-muted/30',
  'bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20'
]

function habitatProgress(level: number) {
  if (MAX_TIER <= 1) return 100
  return Math.round((Math.max(1, Math.min(level, MAX_TIER)) - 1) / (MAX_TIER - 1) * 100)
}
</script>

<template>
  <UContainer class="py-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon
          name="i-lucide-trophy"
          class="size-6 text-warning"
        />
        Colony Leaderboard
      </h1>
      <p class="text-sm text-muted mt-0.5">
        Ranked by Habitat level, then total bug and stored-item value.
      </p>
    </div>

    <LeaderboardSkeleton v-if="pending" :rows="6" />

    <div
      v-else-if="players?.length"
      class="space-y-2"
    >
      <LeaderboardPodiumRow
        v-for="(player, index) in players.slice(0, 3)"
        :key="player.name"
        :rank="index"
        :name="player.name"
        :is-current-user="player.isCurrentUser"
        :rank-bg="rankBg"
        :medal-colors="medalColors"
        name-width="w-32"
        you-badge-variant="badge"
      >
        <template #meta>
          <p class="text-xs text-muted">
            Habitat {{ player.habitatLevel }} / {{ MAX_TIER }}
          </p>
        </template>

        <template #progress>
          <div class="hidden sm:block flex-1 max-w-40">
            <div class="flex items-center justify-between text-[10px] text-muted mb-1">
              <span>Habitat progress</span>
              <span>{{ habitatProgress(player.habitatLevel) }}%</span>
            </div>
            <div class="h-1.5 rounded-full bg-elevated overflow-hidden">
              <div
                class="h-full rounded-full bg-primary"
                :style="{ width: `${habitatProgress(player.habitatLevel)}%` }"
              />
            </div>
          </div>
        </template>

        <template #stats>
          <div class="hidden lg:flex items-center gap-5 shrink-0">
            <div class="text-center">
              <p class="text-sm font-bold">
                {{ formatNumber(player.bugCount, false, 0) }}
              </p>
              <p class="text-[10px] text-muted">
                Bugs
              </p>
            </div>
            <div class="text-center">
              <p class="text-sm font-bold">
                {{ player.speciesOwned }}
              </p>
              <p class="text-[10px] text-muted">
                Species
              </p>
            </div>
            <div class="text-center">
              <p class="text-sm font-bold">
                {{ player.upgradeLevels }}
              </p>
              <p class="text-[10px] text-muted">
                Upgrades
              </p>
            </div>
            <div class="text-center">
              <p class="text-sm font-bold">
                {{ player.researchLevels }}
              </p>
              <p class="text-[10px] text-muted">
                Research
              </p>
            </div>
          </div>
        </template>

        <template #trailing>
          <div class="ml-auto text-right shrink-0">
            <CoinBalance :value="player.colonyValue" />
            <p class="text-[10px] text-muted">
              colony value
            </p>
          </div>
        </template>
      </LeaderboardPodiumRow>

      <div
        v-if="players.length > 3"
        class="pt-3 space-y-1.5"
      >
        <LeaderboardListRow
          v-for="(player, index) in players.slice(3)"
          :key="player.name"
          :rank="index + 4"
          :name="player.name"
          :is-current-user="player.isCurrentUser"
          wrapper-base-class="flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors"
          wrapper-active-class="bg-primary/5 border-primary/30"
          wrapper-inactive-class="bg-elevated/40 border-default hover:bg-elevated"
          name-width="w-28"
          you-badge-variant="text"
        >
          <template #meta>
            <p class="text-[10px] text-muted">
              Habitat {{ player.habitatLevel }}
            </p>
          </template>

          <template #middle>
            <div class="hidden sm:flex items-center gap-4 flex-1 text-xs text-muted">
              <span><strong class="text-default">{{ player.bugCount }}</strong> bugs</span>
              <span><strong class="text-default">{{ player.placedBugCount }}</strong> active</span>
              <span><strong class="text-default">{{ player.speciesOwned }}</strong> species</span>
              <span><strong class="text-default">{{ formatNumber(player.itemCount) }}</strong> items</span>
            </div>
          </template>

          <template #trailing>
            <div class="ml-auto shrink-0">
              <CoinBalance :value="player.colonyValue" />
            </div>
          </template>
        </LeaderboardListRow>
      </div>
    </div>

    <UEmpty
      v-else
      icon="i-lucide-bug"
      description="No players have founded a colony yet"
    />
  </UContainer>
</template>
