<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { avgTickYield, MAX_YIELD_LEVEL, releaseRefund } from '#shared/utils/colony'
import { formatDuration, speedTone } from '~/lib/colony-format'

const props = defineProps<{
  stack: any
  releaseMode: boolean
  /** How many of this stack are picked for release. */
  picked: number
  /** Prestige grants can't be released. */
  prestige: boolean
  /** Placing needs a free slot. */
  full: boolean
}>()

const emit = defineEmits<{
  activate: []
  step: [delta: number]
}>()

const locked = computed(() => props.releaseMode && props.prestige)
const disabled = computed(() => props.releaseMode ? props.prestige : props.full)

/** Dormant stacks: the speed trait applied, no colony-wide tracks or social bonus. */
const tickMs = computed(() => props.stack.baseTickMs * (1 - props.stack.speed / 100))
const itemsPerHour = computed(() => tickMs.value > 0 ? (avgTickYield(props.stack.yield) / tickMs.value) * 3_600_000 : 0)
const refund = computed(() => releaseRefund(props.stack.typeId, props.picked))

function onActivate() {
  if (!disabled.value) emit('activate')
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
            {{ stack.emoji }} {{ stack.name }}
          </p>
          <span
            class="cl-chip cl-tc"
            :class="`cl-t${stack.tier}`"
          >T{{ stack.tier }}</span>
        </div>
        <div class="grid grid-cols-3 gap-1.5 text-center">
          <div class="cl-inset py-1.5">
            <p class="cl-eyebrow">
              Speed
            </p>
            <p
              class="font-semibold cl-num"
              :class="speedTone(stack.speed)"
            >
              {{ stack.speed }}%
            </p>
          </div>
          <div class="cl-inset py-1.5">
            <p class="cl-eyebrow">
              Yield
            </p>
            <p class="font-semibold cl-num text-sky-300">
              {{ stack.yield }}/{{ MAX_YIELD_LEVEL }}
            </p>
          </div>
          <div class="cl-inset py-1.5">
            <p class="cl-eyebrow">
              Eats
            </p>
            <p class="font-semibold cl-num">
              {{ stack.eat }}
            </p>
          </div>
        </div>
        <dl class="space-y-1 text-xs">
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Cycle
            </dt>
            <dd class="cl-num font-semibold">
              {{ formatDuration(tickMs) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Per cycle
            </dt>
            <dd class="cl-num font-semibold">
              {{ stack.itemEmoji }} 1–{{ stack.yield + 1 }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Per hour
            </dt>
            <dd class="cl-num font-semibold">
              {{ stack.itemEmoji }} {{ formatNumber(Math.round(itemsPerHour), false) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Coins / hr
            </dt>
            <dd class="cl-num font-semibold text-amber-300">
              {{ formatNumber(itemsPerHour * (stack.itemSellValue ?? 0), false) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Eats / hr
            </dt>
            <dd class="cl-num font-semibold">
              {{ formatNumber(Math.round(stack.feedPerHour), false) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">
              Temperament
            </dt>
            <dd
              class="font-semibold"
              :class="stack.social ? 'text-green-400' : 'text-orange-400'"
            >
              {{ stack.social ? 'Social' : 'Solitary' }}
            </dd>
          </div>
        </dl>
        <p
          v-if="!releaseMode"
          class="text-xs text-muted"
        >
          {{ full ? 'The terrarium is full.' : 'Tap to place one in the terrarium.' }}
        </p>
      </div>
    </template>

    <div
      class="cl-bug select-none"
      :class="[
        `cl-t${stack.tier}`,
        !disabled && 'cl-bug-hover',
        releaseMode && picked && 'cl-bug-pick',
        !releaseMode && full && 'cl-bug-dim'
      ]"
    >
      <div
        role="button"
        class="cl-bug-hit pb-0.5"
        :tabindex="disabled ? -1 : 0"
        :aria-disabled="disabled"
        :aria-pressed="releaseMode ? picked > 0 : undefined"
        :aria-label="releaseMode
          ? `${picked ? 'Unselect' : 'Select'} ${stack.quantity} ${stack.name} for release`
          : `Place a ${stack.name} in the terrarium`"
        @click="onActivate"
        @keydown.enter.prevent="onActivate"
        @keydown.space.prevent="onActivate"
      >
        <span class="cl-bug-tier">T{{ stack.tier }}</span>
        <span class="cl-bug-qty">×{{ formatNumber(stack.quantity) }}</span>
        <span class="cl-bug-art h-[58px] sm:h-[70px]">
          <span class="cl-bug-emoji text-[32px] sm:text-[38px]">{{ stack.emoji }}</span>
        </span>
        <span class="cl-bug-name text-[13px] sm:text-sm">{{ stack.name }}</span>
        <span
          class="cl-pips"
          :aria-label="`Yield ${stack.yield} of ${MAX_YIELD_LEVEL}`"
        >
          <span
            v-for="i in MAX_YIELD_LEVEL"
            :key="i"
            class="cl-pip"
            :class="i <= stack.yield && 'cl-pip-on'"
          />
        </span>
        <span class="cl-bug-stats">
          <span
            class="cl-bug-stat"
            :class="speedTone(stack.speed)"
          >
            <UIcon
              name="i-lucide-zap"
              class="size-2.5 shrink-0 hidden min-[420px]:inline"
            />{{ stack.speed }}%
          </span>
          <span class="cl-bug-stat text-sky-300">Y{{ stack.yield }}</span>
          <span class="cl-bug-stat text-muted">
            <UIcon
              name="i-lucide-utensils"
              class="size-2.5 shrink-0 hidden min-[420px]:inline"
            />{{ stack.eat }}
          </span>
        </span>
      </div>

      <span
        v-if="releaseMode && picked"
        class="cl-check"
        aria-hidden="true"
      >
        <UIcon
          name="i-lucide-check"
          class="size-3.5"
        />
      </span>

      <div
        v-if="releaseMode && !prestige"
        class="cl-stepper"
      >
        <button
          type="button"
          class="cl-step"
          :disabled="!picked"
          :aria-label="`Release one fewer ${stack.name}`"
          @click="emit('step', -1)"
        >
          −
        </button>
        <span class="grid justify-items-center leading-tight min-w-0">
          <span class="cl-display cl-num text-sm font-semibold">{{ picked }}/{{ stack.quantity }}</span>
          <span
            v-if="picked"
            class="cl-num text-xs font-semibold text-amber-400 truncate max-w-full"
          >+{{ formatNumber(refund) }}</span>
        </span>
        <button
          type="button"
          class="cl-step"
          :disabled="picked >= stack.quantity"
          :aria-label="`Release one more ${stack.name}`"
          @click="emit('step', 1)"
        >
          +
        </button>
      </div>

      <div
        v-if="locked"
        class="cl-lock"
      >
        <UIcon
          name="i-lucide-lock"
          class="size-4.5"
        />
        Prestige bug<br>is kept
      </div>
    </div>
  </UTooltip>
</template>
