<script setup lang="ts">
import {
    TRAIT_GRADE_RATES,
    TRAIT_ROLL_BASE_COST,
    TRAIT_ROLL_COST_PER_LOCK,
    TRAIT_SET_TIERS,
    TRAIT_SLOT_COUNT,
    TRAIT_STAT_VALUES
} from '#shared/utils/hero-quest/constants'
import { TRAIT_GRADES, TRAIT_SETS, TRAIT_STATS, type TraitScope } from '#shared/utils/hero-quest/content/traits'
import type { TraitGrade } from '#shared/utils/hero-quest/types'

/**
 * Traits: the grade odds, every stat at every grade, and every Set's tiers.
 *
 * Generated like the Content page: the rows come from `content/traits.ts` and the numbers from
 * `constants.ts`, the same tables a Roll reads, so a retune shows up here without an edit.
 */

const SCOPE_LABEL: Record<TraitScope, string> = {
    party: 'Whole party',
    hero: 'Hero skills',
    champion: 'Champions'
}

/** Semantic tokens, climbing like the rarity ladder does. */
const GRADE_CLASS: Record<TraitGrade, string> = {
    F: 'text-dimmed',
    E: 'text-muted',
    D: 'text-default',
    C: 'text-success',
    B: 'text-info',
    A: 'text-primary',
    S: 'text-warning',
    SS: 'text-error',
    SSS: 'text-error font-semibold'
}

/** Percent figures, rounded off the float noise a running sum picks up. */
const percent = (value: number) => `${Number(value.toFixed(2))}%`

const gradeRows = computed(() => TRAIT_GRADES.map((grade, index) => ({
    grade,
    chance: percent(TRAIT_GRADE_RATES[grade]),
    orBetter: percent(TRAIT_GRADES.slice(index).reduce((sum, g) => sum + TRAIT_GRADE_RATES[g], 0))
})))

const statRows = computed(() => TRAIT_STATS.map(stat => ({
    id: stat.id,
    name: stat.name,
    scope: SCOPE_LABEL[stat.scope],
    values: TRAIT_GRADES.map(grade => ({ grade, value: `+${hqPercent(TRAIT_STAT_VALUES[stat.id][grade])}` }))
})))

const setRows = computed(() => TRAIT_SETS.map(set => ({
    id: set.id,
    name: set.name,
    tiers: TRAIT_SET_TIERS[set.id].map(tier => ({
        pieces: tier.pieces,
        effect: set.effect.replace('{x}', hqPercent(tier.magnitude))
    }))
})))

const statChance = percent(100 / TRAIT_STATS.length)
const setChance = percent(100 / TRAIT_SETS.length)
const maxRollCost = TRAIT_ROLL_BASE_COST + (TRAIT_SLOT_COUNT - 1) * TRAIT_ROLL_COST_PER_LOCK
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <div class="space-y-2">
      <h1 class="text-xl font-semibold text-highlighted">
        Traits
      </h1>
      <p class="text-sm text-muted">
        {{ TRAIT_SLOT_COUNT }} slots, each a stat, a grade and a Set. Every number a Roll can land on.
      </p>
    </div>

    <HeroQuestWikiSection
      title="Rolling"
      icon="i-lucide-dices"
    >
      <p>
        A Roll rerolls every slot you have not locked, all at once. Each slot rolls three things
        independently: the <strong class="text-default">stat</strong>
        ({{ TRAIT_STATS.length }} of them, {{ statChance }} each), the
        <strong class="text-default">grade</strong> (weighted, below) and the
        <strong class="text-default">Set</strong> ({{ TRAIT_SETS.length }} of them,
        {{ setChance }} each). Locking a slot keeps it as it is, at a price.
      </p>
      <HeroQuestWikiFormula
        label="Roll cost"
        :formula="`${TRAIT_ROLL_BASE_COST} + ${TRAIT_ROLL_COST_PER_LOCK} × locked slots Trait Gems`"
        :note="`${TRAIT_ROLL_BASE_COST} with nothing locked, up to ${maxRollCost} with ${TRAIT_SLOT_COUNT - 1} locked.`"
      />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Grades"
      icon="i-lucide-chart-bar"
      lead="The one weighted roll. The chance is per slot, per Roll."
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Grade
              </th>
              <th class="text-right font-medium py-1.5 px-3">
                Chance
              </th>
              <th class="text-right font-medium py-1.5 pl-3 whitespace-nowrap">
                This or better
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in gradeRows"
              :key="row.grade"
              class="border-t border-default"
            >
              <td
                class="py-1.5 pr-3 font-medium"
                :class="GRADE_CLASS[row.grade]"
              >
                {{ row.grade }}
              </td>
              <td class="py-1.5 px-3 text-right tabular-nums">
                {{ row.chance }}
              </td>
              <td class="py-1.5 pl-3 text-right tabular-nums">
                {{ row.orBetter }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Stats"
      icon="i-lucide-sparkles"
      lead="What each stat adds at each grade."
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Stat
              </th>
              <th
                v-for="grade in TRAIT_GRADES"
                :key="grade"
                class="text-right font-medium py-1.5 px-2"
                :class="GRADE_CLASS[grade]"
              >
                {{ grade }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in statRows"
              :key="row.id"
              class="border-t border-default"
            >
              <td class="py-1.5 pr-3">
                <div class="font-medium text-default whitespace-nowrap">
                  {{ row.name }}
                </div>
                <div class="text-dimmed whitespace-nowrap">
                  {{ row.scope }}
                </div>
              </td>
              <td
                v-for="cell in row.values"
                :key="cell.grade"
                class="py-1.5 px-2 text-right tabular-nums whitespace-nowrap"
              >
                {{ cell.value }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        ATK raises PWR, the one damage stat. Bonuses add rather than multiply: two slots rolling
        the same stat stack, and a Trait's +35% ATK next to an Artifact's +20% PWR is +55%, not
        ×1.62. A Set that raises a stat adds to the same sum.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Sets"
      icon="i-lucide-layers"
      lead="Count the slots carrying a Set. Every Set reaches the whole party."
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Set
              </th>
              <th class="text-right font-medium py-1.5 px-3">
                Pieces
              </th>
              <th class="text-left font-medium py-1.5 pl-3">
                Bonus
              </th>
            </tr>
          </thead>
          <tbody>
            <template
              v-for="set in setRows"
              :key="set.id"
            >
              <tr
                v-for="(tier, index) in set.tiers"
                :key="`${set.id}-${tier.pieces}`"
                :class="index === 0 ? 'border-t border-default' : ''"
              >
                <td class="py-1.5 pr-3 font-medium text-default whitespace-nowrap">
                  {{ index === 0 ? set.name : '' }}
                </td>
                <td class="py-1.5 px-3 text-right tabular-nums">
                  {{ tier.pieces }}
                </td>
                <td class="py-1.5 pl-3">
                  {{ tier.effect }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p>
        A tier is the <strong class="text-default">total</strong> at that many pieces: it replaces
        the tier below rather than adding to it, and the top tier holds if you carry more pieces
        than it needs. A Set's bonus does not depend on the grades of its slots.
      </p>
    </HeroQuestWikiSection>
  </div>
</template>
