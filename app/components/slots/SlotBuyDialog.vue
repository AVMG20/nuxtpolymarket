<script setup lang="ts">
// Buy bonus confirmation. With more than one option the player picks one
// first; nothing is bought until the Buy button in here is pressed.
import SlotDialog from '~/components/slots/SlotDialog.vue'
import type { SlotBuyOption, SlotTheme } from '~/utils/slots/slot-controls'

const props = defineProps<{
  theme: SlotTheme
  options: SlotBuyOption[]
  balance: number
}>()

const emit = defineEmits<{ buy: [id: string] }>()
const open = defineModel<boolean>('open', { default: false })

const selectedId = ref('')
const selected = computed(() => props.options.find(o => o.id === selectedId.value) ?? props.options[0])
const canAfford = computed(() => !!selected.value && props.balance >= selected.value.cost)

watch(open, (isOpen) => {
  if (isOpen) selectedId.value = props.options.find(o => props.balance >= o.cost)?.id ?? props.options[0]?.id ?? ''
})

function buy() {
  if (!selected.value || !canAfford.value) return
  open.value = false
  emit('buy', selected.value.id)
}
</script>

<template>
  <SlotDialog
    v-model:open="open"
    :theme="theme"
    title="Buy bonus"
  >
    <div
      class="sb-options"
      role="radiogroup"
      aria-label="Bonus to buy"
    >
      <button
        v-for="o in options"
        :key="o.id"
        type="button"
        role="radio"
        class="sb-option"
        :class="{ 'is-on': selected?.id === o.id, 'is-single': options.length === 1 }"
        :aria-checked="selected?.id === o.id"
        :disabled="options.length === 1"
        @click="selectedId = o.id"
      >
        <img
          v-if="o.image"
          :src="o.image"
          alt=""
          class="sb-option__img"
        >
        <span class="sb-option__text">
          <span class="sb-option__title">{{ o.title }}</span>
          <span class="sb-option__desc">{{ o.description }}</span>
        </span>
        <span
          class="sb-option__cost"
          :class="{ 'is-short': balance < o.cost }"
        >{{ formatNumber(o.cost) }}</span>
      </button>
    </div>

    <p
      v-if="selected && !canAfford"
      class="sb-note"
    >
      You need {{ formatNumber(selected.cost - balance) }} more coins for this.
    </p>

    <div class="sb-actions">
      <button
        type="button"
        class="sb-btn"
        @click="open = false"
      >
        Cancel
      </button>
      <button
        type="button"
        class="sb-btn sb-btn--buy"
        data-autofocus
        :disabled="!canAfford"
        @click="buy"
      >
        Buy for {{ selected ? formatNumber(selected.cost) : '' }}
      </button>
    </div>
  </SlotDialog>
</template>

<style scoped>
.sb-options {
  display: grid;
  gap: 8px;
}

.sb-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 14px;
  text-align: left;
  color: var(--sc-text);
  background: var(--sc-control);
  box-shadow: inset 0 0 0 2px transparent;
  transition: box-shadow 0.15s, background-color 0.15s;
}

.sb-option:not(.is-single):hover { background: color-mix(in srgb, var(--sc-control), var(--sc-text) 8%); }
.sb-option.is-on:not(.is-single) { box-shadow: inset 0 0 0 2px var(--sc-accent); }
.sb-option:disabled { cursor: default; }
.sb-option:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

.sb-option__img {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  object-fit: contain;
}

.sb-option__text {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.sb-option__title { font-size: 15px; font-weight: 800; }
.sb-option__desc { font-size: 12px; color: var(--sc-muted); }

.sb-option__cost {
  flex-shrink: 0;
  font-family: var(--sc-number-font);
  font-size: 16px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--sc-win);
}

.sb-option__cost.is-short { color: var(--sc-muted); text-decoration: line-through; }

.sb-note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--sc-muted);
}

.sb-actions {
  display: grid;
  grid-template-columns: 1fr 1.6fr;
  gap: 8px;
  margin-top: 16px;
}

.sb-btn {
  height: 46px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--sc-text);
  background: var(--sc-control);
  transition: filter 0.15s, transform 0.1s;
}

.sb-btn--buy {
  color: var(--sc-on-accent);
  background: linear-gradient(180deg, var(--sc-accent), var(--sc-accent-deep));
}

.sb-btn:hover:not(:disabled) { filter: brightness(1.1); }
.sb-btn:active:not(:disabled) { transform: scale(0.98); }
.sb-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.sb-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
</style>
