<script setup lang="ts">
/**
 * The class tree's route, drawn on the stage as the Classes scene. Any class already reached can
 * be switched to at any time; a class never reached takes the token a prestige grants
 * (`open-items.md` #42).
 */
const { initialized, hero, classTree, classToken, pickClass } = useHeroQuest()

const busy = ref(false)

async function pick(classId: string) {
    busy.value = true
    try {
        await pickClass(classId)
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        busy.value = false
    }
}
</script>

<template>
  <div class="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
    <div
      v-if="!initialized"
      class="text-center py-16 text-muted"
    >
      Start a run first.
    </div>

    <template v-else>
      <div class="flex items-baseline justify-between">
        <p class="text-sm text-muted">
          {{ classToken ? 'A class token is ready: take a class you have not reached yet.' : 'Prestige for a token to take a new class.' }}
        </p>
        <p
          v-if="hero"
          class="text-xs text-muted"
        >
          Level {{ hero.level }} carries across
        </p>
      </div>
      <HeroQuestClassTree
        :nodes="classTree"
        :busy="busy"
        @pick="pick"
      />
    </template>
  </div>
</template>
