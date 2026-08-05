<script setup lang="ts">
import { PRESTIGE_TIERS, prestigeTier, prestigeTokenAllowance } from '#shared/utils/prestige'
import {
  PRESTIGE_SHOP_ITEMS,
  PRESTIGE_SHOP_SECTIONS,
  prestigeShopItemCostLadder,
  prestigeShopItemEscalates,
  prestigeShopItemTotalCost,
  type PrestigeShopItem
} from '#shared/utils/prestige-shop'

const { user, fetchSession } = useAuth()
const toast = useToast()

const { data: shop, refresh } = await useFetch('/api/prestige-shop')

const level = computed(() => user.value?.prestige ?? 0)
const tokens = computed(() => user.value?.prestigeTokens ?? 0)
const tier = computed(() => prestigeTier(level.value))
const allowance = computed(() => prestigeTokenAllowance(level.value))
const spent = computed(() => Math.max(0, allowance.value - tokens.value))

/** Server-sent per-item state (owned count, next price), keyed by item id. */
const stateById = computed(() => {
  const map = new Map<string, { owned: number, soldOut: boolean, nextCost: number | null, affordable: boolean }>()
  for (const entry of shop.value?.items ?? []) map.set(entry.id, entry)
  return map
})

const sections = computed(() =>
  PRESTIGE_SHOP_SECTIONS
    .map(section => ({
      ...section,
      items: PRESTIGE_SHOP_ITEMS.filter(item => item.game === section.id)
    }))
    .filter(section => section.items.length > 0)
)

const buying = ref<string | null>(null)

/** Price goes on the button itself so the cost is readable without hunting. */
function buyLabel(itemId: string) {
  const state = stateById.value.get(itemId)
  if (!state || state.soldOut) return 'Maxed'
  return `Buy · ${state.nextCost}`
}

/** Tokens still missing for the next unit, or 0 when it is affordable. */
function shortfall(itemId: string) {
  const state = stateById.value.get(itemId)
  if (!state || state.soldOut || state.nextCost === null) return 0
  return Math.max(0, state.nextCost - tokens.value)
}

/**
 * The item's whole price ladder, with each rung tagged as bought / next / later.
 * Most multi-buy items get more expensive with each purchase, and showing only
 * the next price made a "Buy · 1" button on a 1-3 item read as a flat price.
 */
function priceLadder(item: PrestigeShopItem) {
  const owned = stateById.value.get(item.id)?.owned ?? 0
  return prestigeShopItemCostLadder(item).map((cost, index) => ({
    cost,
    index,
    state: index < owned ? 'bought' as const : index === owned ? 'next' as const : 'later' as const
  }))
}

/** Only worth rendering the ladder when the price actually moves. */
function showLadder(item: PrestigeShopItem) {
  return item.maxOwned > 1 && prestigeShopItemEscalates(item)
}

/**
 * Price of the purchase AFTER the next one. Only for items that do NOT render
 * the ladder — when the ladder is up it already shows every remaining price,
 * so repeating one of them below it is just noise.
 */
function laterCost(item: PrestigeShopItem): number | null {
  if (showLadder(item)) return null
  const owned = stateById.value.get(item.id)?.owned ?? 0
  if (owned + 1 >= item.maxOwned) return null
  return item.cost(owned + 1)
}

async function buy(itemId: string, name: string) {
  buying.value = itemId
  try {
    const result = await $fetch('/api/prestige-shop/buy', {
      method: 'POST',
      body: { itemId }
    })
    await Promise.all([fetchSession(), refresh()])
    toast.add({
      title: name,
      description: `Bought for ${result.spent} token${result.spent === 1 ? '' : 's'}. ${result.tokensLeft} left.`,
      color: 'success',
      icon: 'i-lucide-crown'
    })
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Purchase failed'), color: 'error' })
  } finally {
    buying.value = null
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Prestige Shop</h1>
        <p class="text-sm text-muted mt-0.5">Spend what you earned by giving everything up</p>
      </div>
      <UButton to="/profile" color="neutral" variant="outline" icon="i-lucide-user" label="Profile" />
    </div>

    <!-- Token wallet -->
    <UCard class="relative overflow-hidden">
      <div
        v-if="tier"
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 opacity-[0.07]"
        :style="{ backgroundImage: tier.badge }"
      />
      <div class="relative flex flex-wrap items-center gap-5">
        <ProfileEmblem
          :emblem="user?.emblem"
          :name="user?.name"
          :prestige="level"
          class="size-16 text-2xl"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <PrestigeBadge :level="level" size="md" />
            <p class="truncate text-xl font-semibold">{{ user?.name }}</p>
          </div>
          <p class="mt-0.5 text-sm text-muted">
            {{ tier ? tier.name : 'Unranked' }} — {{ spent }} of {{ allowance }} token{{ allowance === 1 ? '' : 's' }} spent this run
          </p>
        </div>
        <div class="flex items-center gap-2.5 rounded-xl border border-default bg-elevated/60 px-5 py-3">
          <UIcon name="i-lucide-crown" class="size-6" :style="{ color: tier?.accent ?? 'var(--ui-text-muted)' }" />
          <div>
            <p class="text-2xl font-bold leading-none">{{ tokens }}</p>
            <p class="mt-1 text-xs text-muted">available</p>
          </div>
        </div>
      </div>
    </UCard>

    <UAlert
      v-if="level === 0"
      color="warning"
      variant="soft"
      icon="i-lucide-lock"
      title="The shop opens at Prestige I"
      description="Ascend once to earn your first tokens. Everything here is bought with tokens only — never coins, never gems."
    />

    <UAlert
      v-else
      color="neutral"
      variant="soft"
      icon="i-lucide-info"
      title="Perks last one run"
      description="Everything you buy here is wiped by your next ascent — and your full token allowance comes back with it. There is no reason to save tokens: spend them on the run you are playing."
    />

    <!-- Catalog -->
    <div v-for="section in sections" :key="section.id" class="space-y-3">
      <div class="flex items-center gap-2">
        <UIcon :name="section.icon" class="size-5 text-muted" />
        <h2 class="font-semibold">{{ section.label }}</h2>
        <UButton
          v-if="section.to"
          :to="section.to"
          color="neutral"
          variant="link"
          size="xs"
          trailing-icon="i-lucide-arrow-right"
          label="Open"
        />
      </div>

      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <UCard
          v-for="item in section.items"
          :key="item.id"
          :ui="{ body: 'space-y-3' }"
          :class="stateById.get(item.id)?.soldOut ? 'opacity-60' : ''"
        >
          <div class="flex items-start gap-3">
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-default bg-elevated"
              :style="stateById.get(item.id)?.owned ? { borderColor: `${tier?.accent}66` } : undefined"
            >
              <UIcon :name="item.icon" class="size-5" :style="{ color: tier?.accent ?? undefined }" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-semibold">{{ item.name }}</p>
                <UBadge
                  v-if="item.maxOwned > 1"
                  :label="`${stateById.get(item.id)?.owned ?? 0} / ${item.maxOwned}`"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                />
                <UBadge
                  v-else-if="stateById.get(item.id)?.owned"
                  label="Owned"
                  color="success"
                  variant="subtle"
                  size="sm"
                />
              </div>
              <p class="mt-1 text-sm text-muted">{{ item.summary }}</p>
            </div>
          </div>

          <ul class="space-y-1 text-xs text-muted">
            <li v-for="grant in item.grants" :key="grant" class="flex gap-2">
              <UIcon name="i-lucide-check" class="mt-0.5 size-3.5 shrink-0 text-success" />
              <span>{{ grant }}</span>
            </li>
          </ul>

          <!-- Price ladder — every purchase's price, so an escalating item
               never looks like a flat one. Struck through once bought. -->
          <div
            v-if="showLadder(item)"
            class="flex flex-wrap items-center gap-1.5 border-t border-default pt-3 text-xs"
          >
            <span class="text-muted">Prices</span>
            <template v-for="rung in priceLadder(item)" :key="rung.index">
              <UIcon
                v-if="rung.index > 0"
                name="i-lucide-chevron-right"
                class="size-3 text-muted/60"
              />
              <span
                class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono font-semibold"
                :class="{
                  'text-muted line-through': rung.state === 'bought',
                  'bg-elevated text-highlighted ring-1 ring-default': rung.state === 'next',
                  'text-muted': rung.state === 'later'
                }"
              >
                <UIcon name="i-lucide-crown" class="size-3" />
                {{ rung.cost }}
              </span>
            </template>
          </div>

          <div
            class="flex items-center justify-between gap-3 pt-3"
            :class="showLadder(item) ? '' : 'border-t border-default'"
          >
            <div class="min-w-0 text-xs">
              <span v-if="stateById.get(item.id)?.soldOut" class="text-muted">
                Fully bought for this run
              </span>
              <span v-else-if="shortfall(item.id) > 0" class="text-warning">
                {{ shortfall(item.id) }} more token{{ shortfall(item.id) === 1 ? '' : 's' }} needed
              </span>
              <span v-else-if="laterCost(item) !== null" class="text-muted">
                Then {{ laterCost(item) }} for the next · {{ prestigeShopItemTotalCost(item) }} for all {{ item.maxOwned }}
              </span>
              <span v-else-if="item.maxOwned > 1" class="text-muted">
                {{ prestigeShopItemTotalCost(item) }} tokens for all {{ item.maxOwned }}
              </span>
            </div>
            <UButton
              icon="i-lucide-crown"
              :label="buyLabel(item.id)"
              size="sm"
              :loading="buying === item.id"
              :disabled="level === 0 || !stateById.get(item.id)?.affordable"
              @click="buy(item.id, item.name)"
            />
          </div>
        </UCard>
      </div>
    </div>

    <!-- What each ascent pays -->
    <UCard>
      <template #header>
        <h2 class="font-semibold">Token allowance per tier</h2>
      </template>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div
          v-for="t in PRESTIGE_TIERS"
          :key="t.level"
          class="rounded-lg border border-default p-3"
          :class="t.level <= level ? '' : 'opacity-50'"
        >
          <div class="flex items-center gap-2">
            <span
              class="inline-flex size-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
              :style="{ backgroundImage: t.badge }"
            >
              {{ t.roman }}
            </span>
            <span class="text-sm font-medium">{{ t.name }}</span>
          </div>
          <p class="mt-2 text-sm">
            <span class="font-semibold" :style="{ color: t.accent }">{{ t.tokens }}</span>
            <span class="text-muted"> tokens</span>
          </p>
        </div>
      </div>
    </UCard>
  </UContainer>
</template>
