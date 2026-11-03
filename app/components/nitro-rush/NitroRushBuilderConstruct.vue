<script setup lang="ts">
import { BANK_STEPS, nextLabel, SLOPE_STEPS, STRAIGHT_LENGTHS, type BendSize, type Construction, type Curve } from '#shared/utils/nitro-rush/construct'
import type { SectionId } from '#shared/utils/nitro-rush/custom'

/** Building a piece at a time: set the road you want next, watch its ghost, and build it. */
defineProps<{
    choice: Construction
    next: SectionId
    disabled: boolean
    /** The next piece would run too close to other road. */
    blocked: boolean
}>()
defineEmits<{ pick: [change: Partial<Construction>], build: [] }>()

const CURVES: { id: Curve, icon: string, label: string }[] = [
    { id: 'left-180', icon: 'i-lucide-undo-2', label: 'Hairpin left' },
    { id: 'left-90', icon: 'i-lucide-corner-up-left', label: 'Left 90°' },
    { id: 'left-45', icon: 'i-lucide-arrow-up-left', label: 'Left 45°' },
    { id: 'straight', icon: 'i-lucide-arrow-up', label: 'Straight' },
    { id: 'right-45', icon: 'i-lucide-arrow-up-right', label: 'Right 45°' },
    { id: 'right-90', icon: 'i-lucide-corner-up-right', label: 'Right 90°' },
    { id: 'right-180', icon: 'i-lucide-redo-2', label: 'Hairpin right' }
]
const SIZES: { id: BendSize, label: string }[] = [
    { id: 'tight', label: 'TIGHT' },
    { id: 'medium', label: 'MEDIUM' },
    { id: 'wide', label: 'WIDE' }
]
</script>

<template>
  <div class="nr-construct">
    <div class="nr-construct-group">
      <span class="nr-label">DIRECTION</span>
      <div class="nr-toggle is-small is-row" role="radiogroup" aria-label="Direction">
        <button
          v-for="c in CURVES"
          :key="c.id"
          role="radio"
          :aria-checked="choice.curve === c.id"
          :aria-label="c.label"
          :title="c.label"
          :class="{ 'is-active': choice.curve === c.id }"
          @click="$emit('pick', { curve: c.id })"
        >
          <UIcon :name="c.icon" class="size-4" />
        </button>
      </div>
    </div>

    <div v-if="choice.curve === 'straight'" class="nr-construct-group">
      <span class="nr-label">LENGTH</span>
      <div class="nr-toggle is-small is-row" role="radiogroup" aria-label="Length">
        <button
          v-for="l in STRAIGHT_LENGTHS"
          :key="l"
          role="radio"
          :aria-checked="choice.length === l"
          :class="{ 'is-active': choice.length === l }"
          @click="$emit('pick', { length: l })"
        >
          {{ l }}
        </button>
      </div>
    </div>
    <div v-else class="nr-construct-group">
      <span class="nr-label">SIZE</span>
      <div class="nr-toggle is-small is-row" role="radiogroup" aria-label="Size">
        <button
          v-for="s in SIZES"
          :key="s.id"
          role="radio"
          :aria-checked="choice.size === s.id"
          :class="{ 'is-active': choice.size === s.id }"
          @click="$emit('pick', { size: s.id })"
        >
          {{ s.label }}
        </button>
      </div>
    </div>

    <div class="nr-construct-pair">
      <div class="nr-construct-group">
        <span class="nr-label">SLOPE</span>
        <div class="nr-toggle is-small is-row" role="radiogroup" aria-label="Slope">
          <button
            v-for="s in SLOPE_STEPS"
            :key="s.id"
            role="radio"
            :aria-checked="choice.slope === s.id"
            :aria-label="nextLabel(s.id)"
            :title="nextLabel(s.id)"
            :class="{ 'is-active': choice.slope === s.id }"
            @click="$emit('pick', { slope: s.id })"
          >
            <UIcon :name="s.icon" class="size-4" />
          </button>
        </div>
      </div>

      <div class="nr-construct-group">
        <span class="nr-label">BANK</span>
        <div class="nr-toggle is-small is-row" role="radiogroup" aria-label="Bank">
          <button
            v-for="s in BANK_STEPS"
            :key="s.id"
            role="radio"
            :aria-checked="choice.bank === s.id"
            :class="{ 'is-active': choice.bank === s.id }"
            @click="$emit('pick', { bank: s.id })"
          >
            {{ s.name.toUpperCase() }}
          </button>
        </div>
      </div>
    </div>

    <div class="nr-construct-group nr-construct-action">
      <span v-if="blocked" class="nr-label nr-construct-next is-blocked">Too close to other road</span>
      <span v-else class="nr-label nr-construct-next" :title="nextLabel(next)">{{ nextLabel(next) }}</span>
      <div class="flex items-center gap-2">
        <button class="nr-play nr-construct-build" :disabled="disabled || blocked" @click="$emit('build')">BUILD</button>
        <slot />
      </div>
    </div>
  </div>
</template>
