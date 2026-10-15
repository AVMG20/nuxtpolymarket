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

/** Below lg the menu folds away above the article, and closes once a page is picked. */
const menuOpen = ref(false)
watch(() => route.fullPath, () => {
    menuOpen.value = false
})
</script>

<template>
  <div class="max-w-6xl mx-auto lg:flex lg:gap-2 lg:px-4">
    <aside class="lg:w-56 lg:shrink-0">
      <div class="px-4 pt-4 lg:hidden">
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-menu"
          :trailing-icon="menuOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          @click="menuOpen = !menuOpen"
        >
          Wiki menu
        </UButton>
      </div>
      <div
        class="px-4 pt-3 lg:block lg:px-0 lg:pt-6 lg:sticky lg:top-0 lg:max-h-screen lg:overflow-y-auto lg:pb-6"
        :class="menuOpen ? 'block' : 'hidden'"
      >
        <HeroQuestWikiNav />
      </div>
    </aside>

    <div class="flex-1 min-w-0">
      <NuxtPage />
    </div>
  </div>
</template>
