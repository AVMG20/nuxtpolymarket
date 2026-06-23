<script setup lang="ts">
const { data: users, pending } = await useFetch('/api/leaderboard')

const medals = ['i-lucide-medal', 'i-lucide-award', 'i-lucide-star']
const medalColors = ['text-yellow-400', 'text-slate-400', 'text-amber-600']
const rankBg = [
  'bg-gradient-to-r from-yellow-500/10 to-amber-500/5 border-yellow-500/30',
  'bg-gradient-to-r from-slate-500/10 to-slate-400/5 border-slate-500/30',
  'bg-gradient-to-r from-amber-700/10 to-amber-600/5 border-amber-700/30',
]

const upgradeColors = {
  miner: 'text-yellow-400',
  vault: 'text-green-400',
  factory: 'text-cyan-400',
  overclock: 'text-orange-400',
  catalyst: 'text-violet-400',
}
</script>

<template>
  <div class="p-6 max-w-4xl mx-auto">
    <div class="mb-8">
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-trophy" class="size-6 text-yellow-400" />
        Leaderboard
      </h1>
      <p class="text-sm text-muted mt-0.5">Top players ranked by total level progression</p>
    </div>

    <div v-if="pending" class="space-y-3">
      <USkeleton v-for="i in 8" :key="i" class="h-20 rounded-xl" />
    </div>

    <div v-else-if="users?.length" class="space-y-2">
      <!-- Top 3 -->
      <div
        v-for="(u, i) in users.slice(0, 3)"
        :key="u.id"
        class="flex items-center gap-4 px-4 py-4 rounded-xl border transition-all"
        :class="rankBg[i]"
      >
        <!-- Medal -->
        <div class="w-8 flex items-center justify-center shrink-0">
          <UIcon :name="medals[i]!" class="size-7" :class="medalColors[i]" />
        </div>

        <!-- Avatar -->
        <div class="size-10 rounded-full bg-background flex items-center justify-center shrink-0 font-bold text-base border border-default">
          {{ u.name[0]?.toUpperCase() }}
        </div>

        <!-- Name + rank -->
        <div class="min-w-0 w-28 shrink-0">
          <p class="font-bold truncate">{{ u.name }}</p>
          <p class="text-xs text-muted">#{{ i + 1 }} · Lv {{ u.totalLevels }}</p>
        </div>

        <!-- Levels -->
        <div class="hidden sm:flex items-center gap-4 flex-1">
          <div class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-cpu" class="size-3.5" :class="upgradeColors.miner" />
              <span class="text-xs font-semibold" :class="upgradeColors.miner">{{ u.rigLevel }}</span>
            </div>
            <span class="text-[10px] text-muted">Miner</span>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-vault" class="size-3.5" :class="upgradeColors.vault" />
              <span class="text-xs font-semibold" :class="upgradeColors.vault">{{ u.vaultLevel }}</span>
            </div>
            <span class="text-[10px] text-muted">Vault</span>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-factory" class="size-3.5" :class="upgradeColors.factory" />
              <span class="text-xs font-semibold" :class="upgradeColors.factory">{{ u.factoryLevel }}</span>
            </div>
            <span class="text-[10px] text-muted">Factory</span>
          </div>
          <div v-if="u.overclockPct > 0" class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-gauge" class="size-3.5" :class="upgradeColors.overclock" />
              <span class="text-xs font-semibold" :class="upgradeColors.overclock">+{{ u.overclockPct }}%</span>
            </div>
            <span class="text-[10px] text-muted">Overclock</span>
          </div>
          <div v-if="u.catalystPct > 0" class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-flask-conical" class="size-3.5" :class="upgradeColors.catalyst" />
              <span class="text-xs font-semibold" :class="upgradeColors.catalyst">+{{ u.catalystPct }}%</span>
            </div>
            <span class="text-[10px] text-muted">Catalyst</span>
          </div>
        </div>

        <!-- Gems + estimated value -->
        <div class="hidden md:flex flex-col items-end gap-0.5 shrink-0">
          <span class="text-xs font-semibold"><GemBalance :value="u.gems" :compact="false" /></span>
          <span class="text-[10px] text-muted flex items-center gap-0.5">
            ≈ <span class="text-[10px]"><CoinBalance :value="u.gemValue" :show-icon="false" /></span>
          </span>
        </div>

        <!-- Balance + total wealth -->
        <div class="flex flex-col items-end shrink-0">
          <span class="font-semibold text-sm"><CoinBalance :value="u.balance" /></span>
          <span class="text-[10px] text-muted flex items-center gap-0.5">
            total <span class="text-[10px]"><CoinBalance :value="u.totalWealth" :show-icon="false" /></span>
          </span>
        </div>
      </div>

      <!-- Rest of the list -->
      <div v-if="users.length > 3" class="mt-4 space-y-1.5">
        <div
          v-for="(u, i) in users.slice(3)"
          :key="u.id"
          class="flex items-center gap-3 px-4 py-3 rounded-xl border border-default bg-elevated/40 hover:bg-elevated transition-colors"
        >
          <!-- Rank -->
          <span class="w-7 text-center text-muted font-mono text-sm shrink-0">{{ i + 4 }}</span>

          <!-- Avatar -->
          <div class="size-8 rounded-full bg-background flex items-center justify-center shrink-0 text-xs font-bold border border-default">
            {{ u.name[0]?.toUpperCase() }}
          </div>

          <!-- Name -->
          <div class="min-w-0 w-28 shrink-0">
            <p class="font-medium truncate text-sm">{{ u.name }}</p>
            <p class="text-[10px] text-muted">Lv {{ u.totalLevels }}</p>
          </div>

          <!-- Levels -->
          <div class="hidden sm:flex items-center gap-3 flex-1">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-cpu" class="size-3" :class="upgradeColors.miner" />
              <span class="text-xs" :class="upgradeColors.miner">{{ u.rigLevel }}</span>
            </div>
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-vault" class="size-3" :class="upgradeColors.vault" />
              <span class="text-xs" :class="upgradeColors.vault">{{ u.vaultLevel }}</span>
            </div>
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-factory" class="size-3" :class="upgradeColors.factory" />
              <span class="text-xs" :class="upgradeColors.factory">{{ u.factoryLevel }}</span>
            </div>
            <div v-if="u.overclockPct > 0" class="flex items-center gap-1">
              <UIcon name="i-lucide-gauge" class="size-3" :class="upgradeColors.overclock" />
              <span class="text-xs" :class="upgradeColors.overclock">+{{ u.overclockPct }}%</span>
            </div>
            <div v-if="u.catalystPct > 0" class="flex items-center gap-1">
              <UIcon name="i-lucide-flask-conical" class="size-3" :class="upgradeColors.catalyst" />
              <span class="text-xs" :class="upgradeColors.catalyst">+{{ u.catalystPct }}%</span>
            </div>
          </div>

          <!-- Gems -->
          <div class="hidden md:block shrink-0">
            <span class="text-xs"><GemBalance :value="u.gems" /></span>
          </div>

          <!-- Balance -->
          <div class="shrink-0">
            <span class="font-semibold text-sm"><CoinBalance :value="u.balance" /></span>
          </div>
        </div>
      </div>
    </div>

    <UEmpty
      v-else
      description="No players found"
      icon="i-lucide-users"
    />
  </div>
</template>
