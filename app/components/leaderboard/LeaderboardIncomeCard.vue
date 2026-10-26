<script setup lang="ts">
import type { Genre } from '#shared/utils/game-genres'
import type { IncomeSummary } from '#shared/utils/player-income'

// Loaded only when a player's details open, so the leaderboard list stays one
// request. Failures stay inside the card: it is a nice-to-have, not the modal.

const props = defineProps<{
  userId: string
}>()

type PlayerIncome = IncomeSummary & { days: number, since: string }

const income = ref<PlayerIncome | null>(null)
const loading = ref(false)
const failed = ref(false)
let request = 0

async function load() {
  const id = ++request
  loading.value = true
  failed.value = false
  income.value = null
  try {
    const data = await apiFetch<PlayerIncome>(`/api/leaderboard/${encodeURIComponent(props.userId)}/income`)
    if (id === request) income.value = data
  } catch {
    if (id === request) failed.value = true
  } finally {
    if (id === request) loading.value = false
  }
}

watch(() => props.userId, load, { immediate: true })

// Same colour per genre as the audit page's badges.
const GENRE_BAR: Record<Genre, string> = {
  casino: 'bg-primary',
  idle: 'bg-success',
  active: 'bg-warning',
  economy: 'bg-inverted/60'
}

function percent(share: number) {
  const value = share * 100
  return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`
}
</script>

<template>
  <section class="rounded-xl border border-default bg-elevated/40 p-4">
    <div class="flex items-start gap-3">
      <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
        <UIcon name="i-lucide-trending-up" class="size-5 text-success" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium uppercase tracking-wide text-muted">Income, last 7 days</p>
        <USkeleton v-if="loading" class="mt-1 h-7 w-28" />
        <CoinBalance v-else-if="income" :value="income.total" class="text-xl font-bold" />
        <p v-else class="text-xl font-bold text-dimmed">—</p>
      </div>
    </div>

    <div v-if="loading" class="mt-4 space-y-3">
      <div v-for="i in 3" :key="i" class="space-y-1.5">
        <USkeleton class="h-3.5 w-full" />
        <USkeleton class="h-1.5 w-full" />
      </div>
    </div>

    <div v-else-if="failed" class="mt-3 flex items-center gap-2 text-xs text-muted">
      <UIcon name="i-lucide-cloud-off" class="size-4 shrink-0" />
      <span class="flex-1">Couldn't load income right now.</span>
      <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-rotate-cw" label="Retry" @click="load" />
    </div>

    <template v-else-if="income">
      <p v-if="!income.sources.length" class="mt-3 text-xs text-muted">Nothing earned in the last 7 days.</p>

      <ol v-else class="mt-4 space-y-3">
        <li v-for="(source, i) in income.sources" :key="source.label">
          <div class="flex items-center gap-2 text-sm">
            <span class="w-4 shrink-0 text-center font-mono text-xs text-dimmed">{{ i + 1 }}</span>
            <span class="min-w-0 flex-1 truncate font-medium">{{ source.label }}</span>
            <span class="text-xs tabular-nums text-muted">{{ percent(source.share) }}</span>
            <CoinBalance :value="source.amount" :show-icon="false" class="w-16 justify-end font-semibold tabular-nums" />
          </div>
          <div class="ml-6 mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated">
            <div class="h-full rounded-full" :class="GENRE_BAR[source.genre]" :style="{ width: `${Math.max(2, source.share * 100)}%` }" />
          </div>
        </li>
        <li v-if="income.otherCount" class="flex items-center gap-2 text-xs text-muted">
          <span class="w-4 shrink-0" />
          <span class="flex-1">{{ income.otherCount }} other source{{ income.otherCount === 1 ? '' : 's' }}</span>
          <span class="tabular-nums">{{ percent(income.total > 0 ? income.otherAmount / income.total : 0) }}</span>
          <CoinBalance :value="income.otherAmount" :show-icon="false" class="w-16 justify-end tabular-nums" />
        </li>
      </ol>

      <p class="mt-3 text-[11px] text-dimmed">Coins paid out, casino wins in full. Bank moves, gifts and refunds don't count.</p>
    </template>
  </section>
</template>
