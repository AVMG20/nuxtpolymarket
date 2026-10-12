<script setup lang="ts">
import {
    CRAFT_COST_PER_RARITY,
    DUPE_LEVEL_CAP,
    DUPE_LEVEL_FACTOR,
    ESSENCE_VALUE_PER_RARITY,
    LEVELS_PER_STAR,
    MAX_GACHA_LEVEL,
    MAX_STAR,
    RARITY_STAT_MULTIPLIERS,
    SINGLE_PULL_COST,
    TEN_PULL_COST,
    TEN_PULL_SIZE
} from '#shared/utils/hero-quest/constants'
import { RARITIES, totalDupesToMax } from '#shared/utils/hero-quest/gacha'

/**
 * The gacha, the dupe curve, and crafting.
 *
 * Every table here is derived rather than transcribed: the rarity rows come from `RARITIES` and
 * the three per-rarity constant arrays, and the dupe total is computed by the same
 * `totalDupesToMax` the game uses. Nothing on this page can disagree with the game.
 */

const rarityRows = computed(() => RARITIES.map((rarity, index) => ({
    rarity,
    label: HQ_RARITY_LABEL[index] ?? rarity,
    statMultiplier: RARITY_STAT_MULTIPLIERS[index] ?? 1,
    essenceValue: ESSENCE_VALUE_PER_RARITY[index] ?? 0,
    craftCost: CRAFT_COST_PER_RARITY[index] ?? 0
})))

/** The full climb, computed the same way the engine computes it. */
const dupesToMax = totalDupesToMax()
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <div class="space-y-2">
      <h1 class="text-xl font-semibold text-highlighted">
        Gacha and collections
      </h1>
      <p class="text-sm text-muted">
        Four gachas, one set of rules. Learn it once.
      </p>
    </div>

    <HeroQuestWikiSection
      title="Four systems, deliberately identical"
      icon="i-lucide-dices"
    >
      <p>
        Gear, Champions, Skills and Artifacts each have their own Seals, their own Essence and
        their own level — but the rarity ladder, drop table, duplicate curve and crafting rules
        are the same in all four. There is nothing extra to learn when you open a new one.
      </p>
      <p>
        There is <strong class="text-default">no pity counter</strong>, and that is not an
        oversight. Duplicates are the progression: they level the copy you already own, and once
        it is maxed they convert to Essence you can spend on exactly the item you wanted. A bad
        streak is slower, never wasted.
      </p>
      <HeroQuestWikiFormula
        label="Pull cost"
        :formula="`1 pull = ${SINGLE_PULL_COST} Seal · ${TEN_PULL_SIZE}-pull = ${TEN_PULL_COST} Seals`"
        :note="`The ${TEN_PULL_SIZE}-pull is a genuine discount, and it still advances your gacha level by ${TEN_PULL_SIZE} — levels count pulls made, not Seals spent.`"
      />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Rarity"
      icon="i-lucide-gem"
      :lead="`Six tiers. A Mythic is worth ${RARITY_STAT_MULTIPLIERS[RARITIES.length - 1]}× a Common of the same thing.`"
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Rarity
              </th>
              <th class="text-right font-medium py-1.5 px-3">
                Stat ×
              </th>
              <th class="text-right font-medium py-1.5 px-3 whitespace-nowrap">
                Dupe → Essence
              </th>
              <th class="text-right font-medium py-1.5 pl-3 whitespace-nowrap">
                Craft cost
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rarityRows"
              :key="row.rarity"
              class="border-t border-default"
            >
              <td
                class="py-1.5 pr-3 font-medium"
                :class="hqRarityClass(row.rarity)"
              >
                {{ row.label }}
              </td>
              <td class="py-1.5 px-3 text-right tabular-nums">
                {{ row.statMultiplier.toFixed(2) }}
              </td>
              <td class="py-1.5 px-3 text-right tabular-nums">
                {{ row.essenceValue.toLocaleString('en-US') }}
              </td>
              <td class="py-1.5 pl-3 text-right tabular-nums">
                {{ row.craftCost.toLocaleString('en-US') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Both Essence columns climb five-fold per tier, which means a maxed Mythic's duplicates are
        worth a great deal — but crafting one costs five times what the tier below does. Essence
        never crosses between gachas.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Gacha level"
      icon="i-lucide-trending-up"
      :lead="`1 to ${MAX_GACHA_LEVEL}, per gacha, and it only ever goes up.`"
    >
      <p>
        Pulling raises the gacha's level, and the level shifts the whole drop table toward the top
        rarities. It counts <strong class="text-default">pulls, not Seals</strong>, so nothing you
        do can advance it faster or slower than the pulls you make.
      </p>
      <p>
        The exact odds at every level are on the gacha page — tap the
        <UIcon
          name="i-lucide-info"
          class="size-3.5 inline align-middle"
        />
        on any of the four cards.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Duplicates, stars and levels"
      icon="i-lucide-star"
      :lead="`Every copy climbs to ${MAX_STAR}★ Level ${LEVELS_PER_STAR}.`"
    >
      <p>
        A new copy arrives at 0★ Level 1. Duplicates bank toward the next level; ten levels make a
        star; the star resets the level and the climb continues. One number describes how far a
        copy has come — <strong class="text-default">star × 10 + level</strong> — and that same
        number is what scales its stats, its effect magnitudes and its passive contribution.
      </p>
      <HeroQuestWikiFormula
        label="Duplicates for the next level"
        :formula="`round(min((star × ${LEVELS_PER_STAR} + level) × ${DUPE_LEVEL_FACTOR}, ${DUPE_LEVEL_CAP}))`"
        :note="`The cost per level rises with investment, then caps at ${DUPE_LEVEL_CAP} — so the late climb is long but not accelerating.`"
      />
      <HeroQuestWikiFormula
        label="Full climb"
        :formula="`${dupesToMax.toLocaleString('en-US')} duplicates, 0★ Lv1 → ${MAX_STAR}★ Lv${LEVELS_PER_STAR}`"
        note="Per item. This is a long-term target, not something to aim at deliberately."
      />
      <p>
        Past the top, duplicates stop being wasted and start being Essence. That conversion is the
        reason there is no pity: a fully maxed collection turns every future pull into crafting
        currency.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Crafting"
      icon="i-lucide-hammer"
      lead="The way past bad luck, and the only one."
    >
      <p>
        Essence buys a specific item outright — no roll involved. It comes from one source only:
        duplicates of a copy you have already maxed. That makes crafting the far end of the
        collection loop rather than a parallel path, and it is why the price rises so steeply with
        rarity.
      </p>
      <p>
        Crafting something you already own levels it instead, so Essence is never dead weight.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Equipping"
      icon="i-lucide-package"
    >
      <p>
        Owning is not the same as equipping, and the four systems differ here:
      </p>
      <ul class="space-y-1.5 list-disc pl-5">
        <li>
          <strong class="text-default">Gear</strong> has six slots, one per stat, all open from
          the start. The first piece you ever get for a slot equips itself; after that, swapping
          is always your call — watch for the <em>Upgrade</em> badge.
        </li>
        <li>
          <strong class="text-default">Champions</strong> fill party slots, which you buy with
          Void Shards. Un-fielded Champions still buff your Hero.
        </li>
        <li>
          <strong class="text-default">Skills</strong> fill skill slots and fire on their own. No
          duplicate slotting — level the one copy instead. An unequipped Passive still gives your
          Hero a small share of its stat bonus.
        </li>
        <li>
          <strong class="text-default">Artifacts</strong> are party-wide passives. Nothing caps
          how many share a category, and there are no set bonuses to chase. An unequipped Artifact
          still gives your Hero a small share of its stat lines.
        </li>
      </ul>
    </HeroQuestWikiSection>
  </div>
</template>
