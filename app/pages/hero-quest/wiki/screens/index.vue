<script setup lang="ts">
import { FEATURE_UNLOCKS } from '#shared/utils/hero-quest/constants'
import { featureMenuScene } from '#shared/utils/hero-quest/tutorials'

/**
 * The screens overview: the menu band, button by button, in the order the game draws it, and the
 * order the buttons appear in. Both lists are generated (`HQ_SCREEN_DOCS`, `FEATURE_UNLOCKS`).
 */

/** The unlock schedule in the order the guide announces it, tabs named after the screen they sit in. */
const schedule = FEATURE_UNLOCKS.map(({ feature }) => {
    const scene = featureMenuScene(feature)
    const tab = feature === scene ? null : feature === 'speed' ? 'Battle Speed' : 'Milestones'
    return {
        feature,
        what: tab ? `${tab} (a tab in ${HQ_SCENE_LABELS[scene]})` : HQ_SCENE_LABELS[scene],
        when: hqFeatureUnlockText(feature)
    }
})

const dots = [
    { term: 'Any new screen', text: 'A screen that has opened but you have not visited yet. Battle Speed\'s dot sits on the Shop and the Milestones\' on the Calendar. Always shown.' },
    { term: 'Gacha', text: 'A free pull is ready.' },
    { term: 'Collections', text: 'Something you own can be levelled with the Essence you have, or a piece of Gear beats what its slot wears.' },
    { term: 'Passive Tree', text: 'A node can be bought with the points you have.' },
    { term: 'Calendar', text: 'Today\'s reward is unclaimed, or a Milestone step is waiting.' },
    { term: 'Arena', text: 'A season reward is waiting to be claimed.' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <div class="space-y-2">
      <h1 class="text-xl font-semibold text-highlighted">
        Screens
      </h1>
      <p class="text-sm text-muted">
        Every screen in the game, what it is for, and where its button sits. Pick one for the full
        article: every button and every symbol on it.
      </p>
    </div>

    <HeroQuestWikiSection
      title="The menu band"
      icon="i-lucide-panel-bottom"
      lead="The row of icon buttons along the bottom of the game, left to right."
    >
      <div class="space-y-2">
        <NuxtLink
          v-for="screen in HQ_SCREEN_DOCS"
          :key="screen.id"
          :to="hqScreenWikiPath(screen.id)"
          class="flex gap-3 rounded-lg border border-default bg-elevated/40 p-3 hover:border-primary transition-colors"
        >
          <UIcon
            :name="screen.icon"
            class="size-4 text-primary shrink-0 mt-0.5"
          />
          <div class="min-w-0 space-y-0.5">
            <p class="text-sm font-medium text-highlighted">
              {{ screen.label }}
            </p>
            <p class="text-xs text-muted">
              {{ screen.summary }}
            </p>
            <p class="text-xs text-dimmed">
              {{ screen.button }} {{ hqScreenUnlockText(screen.id) }}
            </p>
          </div>
        </NuxtLink>
      </div>
      <p>
        The buttons carry no text, only their pictures. The screen that is open shows a
        <strong class="text-default">red ×</strong> on its button instead: press it to close the
        screen and go back to the battle. The battle keeps running underneath every screen.
      </p>
      <p>
        During a raid round or an Arena fight the buttons are hidden until the fight is over.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Screens open as you progress"
      icon="i-lucide-lock-open"
      lead="A screen that has not opened yet has no button at all: its place in the row stays empty."
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Screen
              </th>
              <th class="text-left font-medium py-1.5 pl-3">
                Opens
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in schedule"
              :key="row.feature"
              class="border-t border-default"
            >
              <td class="py-1.5 pr-3 text-default font-medium">
                {{ row.what }}
              </td>
              <td class="py-1.5 pl-3">
                {{ row.when }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Worlds count across every run you have made, so they are never lost to a prestige, and
        every button keeps its place: a screen that opens later fills its gap rather than pushing
        the others along. Battle and Settings are always there.
      </p>
      <p>
        With tutorials on, Mossimer the guide introduces each new screen and points at its button,
        and screens that open together appear one at a time. With tutorials off (Settings), every
        open screen shows at once.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Red dots"
      icon="i-lucide-circle-dot"
      lead="A red dot in a button's corner means something is waiting there."
    >
      <HeroQuestWikiKey :items="dots" />
      <p>
        Each kind of dot except the first can be turned off under Settings, Menu dots. The dot is
        never shown on the screen you have open.
      </p>
    </HeroQuestWikiSection>
  </div>
</template>
