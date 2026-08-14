<script setup lang="ts">
import { minerCrewSize, nextMinerAtLevel, storageTierName, nextStorageTierAt } from '~/utils/miner-scene'

const { fetchSession, user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const { state, refresh, displayCash, cashFill } = await useMiner()

const scene = ref<{ playCollect: () => void, playUpgrade: (w: 'rig' | 'vault') => void, playReject: (w: 'rig' | 'vault' | 'scaffold') => void } | null>(null)
const toast = useToast()
const collecting = ref(false)
const upgradingRig = ref(false)
const upgradingVault = ref(false)

const canCollect = computed(() => displayCash.value >= 0.01)
const rigMaxed = computed(() => !!state.value && state.value.rigLevel >= state.value.rigMaxLevel)
const vaultMaxed = computed(() => !!state.value && state.value.vaultLevel >= state.value.vaultMaxLevel)
const canAffordRig = computed(() => !!state.value && balance.value >= state.value.rigUpgradeCost)
const canAffordVault = computed(() => !!state.value && balance.value >= state.value.vaultUpgradeCost)
const vaultFull = computed(() => cashFill.value >= 0.999)

// Copy that tells the player what the next upgrade will visibly change.
const crew = computed(() => minerCrewSize(state.value?.rigLevel ?? 1))
const nextMiner = computed(() => nextMinerAtLevel(state.value?.rigLevel ?? 1))
const storage = computed(() => storageTierName(state.value?.vaultLevel ?? 1))
const nextStorage = computed(() => nextStorageTierAt(state.value?.vaultLevel ?? 1))

async function collect() {
  if (!canCollect.value || collecting.value) {
    scene.value?.playReject('vault')
    return
  }
  collecting.value = true
  scene.value?.playCollect()
  try {
    const res = await $fetch('/api/miner/collect', { method: 'POST' })
    toast.add({ title: `Collected $${formatNumber(res.collected, true)}`, color: 'success', icon: 'i-lucide-coins' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: apiErrorMessage(e, 'Failed to collect'), color: 'error' })
  } finally {
    collecting.value = false
  }
}

async function upgradeRig() {
  if (rigMaxed.value || !canAffordRig.value || upgradingRig.value) {
    scene.value?.playReject('rig')
    return
  }
  upgradingRig.value = true
  try {
    const res = await $fetch('/api/miner/upgrade-rig', { method: 'POST' })
    scene.value?.playUpgrade('rig')
    toast.add({ title: `Rig upgraded to level ${res.newLevel}`, color: 'success', icon: 'i-lucide-pickaxe' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: apiErrorMessage(e, 'Upgrade failed'), color: 'error' })
  } finally {
    upgradingRig.value = false
  }
}

async function upgradeVault() {
  if (vaultMaxed.value || !canAffordVault.value || upgradingVault.value) {
    scene.value?.playReject('scaffold')
    return
  }
  upgradingVault.value = true
  try {
    const res = await $fetch('/api/miner/upgrade-vault', { method: 'POST' })
    scene.value?.playUpgrade('vault')
    toast.add({ title: `Vault expanded to level ${res.newLevel}`, color: 'success', icon: 'i-lucide-vault' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: apiErrorMessage(e, 'Upgrade failed'), color: 'error' })
  } finally {
    upgradingVault.value = false
  }
}
</script>

<template>
  <UContainer class="space-y-4">
    <USkeleton v-if="!state" class="h-[62vh] min-h-[420px] rounded-2xl" />

    <template v-else>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MinerStatTile icon="i-lucide-pickaxe" label="Rig" :value="`Lv ${state.rigLevel}/${state.rigMaxLevel}`" :sub="`$${formatNumber(state.income, true)}/day`" tone="gold" />
        <MinerStatTile icon="i-lucide-warehouse" label="Vault" :value="`Lv ${state.vaultLevel}/${state.vaultMaxLevel}`" :sub="`${storage} · cap $${formatNumber(state.cap, true)}`" tone="gold" />
        <MinerStatTile icon="i-lucide-coins" label="Stored" :value="`$${formatNumber(displayCash, true)}`" :sub="`${Math.round(cashFill * 100)}% full`" tone="gold" />
        <MinerStatTile icon="i-lucide-gauge" label="Overclock" :value="`+${Math.round((state.incomeMultiplier - 1) * 100)}%`" :sub="`Lv ${state.overclockLevel}/${state.overclockMaxLevel}`" tone="gold" />
      </div>
      <MinerShaftScene
        ref="scene"
        :rig-level="state.rigLevel"
        :rig-max-level="state.rigMaxLevel"
        :vault-level="state.vaultLevel"
        :vault-max-level="state.vaultMaxLevel"
        :overclock-level="state.overclockLevel"
        :income-multiplier="state.incomeMultiplier"
        :fill="cashFill"
        :busy="collecting || upgradingRig || upgradingVault"
        @collect="collect"
        @upgrade-rig="upgradeRig"
        @upgrade-vault="upgradeVault"
      >
        <!-- Vault readout — the number the whole page is about. -->
        <template #vault>
          <MinerActionChip
            :label="canCollect ? `Collect $${formatNumber(displayCash, true)}` : 'Vault empty'"
            :sub="vaultFull ? 'FULL — overflow is wasted' : `${Math.round(cashFill * 100)}% of $${formatNumber(state.cap, true)}`"
            icon="i-lucide-coins"
            tone="gold"
            :ready="canCollect"
            :loading="collecting"
            :disabled="!canCollect"
            @click="collect"
          />
        </template>

        <template #rig>
          <MinerActionChip
            :label="rigMaxed ? 'Rig maxed' : `Upgrade Rig · $${formatNumber(state.rigUpgradeCost, true)}`"
            :sub="rigMaxed
              ? `Lv ${state.rigLevel} · ${crew} miners`
              : nextMiner
                ? `$${formatNumber(rigIncome(state.rigLevel + 1) * state.incomeMultiplier, true)}/d · miner #${crew + 1} at Lv ${nextMiner}`
                : `$${formatNumber(rigIncome(state.rigLevel + 1) * state.incomeMultiplier, true)}/d · full crew`"
            icon="i-lucide-pickaxe"
            tone="steel"
            :loading="upgradingRig"
            :disabled="rigMaxed || !canAffordRig"
            @click="upgradeRig"
          />
        </template>

        <template #scaffold>
          <MinerActionChip
            :label="vaultMaxed ? 'Vault maxed' : `Expand · $${formatNumber(state.vaultUpgradeCost, true)}`"
            :sub="vaultMaxed
              ? `Lv ${state.vaultLevel} · ${storage}`
              : nextStorage
                ? `Cap $${formatNumber(vaultCap(state.vaultLevel + 1), true)} · upgrades at Lv ${nextStorage}`
                : `Cap → $${formatNumber(vaultCap(state.vaultLevel + 1), true)}`"
            icon="i-lucide-vault"
            tone="steel"
            :loading="upgradingVault"
            :disabled="vaultMaxed || !canAffordVault"
            @click="upgradeVault"
          />
        </template>

        <!-- Scene overlays -->
        <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
          <div>
            <h1 class="text-lg font-bold text-white/95 drop-shadow">Mining Shaft</h1>
            <p class="text-xs text-white/55">{{ crew }} miner{{ crew !== 1 ? 's' : '' }} working the face</p>
          </div>
          <div class="flex flex-col items-end gap-1.5">
            <div class="flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-black/45 px-2.5 py-1 backdrop-blur-sm">
              <UIcon name="i-lucide-trending-up" class="size-3.5 text-amber-400" />
              <span class="text-xs font-semibold text-amber-200 tabular-nums">${{ formatNumber(state.income, true) }}/day</span>
            </div>
            <div
              v-if="state.overclockLevel > 0"
              class="flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-black/45 px-2.5 py-1 backdrop-blur-sm"
            >
              <UIcon name="i-lucide-flame" class="size-3.5 text-red-400" />
              <span class="text-[11px] font-semibold text-red-200">Overclock +{{ Math.round((state.incomeMultiplier - 1) * 100) }}%</span>
            </div>
          </div>
        </div>

        <!-- Vault-full warning: the one state that actively costs the player money. -->
        <div
          v-if="vaultFull"
          class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"
        >
          <div class="flex items-center gap-2 rounded-full border border-red-400/50 bg-red-950/70 px-3 py-1.5 backdrop-blur-sm">
            <UIcon name="i-lucide-triangle-alert" class="size-3.5 text-red-300" />
            <span class="text-xs font-medium text-red-100">Vault is full — production is spilling on the floor</span>
          </div>
        </div>
      </MinerShaftScene>

      <!-- Compact readout rail under the scene. -->
    </template>
  </UContainer>
</template>
