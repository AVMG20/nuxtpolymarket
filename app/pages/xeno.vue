<script setup lang="ts">
import '~/assets/css/xeno.css'
import { isDone } from '~/lib/xeno-format'

const route = useRoute()
const { gridSlots, breederSlots, state } = useXeno()
const { user } = useAuth()
const { unlock } = useXenoSound()

const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)

// Shared clock so the ready badges on the nav tick even on pages that don't
// render the grid themselves.
const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => { now.value = Date.now() }, 1000)
  onUnmounted(() => clearInterval(t))
  // Browsers only start audio from a user gesture — warm the context on the
  // first interaction anywhere in the game so the first harvest cue lands.
  window.addEventListener('pointerdown', unlock, { once: true, passive: true })
})

const readyGrid = computed(() => {
  void now.value
  return (gridSlots.value as any[]).filter(s => s.plant && isDone(s.plant.completesAt)).length
})
const readyBreeder = computed(() => {
  void now.value
  return (breederSlots.value as any[]).filter(s => s.startedAt && !s.collected && s.completesAt && isDone(s.completesAt)).length
})

const tabs = computed(() => [
  { label: 'Garden', to: '/xeno', icon: 'i-lucide-sprout', badge: readyGrid.value },
  { label: 'Breeder', to: '/xeno/breeder', icon: 'i-lucide-dna', badge: readyBreeder.value },
  { label: 'Market', to: '/xeno/market', icon: 'i-lucide-store', badge: 0 },
  { label: 'Artifacts', to: '/xeno/artifacts', icon: 'i-lucide-gem', badge: 0 },
  { label: 'Xenopedia', to: '/xeno/encyclopedia', icon: 'i-lucide-book-open', badge: 0 },
  { label: 'Leaderboard', to: '/xeno/leaderboard', icon: 'i-lucide-trophy', badge: 0 },
])

const activeTab = computed(() => route.path)

// Surface the ready count in the tab title so an idle player sees it from
// another tab without switching back.
const totalReady = computed(() => readyGrid.value + readyBreeder.value)
useHead({
  title: computed(() => totalReady.value > 0 ? `(${totalReady.value}) Xeno Garden` : 'Xeno Garden'),
})

const slotsUnlocked = computed(() => state.value?.grid?.unlockedCount ?? 0)
const slotsMax = computed(() => state.value?.grid?.maxSlots ?? 36)
</script>

<template>
  <div class="xeno-shell xeno-bg flex flex-col min-h-full">
    <XenoSporeField />

    <!-- ── Game header ─────────────────────────────────────────────────── -->
    <div class="relative z-10 border-b border-default/60 bg-background/60 backdrop-blur-md shrink-0">
      <div class="flex items-center gap-3 px-3 sm:px-4 py-2">
        <NuxtLink to="/xeno" class="flex items-center gap-2 shrink-0 group">
          <XenoLogo :size="34" class="transition-transform group-hover:scale-110" />
          <div class="hidden md:block leading-tight">
            <p class="text-sm font-black tracking-tight">Xeno<span class="text-primary">Garden</span></p>
            <p class="text-[10px] text-muted -mt-0.5">Grow · Breed · Evolve</p>
          </div>
        </NuxtLink>

        <nav class="flex items-center gap-0.5 overflow-x-auto no-scrollbar min-w-0 flex-1">
          <NuxtLink
            v-for="tab in tabs"
            :key="tab.to"
            :to="tab.to"
            class="xeno-tab shrink-0"
            :class="activeTab === tab.to ? 'xeno-tab-active' : ''"
          >
            <UIcon :name="tab.icon" class="size-4" />
            <span class="hidden sm:inline">{{ tab.label }}</span>
            <span v-if="tab.badge" :key="tab.badge" class="xeno-tab-badge">{{ tab.badge }}</span>
          </NuxtLink>
        </nav>

        <div class="flex items-center gap-2 shrink-0">
          <div v-if="state?.initialized" class="hidden lg:flex items-center gap-1.5 rounded-full border border-default/60 bg-elevated/50 px-2.5 py-1 text-xs text-muted">
            <UIcon name="i-lucide-layout-grid" class="size-3.5" />
            <span class="tabular-nums"><span class="font-bold text-default">{{ slotsUnlocked }}</span>/{{ slotsMax }}</span>
          </div>
          <div class="hidden sm:flex items-center gap-2 rounded-full border border-default/60 bg-elevated/50 px-3 py-1 text-xs font-semibold">
            <CoinBalance :value="balance" />
            <span class="h-3 w-px bg-default/60" />
            <GemBalance :value="gems" />
          </div>
          <XenoSoundToggle />
        </div>
      </div>
    </div>

    <div class="relative z-10 pb-12">
      <NuxtPage />
    </div>
  </div>
</template>

<style scoped>
.no-scrollbar { scrollbar-width: none; }
.no-scrollbar::-webkit-scrollbar { display: none; }
</style>
