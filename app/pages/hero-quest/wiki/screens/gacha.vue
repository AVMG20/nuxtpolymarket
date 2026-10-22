<script setup lang="ts">
import {
    FREE_PULLS_PER_DAY,
    FREE_PULL_COOLDOWN_MINUTES,
    HUNDRED_PULL_COST,
    HUNDRED_PULL_SIZE,
    MAX_GACHA_LEVEL,
    SEAL_LADDER_BASE_GOLD,
    SINGLE_PULL_COST,
    TEN_PULL_COST,
    TEN_PULL_SIZE
} from '#shared/utils/hero-quest/constants'
import { GACHA_SYSTEMS, RARITIES, dropRatesFor, pullsToNextLevel, type GachaSystem } from '#shared/utils/hero-quest/gacha'

/**
 * The Gacha screen: its four banners, their buttons, the odds and the reveal. The odds table is
 * `dropRatesFor`, the function a pull rolls against.
 */

const { fmt } = useHqNotation()

/** The names over the banners (`gacha-scene.ts`), and what each pays out. */
const BANNER: Readonly<Record<GachaSystem, { name: string, pays: string }>> = {
    gear: { name: 'Forge', pays: 'Gear' },
    champion: { name: 'Guild', pays: 'Champions' },
    skill: { name: 'Training', pays: 'Skills' },
    artifact: { name: 'Dig Site', pays: 'Artifacts' }
}

const banners = GACHA_SYSTEMS.map(system => ({
    system,
    ...BANNER[system],
    seal: hqSealName(system)
}))

const percent = (value: number) => (value > 0 ? `${Number(value.toFixed(2))}%` : '–')

const levelRows = Array.from({ length: MAX_GACHA_LEVEL }, (_, index) => {
    const level = index + 1
    return { level, next: pullsToNextLevel(level), rates: dropRatesFor(level).map(percent) }
})

const freeLabel = `Free ${TEN_PULL_SIZE}`
const tenLabel = `Pull ${TEN_PULL_COST} +${TEN_PULL_SIZE - TEN_PULL_COST}`
const hundredLabel = `Pull ${HUNDRED_PULL_COST} +${HUNDRED_PULL_SIZE - HUNDRED_PULL_COST}`

const buttons = [
    {
        term: freeLabel,
        text: `A free ${TEN_PULL_SIZE}-pull: ${FREE_PULLS_PER_DAY} a day for each banner, at least ${FREE_PULL_COOLDOWN_MINUTES} minutes apart. While it waits the button counts down to the next one; once the day's are used it counts to midnight UTC. The pips beside it are the free pulls left today.`,
        tone: 'text-warning'
    },
    {
        term: 'Pull 1',
        text: `One pull for ${SINGLE_PULL_COST} Seal. The line under it is the price.`,
        tone: 'text-success'
    },
    {
        term: tenLabel,
        text: `${TEN_PULL_SIZE} pulls for ${TEN_PULL_COST} Seals: the last one is free. It raises the gacha's level by ${TEN_PULL_SIZE}, the same as ${TEN_PULL_SIZE} single pulls.`,
        tone: 'text-success'
    },
    {
        term: hundredLabel,
        text: `${HUNDRED_PULL_SIZE} pulls for ${HUNDRED_PULL_COST} Seals in one press, the price of ${HUNDRED_PULL_SIZE / TEN_PULL_SIZE} ${TEN_PULL_SIZE}-pulls. It takes Pull 1's place once a banner holds ${HUNDRED_PULL_COST} Seals, and never buys Seals with Gold.`,
        tone: 'text-success'
    },
    {
        term: 'Confirm',
        text: 'A pull that needs Gold asks for a second press first: the button turns gold. Settings, Gold pulls, turns this off.',
        tone: 'text-warning'
    }
]

const reveal = [
    { term: '?', text: 'A card still face down. Press once to turn them all over, and again to close the board.' },
    { term: 'Scrolling box', text: `A ${HUNDRED_PULL_SIZE}-pull deals into a box that scrolls to follow the deal. Scroll it with the wheel or a finger to look back; press to close.` },
    { term: 'NEW', text: 'Your first copy of this item.', tone: 'text-success' },
    { term: 'LV n', text: 'A duplicate: the copy you own has levelled, and this is its level within its current star.' },
    { term: '+n', text: 'A duplicate of a copy that was already maxed, turned into this much Essence.', tone: 'text-primary' },
    { term: 'Flash and banner', text: 'Rare and better flash as they turn. A Legendary gets a banner and a shake; a Mythic arrives on a red card back, holds the deal and bursts.' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <HeroQuestWikiScreenHeader id="gacha" />

    <HeroQuestWikiSection
      title="Four banners"
      icon="i-lucide-flag"
      lead="One per gacha, each with its own Seals, level and Essence."
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Banner
              </th>
              <th class="text-left font-medium py-1.5 px-3">
                Pays out
              </th>
              <th class="text-left font-medium py-1.5 pl-3">
                Paid in
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="banner in banners"
              :key="banner.system"
              class="border-t border-default"
            >
              <td class="py-1.5 pr-3 text-default font-medium">
                {{ banner.name }}
              </td>
              <td class="py-1.5 px-3">
                {{ banner.pays }}
              </td>
              <td class="py-1.5 pl-3">
                {{ banner.seal }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Under each banner's name: <strong class="text-default">LV</strong> with a bar filling
        toward the next gacha level, then the Seal icon and how many of those Seals you hold. Your
        Gold is in the top right.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Buttons"
      icon="i-lucide-mouse-pointer-click"
    >
      <HeroQuestWikiKey :items="buttons" />
      <p>
        The price line shows Seals with a dot in the banner's colour. If you are short, the pull
        still works: the missing Seals are bought with Gold, shown after a
        <strong class="text-default">+</strong> with a coin. Gold-bought Seals start at
        {{ fmt(SEAL_LADDER_BASE_GOLD) }} each and get dearer with every one bought that
        day, on each banner separately, until midnight UTC. A pull you cannot cover is greyed out.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="The odds"
      icon="i-lucide-percent"
      lead="Point at a banner's emblem to see what you own, your Essence, and the odds at its current level."
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Level
              </th>
              <th class="text-right font-medium py-1.5 px-2 whitespace-nowrap">
                Pulls to next
              </th>
              <th
                v-for="(rarity, index) in RARITIES"
                :key="rarity"
                class="text-right font-medium py-1.5 px-2"
                :class="hqRarityClass(rarity)"
              >
                {{ HQ_RARITY_LABEL[index] }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in levelRows"
              :key="row.level"
              class="border-t border-default"
            >
              <td class="py-1.5 pr-3 font-medium text-default">
                {{ row.level }}
              </td>
              <td class="py-1.5 px-2 text-right tabular-nums">
                {{ row.next === null ? 'Max' : row.next.toLocaleString('en-US') }}
              </td>
              <td
                v-for="(rate, index) in row.rates"
                :key="index"
                class="py-1.5 px-2 text-right tabular-nums"
              >
                {{ rate }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        The level counts pulls, free ones included, and never goes down. Rarities, duplicates and
        Essence are explained on the
        <NuxtLink
          to="/hero-quest/wiki/gacha"
          class="text-primary hover:underline"
        >Gacha</NuxtLink>
        page.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="The reveal"
      icon="i-lucide-layers"
      lead="Pulled cards are dealt face down and turn over one by one."
    >
      <HeroQuestWikiKey :items="reveal" />
      <p>
        Settings has <em>Fast pull reveals</em> to turn every card at once, and <em>Reduce
          motion</em> to drop the shakes and flashes. Everything you pull goes straight into
        <NuxtLink
          :to="hqScreenWikiPath('collections')"
          class="text-primary hover:underline"
        >Collections</NuxtLink>.
      </p>
    </HeroQuestWikiSection>
  </div>
</template>
