<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, RARITY_MOD_COUNT, AGENT_TRAIT_COUNT,
  AGENT_TRAIT_LABEL, AGENT_TRAIT_RANGES, MOD_LABEL, MOD_RANGES, CLASS_LABEL, CLASS_PASSIVE,
  CLASS_COLOR, CLASS_ICON, RARITY_ORDER, ARTIFACT_VALUE, formatArtifactAdd,
  type HackRarity, type AgentTraitType, type ModType, type AgentClass,
} from '#shared/utils/hack-config'

function fmtRange(type: AgentTraitType | ModType, min: number, max: number): string {
  if (type === 'gem_chance' || type === 'item_chance') return `+${(min * 100).toFixed(1)}% – +${(max * 100).toFixed(1)}%`
  if (type === 'gem_bonus') return `+${min} – +${max} gems`
  if (type === 'xp_flat' || type === 'power_flat') return `+${min} – +${max}`
  return `+${min}% – +${max}%`
}

function fmtArtifactRange(type: AgentTraitType): string {
  const ghost = formatArtifactAdd(type, ARTIFACT_VALUE[type].ghost)
  const phantom = formatArtifactAdd(type, ARTIFACT_VALUE[type].phantom)
  return `${ghost} (Ghost) – ${phantom} (Phantom)`
}
</script>

<template>
  <UContainer class="py-6 pb-12 space-y-10">
    <div>
      <h1 class="text-3xl font-bold">Hack Ops — Wiki</h1>
      <p class="text-muted mt-1">Everything you need to know about power, traits, and gear.</p>
    </div>

    <!-- Power Level -->
    <section class="space-y-3">
      <h2 class="text-xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-zap" class="size-5 text-primary" /> Power Level
      </h2>
      <UCard>
        <p class="text-sm mb-3">Your <strong>Power Level</strong> is the sum of every agent's individual power. It determines which operations you can attempt.</p>
        <div class="space-y-2 text-sm">
          <div class="p-3 rounded-lg bg-elevated">
            <p class="font-semibold mb-1">Agent power formula:</p>
            <code class="text-primary">(level × 10 + class_bonus + item_levels × 2 + power_mods + flat_power_trait) × (1 + power%_trait)</code>
          </div>
          <ul class="list-disc list-inside space-y-1 text-muted pl-2">
            <li>Leveling an agent from 1→20 adds 190 base power</li>
            <li>Every item adds its level × 2 as power — even with no Power spec. Items always drop at level 1; upgrade them with gems at the Crafting Bench (max level 20 = +40)</li>
            <li>Power specs add up to +28 per item on top</li>
            <li>Bruteforce class adds +15 power passively</li>
            <li>Flat Power adds up to +60; Power % multiplies the whole total by up to +30%</li>
            <li><strong>A single agent caps at 611 power</strong> (level 20, perfect gear &amp; traits) — so a 4-agent squad maxes at <strong>2,444</strong>, exactly what the final op demands</li>
          </ul>
        </div>
        <div class="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/20 text-sm">
          <p class="font-semibold text-primary mb-1">Every op is visible</p>
          <p class="text-muted">All operations are always listed and openable. You can deploy any op as long as your selected team's success chance is at least 1% — so you can attempt the next tier early and just expect to fail often until you outpower it.</p>
        </div>
      </UCard>
    </section>

    <!-- Success Chance -->
    <section class="space-y-3">
      <h2 class="text-xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-target" class="size-5 text-primary" /> Success Chance
      </h2>
      <UCard>
        <p class="text-sm mb-3">Success is rolled when you collect a completed op. Agents still gain 30% XP on failure. You need at least <strong>1%</strong> (roughly 11% of the op's power) just to deploy.</p>
        <div class="p-3 rounded-lg bg-elevated text-sm mb-3">
          <code class="text-primary">chance = clamp(0%, 100%, (teamPower / power - 0.1) / 1.3)</code>
        </div>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div class="p-2 rounded bg-elevated">
            <p class="text-muted">At 50% of power</p><p class="font-bold text-error">~31%</p>
          </div>
          <div class="p-2 rounded bg-elevated">
            <p class="text-muted">At full power</p><p class="font-bold text-warning">~69%</p>
          </div>
          <div class="p-2 rounded bg-elevated">
            <p class="text-muted">At 1.2× power</p><p class="font-bold text-success">~85%</p>
          </div>
          <div class="p-2 rounded bg-elevated">
            <p class="text-muted">At 1.4× power</p><p class="font-bold text-success">100%</p>
          </div>
        </div>
        <p class="text-sm text-muted mt-3">Raise it purely with <strong>power</strong>: higher agent levels, <strong>Power</strong> &amp; <strong>Power %</strong> traits, and power gear. There's no flat success bonus.</p>
      </UCard>
    </section>

    <!-- Rarity System -->
    <section class="space-y-3">
      <h2 class="text-xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-gem" class="size-5 text-primary" /> Rarity System
      </h2>
      <UCard>
        <p class="text-sm text-muted mb-3">Both agents and items share the same 5-tier rarity. Higher rarity = more stats.</p>
        <div class="space-y-2">
          <div v-for="r in RARITY_ORDER" :key="r" class="flex items-center gap-3 p-3 rounded-lg bg-elevated">
            <UBadge :color="RARITY_COLOR[r]" variant="subtle" :label="RARITY_LABEL[r]" class="w-24 justify-center shrink-0" />
            <div class="flex-1 grid grid-cols-2 gap-x-4 text-sm">
              <span class="text-muted">Agent traits: <strong>{{ AGENT_TRAIT_COUNT[r] }}</strong></span>
              <span class="text-muted">Item mods: <strong>{{ RARITY_MOD_COUNT[r] }}</strong></span>
            </div>
          </div>
        </div>
      </UCard>
    </section>

    <!-- Agent Traits -->
    <section class="space-y-3">
      <h2 class="text-xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-user-check" class="size-5 text-primary" /> Agent Traits
      </h2>
      <UCard>
        <p class="text-sm text-muted mb-4">Each agent rolls a random set of traits on recruitment — one per rarity tier (Ghost 1 → Phantom 5), and each trait type appears at most once per agent. Traits are permanent, so fire &amp; re-recruit to reroll. All of an op team's traits are pooled together when the op resolves.</p>
        <div class="space-y-2">
          <div v-for="(range, type) in AGENT_TRAIT_RANGES" :key="type"
            class="flex items-start justify-between gap-3 p-3 rounded-lg bg-elevated text-sm">
            <div>
              <p class="font-semibold">{{ AGENT_TRAIT_LABEL[type as AgentTraitType] }}</p>
              <p class="text-muted text-sm mt-0.5">
                <template v-if="type === 'speed_percent'">Shortens how long this op takes. Combines with this agent's item Speed mods and the Infiltrator class — a perfect agent tops out around 50%. On multi-agent ops each agent's speed is applied one after another on the remaining time (it does not stack into one big number), and an op can never drop below 35% of its base duration.</template>
                <template v-else-if="type === 'loot_percent'">Increases the cash payout of a successful op. Combines with this agent's item Loot mods and the Cryptographer class — a single agent tops out around 30%, then each agent's loot is summed across the squad.</template>
                <template v-else-if="type === 'gem_chance'">Adds a flat percentage to the chance an op drops gems. Only matters on ops that can drop gems in the first place.</template>
                <template v-else-if="type === 'gem_bonus'">Adds flat extra gems to a raid — but only on ops that already award gems, and only when the gem chance roll succeeds. It can never create gems on an op that has none.</template>
                <template v-else-if="type === 'xp_boost'">This agent earns more XP from every op (up to +50% on a single agent), so it levels up faster. XP is per agent — it's never pooled, so this only ever boosts the agent that carries it.</template>
                <template v-else-if="type === 'power_flat'">Adds a flat amount to this agent's power — raises success chance and helps unlock tougher ops. Best on low-level agents.</template>
                <template v-else-if="type === 'power_percent'">Multiplies this agent's whole power (level + gear + flat power) by a percentage. The more invested the agent, the bigger the gain — best on high-level, well-geared agents.</template>
              </p>
            </div>
            <span class="font-medium text-primary shrink-0">{{ fmtRange(type as AgentTraitType, range.min, range.max) }}</span>
          </div>
        </div>
      </UCard>
    </section>

    <!-- Artifacts -->
    <section class="space-y-3">
      <h2 class="text-xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-sparkles" class="size-5 text-primary" /> Artifacts
      </h2>
      <UCard>
        <p class="text-sm text-muted mb-4">
          Artifacts are consumable items that mission drops award. Applying one permanently pushes one of an agent's
          <strong>already-rolled</strong> traits closer to (never past) that trait's max — they're not gear, an Artifact
          is applied once and consumed. There's one Artifact per trait type; rarity (Ghost → Phantom) only controls
          how much it adds, never which trait it targets.
        </p>
        <div class="space-y-2 mb-4">
          <div v-for="(range, type) in AGENT_TRAIT_RANGES" :key="type"
            class="flex items-center justify-between gap-3 p-3 rounded-lg bg-elevated text-sm">
            <span class="font-semibold">{{ AGENT_TRAIT_LABEL[type as AgentTraitType] }} Artifact</span>
            <span class="font-medium text-primary shrink-0">{{ fmtArtifactRange(type as AgentTraitType) }}</span>
          </div>
        </div>
        <div class="p-3 rounded-lg bg-elevated text-sm space-y-1.5 text-muted">
          <p><strong class="text-default">Only applies to a trait the agent already rolled</strong> — an Artifact can never add a trait type the agent doesn't have, and it's disabled in your inventory if the selected agent can't use it.</p>
          <p><strong class="text-default">Hard-capped at the trait's real max</strong> — the Upgrade page blocks the apply once a trait is maxed, so nothing is ever wasted.</p>
          <p><strong class="text-default">Drops scale with an op's base duration</strong>, not a flat per-op chance — a long endgame op yields a whole cache of Artifacts at better rarity odds, so higher-tier ops are always the fastest way to farm them. The final op (Project Zero) drops none, since reaching it means you're already close to maxed out.</p>
        </div>
        <div class="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/20 text-sm">
          <p class="font-semibold text-primary mb-1">Where to apply them</p>
          <p class="text-muted">Open an agent's <strong>Upgrade</strong> page (from the Agents tab) to pick an Artifact from your stacked inventory and preview the trait's current → projected value before confirming.</p>
        </div>
      </UCard>
    </section>

    <!-- Agent Classes -->
    <section class="space-y-3">
      <h2 class="text-xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-users" class="size-5 text-primary" /> Agent Classes
      </h2>
      <UCard>
        <p class="text-sm text-muted mb-3">Class is fixed at recruitment. It determines the agent's passive bonus (on top of random traits).</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div v-for="cls in (['infiltrator','cryptographer','social_engineer','bruteforce'] as AgentClass[])" :key="cls"
            class="flex items-center gap-3 p-3 rounded-lg border text-sm"
            :class="[CLASS_COLOR[cls].bg, CLASS_COLOR[cls].border]">
            <div class="size-9 rounded-lg flex items-center justify-center shrink-0 bg-default/40">
              <UIcon :name="CLASS_ICON[cls]" class="size-5" :class="CLASS_COLOR[cls].text" />
            </div>
            <div>
              <p class="font-semibold" :class="CLASS_COLOR[cls].text">{{ CLASS_LABEL[cls] }}</p>
              <p class="text-muted font-medium mt-0.5">{{ CLASS_PASSIVE[cls].label }}</p>
            </div>
          </div>
        </div>
      </UCard>
    </section>

    <!-- Item Mods -->
    <section class="space-y-3">
      <h2 class="text-xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-cpu" class="size-5 text-primary" /> Item Mods
      </h2>
      <UCard>
        <p class="text-sm text-muted mb-4">Items drop from ops or are bought via crates. Each mod rolls randomly within its range — the range is the <strong>same in every crate</strong>, so better crates buy you higher rarity (more mods), never secretly better values. Roll quality is shown as a progress bar (green = near max).</p>
        <div class="space-y-2">
          <div v-for="(range, type) in MOD_RANGES" :key="type"
            class="flex items-start justify-between gap-3 p-3 rounded-lg bg-elevated text-sm">
            <div>
              <p class="font-semibold">{{ MOD_LABEL[type as ModType] }}</p>
              <p class="text-muted text-sm mt-0.5">
                <template v-if="type === 'speed_percent'">Reduces op duration. Combines with the equipped agent's speed traits and class (a single agent tops out around 50%). Multiple agents apply one after another on the remaining time rather than summing.</template>
                <template v-else-if="type === 'loot_percent'">Multiplies cash rewards from the op. A single agent's total loot tops out around 30%.</template>
                <template v-else-if="type === 'gem_chance'">Adds flat % to gem drop chance on any op.</template>
                <template v-else-if="type === 'xp_flat'">Flat XP added per op completion for the equipped agent.</template>
                <template v-else-if="type === 'power_flat'">Increases the equipped agent's power rating directly.</template>
                <template v-else-if="type === 'item_chance'">Raises the op's item-drop chance. Stacks across the squad's gear on top of the op's base drop rate (capped at 90%).</template>
                <template v-else-if="type === 'gem_bonus'">Adds flat extra gems to a raid — but only on ops that already award gems, and only when the gem chance roll succeeds. Stacks with agent Bonus Gems traits.</template>
              </p>
            </div>
            <span class="font-medium text-primary shrink-0">{{ fmtRange(type as ModType, range.min, range.max) }}</span>
          </div>
        </div>
      </UCard>
    </section>

    <!-- Pricing & Progression -->
    <section class="space-y-3">
      <h2 class="text-xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-trending-up" class="size-5 text-primary" /> Pricing &amp; Progression
      </h2>
      <UCard>
        <p class="text-sm mb-3">
          Every agent and item pull has a <strong>fixed price</strong> per tier — it never changes based on your power, gear or inventory, so costs are always predictable.
        </p>
        <div class="space-y-2 text-sm">
          <div class="p-3 rounded-lg bg-elevated">
            <p class="font-semibold mb-1">Where the difficulty curve lives:</p>
            <ul class="list-disc list-inside space-y-1 text-muted">
              <li><strong>The op ladder</strong> — each op pays roughly 1.6× the one before, from a few hundred up to ~5M on the final op, while durations stretch from 1h to 48h.</li>
              <li><strong>Roster slots</strong> — each extra agent slot multiplies how many ops you run at once, so its cost scales hard (150k → 60M).</li>
              <li><strong>The rarity ladder</strong> — each crate/recruit tier removes the previous tier's lowest rarity, so a pricier pull always guarantees a better minimum tier. Mod and trait ranges stay identical everywhere.</li>
              <li><strong>Item levels</strong> — every item drops at level 1 and never levels on its own. Upgrading at the Crafting Bench is a gem sink: 1 gem for level 2, scaling to ~51 gems total to max one item at level 20 (+2 power per level).</li>
            </ul>
          </div>
          <p class="text-muted">Roster (6) and inventory (30) caps keep cheap late-game pulls in check: pull, equip your best roll, and sell the rest. Selling an item only frees a slot and refunds cash — it no longer affects any prices.</p>
        </div>
      </UCard>
    </section>
  </UContainer>
</template>
