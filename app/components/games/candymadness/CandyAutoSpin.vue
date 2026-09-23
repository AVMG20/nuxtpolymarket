<script setup lang="ts">
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
  <Teleport to="body">
    <Transition name="cma">
      <div
        v-if="open"
        class="cma"
        @click.self="open = false"
      >
        <div
          class="cma__panel"
          role="dialog"
          aria-label="Auto spin"
        >
          <h2 class="cma__title">
            Auto spin
          </h2>
          <div class="cma__opts">
            <button
              v-for="n in OPTIONS"
              :key="n"
              :class="{ on: count === n }"
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
            Up to <b>{{ formatNumber(total, false) }}</b> over {{ count }} spins
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
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cma {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(20, 2, 30, 0.72);
  backdrop-filter: blur(4px);
  font-family: 'Fredoka', system-ui, sans-serif;
}

.cma__panel {
  width: min(400px, 100%);
  padding: 20px;
  border-radius: 26px;
  color: #fbeaff;
  background: linear-gradient(180deg, #4a1466 0%, #2b0a3d 100%);
  border: 3px solid #ff8ccb;
  box-shadow: 0 0 0 5px #5a1650, 0 0 0 8px #ffd35a, 0 30px 80px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cma__title {
  font-family: 'Lilita One', system-ui, sans-serif;
  font-size: 26px;
  text-align: center;
  color: #ffd35a;
  text-shadow: 0 3px 0 #7d1350;
}

.cma__opts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.cma__opts button {
  padding: 12px 0;
  border-radius: 16px;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: transform 0.1s;
}

.cma__opts button:hover { transform: translateY(-1px); background: rgba(255, 255, 255, 0.14); }

.cma__opts button.on {
  color: #4a0b3d;
  background: linear-gradient(180deg, #ffe38a, #ffb52e);
  border-color: #fff3c2;
  box-shadow: 0 3px 0 #b26a00;
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
.cma__row small { font-size: 12px; color: #cfb0de; }

.cma__row input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.cma__switch {
  flex: none;
  position: relative;
  width: 46px;
  height: 26px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.15);
  transition: background 0.2s;
}

.cma__switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}

.cma__row input:checked + .cma__switch { background: #3fd98a; }
.cma__row input:checked + .cma__switch::after { transform: translateX(20px); }
.cma__row input:focus-visible + .cma__switch { outline: 2px solid #ffd35a; outline-offset: 2px; }

.cma__total {
  text-align: center;
  font-size: 13px;
  color: #d9bde8;
}

.cma__total b { color: #fff; }

.cma__actions {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 10px;
}

.cma__cancel, .cma__go {
  padding: 12px;
  border-radius: 999px;
  font-weight: 700;
  cursor: pointer;
}

.cma__cancel { color: #e7c4f5; background: rgba(255, 255, 255, 0.08); }

.cma__go {
  color: #fff;
  font-size: 16px;
  background: linear-gradient(180deg, #5ef2a8, #16b86a);
  box-shadow: 0 4px 0 #0b7a45, inset 0 2px 0 rgba(255, 255, 255, 0.5);
  text-shadow: 0 1px 0 rgba(0, 80, 40, 0.6);
}

.cma__go:active { transform: translateY(2px); box-shadow: 0 2px 0 #0b7a45; }

.cma-enter-active, .cma-leave-active { transition: opacity 0.2s; }
.cma-enter-from, .cma-leave-to { opacity: 0; }
</style>
