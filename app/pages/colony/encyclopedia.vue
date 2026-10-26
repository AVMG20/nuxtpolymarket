<script setup lang="ts">
import {
  getItem,
  MAX_GEMS_PER_DAY,
  MAX_TOTAL_SPEED_PCT,
  MAX_TRAIT_PCT,
  MAX_YIELD_LEVEL,
  PURCHASABLE_BUG_TYPES,
  SOCIAL_BONUS_PER_PEER,
  SOCIAL_MAX_BONUS,
  SOLITARY_BONUS_ALONE,
  SOLITARY_PENALTY_PER_PEER,
  TIER_NAMES
} from '#shared/utils/colony'

const { habitatLevel } = useColony()

const pct = (n: number) => Math.round(n * 100)

const book = computed(() => PURCHASABLE_BUG_TYPES.map((type) => {
  const item = getItem(type.itemId)
  return {
    id: type.id,
    name: type.name,
    emoji: type.emoji,
    tier: type.tier,
    gem: !!type.producesGems,
    discovered: type.tier <= habitatLevel.value,
    detail: `${type.social ? 'Social' : 'Solitary'} · ${type.producesGems ? `1–${MAX_GEMS_PER_DAY} gems / day` : `${item?.emoji ?? ''} ${item?.name ?? ''}`}`
  }
}))
const discovered = computed(() => book.value.filter(entry => entry.discovered).length)

const loop = [
  { emoji: '🥚', title: 'Hatch', text: 'Buy eggs in the Hatchery' },
  { emoji: '🫙', title: 'Place', text: 'Move bugs into the terrarium' },
  { emoji: '🍎', title: 'Feed', text: 'Keep the tank above zero' },
  { emoji: '🧰', title: 'Collect', text: 'Empty the loot chest' },
  { emoji: '⛏️', title: 'Sell or build', text: 'Coins, or dig the Habitat deeper' }
]
</script>

<template>
  <div class="max-w-[1440px] mx-auto px-4 py-4 md:p-6 space-y-6">
    <div class="flex items-end gap-4 flex-wrap">
      <div class="flex-[1_1_300px]">
        <p class="cl-eyebrow">
          Field guide
        </p>
        <h1 class="cl-display text-3xl sm:text-[34px] font-bold">
          Colonopedia
        </h1>
      </div>
      <div class="cl-panel px-4 py-3 w-full sm:w-auto sm:min-w-64">
        <div class="flex justify-between font-extrabold">
          <span>Species discovered</span>
          <span class="cl-display cl-num text-amber-400">{{ discovered }} / {{ book.length }}</span>
        </div>
        <div class="cl-bar mt-2">
          <div
            class="cl-bar-fill cl-bar-fill-gold"
            :style="{ width: `${(discovered / book.length) * 100}%` }"
          />
        </div>
      </div>
    </div>

    <!-- The loop -->
    <section class="cl-panel p-4 sm:p-[18px]">
      <h2 class="cl-display text-[22px] font-bold mb-3.5">
        The colony loop
      </h2>
      <ol class="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:items-center gap-2.5">
        <li
          v-for="(step, i) in loop"
          :key="step.title"
          class="flex items-center gap-2.5 lg:flex-1 min-w-0"
          :class="i === loop.length - 1 && 'col-span-2 sm:col-span-1'"
        >
          <div class="cl-inset flex-1 min-w-0 p-3.5 text-center h-full">
            <div class="text-4xl">
              {{ step.emoji }}
            </div>
            <div class="cl-display text-[17px] font-semibold">
              {{ step.title }}
            </div>
            <div class="text-[12.5px] text-muted">
              {{ step.text }}
            </div>
          </div>
          <UIcon
            v-if="i < loop.length - 1"
            name="i-lucide-arrow-right"
            class="hidden lg:block size-5.5 shrink-0 text-amber-400"
          />
        </li>
      </ol>
    </section>

    <!-- Traits -->
    <section>
      <h2 class="cl-display text-[22px] font-bold mb-3">
        What makes a good bug
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <div class="cl-panel p-4">
          <div
            class="h-[70px] flex items-end gap-1.5"
            aria-hidden="true"
          >
            <span class="flex-1 h-[30%] rounded-t-md rounded-b-sm bg-[#3b2d22]" />
            <span class="flex-1 h-[55%] rounded-t-md rounded-b-sm bg-yellow-700" />
            <span class="flex-1 h-full rounded-t-md rounded-b-sm bg-linear-to-b from-yellow-300 to-yellow-600 shadow-[0_0_12px_rgba(250,204,21,0.5)]" />
          </div>
          <h3 class="cl-display text-[19px] font-semibold mt-2.5 text-yellow-300">
            Speed
          </h3>
          <p class="text-[13px] text-muted mt-1">
            Rolled 0–{{ MAX_TRAIT_PCT }}% when hatched, wider with Research. Shorter cycles mean more forage and more meals. Habitat speed adds on top, capped at {{ MAX_TOTAL_SPEED_PCT }}% in total.
          </p>
        </div>
        <div class="cl-panel p-4">
          <div
            class="h-[70px] flex items-center justify-center gap-1.5"
            aria-hidden="true"
          >
            <span
              v-for="i in MAX_YIELD_LEVEL"
              :key="i"
              class="cl-pip w-4 h-[22px]"
              :class="i <= 3 && 'cl-pip-on'"
            />
          </div>
          <h3 class="cl-display text-[19px] font-semibold mt-2.5 text-sky-300">
            Yield
          </h3>
          <p class="text-[13px] text-muted mt-1">
            A fixed level. Each cycle drops 1 to level + 1 items. Research raises future rolls up to level {{ MAX_YIELD_LEVEL }} and multiplies what every bug of that species forages.
          </p>
        </div>
        <div class="cl-panel p-4">
          <div
            class="h-[70px] grid place-items-center text-[44px]"
            aria-hidden="true"
          >
            🥣
          </div>
          <h3 class="cl-display text-[19px] font-semibold mt-2.5">
            Appetite
          </h3>
          <p class="text-[13px] text-muted mt-1">
            Nutrition eaten every finished cycle. Yield never makes a meal bigger; speed only makes meals come more often.
          </p>
        </div>
        <div class="cl-panel p-4">
          <div
            class="h-[70px] flex items-center justify-around"
            aria-hidden="true"
          >
            <span class="text-center">
              <span class="text-[22px] tracking-[-6px]">🐜🐜🐜</span>
              <span class="cl-chip cl-chip-green flex mt-1">+{{ pct(SOCIAL_MAX_BONUS) }}%</span>
            </span>
            <span class="text-center">
              <span class="text-[22px]">🕷️</span>
              <span class="cl-chip cl-chip-warn flex mt-1">+{{ pct(SOLITARY_BONUS_ALONE) }}% alone</span>
            </span>
          </div>
          <h3 class="cl-display text-[19px] font-semibold mt-2.5 text-green-300">
            Social vs Solitary
          </h3>
          <p class="text-[13px] text-muted mt-1">
            Social: +{{ pct(SOCIAL_BONUS_PER_PEER) }}% speed per same-species neighbour, up to +{{ pct(SOCIAL_MAX_BONUS) }}%. Solitary: +{{ pct(SOLITARY_BONUS_ALONE) }}% alone, −{{ pct(SOLITARY_PENALTY_PER_PEER) }}% per neighbour of its kind.
          </p>
        </div>
      </div>
    </section>

    <!-- Species book -->
    <section>
      <h2 class="cl-display text-[22px] font-bold mb-3">
        Species
      </h2>
      <div class="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 sm:gap-3.5">
        <div
          v-for="entry in book"
          :key="entry.id"
          class="cl-bug pb-3"
          :class="[`cl-t${entry.tier}`, entry.gem && 'cl-tgem', !entry.discovered && 'cl-bug-dim']"
        >
          <span class="cl-bug-tier">T{{ entry.tier }}</span>
          <div class="cl-bug-art h-[84px] mt-4">
            <span
              class="cl-bug-emoji text-[46px]"
              :class="!entry.discovered && 'cl-silhouette'"
            >{{ entry.emoji }}</span>
          </div>
          <span class="cl-bug-name text-base">{{ entry.discovered ? entry.name : '???' }}</span>
          <span class="text-center text-xs font-bold text-muted mt-0.5 px-2">
            {{ entry.discovered ? entry.detail : `${TIER_NAMES[entry.tier]} · Habitat ${entry.tier}` }}
          </span>
        </div>
      </div>
    </section>

    <!-- Rules -->
    <section class="grid grid-cols-1 md:grid-cols-3 gap-3.5">
      <div class="cl-panel p-4 flex gap-3">
        <span class="text-3xl">🧰</span>
        <div>
          <h3 class="cl-display font-semibold text-[17px]">
            Loot waits safely
          </h3>
          <p class="text-[13px] text-muted">
            Forage piles up in the chest. Only collected items can be sold or spent on upgrades.
          </p>
        </div>
      </div>
      <div class="cl-panel p-4 flex gap-3">
        <span class="text-3xl">🍂</span>
        <div>
          <h3 class="cl-display font-semibold text-[17px]">
            No food, no forage
          </h3>
          <p class="text-[13px] text-muted">
            If the tank can't pay a bug's meal, it pauses just before finishing its cycle until you feed.
          </p>
        </div>
      </div>
      <div class="cl-panel p-4 flex gap-3">
        <span class="text-3xl">⛏️</span>
        <div>
          <h3 class="cl-display font-semibold text-[17px]">
            Builders are shared
          </h3>
          <p class="text-[13px] text-muted">
            Tracks and Habitat levels share builders; the Prestige Shop's Labour Contract hires more. Keep early bugs foraging: later builds still need their materials.
          </p>
        </div>
      </div>
    </section>
  </div>
</template>
