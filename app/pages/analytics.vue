<script setup lang="ts">
import { format } from 'date-fns'
import { useElementSize } from '@vueuse/core'

// ---- Category filter (drives the server query) ----
const selectedCategory = ref<string | null>(null)

const { data, pending } = useFetch('/api/analytics/transactions', {
  lazy: true,
  query: computed(() => ({ category: selectedCategory.value ?? undefined }))
})

// `data` is retained while a filter change refetches, so only gate the skeletons
// on the very first load — filter toggles keep the previous view until fresh
// data lands instead of flashing skeletons.
const loading = computed(() => pending.value && !data.value)

const { signOut: authSignOut } = useAuth()

async function signOut() {
  await authSignOut({ redirectTo: '/login' })
}

const CHART_HEIGHT = 160

const fmtTime = (d: string | Date) =>
  new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

const todayLabel = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
})

// ---- 3-day bar chart ----
const last3DayStrs = computed(() =>
  Array.from({ length: 3 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (2 - i))
    return d.toISOString().slice(0, 10)
  })
)

function dayLabel(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const chartDays = computed(() =>
  last3DayStrs.value.map((date) => {
    const cr = data.value?.dailyStats.find(d => d.date === date && d.type === 'credit')
    const dr = data.value?.dailyStats.find(d => d.date === date && d.type === 'debit')
    return {
      date,
      label: dayLabel(date),
      credits: parseFloat(cr?.total ?? '0'),
      debits: parseFloat(dr?.total ?? '0')
    }
  })
)

const maxBarValue = computed(() => {
  let max = 0
  for (const day of chartDays.value) {
    max = Math.max(max, day.credits, day.debits)
  }
  return max || 100
})

function barHeight(value: number) {
  return `${Math.max(2, (value / maxBarValue.value) * CHART_HEIGHT)}px`
}

function mix(cssVar: string, opacity: number) {
  return `color-mix(in srgb, ${cssVar} ${Math.round(opacity * 100)}%, transparent)`
}

// ---- Summary cards (server-aggregated, reflects the active filter) ----
const summary = computed(() => data.value?.summary ?? { totalCredits: 0, totalDebits: 0, net: 0, txCount: 0 })

// ---- Category performance (today) — pre-aggregated server-side ----
const todayCatStats = computed(() => data.value?.categoryStats ?? [])

const maxCatVolume = computed(() => {
  let max = 0
  for (const s of todayCatStats.value) max = Math.max(max, s.volume)
  return max || 1
})

// ---- Category filter ----
function toggleCategory(cat: string) {
  selectedCategory.value = selectedCategory.value === cat ? null : cat
}

const selectedCatLabel = computed(() =>
  selectedCategory.value === 'general' ? 'General' : selectedCategory.value
)

const recentTransactions = computed(() => data.value?.recentTransactions ?? [])

// ---- Today's running balance (Unovis line chart) ----
// The server returns a minute-bucketed cumulative series; we frame it with a
// zero point at midnight and a flat segment out to "now" for the current value.
type PerfPoint = { date: Date, value: number }

const perfCardRef = useTemplateRef<HTMLElement>('perfCardRef')
const { width: perfCardWidth } = useElementSize(perfCardRef)

const lineChartData = computed((): PerfPoint[] => {
  const series = data.value?.perfSeries
  if (!series?.length) return []

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const pts: PerfPoint[] = [{ date: startOfDay, value: 0 }]
  for (const point of series) pts.push({ date: new Date(point.t), value: point.value })
  pts.push({ date: new Date(), value: series[series.length - 1]!.value })
  return pts
})

const finalValue = computed(() => summary.value.net)
const lineColor = computed(() => finalValue.value >= 0 ? 'var(--ui-success)' : 'var(--ui-error)')

// Split sign changes at an exact zero point so ChartsChartLine can render
// gains in green and losses in red without a gap at the crossover.
const coloredLineChartData = computed((): PerfPoint[] => {
  const points: PerfPoint[] = []
  for (const point of lineChartData.value) {
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

const xPerf = (_: PerfPoint, i: number) => i
const yPerf = (d: PerfPoint) => d.value

const xPerfTicks = (i: number) => {
  if (i === 0 || i === coloredLineChartData.value.length - 1 || !coloredLineChartData.value[i]) return ''
  return format(coloredLineChartData.value[i]!.date, 'HH:mm')
}

const perfTooltip = (d: PerfPoint) => formatNumber(d.value)

const mounted = ref(false)
onMounted(() => setTimeout(() => { mounted.value = true }, 50))
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">
          Analytics
        </h1>
        <p class="text-sm text-muted mt-0.5">
          {{ todayLabel }}
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <UButton
          to="/profile"
          color="neutral"
          variant="outline"
          icon="i-lucide-user-round"
          label="Profile"
        />
        <UButton
          color="error"
          variant="soft"
          icon="i-lucide-log-out"
          label="Sign out"
          @click="signOut"
        />
      </div>
    </div>

    <!-- Active category filter banner -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div
        v-if="selectedCategory"
        class="flex items-center gap-2 rounded-lg bg-primary/10 ring-1 ring-primary/20 px-3 py-2"
      >
        <UIcon
          name="i-lucide-filter"
          class="size-4 text-primary shrink-0"
        />
        <span class="text-sm">
          Showing only <span class="font-semibold capitalize">{{ selectedCatLabel }}</span> for today
        </span>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          label="Clear filter"
          class="ml-auto"
          @click="selectedCategory = null"
        />
      </div>
    </Transition>

    <!-- Stats cards -->
    <div
      v-if="loading"
      class="grid grid-cols-2 lg:grid-cols-4 gap-4"
    >
      <USkeleton
        v-for="i in 4"
        :key="i"
        class="h-24 rounded-xl"
      />
    </div>
    <div
      v-else
      class="grid grid-cols-2 lg:grid-cols-4 gap-4"
    >
      <UCard class="ring-1 ring-success/20 bg-success/5">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-muted font-medium uppercase tracking-wide">
              Credits{{ selectedCategory ? ` · ${selectedCatLabel}` : ' Today' }}
            </p>
            <p class="text-2xl font-bold text-success mt-1">
              +{{ formatNumber(summary.totalCredits) }}
            </p>
          </div>
          <div class="size-9 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
            <UIcon
              name="i-lucide-trending-up"
              class="size-4 text-success"
            />
          </div>
        </div>
      </UCard>

      <UCard class="ring-1 ring-error/20 bg-error/5">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-muted font-medium uppercase tracking-wide">
              Debits{{ selectedCategory ? ` · ${selectedCatLabel}` : ' Today' }}
            </p>
            <p class="text-2xl font-bold text-error mt-1">
              -{{ formatNumber(summary.totalDebits) }}
            </p>
          </div>
          <div class="size-9 rounded-lg bg-error/15 flex items-center justify-center shrink-0">
            <UIcon
              name="i-lucide-trending-down"
              class="size-4 text-error"
            />
          </div>
        </div>
      </UCard>

      <UCard
        :class="[
          'ring-1',
          summary.net >= 0
            ? 'ring-success/20 bg-success/5'
            : 'ring-error/20 bg-error/5'
        ]"
      >
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-muted font-medium uppercase tracking-wide">
              Net{{ selectedCategory ? ` · ${selectedCatLabel}` : ' Today' }}
            </p>
            <p
              class="text-2xl font-bold mt-1"
              :class="summary.net >= 0 ? 'text-success' : 'text-error'"
            >
              {{ summary.net >= 0 ? '+' : '' }}{{ formatNumber(summary.net) }}
            </p>
          </div>
          <div
            class="size-9 rounded-lg flex items-center justify-center shrink-0"
            :class="summary.net >= 0 ? 'bg-success/15' : 'bg-error/15'"
          >
            <UIcon
              name="i-lucide-wallet"
              class="size-4"
              :class="summary.net >= 0 ? 'text-success' : 'text-error'"
            />
          </div>
        </div>
      </UCard>

      <UCard>
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-muted font-medium uppercase tracking-wide">
              Transactions
            </p>
            <p class="text-2xl font-bold mt-1">
              {{ summary.txCount }}
            </p>
          </div>
          <div class="size-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <UIcon
              name="i-lucide-activity"
              class="size-4 text-primary"
            />
          </div>
        </div>
      </UCard>
    </div>

    <!-- Charts row: 3-day bars + category performance -->
    <div class="grid lg:grid-cols-3 gap-6">
      <!-- Last 3 days bar chart -->
      <UCard class="lg:col-span-2">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">
              Last 3 Days
            </h2>
            <div class="flex items-center gap-4 text-xs text-muted">
              <div class="flex items-center gap-1.5">
                <div class="size-2.5 rounded-sm bg-success" />
                <span>Credits</span>
              </div>
              <div class="flex items-center gap-1.5">
                <div class="size-2.5 rounded-sm bg-error" />
                <span>Debits</span>
              </div>
            </div>
          </div>
        </template>

        <div v-if="loading">
          <USkeleton class="h-48 rounded-lg" />
        </div>
        <div
          v-else-if="!data?.dailyStats?.length"
          class="h-48 flex flex-col items-center justify-center gap-2 text-muted"
        >
          <UIcon
            name="i-lucide-bar-chart-3"
            class="size-10 opacity-20"
          />
          <p class="text-sm">
            No transaction data yet
          </p>
        </div>
        <div
          v-else
          class="flex gap-2 items-end px-2"
          :style="{ height: `${CHART_HEIGHT + 48}px` }"
        >
          <div
            v-for="day in chartDays"
            :key="day.date"
            class="flex-1 flex flex-col items-center"
          >
            <div
              class="flex items-end gap-1.5 mb-2"
              :style="{ height: `${CHART_HEIGHT}px` }"
            >
              <div
                class="w-7 rounded-t-md transition-all duration-700 ease-out relative group cursor-default"
                :style="{
                  height: mounted ? barHeight(day.credits) : '2px',
                  backgroundColor: mix('var(--ui-success)', 0.73),
                  minHeight: '2px'
                }"
              >
                <div class="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-elevated border border-default text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                  +{{ formatNumber(day.credits) }}
                </div>
              </div>
              <div
                class="w-7 rounded-t-md transition-all duration-700 ease-out relative group cursor-default"
                :style="{
                  height: mounted ? barHeight(day.debits) : '2px',
                  backgroundColor: mix('var(--ui-error)', 0.73),
                  minHeight: '2px'
                }"
              >
                <div class="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-elevated border border-default text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                  -{{ formatNumber(day.debits) }}
                </div>
              </div>
            </div>
            <div class="text-xs text-muted font-medium">
              {{ day.label }}
            </div>
          </div>
        </div>
      </UCard>

      <!-- Category performance today -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">
              Today by Category
            </h2>
            <UButton
              v-if="selectedCategory"
              size="xs"
              color="neutral"
              variant="ghost"
              label="Show all"
              @click="selectedCategory = null"
            />
          </div>
        </template>

        <div
          v-if="loading"
          class="space-y-4"
        >
          <USkeleton
            v-for="i in 3"
            :key="i"
            class="h-10 rounded-lg"
          />
        </div>
        <div
          v-else-if="!todayCatStats.length"
          class="h-48 flex flex-col items-center justify-center gap-2 text-muted"
        >
          <UIcon
            name="i-lucide-layers"
            class="size-10 opacity-20"
          />
          <p class="text-sm">
            No data today
          </p>
        </div>
        <div
          v-else
          class="space-y-1.5"
        >
          <button
            v-for="stat in todayCatStats"
            :key="stat.category"
            type="button"
            class="w-full text-left rounded-lg px-2.5 py-2 -mx-2.5 transition-colors cursor-pointer"
            :class="selectedCategory === stat.category
              ? 'bg-primary/10 ring-1 ring-primary/30'
              : 'hover:bg-elevated/70'"
            @click="toggleCategory(stat.category)"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-sm font-medium capitalize truncate">{{ stat.category }}</span>
                <UBadge
                  :label="`${stat.count}`"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                />
              </div>
              <span
                class="text-sm font-semibold tabular-nums shrink-0"
                :class="stat.net >= 0 ? 'text-success' : 'text-error'"
              >
                {{ stat.net >= 0 ? '+' : '' }}{{ formatNumber(stat.net) }}
              </span>
            </div>
            <div class="mt-1.5 h-1.5 rounded-full bg-elevated overflow-hidden flex">
              <div
                class="h-full bg-success transition-all duration-500"
                :style="{ width: `${(stat.credits / maxCatVolume) * 100}%` }"
              />
              <div
                class="h-full bg-error transition-all duration-500"
                :style="{ width: `${(stat.debits / maxCatVolume) * 100}%` }"
              />
            </div>
          </button>
        </div>
      </UCard>
    </div>

    <!-- Today's performance line chart -->
    <UCard
      ref="perfCardRef"
      :ui="{ body: '!px-0 !pt-0 !pb-3' }"
    >
      <template #header>
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-xs text-muted uppercase mb-1">
              Today's Performance{{ selectedCategory ? ` · ${selectedCatLabel}` : '' }}
            </p>
            <p
              class="text-2xl font-semibold"
              :class="finalValue >= 0 ? 'text-success' : 'text-error'"
            >
              {{ finalValue >= 0 ? '+' : '' }}{{ formatNumber(finalValue) }}
            </p>
          </div>
          <UButton
            v-if="selectedCategory"
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-x"
            label="Clear"
            @click="selectedCategory = null"
          />
        </div>
      </template>

      <div v-if="loading">
        <USkeleton class="h-48 mx-4 rounded-lg" />
      </div>
      <div
        v-else-if="!lineChartData.length"
        class="h-48 flex flex-col items-center justify-center gap-2 text-muted"
      >
        <UIcon
          name="i-lucide-line-chart"
          class="size-10 opacity-20"
        />
        <p class="text-sm">
          {{ selectedCategory ? `No ${selectedCatLabel} transactions today` : 'No transactions today' }}
        </p>
      </div>
      <ChartsChartLine
        v-else
        :key="`${selectedCategory ?? 'all'}-${lineColor}`"
        :data="coloredLineChartData"
        :x="xPerf"
        :y="yPerf"
        color="var(--ui-success)"
        negative-color="var(--ui-error)"
        :width="perfCardWidth"
        :tick-format="xPerfTicks"
        :tooltip-template="perfTooltip"
        :padding="{ top: 40 }"
      />
    </UCard>

    <!-- Today's transactions -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">
            {{ selectedCategory ? `${selectedCatLabel} Transactions` : "Today's Transactions" }}
          </h2>
          <div class="flex items-center gap-2">
            <UBadge
              :label="`${summary.txCount} total`"
              color="neutral"
              variant="subtle"
            />
            <UButton
              v-if="selectedCategory"
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              @click="selectedCategory = null"
            />
          </div>
        </div>
      </template>

      <div
        v-if="loading"
        class="space-y-3"
      >
        <div
          v-for="i in 5"
          :key="i"
          class="flex items-center gap-3"
        >
          <USkeleton class="size-8 rounded-full" />
          <div class="flex-1 space-y-1.5">
            <USkeleton class="h-3.5 w-32" />
            <USkeleton class="h-3 w-20" />
          </div>
          <USkeleton class="h-4 w-16" />
        </div>
      </div>
      <div
        v-else-if="!recentTransactions.length"
        class="py-12 flex flex-col items-center gap-2 text-muted"
      >
        <UIcon
          name="i-lucide-receipt"
          class="size-10 opacity-20"
        />
        <p class="text-sm">
          {{ selectedCategory ? `No ${selectedCatLabel} transactions today` : 'No transactions today' }}
        </p>
      </div>
      <UScrollArea
        v-else
        class="max-h-96 -mx-4 -mb-4"
      >
        <div class="divide-y divide-default">
          <div
            v-for="tx in recentTransactions"
            :key="tx.id"
            class="flex items-center gap-3 px-4 py-3 hover:bg-elevated/50 transition-colors"
          >
            <div
              class="size-8 rounded-full flex items-center justify-center shrink-0"
              :class="tx.type === 'credit' ? 'bg-success/15' : 'bg-error/15'"
            >
              <UIcon
                :name="tx.type === 'credit' ? 'i-lucide-arrow-down-left' : 'i-lucide-arrow-up-right'"
                class="size-4"
                :class="tx.type === 'credit' ? 'text-success' : 'text-error'"
              />
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="text-sm font-medium capitalize hover:text-primary hover:underline underline-offset-2 cursor-pointer transition-colors"
                  @click="toggleCategory(tx.category ?? 'general')"
                >
                  {{ tx.category ?? 'General' }}
                </button>
                <UBadge
                  :label="tx.type"
                  :color="tx.type === 'credit' ? 'success' : 'error'"
                  variant="subtle"
                  size="sm"
                />
              </div>
              <p class="text-xs text-muted mt-0.5">
                {{ fmtTime(tx.createdAt) }}
              </p>
            </div>

            <span
              class="text-sm font-semibold tabular-nums"
              :class="tx.type === 'credit' ? 'text-success' : 'text-error'"
            >
              {{ tx.type === 'credit' ? '+' : '-' }}{{ formatNumber(parseFloat(tx.amount)) }}
            </span>
          </div>
        </div>
        <p
          v-if="summary.txCount > recentTransactions.length"
          class="text-xs text-muted text-center py-3 border-t border-default"
        >
          Showing the latest {{ recentTransactions.length }} of {{ formatNumber(summary.txCount) }}
        </p>
      </UScrollArea>
    </UCard>
  </UContainer>
</template>

<style scoped>
.unovis-xy-container {
  --vis-crosshair-line-stroke-color: v-bind(lineColor);
  --vis-crosshair-circle-stroke-color: var(--ui-bg);

  --vis-axis-grid-color: var(--ui-border);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-tick-label-color: var(--ui-text-dimmed);

  --vis-tooltip-background-color: var(--ui-bg);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text-highlighted);
}
</style>
