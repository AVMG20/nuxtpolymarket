<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const stopOnBonus = defineModel<boolean>('stopOnBonus', { default: false })
const props = defineProps<{ bet: number, balance: number }>()
const emit = defineEmits<{ pick: [count: number] }>()

const OPTIONS = [10, 25, 50, 100, 250, 500]
const count = ref(25)

const affordable = computed(() => props.bet > 0 ? Math.floor(props.balance / props.bet) : 0)

function start() {
    emit('pick', count.value)
    open.value = false
}

function onKey(e: KeyboardEvent) {
    if (open.value && e.key === 'Escape') open.value = false
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="fith-auto">
      <div
        v-if="open"
        class="fith-auto-backdrop"
        @click.self="open = false"
      >
        <section
          class="fith-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Auto spin"
        >
          <h2>Auto spin</h2>
          <div class="grid">
            <button
              v-for="n in OPTIONS"
              :key="n"
              :class="{ active: count === n }"
              @click="count = n"
            >
              {{ n }}
            </button>
          </div>
          <label class="toggle">
            <input
              v-model="stopOnBonus"
              type="checkbox"
            >
            <span class="track"><span class="knob" /></span>
            Stop when free spins start
          </label>
          <p class="hint">
            {{ formatNumber(count * bet) }} for {{ count }} spins at {{ formatNumber(bet) }} each.
            <template v-if="affordable < count">
              Your balance covers {{ affordable }}.
            </template>
          </p>
          <div class="actions">
            <button
              class="cancel"
              @click="open = false"
            >
              Cancel
            </button>
            <button
              class="go"
              :disabled="affordable < 1"
              @click="start"
            >
              Start {{ count }} spins
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fith-auto-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(6, 3, 1, 0.7);
  backdrop-filter: blur(4px);
}

.fith-auto {
  width: min(380px, 100%);
  padding: 20px;
  border: 2px solid #7a4a1d;
  border-radius: 14px;
  background: linear-gradient(180deg, #241810, #140d08);
  box-shadow: 0 0 0 4px #2b1a0d, 0 0 0 5px #9a6a2e, 0 30px 80px rgba(0, 0, 0, 0.7);
  color: #e9dcc6;
}

h2 {
  margin: 0 0 14px;
  font-family: 'Rye', Georgia, serif;
  font-size: 22px;
  color: #ffd66b;
  text-align: center;
  text-shadow: 0 2px 0 #5a2d06;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.grid button {
  padding: 12px 0;
  border: 1px solid rgba(255, 190, 90, 0.25);
  border-radius: 10px;
  background: linear-gradient(180deg, #3a2616, #24170d);
  color: #f3e7d3;
  font-family: 'Alfa Slab One', Georgia, serif;
  font-size: 20px;
  transition: transform 120ms ease, border-color 120ms ease;
}

.grid button:hover {
  transform: translateY(-1px);
  border-color: rgba(255, 190, 90, 0.6);
}

.grid button.active {
  border-color: #ffb238;
  background: linear-gradient(180deg, #ffcf5a, #d9780f);
  color: #2b1405;
  box-shadow: 0 0 18px rgba(255, 170, 50, 0.45);
}

.toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.track {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: #3a2a1d;
  transition: background 150ms ease;
}

.knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #e9dcc6;
  transition: transform 150ms ease;
}

.toggle input:checked + .track {
  background: #d9780f;
}

.toggle input:checked + .track .knob {
  transform: translateX(18px);
}

.toggle input:focus-visible + .track {
  outline: 2px solid #ffb238;
  outline-offset: 2px;
}

.hint {
  margin: 12px 0 0;
  color: #a8957b;
  font-size: 12.5px;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.actions button {
  flex: 1;
  padding: 11px 0;
  border-radius: 10px;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.cancel {
  background: rgba(255, 255, 255, 0.06);
  color: #d8c8ae;
}

.go {
  background: linear-gradient(180deg, #ff6a3d, #b8260f);
  color: #fff4e0;
  box-shadow: 0 6px 18px rgba(200, 40, 10, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.go:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.fith-auto-enter-active,
.fith-auto-leave-active {
  transition: opacity 160ms ease;
}

.fith-auto-enter-from,
.fith-auto-leave-to {
  opacity: 0;
}
</style>
