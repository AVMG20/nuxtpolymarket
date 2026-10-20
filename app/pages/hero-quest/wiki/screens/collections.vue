<script setup lang="ts">
import {
    BASE_ARTIFACT_SLOTS,
    BASE_CHAMPION_SLOTS,
    BASE_SKILL_SLOTS,
    FORMATION_ROW_CAPACITY,
    MAX_ARTIFACT_SLOTS,
    MAX_CHAMPION_SLOTS,
    MAX_SKILL_SLOTS
} from '#shared/utils/hero-quest/constants'
import { GACHA_CONTENT } from '#shared/utils/hero-quest/content/registry'
import { GEAR_SLOTS } from '#shared/utils/hero-quest/content/gear'

/**
 * The Collections screen: the four tabs, the grid, the detail panel and the two equip pickers.
 *
 * Entry descriptions are not quoted here: they are generated from the content modules and shown
 * on the Content page, so this article describes where they sit rather than what they say.
 */

const SYSTEM_OF = { gear: 'gear', champions: 'champion', skills: 'skill', artifacts: 'artifact' } as const

const tabs = HQ_COLLECTION_TABS.map(tab => ({
    tab,
    label: HQ_COLLECTION_TAB_LABELS[tab],
    size: GACHA_CONTENT[SYSTEM_OF[tab]].entries.length
}))

const tiles = [
    { term: 'Coloured rim', text: 'The entry\'s rarity: bright if you own it, dim if not.' },
    { term: '?', text: 'Not found yet. Press it anyway to see its rarity and type.' },
    { term: 'E', text: 'Equipped: a piece of Gear, a Skill or an Artifact you are using.', tone: 'text-warning' },
    { term: 'F', text: 'A fielded Champion, in the front row.', tone: 'text-error' },
    { term: 'B', text: 'A fielded Champion, in the back row.', tone: 'text-info' },
    { term: 'Green arrow', text: 'Gear only: a piece you own that would beat what its slot wears now.', tone: 'text-success' }
]

const detail = [
    { term: 'Picture', text: 'The item (a Champion moves). Under it, COPIES with a green bar: duplicates toward the next level. MAX LEVEL once it can climb no further.' },
    { term: 'Rarity line', text: 'Its rarity, its type, and how far it has come: stars and level.' },
    { term: 'Two sections', text: 'What it gives just by being in your collection, and what it gives when equipped or fielded. A section that applies right now has a gold heading marked ACTIVE.' },
    { term: 'Essence', text: 'Bottom left: this gacha\'s Essence, which Craft spends.' }
]

const buttons = [
    { term: 'Craft', text: 'Spend Essence on this exact item: a first copy if you have none, otherwise one more copy, the same as pulling a duplicate. Hidden once the item is maxed, greyed out when you are short.', tone: 'text-primary' },
    { term: 'Equip (Gear)', text: 'Puts the piece on at once, replacing what its slot wore. A slot is never empty, so there is no unequip: it reads Equipped while worn. Next to it, a green ▲ or red ▼ with a percentage compares it with what you wear.', tone: 'text-success' },
    { term: 'Equip (others)', text: 'Opens a picker for a Champion, a Skill or an Artifact, below.', tone: 'text-success' },
    { term: 'Arrows', text: 'Beside the ×. Step to the previous or next entry of the tab, in grid order, wrapping round at either end. The arrow keys and a sideways swipe do the same. Not while a picker is open.' },
    { term: 'Red ×', text: 'Closes the detail. So does pressing the open tab.', tone: 'text-error' }
]

const champion = [
    { term: '+', text: 'An empty place you can take: fields the Champion in that row, or moves it there.' },
    { term: 'Another Champion', text: 'Replaces that Champion with this one, or swaps their places if this one is already fielded.' },
    { term: 'Your Hero', text: 'Swaps rows with the Hero. Only for a fielded Champion in the other row.' },
    { term: 'Small red ×', text: 'Benches that Champion and keeps the picker open.', tone: 'text-error' },
    { term: 'Bench', text: 'Takes this Champion out of the party.', tone: 'text-error' },
    { term: 'Cancel', text: 'Closes the picker. So does a press outside it.' }
]

const slots = [
    { term: 'Empty slot', text: 'Equips it there.' },
    { term: 'Held slot', text: 'Replaces what is in it, or swaps the two if this one is already equipped.' },
    { term: 'Unequip', text: 'Takes it off.', tone: 'text-error' },
    { term: 'Cancel', text: 'Closes the picker.' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <HeroQuestWikiScreenHeader id="collections" />

    <HeroQuestWikiSection
      title="Tabs and grid"
      icon="i-lucide-layout-grid"
      lead="One tab per gacha. The open tab shows how many you own out of the whole roster."
    >
      <div class="flex flex-wrap gap-2">
        <UBadge
          v-for="tab in tabs"
          :key="tab.tab"
          color="neutral"
          variant="subtle"
        >
          {{ tab.label }}: {{ tab.size }}
        </UBadge>
      </div>
      <p>
        Every entry has a tile, owned or not, sorted from Common to Mythic. Press any tile to open
        its detail.
      </p>
      <HeroQuestWikiKey :items="tiles" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="The detail panel"
      icon="i-lucide-panel-top-open"
    >
      <HeroQuestWikiKey :items="detail" />
      <p>
        An entry you have not found shows <em>???</em> and how to get it: pull it, or craft it from
        Essence. The full roster, with every entry's effects, is on the
        <NuxtLink
          to="/hero-quest/wiki/content"
          class="text-primary hover:underline"
        >Content</NuxtLink>
        page.
      </p>
      <HeroQuestWikiKey :items="buttons" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Placing a Champion"
      icon="i-lucide-users"
      :lead="`Two rows, front and back, ${FORMATION_ROW_CAPACITY} places each. Your Hero takes one place in its row.`"
    >
      <p>
        The picker's title says what you are doing: picking a spot, replacing someone because the
        party is full, or moving a Champion already in it. The Champion you are placing has a gold
        ring; places you cannot use are dimmed.
      </p>
      <HeroQuestWikiKey :items="champion" />
      <p>
        You can field {{ BASE_CHAMPION_SLOTS }} Champions at first, up to
        {{ MAX_CHAMPION_SLOTS }} with Champion Slots from the
        <NuxtLink
          :to="hqScreenWikiPath('shop')"
          class="text-primary hover:underline"
        >Shop</NuxtLink>. What the rows mean in a fight is on the
        <NuxtLink
          to="/hero-quest/wiki/combat"
          class="text-primary hover:underline"
        >Combat</NuxtLink>
        page.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Equipping a Skill or an Artifact"
      icon="i-lucide-sparkles"
      lead="One row of the slots you have, filled ones first."
    >
      <HeroQuestWikiKey :items="slots" />
      <p>
        You start with {{ BASE_SKILL_SLOTS }} Skill slots and {{ BASE_ARTIFACT_SLOTS }} Artifact
        slots; the Shop raises them to {{ MAX_SKILL_SLOTS }} and {{ MAX_ARTIFACT_SLOTS }}. Gear needs no
        slots: there are {{ GEAR_SLOTS.length }}, one per piece, and the first piece you ever get
        for a slot goes on by itself.
      </p>
    </HeroQuestWikiSection>
  </div>
</template>
