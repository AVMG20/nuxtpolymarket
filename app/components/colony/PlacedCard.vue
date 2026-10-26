<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getBug, MAX_YIELD_LEVEL } from '#shared/utils/colony'
import { formatDuration, speedTone } from '~/lib/colony-format'

const props = defineProps<{
  bug: any
  /** 0-100 through the current cycle. */
  progress: number
  countdown: string
  starving: boolean
  /** Placed optimistically, not confirmed by the server yet. */
  pending: boolean
  /** Prestige grants have no spawn cost to refund, so they can't be released. */
  prestige: boolean
  /** The release button was tapped once and waits for a second tap. */
  armed: boolean
}>()

const emit = defineEmits<{
  unplace: []
  release: []
}>()

const RING = 2 * Math.PI * 28
const ringOffset = computed(() => RING * (1 - Math.min(100, Math.max(0, props.progress)) / 100))
/** Gem foragers by species, so an optimistic stand-in (no gemsPerCycle yet) still reads as one. */
const gem = computed(() => props.bug.gemsPerCycle != null || !!getBug(props.bug.typeId)?.producesGems)
const coinsPerHour = computed(() => props.bug.itemsPerHour * props.bug.itemSellValue)
const socialPct = computed(() => Math.round((props.bug.socialMultiplier - 1) * 100))

function perCycle(): string {
  const min = Math.round(props.bug.itemsPerTickMin ?? 1)
  const max = Math.round(props.bug.itemsPerTickMax ?? props.bug.yield + 1)
  return max > min ? `${min}–${max}` : `${min}`
}
</script>

<template>
  <UTooltip
    :delay-duration="300"
    :content="{ side: 'left', sideOffset: 8 }"
    :ui="{ content: 'cl-theme cl-tooltip h-auto max-w-72 p-3 flex-col items-start rounded-xl z-50' }"
  >
    <template #content>
      <div class="w-56 space-y-2.5">
        <div class="flex items-start justify-between gap-2">
          <p class="cl-display font-semibold text-[15px]">
            {{ bug.emoji }} {{ bug.name }}
          </p>
          <span
            class="cl-chip cl-tc"
            :class="`cl-t${bug.tier}`"
          >T{{ bug.tier }}</span>
        </div>
        <dl class="space-y-1 text-xs">
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Speed · Yield · Eats
            </dt>
            <dd class="cl-num font-bold">
              {{ bug.speed }}% · {{ bug.yield }}/{{ MAX_YIELD_LEVEL }} · {{ bug.eat }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Cycle
            </dt>
            <dd class="cl-num font-bold">
              {{ formatDuration(bug.tickMs) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Per cycle
            </dt>
            <dd class="cl-num font-bold">
              {{ bug.itemEmoji }} {{ perCycle() }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Per hour
            </dt>
            <dd class="cl-num font-bold">
              {{ bug.itemEmoji }} {{ formatNumber(Math.round(bug.itemsPerHour), false) }}
            </dd>
          </div>
          <div
            v-if="!gem"
            class="flex justify-between gap-3"
          >
            <dt class="text-muted">
              Coins / hr
            </dt>
            <dd class="cl-num font-bold text-amber-300">
              {{ formatNumber(coinsPerHour, false) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Eats / hr
            </dt>
            <dd class="cl-num font-bold">
              {{ formatNumber(Math.round(bug.feedPerHour), false) }}
            </dd>
          </div>
          <div
            v-if="bug.resourceMultiplier > 1"
            class="flex justify-between gap-3"
          >
            <dt class="text-muted">
              Research
            </dt>
            <dd class="cl-num font-bold text-green-400">
              ×{{ bug.resourceMultiplier }} forage
            </dd>
          </div>
          <div
            v-if="socialPct !== 0"
            class="flex justify-between gap-3"
          >
            <dt class="text-muted">
              Neighbour speed
            </dt>
            <dd
              class="cl-num font-bold"
              :class="socialPct > 0 ? 'text-green-400' : 'text-red-400'"
            >
              {{ socialPct > 0 ? '+' : '' }}{{ socialPct }}%
            </dd>
          </div>
        </dl>
        <p class="text-[11.5px] text-muted">
          Tap to send it back to the Burrow.
        </p>
      </div>
    </template>

    <div
      class="cl-bug group"
      :class="[
        `cl-t${bug.tier}`,
        gem && 'cl-tgem',
        pending ? 'cl-bug-pending' : 'cl-bug-hover',
        starving && 'cl-bug-dim'
      ]"
    >
      <button
        type="button"
        class="cl-bug-hit pb-0.5"
        :disabled="pending"
        :aria-label="`${bug.name}: send back to the Burrow`"
        @click="emit('unplace')"
      >
        <span class="cl-bug-tier">T{{ bug.tier }}</span>
        <span
          class="cl-bug-qty text-[11px] cl-num"
          :class="starving && 'text-red-300'"
        >{{ countdown }}</span>
        <span class="cl-bug-art h-[70px] sm:h-20">
          <svg
            class="cl-ring"
            width="62"
            height="62"
            viewBox="0 0 64 64"
            aria-hidden="true"
          >
            <circle
              class="cl-ring-track"
              cx="32"
              cy="32"
              r="28"
              stroke-width="4"
            />
            <circle
              class="cl-ring-fill"
              :class="[starving && 'cl-ring-starve', gem && 'cl-ring-gem']"
              cx="32"
              cy="32"
              r="28"
              stroke-width="4"
              :stroke-dasharray="RING"
              :stroke-dashoffset="ringOffset"
            />
          </svg>
          <span class="cl-bug-emoji text-[28px] sm:text-[32px]">{{ bug.emoji }}</span>
        </span>
        <span class="cl-bug-name text-[13px] sm:text-sm">{{ bug.name }}</span>
        <span class="flex justify-center gap-1.5 mt-0.5 text-[11.5px] font-extrabold cl-num">
          <span>{{ bug.itemEmoji }} {{ perCycle() }}</span>
          <span
            v-if="socialPct !== 0"
            :class="socialPct > 0 ? 'text-green-400' : 'text-red-400'"
          >{{ socialPct > 0 ? '+' : '' }}{{ socialPct }}%</span>
        </span>
        <span class="cl-bug-stats">
          <span
            class="cl-bug-stat"
            :class="speedTone(bug.speed)"
          >{{ bug.speed }}%</span>
          <span class="cl-bug-stat text-sky-300">Y{{ bug.yield }}</span>
          <span
            class="cl-bug-stat"
            :class="gem ? 'text-sky-300' : 'text-amber-300'"
          >{{ gem ? `${bug.gemsPerCycle ?? ''}💎` : formatNumber(Math.round(coinsPerHour)) }}</span>
        </span>
      </button>

      <!-- Release for a refund: a second tap confirms. Prestige grants have none. -->
      <button
        v-if="!prestige && !pending"
        type="button"
        class="absolute z-[4] top-7 right-1.5 flex items-center justify-center gap-1 h-6 min-w-6 px-1 rounded-lg text-[11px] font-extrabold transition-all"
        :class="armed
          ? 'bg-red-500 text-white shadow-[0_0_12px_rgba(239,68,68,0.7)]'
          : 'bg-black/45 text-muted hover:bg-red-500/80 hover:text-white sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100'"
        :aria-label="armed ? `Tap again to release this ${bug.name} for a refund` : `Release this ${bug.name} for a refund`"
        :title="armed ? 'Tap again to release' : 'Release for 50% of its spawn cost, plus credit for the current cycle'"
        @click.stop="emit('release')"
      >
        <UIcon
          name="i-lucide-x"
          class="size-3"
        />
        <span v-if="armed">Sure?</span>
      </button>
    </div>
  </UTooltip>
</template>
