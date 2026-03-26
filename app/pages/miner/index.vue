<script setup lang="ts">
const { fetchSession, user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const { data: state, refresh } = await useFetch('/api/miner/state')

// Real-time accumulation: interpolate locally since last fetch
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

const displayCash = computed(() => {
  if (!state.value) return 0
  return Math.min(state.value.pendingCash + state.value.income * elapsedDays(), state.value.cap)
})

const fillPercent = computed(() => {
  if (!state.value?.cap) return 0
  return Math.min((displayCash.value / state.value.cap) * 100, 100)
})

const collecting = ref(false)
const upgradingRig = ref(false)
const upgradingVault = ref(false)
const toast = useToast()

async function collect() {
  collecting.value = true
  try {
    const res = await $fetch('/api/miner/collect', { method: 'POST' })
    toast.add({ title: `Collected $${formatNumber(res.collected, false)}`, color: 'success' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.message ?? 'Failed to collect', color: 'error' })
  } finally {
    collecting.value = false
  }
}

async function upgradeRig() {
  upgradingRig.value = true
  try {
    const res = await $fetch('/api/miner/upgrade-rig', { method: 'POST' })
    toast.add({ title: `Rig upgraded to level ${res.newLevel}`, color: 'success' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.message ?? 'Upgrade failed', color: 'error' })
  } finally {
    upgradingRig.value = false
  }
}

async function upgradeVault() {
  upgradingVault.value = true
  try {
    const res = await $fetch('/api/miner/upgrade-vault', { method: 'POST' })
    toast.add({ title: `Vault expanded to level ${res.newLevel}`, color: 'success' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.message ?? 'Upgrade failed', color: 'error' })
  } finally {
    upgradingVault.value = false
  }
}
</script>

<template>
  <UContainer class="space-y-6">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Money Miner</h1>
        <p class="text-sm text-muted mt-0.5">Automated resource extraction system.</p>
      </div>
    </div>

    <!-- Skeletons -->
    <div v-if="!state" class="space-y-4">
      <USkeleton class="h-36 rounded-xl" />
      <div class="grid grid-cols-2 gap-4">
        <USkeleton class="h-44 rounded-xl" />
        <USkeleton class="h-44 rounded-xl" />
      </div>
    </div>

    <template v-else>
      <!-- Storage Unit — full width -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="size-8 rounded-lg bg-yellow-400/15 flex items-center justify-center">
                <UIcon name="i-lucide-warehouse" class="size-4 text-yellow-400" />
              </div>
              <div>
                <p class="font-semibold text-sm">Storage Unit</p>
                <p class="text-xs text-muted">Capacity status and collection interface</p>
              </div>
            </div>
            <div class="text-right">
              <span class="text-2xl font-bold text-yellow-400">${{ formatNumber(displayCash, false) }}</span>
              <span class="text-muted"> / ${{ formatNumber(state.cap, false) }}</span>
            </div>
          </div>
        </template>

        <div class="flex items-center gap-4">
          <div class="flex-1 h-2 rounded-full bg-elevated overflow-hidden">
            <div class="h-full bg-yellow-400 rounded-full" :style="{ width: `${fillPercent}%` }" />
          </div>
          <UButton
            label="Collect Cash"
            icon="i-lucide-coins"
            :loading="collecting"
            :disabled="displayCash < 0.01"
            @click="collect"
          />
        </div>
      </UCard>

      <!-- Rig + Vault side by side -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Mining Rig -->
        <UCard class="flex flex-col">
          <template #header>
            <div class="flex items-center gap-2.5">
              <div class="size-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <UIcon name="i-lucide-pickaxe" class="size-4 text-primary" />
              </div>
              <div>
                <p class="font-semibold text-sm">Mining Rig</p>
                <p class="text-xs text-muted">Upgrade hardware to increase income rate</p>
              </div>
            </div>
          </template>

          <div class="flex gap-8 mb-6">
            <div>
              <p class="text-xs text-muted uppercase tracking-wide font-medium mb-1">Level</p>
              <p class="text-2xl font-bold">{{ state.rigLevel }}<span class="text-muted text-base font-normal">/{{ state.rigMaxLevel }}</span></p>
            </div>
            <div>
              <p class="text-xs text-muted uppercase tracking-wide font-medium mb-1">Income</p>
              <p class="text-2xl font-bold">${{ formatNumber(state.income, false) }}<span class="text-muted text-base font-normal">/d</span></p>
            </div>
          </div>
          <UButton
            label="Upgrade Rig"
            icon="i-lucide-arrow-up"
            block
            :loading="upgradingRig"
            :disabled="state.rigLevel >= state.rigMaxLevel || balance < state.rigUpgradeCost"
            @click="upgradeRig"
          >
            <template #trailing>
              <span class="text-xs opacity-70">Cost: ${{ formatNumber(state.rigUpgradeCost, false) }}</span>
            </template>
          </UButton>
        </UCard>

        <!-- Vault Size -->
        <UCard class="flex flex-col">
          <template #header>
            <div class="flex items-center gap-2.5">
              <div class="size-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <UIcon name="i-lucide-vault" class="size-4 text-primary" />
              </div>
              <div>
                <p class="font-semibold text-sm">Vault Size</p>
                <p class="text-xs text-muted">Expand capacity to store more offline earnings <br/> This increases gem value for install fill perk
                </p>
              </div>
            </div>
          </template>

          <div class="flex gap-8 mb-6">
            <div>
              <p class="text-xs text-muted uppercase tracking-wide font-medium mb-1">Level</p>
              <p class="text-2xl font-bold">{{ state.vaultLevel }}<span class="text-muted text-base font-normal">/{{ state.vaultMaxLevel }}</span></p>
            </div>
            <div>
              <p class="text-xs text-muted uppercase tracking-wide font-medium mb-1">Cap</p>
              <p class="text-2xl font-bold">${{ formatNumber(state.cap, false) }}</p>
            </div>
          </div>
          <UButton
            label="Expand Vault"
            icon="i-lucide-arrow-up"
            block
            :loading="upgradingVault"
            :disabled="state.vaultLevel >= state.vaultMaxLevel || balance < state.vaultUpgradeCost"
            @click="upgradeVault"
          >
            <template #trailing>
              <span class="text-xs opacity-70">Cost: ${{ formatNumber(state.vaultUpgradeCost, false) }}</span>
            </template>
          </UButton>
        </UCard>
      </div>
    </template>
  </UContainer>
</template>
