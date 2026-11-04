<script setup lang="ts">
// Rail Tycoon — the finances window: this year and last year by the categories monthlyFinance
// books, totals, the last 12 months' income and expenses (RtCompany.monthlyIncome), sharing
// income and costs as their own rows, crossing fines and compensation, and the loan with Borrow and Repay one step at a time.
// Each button is off whenever changeLoan would refuse it, so a click never asks for a refusal.
import { RtCommandKind } from '#shared/utils/rail-tycoon/commands'
import type { RtFinance, RtMonthTotals } from '#shared/utils/rail-tycoon/types'
import RtWindow from './RtWindow.vue'
import {
  RT_LOAN_STEP,
  RT_MAX_LOAN,
  rtCompanyCss,
  rtFormatMoney,
  rtLoanActions,
  rtMonthName,
  useRtGame
} from '~/utils/rail-tycoon/windows'

withDefaults(defineProps<{
  windowKey?: string
}>(), {
  windowKey: 'finances'
})

const game = useRtGame()

const ROWS: readonly { key: keyof RtFinance, label: string }[] = [
  { key: 'construction', label: 'Construction' },
  { key: 'newVehicles', label: 'New vehicles' },
  { key: 'runningCosts', label: 'Running costs' },
  { key: 'property', label: 'Property maintenance' },
  { key: 'trainIncome', label: 'Train income' },
  { key: 'roadIncome', label: 'Road vehicle income' },
  { key: 'sharingIncome', label: 'Sharing income' },
  { key: 'sharingCosts', label: 'Sharing costs' },
  { key: 'loanInterest', label: 'Loan interest' },
  { key: 'fines', label: 'Fines and compensation' },
  { key: 'other', label: 'Other' }
]

function total(finance: RtFinance): number {
  let sum = 0
  for (const row of ROWS) sum += finance[row.key]
  return sum
}

const view = computed(() => {
  void game.tick.value
  void game.status.value
  const ls = game.lockstep.value
  const company = game.company()
  if (!ls || !company) return null
  const year = ls.world.date.year
  return {
    name: company.name,
    accent: rtCompanyCss(company.colour),
    year,
    rows: ROWS.map(row => ({ ...row, last: company.financeLastYear[row.key], current: company.financeThisYear[row.key] })),
    totalLast: total(company.financeLastYear),
    totalCurrent: total(company.financeThisYear),
    money: company.money,
    loan: company.loan,
    months: company.monthlyIncome.map(month => ({ income: month.income, expenses: month.expenses })),
    /** The month the newest entry of months is (the one before the current month). */
    lastMonth: ls.world.date.month - 1,
    loanActions: rtLoanActions(company),
    canCommand: game.canCommand()
  }
})

function changeLoan(steps: 1 | -1) {
  game.sendCommandOrWarn({ kind: RtCommandKind.changeLoan, steps })
}

// ─── Income graph ────────────────────────────────────────────────────────

const GRAPH_W = 260
const GRAPH_H = 72
const canvas = ref<HTMLCanvasElement | null>(null)

const graphKey = computed(() => {
  const months = view.value?.months ?? []
  return `${view.value?.lastMonth ?? 0}|${months.map(m => `${m.income},${m.expenses}`).join(';')}`
})

function drawGraph() {
  const el = canvas.value
  const months: RtMonthTotals[] = view.value?.months ?? []
  if (!el) return
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  el.width = Math.round(GRAPH_W * dpr)
  el.height = Math.round(GRAPH_H * dpr)
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, GRAPH_W, GRAPH_H)
  ctx.fillStyle = '#201d17'
  ctx.fillRect(0, 0, GRAPH_W, GRAPH_H)
  if (months.length < 2) return
  const top = 6
  const bottom = GRAPH_H - 6
  let max = 1
  for (const month of months) max = Math.max(max, month.income, -month.expenses)
  const x = (i: number) => 6 + (i * (GRAPH_W - 12)) / 11
  const y = (v: number) => bottom - (Math.max(0, v) / max) * (bottom - top)
  ctx.strokeStyle = '#3a352c'
  ctx.lineWidth = 1
  for (let i = 0; i < 12; i++) {
    ctx.beginPath()
    ctx.moveTo(Math.round(x(i)) + 0.5, top)
    ctx.lineTo(Math.round(x(i)) + 0.5, bottom)
    ctx.stroke()
  }
  // the newest month sits at the right edge; fewer than 12 months start part way in
  const offset = 12 - months.length
  const line = (value: (m: RtMonthTotals) => number, colour: string) => {
    ctx.strokeStyle = colour
    ctx.lineWidth = 2
    ctx.beginPath()
    months.forEach((month, i) => {
      const px = x(offset + i)
      const py = y(value(month))
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.stroke()
  }
  line(m => -m.expenses, '#e0604f')
  line(m => m.income, '#8fd46a')
}

const graphFirst = computed(() => {
  const v = view.value
  if (!v || v.months.length === 0) return ''
  return rtMonthName(v.lastMonth - v.months.length + 1)
})
const graphLast = computed(() => {
  const v = view.value
  return v && v.months.length > 0 ? rtMonthName(v.lastMonth) : ''
})

watch(graphKey, () => drawGraph(), { flush: 'post' })
onMounted(drawGraph)
</script>

<template>
  <RtWindow
    :title="view ? `${view.name}: finances` : 'Finances'"
    :window-key="windowKey"
    :accent="view?.accent ?? null"
  >
    <div v-if="view" class="rt-fin">
      <table class="rt-fin-table">
        <thead>
          <tr>
            <th />
            <th>{{ view.year - 1 }}</th>
            <th>{{ view.year }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in view.rows" :key="row.key">
            <td>{{ row.label }}</td>
            <td :class="{ 'rt-fin-neg': row.last < 0 }">{{ rtFormatMoney(row.last) }}</td>
            <td :class="{ 'rt-fin-neg': row.current < 0 }">{{ rtFormatMoney(row.current) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td :class="{ 'rt-fin-neg': view.totalLast < 0 }">{{ rtFormatMoney(view.totalLast) }}</td>
            <td :class="{ 'rt-fin-neg': view.totalCurrent < 0 }">{{ rtFormatMoney(view.totalCurrent) }}</td>
          </tr>
        </tfoot>
      </table>

      <div class="rt-fin-graph">
        <div class="rt-fin-graph-head">
          <span>Last 12 months</span>
          <span class="rt-fin-key rt-fin-key-income">Income</span>
          <span class="rt-fin-key rt-fin-key-expenses">Expenses</span>
        </div>
        <canvas ref="canvas" :style="{ width: `${GRAPH_W}px`, height: `${GRAPH_H}px` }" />
        <div v-if="view.months.length >= 2" class="rt-fin-graph-axis">
          <span>{{ graphFirst }}</span>
          <span>{{ graphLast }}</span>
        </div>
        <div v-else class="rt-fin-graph-empty">The graph fills in as months close.</div>
      </div>

      <dl class="rt-fin-bank">
        <dt>Bank balance</dt>
        <dd :class="{ 'rt-fin-neg': view.money < 0 }">{{ rtFormatMoney(view.money) }}</dd>
        <dt>Loan</dt>
        <dd>{{ rtFormatMoney(view.loan) }}</dd>
        <dt>Maximum loan</dt>
        <dd>{{ rtFormatMoney(RT_MAX_LOAN) }}</dd>
      </dl>

      <div class="rt-fin-actions">
        <button
          type="button"
          class="rt-fin-btn"
          :disabled="!view.canCommand || !view.loanActions.borrow"
          @click="changeLoan(1)"
        >
          Borrow {{ rtFormatMoney(RT_LOAN_STEP) }}
        </button>
        <button
          type="button"
          class="rt-fin-btn"
          :disabled="!view.canCommand || !view.loanActions.repay"
          @click="changeLoan(-1)"
        >
          Repay {{ rtFormatMoney(RT_LOAN_STEP) }}
        </button>
      </div>
    </div>
    <p v-else class="rt-fin-none">You have no company in this world.</p>
  </RtWindow>
</template>

<style scoped>
.rt-fin {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 280px;
}
.rt-fin-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.rt-fin-table th {
  padding: 0 4px 3px;
  font-weight: 700;
  text-align: right;
  color: #cfc8b6;
}
.rt-fin-table td {
  padding: 1px 4px;
  white-space: nowrap;
}
.rt-fin-table td:not(:first-child) {
  text-align: right;
}
.rt-fin-table tfoot td {
  padding-top: 4px;
  border-top: 1px solid #6b6455;
  font-weight: 700;
}
.rt-fin-neg {
  color: #ff7b6a;
}
.rt-fin-graph {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.rt-fin-graph-head {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #cfc8b6;
}
.rt-fin-graph-head > :first-child {
  flex: 1;
}
.rt-fin-key::before {
  content: '';
  display: inline-block;
  width: 10px;
  height: 2px;
  margin-right: 4px;
  vertical-align: middle;
  background: currentColor;
}
.rt-fin-key-income {
  color: #8fd46a;
}
.rt-fin-key-expenses {
  color: #e0604f;
}
.rt-fin-graph canvas {
  display: block;
  border: 1px solid #14120e;
}
.rt-fin-graph-axis,
.rt-fin-graph-empty {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #a8a08c;
}
.rt-fin-bank {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.rt-fin-bank dt {
  color: #cfc8b6;
}
.rt-fin-bank dd {
  margin: 0;
  font-weight: 700;
  text-align: right;
}
.rt-fin-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.rt-fin-btn {
  padding: 5px 6px;
  border: 1px solid #201d17;
  background: #4a4438;
  color: #ece6d6;
  font-weight: 700;
  box-shadow: inset 1px 1px 0 #6b6455;
  cursor: pointer;
}
.rt-fin-btn:hover:not(:disabled) {
  background: #575043;
}
.rt-fin-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.rt-fin-none {
  margin: 0;
  color: #cfc8b6;
}
</style>
