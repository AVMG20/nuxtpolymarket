<script setup lang="ts">
import { BASE_LOADOUT_SLOTS, LOADOUT_NAME_MAX_LENGTH, MAX_LOADOUT_SLOTS } from '#shared/utils/hero-quest/constants'
import { shopTrackCost } from '#shared/utils/hero-quest/content/shop'

/**
 * The Loadouts screen: the cards, the detail and its four buttons, and how raids and the Arena
 * use a Loadout. Slot counts and prices come from the constants and the Shop's own price function.
 */

const { fmt } = useHqNotation()

const slotPrices = Array.from({ length: MAX_LOADOUT_SLOTS - BASE_LOADOUT_SLOTS }, (_, level) => ({
    slot: BASE_LOADOUT_SLOTS + level + 1,
    gems: shopTrackCost('loadoutSlots', level)
}))

const cards = [
    { term: 'Locked', text: 'A grey card with a padlock: a slot you have not bought. The next one to buy shows its Gem price; press it to go to the Shop.', tone: 'text-dimmed' },
    { term: 'Empty', text: 'An open slot with nothing saved yet.' },
    { term: 'Saved', text: 'A face per Champion, marked F (front row) or B (back row), then a small square per Skill, Artifact and piece of Gear in its rarity colour. A dash means none.' },
    { term: 'Active', text: 'Gold rim, marked ACTIVE: what you have on right now matches this Loadout.', tone: 'text-warning' },
    { term: 'For ...', text: 'A blue line naming the raid (or how many raids and the Arena) that put this Loadout on when you fight there.', tone: 'text-info' }
]

const buttons = [
    { term: 'Apply', text: 'Puts everything in the Loadout on at once. Free. Greyed out when the slot is empty or already active. Anything you no longer have room for is left off.', tone: 'text-success' },
    { term: 'Save', text: 'Stores what you have on now in this slot, replacing what it held. Free, and works on an empty slot.', tone: 'text-info' },
    { term: 'Rename', text: `Type a new name, up to ${LOADOUT_NAME_MAX_LENGTH} characters. Enter or a press elsewhere keeps it, Escape cancels.` },
    { term: 'Red ×', text: 'Back to the cards.', tone: 'text-error' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <HeroQuestWikiScreenHeader id="loadouts" />

    <HeroQuestWikiSection
      title="What a Loadout holds"
      icon="i-lucide-package"
    >
      <p>
        Your fielded Champions and the row each stands in (your Hero's row too), your equipped
        Skills, Artifacts and Gear, and the Ascendant's picked skills. Not your class. Keep one for
        clearing waves and one for bosses, and swap with a press.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="The cards"
      icon="i-lucide-layout-grid"
      :lead="`The top right shows how many of the ${MAX_LOADOUT_SLOTS} slots you have.`"
    >
      <HeroQuestWikiKey :items="cards" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Inside a Loadout"
      icon="i-lucide-mouse-pointer-click"
      lead="Press an open card to see everything it holds."
    >
      <HeroQuestWikiKey :items="buttons" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Raids and the Arena"
      icon="i-lucide-flag"
      lead="Each raid, and the Arena, can put a Loadout on for you."
    >
      <p>
        Pick it on the
        <NuxtLink
          :to="hqScreenWikiPath('raids')"
          class="text-primary hover:underline"
        >Raids</NuxtLink>
        or
        <NuxtLink
          :to="hqScreenWikiPath('arena')"
          class="text-primary hover:underline"
        >Arena</NuxtLink>
        screen. It goes on when you fight there and your own setup comes back when you leave.
        While it is on, Save stores your own setup, not the borrowed one.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="More slots"
      icon="i-lucide-gem"
      :lead="`${BASE_LOADOUT_SLOTS} to start, bought with Gems in the Shop's Upgrades.`"
    >
      <div class="flex flex-wrap gap-2">
        <UBadge
          v-for="row in slotPrices"
          :key="row.slot"
          color="neutral"
          variant="subtle"
        >
          Slot {{ row.slot }}: {{ row.gems === null ? '' : fmt(row.gems) }} Gems
        </UBadge>
      </div>
    </HeroQuestWikiSection>
  </div>
</template>
