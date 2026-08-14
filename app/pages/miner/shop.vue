<script setup lang="ts">
import { OVERCLOCK_BONUS_PER_LEVEL, CATALYST_BONUS_PER_LEVEL } from '#shared/utils/miner-config'
import { RAKEBACK_UNLOCK_COST } from '#shared/utils/profile'

const { fetchSession, user } = useAuth()
const gems = computed(() => user.value?.gems ?? 0)
const rakebackUnlocked = computed(() => !!user.value?.rakebackUnlocked)
const { state, refresh } = await useMiner()

const scene = ref<{ playPurchase: (k: 'overclock' | 'catalyst' | 'rakeback') => void, playReject: (k: 'overclock' | 'catalyst' | 'rakeback') => void } | null>(null)
const toast = useToast()
const buying = ref<string | null>(null)

const overclockMaxed = computed(() => !!state.value && state.value.overclockLevel >= state.value.overclockMaxLevel)
const catalystMaxed = computed(() => !!state.value && state.value.catalystLevel >= state.value.catalystMaxLevel)

async function purchase(id: 'overclock' | 'catalyst', label: string, cost: number | null, maxed: boolean) {
  if (maxed || !cost || gems.value < cost || buying.value) {
    scene.value?.playReject(id)
    return
  }
  buying.value = id
  try {
    await $fetch(`/api/miner/shop/${id}`, { method: 'POST' })
    scene.value?.playPurchase(id)
    toast.add({ title: `${label} upgraded!`, color: 'success', icon: 'i-lucide-arrow-up' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: apiErrorMessage(e, 'Purchase failed'), color: 'error' })
  } finally {
    buying.value = null
  }
}

async function unlockRakeback() {
  if (rakebackUnlocked.value) {
    await navigateTo('/profile')
    return
  }
  if (gems.value < RAKEBACK_UNLOCK_COST || buying.value) {
    scene.value?.playReject('rakeback')
    return
  }
  buying.value = 'rakeback'
  try {
    await $fetch('/api/user/unlock-rakeback', { method: 'POST' })
    scene.value?.playPurchase('rakeback')
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
  <UContainer class="space-y-4">
    <USkeleton v-if="!state" class="h-[56vh] min-h-[400px] rounded-2xl" />

    <template v-else>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MinerStatTile
          icon="i-lucide-gauge"
          label="Overclock"
          :value="`Lv ${state.overclockLevel}/${state.overclockMaxLevel}`"
          :sub="`+${Math.round((state.incomeMultiplier - 1) * 100)}% income`"
          tone="gold"
        />
        <MinerStatTile
          icon="i-lucide-flask-conical"
          label="Catalyst"
          :value="`Lv ${state.catalystLevel}/${state.catalystMaxLevel}`"
          :sub="`+${Math.round((state.gemRateMultiplier - 1) * 100)}% gems`"
          tone="cyan"
        />
        <MinerStatTile
          icon="i-lucide-piggy-bank"
          label="Rakeback"
          :value="rakebackUnlocked ? 'Unlocked' : 'Locked'"
          :sub="rakebackUnlocked ? 'claim in profile' : `${RAKEBACK_UNLOCK_COST} gems`"
          tone="steel"
        />
        <MinerStatTile icon="i-lucide-gem" label="Gems" :value="formatNumber(gems, true, 0)" sub="available" tone="cyan" />
      </div>
      <MinerWorkshopScene
        ref="scene"
        :overclock-level="state.overclockLevel"
        :overclock-max-level="state.overclockMaxLevel"
        :catalyst-level="state.catalystLevel"
        :catalyst-max-level="state.catalystMaxLevel"
        :rakeback-unlocked="rakebackUnlocked"
        :busy="!!buying"
        @buy-overclock="purchase('overclock', 'Rig Overclock', state.overclockNextCost, overclockMaxed)"
        @buy-catalyst="purchase('catalyst', 'Factory Catalyst', state.catalystNextCost, catalystMaxed)"
        @unlock-rakeback="unlockRakeback"
      >
        <template #overclock>
          <MinerActionChip
            :label="overclockMaxed ? 'Overclock maxed' : `Overclock · ${state.overclockNextCost} 💎`"
            :sub="overclockMaxed
              ? `+${Math.round((state.incomeMultiplier - 1) * 100)}% income`
              : `+${Math.round((state.incomeMultiplier - 1) * 100)}% → +${Math.round((state.incomeMultiplier - 1 + OVERCLOCK_BONUS_PER_LEVEL) * 100)}% income`"
            icon="i-lucide-gauge"
            tone="gold"
            :loading="buying === 'overclock'"
            :disabled="overclockMaxed || !state.overclockNextCost || gems < state.overclockNextCost"
            @click="purchase('overclock', 'Rig Overclock', state.overclockNextCost, overclockMaxed)"
          />
        </template>

        <template #catalyst>
          <MinerActionChip
            :label="catalystMaxed ? 'Catalyst maxed' : `Catalyst · ${state.catalystNextCost} 💎`"
            :sub="catalystMaxed
              ? `+${Math.round((state.gemRateMultiplier - 1) * 100)}% gem rate`
              : `+${Math.round((state.gemRateMultiplier - 1) * 100)}% → +${Math.round((state.gemRateMultiplier - 1 + CATALYST_BONUS_PER_LEVEL) * 100)}% gem rate`"
            icon="i-lucide-flask-conical"
            tone="cyan"
            :loading="buying === 'catalyst'"
            :disabled="catalystMaxed || !state.catalystNextCost || gems < state.catalystNextCost"
            @click="purchase('catalyst', 'Factory Catalyst', state.catalystNextCost, catalystMaxed)"
          />
        </template>

        <template #rakeback>
          <MinerActionChip
            :label="rakebackUnlocked ? 'Open in profile' : `Unlock Rakeback · ${RAKEBACK_UNLOCK_COST} 💎`"
            :sub="rakebackUnlocked ? 'Claim your slice of every wager' : 'A slice of every wager, forever'"
            :icon="rakebackUnlocked ? 'i-lucide-lock-open' : 'i-lucide-piggy-bank'"
            tone="steel"
            :loading="buying === 'rakeback'"
            :disabled="!rakebackUnlocked && gems < RAKEBACK_UNLOCK_COST"
            @click="unlockRakeback"
          />
        </template>

        <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
          <div>
            <h1 class="text-lg font-bold text-white/95 drop-shadow">Supply Bench</h1>
            <p class="text-xs text-white/55">Spend gems on permanent hardware. Every level shows up on the bench.</p>
          </div>
        </div>
      </MinerWorkshopScene>

    </template>
  </UContainer>
</template>
