<script setup lang="ts">
import { voidHex } from '#shared/utils/gamelogic/void'

definePageMeta({ title: 'Void Market' })

const toast = useToast()
const { fetchSession } = useAuth()
const { data: state, refresh } = await useFetch('/api/void/state')

const activeRun = computed(() => Boolean(state.value?.activeRun))
const balance = computed(() => parseFloat(state.value?.balance ?? '0'))
const priceBonus = computed(() => Math.round(((state.value?.marketPriceMult ?? 1) - 1) * 100))

interface MarketRow {
  id: string
  name: string
  kind: 'ore' | 'salvage'
  icon: string
  color: number
  description: string
  held: number
  price: number
  basePrice: number
}

const rows = computed<MarketRow[]>(() => (state.value?.resourceCatalog ?? []) as MarketRow[])
const stocked = computed(() => rows.value.filter(r => r.held > 0))
const portfolioValue = computed(() => stocked.value.reduce((sum, r) => sum + r.held * r.price, 0))

// ── Search / kind filter ────────────────────────────────────────────────────
const search = ref('')
const kindFilter = ref<'all' | 'ore' | 'salvage'>('all')

const filteredRows = computed(() => {
  const q = search.value.toLowerCase()
  return [...rows.value]
    .filter((r) => {
      if (kindFilter.value !== 'all' && r.kind !== kindFilter.value) return false
      if (q && !r.name.toLowerCase().includes(q)) return false
      return true
    })
    // Most valuable stock first; empty stacks sink to the bottom.
    .sort((a, b) => (b.held * b.price) - (a.held * a.price) || b.price - a.price)
})

// ── Keep setting (cookie-persisted, mirrors the Colony and Xeno markets) ────
const keepAmount = useCookie<number>('void_market_keep', { default: () => 0 })
const keepInput = computed({
  get: () => keepAmount.value,
  set: (v) => { keepAmount.value = Math.max(0, Math.floor(Number(v) || 0)) }
})

function keepSellQty(row: MarketRow) {
  return Math.max(0, row.held - keepAmount.value)
}

const keepSellableRows = computed(() => filteredRows.value.filter(r => keepSellQty(r) > 0))
const keepSellTotalValue = computed(() => keepSellableRows.value.reduce((sum, r) => sum + r.price * keepSellQty(r), 0))

// ── Selling ─────────────────────────────────────────────────────────────────
const sellingId = ref<Record<string, boolean>>({})

async function doSell(resource: string, quantity: number, label: string) {
  if (activeRun.value || quantity <= 0) return
  const key = `${resource}-${quantity}`
  sellingId.value[key] = true
  try {
    const response = await $fetch('/api/void/market/sell', { method: 'POST', body: { resource, amount: quantity } })
    confirmSell.value = null
    await Promise.all([refresh(), fetchSession()])
    toast.add({
      title: `Sold ${formatNumber(response.amount, false)} ${label}`,
      description: `+${formatNumber(response.payout, false)}`,
      color: 'success',
      icon: 'i-lucide-hand-coins'
    })
  } catch (error: unknown) {
    toast.add({ title: apiErrorMessage(error, 'The dock refused the sale'), color: 'error' })
  } finally {
    sellingId.value[key] = false
  }
}

/** Emptying a stack entirely asks first — resources are also upgrade currency. */
const confirmSell = ref<{ row: MarketRow, qty: number } | null>(null)
function requestSell(row: MarketRow, qty: number) {
  if (qty >= row.held) confirmSell.value = { row, qty: row.held }
  else void doSell(row.id, qty, row.name)
}

const sellingKeep = ref<Record<string, boolean>>({})
async function doSellKeep(row: MarketRow) {
  const qty = keepSellQty(row)
  if (qty <= 0) return
  sellingKeep.value[row.id] = true
  try {
    await doSell(row.id, qty, row.name)
  } finally {
    sellingKeep.value[row.id] = false
  }
}

const confirmKeepSellAll = ref(false)
const sellingKeepAll = ref(false)
async function doSellKeepAll() {
  confirmKeepSellAll.value = false
  sellingKeepAll.value = true
  try {
    // Sequential: each sale re-reads the locked row server-side, and the list
    // is re-fetched between them.
    for (const row of [...keepSellableRows.value]) {
      await doSell(row.id, keepSellQty(row), row.name)
    }
  } finally {
    sellingKeepAll.value = false
  }
}
</script>

<template>
  <UContainer class="space-y-4 py-1">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">
          Dock market
        </h1>
        <p class="mt-0.5 text-sm text-muted">
          Nothing out there drops money. Everything you earn came back in a cargo hold and gets sold right here.
        </p>
      </div>
      <div v-if="state" class="flex flex-wrap items-center gap-2">
        <UBadge color="warning" variant="subtle" icon="i-lucide-circle-dollar-sign">
          <CoinBalance :value="balance" />
        </UBadge>
        <UBadge v-if="priceBonus > 0" color="success" variant="subtle" icon="i-lucide-trending-up" :label="`+${priceBonus}% rates`" />
      </div>
    </div>

    <div v-if="!state">
      <USkeleton class="h-80 rounded-xl" />
    </div>

    <template v-else>
      <UAlert
        v-if="activeRun"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Run in progress"
        description="The dock won't trade with a ship that hasn't come home."
      />

      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-muted">
          Sell material for coins — or hoard it, because upgrades and hulls get resource-hungry fast.
        </p>
        <div class="shrink-0 text-right">
          <p class="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Stores value
          </p>
          <CoinBalance :value="portfolioValue" :compact="false" class="text-base font-black" />
        </div>
      </div>

      <!-- Filters -->
      <div class="flex gap-2">
        <UInput
          v-model="search"
          placeholder="Search material…"
          icon="i-lucide-search"
          size="sm"
          class="flex-1"
        />
        <USelect
          v-model="kindFilter"
          :items="[
            { label: 'All types', value: 'all' },
            { label: 'Ore', value: 'ore' },
            { label: 'Salvage', value: 'salvage' }
          ]"
          value-key="value"
          size="sm"
          class="w-32"
        />
      </div>

      <!-- Sell settings bar -->
      <div class="flex items-center gap-3 rounded-xl border border-default bg-elevated/50 px-4 py-2.5">
        <UIcon name="i-lucide-settings-2" class="size-3.5 shrink-0 text-muted" />
        <span class="shrink-0 text-xs font-medium text-muted">Keep per stack</span>
        <UInput
          v-model="keepInput"
          type="number"
          min="0"
          size="xs"
          class="w-20"
        />
        <div class="flex-1" />
        <CoinBalance
          v-if="keepSellTotalValue > 0"
          :value="keepSellTotalValue"
          :compact="false"
          class="shrink-0 text-xs text-muted"
        />
        <UButton
          size="xs"
          color="error"
          variant="soft"
          icon="i-lucide-trending-down"
          :label="`Sell All — keep ${keepAmount}`"
          :disabled="activeRun || keepSellableRows.length === 0 || sellingKeepAll"
          :loading="sellingKeepAll"
          @click="confirmKeepSellAll = true"
        />
      </div>

      <div class="space-y-2">
        <div v-if="!filteredRows.length" class="py-12 text-center text-sm text-muted">
          No material matches your filter.
        </div>

        <div
          v-for="row in filteredRows"
          :key="row.id"
          class="flex items-center gap-4 rounded-xl border px-4 py-3 transition-colors hover:border-primary/60"
          :class="row.held <= 0 ? 'border-default opacity-50' : ''"
          :style="row.held > 0
            ? { borderColor: `${voidHex(row.color)}44`, backgroundColor: `${voidHex(row.color)}0d` }
            : undefined"
        >
          <!-- Icon + qty -->
          <div class="flex shrink-0 items-center gap-2">
            <span
              class="flex size-11 shrink-0 items-center justify-center rounded-xl border"
              :style="{ borderColor: `${voidHex(row.color)}55`, backgroundColor: `${voidHex(row.color)}1a` }"
            >
              <UIcon :name="row.icon" class="size-5" :style="{ color: voidHex(row.color) }" />
            </span>
            <span class="text-sm font-black leading-none tabular-nums text-primary">×{{ formatNumber(row.held, false) }}</span>
          </div>

          <!-- Material info -->
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-1.5 text-sm font-bold">
              <span :style="{ color: voidHex(row.color) }">{{ row.name }}</span>
              <UBadge
                size="sm"
                variant="subtle"
                :color="row.kind === 'ore' ? 'info' : 'warning'"
                :label="row.kind === 'ore' ? 'Ore' : 'Salvage'"
              />
            </p>
            <p class="mt-0.5 hidden truncate text-xs text-muted sm:block">
              {{ row.description }}
            </p>
          </div>

          <!-- Total + price per unit -->
          <div class="hidden shrink-0 flex-col items-end gap-0.5 text-right sm:flex">
            <CoinBalance :value="row.held * row.price" :compact="false" class="text-sm font-bold" />
            <span class="flex items-center gap-1 text-xs tabular-nums text-muted">
              <CoinBalance :value="row.price" :compact="false" /> ea
            </span>
          </div>

          <!-- Sell buttons -->
          <div class="flex shrink-0 gap-1">
            <UButton
              v-for="qty in [1, 10, 100]"
              :key="qty"
              size="xs"
              variant="soft"
              color="error"
              :disabled="activeRun || row.held === 0"
              :loading="sellingId[`${row.id}-${Math.min(qty, row.held)}`]"
              @click="requestSell(row, Math.min(qty, row.held))"
            >
              <span class="font-semibold tabular-nums">×{{ qty }}</span>
            </UButton>
            <UButton
              size="xs"
              variant="soft"
              color="error"
              :disabled="activeRun || keepSellQty(row) === 0"
              :loading="sellingKeep[row.id]"
              :label="`−${keepAmount}`"
              @click="doSellKeep(row)"
            />
          </div>
        </div>
      </div>

      <p class="px-1 text-xs text-muted">
        Rates are flat — deep-sector material is worth many times what the shallow end pays, so the fastest money is
        always the sector that can kill you. Refinery levels and <strong>Profiteering</strong> module rolls raise every
        price on this page.
      </p>
    </template>

    <!-- Confirm sell-all stack modal -->
    <UModal
      :open="!!confirmSell"
      title="Sell all of this stack?"
      @update:open="(v: boolean) => { if (!v) confirmSell = null }"
    >
      <template #body>
        <div v-if="confirmSell" class="space-y-4">
          <p class="text-sm text-muted">
            You're about to sell all <span class="font-bold text-default">{{ formatNumber(confirmSell.qty, false) }}× {{ confirmSell.row.name }}</span>.
            This will leave you with <span class="font-bold text-error">0</span>, and it's also what upgrades and hulls are bought with.
          </p>
          <div class="flex items-center gap-1.5 text-sm font-semibold">
            <span>Total:</span>
            <CoinBalance :value="confirmSell.qty * confirmSell.row.price" :compact="false" />
          </div>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" color="neutral" label="Cancel" @click="confirmSell = null" />
            <UButton
              color="error"
              label="Sell All"
              :loading="sellingId[`${confirmSell.row.id}-${confirmSell.qty}`]"
              @click="doSell(confirmSell.row.id, confirmSell.qty, confirmSell.row.name)"
            />
          </div>
        </div>
      </template>
    </UModal>

    <!-- Confirm sell-all keep N modal -->
    <UModal
      :open="confirmKeepSellAll"
      :title="`Sell all — keep ${keepAmount} per stack?`"
      @update:open="(v: boolean) => { if (!v) confirmKeepSellAll = false }"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Selling surplus from <span class="font-bold text-default">{{ keepSellableRows.length }} stack{{ keepSellableRows.length === 1 ? '' : 's' }}</span>,
            keeping up to <span class="font-bold text-default">{{ keepAmount }}</span> of each.
          </p>
          <div class="flex items-center gap-1.5 text-sm font-semibold">
            <span>You'll receive:</span>
            <CoinBalance :value="keepSellTotalValue" :compact="false" />
          </div>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" color="neutral" label="Cancel" @click="confirmKeepSellAll = false" />
            <UButton
              color="error"
              icon="i-lucide-trending-down"
              :label="`Sell — keep ${keepAmount}`"
              @click="doSellKeepAll"
            />
          </div>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
