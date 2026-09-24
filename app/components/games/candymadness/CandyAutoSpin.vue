<script setup lang="ts">
import '~/assets/css/candy-madness.css'
// Auto-spin picker for Candy Madness.
const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ spinCost: number }>()
const emit = defineEmits<{ start: [opts: { count: number, stopOnBonus: boolean }] }>()

const OPTIONS = [10, 25, 50, 100, 250, 500]
const count = ref(25)
const stopOnBonus = ref(false)

const total = computed(() => props.spinCost * count.value)

function start() {
  emit('start', { count: count.value, stopOnBonus: stopOnBonus.value })
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Auto spin"
    :ui="{ overlay: 'bg-default/80 backdrop-blur-sm z-[100]', content: 'candy-theme max-w-[400px] rounded-2xl ring-default z-[101]' }"
  >
    <template #content>
      <div class="cma__panel">
        <h2 class="cma__title">
          Auto spin
        </h2>
        <div class="cma__opts">
          <button
            v-for="n in OPTIONS"
            :key="n"
            :class="{ on: count === n }"
            :aria-pressed="count === n"
            @click="count = n"
          >
            {{ n }}
          </button>
        </div>
        <label class="cma__row">
          <span>
            <b>Stop when free spins trigger</b>
            <small>Otherwise auto spin waits for a tap before each bonus.</small>
          </span>
          <input
            v-model="stopOnBonus"
            type="checkbox"
          >
          <i class="cma__switch" />
        </label>
        <p class="cma__total">
          Up to <b>{{ formatNumber(total) }}</b> over {{ count }} spins
        </p>
        <div class="cma__actions">
          <button
            class="cma__cancel"
            @click="open = false"
          >
            Cancel
          </button>
          <button
            class="cma__go"
            @click="start"
          >
            Start {{ count }} spins
          </button>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.cma__panel {
  width: 100%;
  max-height: inherit;
  overflow-y: auto;
  padding: 22px;
  color: var(--ui-text);
  background: var(--candy-surface);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.cma__title {
  font-family: 'Lilita One', system-ui, sans-serif;
  font-size: 26px;
  text-align: center;
  color: var(--ui-text-highlighted);
}

.cma__opts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.cma__opts button {
  padding: 10px 0;
  border-radius: 10px;
  font-size: 18px;
  font-weight: 500;
  color: var(--ui-text);
  background: var(--candy-bg);
  border: 1px solid var(--candy-border);
  cursor: pointer;
  transition: background 0.15s;
}

.cma__opts button:hover {
  background: var(--candy-elevated);
}

.cma__opts button.on {
  color: var(--ui-text-highlighted);
  background: var(--candy-soft);
  border-color: var(--candy-accent);
}

.cma__row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}

.cma__row span { display: flex; flex-direction: column; gap: 2px; }
.cma__row b { font-weight: 600; font-size: 14.5px; }
.cma__row small {
  font-size: 12px;
  line-height: 1.5;
  color: var(--ui-text-muted);
}

.cma__row input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.cma__switch {
  flex: none;
  position: relative;
  width: 40px;
  height: 24px;
  border-radius: 999px;
  background: var(--ui-bg-accented);
  transition: background 0.2s;
}

.cma__switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--ui-text-highlighted);
  transition: transform 0.2s;
}

.cma__row input:checked + .cma__switch {
  background: var(--candy-accent);
}
.cma__row input:checked + .cma__switch::after {
  transform: translateX(16px);
}
.cma__row input:focus-visible + .cma__switch {
  outline: 2px solid var(--candy-accent);
  outline-offset: 3px;
}

.cma__total {
  text-align: center;
  font-size: 13px;
  color: var(--ui-text-muted);
}

.cma__total b {
  color: var(--ui-text-highlighted);
}

.cma__actions {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 10px;
}

.cma__cancel, .cma__go {
  padding: 11px;
  border-radius: 10px;
  font-weight: 500;
  cursor: pointer;
}

.cma__cancel {
  color: var(--ui-text);
  background: var(--candy-bg);
  border: 1px solid var(--candy-border);
}

.cma__go {
  color: var(--ui-text-inverted);
  font-size: 15px;
  background: var(--candy-accent);
}

.cma__go:active {
  transform: translateY(1px);
}

</style>
