<script setup lang="ts">
const { data: players, pending } = await useFetch('/api/hack/leaderboard')

const rankAccent = ['text-yellow-400', 'text-slate-300', 'text-amber-600']
const rankLabel = ['#1 MOST WANTED', '#2 MOST WANTED', '#3 MOST WANTED']
</script>

<template>
  <div class="p-6 space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon
          name="i-lucide-trophy"
          class="size-6 text-yellow-400"
        />
        Most Wanted
      </h1>
      <p class="hack-eyebrow mt-1.5">
        // operators ranked by total squad power
      </p>
    </div>

    <div
      v-if="pending"
      class="space-y-3"
    >
      <USkeleton
        v-for="i in 8"
        :key="i"
        class="h-20 rounded-xl"
      />
    </div>

    <div
      v-else-if="players?.length"
      class="space-y-6"
    >
      <!-- Top 3 — dossier treatment -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <HackFrame
          v-for="(p, i) in players.slice(0, 3)"
          :key="p.userId"
          :accent="i === 0"
          class="p-4 text-center"
        >
          <p
            class="hack-eyebrow"
            :class="rankAccent[i]"
          >
            {{ rankLabel[i] }}
          </p>
          <div
            class="size-20 mx-auto my-3 rounded-lg flex items-center justify-center bg-elevated border border-default"
            :class="rankAccent[i]"
          >
            <UIcon
              name="i-lucide-user-round"
              class="size-10 opacity-70"
            />
          </div>
          <p class="font-bold text-lg truncate">
            {{ p.name }}
          </p>
          <p
            class="hack-stat-value-lg mt-1"
            :class="rankAccent[i]"
          >
            {{ formatNumber(p.totalPower, false) }}
          </p>
          <p class="hack-stat-label-md mb-3">
            Power
          </p>
          <div class="grid grid-cols-3 gap-2 pt-3 border-t border-default text-xs">
            <div>
              <p class="font-semibold text-info">
                {{ p.agentCount }}/{{ p.rosterSlots }}
              </p>
              <p class="text-muted">
                Roster
              </p>
            </div>
            <div>
              <p class="font-semibold text-warning">
                {{ p.itemCount }}
              </p>
              <p class="text-muted">
                Gear
              </p>
            </div>
            <div>
              <p class="font-semibold text-success">
                {{ p.totalOpsCompleted }}
              </p>
              <p class="text-muted">
                Ops
              </p>
            </div>
          </div>
        </HackFrame>
      </div>

      <!-- Rest of the board -->
      <div
        v-if="players.length > 3"
        class="space-y-1.5"
      >
        <HackFrame
          v-for="(p, i) in players.slice(3)"
          :key="p.userId"
          tight
          class="flex items-center gap-3 p-3"
        >
          <span class="w-7 text-center text-muted font-mono text-sm shrink-0">{{ i + 4 }}</span>

          <div class="size-8 rounded-lg bg-elevated border border-default flex items-center justify-center shrink-0 text-muted">
            <UIcon
              name="i-lucide-user-round"
              class="size-4"
            />
          </div>

          <div class="min-w-0 w-28 shrink-0">
            <p class="font-medium truncate text-sm">
              {{ p.name }}
            </p>
            <p class="text-[10px] text-muted">
              {{ p.agentCount }} agents
            </p>
          </div>

          <div class="hidden sm:flex items-center gap-4 flex-1">
            <div class="flex items-center gap-1">
              <UIcon
                name="i-lucide-zap"
                class="size-3 text-primary"
              />
              <span class="text-xs text-primary">{{ formatNumber(p.totalPower, false) }}</span>
            </div>
            <div class="flex items-center gap-1">
              <UIcon
                name="i-lucide-users"
                class="size-3 text-info"
              />
              <span class="text-xs text-info">{{ p.agentCount }}/{{ p.rosterSlots }}</span>
            </div>
            <div class="flex items-center gap-1">
              <UIcon
                name="i-lucide-package"
                class="size-3 text-warning"
              />
              <span class="text-xs text-warning">{{ p.itemCount }}</span>
            </div>
            <div class="flex items-center gap-1">
              <UIcon
                name="i-lucide-check-circle"
                class="size-3 text-success"
              />
              <span class="text-xs text-success">{{ p.totalOpsCompleted }}</span>
            </div>
          </div>

          <span class="hack-stat-value-lg shrink-0 text-primary">{{ formatNumber(p.totalPower, false) }}</span>
        </HackFrame>
      </div>
    </div>

    <UEmpty
      v-else
      description="No players found"
      icon="i-lucide-users"
    />
  </div>
</template>
