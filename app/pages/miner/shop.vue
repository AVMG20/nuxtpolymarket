<script setup lang="ts">
import { OVERCLOCK_BONUS_PER_LEVEL, CATALYST_BONUS_PER_LEVEL } from '#shared/utils/miner-config'
import { RAKEBACK_UNLOCK_COST } from '#shared/utils/profile'

const { fetchSession, user } = useAuth()
const gems = computed(() => user.value?.gems ?? 0)
const rakebackUnlocked = computed(() => !!user.value?.rakebackUnlocked)
const { data: state, refresh } = await useFetch('/api/miner/state')

const toast = useToast()
const buying = ref<string | null>(null)

const shopItems = computed(() => {
  if (!state.value) return []
  const s = state.value
  return [
    {
      id: 'overclock',
      label: 'Rig Overclock',
      description: 'Permanent boost to mining income and lootbox cash payouts.',
      icon: 'i-lucide-gauge',
      level: s.overclockLevel,
      maxLevel: s.overclockMaxLevel,
      currentBonus: Math.round((s.incomeMultiplier - 1) * 100),
      stepBonus: Math.round(OVERCLOCK_BONUS_PER_LEVEL * 100),
      nextCost: s.overclockNextCost,
      endpoint: '/api/miner/shop/overclock',
    },
    {
      id: 'catalyst',
      label: 'Factory Catalyst',
      description: 'Permanently speeds up gem production. Storage size is unchanged.',
      icon: 'i-lucide-flask-conical',
      level: s.catalystLevel,
      maxLevel: s.catalystMaxLevel,
      currentBonus: Math.round((s.gemRateMultiplier - 1) * 100),
      stepBonus: Math.round(CATALYST_BONUS_PER_LEVEL * 100),
      nextCost: s.catalystNextCost,
      endpoint: '/api/miner/shop/catalyst',
    },
  ]
})

async function purchase(item: { id: string, label: string, endpoint: string }) {
  buying.value = item.id
  try {
    await $fetch(item.endpoint, { method: 'POST' })
    toast.add({ title: `${item.label} upgraded!`, color: 'success', icon: 'i-lucide-arrow-up' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: apiErrorMessage(e, 'Purchase failed'), color: 'error' })
  } finally {
    buying.value = null
  }
}

async function unlockRakeback() {
  buying.value = 'rakeback'
  try {
    await $fetch('/api/user/unlock-rakeback', { method: 'POST' })
    toast.add({ title: 'Rakeback unlocked!', color: 'success', icon: 'i-lucide-lock-open' })
    await fetchSession()
  } catch (e: any) {
    toast.add({ title: apiErrorMessage(e, 'Unlock failed'), color: 'error' })
  } finally {
    buying.value = null
  }
}
</script>

<template>
  <UContainer class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Gem Shop</h1>
        <p class="text-sm text-muted mt-0.5">Spend gems on permanent upgrades for your Money Miner.</p>
      </div>
      <div class="flex items-center gap-2 px-4 py-2 rounded-lg bg-elevated border border-default">
        <UIcon name="i-lucide-gem" class="size-5 text-cyan-400" />
        <UTooltip :text="formatNumber(gems, true, 0)">
          <span class="text-xl font-bold">{{ formatNumber(gems, true, 0) }}</span>
        </UTooltip>
        <span class="text-sm text-muted">Gems</span>
      </div>
    </div>

    <!-- Skeletons -->
    <div v-if="!state" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <USkeleton v-for="i in 3" :key="i" class="h-44 rounded-xl" />
    </div>

    <!-- Shop grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <UCard v-for="item in shopItems" :key="item.id" class="flex flex-col">
        <div class="flex items-start gap-4">
          <div class="size-12 rounded-xl flex items-center justify-center shrink-0 bg-primary/15">
            <UIcon :name="item.icon" class="size-6 text-primary" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2 mb-1">
              <p class="font-semibold text-base">{{ item.label }}</p>
              <span class="text-sm font-bold text-muted shrink-0">
                Lv {{ item.level }}<span class="font-normal">/{{ item.maxLevel }}</span>
              </span>
            </div>
            <p class="text-sm text-muted mb-3">{{ item.description }}</p>

            <div class="flex items-center gap-2 text-sm mb-4">
              <UBadge color="primary" variant="subtle" :label="`+${item.currentBonus}% now`" />
              <template v-if="item.level < item.maxLevel">
                <UIcon name="i-lucide-arrow-right" class="size-3.5 text-muted" />
                <UBadge color="neutral" variant="subtle" :label="`+${item.currentBonus + item.stepBonus}% next`" />
              </template>
            </div>

            <UButton
              v-if="item.level < item.maxLevel && item.nextCost"
              size="sm"
              color="primary"
              :loading="buying === item.id"
              :disabled="gems < item.nextCost"
              @click="purchase(item)"
            >
              Upgrade
              <template #trailing>
                <span class="flex items-center gap-1 text-xs opacity-80">
                  {{ item.nextCost }}
                  <UIcon name="i-lucide-gem" class="size-3.5 text-cyan-400" />
                </span>
              </template>
            </UButton>
            <UBadge v-else color="success" variant="subtle" label="Maxed out" />
          </div>
        </div>
      </UCard>

      <!-- Rakeback unlock -->
      <UCard class="flex flex-col">
        <div class="flex items-start gap-4">
          <div class="size-12 rounded-xl flex items-center justify-center shrink-0 bg-primary/15">
            <UIcon name="i-lucide-piggy-bank" class="size-6 text-primary" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2 mb-1">
              <p class="font-semibold text-base">Rakeback</p>
              <UBadge
                v-if="rakebackUnlocked"
                color="success"
                variant="subtle"
                label="Unlocked"
                icon="i-lucide-lock-open"
                class="shrink-0"
              />
            </div>
            <p class="text-sm text-muted mb-1">
              Permanently unlock claiming your rakeback — a slice of every wager you place.
            </p>
            <p class="text-xs text-muted mb-4">
              Track your balance and claim it from your
              <ULink to="/profile" class="text-primary font-medium">profile</ULink>.
            </p>

            <UButton
              v-if="!rakebackUnlocked"
              size="sm"
              color="primary"
              :loading="buying === 'rakeback'"
              :disabled="gems < RAKEBACK_UNLOCK_COST"
              @click="unlockRakeback"
            >
              Unlock
              <template #trailing>
                <span class="flex items-center gap-1 text-xs opacity-80">
                  {{ RAKEBACK_UNLOCK_COST }}
                  <UIcon name="i-lucide-gem" class="size-3.5 text-cyan-400" />
                </span>
              </template>
            </UButton>
            <UButton
              v-else
              to="/profile"
              size="sm"
              color="neutral"
              variant="subtle"
              trailing-icon="i-lucide-arrow-right"
              label="View in profile"
            />
          </div>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
