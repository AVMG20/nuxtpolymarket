<script setup lang="ts">
import {
  LOOTBOX_REWARDS,
  lootboxRewardValue,
  lootboxRoll,
  type LootboxRarity,
  type LootboxReward,
} from '#shared/utils/miner-config'

// Game-style rarity colors — raw Tailwind palette (literal so Tailwind generates them)
const RARITY_CLASSES: Record<LootboxRarity, { border: string, borderSoft: string, bg: string, text: string }> = {
  common: { border: 'border-slate-500/60', borderSoft: 'border-slate-500/40', bg: 'bg-slate-500/10', text: 'text-slate-300' },
  uncommon: { border: 'border-emerald-500/60', borderSoft: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  rare: { border: 'border-sky-500/60', borderSoft: 'border-sky-500/40', bg: 'bg-sky-500/10', text: 'text-sky-400' },
  epic: { border: 'border-violet-500/60', borderSoft: 'border-violet-500/40', bg: 'bg-violet-500/10', text: 'text-violet-400' },
  legendary: { border: 'border-amber-500/60', borderSoft: 'border-amber-500/40', bg: 'bg-amber-500/10', text: 'text-amber-400' },
}

const { fetchSession, user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const { data: state, refresh } = await useFetch('/api/miner/state')
const toast = useToast()

const cap = computed(() => state.value?.cap ?? 0)
// Rig Overclock boosts all lootbox cash payouts.
const incomeMult = computed(() => state.value?.incomeMultiplier ?? 1)
const cashValueOf = (r: LootboxReward) => lootboxRewardValue(r, cap.value) * incomeMult.value
const freeRemaining = ref(0)
watch(
  () => state.value?.lootboxFreeOpensRemaining,
  (v) => { if (v !== undefined) freeRemaining.value = v },
  { immediate: true },
)

// ─── Reel geometry ────────────────────────────────────────────────────────────
const CELL = 104 // px, must match cell width below
const GAP = 8 // px, must match `gap-2`
const STRIDE = CELL + GAP
const WIN_INDEX = 60
const REEL_LEN = 68

// Spin speed — persisted in a cookie. Fast spin runs at 20% of the base
// duration (80% faster).
const SPIN_BASE_SECONDS = 5
const fastSpin = useCookie<boolean>('lootbox-fast-spin', { default: () => false })
const spinSeconds = computed(() => fastSpin.value ? SPIN_BASE_SECONDS * 0.2 : SPIN_BASE_SECONDS)
const revealDelayMs = computed(() => spinSeconds.value * 1000 + 200)

const viewport = ref<HTMLElement | null>(null)
// Generated once on the server and reused on the client (via the payload) so the
// random reel hydrates identically — otherwise the server/client reels diverge and
// Vue mismatches cell colors against cell values.
const reel = useState<LootboxReward[]>('lootbox-reel', () => Array.from({ length: REEL_LEN }, () => lootboxRoll()))
const offset = ref(0)
const transitionOn = ref(false)
const spinning = ref(false)
const result = ref<{ reward: LootboxReward, cashValue: number, paid: boolean } | null>(null)

// The winning cell must show exactly what the server awarded.
const winValue = ref<{ cashValue: number } | null>(null)

function cellPrimary(r: LootboxReward) {
  return `+${Math.round(r.amount * 100)}%`
}
function cellSecondary(r: LootboxReward, i: number) {
  const value = i === WIN_INDEX && winValue.value ? winValue.value.cashValue : cashValueOf(r)
  return `$${formatNumber(value, true)}`
}

const buyingSlot = ref(false)

async function open(mode: 'free' | 'paid') {
  if (spinning.value) return
  spinning.value = true
  result.value = null
  winValue.value = null
  try {
    const res = await $fetch('/api/miner/lootbox/open', { method: 'POST', body: { mode } })
    const won = LOOTBOX_REWARDS.find(r => r.id === res.wonId)!
    freeRemaining.value = res.freeOpensRemaining
    winValue.value = { cashValue: res.cashValue }

    // Build a fresh reel with the winning reward fixed at WIN_INDEX
    const items = Array.from({ length: REEL_LEN }, () => lootboxRoll())
    items[WIN_INDEX] = won
    reel.value = items

    // Snap to start without animation, then animate to the winning cell
    transitionOn.value = false
    offset.value = 0
    await nextTick()
    void viewport.value?.offsetHeight // force reflow
    requestAnimationFrame(() => {
      const vw = viewport.value?.clientWidth ?? 0
      const jitter = (Math.random() - 0.5) * (CELL * 0.6)
      transitionOn.value = true
      offset.value = vw / 2 - (WIN_INDEX * STRIDE + CELL / 2) - jitter
    })

    // Reveal after the spin animation finishes
    setTimeout(async () => {
      result.value = { reward: won, cashValue: res.cashValue, paid: res.paid }
      spinning.value = false
      toast.add({ title: `+$${formatNumber(res.cashValue, true)}!`, color: 'success', icon: 'i-lucide-coins' })
      await Promise.all([fetchSession(), refresh()])
    }, revealDelayMs.value)
  } catch (e: any) {
    spinning.value = false
    toast.add({ title: apiErrorMessage(e, 'Open failed'), color: 'error' })
  }
}

async function buySlot() {
  buyingSlot.value = true
  try {
    const res = await $fetch('/api/miner/lootbox/buy-slot', { method: 'POST' })
    toast.add({ title: `Lootbox slot #${res.newSlots} unlocked!`, color: 'success', icon: 'i-lucide-gift' })
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
</script>

<template>
  <UContainer class="space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold">Lootboxes</h1>
      <p class="text-sm text-muted mt-0.5">Spin the wheel for cash rewards that scale with your vault.</p>
    </div>

    <div v-if="!state" class="space-y-4">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <USkeleton class="h-28 rounded-xl" />
        <USkeleton class="h-28 rounded-xl" />
      </div>
      <USkeleton class="h-48 rounded-xl" />
    </div>

    <template v-else>
      <!-- Info row -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Buy Slot -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <div class="size-8 rounded-lg bg-primary/15 flex items-center justify-center">
                  <UIcon name="i-lucide-gift" class="size-4 text-primary" />
                </div>
                <div>
                  <p class="font-semibold text-sm">Lootbox Slots</p>
                  <p class="text-xs text-muted">More slots = more free daily opens</p>
                </div>
              </div>
              <span class="text-2xl font-bold">{{ state.lootboxSlots }}<span class="text-muted text-base font-normal">/{{ state.lootboxMaxSlots }}</span></span>
            </div>
          </template>
          <UButton
            label="Buy Slot"
            icon="i-lucide-plus"
            block
            color="primary"
            :loading="buyingSlot"
            :disabled="state.lootboxSlots >= state.lootboxMaxSlots || balance < state.lootboxNextSlotCost"
            @click="buySlot"
          >
            <template #trailing>
              <span class="text-xs opacity-70">
                {{ state.lootboxSlots >= state.lootboxMaxSlots ? 'Max reached' : `Cost: $${formatNumber(state.lootboxNextSlotCost, true)}` }}
              </span>
            </template>
          </UButton>
        </UCard>

        <!-- Daily Opens -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <div class="size-8 rounded-lg bg-primary/15 flex items-center justify-center">
                  <UIcon name="i-lucide-calendar-days" class="size-4 text-primary" />
                </div>
                <div>
                  <p class="font-semibold text-sm">Free Opens</p>
                  <p class="text-xs text-muted">Resets daily — one per slot</p>
                </div>
              </div>
              <span class="text-2xl font-bold" :class="freeRemaining > 0 ? 'text-primary' : 'text-muted'">
                {{ freeRemaining }}<span class="text-muted text-base font-normal">/{{ state.lootboxSlots }}</span>
              </span>
            </div>
          </template>
          <div class="h-2 rounded-full bg-elevated overflow-hidden">
            <div
              class="h-full bg-primary rounded-full transition-all"
              :style="{ width: `${state.lootboxSlots > 0 ? (freeRemaining / state.lootboxSlots) * 100 : 0}%` }"
            />
          </div>
          <p class="text-xs text-muted mt-2">
            {{ freeRemaining > 0 ? `${freeRemaining} free open${freeRemaining !== 1 ? 's' : ''} remaining today` : 'All free opens used — buy one below' }}
          </p>
        </UCard>

      </div>

      <!-- Wheel -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-disc-3" class="size-4 text-primary" />
              <p class="font-semibold text-sm">Spin the Wheel</p>
            </div>
            <USwitch v-model="fastSpin" label="Fast spin" :disabled="spinning" />
          </div>
        </template>
        <div class="relative">
          <!-- Center pointer -->
          <div class="pointer-events-none absolute left-1/2 top-0 bottom-0 z-10 -translate-x-1/2 flex flex-col items-center justify-between py-1">
            <UIcon name="i-lucide-triangle" class="size-4 text-primary rotate-180" />
            <div class="w-0.5 flex-1 bg-primary/60 my-1" />
            <UIcon name="i-lucide-triangle" class="size-4 text-primary" />
          </div>

          <!-- Edge fades -->
          <div class="pointer-events-none absolute inset-y-0 left-0 w-16 z-[5] bg-gradient-to-r from-default to-transparent" />
          <div class="pointer-events-none absolute inset-y-0 right-0 w-16 z-[5] bg-gradient-to-l from-default to-transparent" />

          <div ref="viewport" class="overflow-hidden">
            <div
              class="flex gap-2 py-2"
              :style="{
                transform: `translateX(${offset}px)`,
                transition: transitionOn ? `transform ${spinSeconds}s cubic-bezier(0.12, 0.8, 0.12, 1)` : 'none',
              }"
            >
              <div
                v-for="(item, i) in reel"
                :key="i"
                class="shrink-0 h-28 rounded-xl border-2 flex flex-col items-center justify-center gap-1"
                :style="{ width: `${CELL}px` }"
                :class="[RARITY_CLASSES[item.rarity].border, RARITY_CLASSES[item.rarity].bg]"
              >
                <UIcon
                  name="i-lucide-coins"
                  class="size-6"
                  :class="RARITY_CLASSES[item.rarity].text"
                />
                <span class="text-sm font-bold leading-none">{{ cellPrimary(item) }}</span>
                <span class="text-[11px] text-muted leading-none">{{ cellSecondary(item, i) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Result banner -->
        <div
          v-if="result"
          class="mt-4 rounded-xl border-2 p-4 flex items-center justify-between"
          :class="[RARITY_CLASSES[result.reward.rarity].border, RARITY_CLASSES[result.reward.rarity].bg]"
        >
          <div class="flex items-center gap-3">
            <UIcon
              name="i-lucide-coins"
              class="size-7"
              :class="RARITY_CLASSES[result.reward.rarity].text"
            />
            <div>
              <p class="font-bold text-lg leading-tight">
                +${{ formatNumber(result.cashValue, true) }}
              </p>
              <p class="text-xs text-muted capitalize">{{ result.reward.rarity }} reward</p>
            </div>
          </div>
          <UBadge :label="result.paid ? 'Paid open' : 'Free open'" color="neutral" variant="subtle" />
        </div>

        <!-- Actions -->
        <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UButton
            :label="freeRemaining > 0 ? `Open Free (${freeRemaining})` : 'No free opens left'"
            icon="i-lucide-sparkles"
            block
            color="primary"
            size="lg"
            :loading="spinning"
            :disabled="spinning || freeRemaining <= 0"
            @click="open('free')"
          />
          <UButton
            label="Buy Open"
            icon="i-lucide-shopping-cart"
            block
            color="primary"
            size="lg"
            :disabled="spinning || balance < state.lootboxOpenPrice"
            @click="open('paid')"
          >
            <template #trailing>
              <span class="text-sm opacity-80">· ${{ formatNumber(state.lootboxOpenPrice, true) }}</span>
            </template>
          </UButton>
        </div>
      </UCard>

      <!-- Prize pool -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-list" class="size-4 text-primary" />
            <p class="font-semibold text-sm">Prize Pool</p>
          </div>
        </template>
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
      </UCard>
    </template>
  </UContainer>
</template>
