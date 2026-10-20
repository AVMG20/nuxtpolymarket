<script setup lang="ts">
import {
    BASE_TRAIT_SAVE_SLOTS,
    MAX_TRAIT_SAVE_SLOTS,
    TRAIT_AUTO_ROLL_RESERVE,
    TRAIT_ROLL_BASE_COST,
    TRAIT_ROLL_COST_PER_LOCK,
    TRAIT_SAVE_LOAD_COST,
    TRAIT_SLOT_COUNT
} from '#shared/utils/hero-quest/constants'
import { shopTrackCost } from '#shared/utils/hero-quest/content/shop'
import { TRAIT_GRADES, TRAIT_SETS } from '#shared/utils/hero-quest/content/traits'
import type { TraitGrade } from '#shared/utils/hero-quest/types'

/**
 * The Traits screen: its buttons, the boards, and what the frames and colours mean. The odds, the
 * stat values and the Set tiers are on the Traits page; this article links there rather than
 * repeating them.
 */

/** The colour of a slot's frame at each grade, as the game draws it. */
const GRADE_COLOUR: Readonly<Record<TraitGrade, string>> = {
    F: 'stone grey',
    E: 'brown',
    D: 'olive',
    C: 'dark teal',
    B: 'teal',
    A: 'night blue',
    S: 'gold',
    SS: 'orange',
    SSS: 'purple and pink'
}

/** Auto can be set to stop at C or any grade above it (`traits-scene.ts`). */
const autoGrades = TRAIT_GRADES.slice(TRAIT_GRADES.indexOf('C'))

const grades = TRAIT_GRADES.map(grade => `${grade} ${GRADE_COLOUR[grade]}`).join(', ')

const boardPrices = Array.from({ length: MAX_TRAIT_SAVE_SLOTS - BASE_TRAIT_SAVE_SLOTS }, (_, level) => ({
    board: BASE_TRAIT_SAVE_SLOTS + level + 1,
    gems: shopTrackCost('traitSaveSlots', level)
}))

const maxRoll = TRAIT_ROLL_BASE_COST + (TRAIT_SLOT_COUNT - 1) * TRAIT_ROLL_COST_PER_LOCK

const buttons = [
    { term: 'Roll', text: `Rerolls every slot you have not locked, all at once, for ${TRAIT_ROLL_BASE_COST} Trait Gems plus ${TRAIT_ROLL_COST_PER_LOCK} per locked slot (up to ${maxRoll}). Your first Roll fills all ${TRAIT_SLOT_COUNT}. With every slot locked it reads ALL LOCKED. Press during the spin to skip it.`, tone: 'text-primary' },
    { term: 'Padlock', text: 'Beside each slot. Locks the slot so Rolls leave it alone; press again to unlock. Locking is free, but makes each Roll dearer. Shut and gold when locked, open and grey when not.', tone: 'text-warning' },
    { term: 'Auto', text: `Rolls again and again, at the normal price each time, until any rerolled slot lands at or above the grade on the chip beside it, or the next Roll would leave fewer than ${TRAIT_AUTO_ROLL_RESERVE} Trait Gems, which it keeps so you can load a saved board if the run made yours worse. While it runs the button reads Stop: press it to end after the current batch.`, tone: 'text-success' },
    { term: 'Grade chip', text: `Sets the grade Auto stops at, from ${autoGrades[0]} to ${autoGrades[autoGrades.length - 1]}. The + means that grade or better.` }
]

const boards = [
    { term: 'Save', text: `Stores all ${TRAIT_SLOT_COUNT} slots and their locks on this board, replacing what it held. Needs every slot rolled.`, tone: 'text-info' },
    { term: 'Load', text: 'Replaces your live slots, locks included, with the stored board. The board keeps its copy.', tone: 'text-success' },
    { term: 'Five bars', text: 'The stored slots\' grades, in their colours. EMPTY when nothing is stored.' },
    { term: 'Locked', text: 'A board you have not bought. The next one shows a Buy button with its price in Gems.', tone: 'text-dimmed' }
]

const symbols = [
    { term: 'Slot frame', text: `Coloured by grade, the letters on its left tab: ${grades}.` },
    { term: 'Frame trim', text: 'Gets richer as the grade climbs: corner studs from D, cut gems from A, more ornaments at S, SS and SSS.' },
    { term: 'Slot text', text: 'The stat and its bonus, over the Set name in that Set\'s colour.' },
    { term: 'Sets panel', text: 'One row per Set: how many slots carry it, and a box per tier, filled up to the tier you reach. A Set\'s name lights up in its colour once a tier is active.' },
    { term: 'Bottom line', text: 'Explains whatever you point at, including who a stat reaches: the Hero, every Champion or the whole party.' },
    { term: 'Top right', text: 'Your Trait Gems.' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <HeroQuestWikiScreenHeader id="traits" />

    <HeroQuestWikiSection
      title="Slots"
      icon="i-lucide-rows-3"
      :lead="`${TRAIT_SLOT_COUNT} slots, all open, each rolling a stat, a grade and one of ${TRAIT_SETS.length} Sets.`"
    >
      <p>
        Every slot works for your party all the time; there is nothing to equip. The odds, what
        each stat is worth at each grade, and every Set's tiers are on the
        <NuxtLink
          to="/hero-quest/wiki/traits"
          class="text-primary hover:underline"
        >Traits</NuxtLink>
        page.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Buttons"
      icon="i-lucide-mouse-pointer-click"
    >
      <HeroQuestWikiKey :items="buttons" />
      <p>
        After a Roll the bottom line names the best grade A or better that landed.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Saved boards"
      icon="i-lucide-save"
      :lead="`Each Save or Load costs ${TRAIT_SAVE_LOAD_COST} Trait Gems.`"
    >
      <HeroQuestWikiKey :items="boards" />
      <div class="flex flex-wrap gap-2">
        <UBadge
          color="neutral"
          variant="subtle"
        >
          {{ BASE_TRAIT_SAVE_SLOTS }} board to start
        </UBadge>
        <UBadge
          v-for="row in boardPrices"
          :key="row.board"
          color="neutral"
          variant="subtle"
        >
          Board {{ row.board }}: {{ row.gems?.toLocaleString('en-US') }} Gems
        </UBadge>
      </div>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="What the screen shows"
      icon="i-lucide-eye"
    >
      <HeroQuestWikiKey :items="symbols" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Second presses"
      icon="i-lucide-shield-check"
    >
      <p>
        Auto, Load, buying a board, and saving over a stored board each ask for a second press: the
        button turns gold and reads <em>SURE?</em> for a few seconds. Settings, Trait spending,
        turns this off. A plain Roll never asks.
      </p>
      <p>
        Trait Gems come from the Shardcaller Beast on the
        <NuxtLink
          :to="hqScreenWikiPath('raids')"
          class="text-primary hover:underline"
        >Raids</NuxtLink>
        screen, and from some login calendar days.
      </p>
    </HeroQuestWikiSection>
  </div>
</template>
