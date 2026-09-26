<script setup lang="ts">
import { ARTIFACTS, ARTIFACT_CATEGORY_NAME, ARTIFACT_EFFECT_POOL } from '#shared/utils/hero-quest/content/artifacts'
import { CHAMPIONS, ARCHETYPE_BY_ID, championDisplayName } from '#shared/utils/hero-quest/content/champions'
import { CLASS_NODES, CLASS_BY_ID } from '#shared/utils/hero-quest/content/classes'
import { GEAR, GEAR_SLOT_NAME } from '#shared/utils/hero-quest/content/gear'
import { SKILLS } from '#shared/utils/hero-quest/content/skills'
import { WORLDS } from '#shared/utils/hero-quest/content/worlds'

/**
 * The reference half of the wiki — **generated, not written.**
 *
 * Every table below is a `v-for` over the content module the game itself rolls against. Nothing
 * here is transcribed, so a roster edit updates this page and there is no second copy to forget.
 * That is the entire reason this page exists as code rather than as a markdown doc: rosters still
 * change.
 *
 * One roster at a time. Rendering all 200-odd entries at once is a page nobody scrolls, and the
 * chips double as the table of contents.
 */

type RosterKey = 'classes' | 'champions' | 'skills' | 'gear' | 'artifacts' | 'effects' | 'worlds'

const rosters: readonly { key: RosterKey; label: string; count: number }[] = [
    { key: 'classes', label: 'Classes', count: CLASS_NODES.length },
    { key: 'champions', label: 'Champions', count: CHAMPIONS.length },
    { key: 'skills', label: 'Skills', count: SKILLS.length },
    { key: 'gear', label: 'Gear', count: GEAR.length },
    { key: 'artifacts', label: 'Artifacts', count: ARTIFACTS.length },
    { key: 'effects', label: 'Artifact effects', count: Object.values(ARTIFACT_EFFECT_POOL).flat().length },
    { key: 'worlds', label: 'Worlds', count: WORLDS.length }
]

const active = ref<RosterKey>('classes')

/** Rarity low→high, matching the collection grids, so the two read the same way. */
function byRarity<T extends { rarity: string; name: string }>(entries: readonly T[]): T[] {
    return [...entries].sort((a, b) =>
        hqRarityRank(a.rarity) - hqRarityRank(b.rarity) || a.name.localeCompare(b.name))
}

const champions = computed(() => byRarity(
    CHAMPIONS.map(entry => ({ ...entry, name: championDisplayName(entry) }))
))
const skills = computed(() => byRarity(SKILLS))
const gear = computed(() => byRarity(GEAR))
const artifacts = computed(() => byRarity(ARTIFACTS))
const effects = computed(() => Object.values(ARTIFACT_EFFECT_POOL).flat())

/** Root first, then each tier in turn — the shape of the tree, flattened. */
const classes = computed(() => {
    const order = ['beginner', 'base', 'elite', 'master']
    return [...CLASS_NODES].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier))
})

function parentName(parentId: string | null) {
    if (!parentId) return '—'
    return CLASS_BY_ID[parentId as keyof typeof CLASS_BY_ID]?.name ?? parentId
}
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
    <div class="space-y-2">
      <h1 class="text-xl font-semibold text-highlighted">
        Content reference
      </h1>
      <p class="text-sm text-muted">
        Everything in the game, listed straight from the game's own content. If it is here, it
        exists; if it changes, this changes with it.
      </p>
    </div>

    <div class="flex flex-wrap gap-1">
      <UButton
        v-for="roster in rosters"
        :key="roster.key"
        size="xs"
        :variant="active === roster.key ? 'solid' : 'ghost'"
        :color="active === roster.key ? 'primary' : 'neutral'"
        @click="active = roster.key"
      >
        {{ roster.label }}
        <span class="opacity-60">{{ roster.count }}</span>
      </UButton>
    </div>

    <!-- Classes -->
    <div
      v-if="active === 'classes'"
      class="overflow-x-auto"
    >
      <table class="w-full text-xs border-collapse">
        <thead>
          <tr class="text-muted">
            <th class="text-left font-medium py-1.5 pr-3">
              Class
            </th>
            <th class="text-left font-medium py-1.5 px-3">
              Tier
            </th>
            <th class="text-left font-medium py-1.5 px-3">
              From
            </th>
            <th class="text-left font-medium py-1.5 px-3">
              Skill
            </th>
            <th class="text-right font-medium py-1.5 pl-3 whitespace-nowrap">
              Strikes
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="node in classes"
            :key="node.id"
            class="border-t border-default"
          >
            <td class="py-1.5 pr-3 text-default font-medium whitespace-nowrap">
              {{ node.name }}
            </td>
            <td class="py-1.5 px-3 capitalize text-muted">
              {{ node.tier }}
            </td>
            <td class="py-1.5 px-3 text-muted whitespace-nowrap">
              {{ parentName(node.parentId) }}
            </td>
            <td class="py-1.5 px-3 text-muted">
              {{ node.skill.name }}
              <span class="opacity-60">· {{ node.skill.cooldownSeconds }}s · ×{{ node.skill.abilityMultiplier }}</span>
            </td>
            <td class="py-1.5 pl-3 text-right tabular-nums text-muted">
              {{ node.strikesPerAttack }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Champions -->
    <div
      v-else-if="active === 'champions'"
      class="overflow-x-auto"
    >
      <table class="w-full text-xs border-collapse">
        <thead>
          <tr class="text-muted">
            <th class="text-left font-medium py-1.5 pr-3">
              Champion
            </th>
            <th class="text-left font-medium py-1.5 px-3">
              Archetype
            </th>
            <th class="text-left font-medium py-1.5 pl-3">
              Abilities
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in champions"
            :key="entry.id"
            class="border-t border-default"
          >
            <td
              class="py-1.5 pr-3 font-medium"
              :class="hqRarityClass(entry.rarity)"
            >
              {{ entry.name }}
            </td>
            <td class="py-1.5 px-3 text-muted whitespace-nowrap">
              {{ ARCHETYPE_BY_ID[entry.archetype].name }}
            </td>
            <td class="py-1.5 pl-3 text-muted">
              {{ entry.abilities.map(a => a.name).join(' · ') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Skills -->
    <div
      v-else-if="active === 'skills'"
      class="overflow-x-auto"
    >
      <table class="w-full text-xs border-collapse">
        <thead>
          <tr class="text-muted">
            <th class="text-left font-medium py-1.5 pr-3">
              Skill
            </th>
            <th class="text-left font-medium py-1.5 px-3">
              Type
            </th>
            <th class="text-left font-medium py-1.5 pl-3">
              Effect
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in skills"
            :key="entry.id"
            class="border-t border-default"
          >
            <td
              class="py-1.5 pr-3 font-medium whitespace-nowrap"
              :class="hqRarityClass(entry.rarity)"
            >
              {{ entry.name }}
            </td>
            <td class="py-1.5 px-3 text-muted capitalize whitespace-nowrap">
              {{ entry.type }}
              <span
                v-if="entry.cooldownSeconds"
                class="opacity-60"
              >· {{ entry.cooldownSeconds }}s</span>
            </td>
            <td class="py-1.5 pl-3 text-muted">
              {{ entry.lines.join(' · ') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Gear -->
    <div
      v-else-if="active === 'gear'"
      class="overflow-x-auto"
    >
      <table class="w-full text-xs border-collapse">
        <thead>
          <tr class="text-muted">
            <th class="text-left font-medium py-1.5 pr-3">
              Piece
            </th>
            <th class="text-left font-medium py-1.5 px-3">
              Slot
            </th>
            <th class="text-left font-medium py-1.5 pl-3">
              Stat
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in gear"
            :key="entry.id"
            class="border-t border-default"
          >
            <td
              class="py-1.5 pr-3 font-medium"
              :class="hqRarityClass(entry.rarity)"
            >
              {{ entry.name }}
            </td>
            <td class="py-1.5 px-3 text-muted">
              {{ GEAR_SLOT_NAME[entry.slot] }}
            </td>
            <td class="py-1.5 pl-3 text-muted uppercase">
              {{ entry.stat }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Artifacts -->
    <div
      v-else-if="active === 'artifacts'"
      class="overflow-x-auto"
    >
      <table class="w-full text-xs border-collapse">
        <thead>
          <tr class="text-muted">
            <th class="text-left font-medium py-1.5 pr-3">
              Artifact
            </th>
            <th class="text-left font-medium py-1.5 px-3">
              Category
            </th>
            <th class="text-left font-medium py-1.5 pl-3">
              Effects
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in artifacts"
            :key="entry.id"
            class="border-t border-default"
          >
            <td
              class="py-1.5 pr-3 font-medium whitespace-nowrap"
              :class="hqRarityClass(entry.rarity)"
            >
              {{ entry.name }}
            </td>
            <td class="py-1.5 px-3 text-muted whitespace-nowrap">
              {{ ARTIFACT_CATEGORY_NAME[entry.category] }}
            </td>
            <td class="py-1.5 pl-3 text-muted">
              {{ entry.effects.map(effect => effect.name).join(' · ') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Artifact effect pool -->
    <div
      v-else-if="active === 'effects'"
      class="overflow-x-auto"
    >
      <table class="w-full text-xs border-collapse">
        <thead>
          <tr class="text-muted">
            <th class="text-left font-medium py-1.5 pr-3">
              Effect
            </th>
            <th class="text-left font-medium py-1.5 px-3">
              Category
            </th>
            <th class="text-left font-medium py-1.5 pl-3">
              What it does
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="effect in effects"
            :key="effect.id"
            class="border-t border-default"
          >
            <td class="py-1.5 pr-3 text-default font-medium whitespace-nowrap">
              {{ effect.name }}
            </td>
            <td class="py-1.5 px-3 text-muted whitespace-nowrap">
              {{ ARTIFACT_CATEGORY_NAME[effect.category] }}
            </td>
            <td class="py-1.5 pl-3 text-muted">
              {{ effect.shape }}
              <span
                v-if="effect.note"
                class="opacity-60"
              >— {{ effect.note }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Worlds -->
    <div
      v-else
      class="overflow-x-auto"
    >
      <table class="w-full text-xs border-collapse">
        <thead>
          <tr class="text-muted">
            <th class="text-left font-medium py-1.5 pr-3">
              World
            </th>
            <th class="text-left font-medium py-1.5 px-3">
              Enemies
            </th>
            <th class="text-left font-medium py-1.5 px-3">
              Boss
            </th>
            <th class="text-left font-medium py-1.5 pl-3">
              Super boss
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="world in WORLDS"
            :key="world.id"
            class="border-t border-default"
          >
            <td class="py-1.5 pr-3 align-top">
              <div class="text-default font-medium whitespace-nowrap">
                {{ world.name }}
              </div>
              <div class="text-muted max-w-xs">
                {{ world.theme }}
              </div>
            </td>
            <td class="py-1.5 px-3 align-top">
              <div class="text-default">
                {{ world.hordeName }}
              </div>
              <div class="text-muted max-w-xs">
                {{ Object.values(world.roster).join(', ') }}
              </div>
            </td>
            <td class="py-1.5 px-3 text-muted">
              {{ world.bossName }}
            </td>
            <td class="py-1.5 pl-3 text-muted">
              {{ world.superBossName }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
