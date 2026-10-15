<script setup lang="ts">
/**
 * The wiki (session-1 playtest, finding 6).
 *
 * Two halves, on purpose:
 *
 * - **The explainer** — Basics, Combat, Economy, Gacha. Hand-written prose about how the game
 *   works, with every *number* interpolated from `constants.ts` rather than typed out.
 * - **The reference** — Content. Rendered straight from the content modules, so a roster edit
 *   updates it and nobody has to remember to.
 * - **The screens** — one article per menu scene (issue #28): what it is for, what each button does
 *   and what each symbol means. Same rule: numbers from `constants.ts`, prose about shape.
 *
 * That split is the whole design. A hand-maintained wiki over constants that are still being tuned
 * and rosters that are still changing would be wrong within a week; one that is *generated* cannot
 * say anything the code does not.
 *
 * What generation cannot fix is prose that describes a mechanic which later changes shape. So the
 * prose deliberately describes *shape* — "a clamped ratio, not a curve" — and leaves magnitudes
 * to the interpolated formulas.
 */
const route = useRoute()

const tabs = [
    { label: 'Basics', to: '/hero-quest/wiki', icon: 'i-lucide-compass' },
    { label: 'Combat', to: '/hero-quest/wiki/combat', icon: 'i-lucide-swords' },
    { label: 'Economy', to: '/hero-quest/wiki/economy', icon: 'i-lucide-coins' },
    { label: 'Gacha', to: '/hero-quest/wiki/gacha', icon: 'i-lucide-dices' },
    { label: 'Traits', to: '/hero-quest/wiki/traits', icon: 'i-lucide-sparkles' },
    { label: 'Screens', to: '/hero-quest/wiki/screens', icon: 'i-lucide-layout-grid' },
    { label: 'Content', to: '/hero-quest/wiki/content', icon: 'i-lucide-list' }
]

/** The Screens tab stays lit on every article under it. */
function isActive(to: string) {
    return route.path === to || (to === '/hero-quest/wiki/screens' && route.path.startsWith(`${to}/`))
}
</script>

<template>
  <div>
    <div class="px-4 sm:px-6 pt-4">
      <div class="max-w-3xl mx-auto flex flex-wrap gap-1">
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors"
          :class="isActive(tab.to)
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-default text-muted hover:text-default'"
        >
          <UIcon
            :name="tab.icon"
            class="size-3.5"
          />
          {{ tab.label }}
        </NuxtLink>
      </div>
    </div>

    <NuxtPage />
  </div>
</template>
