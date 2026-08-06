<script setup lang="ts">
import { LB_CHIPS, LB_RACK_SIZE } from '#shared/utils/live-blackjack/chips'
import { chip } from '~/utils/live-table/art'

const props = withDefaults(defineProps<{
    modelValue: number
    balance: number
    /** Which chip in the visible window to default-select on init (0-indexed). */
    defaultIndex?: number
    muted?: boolean
}>(), {
    defaultIndex: 3
})

const emit = defineEmits<{
    'update:modelValue': [value: number]
}>()

const offset = ref(0)
let initialized = false

/**
 * Anchor the rack window to the player's bankroll — same logic as
 * chipRackFor() — so the largest affordable chip sits near the right end
 * and a billionaire never starts on 1s.
 */
function defaultOffset(balance: number): number {
    let top = 0
    for (let i = 0; i < LB_CHIPS.length; i++) {
        if (LB_CHIPS[i]!.value <= balance) top = i
    }
    const end = Math.min(LB_CHIPS.length, Math.max(LB_RACK_SIZE, top + 2))
    return Math.max(0, end - LB_RACK_SIZE)
}

const window = computed(() => {
    const start = Math.max(0, Math.min(offset.value, LB_CHIPS.length - LB_RACK_SIZE))
    return LB_CHIPS.slice(start, start + LB_RACK_SIZE)
})

const canGoLeft = computed(() => offset.value > 0)
const canGoRight = computed(() => offset.value < LB_CHIPS.length - LB_RACK_SIZE)

function shiftLeft() {
    if (canGoLeft.value) offset.value--
}
function shiftRight() {
    if (canGoRight.value) offset.value++
}

function affordable(value: number): boolean {
    return value <= props.balance
}

function select(value: number) {
    if (!affordable(value)) return
    emit('update:modelValue', value)
}

watch(() => props.balance, (bal) => {
    offset.value = defaultOffset(bal)

    if (!initialized) {
        initialized = true
        if (!props.modelValue || props.modelValue > bal) {
            const win = window.value
            const idx = Math.min(props.defaultIndex, win.length - 1)
            const target = win[idx]
            if (target && target.value <= bal) {
                emit('update:modelValue', target.value)
            } else {
                const fallback = [...win].reverse().find(c => c.value <= bal)
                if (fallback) emit('update:modelValue', fallback.value)
            }
        }
    } else if (props.modelValue > bal) {
        const fallback = LB_CHIPS.find(c => c.value <= bal)
        if (fallback) emit('update:modelValue', fallback.value)
    }
}, { immediate: true })
</script>

<template>
  <div class="lt-rack" :class="{ 'lt-rack-muted': muted }">
    <button
      class="lt-rack-arrow"
      :disabled="!canGoLeft"
      aria-label="Lower chips"
      @click="shiftLeft"
    >
      <UIcon name="i-lucide-chevron-left" />
    </button>
    <span
      v-for="c in window"
      :key="c.value"
      :class="{ 'sel': c.value === modelValue, 'lt-chip-disabled': !affordable(c.value) }"
      @click="select(c.value)"
      v-html="chip(c.value)"
    />
    <button
      class="lt-rack-arrow"
      :disabled="!canGoRight"
      aria-label="Higher chips"
      @click="shiftRight"
    >
      <UIcon name="i-lucide-chevron-right" />
    </button>
  </div>
</template>
