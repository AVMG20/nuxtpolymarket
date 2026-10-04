<script setup lang="ts">
import type { HqIntroRect } from '~/composables/useHqIntro'

const route = useRoute()

useHead({ title: 'Hero Quest' })

/**
 * Navigation lives in the stage (`HeroQuestBattleScreen`): its menu band opens Gacha, Collections,
 * Loadouts and Prestige as scenes over the battle, which is what shows when none is open. Each
 * scene keeps its route, and its page renders under the stage until the scene draws it itself.
 *
 * The wiki stays a page of its own, for reading, so it and the dev tools keep a link row here.
 */
const scene = computed(() => hqSceneOf(route.path))

const links = computed(() => [
  // off the stage, the way back onto it
  ...(scene.value ? [] : [{ label: 'Play', to: '/hero-quest', icon: 'i-lucide-swords' }]),
  { label: 'Wiki', to: '/hero-quest/wiki', icon: 'i-lucide-book-open' },
  // The playtest harness. Dev builds only — the routes behind it 404 in production regardless,
  // so this is the convenience half of a guard whose real half lives on the server.
  ...(import.meta.dev
    ? [
        { label: 'Dev', to: '/hero-quest/dev', icon: 'i-lucide-flask-conical' },
        { label: 'Art', to: '/hero-quest/art', icon: 'i-lucide-palette' }
      ]
    : [])
])

function isActive(to: string) {
  return to !== '/hero-quest' && (route.path === to || route.path.startsWith(`${to}/`))
}

function openScene(next: HqScene) {
  void navigateTo(hqScenePath(next))
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

/**
 * The way in opening holds the splash up a moment longer, for its iris to close on the Hero; the
 * battle stage then grows out of its box and opens its own (`useHqIntro`).
 */
const leaving = ref(false)
const showSplash = computed(() => (gate.value !== 'open' || leaving.value) && !devRoute.value)

watch(gate, (now, was) => {
  if (now === 'open' && was !== 'open' && !devRoute.value) leaving.value = true
})

function onLeft(rect: HqIntroRect | null) {
  // the battle stage takes it as it mounts (`takeHqIntro`)
  handOverHqIntro(rect)
  leaving.value = false
}

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
    v-if="showSplash"
    :mode="gate === 'open' ? 'start' : gate"
    :away="away"
    :pending="entering || leaving"
    :party="splashParty"
    :leaving="leaving"
    @begin="enter(begin)"
    @start="enter(start)"
    @left="onLeft"
  />
  <div
    v-else
    class="flex flex-col min-h-full"
  >
    <div class="border-b border-default px-3 pt-1.75 pb-2 shrink-0">
      <div class="flex items-center justify-end gap-0.5">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-t-lg transition-colors"
          :class="isActive(link.to)
            ? 'text-highlighted -mb-px'
            : 'text-muted hover:text-default'"
        >
          <UIcon
            :name="link.icon"
            class="size-4"
          />
          <span class="hidden sm:inline">{{ link.label }}</span>
        </NuxtLink>
      </div>
    </div>

    <div class="pb-12">
      <HeroQuestBattleScreen
        v-if="scene"
        :scene="scene"
        @scene="openScene"
      />
      <NuxtPage />
    </div>
  </div>
</template>
