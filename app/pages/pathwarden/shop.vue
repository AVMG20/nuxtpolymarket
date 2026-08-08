<script setup lang="ts">
import type { PathwardenBoostId } from '#shared/utils/gamelogic/pathwarden'

definePageMeta({ title: 'Warden’s Reliquary' })

const toast = useToast()
const { fetchSession } = useAuth()
const { data: state, refresh } = await useApiState('/api/pathwarden/state')
const activeTab = ref('defenses')
const familyFilter = ref('all')
const buyingDefense = ref<string | null>(null)
const buyingSkin = ref<string | null>(null)
const buyingBoost = ref<PathwardenBoostId | null>(null)
const buyingSurge = ref(false)
const isDev = import.meta.dev
const balance = computed(() => Number(state.value?.balance ?? 0))
const families = computed(() => [
  { label: 'All families', value: 'all' },
  ...Array.from(new Set(state.value?.defenses.map(defense => defense.family) ?? []))
    .map(value => ({ label: value[0]!.toUpperCase() + value.slice(1), value }))
])
const defenses = computed(() => state.value?.defenses.filter(defense =>
  familyFilter.value === 'all' || defense.family === familyFilter.value
) ?? [])

function apiMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'data' in error) {
    const data = (error as { data?: { statusMessage?: string } }).data
    if (data?.statusMessage) return data.statusMessage
  }
  return fallback
}

async function completePurchase(title: string) {
  await Promise.all([refresh(), fetchSession()])
  toast.add({ title, color: 'success', icon: 'i-lucide-sparkles' })
}

async function buyDefense(defenseId: string) {
  buyingDefense.value = defenseId
  try {
    await apiFetch('/api/pathwarden/defenses/buy', { method: 'POST', body: { defenseId } })
    await completePurchase('Blueprint added to your arsenal')
  } catch (error) {
    toast.add({ title: apiMessage(error, 'Could not buy blueprint'), color: 'error' })
  } finally {
    buyingDefense.value = null
  }
}

async function buySkin(skinId: string) {
  buyingSkin.value = skinId
  try {
    await apiFetch('/api/pathwarden/skins/buy', { method: 'POST', body: { skinId } })
    await completePurchase('Citadel livery purchased and equipped')
  } catch (error) {
    toast.add({ title: apiMessage(error, 'Could not buy livery'), color: 'error' })
  } finally {
    buyingSkin.value = null
  }
}

async function equipSkin(skinId: string) {
  buyingSkin.value = skinId
  try {
    await apiFetch('/api/pathwarden/skins/equip', { method: 'POST', body: { skinId } })
    await refresh()
    toast.add({ title: 'Citadel livery equipped', color: 'success' })
  } catch (error) {
    toast.add({ title: apiMessage(error, 'Could not equip livery'), color: 'error' })
  } finally {
    buyingSkin.value = null
  }
}

async function buyBoost(boostId: PathwardenBoostId) {
  buyingBoost.value = boostId
  try {
    await apiFetch('/api/pathwarden/boost', { method: 'POST', body: { boostId } })
    await completePurchase('Permanent upgrade acquired')
  } catch (error) {
    toast.add({ title: apiMessage(error, 'Could not buy upgrade'), color: 'error' })
  } finally {
    buyingBoost.value = null
  }
}

async function buySurge() {
  buyingSurge.value = true
  try {
    await apiFetch('/api/pathwarden/surge', { method: 'POST', body: { count: 1 } })
    await completePurchase('Mist Surge prepared')
  } catch (error) {
    toast.add({ title: apiMessage(error, 'Could not prepare surge'), color: 'error' })
  } finally {
    buyingSurge.value = false
  }
}

function boostSpriteStyle(sprite: { col: number, row: number }) {
  return {
    backgroundImage: 'url(/games/pathwarden/boosts.png)',
    backgroundSize: '300% 200%',
    backgroundPosition: `${sprite.col * 50}% ${sprite.row * 100}%`
  }
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <UContainer class="py-8 sm:py-12">
      <div class="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <UButton to="/pathwarden" color="neutral" variant="ghost" icon="i-lucide-arrow-left" class="mb-3">Back to the keep</UButton>
          <p class="text-xs font-black uppercase tracking-[.3em] text-primary">Pathwarden armory</p>
          <h1 class="mt-2 text-3xl font-black sm:text-5xl">Warden’s Reliquary</h1>
          <p class="mt-3 max-w-2xl text-muted">Inspect every model before investing. Blueprints unlock tactical defenses; liveries rebuild your citadel’s silhouette for pure bragging rights.</p>
        </div>
        <div v-if="state" class="flex gap-3 rounded-2xl border border-default bg-elevated p-4 text-sm font-black shadow-lg">
          <span class="text-warning"><UIcon name="i-lucide-coins" /> {{ formatNumber(balance) }}</span>
          <span class="text-primary"><UIcon name="i-lucide-gem" /> {{ formatNumber(state.gems, false) }}</span>
        </div>
      </div>

      <UTabs
        v-model="activeTab"
        :items="[
          { label: 'Defense blueprints', value: 'defenses', icon: 'i-lucide-castle', badge: '50' },
          { label: 'Citadel liveries', value: 'skins', icon: 'i-lucide-crown' },
          { label: 'Permanent upgrades', value: 'upgrades', icon: 'i-lucide-sparkles' }
        ]"
        class="w-full"
      />

      <div v-if="state && activeTab === 'defenses'" class="mt-7">
        <UAlert
          v-if="isDev && state.debugMode"
          class="mb-5"
          color="warning"
          variant="soft"
          icon="i-lucide-flask-conical"
          title="Debug purchasing enabled"
          description="Coin and Gem affordability checks are disabled. Purchases cost nothing in this environment."
        />
        <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-2xl font-black">Fifty battlefield models</h2>
            <p class="text-sm text-muted">Each tier has different ornaments, combat statistics, and an increasingly prestigious silhouette.</p>
          </div>
          <USelect v-model="familyFilter" :items="families" value-key="value" class="w-48" />
        </div>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <UCard v-for="defense in defenses" :key="defense.id" class="overflow-hidden" :ui="{ body: 'p-0 sm:p-0', footer: 'p-4 sm:p-4' }">
            <PathwardenDefensePreview :defense="defense" />
            <template #footer>
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="font-black">{{ defense.name }}</h3>
                  <p class="mt-1 text-xs leading-relaxed text-muted">{{ defense.description }}</p>
                </div>
                <UBadge :color="defense.owned ? 'success' : 'neutral'" variant="soft">{{ defense.owned ? 'Owned' : `T${defense.tier}` }}</UBadge>
              </div>
              <div class="mt-3 grid grid-cols-4 gap-1 text-center text-[10px] text-muted">
                <span><b class="block text-default">{{ defense.damage }}</b>damage</span>
                <span><b class="block text-default">{{ defense.range }}</b>range</span>
                <span><b class="block text-default">{{ defense.rate }}s</b>reload</span>
                <span><b class="block text-default">{{ defense.aetherCost }}</b>Aether</span>
              </div>
              <UButton
                class="mt-4"
                block
                color="warning"
                variant="soft"
                icon="i-lucide-coins"
                :loading="buyingDefense === defense.id"
                :disabled="defense.owned || (!state.debugMode && balance < defense.coinCost) || Boolean(state.activeRun)"
                @click="buyDefense(defense.id)"
              >
                {{ defense.owned ? 'Already owned' : formatNumber(defense.coinCost, false) }}
              </UButton>
            </template>
          </UCard>
        </div>
      </div>

      <div v-else-if="state && activeTab === 'skins'" class="mt-7">
        <h2 class="text-2xl font-black">Citadel transformations</h2>
        <p class="mb-5 text-sm text-muted">These alter towers, rooflines, crowns, banners, and architectural ornaments—never combat power.</p>
        <div class="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <UCard v-for="skin in state.skins" :key="skin.id" class="overflow-hidden" :ui="{ body: 'p-0 sm:p-0', footer: 'p-4 sm:p-4' }">
            <PathwardenSkinPreview :skin-id="skin.id" :name="skin.name" />
            <template #footer>
              <h3 class="font-black">{{ skin.name }}</h3>
              <p class="mt-1 min-h-10 text-xs text-muted">{{ skin.description }}</p>
              <UButton
                class="mt-4"
                block
                :color="skin.equipped ? 'success' : 'primary'"
                :variant="skin.equipped ? 'soft' : 'outline'"
                :icon="skin.owned ? 'i-lucide-shirt' : 'i-lucide-gem'"
                :loading="buyingSkin === skin.id"
                :disabled="skin.equipped || Boolean(state.activeRun) || (!state.debugMode && !skin.owned && state.gems < skin.gemCost)"
                @click="skin.owned ? equipSkin(skin.id) : buySkin(skin.id)"
              >
                {{ skin.equipped ? 'Equipped' : skin.owned ? 'Equip this livery' : `${formatNumber(skin.gemCost, false)} Gems` }}
              </UButton>
            </template>
          </UCard>
        </div>
      </div>

      <div v-else-if="state && activeTab === 'upgrades'" class="mt-7 space-y-5">
        <UCard class="border-primary/30">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div class="boost-sprite size-24 shrink-0" :style="boostSpriteStyle({ col: 2, row: 1 })" />
            <div class="flex-1">
              <h2 class="text-xl font-black">Mist Surge charge</h2>
              <p class="text-sm text-muted">One-run supercharge: +25% starting Aether, +10% damage and +5% attack speed.</p>
              <p class="mt-1 text-xs font-black text-primary">{{ state.surgeCharges }} prepared</p>
            </div>
            <UButton icon="i-lucide-gem" :loading="buyingSurge" :disabled="!state.debugMode && state.gems < state.surgeCostGems" @click="buySurge">
              {{ state.surgeCostGems }} Gems
            </UButton>
          </div>
        </UCard>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <UCard v-for="boost in state.boosts" :key="boost.id" class="relative overflow-hidden">
            <div class="boost-sprite size-20" :style="boostSpriteStyle(boost.sprite)" />
            <UBadge class="absolute right-4 top-4 whitespace-nowrap">Lv. {{ boost.level }}/{{ boost.maxLevel }}</UBadge>
            <h3 class="mt-3 font-black">{{ boost.name }}</h3>
            <p class="mt-1 min-h-10 text-xs text-muted">{{ boost.description }}</p>
            <UButton
              class="mt-4"
              block
              :color="boost.currency === 'gems' ? 'primary' : 'warning'"
              :icon="boost.currency === 'gems' ? 'i-lucide-gem' : 'i-lucide-coins'"
              :loading="buyingBoost === boost.id"
              :disabled="boost.cost === null || (!state.debugMode && (boost.currency === 'gems' ? state.gems < (boost.cost ?? 0) : balance < (boost.cost ?? 0)))"
              @click="buyBoost(boost.id)"
            >
              {{ boost.cost === null ? 'Maximum level' : formatNumber(boost.cost, false) }}
            </UButton>
          </UCard>
        </div>
      </div>
      <USkeleton v-else class="mt-7 h-96 w-full rounded-2xl" />
    </UContainer>
  </div>
</template>

<style scoped>
.boost-sprite {
  border-radius: 1rem;
  background-repeat: no-repeat;
  filter: drop-shadow(0 10px 12px rgb(2 6 23 / .28));
}
</style>
