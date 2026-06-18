<script setup lang="ts">
const { fetchSession, user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const { data: state, refresh } = await useFetch('/api/miner/state')

const fetchedAt = ref(Date.now())
const now = ref(Date.now())

watch(state, () => { fetchedAt.value = Date.now() })

onMounted(() => {
  const interval = setInterval(() => { now.value = Date.now() }, 1000)
  onUnmounted(() => clearInterval(interval))
})

function elapsedDays() {
  return (now.value - fetchedAt.value) / 86_400_000
}

const displayGems = computed(() => {
  if (!state.value) return 0
  return Math.min(state.value.pendingGems + state.value.rate * elapsedDays(), state.value.gemCap)
})

const collectableGems = computed(() => Math.floor(displayGems.value))

const fillPercent = computed(() => {
  if (!state.value?.gemCap) return 0
  return Math.min((displayGems.value / state.value.gemCap) * 100, 100)
})

const collecting = ref(false)
const upgrading = ref(false)
const toast = useToast()

async function collectGems() {
  collecting.value = true
  try {
    const res = await $fetch('/api/miner/collect-gems', { method: 'POST' })
    toast.add({ title: `Collected ${res.collected} gem${res.collected !== 1 ? 's' : ''}`, color: 'success', icon: 'i-lucide-gem' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.message ?? 'Failed to collect', color: 'error' })
  } finally {
    collecting.value = false
  }
}

async function upgradeFactory() {
  upgrading.value = true
  try {
    const res = await $fetch('/api/miner/upgrade-factory', { method: 'POST' })
    toast.add({ title: `Factory upgraded to level ${res.newLevel}`, color: 'success' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.message ?? 'Upgrade failed', color: 'error' })
  } finally {
    upgrading.value = false
  }
}
</script>

<template>
  <UContainer class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Gem Factory</h1>
        <p class="text-sm text-muted mt-0.5">Synthesize premium gems for shop upgrades.</p>
      </div>
    </div>

    <!-- Skeletons -->
    <div v-if="!state" class="space-y-4">
      <USkeleton class="h-24 rounded-xl" />
      <USkeleton class="h-44 rounded-xl" />
    </div>

    <template v-else>
      <!-- Gem Synthesizer — full width -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="size-8 rounded-lg bg-cyan-400/15 flex items-center justify-center">
                <UIcon name="i-lucide-gem" class="size-4 text-cyan-400" />
              </div>
              <div>
                <p class="font-semibold text-sm">Gem Synthesizer</p>
                <p class="text-xs text-muted">Harvest synthesized gems to use in the shop</p>
              </div>
            </div>
            <div class="text-right">
              <span class="text-2xl font-bold text-cyan-400">{{ collectableGems }}</span>
              <span class="text-muted"> / {{ state.gemCap }}</span>
            </div>
          </div>
        </template>

        <div class="flex items-center gap-4">
          <div class="flex-1 h-2 rounded-full bg-elevated overflow-hidden">
            <div class="h-full bg-cyan-400 rounded-full" :style="{ width: `${fillPercent}%` }" />
          </div>
          <UButton
            :label="collectableGems >= 1 ? `Collect ${collectableGems} Gem${collectableGems !== 1 ? 's' : ''}` : 'Not enough yet'"
            icon="i-lucide-gem"
            color="primary"
            :loading="collecting"
            :disabled="collectableGems < 1"
            @click="collectGems"
          />
        </div>
      </UCard>

      <!-- Factory Upgrade -->
      <UCard class="flex flex-col">
        <template #header>
          <div class="flex items-center gap-2.5">
            <div class="size-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <UIcon name="i-lucide-factory" class="size-4 text-primary" />
            </div>
            <div>
              <p class="font-semibold text-sm">Factory Upgrade</p>
              <p class="text-xs text-muted">Enhance synthesis speed and storage capacity</p>
            </div>
          </div>
        </template>

        <div class="flex gap-8 mb-6">
          <div>
            <p class="text-xs text-muted uppercase tracking-wide font-medium mb-1">Level</p>
            <p class="text-2xl font-bold">{{ state.factoryLevel }}<span class="text-muted text-base font-normal">/{{ state.factoryMaxLevel }}</span></p>
          </div>
          <div>
            <p class="text-xs text-muted uppercase tracking-wide font-medium mb-1">Rate</p>
            <p class="text-2xl font-bold">{{ state.rate.toFixed(1) }}<span class="text-muted text-base font-normal">/d</span></p>
          </div>
          <div>
            <p class="text-xs text-muted uppercase tracking-wide font-medium mb-1">Cap</p>
            <p class="text-2xl font-bold">{{ state.gemCap }}</p>
          </div>
        </div>
        <UButton
          label="Upgrade Factory"
          icon="i-lucide-arrow-up"
          block
          color="primary"
          :loading="upgrading"
          :disabled="state.factoryLevel >= state.factoryMaxLevel || balance < state.factoryUpgradeCost"
          @click="upgradeFactory"
        >
          <template #trailing>
            <span class="text-xs opacity-70">Cost: ${{ formatNumber(state.factoryUpgradeCost, false) }}</span>
          </template>
        </UButton>
      </UCard>
    </template>
  </UContainer>
</template>
