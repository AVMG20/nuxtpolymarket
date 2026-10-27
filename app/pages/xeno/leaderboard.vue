<script setup lang="ts">
import { PLANT_TYPES, MUTATIONS } from '#shared/utils/xeno'
import { initials } from '~/lib/xeno-ui'

const { data: players, pending } = await useFetch('/api/xeno/leaderboard')
const { unlockedTypeIds } = useXeno()

const totalSpecies = PLANT_TYPES.length
const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`
const RANK_COLORS = ['var(--xg-t9)', 'var(--xg-faint)', 'var(--xg-t5)']

/** Species bar: neutral for everyone, accent for you; a short bar, never a dot, for tiny counts. */
function barStyle(n: number, mine: boolean) {
  const pct = (n / totalSpecies) * 100
  return {
    width: n > 0 ? `max(12px, ${pct}%)` : '0',
    background: mine ? 'var(--xg-accent)' : 'var(--xg-faint)'
  }
}

const myIndex = computed(() => players.value?.findIndex(p => p.isCurrentUser) ?? -1)
const me = computed(() => myIndex.value >= 0 ? players.value![myIndex.value] : null)
const ahead = computed(() => myIndex.value > 0 ? players.value![myIndex.value - 1] : null)

const withinReach = computed(() => {
  const d = new Set(unlockedTypeIds.value)
  return PLANT_TYPES.filter(p => !d.has(p.id) && MUTATIONS.some(m => m.offspring === p.id && d.has(m.parent1) && d.has(m.parent2))).length
})
</script>

<template>
  <div class="mx-auto max-w-[1200px] px-4 md:px-6 pt-5 md:pt-6 flex flex-col gap-4">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="xg-label">Leaderboard</p>
        <h1 class="xg-h text-2xl md:text-3xl mt-1">Collectors</h1>
        <p class="text-[13px] text-(--xg-muted) mt-1">Ranked by species discovered, then by plants owned.</p>
      </div>
      <div v-if="me" class="xg-pane is-go px-4 py-3 flex items-center gap-4">
        <span class="xg-num text-3xl font-extrabold text-(--xg-accent-text)">#{{ myIndex + 1 }}</span>
        <span class="text-[13px] leading-snug">
          <b>You</b>
          <span v-if="ahead" class="text-(--xg-muted)"> · {{ ahead.speciesUnlocked > me.speciesUnlocked ? `${ahead.speciesUnlocked - me.speciesUnlocked} species behind #${myIndex}` : `${formatNumber(ahead.plantCount - me.plantCount)} plants behind #${myIndex}` }}</span>
          <span v-else class="text-(--xg-muted)"> · top of the board</span>
          <br>
          <NuxtLink v-if="withinReach" to="/xeno/encyclopedia" class="xg-link">{{ withinReach }} species within reach</NuxtLink>
          <span v-else class="text-(--xg-muted)">{{ me.speciesUnlocked }} of {{ totalSpecies }} species</span>
        </span>
      </div>
    </div>

    <LeaderboardSkeleton v-if="pending" :rows="6" />

    <section v-else-if="players?.length" class="xg-pane xg-pane-r p-2 md:p-2.5" role="table" aria-label="Xeno leaderboard">
      <div role="row" class="hidden lg:grid grid-cols-[52px_minmax(0,1.6fr)_1.6fr_.8fr_.9fr_.5fr_.5fr_.6fr] items-center gap-3.5 px-3.5 py-2 xg-label">
        <span role="columnheader">Rank</span>
        <span role="columnheader">Player</span>
        <span role="columnheader">Species</span>
        <span role="columnheader" class="text-right">Plants</span>
        <span role="columnheader" class="text-right">Portfolio</span>
        <span role="columnheader" class="text-right">Planters</span>
        <span role="columnheader" class="text-right">Pods</span>
        <span role="columnheader" class="text-right">Artifacts</span>
      </div>
      <div
        v-for="(p, i) in players"
        :key="`${p.name}-${i}`"
        role="row"
        class="grid grid-cols-[40px_minmax(0,1fr)_auto] lg:grid-cols-[52px_minmax(0,1.6fr)_1.6fr_.8fr_.9fr_.5fr_.5fr_.6fr] items-center gap-x-3.5 gap-y-1.5 px-2.5 lg:px-3.5 py-2.5 rounded-[18px_18px_18px_5px] border"
        :class="p.isCurrentUser ? 'bg-(--xg-accent-soft) border-(--xg-accent-edge)' : 'border-transparent hover:bg-(--xg-hover)'"
      >
        <span role="cell" class="flex items-center gap-1 xg-num tabular-nums font-extrabold text-[15px]" :class="i < 3 ? 'text-(--xg-ink)' : 'text-(--xg-muted)'">
          <span class="w-2.5 shrink-0 flex"><span v-if="i < 3" class="xg-leaf !size-2.5" :style="{ '--tc': RANK_COLORS[i] }" /></span>
          {{ i + 1 }}
        </span>
        <span role="cell" class="flex items-center gap-2.5 min-w-0">
          <span class="size-8 shrink-0 rounded-full flex items-center justify-center text-xs font-extrabold bg-(--xg-well) border border-(--xg-edge)">{{ initials(p.name) }}</span>
          <span class="min-w-0 flex items-center gap-1.5">
            <b class="text-[14px] truncate">{{ p.name }}</b>
            <PrestigeBadge :level="p.prestige" size="xs" />
          </span>
        </span>
        <span role="cell" class="flex items-center gap-2.5 max-lg:col-start-2 max-lg:col-span-2 max-lg:row-start-2">
          <span class="xg-meter flex-1"><span :style="barStyle(p.speciesUnlocked, p.isCurrentUser)" /></span>
          <b class="xg-num text-[13px] w-12 text-right">{{ p.speciesUnlocked }}/{{ totalSpecies }}</b>
        </span>
        <span role="cell" class="xg-num text-right text-[13.5px] max-lg:row-start-1 max-lg:col-start-3">
          {{ formatNumber(p.plantCount) }}<span class="lg:hidden text-(--xg-faint) text-xs"> plants</span>
        </span>
        <span role="cell" class="hidden lg:block xg-num text-right text-(--xg-muted)">{{ formatNumber(p.portfolioValue) }}</span>
        <span role="cell" class="hidden lg:block xg-num text-right text-(--xg-muted)">{{ p.gridSlots }}</span>
        <span role="cell" class="hidden lg:block xg-num text-right text-(--xg-muted)">{{ p.breederSlots }}</span>
        <span role="cell" class="hidden lg:block xg-num text-right text-(--xg-muted)">{{ p.artifactCount }}</span>
        <span role="cell" class="lg:hidden col-start-2 col-span-2 text-[11.5px] text-(--xg-faint) xg-num">
          Portfolio {{ formatNumber(p.portfolioValue) }} · {{ plural(p.gridSlots, 'planter') }} · {{ plural(p.breederSlots, 'pod') }} · {{ plural(p.artifactCount, 'artifact') }}
        </span>
      </div>
    </section>

    <div v-else class="xg-well text-center py-12 px-4">
      <UIcon name="i-lucide-sprout" class="size-7 text-(--xg-faint) mx-auto" />
      <p class="text-sm font-extrabold mt-2">No one has started a garden yet</p>
    </div>
  </div>
</template>
