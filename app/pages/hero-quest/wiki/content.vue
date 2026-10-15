<script setup lang="ts">
import { ARTIFACTS, ARTIFACT_CATEGORY_NAME, ARTIFACT_EFFECT_POOL, artifactLineMagnitude } from '#shared/utils/hero-quest/content/artifacts'
import { CHAMPIONS, ARCHETYPE_BY_ID, championDisplayName } from '#shared/utils/hero-quest/content/champions'
import { CLASS_NODES, CLASS_BY_ID } from '#shared/utils/hero-quest/content/classes'
import { GEAR, GEAR_SLOT_NAME, equippedBonus, passiveBonus } from '#shared/utils/hero-quest/content/gear'
import { SKILLS, skillActives, skillPotency } from '#shared/utils/hero-quest/content/skills'
import { WORLDS } from '#shared/utils/hero-quest/content/worlds'
import { BOSS_SPECIALS, type BossSpecialDef } from '#shared/utils/hero-quest/content/boss-specials'
import {
    BOSS_SPECIAL_BURN_FRACTION,
    BOSS_SPECIAL_BURN_SECONDS,
    BOSS_SPECIAL_DEBUFF_MAGNITUDE,
    BOSS_SPECIAL_DEBUFF_SECONDS,
    BOSS_SPECIAL_DRAIN_FRACTION,
    BOSS_SPECIAL_FOCUS_HP_SHARE,
    BOSS_SPECIAL_HEAVY_HP_SHARE,
    BOSS_SPECIAL_SILENCE_SECONDS,
    BOSS_SPECIAL_SPREAD_HP_SHARE,
    BOSS_SPECIAL_STUN_SECONDS,
    BOSS_STAGE,
    LEVELS_PER_STAR,
    MAX_STAR,
    SUPER_BOSS_STAGE
} from '#shared/utils/hero-quest/constants'
import { RARITIES, RARITY_STAT_MULTIPLIER, investmentScalar } from '#shared/utils/hero-quest/gacha'
import { championInvestmentMultiplier, partyUnitStats } from '#shared/utils/hero-quest/stats'
import { ZERO, formatHq, hqNumber } from '#shared/utils/hero-quest/numbers'
import type { ClassId, HqStatKey, Rarity } from '#shared/utils/hero-quest/types'
import type { ModifierKind } from '#shared/utils/hero-quest/modifiers'

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

/**
 * Every number is shown at both ends of a copy's climb, a fresh 0★ Lv1 and a maxed copy, through
 * the same functions the game resolves a copy with.
 */
const FRESH = { star: 0, level: 1 }
const MAXED = { star: MAX_STAR, level: LEVELS_PER_STAR }
const climbLabel = `0★ Lv1 → ${MAX_STAR}★ Lv${LEVELS_PER_STAR}`

function line(kind: ModifierKind, stat: HqStatKey | undefined, low: number, high: number) {
    return `${hqEffectLine(kind, stat, low)} → ${hqEffectLine(kind, stat, high).split(' ').pop()}`
}

/** A Hero of this class at level 1, as the stat pipeline builds it. */
function classStats(classId: ClassId) {
    const unit = partyUnitStats({ classId, heroLevel: 1, heroXp: ZERO, goldBonusPct: 0, offlineEfficiencyLevel: 0, offlineCapLevel: 0 })[0]!
    return `PWR ${formatHq(unit.pwr)} · DEF ${formatHq(unit.def)} · HP ${formatHq(unit.maxHp)} · ${hqNumber(unit.attacksPerSecond)} att/s · crit ${hqPercent(unit.critChance)} ×${hqNumber(unit.critMultiplier.toNumber())}`
}

/** Cooldown and damage multiplier, rounded for reading; a utility ability has no multiplier to show. */
function abilityNumbers(ability: { cooldownSeconds: number, abilityMultiplier: number }) {
    const multiplier = ability.abilityMultiplier > 0 ? ` · ×${hqNumber(ability.abilityMultiplier)}` : ''
    return `· ${Number(ability.cooldownSeconds.toFixed(1))}s${multiplier}`
}

function championStats(rarity: Rarity) {
    const at = (copy: typeof FRESH) => RARITY_STAT_MULTIPLIER[rarity] * championInvestmentMultiplier(investmentScalar(copy.star, copy.level))
    return `×${hqNumber(at(FRESH))} → ×${hqNumber(at(MAXED))}`
}

/** A Passive's lines, or an Active's ability multiplier, fresh → maxed. */
function skillNumbers(id: string) {
    const skill = SKILLS.find(s => s.id === id)!
    if (skill.modifiers?.length) {
        const fresh = skillPotency(FRESH.star, FRESH.level)
        const maxed = skillPotency(MAXED.star, MAXED.level)
        return skill.modifiers.map(m => line(m.kind, m.stat, m.magnitude * fresh, m.magnitude * maxed)).join(' · ')
    }
    const [fresh] = skillActives([{ contentId: id, ...FRESH }])
    const [maxed] = skillActives([{ contentId: id, ...MAXED }])
    return fresh && maxed ? `×${hqNumber(fresh.abilityMultiplier)} → ×${hqNumber(maxed.abilityMultiplier)} damage` : ''
}

function gearNumbers(slot: Parameters<typeof equippedBonus>[0], rarity: Rarity) {
    return {
        equipped: `+${hqPercent(equippedBonus(slot, rarity, FRESH.star, FRESH.level))} → +${hqPercent(equippedBonus(slot, rarity, MAXED.star, MAXED.level))}`,
        owned: `+${hqPercent(passiveBonus(rarity, FRESH.star, FRESH.level))} → +${hqPercent(passiveBonus(rarity, MAXED.star, MAXED.level))}`
    }
}

function artifactNumbers(effect: { kind: ModifierKind, stat?: HqStatKey }, rarity: Rarity) {
    return line(effect.kind, effect.stat,
        artifactLineMagnitude(effect.kind, rarity, FRESH.star, FRESH.level),
        artifactLineMagnitude(effect.kind, rarity, MAXED.star, MAXED.level))
}

/** An effect across the whole ladder: a fresh Common to a maxed Mythic. */
function effectRange(kind: ModifierKind, stat?: HqStatKey) {
    return line(kind, stat,
        artifactLineMagnitude(kind, RARITIES[0]!, FRESH.star, FRESH.level),
        artifactLineMagnitude(kind, RARITIES[RARITIES.length - 1]!, MAXED.star, MAXED.level))
}

const SPECIAL_SHARE = { spread: BOSS_SPECIAL_SPREAD_HP_SHARE, heavy: BOSS_SPECIAL_HEAVY_HP_SHARE, focus: BOSS_SPECIAL_FOCUS_HP_SHARE }
const SPECIAL_TARGET = { front: 'the front body', front_two: 'the front two', all: 'the whole party' }
const SPECIAL_STATUS: Record<string, string> = {
    burn: `burns for ${hqPercent(BOSS_SPECIAL_BURN_FRACTION)} of the hit a tick for ${BOSS_SPECIAL_BURN_SECONDS}s`,
    stun: `stuns for ${BOSS_SPECIAL_STUN_SECONDS}s`,
    silence: `silences for ${BOSS_SPECIAL_SILENCE_SECONDS}s`,
    slow: `−${hqPercent(BOSS_SPECIAL_DEBUFF_MAGNITUDE)} SPD for ${BOSS_SPECIAL_DEBUFF_SECONDS}s`,
    weaken: `−${hqPercent(BOSS_SPECIAL_DEBUFF_MAGNITUDE)} PWR for ${BOSS_SPECIAL_DEBUFF_SECONDS}s`,
    sunder: `−${hqPercent(BOSS_SPECIAL_DEBUFF_MAGNITUDE)} DEF for ${BOSS_SPECIAL_DEBUFF_SECONDS}s`
}

function specialText(special: BossSpecialDef | undefined) {
    if (!special) return ''
    const parts = [`${hqPercent(SPECIAL_SHARE[special.weight])} of max HP to ${SPECIAL_TARGET[special.target]}${special.hits && special.hits > 1 ? `, ${special.hits} hits` : ''}`]
    if (special.status) parts.push(SPECIAL_STATUS[special.status]!)
    if (special.drain) parts.push(`heals ${hqPercent(BOSS_SPECIAL_DRAIN_FRACTION)} of the damage`)
    return `${special.name}: ${parts.join(', ')}`
}

const specialFor = (world: number, stage: number) => BOSS_SPECIALS.find(s => s.world === world && s.stage === stage)

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

    <p class="text-xs text-muted">
      Numbers run from a fresh copy to a maxed one ({{ climbLabel }}). Classes are shown at Hero level 1.
    </p>

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
            <td class="py-1.5 pr-3">
              <div class="text-default font-medium whitespace-nowrap">
                {{ node.name }}
              </div>
              <div class="text-dimmed whitespace-nowrap">
                {{ classStats(node.id) }}
              </div>
            </td>
            <td class="py-1.5 px-3 capitalize text-muted">
              {{ node.tier }}
            </td>
            <td class="py-1.5 px-3 text-muted whitespace-nowrap">
              {{ parentName(node.parentId) }}
            </td>
            <td class="py-1.5 px-3 text-muted">
              {{ node.skill.name }}
              <span class="opacity-60">{{ abilityNumbers(node.skill) }}</span>
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
            <th class="text-right font-medium py-1.5 px-3 whitespace-nowrap">
              Stats
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
            <td class="py-1.5 px-3 text-right tabular-nums text-muted whitespace-nowrap">
              {{ championStats(entry.rarity) }}
            </td>
            <td class="py-1.5 pl-3 text-muted">
              <div
                v-for="a in entry.abilities"
                :key="a.id"
              >
                {{ a.name }}
                <span class="opacity-60">{{ abilityNumbers(a) }}</span>
              </div>
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
              >· {{ hqNumber(entry.cooldownSeconds) }}s</span>
            </td>
            <td class="py-1.5 pl-3 text-muted">
              <div>{{ entry.lines.join(' · ') }}</div>
              <div class="text-default tabular-nums">
                {{ skillNumbers(entry.id) }}
              </div>
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
            <th class="text-left font-medium py-1.5 px-3">
              Stat
            </th>
            <th class="text-right font-medium py-1.5 px-3">
              Equipped
            </th>
            <th class="text-right font-medium py-1.5 pl-3">
              Owned
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
            <td class="py-1.5 px-3 text-muted uppercase">
              {{ entry.stat }}
            </td>
            <td class="py-1.5 px-3 text-right tabular-nums text-muted whitespace-nowrap">
              {{ gearNumbers(entry.slot, entry.rarity).equipped }}
            </td>
            <td class="py-1.5 pl-3 text-right tabular-nums text-muted whitespace-nowrap">
              {{ gearNumbers(entry.slot, entry.rarity).owned }}
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
              <div
                v-for="effect in entry.effects"
                :key="effect.id"
              >
                {{ effect.name }}
                <span class="text-default tabular-nums">{{ artifactNumbers(effect, entry.rarity) }}</span>
              </div>
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
              <div class="text-default tabular-nums">
                {{ effectRange(effect.kind, effect.stat) }}
              </div>
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
            <td class="py-1.5 px-3 align-top">
              <div class="text-default">
                {{ world.bossName }}
              </div>
              <div class="text-muted max-w-xs">
                {{ specialText(specialFor(world.index, BOSS_STAGE)) }}
              </div>
            </td>
            <td class="py-1.5 pl-3 align-top">
              <div class="text-default">
                {{ world.superBossName }}
              </div>
              <div class="text-muted max-w-xs">
                {{ specialText(specialFor(world.index, SUPER_BOSS_STAGE)) }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
