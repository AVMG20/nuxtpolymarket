<script setup lang="ts">
/**
 * A compact whole-number amount: type it (10k shorthand works), nudge it with
 * − / +, or jump to Max. The value is clamped to [1, max] when the field
 * loses focus, so the button next to it always acts on a real amount.
 */
const props = withDefaults(defineProps<{
  max: number
  /** Show the − / + buttons. */
  steps?: boolean
  label?: string
  disabled?: boolean
}>(), { steps: false, label: 'Amount', disabled: false })

const model = defineModel<number>({ required: true })

const ceiling = computed(() => Math.max(1, Math.floor(props.max)))
const off = computed(() => props.disabled || props.max < 1)

const text = useAmountInput(model, { integer: true, shorthand: true })
// Only echo shorthand (`2.5k` → 2.500): plain digits already read as typed.
const preview = computed(() => /[a-z]/i.test(text.value) ? amountPreview(text.value, true) : '')

function clamp() {
  const next = Math.min(ceiling.value, Math.max(1, Math.floor(model.value || 1)))
  if (next !== model.value) model.value = next
}

function step(delta: number) {
  model.value = Math.min(ceiling.value, Math.max(1, Math.floor(model.value || 1) + delta))
}

// A shrinking stack (sold, placed elsewhere) pulls the amount down with it.
watch(ceiling, clamp)
</script>

<template>
  <div
    class="cl-qty"
    :class="off && 'opacity-60'"
  >
    <button
      v-if="steps"
      type="button"
      class="cl-qty-btn"
      :disabled="off || model <= 1"
      :aria-label="`${label}: one fewer`"
      @click="step(-1)"
    >
      −
    </button>
    <input
      v-model="text"
      type="text"
      inputmode="numeric"
      class="cl-qty-input"
      :disabled="off"
      :aria-label="label"
      @blur="clamp"
      @keydown.enter="clamp"
    >
    <span
      v-if="preview"
      class="cl-qty-hint"
    >{{ preview }}</span>
    <button
      v-if="steps"
      type="button"
      class="cl-qty-btn"
      :disabled="off || model >= ceiling"
      :aria-label="`${label}: one more`"
      @click="step(1)"
    >
      +
    </button>
    <button
      type="button"
      class="cl-qty-btn cl-qty-max"
      :disabled="off || model >= ceiling"
      @click="model = ceiling"
    >
      Max
    </button>
  </div>
</template>
