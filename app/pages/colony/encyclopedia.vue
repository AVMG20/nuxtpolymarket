<script setup lang="ts">
import {
  MAX_TRAIT_PCT,
  MAX_YIELD_LEVEL,
  MAX_RESEARCH_LEVEL,
  SOCIAL_BONUS_PER_PEER,
  SOCIAL_MAX_BONUS,
  SOLITARY_BONUS_ALONE,
  SOLITARY_PENALTY_PER_PEER,
  PURCHASABLE_BUG_TYPES,
  TIER_NAMES,
  MAX_GEMS_PER_DAY,
  getItem
} from '#shared/utils/colony'
import { tierColor, tierBg } from '#shared/utils/xeno'
import { formatDuration } from '~/lib/colony-format'

const colony = useColony()
const { habitatLevel } = colony
const sound = useColonySound()

const LOOP = [
  { emoji: '🛒', title: 'Buy', text: 'Grab bugs in the Market. Each one rolls Speed and Yield.' },
  { emoji: '🫙', title: 'Place', text: 'Drop them in the terrarium from your Bug Box.' },
  { emoji: '🍯', title: 'Feed', text: 'Keep the tank topped up — hungry bugs stop foraging.' },
  { emoji: '📦', title: 'Collect', text: 'Empty the loot jar into storage.' },
  { emoji: '⚖️', title: 'Sell or build', text: 'Cash out, or hoard items for Habitat blueprints.' }
]

const TRAITS = [
  { emoji: '⚡', title: 'Speed', color: 'text-warning', text: `Rolled 0–${MAX_TRAIT_PCT}% on purchase (wider with Research). Shortens the cycle, so a fast bug produces and eats more often. The Habitat's Foraging Speed track stacks on top, colony-wide.` },
  { emoji: '💎', title: 'Yield', color: 'text-info', text: `A level rolled on purchase. Every cycle drops 1 up to level + 1 items. Research widens the roll up to level ${MAX_YIELD_LEVEL} and multiplies what every bug of that species forages.` },
  { emoji: '🍽️', title: 'Eat', color: 'text-success', text: 'Nutrition spent when a bug finishes a cycle. Yield never changes the meal; speed only means more meals per hour.' },
  { emoji: '👥', title: 'Temperament', color: 'text-primary', text: `Social species gain +${(SOCIAL_BONUS_PER_PEER * 100).toFixed(0)}% speed per same-species neighbour, up to +${(SOCIAL_MAX_BONUS * 100).toFixed(0)}%. Solitary bugs get +${(SOLITARY_BONUS_ALONE * 100).toFixed(0)}% alone and lose ${(SOLITARY_PENALTY_PER_PEER * 100).toFixed(0)}% per neighbour.` }
]

const RULES = [
  { emoji: '🫙', title: 'Loot waits safely', text: 'Finished cycles fill the loot jar. Collecting moves everything into storage; only stored items can be sold or spent on blueprints.' },
  { emoji: '💀', title: 'No food, no progress', text: 'If the colony can\'t pay a bug\'s meal, its cycle pauses just before completion until nutrition is back.' },
  { emoji: '💎', title: 'Gem feeding buffs', text: 'Gem-fed nutrition drains first and, while any remains, grants +1 yield and +20% speed to every bug.' },
  { emoji: '🔨', title: 'Builders are shared', text: 'Blueprints and nest expansions share the build crew. The Prestige Shop\'s Labour Contract adds more builders.' },
  { emoji: '🧬', title: 'Research pays twice', text: `Up to level ${MAX_RESEARCH_LEVEL} per species: wider rolls for future buys, and a forage multiplier for bugs you already own.` },
  { emoji: '🌙', title: 'Day and night', text: 'The terrarium follows your clock. Mushrooms glow and fireflies come out after dark. Purely for show — the bugs don\'t sleep.' }
]

const roster = computed(() => PURCHASABLE_BUG_TYPES.map(b => ({
  ...b,
  item: getItem(b.itemId),
  unlocked: b.tier <= habitatLevel.value
})))

function onHover() {
  sound.play('hover')
}
</script>

<template>
  <div class="p-3 md:p-5 w-full space-y-6">
    <div class="colony-panel colony-panel-accent p-4 flex items-center gap-4 colony-slide-in relative overflow-hidden">
      <div class="colony-shine" />
      <span class="text-5xl colony-bob">📖</span>
      <div>
        <p class="colony-eyebrow">
          Field guide
        </p>
        <h1 class="text-2xl colony-title">
          The <span class="text-primary colony-glow-text">Colonopedia</span>
        </h1>
        <p class="text-xs text-muted mt-0.5">
          How the colony ticks: the loop, the traits, the rules, and every species you can raise.
        </p>
      </div>
    </div>

    <!-- The loop -->
    <div>
      <p class="colony-eyebrow px-1 mb-2">
        The loop
      </p>
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div
          v-for="(step, i) in LOOP"
          :key="step.title"
          class="colony-card p-3 text-center colony-slide-in"
          :style="{ animationDelay: `${i * 70}ms` }"
          @mouseenter="onHover"
        >
          <span
            class="text-3xl block colony-bob"
            :style="{ animationDelay: `${i * 0.3}s` }"
          >{{ step.emoji }}</span>
          <p class="text-xs font-black mt-1.5">
            <span class="text-primary">{{ i + 1 }}.</span> {{ step.title }}
          </p>
          <p class="text-[11px] text-muted mt-0.5">
            {{ step.text }}
          </p>
        </div>
      </div>
    </div>

    <!-- Traits -->
    <div>
      <p class="colony-eyebrow px-1 mb-2">
        Bug traits
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div
          v-for="t in TRAITS"
          :key="t.title"
          class="colony-card p-3.5"
          @mouseenter="onHover"
        >
          <div class="flex items-center gap-2 mb-1.5">
            <span class="text-2xl">{{ t.emoji }}</span>
            <p
              class="font-black text-sm"
              :class="t.color"
            >
              {{ t.title }}
            </p>
          </div>
          <p class="text-xs text-muted">
            {{ t.text }}
          </p>
        </div>
      </div>
    </div>

    <!-- Roster -->
    <div>
      <div class="flex items-center justify-between px-1 mb-2">
        <p class="colony-eyebrow">
          Species roster
        </p>
        <span class="colony-chip">Habitat Lv {{ habitatLevel }}</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <div
          v-for="(b, i) in roster"
          :key="b.id"
          class="colony-card p-3 flex gap-3 colony-slide-in"
          :class="!b.unlocked ? 'colony-card-locked' : ''"
          :style="{ animationDelay: `${i * 40}ms` }"
          @mouseenter="onHover"
        >
          <div
            class="size-14 shrink-0 rounded-2xl border flex items-center justify-center text-3xl"
            :class="tierBg(b.tier)"
          >
            <span :class="b.unlocked ? 'drop-shadow' : 'grayscale opacity-40'">{{ b.unlocked ? b.emoji : '❔' }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="font-black text-sm flex items-center gap-1.5">
              {{ b.unlocked ? b.name : '???' }}
              <span
                class="text-[10px] font-black"
                :class="tierColor(b.tier)"
              >T{{ b.tier }} {{ TIER_NAMES[b.tier] }}</span>
            </p>
            <template v-if="b.unlocked">
              <p class="text-[11px] text-muted italic line-clamp-2">
                {{ b.description }}
              </p>
              <div class="flex flex-wrap gap-1 mt-1.5">
                <span class="colony-chip">⏱️ {{ formatDuration(b.baseTickMs) }}</span>
                <span
                  class="colony-chip"
                  :class="b.social ? 'colony-chip-ok' : 'colony-chip-amber'"
                >{{ b.social ? '👥 Social' : '🧍 Solitary' }}</span>
                <span class="colony-chip">🍽️ {{ b.eatMin }}–{{ b.eatMax }}</span>
                <span
                  v-if="b.producesGems"
                  class="colony-chip"
                  style="color:#7dd3fc;border-color:rgba(56,189,248,.45)"
                >💎 up to {{ MAX_GEMS_PER_DAY }}/day</span>
                <span
                  v-else-if="b.item"
                  class="colony-chip"
                >{{ b.item.emoji }} {{ b.item.name }}</span>
              </div>
            </template>
            <p
              v-else
              class="text-[11px] text-muted mt-1"
            >
              Reach Habitat Level {{ b.tier }} to reveal.
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Rules -->
    <div>
      <p class="colony-eyebrow px-1 mb-2">
        Useful rules
      </p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div
          v-for="r in RULES"
          :key="r.title"
          class="colony-card p-3.5"
          @mouseenter="onHover"
        >
          <span class="text-2xl block mb-1.5">{{ r.emoji }}</span>
          <p class="font-black text-sm">
            {{ r.title }}
          </p>
          <p class="text-xs text-muted mt-1">
            {{ r.text }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
