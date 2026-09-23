<script setup lang="ts">
import type { AgAutoSettings } from '~/utils/slots/aethergates-ui'

// Autoplay setup: number of spins plus two stop conditions.

const emit = defineEmits<{
  close: []
  start: [settings: AgAutoSettings]
}>()

const COUNTS = [10, 25, 50, 100, 250, 500]
const WIN_STOPS = [0, 20, 60, 150]

const count = ref(50)
const stopOnFeature = ref(false)
const stopOnWin = ref(0)

function start() {
  emit('start', { count: count.value, stopOnFeature: stopOnFeature.value, stopOnWin: stopOnWin.value })
}
</script>

<template>
  <div
    class="ag-modal-scrim"
    @click.self="emit('close')"
  >
    <div
      class="ag-modal"
      role="dialog"
      aria-label="Autoplay"
    >
      <button
        class="ag-modal-x"
        aria-label="Close"
        @click="emit('close')"
      >
        <UIcon
          name="i-lucide-x"
          class="size-4"
        />
      </button>
      <h2 class="ag-modal-title">
        Autoplay
      </h2>

      <p class="ag-modal-sub">
        Number of spins
      </p>
      <div class="ag-auto-grid">
        <button
          v-for="n in COUNTS"
          :key="n"
          class="ag-auto-chip"
          :class="{ 'is-on': count === n }"
          @click="count = n"
        >
          {{ n }}
        </button>
      </div>

      <p class="ag-modal-sub">
        Stop when
      </p>
      <label class="ag-auto-row">
        <input
          v-model="stopOnFeature"
          type="checkbox"
        >
        <span>Free spins are triggered</span>
      </label>
      <div class="ag-auto-row">
        <span>A single win reaches</span>
        <div class="ag-auto-seg">
          <button
            v-for="w in WIN_STOPS"
            :key="w"
            class="ag-auto-chip is-small"
            :class="{ 'is-on': stopOnWin === w }"
            @click="stopOnWin = w"
          >
            {{ w ? `${w}×` : 'Off' }}
          </button>
        </div>
      </div>
      <p class="ag-modal-note">
        Autoplay always stops when your balance can't cover the next spin. Free spins wait for a tap before they start.
      </p>

      <button
        class="ag-modal-go"
        @click="start"
      >
        Start {{ count }} spins
      </button>
    </div>
  </div>
</template>

<style scoped>
.ag-modal-scrim {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(3, 2, 12, 0.7);
  backdrop-filter: blur(4px);
}

.ag-modal {
  position: relative;
  width: min(420px, 100%);
  padding: 22px 20px 20px;
  border-radius: 18px;
  border: 2px solid #c9942d;
  background: linear-gradient(180deg, #221655, #0c0827);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 0 0 4px rgba(59, 29, 0, 0.8);
  color: #eef2ff;
}

.ag-modal-x {
  position: absolute;
  top: 12px;
  right: 12px;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  color: #fde68a;
  background: rgba(255, 255, 255, 0.06);
}

.ag-modal-title {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 22px;
  font-weight: 900;
  color: #fde68a;
  text-align: center;
  letter-spacing: 0.08em;
}

.ag-modal-sub {
  margin: 16px 0 8px;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(199, 210, 254, 0.7);
}

.ag-auto-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.ag-auto-chip {
  height: 42px;
  border-radius: 10px;
  border: 1px solid rgba(253, 230, 138, 0.25);
  background: rgba(255, 255, 255, 0.05);
  font-size: 16px;
  font-weight: 900;
  color: #fef3c7;
  transition: background 120ms ease, transform 120ms ease;
}

.ag-auto-chip.is-small {
  height: 32px;
  padding: 0 10px;
  font-size: 13px;
}

.ag-auto-chip:hover {
  transform: translateY(-1px);
}

.ag-auto-chip.is-on {
  border-color: #fcd34d;
  background: linear-gradient(180deg, #fcd34d, #b7791f);
  color: #2a1402;
}

.ag-auto-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  font-size: 14px;
  font-weight: 600;
}

label.ag-auto-row {
  justify-content: flex-start;
  cursor: pointer;
}

.ag-auto-row input {
  width: 18px;
  height: 18px;
  accent-color: #f59e0b;
}

.ag-auto-seg {
  display: flex;
  gap: 6px;
}

.ag-modal-note {
  margin-top: 14px;
  font-size: 12px;
  color: rgba(199, 210, 254, 0.6);
}

.ag-modal-go {
  margin-top: 18px;
  width: 100%;
  height: 50px;
  border-radius: 999px;
  border: 2px solid #3b1d00;
  background: linear-gradient(180deg, #fff1a8, #f5b829 45%, #b45309);
  box-shadow: 0 6px 0 #5a2e02, 0 10px 20px rgba(0, 0, 0, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.6);
  font-family: 'Cinzel', Georgia, serif;
  font-size: 18px;
  font-weight: 900;
  color: #2a1402;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.ag-modal-go:active {
  transform: translateY(3px);
  box-shadow: 0 3px 0 #5a2e02, 0 6px 14px rgba(0, 0, 0, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.6);
}
</style>
