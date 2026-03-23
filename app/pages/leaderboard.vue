<script setup lang="ts">
const { data: users, pending } = await useFetch('/api/leaderboard')

const medals = ['i-lucide-medal', 'i-lucide-award', 'i-lucide-star']
const medalColors = ['text-yellow-400', 'text-slate-400', 'text-amber-600']
const rankBg = [
  'bg-gradient-to-r from-yellow-500/10 to-amber-500/5 border-yellow-500/30',
  'bg-gradient-to-r from-slate-500/10 to-slate-400/5 border-slate-500/30',
  'bg-gradient-to-r from-amber-700/10 to-amber-600/5 border-amber-700/30',
]
</script>

<template>
  <div class="p-6 max-w-3xl mx-auto">
    <div class="mb-8">
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-trophy" class="size-6 text-yellow-400" />
        Leaderboard
      </h1>
      <p class="text-sm text-muted mt-0.5">Top players ranked by balance</p>
    </div>

    <div v-if="pending" class="space-y-3">
      <USkeleton v-for="i in 8" :key="i" class="h-14 rounded-xl" />
    </div>

    <div v-else-if="users?.length" class="space-y-2">
      <!-- Top 3 -->
      <div
        v-for="(u, i) in users.slice(0, 3)"
        :key="u.id"
        class="flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all"
        :class="rankBg[i]"
      >
        <div class="w-8 flex items-center justify-center shrink-0">
          <UIcon :name="medals[i]!" class="size-6" :class="medalColors[i]" />
        </div>
        <div class="size-9 rounded-full bg-background flex items-center justify-center shrink-0 font-bold text-sm border border-default">
          {{ u.name[0]?.toUpperCase() }}
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-bold truncate">{{ u.name }}</p>
          <p class="text-xs text-muted">#{{ i + 1 }}</p>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <UIcon name="i-lucide-coins" class="size-4 text-yellow-400" />
          <span class="font-semibold text-sm">{{ formatNumber(parseFloat(u.balance), false) }}</span>
        </div>
      </div>

      <!-- Rest of the list -->
      <UTable
        v-if="users.length > 3"
        :data="users.slice(3).map((u, i) => ({ rank: i + 4, ...u }))"
        :columns="[
          { accessorKey: 'rank', header: '#', size: 48 },
          { accessorKey: 'name', header: 'Player' },
          { accessorKey: 'balance', header: 'Balance', meta: { class: { td: 'text-right', th: 'text-right' } } },
        ]"
        class="mt-4"
      >
        <template #rank-cell="{ row }">
          <span class="text-muted font-mono text-sm">{{ row.original.rank }}</span>
        </template>
        <template #name-cell="{ row }">
          <div class="flex items-center gap-2.5">
            <div class="size-7 rounded-full bg-elevated flex items-center justify-center text-xs font-bold border border-default">
              {{ row.original.name[0]?.toUpperCase() }}
            </div>
            <span class="font-medium">{{ row.original.name }}</span>
          </div>
        </template>
        <template #balance-cell="{ row }">
          <div class="flex items-center justify-end gap-1.5">
            <UIcon name="i-lucide-coins" class="size-3.5 text-yellow-400" />
            <span class="font-semibold text-sm">{{ formatNumber(parseFloat(row.original.balance), false) }}</span>
          </div>
        </template>
      </UTable>
    </div>

    <UEmpty
      v-else
      description="No players found"
      icon="i-lucide-users"
    />
  </div>
</template>
