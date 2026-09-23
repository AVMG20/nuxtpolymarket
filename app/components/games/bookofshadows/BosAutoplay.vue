<script setup lang="ts">
import BosDialog from './BosDialog.vue'

interface BosAutoplaySettings {
  count: number
  stopOnFeature: boolean
  stopOnBigWin: boolean
}

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  bet: number
  balance: number
}>()

const emit = defineEmits<{
  start: [settings: BosAutoplaySettings]
}>()

const COUNTS = [10, 25, 50, 100, 250, 500]
const count = ref(25)
const stopOnFeature = ref(true)
const stopOnBigWin = ref(false)

const cost = computed(() => count.value * props.bet)

function start() {
  emit('start', { count: count.value, stopOnFeature: stopOnFeature.value, stopOnBigWin: stopOnBigWin.value })
}
</script>

<template>
  <BosDialog
    v-model:open="open"
    title="Autoplay"
    width="440px"
  >
    <p class="bos-ap-label">
      Number of spins
    </p>
    <div class="bos-ap-counts">
      <button
        v-for="n in COUNTS"
        :key="n"
        type="button"
        class="bos-ap-count"
        :class="{ 'bos-ap-count-on': count === n }"
        @click="count = n"
      >
        {{ n }}
      </button>
    </div>

    <p class="bos-ap-label mt-5">
      Stop when
    </p>
    <label class="bos-ap-toggle">
      <input
        v-model="stopOnFeature"
        type="checkbox"
      >
      <span class="bos-ap-switch" />
      Free spins trigger
    </label>
    <label class="bos-ap-toggle">
      <input
        v-model="stopOnBigWin"
        type="checkbox"
      >
      <span class="bos-ap-switch" />
      A single win reaches 15× bet
    </label>

    <p class="bos-ap-note">
      Up to {{ formatNumber(cost) }} at {{ formatNumber(bet) }} per spin. Autoplay also stops when your balance can't cover the next spin.
    </p>

    <button
      type="button"
      class="bos-ap-start"
      :disabled="balance < bet"
      @click="start"
    >
      Start {{ count }} spins
    </button>
  </BosDialog>
</template>

<style scoped>
.bos-ap-label {
  margin-bottom: 8px;
  color: #bfa47a;
  font-family: Cinzel, Georgia, serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.bos-ap-counts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.bos-ap-count {
  border: 1px solid rgba(214, 170, 90, 0.3);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.35);
  padding: 10px 0;
  color: #e8d9bd;
  font-family: Cinzel, Georgia, serif;
  font-size: 17px;
  font-weight: 900;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease;
}

.bos-ap-count:hover {
  border-color: rgba(240, 195, 106, 0.7);
}

.bos-ap-count-on {
  border-color: #f0c36a;
  background: linear-gradient(180deg, rgba(160, 100, 30, 0.45), rgba(60, 30, 8, 0.6));
  color: #fff3cf;
  box-shadow: 0 0 14px rgba(240, 180, 80, 0.3);
}

.bos-ap-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.bos-ap-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.bos-ap-switch {
  position: relative;
  width: 38px;
  height: 22px;
  flex: 0 0 auto;
  border: 1px solid rgba(214, 170, 90, 0.4);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
  transition: background 160ms ease;
}

.bos-ap-switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #8a7456;
  transition: transform 160ms ease, background 160ms ease;
}

.bos-ap-toggle input:checked + .bos-ap-switch {
  background: rgba(160, 100, 30, 0.55);
}

.bos-ap-toggle input:checked + .bos-ap-switch::after {
  transform: translateX(16px);
  background: #ffd98a;
}

.bos-ap-toggle input:focus-visible + .bos-ap-switch {
  outline: 2px solid #f0c36a;
  outline-offset: 2px;
}

.bos-ap-note {
  margin-top: 14px;
  color: rgba(232, 217, 189, 0.6);
  font-size: 12px;
  line-height: 1.5;
}

.bos-ap-start {
  width: 100%;
  margin-top: 16px;
  border: 1px solid #f0c36a;
  border-radius: 999px;
  background: linear-gradient(180deg, #b8791f, #6b3a08 60%, #3d1f04);
  padding: 12px;
  color: #fff8e0;
  font-family: Cinzel, Georgia, serif;
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  box-shadow: 0 0 20px rgba(240, 170, 60, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.3);
  cursor: pointer;
}

.bos-ap-start:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
