<script setup lang="ts">
import { MAX_TIER } from '#shared/utils/colony'

const { data: players, pending } = await useFetch('/api/colony/leaderboard')
const { user } = useAuth()

const medals = ['i-lucide-medal', 'i-lucide-award', 'i-lucide-star']
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

    <div
      v-if="pending"
      class="space-y-3"
    >
      <USkeleton
        v-for="i in 6"
        :key="i"
        class="h-20 rounded-xl"
      />
    </div>

    <div
      v-else-if="players?.length"
      class="space-y-2"
    >
      <div
        v-for="(player, index) in players.slice(0, 3)"
        :key="player.userId"
        class="flex items-center gap-3 px-4 py-4 rounded-xl border transition-all"
        :class="[rankBg[index], player.userId === user?.id ? 'ring-1 ring-primary/40' : '']"
      >
        <div class="w-8 flex items-center justify-center shrink-0">
          <UIcon
            :name="medals[index]!"
            class="size-7"
            :class="medalColors[index]"
          />
        </div>

        <div class="size-10 rounded-full bg-background flex items-center justify-center shrink-0 font-bold border border-default">
          {{ player.name[0]?.toUpperCase() }}
        </div>

        <div class="min-w-0 w-32 shrink-0">
          <div class="flex items-center gap-1.5">
            <p class="font-bold truncate">
              {{ player.name }}
            </p>
            <UBadge
              v-if="player.userId === user?.id"
              color="primary"
              variant="subtle"
              size="sm"
            >
              YOU
            </UBadge>
          </div>
          <p class="text-xs text-muted">
            Habitat {{ player.habitatLevel }} / {{ MAX_TIER }}
          </p>
        </div>

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

        <div class="ml-auto text-right shrink-0">
          <CoinBalance :value="player.colonyValue" />
          <p class="text-[10px] text-muted">
            colony value
          </p>
        </div>
      </div>

      <div
        v-if="players.length > 3"
        class="pt-3 space-y-1.5"
      >
        <div
          v-for="(player, index) in players.slice(3)"
          :key="player.userId"
          class="flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors"
          :class="player.userId === user?.id ? 'bg-primary/5 border-primary/30' : 'bg-elevated/40 border-default hover:bg-elevated'"
        >
          <span class="w-7 text-center text-muted font-mono text-sm shrink-0">{{ index + 4 }}</span>
          <div class="size-8 rounded-full bg-background flex items-center justify-center shrink-0 text-xs font-bold border border-default">
            {{ player.name[0]?.toUpperCase() }}
          </div>
          <div class="min-w-0 w-28 shrink-0">
            <div class="flex items-center gap-1.5">
              <p class="font-medium truncate text-sm">
                {{ player.name }}
              </p>
              <span
                v-if="player.userId === user?.id"
                class="text-[9px] font-black text-primary"
              >YOU</span>
            </div>
            <p class="text-[10px] text-muted">
              Habitat {{ player.habitatLevel }}
            </p>
          </div>

          <div class="hidden sm:flex items-center gap-4 flex-1 text-xs text-muted">
            <span><strong class="text-default">{{ player.bugCount }}</strong> bugs</span>
            <span><strong class="text-default">{{ player.placedBugCount }}</strong> active</span>
            <span><strong class="text-default">{{ player.speciesOwned }}</strong> species</span>
            <span><strong class="text-default">{{ formatNumber(player.itemCount) }}</strong> items</span>
          </div>

          <div class="ml-auto shrink-0">
            <CoinBalance :value="player.colonyValue" />
          </div>
        </div>
      </div>
    </div>

    <UEmpty
      v-else
      icon="i-lucide-bug"
      description="No players have founded a colony yet"
    />
  </UContainer>
</template>
