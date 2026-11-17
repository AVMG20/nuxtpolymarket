<script setup lang="ts">
import { FIELD_PRESETS } from '#shared/utils/nitro-rush/field-edit'
import { FIELD_MAX, FIELD_TILE } from '#shared/utils/nitro-rush/field'

/** A field's width and length on the 20 m grid, with square presets. */
const props = defineProps<{ width: number, length: number }>()
const emit = defineEmits<{ change: [width: number, length: number] }>()

const STEPS = Array.from({ length: FIELD_MAX / FIELD_TILE }, (_, i) => (i + 1) * FIELD_TILE)

const pick = (e: Event) => Number((e.target as HTMLSelectElement).value)
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-white/60">
    <span class="nr-label">SIZE</span>
    <select class="nr-select" aria-label="Field width" :value="width" @change="emit('change', pick($event), props.length)">
      <option v-for="s in STEPS" :key="s" :value="s">{{ s }} m</option>
    </select>
    <span>×</span>
    <select class="nr-select" aria-label="Field length" :value="length" @change="emit('change', props.width, pick($event))">
      <option v-for="s in STEPS" :key="s" :value="s">{{ s }} m</option>
    </select>
    <div class="nr-toggle is-small is-row" role="radiogroup" aria-label="Preset sizes">
      <button
        v-for="p in FIELD_PRESETS"
        :key="p"
        role="radio"
        :aria-checked="width === p && length === p"
        :class="{ 'is-active': width === p && length === p }"
        @click="emit('change', p, p)"
      >
        {{ p }}×{{ p }}
      </button>
    </div>
  </div>
</template>
