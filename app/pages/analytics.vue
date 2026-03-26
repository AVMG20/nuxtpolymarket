<script setup lang="ts">
import { format } from 'date-fns'
import { useElementSize } from '@vueuse/core'

const { data, pending } = await useFetch('/api/analytics/transactions')
const { signOut: authSignOut } = useAuth()

async function signOut() {
  await authSignOut({ redirectTo: '/login' })
}

const CHART_HEIGHT = 160

const fmtTime = (d: string | Date) =>
  new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

const todayLabel = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
})

// ---- 3-day bar chart ----
const last3DayStrs = computed(() =>
  Array.from({ length: 3 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (2 - i))
    return d.toISOString().split('T')[0]
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
  last3DayStrs.value.map(date => {
    const cr = data.value?.dailyStats.find(d => d.date === date && d.type === 'credit')
    const dr = data.value?.dailyStats.find(d => d.date === date && d.type === 'debit')
    return {
      date,
      label: dayLabel(date),
      credits: parseFloat(cr?.total ?? '0'),
      debits: parseFloat(dr?.total ?? '0'),
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

// ---- Category performance (today) ----
const todayCatStats = computed(() => {
  const txs = data.value?.todayTransactions
  if (!txs?.length) return []
  const cats: Record<string, { credits: number, debits: number }> = {}
  for (const tx of txs) {
    const cat = tx.category ?? 'general'
    if (!cats[cat]) cats[cat] = { credits: 0, debits: 0 }
    if (tx.type === 'credit') cats[cat].credits += parseFloat(tx.amount)
    else cats[cat].debits += parseFloat(tx.amount)
  }
  return Object.entries(cats)
    .map(([cat, s]) => ({ cat, credits: s.credits, debits: s.debits, net: s.credits - s.debits }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
})


// ---- Today's running balance (Unovis line chart) ----
type PerfPoint = { date: Date, value: number }

const perfCardRef = useTemplateRef<HTMLElement>('perfCardRef')
const { width: perfCardWidth } = useElementSize(perfCardRef)

const lineChartData = computed((): PerfPoint[] => {
  const txs = data.value?.todayTransactions
  if (!txs?.length) return []

  const sorted = [...txs].reverse()
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  let running = 0
  const pts: PerfPoint[] = [{ date: startOfDay, value: 0 }]
  for (const tx of sorted) {
    running += tx.type === 'credit' ? parseFloat(tx.amount) : -parseFloat(tx.amount)
    pts.push({ date: new Date(tx.createdAt), value: running })
  }
  pts.push({ date: new Date(), value: running })
  return pts
})

const finalValue = computed(() => lineChartData.value[lineChartData.value.length - 1]?.value ?? 0)
const lineColor = computed(() => finalValue.value >= 0 ? 'var(--ui-success)' : 'var(--ui-error)')

const xPerf = (_: PerfPoint, i: number) => i
const yPerf = (d: PerfPoint) => d.value

const xPerfTicks = (i: number) => {
  if (i === 0 || i === lineChartData.value.length - 1 || !lineChartData.value[i]) return ''
  return format(lineChartData.value[i]!.date, 'HH:mm')
}

const perfTooltip = (d: PerfPoint) => formatNumber(d.value)

const mounted = ref(false)
onMounted(() => setTimeout(() => { mounted.value = true }, 50))
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Analytics</h1>
        <p class="text-sm text-muted mt-0.5">{{ todayLabel }}</p>
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

    <!-- Stats cards -->
    <div v-if="pending" class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <USkeleton v-for="i in 4" :key="i" class="h-24 rounded-xl" />
    </div>
    <div v-else class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <UCard class="ring-1 ring-success/20 bg-success/5">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-muted font-medium uppercase tracking-wide">Credits Today</p>
            <p class="text-2xl font-bold text-success mt-1">+{{ formatNumber(data?.summary.totalCredits ?? 0) }}</p>
          </div>
          <div class="size-9 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
            <UIcon name="i-lucide-trending-up" class="size-4 text-success" />
          </div>
        </div>
      </UCard>

      <UCard class="ring-1 ring-error/20 bg-error/5">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-muted font-medium uppercase tracking-wide">Debits Today</p>
            <p class="text-2xl font-bold text-error mt-1">-{{ formatNumber(data?.summary.totalDebits ?? 0) }}</p>
          </div>
          <div class="size-9 rounded-lg bg-error/15 flex items-center justify-center shrink-0">
            <UIcon name="i-lucide-trending-down" class="size-4 text-error" />
          </div>
        </div>
      </UCard>

      <UCard
        :class="[
          'ring-1',
          (data?.summary.net ?? 0) >= 0
            ? 'ring-success/20 bg-success/5'
            : 'ring-error/20 bg-error/5',
        ]"
      >
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-muted font-medium uppercase tracking-wide">Net Today</p>
            <p
              class="text-2xl font-bold mt-1"
              :class="(data?.summary.net ?? 0) >= 0 ? 'text-success' : 'text-error'"
            >
              {{ (data?.summary.net ?? 0) >= 0 ? '+' : '' }}{{ formatNumber(data?.summary.net ?? 0) }}
            </p>
          </div>
          <div
            class="size-9 rounded-lg flex items-center justify-center shrink-0"
            :class="(data?.summary.net ?? 0) >= 0 ? 'bg-success/15' : 'bg-error/15'"
          >
            <UIcon
              name="i-lucide-wallet"
              class="size-4"
              :class="(data?.summary.net ?? 0) >= 0 ? 'text-success' : 'text-error'"
            />
          </div>
        </div>
      </UCard>

      <UCard>
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-muted font-medium uppercase tracking-wide">Transactions</p>
            <p class="text-2xl font-bold mt-1">{{ data?.summary.txCount ?? 0 }}</p>
          </div>
          <div class="size-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <UIcon name="i-lucide-activity" class="size-4 text-primary" />
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
            <h2 class="font-semibold">Last 3 Days</h2>
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

        <div v-if="pending">
          <USkeleton class="h-48 rounded-lg" />
        </div>
        <div
          v-else-if="!data?.dailyStats?.length"
          class="h-48 flex flex-col items-center justify-center gap-2 text-muted"
        >
          <UIcon name="i-lucide-bar-chart-3" class="size-10 opacity-20" />
          <p class="text-sm">No transaction data yet</p>
        </div>
        <div v-else class="flex gap-2 items-end px-2" :style="{ height: `${CHART_HEIGHT + 48}px` }">
          <div v-for="day in chartDays" :key="day.date" class="flex-1 flex flex-col items-center">
            <div class="flex items-end gap-1.5 mb-2" :style="{ height: `${CHART_HEIGHT}px` }">
              <div
                class="w-7 rounded-t-md transition-all duration-700 ease-out relative group cursor-default"
                :style="{
                  height: mounted ? barHeight(day.credits) : '2px',
                  backgroundColor: mix('var(--ui-success)', 0.73),
                  minHeight: '2px',
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
                  minHeight: '2px',
                }"
              >
                <div class="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-elevated border border-default text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                  -{{ formatNumber(day.debits) }}
                </div>
              </div>
            </div>
            <div class="text-xs text-muted font-medium">{{ day.label }}</div>
          </div>
        </div>
      </UCard>

      <!-- Category performance today -->
      <UCard>
        <template #header>
          <h2 class="font-semibold">Today by Category</h2>
        </template>

        <div v-if="pending" class="space-y-4">
          <USkeleton v-for="i in 3" :key="i" class="h-10 rounded-lg" />
        </div>
        <div
          v-else-if="!todayCatStats.length"
          class="h-48 flex flex-col items-center justify-center gap-2 text-muted"
        >
          <UIcon name="i-lucide-layers" class="size-10 opacity-20" />
          <p class="text-sm">No data today</p>
        </div>
        <div v-else class="space-y-2">
          <div v-for="stat in todayCatStats" :key="stat.cat" class="flex items-center justify-between">
            <span class="text-sm font-medium capitalize">{{ stat.cat }}</span>
            <span
              class="text-sm font-semibold tabular-nums"
              :class="stat.net >= 0 ? 'text-success' : 'text-error'"
            >
              {{ stat.net >= 0 ? '+' : '' }}{{ formatNumber(stat.net) }}
            </span>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Today's performance line chart -->
    <UCard ref="perfCardRef" :ui="{ body: '!px-0 !pt-0 !pb-3' }">
      <template #header>
        <div>
          <p class="text-xs text-muted uppercase mb-1">Today's Performance</p>
          <p
            class="text-2xl font-semibold"
            :class="finalValue >= 0 ? 'text-success' : 'text-error'"
          >
            {{ finalValue >= 0 ? '+' : '' }}{{ formatNumber(finalValue) }}
          </p>
        </div>
      </template>

      <div v-if="pending">
        <USkeleton class="h-48 mx-4 rounded-lg" />
      </div>
      <div
        v-else-if="!lineChartData.length"
        class="h-48 flex flex-col items-center justify-center gap-2 text-muted"
      >
        <UIcon name="i-lucide-line-chart" class="size-10 opacity-20" />
        <p class="text-sm">No transactions today</p>
      </div>
      <ChartsChartLine
          v-else
          :data="lineChartData"
          :x="xPerf"
          :y="yPerf"
          :color="lineColor"
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
          <h2 class="font-semibold">Today's Transactions</h2>
          <UBadge
            :label="`${data?.todayTransactions.length ?? 0} total`"
            color="neutral"
            variant="subtle"
          />
        </div>
      </template>

      <div v-if="pending" class="space-y-3">
        <div v-for="i in 5" :key="i" class="flex items-center gap-3">
          <USkeleton class="size-8 rounded-full" />
          <div class="flex-1 space-y-1.5">
            <USkeleton class="h-3.5 w-32" />
            <USkeleton class="h-3 w-20" />
          </div>
          <USkeleton class="h-4 w-16" />
        </div>
      </div>
      <div
        v-else-if="!data?.todayTransactions.length"
        class="py-12 flex flex-col items-center gap-2 text-muted"
      >
        <UIcon name="i-lucide-receipt" class="size-10 opacity-20" />
        <p class="text-sm">No transactions today</p>
      </div>
      <UScrollArea v-else class="max-h-96 -mx-4 -mb-4">
        <div class="divide-y divide-default">
          <div
            v-for="tx in data.todayTransactions"
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
                <span class="text-sm font-medium capitalize">{{ tx.category ?? 'General' }}</span>
                <UBadge
                  :label="tx.type"
                  :color="tx.type === 'credit' ? 'success' : 'error'"
                  variant="subtle"
                  size="sm"
                />
              </div>
              <p class="text-xs text-muted mt-0.5">{{ fmtTime(tx.createdAt) }}</p>
            </div>

            <span
              class="text-sm font-semibold tabular-nums"
              :class="tx.type === 'credit' ? 'text-success' : 'text-error'"
            >
              {{ tx.type === 'credit' ? '+' : '-' }}{{ formatNumber(parseFloat(tx.amount)) }}
            </span>
          </div>
        </div>
      </UScrollArea>
    </UCard>
  </div>
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
