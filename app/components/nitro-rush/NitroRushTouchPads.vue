<script setup lang="ts">
import type { Control } from '~/utils/nitro-rush/types'

/** Steering pads and a pedal that brakes, or drifts with the wheel turned; the gas is held for the player. */
defineEmits<{ control: [control: Control, down: boolean] }>()
</script>

<template>
  <div class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
    <div class="flex gap-2">
      <button
        v-for="c in (['left', 'right'] as const)"
        :key="c"
        class="nr-pad"
        :aria-label="`Steer ${c}`"
        @pointerdown.prevent="$emit('control', c, true)"
        @pointerup="$emit('control', c, false)"
        @pointercancel="$emit('control', c, false)"
        @pointerleave="$emit('control', c, false)"
      >
        <UIcon :name="c === 'left' ? 'i-lucide-chevron-left' : 'i-lucide-chevron-right'" class="size-10" />
      </button>
    </div>
    <button
      class="nr-pad nr-pad-brake"
      aria-label="Brake and drift"
      @pointerdown.prevent="$emit('control', 'drift', true)"
      @pointerup="$emit('control', 'drift', false)"
      @pointercancel="$emit('control', 'drift', false)"
      @pointerleave="$emit('control', 'drift', false)"
    >
      <span>BRAKE<br><small>HOLD + STEER: DRIFT</small></span>
    </button>
  </div>
</template>
