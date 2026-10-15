<script setup lang="ts">
import {
    PASSIVE_BAND_MAGNITUDE,
    PASSIVE_ENDLESS_BASE_COST,
    PASSIVE_ENDLESS_COST_STEP,
    PASSIVE_NODE_MAX_LEVEL,
    PASSIVE_POINTS_PER_LEVEL,
    PASSIVE_RESPEC_GEMS,
    PASSIVE_TIER_COST
} from '#shared/utils/hero-quest/constants'
import { ARCHETYPE_DEFINITIONS } from '#shared/utils/hero-quest/content/champions'
import { PASSIVE_NODES, type PassiveNode, type PassivePath } from '#shared/utils/hero-quest/content/passive-tree'
import { passiveNodeSpent } from '#shared/utils/hero-quest/passive-tree'
import type { ModifierKind } from '#shared/utils/hero-quest/modifiers'

/**
 * The Passive Tree screen: the map, the node marks, the two buttons, and every node. The node
 * table is `PASSIVE_NODES`, with each line's step from `PASSIVE_BAND_MAGNITUDE`, the numbers a
 * purchase applies.
 */

/** The letters inside a node's medallion (`tree-scene.ts`), for everything that is not a stat. */
const KIND_TAG: Readonly<Partial<Record<ModifierKind, [tag: string, label: string]>>> = {
    maxHp: ['HP', 'Max HP'],
    critChance: ['CRT', 'Crit chance'],
    critDamage: ['CDM', 'Crit damage'],
    enemyDefShred: ['SHR', 'Enemy DEF ignored'],
    damageTaken: ['ARM', 'Damage taken'],
    gold: ['GLD', 'Gold'],
    xp: ['XP', 'XP'],
    offlineEfficiency: ['OFF', 'Offline gain'],
    cooldown: ['CD', 'Cooldowns'],
    controlResist: ['RES', 'Control resist'],
    reflect: ['RFL', 'Damage reflected'],
    evasion: ['EVA', 'Evasion'],
    skillDamage: ['SKL', 'Skill damage'],
    basicAttack: ['ATK', 'Basic attack damage']
}

const PATH_LABEL: Readonly<Record<PassivePath, string>> = {
    root: 'Root (gold)',
    warrior: 'Warrior (red)',
    mage: 'Mage (blue)',
    archer: 'Archer (green)'
}

const archetypeName = (id: string) => ARCHETYPE_DEFINITIONS.find(a => a.id === id)?.name ?? id

function reach(node: PassiveNode): string {
    if (node.scope.kind === 'champion') {
        return node.scope.archetype === 'all' ? 'Fielded Champions' : `Fielded ${archetypeName(node.scope.archetype)} Champions`
    }
    return node.pathLocked ? 'Hero, on this path' : 'Hero'
}

const pathGroups = (Object.keys(PATH_LABEL) as PassivePath[]).map(path => ({
    path,
    label: PATH_LABEL[path],
    nodes: PASSIVE_NODES.filter(node => node.path === path).map(node => ({
        id: node.id,
        name: node.name,
        tier: node.endless ? '∞' : String(node.tier ?? 1),
        effect: node.lines.map(line => hqEffectLine(line.kind, line.stat, PASSIVE_BAND_MAGNITUDE[line.band])).join(', '),
        reach: reach(node),
        full: node.endless ? 'No cap' : String(passiveNodeSpent(node, PASSIVE_NODE_MAX_LEVEL))
    }))
}))

const ringPrices = PASSIVE_TIER_COST.map((cost, index) => `ring ${index + 1}: ${cost}`).join(' · ')

const tags = [
    { term: 'PWR, DEF, VIT, SPD, LCK, IMP', text: 'A stat.' },
    ...Object.values(KIND_TAG).flatMap(entry => (entry ? [{ term: entry[0], text: entry[1] }] : []))
]

const shapes = [
    { term: 'Circle', text: 'A node for your Hero.' },
    { term: 'Diamond', text: 'A class-path node: it works only while your Hero\'s class is on that path. Dimmed, with OFF NOW in its panel, when you have levels in it but are on another path.' },
    { term: 'Square', text: 'A Champion node: it reaches only fielded Champions, of one archetype or all.' },
    { term: '∞', text: 'An endless node at the end of each path: no level cap, its own price ladder.' },
    { term: 'Gold ring', text: 'The root, and the endless nodes.', tone: 'text-warning' }
]

const states = [
    { term: 'Grey, dithered', text: 'Locked: buy a level in a node it hangs off first.', tone: 'text-dimmed' },
    { term: 'Coloured rim', text: 'Open, no levels yet.' },
    { term: 'Pulsing ring', text: 'You can buy a level now.' },
    { term: 'Filled', text: 'Holds levels. The number under it is its level, out of the cap.' },
    { term: 'Gold rim', text: 'Maxed.', tone: 'text-warning' },
    { term: 'White ring', text: 'The node you selected.' }
]

const buttons = [
    { term: 'A node', text: 'Selects it. The panel at the bottom shows its name, level, who it reaches, and what a level adds next to what it adds now.' },
    { term: 'Buy n', text: 'Buys one level of the selected node for n points. Reads MAXED or LOCKED when it cannot.', tone: 'text-success' },
    { term: 'Respec', text: `Refunds every point. Free once after each prestige (it does not stack), otherwise ${PASSIVE_RESPEC_GEMS} Gems. Asks for a second press (Settings, Tree respec).`, tone: 'text-error' },
    { term: '−  +  O', text: 'Bottom right: zoom out, zoom in, and back to the root. You can also drag to move and use the wheel or a pinch to zoom.' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <HeroQuestWikiScreenHeader id="tree" />

    <HeroQuestWikiSection
      title="Points"
      icon="i-lucide-circle-plus"
      :lead="`Every Hero level past the first is worth ${PASSIVE_POINTS_PER_LEVEL} point. Levels are never lost, so neither are points.`"
    >
      <p>
        The header shows the points you have left: gold when you have some. The tree is laid out in
        rings around a gold root: Warrior's path runs up, Mage's down to the right and Archer's down
        to the left. A node opens once the node it hangs off holds a level; each path's first node
        opens from the root's ring either side of it. A prestige does not reset the tree.
      </p>
      <div class="grid gap-2 sm:grid-cols-2">
        <HeroQuestWikiFormula
          label="Level L costs ring price × L"
          :formula="ringPrices"
          :note="`Rings count outward from the root. Every node but the endless ones stops at level ${PASSIVE_NODE_MAX_LEVEL}.`"
        />
        <HeroQuestWikiFormula
          label="Endless nodes"
          :formula="`${PASSIVE_ENDLESS_BASE_COST} + ${PASSIVE_ENDLESS_COST_STEP} × (level − 1)`"
          note="No cap. Spend here once the rest of a path is full."
        />
      </div>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Buttons"
      icon="i-lucide-mouse-pointer-click"
    >
      <HeroQuestWikiKey :items="buttons" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Reading a node"
      icon="i-lucide-eye"
      lead="Its shape says who it is for, its look says whether you can buy it, and its letters say what it raises."
    >
      <HeroQuestWikiKey :items="shapes" />
      <HeroQuestWikiKey :items="states" />
      <HeroQuestWikiKey :items="tags" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Every node"
      icon="i-lucide-list"
      lead="What one level adds. Ring ∞ is endless; Full is the points to max it."
    >
      <div
        v-for="group in pathGroups"
        :key="group.path"
        class="space-y-1"
      >
        <p class="text-xs font-medium text-highlighted">
          {{ group.label }}
        </p>
        <div class="overflow-x-auto">
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="text-muted">
                <th class="text-left font-medium py-1.5 pr-3">
                  Node
                </th>
                <th class="text-right font-medium py-1.5 px-2">
                  Ring
                </th>
                <th class="text-left font-medium py-1.5 px-2">
                  A level
                </th>
                <th class="text-left font-medium py-1.5 px-2">
                  Reaches
                </th>
                <th class="text-right font-medium py-1.5 pl-2">
                  Full
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="node in group.nodes"
                :key="node.id"
                class="border-t border-default"
              >
                <td class="py-1.5 pr-3 text-default font-medium whitespace-nowrap">
                  {{ node.name }}
                </td>
                <td class="py-1.5 px-2 text-right tabular-nums">
                  {{ node.tier }}
                </td>
                <td class="py-1.5 px-2">
                  {{ node.effect }}
                </td>
                <td class="py-1.5 px-2">
                  {{ node.reach }}
                </td>
                <td class="py-1.5 pl-2 text-right tabular-nums whitespace-nowrap">
                  {{ node.full }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </HeroQuestWikiSection>
  </div>
</template>
