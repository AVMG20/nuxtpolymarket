<script setup lang="ts">
import '~/assets/css/colony.css'

const route = useRoute()
const colony = useColony()
const { pendingLoot, builders, initialized, bugs, nutrition, gemNutrition, nutritionMax } = colony
const { unlock, play } = useColonySound()
const { user } = useAuth()

const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)

// Shared clock so nav badges tick on pages that don't render the terrarium.
const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => { now.value = Date.now() }, 1000)
  onUnmounted(() => clearInterval(t))
  // Browsers only start audio from a user gesture — warm the context on the
  // first interaction anywhere in the game so the first cue lands.
  window.addEventListener('pointerdown', unlock, { once: true, passive: true })
})

const lootWaiting = computed(() => pendingLoot.value.reduce((s: number, i: { quantity: number }) => s + i.quantity, 0))
const buildersReady = computed(() => {
  void now.value
  return builders.value.filter(b => Date.now() >= new Date(b.completesAt).getTime()).length
})
const starving = computed(() => initialized.value && bugs.value.length > 0 && nutrition.value + gemNutrition.value <= 0)
const coinsPerHour = computed(() => bugs.value.reduce((s: number, b: { itemsPerHour?: number; itemSellValue?: number }) => s + (b.itemsPerHour ?? 0) * (b.itemSellValue ?? 0), 0))
const nutritionPct = computed(() => nutritionMax.value > 0 ? Math.round(((nutrition.value + gemNutrition.value) / nutritionMax.value) * 100) : 0)

const tabs = computed(() => [
  { label: 'Terrarium', to: '/colony', icon: 'i-lucide-bug', badge: lootWaiting.value > 0 ? '!' : '' },
  { label: 'Market', to: '/colony/market', icon: 'i-lucide-store', badge: '' },
  { label: 'Habitat', to: '/colony/habitat', icon: 'i-lucide-hammer', badge: buildersReady.value ? String(buildersReady.value) : '' },
  { label: 'Lab', to: '/colony/research', icon: 'i-lucide-flask-conical', badge: '' },
  { label: 'Colonopedia', to: '/colony/encyclopedia', icon: 'i-lucide-book-open', badge: '' },
  { label: 'Leaderboard', to: '/colony/leaderboard', icon: 'i-lucide-trophy', badge: '' }
])

const activeTab = computed(() => route.path)

const notifications = computed(() => (lootWaiting.value > 0 ? 1 : 0) + buildersReady.value)
useHead({
  title: computed(() => notifications.value > 0 ? `(${notifications.value}) Colony` : 'Colony')
})

function onTabClick() {
  play('click')
}
</script>

<template>
  <div class="colony-shell colony-bg flex flex-col min-h-full">
    <ColonyFireflies />
    <ColonyFxLayer />

    <!-- ── Game header ─────────────────────────────────────────────────── -->
    <div class="relative z-10 border-b border-default/60 bg-background/60 backdrop-blur-md shrink-0">
      <div class="flex items-center gap-3 px-3 sm:px-4 py-2">
        <NuxtLink
          to="/colony"
          class="flex items-center gap-2 shrink-0 group"
        >
          <ColonyLogo
            :size="36"
            class="transition-transform group-hover:scale-110 group-hover:rotate-6"
          />
          <div class="hidden md:block leading-tight">
            <p class="text-sm colony-title">
              Bug<span class="text-primary">Colony</span>
            </p>
            <p class="text-[10px] text-muted -mt-0.5">
              Forage · Feed · Flourish
            </p>
          </div>
        </NuxtLink>

        <nav class="flex items-center gap-0.5 overflow-x-auto colony-no-scrollbar min-w-0 flex-1">
          <NuxtLink
            v-for="tab in tabs"
            :key="tab.to"
            :to="tab.to"
            class="colony-tab shrink-0"
            :class="activeTab === tab.to ? 'colony-tab-active' : ''"
            @click="onTabClick"
          >
            <UIcon
              :name="tab.icon"
              class="size-4"
            />
            <span class="hidden sm:inline">{{ tab.label }}</span>
            <span
              v-if="tab.badge"
              :key="tab.badge"
              class="colony-tab-badge"
            >{{ tab.badge }}</span>
          </NuxtLink>
        </nav>

        <!-- Live readouts -->
        <div
          v-if="initialized"
          class="hidden lg:flex items-center gap-2 shrink-0"
        >
          <UTooltip :text="`Colony income: ${formatNumber(coinsPerHour, false)} coins / hour`">
            <div class="colony-chip colony-chip-amber">
              <UIcon
                name="i-lucide-trending-up"
                class="size-3"
              />
              +{{ formatNumber(coinsPerHour) }}/h
            </div>
          </UTooltip>
          <UTooltip :text="starving ? 'Colony is starving!' : `Nutrition ${nutritionPct}%`">
            <div
              class="colony-chip"
              :class="starving ? 'colony-chip-bad colony-shake' : nutritionPct < 25 ? 'colony-chip-amber' : 'colony-chip-ok'"
            >
              <UIcon
                :name="starving ? 'i-lucide-skull' : 'i-lucide-leaf'"
                class="size-3"
              />
              {{ nutritionPct }}%
            </div>
          </UTooltip>
          <div class="colony-chip">
            <UIcon
              name="i-lucide-coins"
              class="size-3 text-yellow-400"
            />
            {{ formatNumber(balance) }}
          </div>
          <div class="colony-chip">
            <UIcon
              name="i-lucide-gem"
              class="size-3 text-info"
            />
            {{ formatNumber(gems, false) }}
          </div>
        </div>

        <ColonySoundToggle class="shrink-0" />
      </div>
    </div>

    <div class="relative z-10 pb-12">
      <NuxtPage />
    </div>
  </div>
</template>
