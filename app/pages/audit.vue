<script setup lang="ts">
import { format } from 'date-fns'
import { useElementSize } from '@vueuse/core'
import { GENRES, GENRE_LABELS, GENRE_DESCRIPTIONS, type Genre } from '#shared/utils/game-genres'

type Metric = 'net' | 'emitted' | 'spent'
type Tone = 'success' | 'error' | 'neutral'

interface AuditGameRow {
  label: string
  genre: Genre
  credits: number
  debits: number
  txCount: number
  players: number
}

interface AuditSeriesRow {
  bucket: string
  label: string
  credits: number
  debits: number
}

interface AuditOverview {
  window: '24h' | '7d' | '30d'
  since: string
  days: number
  bucket: 'hour' | 'day'
  totalPlayers: number
  playersByGenre: Partial<Record<Genre, number>>
  games: AuditGameRow[]
  series: AuditSeriesRow[]
}

interface TopPlayer {
  userId: string
  name: string
  image: string | null
  credits: number
  debits: number
  txCount: number
}

// ---- Window (drives the server query) ----
const WINDOWS = [
  { value: '24h' as const, label: '24 hours' },
  { value: '7d' as const, label: '7 days' },
  { value: '30d' as const, label: '30 days' }
]
const windowKey = ref<'24h' | '7d' | '30d'>('24h')

// ---- Metric ----
// `net` is the house's bottom line; the one-sided metrics strip the other side
// out, so an idle game can be judged on what it hands players rather than on
// what they fed into it.
const METRICS = [
  { value: 'net' as const, label: 'Net', description: 'Put in minus paid out — what the house kept' },
  { value: 'emitted' as const, label: 'Paid out', description: 'Only what the game pays players, ignoring their stake' },
  { value: 'spent' as const, label: 'Put in', description: 'Only what players put into the game' }
]
const metric = ref<Metric>('net')

const METRIC_HEADINGS: Record<Metric, string> = {
  net: 'House income',
  emitted: 'Paid out to players',
  spent: 'Put in by players'
}
const METRIC_COLUMN: Record<Metric, string> = {
  net: 'Income',
  emitted: 'Paid out',
  spent: 'Put in'
}

/** Only `net` carries a sign — the one-sided metrics are magnitudes. */
const isNet = computed(() => metric.value === 'net')

// Colour reads from the house's side of the ledger, never from the sign of the
// number on screen: money players put in is good for the house, money paid back
// out is bad, and `net` follows its own sign.
const houseSign = computed(() => {
  if (metric.value === 'spent') return 1
  if (metric.value === 'emitted') return -1
  return 0
})

function goodForHouse(n: number) {
  return houseSign.value === 0 ? n >= 0 : houseSign.value > 0
}

function tone(n: number): Tone {
  return goodForHouse(n) ? 'success' : 'error'
}

function metricOf(row: { credits: number, debits: number }) {
  if (metric.value === 'emitted') return row.credits
  if (metric.value === 'spent') return row.debits
  return row.debits - row.credits
}

/** The active metric, formatted — signed for `net`, plain otherwise. */
function display(n: number) {
  if (!isNet.value) return formatNumber(n)
  return `${n >= 0 ? '+' : '-'}${formatNumber(Math.abs(n))}`
}

/** The net, which is always signed whatever the active metric is. */
function displayNet(n: number) {
  return `${n >= 0 ? '+' : '-'}${formatNumber(Math.abs(n))}`
}

const { data, pending } = useFetch<AuditOverview>('/api/audit/overview', {
  lazy: true,
  query: computed(() => ({ window: windowKey.value }))
})

// Keep the previous window's numbers on screen while the next one loads rather
// than flashing skeletons on every toggle.
const loading = computed(() => pending.value && !data.value)

// ---- Genre + game filters (client-side, no refetch) ----
const genre = ref<Genre | 'all'>('all')
const selectedGame = ref<string | null>(null)

const genreTabs = computed(() => [
  { value: 'all' as const, label: 'All games', description: 'Every category in the ledger' },
  ...GENRES.map(g => ({ value: g, label: GENRE_LABELS[g], description: GENRE_DESCRIPTIONS[g] }))
])

const allGames = computed(() => data.value?.games ?? [])

const games = computed(() =>
  (genre.value === 'all' ? allGames.value : allGames.value.filter(g => g.genre === genre.value))
    .map(g => ({ ...g, value: metricOf(g) }))
    .sort((a, b) => b.value - a.value)
)

// A game isolated under one genre must not survive a switch to another.
watch(genre, () => {
  if (selectedGame.value && !games.value.some(g => g.label === selectedGame.value)) {
    selectedGame.value = null
  }
})

const isolated = computed(() => games.value.find(g => g.label === selectedGame.value) ?? null)
const scopedGames = computed(() => isolated.value ? [isolated.value] : games.value)

function toggleGame(label: string) {
  selectedGame.value = selectedGame.value === label ? null : label
}

// ---- Scope ----
const days = computed(() => data.value?.days ?? 1)

const scopeLabel = computed(() => {
  if (selectedGame.value) return selectedGame.value
  return genre.value === 'all' ? 'all games' : `${GENRE_LABELS[genre.value]} games`
})

/**
 * Distinct players in the current scope. Counted server-side per scope rather
 * than summed from the game rows, which would double-count anyone who played
 * more than one of them.
 */
const scopedPlayers = computed(() => {
  if (isolated.value) return isolated.value.players
  if (genre.value === 'all') return data.value?.totalPlayers ?? 0
  return data.value?.playersByGenre?.[genre.value] ?? 0
})

const totals = computed(() => {
  const rows = scopedGames.value
  const credits = rows.reduce((sum, g) => sum + g.credits, 0)
  const debits = rows.reduce((sum, g) => sum + g.debits, 0)
  const txCount = rows.reduce((sum, g) => sum + g.txCount, 0)
  return { credits, debits, txCount, net: debits - credits, value: metricOf({ credits, debits }) }
})

const windowLabel = computed(() => WINDOWS.find(w => w.value === windowKey.value)?.label ?? '')

const sinceLabel = computed(() => {
  if (!data.value?.since) return ''
  return format(new Date(data.value.since), 'd MMM yyyy HH:mm')
})

// ---- Summary cards ----
// Five fixed slots, identical under every metric: the net, both sides of the
// ledger, the daily rate and the transaction count. Switching metric re-tints
// the row and changes what the rate measures — it never reshuffles the cards.
interface SummaryCard {
  key: string
  label: string
  value: string
  sub: string
  tone: Tone
  /** Carries the active metric, and is tinted to match its tone. */
  lead?: boolean
}

const summaryCards = computed((): SummaryCard[] => {
  const t = totals.value
  const perDay = t.value / days.value
  const players = scopedPlayers.value

  return [
    {
      key: 'net',
      label: 'House income',
      value: displayNet(t.net),
      sub: scopeLabel.value,
      tone: t.net >= 0 ? 'success' : 'error',
      lead: isNet.value
    },
    {
      key: 'paid-out',
      label: 'Paid out to players',
      value: formatNumber(t.credits),
      sub: t.debits > 0 ? `${(t.credits / t.debits * 100).toFixed(1)}% returned` : 'nothing put in',
      tone: 'error',
      lead: metric.value === 'emitted'
    },
    {
      key: 'put-in',
      label: 'Put in by players',
      value: formatNumber(t.debits),
      sub: `${formatNumber(players)} player${players === 1 ? '' : 's'}`,
      tone: 'success',
      lead: metric.value === 'spent'
    },
    {
      key: 'per-day',
      label: 'Average per day',
      value: display(perDay),
      sub: `over ${days.value} day${days.value === 1 ? '' : 's'}`,
      tone: tone(perDay)
    },
    {
      key: 'transactions',
      label: 'Transactions',
      value: formatNumber(t.txCount),
      sub: `${display(t.txCount > 0 ? t.value / t.txCount : 0)} each`,
      tone: 'neutral'
    }
  ]
})

const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  error: 'text-error',
  neutral: ''
}
const TONE_TINT: Record<Tone, string> = {
  success: 'ring-1 ring-success/20 bg-success/5',
  error: 'ring-1 ring-error/20 bg-error/5',
  neutral: ''
}

// ---- Cumulative metric over the window ----
type Point = { date: Date, value: number }

const chartCardRef = useTemplateRef<HTMLElement>('chartCardRef')
const { width: chartWidth } = useElementSize(chartCardRef)

const labelsInScope = computed(() => new Set(scopedGames.value.map(g => g.label)))

const chartPoints = computed((): Point[] => {
  const rows = data.value?.series ?? []
  if (!rows.length) return []

  const inScope = labelsInScope.value
  const byBucket = new Map<number, number>()
  for (const row of rows) {
    if (!inScope.has(row.label)) continue
    const t = new Date(row.bucket).getTime()
    byBucket.set(t, (byBucket.get(t) ?? 0) + metricOf(row))
  }
  if (!byBucket.size) return []

  const points: Point[] = [{ date: new Date(data.value!.since), value: 0 }]
  let running = 0
  for (const t of [...byBucket.keys()].sort((a, b) => a - b)) {
    running += byBucket.get(t)!
    points.push({ date: new Date(t), value: running })
  }
  points.push({ date: new Date(), value: running })
  return points
})

// Insert an exact zero crossing so the line can render gains and losses in
// different colours without a gap where it changes sign.
const coloredPoints = computed((): Point[] => {
  const points: Point[] = []
  for (const point of chartPoints.value) {
    const previous = points.at(-1)
    if (previous && previous.value * point.value < 0) {
      const ratio = previous.value / (previous.value - point.value)
      points.push({
        date: new Date(previous.date.getTime() + ((point.date.getTime() - previous.date.getTime()) * ratio)),
        value: 0
      })
    }
    points.push(point)
  }
  return points
})

const xPoint = (_: Point, i: number) => i
const yPoint = (d: Point) => d.value
const chartTickFormat = (i: number) => {
  const points = coloredPoints.value
  if (i === 0 || i === points.length - 1 || !points[i]) return ''
  return format(points[i]!.date, data.value?.bucket === 'hour' ? 'HH:mm' : 'd MMM')
}
const chartTooltip = (d: Point) => display(d.value)
const chartColor = computed(() => houseSign.value < 0 ? 'var(--ui-error)' : 'var(--ui-success)')

// ---- Top players for the isolated game ----
const { data: topPlayers, pending: playersPending } = useLazyAsyncData(
  'audit-top-players',
  () => selectedGame.value
    ? $fetch<{ players: TopPlayer[] }>('/api/audit/players', {
        query: { label: selectedGame.value, window: windowKey.value, metric: metric.value }
      })
    : Promise.resolve(null),
  { immediate: false, watch: [selectedGame, windowKey, metric] }
)

const topPlayerRows = computed(() =>
  (topPlayers.value?.players ?? []).map(p => ({ ...p, value: metricOf(p) }))
)

/**
 * Bar behind each player, relative to the largest in the list. Taken over every
 * row rather than the first — under `net` the ranking is signed, so the biggest
 * magnitude can sit at the bottom.
 */
const maxAbsPlayerValue = computed(() => {
  let max = 0
  for (const p of topPlayerRows.value) max = Math.max(max, Math.abs(p.value))
  return max
})

function playerShare(value: number) {
  const max = maxAbsPlayerValue.value
  return `${max > 0 ? Math.max(2, (Math.abs(value) / max) * 100) : 0}%`
}

// ---- Table bars ----
const maxAbsValue = computed(() => {
  let max = 0
  for (const g of games.value) max = Math.max(max, Math.abs(g.value))
  return max || 1
})

function barWidth(value: number) {
  return `${Math.max(2, (Math.abs(value) / maxAbsValue.value) * 100)}%`
}

const GENRE_COLOR: Record<Genre, 'primary' | 'success' | 'warning' | 'neutral'> = {
  casino: 'primary',
  idle: 'success',
  active: 'warning',
  economy: 'neutral'
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <!-- Header + window -->
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">
          Audit
        </h1>
        <p class="text-sm text-muted mt-0.5">
          Site-wide ledger · last {{ windowLabel }}<span v-if="sinceLabel"> · since {{ sinceLabel }}</span>
        </p>
      </div>
      <UFieldGroup>
        <UButton
          v-for="w in WINDOWS"
          :key="w.value"
          :color="windowKey === w.value ? 'primary' : 'neutral'"
          :variant="windowKey === w.value ? 'solid' : 'outline'"
          :label="w.label"
          @click="windowKey = w.value"
        />
      </UFieldGroup>
    </div>

    <!-- Genre + metric -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="tab in genreTabs"
          :key="tab.value"
          :color="genre === tab.value ? 'primary' : 'neutral'"
          :variant="genre === tab.value ? 'soft' : 'ghost'"
          :label="tab.label"
          :title="tab.description"
          size="sm"
          @click="genre = tab.value"
        />
      </div>
      <UFieldGroup size="sm">
        <UButton
          v-for="m in METRICS"
          :key="m.value"
          :color="metric === m.value ? 'primary' : 'neutral'"
          :variant="metric === m.value ? 'solid' : 'outline'"
          :label="m.label"
          :title="m.description"
          @click="metric = m.value"
        />
      </UFieldGroup>
    </div>

    <!-- Isolated game banner -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div
        v-if="selectedGame"
        class="flex items-center gap-2 rounded-lg bg-primary/10 ring-1 ring-primary/20 px-3 py-2"
      >
        <UIcon
          name="i-lucide-filter"
          class="size-4 text-primary shrink-0"
        />
        <span class="text-sm">
          Showing only <span class="font-semibold">{{ selectedGame }}</span>
        </span>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          label="Clear"
          class="ml-auto"
          @click="selectedGame = null"
        />
      </div>
    </Transition>

    <!-- Summary -->
    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
      <template v-if="loading">
        <USkeleton
          v-for="i in 5"
          :key="i"
          class="h-24 rounded-xl"
        />
      </template>
      <template v-else>
        <UCard
          v-for="card in summaryCards"
          :key="card.key"
          :class="card.lead ? TONE_TINT[card.tone] : ''"
        >
          <p class="text-xs text-muted font-medium uppercase tracking-wide">
            {{ card.label }}
          </p>
          <p
            class="text-2xl font-bold mt-1 truncate"
            :class="TONE_TEXT[card.tone]"
            :title="card.value"
          >
            {{ card.value }}
          </p>
          <p class="text-xs text-muted mt-1 truncate">
            {{ card.sub }}
          </p>
        </UCard>
      </template>
    </div>

    <!-- Cumulative metric -->
    <UCard
      ref="chartCardRef"
      :ui="{ body: '!px-0 !pt-0 !pb-3' }"
    >
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="font-semibold">
              Cumulative {{ METRIC_HEADINGS[metric].toLowerCase() }}
            </h2>
            <p class="text-xs text-muted mt-0.5">
              {{ scopeLabel }} · bucketed by {{ data?.bucket ?? 'hour' }}
            </p>
          </div>
          <div
            v-if="isNet"
            class="flex items-center gap-4 text-xs text-muted"
          >
            <div class="flex items-center gap-1.5">
              <div class="size-2.5 rounded-sm bg-success" />
              <span>Profit</span>
            </div>
            <div class="flex items-center gap-1.5">
              <div class="size-2.5 rounded-sm bg-error" />
              <span>Loss</span>
            </div>
          </div>
        </div>
      </template>

      <USkeleton
        v-if="loading"
        class="h-48 rounded-lg"
      />
      <div
        v-else-if="coloredPoints.length < 2"
        class="h-48 flex flex-col items-center justify-center gap-2 text-muted"
      >
        <UIcon
          name="i-lucide-line-chart"
          class="size-10 opacity-20"
        />
        <p class="text-sm">
          No transactions in this window
        </p>
      </div>
      <ChartsChartLine
        v-else
        :data="coloredPoints"
        :x="xPoint"
        :y="yPoint"
        :color="chartColor"
        :negative-color="isNet ? 'var(--ui-error)' : undefined"
        :width="chartWidth"
        :tick-format="chartTickFormat"
        :tooltip-template="chartTooltip"
      />
    </UCard>

    <!-- Top players for the isolated game -->
    <UCard v-if="selectedGame">
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <h2 class="font-semibold">
            Top players · {{ selectedGame }}
          </h2>
          <span class="text-xs text-muted">
            by {{ METRIC_COLUMN[metric].toLowerCase() }} · last {{ windowLabel }}
          </span>
        </div>
      </template>

      <div
        v-if="playersPending"
        class="space-y-2"
      >
        <USkeleton
          v-for="i in 5"
          :key="i"
          class="h-10 rounded-lg"
        />
      </div>
      <p
        v-else-if="!topPlayerRows.length"
        class="py-6 text-center text-sm text-muted"
      >
        No players recorded for {{ selectedGame }} in this window
      </p>
      <ol
        v-else
        class="divide-y divide-default"
      >
        <li
          v-for="(player, i) in topPlayerRows"
          :key="player.userId"
          class="py-2.5"
        >
          <div class="flex items-center gap-3">
            <span class="w-4 text-sm text-muted tabular-nums shrink-0">{{ i + 1 }}</span>
            <UAvatar
              :src="player.image ?? undefined"
              :alt="player.name"
              size="sm"
            />
            <span class="font-medium truncate">{{ player.name }}</span>
            <span class="ml-auto text-xs text-muted tabular-nums shrink-0 hidden sm:inline">
              {{ formatNumber(player.txCount) }} tx · in {{ formatNumber(player.debits) }} · out {{ formatNumber(player.credits) }}
            </span>
            <span
              class="font-semibold tabular-nums shrink-0 w-24 text-right"
              :class="TONE_TEXT[tone(player.value)]"
            >
              {{ display(player.value) }}
            </span>
          </div>
          <div class="mt-1.5 ml-7 h-1 rounded-full bg-elevated overflow-hidden">
            <div
              class="h-full rounded-full"
              :class="goodForHouse(player.value) ? 'bg-success/70' : 'bg-error/70'"
              :style="{ width: playerShare(player.value) }"
            />
          </div>
        </li>
      </ol>
    </UCard>

    <!-- Per-game breakdown -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <h2 class="font-semibold">
            {{ METRIC_HEADINGS[metric] }} per game
          </h2>
          <span class="text-xs text-muted">
            sorted by {{ METRIC_COLUMN[metric].toLowerCase() }} · click a row to isolate it
          </span>
        </div>
      </template>

      <div
        v-if="loading"
        class="space-y-2"
      >
        <USkeleton
          v-for="i in 8"
          :key="i"
          class="h-12 rounded-lg"
        />
      </div>
      <div
        v-else-if="!games.length"
        class="py-12 flex flex-col items-center gap-2 text-muted"
      >
        <UIcon
          name="i-lucide-inbox"
          class="size-10 opacity-20"
        />
        <p class="text-sm">
          Nothing recorded for {{ scopeLabel }} in this window
        </p>
      </div>
      <div
        v-else
        class="overflow-x-auto -mx-4 sm:mx-0"
      >
        <table class="w-full min-w-[46rem] text-sm">
          <thead>
            <tr class="text-xs text-muted uppercase tracking-wide">
              <th class="text-left font-medium px-4 py-2">
                Game
              </th>
              <th class="text-right font-medium px-3 py-2">
                {{ METRIC_COLUMN[metric] }}
              </th>
              <th class="text-right font-medium px-3 py-2">
                Per day
              </th>
              <th class="text-right font-medium px-3 py-2">
                Per player
              </th>
              <th class="text-right font-medium px-3 py-2">
                Per tx
              </th>
              <th class="text-right font-medium px-3 py-2">
                Put in
              </th>
              <th class="text-right font-medium px-3 py-2">
                Paid out
              </th>
              <th class="text-right font-medium px-3 py-2">
                Tx
              </th>
              <th class="text-right font-medium px-4 py-2">
                Players
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="game in games"
              :key="game.label"
              class="border-t border-default cursor-pointer transition-colors hover:bg-elevated/60"
              :class="selectedGame === game.label ? 'bg-primary/10' : ''"
              @click="toggleGame(game.label)"
            >
              <td class="px-4 py-2.5">
                <div class="flex items-center gap-2">
                  <UBadge
                    :color="GENRE_COLOR[game.genre]"
                    variant="soft"
                    size="sm"
                    :label="GENRE_LABELS[game.genre]"
                  />
                  <span class="font-medium">{{ game.label }}</span>
                </div>
                <div class="mt-1.5 h-1 rounded-full bg-elevated overflow-hidden">
                  <div
                    class="h-full rounded-full"
                    :class="goodForHouse(game.value) ? 'bg-success/70' : 'bg-error/70'"
                    :style="{ width: barWidth(game.value) }"
                  />
                </div>
              </td>
              <td
                class="px-3 py-2.5 text-right font-semibold tabular-nums"
                :class="TONE_TEXT[tone(game.value)]"
              >
                {{ display(game.value) }}
              </td>
              <td class="px-3 py-2.5 text-right tabular-nums text-muted">
                {{ display(game.value / days) }}
              </td>
              <td class="px-3 py-2.5 text-right tabular-nums text-muted">
                {{ display(game.players > 0 ? game.value / game.players : 0) }}
              </td>
              <td class="px-3 py-2.5 text-right tabular-nums text-muted">
                {{ display(game.txCount > 0 ? game.value / game.txCount : 0) }}
              </td>
              <td class="px-3 py-2.5 text-right tabular-nums">
                {{ formatNumber(game.debits) }}
              </td>
              <td class="px-3 py-2.5 text-right tabular-nums">
                {{ formatNumber(game.credits) }}
              </td>
              <td class="px-3 py-2.5 text-right tabular-nums text-muted">
                {{ formatNumber(game.txCount) }}
              </td>
              <td class="px-4 py-2.5 text-right tabular-nums text-muted">
                {{ formatNumber(game.players) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </UContainer>
</template>
