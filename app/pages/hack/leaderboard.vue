<script setup lang="ts">
const { data: players, pending } = await useFetch('/api/hack/leaderboard')

const rankAccent = ['text-yellow-400', 'text-slate-300', 'text-amber-600']
const rankRing = ['ring-yellow-400', 'ring-slate-300', 'ring-amber-600']
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

    <LeaderboardSkeleton v-if="pending" />

    <div
      v-else-if="players?.length"
      class="space-y-6"
    >
      <!-- Top 3 podium layout -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <!-- #2 position -->
        <HackFrame
          v-if="players[1]"
          :key="players[1].name"
          class="p-6 text-center mt-7"
        >
          <p
            class="font-mono font-bold text-2xl"
            :class="rankAccent[1]"
          >
            #2
          </p>
          <div class="my-3 flex justify-center">
            <ProfileEmblem
              :emblem="players[1].emblem"
              :name="players[1].name"
              class="size-20 ring-4"
              :class="rankRing[1]"
            />
          </div>
          <p class="font-bold text-xl truncate">
            {{ players[1].name }}
          </p>
          <p class="text-sm text-muted mt-1">
            {{ players[1].agentCount }} agents
          </p>
          <div class="grid grid-cols-4 gap-2 mt-4">
            <div>
              <p class="font-mono text-xs uppercase text-muted tracking-wider">Power</p>
              <p class="font-mono text-lg font-semibold text-primary mt-0.5">{{ formatNumber(players[1].totalPower, false) }}</p>
            </div>
            <div>
              <p class="font-mono text-xs uppercase text-muted tracking-wider">Roster</p>
              <p class="font-mono text-lg font-semibold mt-0.5">{{ players[1].agentCount }}/{{ players[1].rosterSlots }}</p>
            </div>
            <div>
              <p class="font-mono text-xs uppercase text-muted tracking-wider">Equip.</p>
              <p class="font-mono text-lg font-semibold mt-0.5">{{ players[1].itemCount }}</p>
            </div>
            <div>
              <p class="font-mono text-xs uppercase text-muted tracking-wider">Ops</p>
              <p class="font-mono text-lg font-semibold mt-0.5">{{ players[1].totalOpsCompleted }}</p>
            </div>
          </div>
        </HackFrame>

        <!-- #1 position (center, larger) -->
        <HackFrame
          v-if="players[0]"
          :key="players[0].name"
          accent
          class="p-6 text-center"
        >
          <p
            class="font-mono font-bold text-2xl"
            :class="rankAccent[0]"
          >
            #1
          </p>
          <div class="my-3 flex justify-center">
            <ProfileEmblem
              :emblem="players[0].emblem"
              :name="players[0].name"
              class="size-24 ring-4"
              :class="rankRing[0]"
            />
          </div>
          <p class="font-bold text-2xl truncate">
            {{ players[0].name }}
          </p>
          <p class="text-sm text-muted mt-1">
            {{ players[0].agentCount }} agents
          </p>
          <div class="grid grid-cols-4 gap-2 mt-4">
            <div>
              <p class="font-mono text-xs uppercase text-muted tracking-wider">Power</p>
              <p class="font-mono text-lg font-semibold text-primary mt-0.5">{{ formatNumber(players[0].totalPower, false) }}</p>
            </div>
            <div>
              <p class="font-mono text-xs uppercase text-muted tracking-wider">Roster</p>
              <p class="font-mono text-lg font-semibold mt-0.5">{{ players[0].agentCount }}/{{ players[0].rosterSlots }}</p>
            </div>
            <div>
              <p class="font-mono text-xs uppercase text-muted tracking-wider">Equip.</p>
              <p class="font-mono text-lg font-semibold mt-0.5">{{ players[0].itemCount }}</p>
            </div>
            <div>
              <p class="font-mono text-xs uppercase text-muted tracking-wider">Ops</p>
              <p class="font-mono text-lg font-semibold mt-0.5">{{ players[0].totalOpsCompleted }}</p>
            </div>
          </div>
          <div class="mt-4 pt-3 border-t border-default">
            <p class="font-mono text-sm uppercase text-muted tracking-wider">Total power</p>
            <p class="font-mono text-2xl font-bold text-primary mt-1">{{ formatNumber(players[0].totalPower, false) }}</p>
          </div>
        </HackFrame>

        <!-- #3 position -->
        <HackFrame
          v-if="players[2]"
          :key="players[2].name"
          class="p-6 text-center mt-7"
        >
          <p
            class="font-mono font-bold text-2xl"
            :class="rankAccent[2]"
          >
            #3
          </p>
          <div class="my-3 flex justify-center">
            <ProfileEmblem
              :emblem="players[2].emblem"
              :name="players[2].name"
              class="size-20 ring-4"
              :class="rankRing[2]"
            />
          </div>
          <p class="font-bold text-xl truncate">
            {{ players[2].name }}
          </p>
          <p class="text-sm text-muted mt-1">
            {{ players[2].agentCount }} agents
          </p>
          <div class="grid grid-cols-4 gap-2 mt-4">
            <div>
              <p class="font-mono text-xs uppercase text-muted tracking-wider">Power</p>
              <p class="font-mono text-lg font-semibold text-primary mt-0.5">{{ formatNumber(players[2].totalPower, false) }}</p>
            </div>
            <div>
              <p class="font-mono text-xs uppercase text-muted tracking-wider">Roster</p>
              <p class="font-mono text-lg font-semibold mt-0.5">{{ players[2].agentCount }}/{{ players[2].rosterSlots }}</p>
            </div>
            <div>
              <p class="font-mono text-xs uppercase text-muted tracking-wider">Equip.</p>
              <p class="font-mono text-lg font-semibold mt-0.5">{{ players[2].itemCount }}</p>
            </div>
            <div>
              <p class="font-mono text-xs uppercase text-muted tracking-wider">Ops</p>
              <p class="font-mono text-lg font-semibold mt-0.5">{{ players[2].totalOpsCompleted }}</p>
            </div>
          </div>
        </HackFrame>
      </div>

      <!-- Rest of the board -->
      <div
        v-if="players.length > 3"
      >
        <HackFrame tight>
          <div
            v-for="(p, i) in players.slice(3)"
            :key="p.name"
            class="flex items-center gap-4 p-4 border-b border-default last:border-b-0"
            :class="p.isCurrentUser ? 'bg-primary/10' : ''"
          >
            <span class="w-7 text-center text-muted font-mono text-sm shrink-0">{{ i + 4 }}</span>

            <ProfileEmblem
              :emblem="p.emblem"
              :name="p.name"
              class="size-9 text-sm"
            />

            <div class="min-w-0 flex-1">
              <p class="font-semibold text-base truncate">
                {{ p.name }} <LeaderboardYouBadge :show="p.isCurrentUser" variant="inline" />
              </p>
              <p class="text-sm text-muted mt-0.5">
                {{ p.agentCount }} agents
              </p>
            </div>

            <div class="flex items-center gap-6">
              <div class="text-right">
                <p class="font-mono text-xs uppercase text-muted tracking-wider">Power</p>
                <p class="font-mono text-base font-semibold text-primary mt-0.5">{{ formatNumber(p.totalPower, false) }}</p>
              </div>
              <div class="text-right">
                <p class="font-mono text-xs uppercase text-muted tracking-wider">Roster</p>
                <p class="font-mono text-base font-semibold mt-0.5">{{ p.agentCount }}/{{ p.rosterSlots }}</p>
              </div>
              <div class="text-right">
                <p class="font-mono text-xs uppercase text-muted tracking-wider">Equip.</p>
                <p class="font-mono text-base font-semibold mt-0.5">{{ p.itemCount }}</p>
              </div>
              <div class="text-right">
                <p class="font-mono text-xs uppercase text-muted tracking-wider">Ops</p>
                <p class="font-mono text-base font-semibold mt-0.5">{{ p.totalOpsCompleted }}</p>
              </div>
            </div>
          </div>
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
