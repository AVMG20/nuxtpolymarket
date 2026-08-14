<script setup lang="ts">
import {
  LOOTBOX_REWARDS,
  lootboxRewardValue,
  type LootboxRarity,
  type LootboxReward
} from '#shared/utils/miner-config'

// Game-style rarity colors — raw Tailwind palette (literal so Tailwind generates them)
const RARITY_CLASSES: Record<LootboxRarity, { border: string, borderSoft: string, bg: string, text: string }> = {
  common: { border: 'border-slate-500/60', borderSoft: 'border-slate-500/40', bg: 'bg-slate-500/10', text: 'text-slate-300' },
  uncommon: { border: 'border-emerald-500/60', borderSoft: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  rare: { border: 'border-sky-500/60', borderSoft: 'border-sky-500/40', bg: 'bg-sky-500/10', text: 'text-sky-400' },
  epic: { border: 'border-violet-500/60', borderSoft: 'border-violet-500/40', bg: 'bg-violet-500/10', text: 'text-violet-400' },
  legendary: { border: 'border-amber-500/60', borderSoft: 'border-amber-500/40', bg: 'bg-amber-500/10', text: 'text-amber-400' }
}

// Same five rarities, as pixi colors for the crate burst.
const RARITY_HEX: Record<LootboxRarity, number> = {
  common: 0x94a3b8,
  uncommon: 0x34d399,
  rare: 0x38bdf8,
  epic: 0xa78bfa,
  legendary: 0xfbbf24
}

const { fetchSession, user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const { state, refresh } = await useMiner()
const toast = useToast()

const scene = ref<{
  startReveal: (seconds: number) => void
  finishReveal: (color: number) => void
  cancelReveal: () => void
  playSlotAdded: () => void
  playReject: (w: 'cart' | 'crane') => void
} | null>(null)

const cap = computed(() => state.value?.cap ?? 0)
// Rig Overclock boosts all lootbox cash payouts.
const incomeMult = computed(() => state.value?.incomeMultiplier ?? 1)
const cashValueOf = (r: LootboxReward) => lootboxRewardValue(r, cap.value) * incomeMult.value

const freeRemaining = ref(0)
watch(
  () => state.value?.lootboxFreeOpensRemaining,
  (v) => { if (v !== undefined) freeRemaining.value = v },
  { immediate: true }
)

// How long the crate rattles before it pops. Persisted, same cookie as before.
const REVEAL_BASE_SECONDS = 3
const fastSpin = useCookie<boolean>('lootbox-fast-spin', { default: () => false })
const revealSeconds = computed(() => fastSpin.value ? REVEAL_BASE_SECONDS * 0.35 : REVEAL_BASE_SECONDS)

const opening = ref(false)
const buyingSlot = ref(false)
const result = ref<{ reward: LootboxReward, cashValue: number, paid: boolean } | null>(null)

const canPayOpen = computed(() => !!state.value && balance.value >= state.value.lootboxOpenPrice)
const slotsMaxed = computed(() => !!state.value && state.value.lootboxSlots >= state.value.lootboxMaxSlots)
const canAffordSlot = computed(() => !!state.value && balance.value >= state.value.lootboxNextSlotCost)

/** Clicking the cart opens a free crate when there is one, otherwise a paid one. */
function openFromCart() {
  if (opening.value) return
  if (freeRemaining.value > 0) return open('free')
  if (canPayOpen.value) return open('paid')
  scene.value?.playReject('cart')
  toast.add({ title: 'No free opens left, and not enough cash for a paid one', color: 'error' })
}

async function open(mode: 'free' | 'paid') {
  if (opening.value) return
  opening.value = true
  result.value = null
  const startedAt = Date.now()
  scene.value?.startReveal(revealSeconds.value)
  try {
    const res = await $fetch('/api/miner/lootbox/open', { method: 'POST', body: { mode } })
    const won = LOOTBOX_REWARDS.find(r => r.id === res.wonId)!
    freeRemaining.value = res.freeOpensRemaining

    // Let the crate finish its rattle even if the server answered instantly.
    const remaining = Math.max(0, revealSeconds.value * 1000 - (Date.now() - startedAt))
    setTimeout(async () => {
      result.value = { reward: won, cashValue: res.cashValue, paid: res.paid }
      scene.value?.finishReveal(RARITY_HEX[won.rarity])
      opening.value = false
      await Promise.all([fetchSession(), refresh()])
    }, remaining)
  } catch (e: any) {
    opening.value = false
    scene.value?.cancelReveal()
    toast.add({ title: apiErrorMessage(e, 'Open failed'), color: 'error' })
  }
}

async function buySlot() {
  if (slotsMaxed.value || !canAffordSlot.value || buyingSlot.value || opening.value) {
    scene.value?.playReject('crane')
    return
  }
  buyingSlot.value = true
  try {
    const res = await $fetch('/api/miner/lootbox/buy-slot', { method: 'POST' })
    scene.value?.playSlotAdded()
    toast.add({ title: `Lootbox slot #${res.newSlots} unlocked!`, color: 'success', icon: 'i-lucide-package-plus' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: apiErrorMessage(e, 'Purchase failed'), color: 'error' })
  } finally {
    buyingSlot.value = false
  }
}

// Prize pool — sorted low → high value
const totalWeight = LOOTBOX_REWARDS.reduce((s, r) => s + r.weight, 0)
const withChance = (r: LootboxReward) => ({ ...r, chance: (r.weight / totalWeight) * 100 })
const cashPrizes = computed(() => LOOTBOX_REWARDS.slice().sort((a, b) => a.amount - b.amount).map(withChance))
const bestPrize = computed(() => cashPrizes.value[cashPrizes.value.length - 1])
</script>

<template>
  <UContainer class="space-y-4">
    <div v-if="!state" class="space-y-4">
      <USkeleton class="h-16 rounded-xl" />
      <USkeleton class="h-[60vh] min-h-[420px] rounded-2xl" />
    </div>

    <template v-else>
      <!-- Clarification cards, above the scene. -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MinerStatTile
          icon="i-lucide-package"
          label="Slots owned"
          :value="`${state.lootboxSlots}/${state.lootboxMaxSlots}`"
          :sub="slotsMaxed ? 'all unlocked' : `next $${formatNumber(state.lootboxNextSlotCost, true)}`"
          tone="gold"
        />
        <MinerStatTile
          icon="i-lucide-sparkles"
          label="Free opens"
          :value="`${freeRemaining}/${state.lootboxSlots}`"
          sub="resets daily"
          tone="gold"
        />
        <MinerStatTile
          icon="i-lucide-shopping-cart"
          label="Paid open"
          :value="`$${formatNumber(state.lootboxOpenPrice, true)}`"
          :sub="`avg win $${formatNumber(state.lootboxAvgValue, true)}`"
          tone="steel"
        />
        <MinerStatTile
          icon="i-lucide-trophy"
          label="Top prize"
          :value="bestPrize ? `$${formatNumber(cashValueOf(bestPrize), true)}` : '—'"
          :sub="bestPrize ? `${bestPrize.chance.toFixed(1)}% chance` : undefined"
          tone="gold"
        />
      </div>

      <MinerLootCartScene
        ref="scene"
        :slots="state.lootboxSlots"
        :max-slots="state.lootboxMaxSlots"
        :free-remaining="freeRemaining"
        :busy="buyingSlot"
        @open="openFromCart"
        @buy-slot="buySlot"
      >
        <template #cart>
          <MinerActionChip
            :label="freeRemaining > 0
              ? `Open free crate (${freeRemaining})`
              : `Buy open · $${formatNumber(state.lootboxOpenPrice, true)}`"
            :sub="freeRemaining > 0
              ? `${state.lootboxSlots} slot${state.lootboxSlots !== 1 ? 's' : ''} · one free open each`
              : `avg $${formatNumber(state.lootboxAvgValue, true)} per crate`"
            icon="i-lucide-package-open"
            tone="gold"
            :ready="freeRemaining > 0 || canPayOpen"
            :loading="opening"
            :disabled="opening || (freeRemaining <= 0 && !canPayOpen)"
            @click="openFromCart"
          />
        </template>

        <template #crane>
          <MinerActionChip
            :label="slotsMaxed ? 'All slots owned' : `Buy slot · $${formatNumber(state.lootboxNextSlotCost, true)}`"
            :sub="`${state.lootboxSlots}/${state.lootboxMaxSlots} slots · +1 free open/day`"
            icon="i-lucide-package-plus"
            tone="steel"
            :loading="buyingSlot"
            :disabled="slotsMaxed || !canAffordSlot"
            @click="buySlot"
          />
        </template>

        <!-- Prize card rides the burst. -->
        <template #prize="{ phase }">
          <Transition name="prize">
            <div
              v-if="phase === 'burst' && result"
              class="flex flex-col items-center gap-1 rounded-2xl border-2 px-5 py-3 backdrop-blur-md shadow-2xl shadow-black/60"
              :class="[RARITY_CLASSES[result.reward.rarity].border, RARITY_CLASSES[result.reward.rarity].bg]"
            >
              <span class="text-[10px] uppercase tracking-[0.2em]" :class="RARITY_CLASSES[result.reward.rarity].text">
                {{ result.reward.rarity }}
              </span>
              <span class="text-3xl font-black tabular-nums text-white drop-shadow">
                +${{ formatNumber(result.cashValue, true) }}
              </span>
              <span class="text-[11px] text-white/60">
                {{ Math.round(result.reward.amount * 100) }}% of vault cap · {{ result.paid ? 'paid open' : 'free open' }}
              </span>
            </div>
          </Transition>
        </template>

        <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
          <div>
            <h1 class="text-lg font-bold text-white/95 drop-shadow">Loot Cart</h1>
            <p class="text-xs text-white/55">Each crate in the cart is a slot. Glowing crates are today's free opens.</p>
          </div>
          <div class="flex items-center gap-2">
            <USwitch v-model="fastSpin" size="sm" :disabled="opening" class="pointer-events-auto" />
            <span class="text-[11px] text-white/60">Fast open</span>
          </div>
        </div>
      </MinerLootCartScene>

      <!-- Prize pool -->
      <div class="rounded-2xl border border-default bg-elevated/40 p-3">
        <div class="flex items-center gap-2 px-1 pb-2 text-xs text-muted">
          <UIcon name="i-lucide-list" class="size-3.5 text-amber-400" />
          <span class="font-medium">Prize pool — every payout scales with your vault cap</span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <div
            v-for="r in cashPrizes"
            :key="r.id"
            class="rounded-lg border p-2.5 flex items-center justify-between"
            :class="RARITY_CLASSES[r.rarity].borderSoft"
          >
            <div class="flex items-center gap-2 min-w-0">
              <UIcon name="i-lucide-coins" class="size-4 shrink-0" :class="RARITY_CLASSES[r.rarity].text" />
              <span class="text-sm font-semibold truncate">${{ formatNumber(cashValueOf(r), true) }}</span>
            </div>
            <span class="text-xs text-muted shrink-0">{{ r.chance < 1 ? r.chance.toFixed(1) : Math.round(r.chance) }}%</span>
          </div>
        </div>
      </div>
    </template>
  </UContainer>
</template>

<style scoped>
.prize-enter-active {
  animation: prize-in 0.45s cubic-bezier(0.2, 1.6, 0.4, 1);
}

.prize-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.prize-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

@keyframes prize-in {
  0% { opacity: 0; transform: scale(0.6) translateY(12px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}
</style>
