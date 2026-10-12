<script setup lang="ts">
import {
    BASE_ATTACK_INTERVAL_SECONDS,
    FORMATION_ROW_CAPACITY,
    MAX_EVASION,
    MIN_DAMAGE,
    K
} from '#shared/utils/hero-quest/constants'
import { ARCHETYPE_DEFINITIONS } from '#shared/utils/hero-quest/content/champions'

/**
 * Stats and combat — the page finding 6 was really asking for.
 *
 * Stat prose comes from `HQ_STAT_DOCS`, the same table the battle screen's tooltips read, so the
 * two can never disagree. Everything numeric is interpolated from `constants.ts`.
 */
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <div class="space-y-2">
      <h1 class="text-xl font-semibold text-highlighted">
        Stats and combat
      </h1>
      <p class="text-sm text-muted">
        Six stats, one damage formula. Everything else is a modifier on top of it.
      </p>
    </div>

    <HeroQuestWikiSection
      title="The six stats"
      icon="i-lucide-chart-no-axes-column"
      lead="Identical for your Hero and every Champion."
    >
      <div class="space-y-3">
        <div
          v-for="stat in HQ_STAT_DOCS"
          :key="stat.key"
          class="rounded-lg border border-default bg-elevated/40 p-4 space-y-2"
        >
          <div class="flex items-baseline gap-2">
            <span class="text-sm font-medium text-highlighted">{{ stat.name }}</span>
            <span class="text-[0.625rem] uppercase tracking-wide text-muted">{{ stat.key }}</span>
          </div>
          <p class="text-sm text-muted">
            {{ stat.detail }}
          </p>
          <p class="font-mono text-xs text-default bg-background rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
            {{ stat.formula }}
          </p>
        </div>
      </div>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      :title="HQ_POWER_DOC.name"
      icon="i-lucide-zap"
      lead="The headline number on the battle screen."
    >
      <div class="rounded-lg border border-default bg-elevated/40 p-4 space-y-2">
        <p class="text-sm text-muted">
          {{ HQ_POWER_DOC.detail }}
        </p>
        <p class="font-mono text-xs text-default bg-background rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
          {{ HQ_POWER_DOC.formula }}
        </p>
      </div>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="How a hit is worked out"
      icon="i-lucide-swords"
    >
      <p>
        Damage is Power, reduced by however much of it the defender's armour stops, times whatever
        the ability is worth. Mitigation is a <strong class="text-default">clamped ratio</strong> —
        it reaches exactly 100% and stops, rather than curving toward immunity forever.
      </p>
      <HeroQuestWikiFormula
        label="Mitigation"
        :formula="`min(100%, DEF ÷ (PWR × ${K}))`"
        :note="`At ${K}× the attacker's Power in Defence, mitigation is total — and a total mitigation still lets ${MIN_DAMAGE} through.`"
      />
      <HeroQuestWikiFormula
        label="Damage"
        :formula="`max(${MIN_DAMAGE}, PWR × (1 − mitigation) × ability multiplier)`"
        :note="`The floor is why a wall slows you down instead of stopping you dead. An attacker with no Power is the exception — it deals nothing at all.`"
      />
      <p>
        On a crit, the finished hit is multiplied again by your crit multiplier. Luck decides how
        often that happens and Impact decides what it is worth, which is why either one alone is a
        trap.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Why a party is worth more than its damage"
      icon="i-lucide-users"
    >
      <p>
        Each unit swings its own Power — but the party
        <strong class="text-default">pools all of it</strong> to decide how much armour it cuts
        through. Mitigation is computed once, against the sum.
      </p>
      <p>
        The consequence is worth understanding: a Champion far weaker than your Hero still thins
        the enemy's armour for everyone, so it adds more than its own damage. This is what makes
        party size move how deep you can go, rather than just how fast you clear.
      </p>
      <p>
        Incoming damage works the other way — it is worked out per defender. Adding bodies does
        not quietly make you tankier.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Formation"
      icon="i-lucide-layout-grid"
      :lead="`Two rows, ${FORMATION_ROW_CAPACITY} slots each, Hero included.`"
    >
      <p>
        A single-target attacker chews through the <strong class="text-default">front row
        first</strong>, and only reaches the back once the front is empty or dead. That is the
        entire mechanical basis of the Tank archetype — a Tank in the back row is a Tank doing
        nothing.
      </p>
      <p>
        Within a row, whoever draws the most threat is hit first. Tanks generate more of it, and a
        taunt generates far more.
      </p>
      <p>
        Every unit has a suggested row it starts in, and every one of them can be moved.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Champion archetypes"
      icon="i-lucide-shield"
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Archetype
              </th>
              <th class="text-left font-medium py-1.5 px-3">
                Starts
              </th>
              <th class="text-left font-medium py-1.5 px-3">
                Attacks
              </th>
              <th class="text-left font-medium py-1.5 pl-3">
                Buffs the Hero's
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="archetype in ARCHETYPE_DEFINITIONS"
              :key="archetype.id"
              class="border-t border-default"
            >
              <td class="py-1.5 pr-3 text-default font-medium">
                {{ archetype.name }}
              </td>
              <td class="py-1.5 px-3 capitalize">
                {{ archetype.defaultRow }}
              </td>
              <td class="py-1.5 px-3">
                {{ archetype.autoTarget === 'lowest_hp_pct' ? 'the weakest target' : 'the strongest target' }}
              </td>
              <td class="py-1.5 pl-3 uppercase">
                {{ archetype.passiveStats.join(', ') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        The last column is passive: <strong class="text-default">every Champion you own buffs your
        Hero whether it is in the party or not</strong>, so recruiting one is never wasted even
        when your slots are full.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Speed, cooldowns and evasion"
      icon="i-lucide-gauge"
    >
      <p>
        At zero Speed everyone attacks once every {{ BASE_ATTACK_INTERVAL_SECONDS }} seconds.
        Speed shortens that and shortens skill cooldowns on the same curve, both clamped at a
        floor — so Speed is worth a great deal early and very little late.
      </p>
      <p>
        Evasion is the one stat you cannot build directly: only the Vital Reflex Trait set grants it,
        to the whole party, and every incoming hit then lands with chance 1 − evasion. It is capped
        so that no amount of it makes anything untouchable.
      </p>
      <HeroQuestWikiFormula
        label="Evasion ceiling"
        :formula="`${MAX_EVASION * 100}% dodge, whatever the sources say`"
      />
    </HeroQuestWikiSection>
  </div>
</template>
