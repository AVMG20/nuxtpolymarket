<script setup lang="ts">
const { data: players, pending } = await useFetch('/api/hack/leaderboard')

const medals = ['i-lucide-medal', 'i-lucide-award', 'i-lucide-star']
const medalColors = ['text-yellow-400', 'text-slate-400', 'text-amber-600']
const rankBg = [
  'bg-gradient-to-r from-yellow-500/10 to-amber-500/5 border-yellow-500/30',
  'bg-gradient-to-r from-slate-500/10 to-slate-400/5 border-slate-500/30',
  'bg-gradient-to-r from-amber-700/10 to-amber-600/5 border-amber-700/30',
]
</script>

<template>
  <UContainer class="py-6">
    <div class="mb-8">
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-trophy" class="size-6 text-yellow-400" />
        Hack Leaderboard
      </h1>
      <p class="text-sm text-muted mt-0.5">Top players ranked by total agent power</p>
    </div>

    <div v-if="pending" class="space-y-3">
      <USkeleton v-for="i in 8" :key="i" class="h-20 rounded-xl" />
    </div>

    <div v-else-if="players?.length" class="space-y-2">
      <!-- Top 3 -->
      <div
        v-for="(p, i) in players.slice(0, 3)"
        :key="p.userId"
        class="flex items-center gap-4 px-4 py-4 rounded-xl border transition-all"
        :class="rankBg[i]"
      >
        <!-- Medal -->
        <div class="w-8 flex items-center justify-center shrink-0">
          <UIcon :name="medals[i]!" class="size-7" :class="medalColors[i]" />
        </div>

        <!-- Avatar -->
        <div class="size-10 rounded-full bg-background flex items-center justify-center shrink-0 font-bold text-base border border-default">
          {{ p.name[0]?.toUpperCase() }}
        </div>

        <!-- Name + rank -->
        <div class="min-w-0 w-28 shrink-0">
          <p class="font-bold truncate">{{ p.name }}</p>
          <p class="text-xs text-muted">#{{ i + 1 }} · {{ p.agentCount }} agents</p>
        </div>

        <!-- Stats -->
        <div class="hidden sm:flex items-center gap-5 flex-1">
          <div class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-zap" class="size-3.5 text-primary" />
              <span class="text-xs font-semibold text-primary">{{ formatNumber(p.totalPower, false) }}</span>
            </div>
            <span class="text-[10px] text-muted">Power</span>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-users" class="size-3.5 text-info" />
              <span class="text-xs font-semibold text-info">{{ p.agentCount }} / {{ p.rosterSlots }}</span>
            </div>
            <span class="text-[10px] text-muted">Roster</span>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-package" class="size-3.5 text-warning" />
              <span class="text-xs font-semibold text-warning">{{ p.itemCount }}</span>
            </div>
            <span class="text-[10px] text-muted">Equipment</span>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-check-circle" class="size-3.5 text-success" />
              <span class="text-xs font-semibold text-success">{{ p.totalOpsCompleted }}</span>
            </div>
            <span class="text-[10px] text-muted">Ops done</span>
          </div>
        </div>

        <!-- Power (right side) -->
        <div class="flex flex-col items-end shrink-0">
          <span class="font-bold text-primary flex items-center gap-1">
            <UIcon name="i-lucide-zap" class="size-3.5" />
            {{ formatNumber(p.totalPower, false) }}
          </span>
          <span class="text-[10px] text-muted">total power</span>
        </div>
      </div>

      <!-- Rest of the list -->
      <div v-if="players.length > 3" class="mt-4 space-y-1.5">
        <div
          v-for="(p, i) in players.slice(3)"
          :key="p.userId"
          class="flex items-center gap-3 px-4 py-3 rounded-xl border border-default bg-elevated/40 hover:bg-elevated transition-colors"
        >
          <!-- Rank -->
          <span class="w-7 text-center text-muted font-mono text-sm shrink-0">{{ i + 4 }}</span>

          <!-- Avatar -->
          <div class="size-8 rounded-full bg-background flex items-center justify-center shrink-0 text-xs font-bold border border-default">
            {{ p.name[0]?.toUpperCase() }}
          </div>

          <!-- Name -->
          <div class="min-w-0 w-28 shrink-0">
            <p class="font-medium truncate text-sm">{{ p.name }}</p>
            <p class="text-[10px] text-muted">{{ p.agentCount }} agents</p>
          </div>

          <!-- Stats -->
          <div class="hidden sm:flex items-center gap-4 flex-1">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-zap" class="size-3 text-primary" />
              <span class="text-xs text-primary">{{ formatNumber(p.totalPower, false) }}</span>
            </div>
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-users" class="size-3 text-info" />
              <span class="text-xs text-info">{{ p.agentCount }}/{{ p.rosterSlots }}</span>
            </div>
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-package" class="size-3 text-warning" />
              <span class="text-xs text-warning">{{ p.itemCount }}</span>
            </div>
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-check-circle" class="size-3 text-success" />
              <span class="text-xs text-success">{{ p.totalOpsCompleted }}</span>
            </div>
          </div>

          <!-- Power -->
          <div class="shrink-0">
            <span class="font-semibold text-sm text-primary flex items-center gap-1">
              <UIcon name="i-lucide-zap" class="size-3.5" />
              {{ formatNumber(p.totalPower, false) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <UEmpty
      v-else
      description="No players found"
      icon="i-lucide-users"
    />
  </UContainer>
</template>
