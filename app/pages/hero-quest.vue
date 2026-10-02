<script setup lang="ts">
const route = useRoute()

useHead({ title: 'Hero Quest' })

/**
 * Six tabs, plus Dev in dev builds.
 *
 * The four per-gacha tabs (Forge / Guild / Training / Dig-site) are **Gacha** and
 * **Collections** since the session-1 playtest (findings 4 and 5). The split is by action rather
 * than by system: every pull button is on one screen, everything you own is on the other. The
 * four names survive as the cards on one and the submenu on the other — this is a navigation
 * change, not a content one.
 *
 * Wiki is the session-1 playtest's finding 6 — a new player had no way to learn what a stat
 * meant without reading the source. Raid, trait and arena belong to Phase 4.
 */
const tabs = [
  { label: 'Battle', to: '/hero-quest', icon: 'i-lucide-swords' },
  { label: 'Gacha', to: '/hero-quest/gacha', icon: 'i-lucide-dices' },
  { label: 'Collections', to: '/hero-quest/collections', icon: 'i-lucide-library' },
  { label: 'Loadouts', to: '/hero-quest/loadouts', icon: 'i-lucide-layout-grid' },
  { label: 'Prestige', to: '/hero-quest/prestige', icon: 'i-lucide-sparkles' },
  { label: 'Wiki', to: '/hero-quest/wiki', icon: 'i-lucide-book-open' },
  // The playtest harness. Dev builds only — the routes behind it 404 in production regardless,
  // so this is the convenience half of a guard whose real half lives on the server.
  ...(import.meta.dev
    ? [
        { label: 'Dev', to: '/hero-quest/dev', icon: 'i-lucide-flask-conical' },
        { label: 'Art', to: '/hero-quest/art', icon: 'i-lucide-palette' }
      ]
    : [])
]

/**
 * Prefix match, not equality — Collections has its own submenu underneath, and the parent tab has
 * to stay lit on `/hero-quest/collections/skills`. Battle is the exception: its path is a prefix
 * of every other tab's, so it only ever matches exactly.
 */
function isActive(to: string) {
  return route.path === to || (to !== '/hero-quest' && route.path.startsWith(`${to}/`))
}

/**
 * The splash stands in front of every tab until the player goes in: Begin with no run, Start once
 * a session has ended (`useHqSession`). Nothing behind it mounts, so no battle plays and no boss
 * engages while it waits. Dev and Art stay reachable: the harness has to work without a run.
 */
const { gate, away, start, begin } = useHqSession()
const { hero, guild } = useHeroQuest()

/** The splash stands the save's party: the Hero's class and the Champions fielded, each on its row. The Beginner alone without one. */
const splashParty = computed(() => {
  const g = guild.value
  if (!hero.value || !g) return { classId: 'class_beginner', heroRow: 'front' as const, champions: [] }
  const rows = new Map(g.roster.map(c => [c.id, c.row]))
  return {
    classId: hero.value.classId,
    heroRow: g.heroRow,
    champions: g.partyChampionIds.flatMap((id) => {
      const row = rows.get(id)
      return row ? [{ id, row }] : []
    })
  }
})
const entering = ref(false)
const devRoute = computed(() => import.meta.dev && /^\/hero-quest\/(dev|art)(\/|$)/.test(route.path))
const showSplash = computed(() => gate.value !== 'open' && !devRoute.value)

async function enter(action: () => Promise<void>) {
  entering.value = true
  try {
    await action()
  } finally {
    entering.value = false
  }
}
</script>

<template>
  <HeroQuestSplash
    v-if="showSplash && gate !== 'open'"
    :mode="gate"
    :away="away"
    :pending="entering"
    :party="splashParty"
    @begin="enter(begin)"
    @start="enter(start)"
  />
  <div
    v-else
    class="flex flex-col min-h-full"
  >
    <div class="border-b border-default px-3 pt-1.75 pb-2 shrink-0">
      <div class="flex items-center gap-0.5">
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-t-lg transition-colors"
          :class="isActive(tab.to)
            ? 'text-highlighted -mb-px'
            : 'text-muted hover:text-default'"
        >
          <UIcon
            :name="tab.icon"
            class="size-4"
          />
          <span class="hidden sm:inline">{{ tab.label }}</span>
        </NuxtLink>
      </div>
    </div>

    <div class="pb-12">
      <NuxtPage />
    </div>
  </div>
</template>
