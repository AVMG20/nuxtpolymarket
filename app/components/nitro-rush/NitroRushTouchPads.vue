<script setup lang="ts">
import type { Control } from '~/utils/nitro-rush/types'

/** Steering pads and a brake pedal; the gas is held for the player. */
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
      @pointerdown.prevent="$emit('control', 'brake', true)"
      @pointerup="$emit('control', 'brake', false)"
      @pointercancel="$emit('control', 'brake', false)"
      @pointerleave="$emit('control', 'brake', false)"
    >
      <span>BRAKE<br><small>+ STEER: DRIFT</small></span>
    </button>
  </div>
</template>
