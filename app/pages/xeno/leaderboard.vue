<script setup lang="ts">
import { PLANT_TYPES } from '#shared/utils/xeno'

const { data: players, pending } = await useFetch('/api/xeno/leaderboard')
const { user } = useAuth()

const totalSpecies = PLANT_TYPES.length

const medals = ['i-lucide-medal', 'i-lucide-award', 'i-lucide-star']
const medalColors = ['text-yellow-400', 'text-slate-400', 'text-amber-600']
const rankBg = [
  'bg-gradient-to-r from-yellow-500/10 to-amber-500/5 border-yellow-500/30',
  'bg-gradient-to-r from-slate-500/10 to-slate-400/5 border-slate-500/30',
  'bg-gradient-to-r from-amber-700/10 to-amber-600/5 border-amber-700/30',
]
</script>

<template>
  <UContainer>
    <div class="mb-6">
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-trophy" class="size-6 text-yellow-400" />
        Xeno Leaderboard
      </h1>
      <p class="text-sm text-muted mt-0.5">Ranked by species discovered, then total plant count</p>
    </div>

    <div v-if="pending" class="space-y-3">
      <USkeleton v-for="i in 6" :key="i" class="h-20 rounded-xl" />
    </div>

    <div v-else-if="players?.length" class="space-y-2">

      <!-- Top 3 -->
      <div
        v-for="(p, i) in players.slice(0, 3)"
        :key="p.id"
        class="flex items-center gap-3 px-4 py-4 rounded-xl border transition-all"
        :class="[rankBg[i], p.id === user?.id ? 'ring-1 ring-primary/40' : '']"
      >
        <!-- Medal -->
        <div class="w-8 flex items-center justify-center shrink-0">
          <UIcon :name="medals[i]!" class="size-7" :class="medalColors[i]" />
        </div>

        <!-- Name -->
        <div class="min-w-0 w-28 shrink-0">
          <div class="flex items-center gap-1.5">
            <p class="font-bold truncate">{{ p.name }}</p>
            <span v-if="p.id === user?.id" class="text-[10px] font-black text-primary bg-primary/15 px-1 py-0.5 rounded leading-none shrink-0">YOU</span>
          </div>
          <p class="text-xs text-muted">{{ p.speciesUnlocked }}/{{ totalSpecies }} species</p>
        </div>

        <!-- Species progress bar -->
        <div class="hidden sm:block flex-1 mr-3 min-w-0 max-w-48">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-semibold text-primary">{{ p.speciesUnlocked }}</span>
            <span class="text-[10px] text-muted">species</span>
          </div>
          <div class="h-1.5 rounded-full bg-black/20 overflow-hidden">
            <div
              class="h-full rounded-full bg-primary"
              :style="{ width: `${Math.round(p.speciesUnlocked / totalSpecies * 100)}%` }"
            />
          </div>
        </div>

        <!-- Stats -->
        <div class="hidden md:flex items-center gap-4 shrink-0">
          <div class="flex flex-col items-center gap-0.5">
            <span class="text-sm font-bold">{{ formatNumber(p.plantCount, false, 0) }}</span>
            <span class="text-[10px] text-muted">Plants</span>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <span class="text-sm font-bold">{{ p.gridSlots }}</span>
            <span class="text-[10px] text-muted">Grid</span>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <span class="text-sm font-bold">{{ p.breederSlots }}</span>
            <span class="text-[10px] text-muted">Breeders</span>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <span class="text-sm font-bold">{{ p.artifactCount }}</span>
            <span class="text-[10px] text-muted">Artifacts</span>
          </div>
        </div>

        <!-- Portfolio -->
        <div class="flex flex-col items-end shrink-0 ml-auto">
          <CoinBalance :value="p.portfolioValue" />
          <span class="text-[10px] text-muted">portfolio</span>
        </div>
      </div>

      <!-- Rest of the list -->
      <div v-if="players.length > 3" class="mt-4 space-y-1.5">
        <div
          v-for="(p, i) in players.slice(3)"
          :key="p.id"
          class="flex items-center gap-3 px-4 py-3 rounded-xl border border-default transition-colors"
          :class="p.id === user?.id
            ? 'bg-primary/5 border-primary/30'
            : 'bg-elevated/40 hover:bg-elevated'"
        >
          <!-- Rank -->
          <span class="w-7 text-center text-muted font-mono text-sm shrink-0">{{ i + 4 }}</span>

          <!-- Avatar -->
          <div class="size-8 rounded-full bg-background flex items-center justify-center shrink-0 text-xs font-bold border border-default">
            {{ p.name[0]?.toUpperCase() }}
          </div>

          <!-- Name -->
          <div class="min-w-0 w-24 shrink-0">
            <div class="flex items-center gap-1.5">
              <p class="font-medium truncate text-sm">{{ p.name }}</p>
              <span v-if="p.id === user?.id" class="text-[9px] font-black text-primary bg-primary/15 px-1 py-0.5 rounded leading-none shrink-0">YOU</span>
            </div>
            <p class="text-[10px] text-muted">{{ p.speciesUnlocked }}/{{ totalSpecies }} spp</p>
          </div>

          <!-- Species count -->
          <div class="hidden sm:flex flex-1 items-center gap-2 min-w-0">
            <span class="text-sm font-semibold text-primary tabular-nums">{{ p.speciesUnlocked }}</span>
            <div class="flex-1 h-1 rounded-full bg-black/20 overflow-hidden max-w-32">
              <div
                class="h-full rounded-full bg-primary/60"
                :style="{ width: `${Math.round(p.speciesUnlocked / totalSpecies * 100)}%` }"
              />
            </div>
          </div>

          <!-- Stats -->
          <div class="hidden md:flex items-center gap-3 shrink-0 text-xs">
            <span class="text-muted">{{ formatNumber(p.plantCount, false) }} <span class="text-muted/60">plants</span></span>
            <span class="text-muted">{{ p.gridSlots }} <span class="text-muted/60">grid</span></span>
            <span class="text-muted">{{ p.breederSlots }} <span class="text-muted/60">breed</span></span>
            <span class="text-muted">{{ p.artifactCount }} <span class="text-muted/60">art</span></span>
          </div>

          <!-- Portfolio -->
          <div class="shrink-0 ml-auto">
            <CoinBalance :value="p.portfolioValue" />
          </div>
        </div>
      </div>
    </div>

    <UEmpty
      v-else
      description="No players have started Xeno yet"
      icon="i-lucide-sprout"
    />
  </UContainer>
</template>
