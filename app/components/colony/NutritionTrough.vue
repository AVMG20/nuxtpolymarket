<script setup lang="ts">
import { GEM_FEED_SPEED_BONUS_PCT, GEM_FEED_YIELD_BONUS } from '#shared/utils/colony'
import { formatDuration } from '~/lib/colony-format'

const props = defineProps<{
  /** Live coin-fed nutrition. */
  nutrition: number
  /** Live gem-fed nutrition, eaten first. */
  gemNutrition: number
  max: number
  drainPerHour: number
  feedCost: number
  gemFeedCost: number
  gemNutritionPerGem: number
  canFeed: boolean
  canGemFeed: boolean
  feeding: boolean
}>()

const emit = defineEmits<{
  feed: []
  gemFeed: []
}>()

const total = computed(() => props.nutrition + props.gemNutrition)
const safeMax = computed(() => Math.max(1, props.max))
const buffed = computed(() => props.gemNutrition > 0)
/** Low is about the whole tank, gem layer included; the buff only adds to it. */
const low = computed(() => total.value > 0 && total.value / safeMax.value < 0.25)
const status = computed<'starving' | 'low' | 'buffed' | 'healthy'>(() => {
  if (total.value <= 0) return 'starving'
  if (low.value) return 'low'
  if (buffed.value) return 'buffed'
  return 'healthy'
})

const coinPct = computed(() => Math.min(100, (props.nutrition / safeMax.value) * 100))
const gemPct = computed(() => Math.min(100 - coinPct.value, (props.gemNutrition / safeMax.value) * 100))

const etaMs = computed(() => props.drainPerHour > 0 ? (total.value / props.drainPerHour) * 3_600_000 : null)
const gemEtaMs = computed(() => props.drainPerHour > 0 ? (props.gemNutrition / props.drainPerHour) * 3_600_000 : null)
const etaClock = computed(() => etaMs.value === null
  ? null
  : new Date(Date.now() + etaMs.value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))

const hint = computed(() => {
  if (status.value === 'starving') return 'Empty. Every bug has stopped foraging until you feed.'
  if (etaMs.value === null) return 'Not draining: no bugs are eating right now.'
  if (low.value) return `Running low: ${formatDuration(etaMs.value)} left (until about ${etaClock.value}). Feed soon or foraging stops.`
  const lasts = `Lasts ${formatDuration(etaMs.value)} (until about ${etaClock.value}).`
  if (buffed.value) return `${lasts} Gem nutrition is eaten first: the buff lasts about ${formatDuration(gemEtaMs.value ?? 0)}.`
  return `${lasts} Bugs stop foraging at zero.`
})

const tone = {
  healthy: { num: 'text-lime-200', hint: 'text-muted', orb: '', panel: '', emoji: '🍎' },
  low: { num: 'text-orange-300', hint: 'text-orange-300', orb: 'cl-food-orb-low', panel: 'border-orange-400/50', emoji: '🍂' },
  starving: { num: 'text-red-300', hint: 'text-red-300', orb: 'cl-food-orb-starving', panel: 'border-red-400/55', emoji: '🥀' },
  buffed: { num: 'text-sky-300', hint: 'text-sky-300', orb: 'cl-food-orb-gem', panel: 'border-sky-400/55 shadow-[0_0_30px_-12px_rgba(56,189,248,0.7)]', emoji: '💎' }
} as const

const feedClass = computed(() => {
  if (status.value === 'starving') return 'cl-btn-red cl-btn-pulse'
  if (low.value) return 'cl-btn-gold cl-btn-pulse'
  return 'cl-btn-green'
})
</script>

<template>
  <section
    class="cl-panel px-4 py-3.5 sm:px-[18px] sm:py-4"
    :class="tone[status].panel"
    aria-label="Colony nutrition"
  >
    <div class="flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-3 flex-[1_1_260px] min-w-0">
        <span
          class="cl-food-orb hidden sm:grid"
          :class="tone[status].orb"
          aria-hidden="true"
        >{{ tone[status].emoji }}</span>
        <div class="min-w-0">
          <div class="flex items-baseline gap-x-2 gap-y-1 flex-wrap">
            <span class="cl-display text-[17px] sm:text-lg font-semibold">Colony nutrition</span>
            <span
              class="cl-display cl-num text-xl sm:text-[22px] font-bold"
              :class="tone[status].num"
            >{{ formatNumber(Math.round(total), false) }}</span>
            <span class="cl-num text-[13px] font-bold text-muted">/ {{ formatNumber(max, false) }}</span>
            <span
              v-if="status === 'starving'"
              class="cl-chip cl-chip-red self-center"
            >Starving</span>
            <span
              v-else-if="low"
              class="cl-chip cl-chip-warn self-center"
            >Low</span>
            <span
              v-if="buffed"
              class="cl-chip cl-chip-gem self-center"
              :title="`Gem-fed nutrition is active: +${GEM_FEED_YIELD_BONUS} yield and +${GEM_FEED_SPEED_BONUS_PCT}% speed colony-wide until it runs out.`"
            >
              <ColonyCurrencyIcon
                kind="gem"
                :size="13"
              />
              +{{ GEM_FEED_YIELD_BONUS }} yield · +{{ GEM_FEED_SPEED_BONUS_PCT }}% speed
            </span>
          </div>
          <p
            class="text-[12.5px] font-semibold mt-0.5"
            :class="tone[status].hint"
          >
            {{ hint }}
          </p>
        </div>
      </div>
      <div class="flex gap-2.5 flex-wrap">
        <button
          type="button"
          class="cl-btn cl-btn-gem cl-btn-sm"
          :disabled="!canGemFeed || feeding"
          :title="`Each gem adds ${formatNumber(gemNutritionPerGem, false)} nutrition and grants +${GEM_FEED_YIELD_BONUS} yield and +${GEM_FEED_SPEED_BONUS_PCT}% speed colony-wide while it lasts.`"
          :aria-label="gemFeedCost <= 0 ? 'Tank full' : `Gem feed for ${formatNumber(gemFeedCost, false)} gems`"
          @click="emit('gemFeed')"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            aria-hidden="true"
          ><path
            d="M6 3h12l4 6-10 12L2 9z"
            fill="#04213a"
            opacity=".85"
          /></svg>
          <span class="hidden sm:inline">Gem feed ·</span>
          {{ gemFeedCost <= 0 ? 'Full' : formatNumber(gemFeedCost, false) }}
        </button>
        <button
          type="button"
          class="cl-btn cl-btn-sm"
          :class="feedClass"
          :disabled="!canFeed || feeding"
          @click="emit('feed')"
        >
          <UIcon
            :name="feeding ? 'i-lucide-loader-circle' : 'i-lucide-utensils'"
            class="size-4"
            :class="feeding && 'animate-spin'"
          />
          <template v-if="feedCost <= 0">
            Full
          </template>
          <template v-else>
            Feed ·
            <ColonyCurrencyIcon :size="15" />
            {{ formatNumber(feedCost, false) }}
          </template>
        </button>
      </div>
    </div>
    <div
      class="cl-tank mt-3.5 h-6 sm:h-[34px]"
      :class="status === 'starving' && 'cl-tank-empty'"
      role="meter"
      :aria-valuenow="Math.round(total)"
      aria-valuemin="0"
      :aria-valuemax="safeMax"
      aria-label="Nutrition"
    >
      <div
        class="cl-tank-fill"
        :class="low && 'cl-tank-low'"
        :style="{ width: coinPct + '%' }"
      />
      <div
        class="cl-tank-gem"
        :style="{ left: coinPct + '%', width: gemPct + '%' }"
      />
      <div class="cl-tank-ticks" />
      <div class="cl-tank-gloss" />
    </div>
  </section>
</template>
