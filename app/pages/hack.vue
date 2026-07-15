<script setup lang="ts">
import '~/assets/css/hack.css'

const route = useRoute()
const { user } = useAuth()
const { data: state } = await useFetch('/api/hack/state')

const tabs = [
  { label: 'Ops', to: '/hack', icon: 'i-lucide-terminal' },
  { label: 'Black Market', to: '/hack/market', icon: 'i-lucide-store' },
  { label: 'Agents', to: '/hack/agents', icon: 'i-lucide-users' },
  { label: 'Loadout', to: '/hack/loadout', icon: 'i-lucide-shield-half' },
  { label: 'Items', to: '/hack/items', icon: 'i-lucide-cpu' },
  { label: 'History', to: '/hack/history', icon: 'i-lucide-history' },
  { label: 'Leaderboard', to: '/hack/leaderboard', icon: 'i-lucide-trophy' },
  { label: 'Wiki', to: '/hack/wiki', icon: 'i-lucide-book-open' }
]

// The Ops tab (/hack) stays active on its nested briefing routes (/hack/ops/*).
// The Agents tab stays active on the Upgrade sub-page (/hack/upgrade).
function isActiveTab(to: string) {
  if (to === '/hack') return route.path === '/hack' || route.path.startsWith('/hack/ops')
  if (to === '/hack/agents') return route.path === '/hack/agents' || route.path === '/hack/upgrade'
  return route.path === to
}

// Browsers block autoplay until a user gesture on the page — resume the
// AudioContext on the first one so briefing/reveal VO plays audibly instead
// of silently failing on a cold load. Captions run either way (§5.2).
const audio = useAudio('hack')
onMounted(() => {
  const unlockOnce = () => {
    audio.unlock()
    window.removeEventListener('pointerdown', unlockOnce)
    window.removeEventListener('keydown', unlockOnce)
  }
  window.addEventListener('pointerdown', unlockOnce)
  window.addEventListener('keydown', unlockOnce)
  onUnmounted(() => {
    window.removeEventListener('pointerdown', unlockOnce)
    window.removeEventListener('keydown', unlockOnce)
  })
})
</script>

<template>
  <div
    class="hack-shell flex flex-col min-h-full"
    style="background: var(--hack-bg);"
  >
    <HackRarityDuotone />
    <div class="hack-statbar border-b border-default">
      <div class="flex items-center gap-5 flex-wrap">
        <span class="hack-stat"><span class="hack-dot" />{{ user?.name ?? 'OPERATOR' }}</span>
        <span class="hack-stat hack-stat-hero">
          <UIcon
            name="i-lucide-zap"
            class="size-4"
          />
          <b>{{ formatNumber(state?.totalPower ?? 0, true) }}</b>
        </span>
        <span class="hack-stat">SQUAD <b>{{ state?.agents.length ?? 0 }}/{{ state?.rosterSlots ?? 0 }}</b></span>
      </div>
      <HackAudioSettings />
    </div>

    <div class="hack-tabbar border-b border-default px-4">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="hack-tab"
        :class="isActiveTab(tab.to) && 'active'"
        @click="audio.playSfx('click')"
      >
        <UIcon
          :name="tab.icon"
          class="size-3.5"
        />
        <span class="hidden sm:inline-block">{{ tab.label }}</span>
      </NuxtLink>
    </div>

    <NuxtPage />
  </div>
</template>
