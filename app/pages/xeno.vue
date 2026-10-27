<script setup lang="ts">
import '~/assets/css/xeno.css'
import { isDone } from '~/lib/xeno-format'

useHead({
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap' }
  ]
})

const route = useRoute()
const { gridSlots, breederSlots } = useXeno()
const { unlock } = useXenoSound()

// Shared clock so the ready counts on the nav tick even on pages that don't
// render the garden themselves.
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
  { label: 'Nursery', to: '/xeno/breeder', icon: 'i-lucide-flower-2', badge: readyBreeder.value },
  { label: 'Market', to: '/xeno/market', icon: 'i-lucide-shopping-bag', badge: 0 },
  { label: 'Artifacts', to: '/xeno/artifacts', icon: 'i-lucide-gem', badge: 0 },
  { label: 'Xenopedia', to: '/xeno/encyclopedia', icon: 'i-lucide-book-open', badge: 0 },
  { label: 'Leaderboard', to: '/xeno/leaderboard', icon: 'i-lucide-trophy', badge: 0 }
])

const activePath = computed(() => route.path.replace(/\/$/, '') || '/xeno')
const dockTabs = computed(() => tabs.value.slice(0, 4))
const moreTabs = computed(() => tabs.value.slice(4))
const moreActive = computed(() => moreTabs.value.some(t => t.to === activePath.value))
const moreItems = computed(() => moreTabs.value.map((t) => {
  const on = t.to === activePath.value
  return { label: t.label, icon: t.icon, to: t.to, active: on, class: on ? 'bg-(--xg-hover) text-(--xg-ink) font-extrabold' : 'text-(--xg-muted)' }
}))
// The menu is teleported out of the shell, so it carries the Xeno scope itself.
const moreUi = { content: 'xeno min-w-44 bg-(--xg-surface) ring-(--xg-edge2) rounded-2xl shadow-(--xg-shadow-lg)', item: 'rounded-xl font-bold', itemLeadingIcon: 'text-current' }

// Surface the ready count in the tab title so an idle player sees it from
// another tab without switching back.
const totalReady = computed(() => readyGrid.value + readyBreeder.value)
useHead({
  title: computed(() => totalReady.value > 0 ? `(${totalReady.value}) Xeno Garden` : 'Xeno Garden')
})
</script>

<template>
  <div class="xeno xg-shell flex flex-col min-h-full">
    <header class="xg-top shrink-0 !px-4 md:!px-6">
      <NuxtLink to="/xeno" class="xg-brand" aria-label="Xeno Garden">
        <XenoLogo :size="28" />
        <span class="xg-h text-lg">Xeno</span>
      </NuxtLink>

      <nav class="xg-tabs hidden md:flex" aria-label="Xeno sections">
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="xg-tab"
          :class="activePath === tab.to ? 'on' : ''"
          :aria-current="activePath === tab.to ? 'page' : undefined"
        >
          <UIcon :name="tab.icon" class="size-4.5" />
          {{ tab.label }}
          <span v-if="tab.badge" class="xg-count go" :aria-label="`${tab.badge} ready`">{{ tab.badge }}</span>
        </NuxtLink>
      </nav>
      <div class="flex-1 md:hidden" />

      <XenoSoundToggle class="shrink-0" />
    </header>

    <div class="relative flex-1 pb-28 md:pb-10">
      <NuxtPage />
    </div>

    <!-- Phone dock: four sections plus More (Xenopedia, Leaderboard). -->
    <nav class="xg-dock md:hidden" aria-label="Xeno sections">
      <NuxtLink
        v-for="tab in dockTabs"
        :key="tab.to"
        :to="tab.to"
        :class="activePath === tab.to ? 'on' : ''"
        :aria-current="activePath === tab.to ? 'page' : undefined"
      >
        <UIcon :name="tab.icon" class="size-5" />
        <span class="truncate max-w-full px-1">{{ tab.label }}</span>
        <span v-if="tab.badge" class="xg-count go">{{ tab.badge }}</span>
      </NuxtLink>
      <UDropdownMenu :items="moreItems" :content="{ side: 'top', align: 'end', sideOffset: 10 }" :ui="moreUi">
        <button type="button" :class="moreActive ? 'on' : ''" aria-label="More sections">
          <UIcon name="i-lucide-ellipsis" class="size-5" />
          <span>More</span>
        </button>
      </UDropdownMenu>
    </nav>
  </div>
</template>
