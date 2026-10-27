<script setup lang="ts">
import '~/assets/css/colony.css'

useHead({
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap' }
  ]
})

const route = useRoute()
const { pendingLoot, builders } = useColony()

// Shared clock so the nav badges notice a builder finishing while the player
// sits on another Colony page.
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  clock = setInterval(() => { now.value = Date.now() }, 1000)
})
onUnmounted(() => {
  if (clock) clearInterval(clock)
})

const lootWaiting = computed(() => pendingLoot.value.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0))
const buildersReady = computed(() => builders.value.filter(job => new Date(job.completesAt).getTime() <= now.value).length)

interface ColonyTab {
  label: string
  short: string
  to: string
  icon: string
  badge?: string
  badgeTone?: 'gold' | 'green'
}

const tabs = computed<ColonyTab[]>(() => [
  { label: 'Terrarium', short: 'Terrarium', to: '/colony', icon: 'i-lucide-bug', badge: lootWaiting.value ? formatNumber(lootWaiting.value) : undefined, badgeTone: 'gold' },
  { label: 'Market', short: 'Market', to: '/colony/market', icon: 'i-lucide-store' },
  { label: 'Habitat', short: 'Habitat', to: '/colony/habitat', icon: 'i-lucide-shovel', badge: buildersReady.value ? String(buildersReady.value) : undefined, badgeTone: 'green' },
  { label: 'Research', short: 'Research', to: '/colony/research', icon: 'i-lucide-flask-conical' },
  { label: 'Colonopedia', short: 'Guide', to: '/colony/encyclopedia', icon: 'i-lucide-book-open' },
  { label: 'Leaderboard', short: 'Ranks', to: '/colony/leaderboard', icon: 'i-lucide-trophy' }
])

const phoneTabs = computed(() => tabs.value.slice(0, 4))
const moreTabs = computed(() => tabs.value.slice(4))
const moreActive = computed(() => moreTabs.value.some(tab => tab.to === route.path))
const moreItems = computed(() => moreTabs.value.map(tab => ({ label: tab.label, icon: tab.icon, to: tab.to })))

// Surface waiting loot and finished builders in the browser tab title.
const readyCount = computed(() => (lootWaiting.value ? 1 : 0) + buildersReady.value)
useHead({
  title: computed(() => readyCount.value > 0 ? `(${readyCount.value}) Colony · Polynux` : 'Colony · Polynux')
})
</script>

<template>
  <div class="colony-shell flex flex-col min-h-full">
    <header class="cl-header relative z-20 shrink-0">
      <div class="flex items-center gap-3 px-4 md:px-6 py-2.5">
        <NuxtLink
          to="/colony"
          class="flex items-center gap-2.5 shrink-0"
        >
          <span class="cl-logo-badge">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <g fill="#2a1702"><circle cx="6" cy="12" r="3.2" /><circle cx="11.5" cy="12" r="2.4" /><ellipse cx="17.5" cy="12" rx="4.2" ry="3.4" /></g>
              <g stroke="#2a1702" stroke-width="1.4" stroke-linecap="round" fill="none"><path d="M11 10 9 6M12 10l2-4M11 14l-2 4M12 14l2 4M4.5 9.5 3 7M4.5 9.2 6 6.5" /></g>
            </svg>
          </span>
          <span class="flex flex-col leading-tight">
            <span class="cl-display text-xl font-semibold">Colony</span>
            <span class="text-[11px] font-semibold text-muted hidden md:block">Forage · Feed · Dig deeper</span>
          </span>
        </NuxtLink>

        <nav
          class="hidden sm:flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0 flex-1"
          aria-label="Colony"
        >
          <NuxtLink
            v-for="tab in tabs"
            :key="tab.to"
            :to="tab.to"
            class="cl-tab shrink-0"
            :class="route.path === tab.to ? 'cl-tab-active' : ''"
            :aria-current="route.path === tab.to ? 'page' : undefined"
            :aria-label="tab.badge ? `${tab.label} (${tab.badge})` : tab.label"
          >
            <UIcon
              :name="tab.icon"
              class="cl-tab-icon size-4"
            />
            <span class="hidden md:inline">{{ tab.label }}</span>
            <span
              v-if="tab.badge"
              class="cl-tab-badge"
              :class="tab.badgeTone === 'green' ? 'cl-tab-badge-green' : ''"
            >{{ tab.badge }}</span>
          </NuxtLink>
        </nav>
      </div>
    </header>

    <div class="flex-1 pb-6 sm:pb-12">
      <NuxtPage />
    </div>

    <!-- Phone: game-style bottom nav, the last two tabs fold into "More" -->
    <nav
      class="cl-bottom-nav sm:hidden sticky bottom-0 z-30 grid grid-cols-5 px-1 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      aria-label="Colony"
    >
      <NuxtLink
        v-for="tab in phoneTabs"
        :key="tab.to"
        :to="tab.to"
        class="cl-bottom-tab"
        :class="route.path === tab.to ? 'cl-bottom-tab-active' : ''"
        :aria-current="route.path === tab.to ? 'page' : undefined"
      >
        <UIcon
          :name="tab.icon"
          class="size-5.5"
        />
        {{ tab.short }}
        <span
          v-if="tab.badge"
          class="cl-tab-badge absolute top-0.5 left-1/2 ml-1.5"
          :class="tab.badgeTone === 'green' ? 'cl-tab-badge-green' : ''"
        >{{ tab.badge }}</span>
      </NuxtLink>
      <UDropdownMenu
        :items="moreItems"
        :content="{ side: 'top', align: 'end' }"
        :ui="{ content: 'cl-theme min-w-44' }"
      >
        <button
          type="button"
          class="cl-bottom-tab w-full"
          :class="moreActive ? 'cl-bottom-tab-active' : ''"
        >
          <UIcon
            name="i-lucide-ellipsis"
            class="size-5.5"
          />
          More
        </button>
      </UDropdownMenu>
    </nav>
  </div>
</template>
