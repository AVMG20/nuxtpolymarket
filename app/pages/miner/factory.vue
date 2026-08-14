<script setup lang="ts">
const { fetchSession, user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const { state, refresh, displayGems, collectableGems, gemFill } = await useMiner()

const scene = ref<{ playCollect: () => void, playUpgrade: () => void, playReject: (w: 'press' | 'rack') => void } | null>(null)
const toast = useToast()
const collecting = ref(false)
const upgrading = ref(false)

const factoryMaxed = computed(() => !!state.value && state.value.factoryLevel >= state.value.factoryMaxLevel)
const canAfford = computed(() => !!state.value && balance.value >= state.value.factoryUpgradeCost)
const rackFull = computed(() => gemFill.value >= 0.999)

async function collectGems() {
  if (collectableGems.value < 1 || collecting.value) {
    scene.value?.playReject('rack')
    return
  }
  collecting.value = true
  scene.value?.playCollect()
  try {
    const res = await $fetch('/api/miner/collect-gems', { method: 'POST' })
    toast.add({ title: `Collected ${res.collected} gem${res.collected !== 1 ? 's' : ''}`, color: 'success', icon: 'i-lucide-gem' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: apiErrorMessage(e, 'Failed to collect'), color: 'error' })
  } finally {
    collecting.value = false
  }
}

async function upgradeFactory() {
  if (factoryMaxed.value || !canAfford.value || upgrading.value) {
    scene.value?.playReject('press')
    return
  }
  upgrading.value = true
  try {
    const res = await $fetch('/api/miner/upgrade-factory', { method: 'POST' })
    scene.value?.playUpgrade()
    toast.add({ title: `Factory upgraded to level ${res.newLevel}`, color: 'success', icon: 'i-lucide-factory' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: apiErrorMessage(e, 'Upgrade failed'), color: 'error' })
  } finally {
    upgrading.value = false
  }
}
</script>

<template>
  <UContainer class="space-y-4">
    <USkeleton v-if="!state" class="h-[62vh] min-h-[420px] rounded-2xl" />

    <template v-else>
      <div class="grid grid-cols-3 gap-2">
        <MinerStatTile icon="i-lucide-diamond" label="Geode" :value="`Lv ${state.factoryLevel}/${state.factoryMaxLevel}`" :sub="`${state.rate.toFixed(1)} gems/day`" tone="cyan" />
        <MinerStatTile icon="i-lucide-package" label="Crate" :value="`${collectableGems}/${state.gemCap}`" :sub="`${Math.round(gemFill * 100)}% full`" tone="cyan" />
        <MinerStatTile icon="i-lucide-gem" label="Gems" :value="formatNumber(user?.gems ?? 0, true, 0)" sub="in wallet" tone="cyan" />
      </div>
      <MinerForgeScene
        ref="scene"
        :factory-level="state.factoryLevel"
        :factory-max-level="state.factoryMaxLevel"
        :catalyst-level="state.catalystLevel"
        :gem-rate-multiplier="state.gemRateMultiplier"
        :gem-cap="state.gemCap"
        :pending-gems="displayGems"
        :busy="collecting || upgrading"
        @collect="collectGems"
        @upgrade-factory="upgradeFactory"
      >
        <template #rack>
          <MinerActionChip
            :label="collectableGems >= 1 ? `Collect ${collectableGems} gem${collectableGems !== 1 ? 's' : ''}` : 'Crate empty'"
            :sub="rackFull ? 'FULL — the crate cannot take more' : `${collectableGems}/${state.gemCap} in the crate`"
            icon="i-lucide-gem"
            tone="cyan"
            :ready="collectableGems >= 1"
            :loading="collecting"
            :disabled="collectableGems < 1"
            @click="collectGems"
          />
        </template>

        <template #press>
          <MinerActionChip
            :label="factoryMaxed ? 'Geode maxed' : `Expand geode · $${formatNumber(state.factoryUpgradeCost, true)}`"
            :sub="factoryMaxed
              ? `Level ${state.factoryLevel}`
              : `Lv ${state.factoryLevel} → ${state.factoryLevel + 1} · ${(factoryRate(state.factoryLevel + 1) * state.gemRateMultiplier).toFixed(1)}/d`"
            icon="i-lucide-diamond"
            tone="steel"
            :loading="upgrading"
            :disabled="factoryMaxed || !canAfford"
            @click="upgradeFactory"
          />
        </template>

        <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
          <div>
            <h1 class="text-lg font-bold text-white/95 drop-shadow">Gem Forge</h1>
            <p class="text-xs text-white/55">Your cutter chips gems loose and crates them. Click the crate to collect.</p>
          </div>
          <div class="flex flex-col items-end gap-1.5">
            <div class="flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-black/45 px-2.5 py-1 backdrop-blur-sm">
              <UIcon name="i-lucide-activity" class="size-3.5 text-cyan-400" />
              <span class="text-xs font-semibold text-cyan-200 tabular-nums">{{ state.rate.toFixed(1) }} gems/day</span>
            </div>
            <div
              v-if="state.catalystLevel > 0"
              class="flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-black/45 px-2.5 py-1 backdrop-blur-sm"
            >
              <UIcon name="i-lucide-flask-conical" class="size-3.5 text-cyan-300" />
              <span class="text-[11px] font-semibold text-cyan-200">Catalyst +{{ Math.round((state.gemRateMultiplier - 1) * 100) }}%</span>
            </div>
          </div>
        </div>

        <div v-if="rackFull" class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <div class="flex items-center gap-2 rounded-full border border-red-400/50 bg-red-950/70 px-3 py-1.5 backdrop-blur-sm">
            <UIcon name="i-lucide-triangle-alert" class="size-3.5 text-red-300" />
            <span class="text-xs font-medium text-red-100">Crate is full — no more gems are forming</span>
          </div>
        </div>
      </MinerForgeScene>

    </template>
  </UContainer>
</template>
