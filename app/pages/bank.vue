<script setup lang="ts">
import { format, formatDistanceToNow } from 'date-fns'
import { useElementSize, useIntervalFn } from '@vueuse/core'
import { LOAN_DAILY_RATE, bankDailyRate, growBankBalance } from '#shared/utils/gamelogic/bank'

type BankPoint = { id: string, balance: string, action: string, amount: string, createdAt: string }
type BankData = {
  balance: number, principal: number, totalDeposited: number, loanLimit: number, loanPrincipal: number
  loanAvailable: number, debtLimit: number, lastSettledAt: string, history: BankPoint[]
}
type ChartRange = '1d' | '7d' | '30d'

const { data, refresh } = await useFetch<BankData>('/api/bank/state')
const { data: chartHistory, refresh: refreshChartHistory } = await useFetch<{ points: BankPoint[] }>('/api/bank/chart')
const { user, fetchSession } = useAuth()
const toast = useToast()
const now = ref(Date.now())
const amount = ref<number | null>(null)
const loading = ref<'deposit' | 'withdraw' | null>(null)
const history = ref<BankPoint[]>([])
const historyLoading = ref(false)
const historyHasMore = ref(false)
const chartRef = useTemplateRef<HTMLElement>('chartRef')
const { width: chartWidth } = useElementSize(chartRef)
const chartRange = ref<ChartRange>('1d')
const chartRanges: ChartRange[] = ['1d', '7d', '30d']

useIntervalFn(() => { now.value = Date.now() }, 50)
useIntervalFn(() => refresh(), 30_000)

const liveBalance = computed(() => data.value
  ? growBankBalance(data.value.balance, new Date(data.value.lastSettledAt), new Date(now.value))
  : 0
)
const isInDebt = computed(() => liveBalance.value < 0)
const bankProfitLoss = computed(() => liveBalance.value - (data.value?.principal ?? 0))
const walletBalance = computed(() => parseFloat(user.value?.balance ?? '0'))
// Match the server settlement rate exactly between refreshes. The amount itself
// still updates in real time, but its current accrual period uses this anchor.
const rate = computed(() => isInDebt.value ? LOAN_DAILY_RATE : bankDailyRate(Math.max(0, data.value?.balance ?? 0)))
const interestToday = computed(() => Math.abs(liveBalance.value) * rate.value)
const validAmount = computed(() => amount.value && amount.value > 0 ? amount.value : 0)
const availableLoan = computed(() => data.value?.loanAvailable ?? 0)
const availableBankBalance = computed(() => Math.max(0, liveBalance.value))
const maxWithdrawal = computed(() => Math.max(0, liveBalance.value) + availableLoan.value)
const canDeposit = computed(() => validAmount.value > 0 && walletBalance.value >= validAmount.value)
const canWithdraw = computed(() => validAmount.value > 0 && validAmount.value <= maxWithdrawal.value)
const canRepayDebt = computed(() => isInDebt.value && walletBalance.value >= Math.abs(liveBalance.value))
const isEmpty = computed(() => Math.abs(liveBalance.value) < 0.0001)

type ChartPoint = { date: Date, balance: number }
const chartRangeDays: Record<ChartRange, number> = { '1d': 1, '7d': 7, '30d': 30 }
const chartHistoryPoints = computed(() => chartHistory.value?.points ?? [])
const chartRangeAvailable = (range: ChartRange) => {
  if (range === '1d') return true
  const first = chartHistoryPoints.value[0]
  return !!first && now.value - new Date(first.createdAt).getTime() >= chartRangeDays[range] * 86_400_000
}
const chartData = computed((): ChartPoint[] => {
  if (!data.value || !chartHistoryPoints.value.length) return []
  const history = chartHistoryPoints.value.map(point => ({ date: new Date(point.createdAt), balance: parseFloat(point.balance) }))
  const cutoff = new Date(now.value - chartRangeDays[chartRange.value] * 86_400_000)
  const anchorIndex = Math.max(0, history.findLastIndex(point => point.date <= cutoff))

  const points: ChartPoint[] = []
  for (let index = anchorIndex; index < history.length; index++) {
    const from = history[index]!
    const to = history[index + 1]?.date ?? new Date(now.value)
    const segmentStart = index === anchorIndex ? cutoff : from.date
    const segmentEnd = new Date(Math.min(to.getTime(), now.value))
    const steps = Math.max(1, Math.min(12, Math.ceil((segmentEnd.getTime() - segmentStart.getTime()) / 7_200_000)))

    for (let step = 0; step <= steps; step++) {
      const time = new Date(segmentStart.getTime() + ((segmentEnd.getTime() - segmentStart.getTime()) * step / steps))
      points.push({ date: time, balance: growBankBalance(from.balance, from.date, time) })
    }
    if (to.getTime() > now.value) break
  }

  const current = new Date(now.value)
  const last = points.at(-1)
  if (!last || last.date.getTime() !== current.getTime()) {
    const anchor = history.at(-1)!
    points.push({ date: current, balance: growBankBalance(anchor.balance, anchor.date, current) })
  }
  const zeroCrossingPoints: ChartPoint[] = []
  for (const point of points) {
    const previous = zeroCrossingPoints.at(-1)
    if (previous && previous.balance * point.balance < 0) {
      const ratio = previous.balance / (previous.balance - point.balance)
      zeroCrossingPoints.push({
        date: new Date(previous.date.getTime() + ((point.date.getTime() - previous.date.getTime()) * ratio)),
        balance: 0
      })
    }
    zeroCrossingPoints.push(point)
  }
  return zeroCrossingPoints
})
const xFn = (_: ChartPoint, index: number) => index
const yFn = (point: ChartPoint) => point.balance
const xTickFmt = (index: number) => {
  const point = chartData.value[Math.round(index)]
  if (!point) return ''
  if (chartRange.value === '1d') return format(point.date, 'HH:mm')
  return chartRange.value === '7d' ? format(point.date, 'EEE') : format(point.date, 'MMM d')
}
const tooltipFmt = (point: ChartPoint) =>
  `<div style="font-weight:700;font-size:1rem">${point.balance < 0 ? '-' : '+'}${formatNumber(Math.abs(point.balance), false)}</div>` +
  `<div style="font-size:0.7rem;opacity:0.6;margin-top:2px">${format(point.date, 'MMM d, HH:mm:ss')}</div>`
const lineColor = computed(() => isInDebt.value ? 'var(--ui-error)' : 'var(--ui-primary)')

async function loadHistory(reset = false) {
  if (historyLoading.value) return
  historyLoading.value = true
  try {
    const offset = reset ? 0 : history.value.length
    const result = await $fetch<{ items: BankPoint[], hasMore: boolean }>('/api/bank/history', { query: { offset } })
    history.value = reset ? result.items : [...history.value, ...result.items]
    historyHasMore.value = result.hasMore
  } finally {
    historyLoading.value = false
  }
}

onMounted(() => loadHistory())

watch(chartRange, range => {
  if (!chartRangeAvailable(range)) chartRange.value = '1d'
})

function setAmount(value: number) {
  amount.value = Math.max(0, Math.floor(value * 10_000) / 10_000)
}

async function submit(action: 'deposit' | 'withdraw', overrideAmount?: number, repayDebt = false) {
  const selectedAmount = overrideAmount ?? validAmount.value
  if (!repayDebt && (!selectedAmount || selectedAmount <= 0)) return
  loading.value = action
  try {
    await $fetch(`/api/bank/${action}`, { method: 'POST', body: repayDebt ? { repayDebt: true } : { amount: selectedAmount } })
    amount.value = null
    await Promise.all([refresh(), refreshChartHistory(), fetchSession(), loadHistory(true)])
    toast.add({ title: repayDebt ? 'Debt repaid exactly' : action === 'deposit' ? 'Money deposited' : 'Money withdrawn', color: 'success', icon: 'i-lucide-check' })
  } catch (error: unknown) {
    const message = typeof error === 'object' && error && 'data' in error
      ? (error.data as { statusMessage?: string })?.statusMessage
      : undefined
    toast.add({ title: message ?? 'Bank action failed', color: 'error' })
  } finally {
    loading.value = null
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-5">
    <div class="flex items-center justify-between gap-4">
      <div>
        <p class="text-sm font-medium text-primary">Polynux Bank</p>
        <h1 class="text-3xl font-bold tracking-tight">Make your balance work.</h1>
      </div>
      <UBadge :color="isInDebt ? 'error' : 'success'" variant="subtle" :icon="isInDebt ? 'i-lucide-triangle-alert' : 'i-lucide-landmark'" :label="isInDebt ? 'Debt accruing' : 'Savings account'" />
    </div>

    <section class="overflow-hidden rounded-xl border border-default bg-elevated/40">
      <div class="grid lg:grid-cols-[1.35fr_0.65fr]">
        <div class="p-6 sm:p-8" :class="isInDebt ? 'bg-error/5' : 'bg-primary/5'">
          <div class="flex items-center justify-between gap-4">
            <p class="text-sm font-medium text-muted">Current bank balance</p>
            <span class="text-sm font-medium whitespace-nowrap" :class="isInDebt ? 'text-error' : 'text-success'">
              {{ isInDebt ? 'owing' : 'earning' }} {{ (rate * 100).toFixed(2) }}% / day
            </span>
          </div>
          <div class="mt-2 flex items-end gap-3">
            <div class="flex items-center gap-2 text-4xl sm:text-5xl font-bold tracking-tight tabular-nums" :class="isInDebt ? 'text-error' : 'text-highlighted'">
              <span v-if="isInDebt">−</span>
              <UIcon name="i-lucide-coins" class="size-8 sm:size-10 text-yellow-400" />
              <span>{{ formatNumber(Math.abs(liveBalance), false) }}</span>
            </div>
          </div>
          <div class="mt-3 text-sm text-muted">
            <span v-if="isInDebt">Debt grows by <CoinBalance :value="interestToday" :compact="false" class="inline-flex align-middle" /> over the next 24 hours.</span>
            <span v-else>Earns about <CoinBalance :value="interestToday" :compact="false" class="inline-flex align-middle" /> over the next 24 hours.</span>
          </div>
        </div>
        <div class="border-t border-default p-5 sm:p-6 lg:border-t-0 lg:border-l">
          <p class="text-xs font-medium uppercase tracking-wide text-muted">{{ bankProfitLoss < 0 ? 'Total bank loss' : 'Total bank profit' }}</p>
          <CoinBalance :value="Math.abs(bankProfitLoss)" :compact="false" class="mt-2 text-xl font-bold tabular-nums" :class="bankProfitLoss < 0 ? 'text-error' : 'text-success'" />
          <p class="mt-1 text-xs text-muted">{{ bankProfitLoss < 0 ? 'Current outstanding debt' : 'Interest earned to date' }}</p>
        </div>
      </div>
    </section>

    <div class="grid lg:grid-cols-[1.45fr_0.85fr] gap-5 items-stretch">
      <UCard ref="chartRef" :ui="{ body: '!px-0 !pt-0 !pb-3' }">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="font-semibold">Balance trajectory</h2>
              <p class="text-xs text-muted mt-0.5">Settles continuously from your latest action.</p>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex rounded-md bg-muted p-0.5" aria-label="Chart time range">
                <button
                  v-for="range in chartRanges"
                  :key="range"
                  type="button"
                  :disabled="!chartRangeAvailable(range)"
                  class="rounded px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  :class="chartRange === range ? 'bg-elevated text-default shadow-sm' : 'text-muted hover:text-default'"
                  @click="chartRange = range"
                >
                  {{ range }}
                </button>
              </div>
              <UBadge :color="isInDebt ? 'error' : 'primary'" variant="subtle" :label="`${(rate * 100).toFixed(2)}% / 24h`" />
            </div>
          </div>
        </template>
        <div v-if="isEmpty || !chartData.length" class="h-56 mx-6 flex flex-col items-center justify-center text-center rounded-lg bg-muted/40 border border-dashed border-default">
          <div class="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <UIcon name="i-lucide-chart-no-axes-combined" class="size-5" />
          </div>
          <p class="mt-3 text-sm font-medium">Your growth chart starts with a deposit</p>
          <p class="mt-1 max-w-sm text-xs text-muted">Savings begin at 2% daily and rise smoothly to 4% as your bank balance approaches 1B.</p>
        </div>
        <ChartsChartLine v-else-if="chartData.length" :data="chartData" :x="xFn" :y="yFn" color="var(--ui-primary)" negative-color="var(--ui-error)" :width="chartWidth" :tick-format="xTickFmt" :tooltip-template="tooltipFmt" :padding="{ top: 36 }" height="h-56" />
      </UCard>

      <UCard :ui="{ body: 'space-y-5' }">
        <template #header>
          <div>
            <h2 class="font-semibold">Move money</h2>
            <p class="text-xs text-muted mt-0.5">Withdrawals can pass zero into your loan allowance.</p>
          </div>
        </template>
        <UFormField name="amount" label="Amount">
          <UInputNumber v-model="amount" :min="0" :step="100" class="w-full" placeholder="0" />
        </UFormField>
        <div class="-mt-3 flex items-center justify-between text-xs text-muted">
          <span>Available in wallet</span>
          <CoinBalance :value="walletBalance" />
        </div>
        <div class="space-y-2">
          <p class="text-xs font-medium text-muted">Deposit from wallet</p>
          <div class="flex flex-wrap gap-2">
            <UButton size="xs" color="neutral" variant="soft" label="Wallet 25%" @click="setAmount(walletBalance * 0.25)" />
            <UButton size="xs" color="neutral" variant="soft" label="Wallet 50%" @click="setAmount(walletBalance * 0.5)" />
            <UButton size="xs" color="neutral" variant="soft" label="All wallet" @click="setAmount(walletBalance)" />
          </div>
        </div>
        <div class="space-y-2">
          <p class="text-xs font-medium text-muted">Withdraw existing savings</p>
          <div class="flex flex-wrap gap-2">
            <UButton size="xs" color="neutral" variant="soft" :disabled="!availableBankBalance" label="Bank 25%" @click="setAmount(availableBankBalance * 0.25)" />
            <UButton size="xs" color="neutral" variant="soft" :disabled="!availableBankBalance" label="Bank 50%" @click="setAmount(availableBankBalance * 0.5)" />
            <UButton size="xs" color="neutral" variant="soft" :disabled="!availableBankBalance" label="All bank" @click="setAmount(availableBankBalance)" />
            <UButton size="xs" color="error" variant="soft" :disabled="!maxWithdrawal" label="Max incl. loan" @click="setAmount(maxWithdrawal)" />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UButton block icon="i-lucide-arrow-down-to-line" :loading="loading === 'deposit'" :disabled="!canDeposit || !!loading" label="Deposit" @click="submit('deposit')" />
          <UButton block color="neutral" variant="outline" icon="i-lucide-arrow-up-from-line" :loading="loading === 'withdraw'" :disabled="!canWithdraw || !!loading" label="Withdraw" @click="submit('withdraw')" />
        </div>
        <UButton
          v-if="isInDebt"
          block
          color="primary"
          variant="soft"
          icon="i-lucide-coins"
          :loading="loading === 'deposit'"
          :disabled="!canRepayDebt || !!loading"
          label="Repay debt"
          @click="submit('deposit', undefined, true)"
        />
        <div class="rounded-lg bg-muted/50 p-3 text-xs text-muted">
          <div class="flex justify-between gap-3">
            <span>Maximum withdrawal</span>
            <CoinBalance :value="maxWithdrawal" :compact="false" class="font-medium text-default tabular-nums" />
          </div>
          <p class="mt-2">Any amount beyond your savings becomes a loan at 7% daily. Debt cannot exceed 10× the amount borrowed.</p>
        </div>
      </UCard>
    </div>

    <div class="grid sm:grid-cols-2 gap-4">
      <div class="rounded-lg border border-default px-4 py-3">
        <p class="text-xs text-muted">Total deposited</p>
        <CoinBalance :value="data?.totalDeposited" :compact="false" class="mt-1 font-semibold tabular-nums" />
      </div>
      <div class="rounded-lg border border-default px-4 py-3">
        <p class="text-xs text-muted">Maximum loan</p>
        <CoinBalance :value="data?.loanLimit" :compact="false" class="mt-1 font-semibold tabular-nums" />
      </div>
    </div>

    <UCard :ui="{ body: '!p-0' }">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold">Bank activity</h2>
            <p class="text-xs text-muted mt-0.5">Deposits and withdrawals only.</p>
          </div>
          <UBadge color="neutral" variant="subtle" :label="`${history.length} shown`" />
        </div>
      </template>
      <div v-if="historyLoading && !history.length" class="space-y-3 p-4">
        <USkeleton v-for="i in 4" :key="i" class="h-10 rounded-lg" />
      </div>
      <div v-else-if="!history.length" class="py-10 flex flex-col items-center text-center">
        <UIcon name="i-lucide-receipt" class="size-8 text-muted" />
        <p class="mt-2 text-sm font-medium">No bank activity yet</p>
        <p class="mt-1 text-xs text-muted">Your deposits and withdrawals will appear here.</p>
      </div>
      <div v-else class="divide-y divide-default">
        <div v-for="entry in history" :key="entry.id" class="flex items-center gap-3 px-4 py-3">
          <div class="size-8 rounded-full flex items-center justify-center shrink-0" :class="entry.action === 'deposit' ? 'bg-primary/10 text-primary' : 'bg-error/10 text-error'">
            <UIcon :name="entry.action === 'deposit' ? 'i-lucide-arrow-down-to-line' : 'i-lucide-arrow-up-from-line'" class="size-4" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium capitalize">{{ entry.action }}</p>
            <p class="text-xs text-muted">{{ formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true }) }}</p>
          </div>
          <div class="text-right">
            <div class="flex justify-end items-center text-sm font-semibold tabular-nums" :class="entry.action === 'deposit' ? 'text-primary' : 'text-error'">
              <span>{{ entry.action === 'deposit' ? '+' : '−' }}</span><CoinBalance :value="entry.amount" :compact="false" class="inline-flex" />
            </div>
            <div class="flex justify-end gap-1 text-xs tabular-nums" :class="parseFloat(entry.balance) < 0 ? 'text-error' : 'text-muted'"><span>Bank:</span><CoinBalance :value="entry.balance" :compact="false" /></div>
          </div>
        </div>
      </div>
      <div v-if="historyHasMore" class="border-t border-default p-3 flex justify-center">
        <UButton color="neutral" variant="ghost" size="sm" :loading="historyLoading" label="Load more" @click="loadHistory()" />
      </div>
    </UCard>
  </UContainer>
</template>

<style scoped>
.unovis-xy-container {
  --vis-crosshair-line-stroke-color: v-bind(lineColor);
  --vis-axis-grid-color: var(--ui-border);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-tick-label-color: var(--ui-text-dimmed);
  --vis-tooltip-background-color: var(--ui-bg);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text-highlighted);
}
</style>
