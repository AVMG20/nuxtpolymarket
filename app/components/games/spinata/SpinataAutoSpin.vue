<script setup lang="ts">
// Auto-spin setup for Spiñata: number of spins plus optional stop rules.

export interface SpinataAutoSpinSettings {
  count: number
  stopOnFeature: boolean
  /** Stop after a single round pays at least this many times the bet (0 = off). */
  winLimit: number
  /** Stop once the balance has dropped this share below where auto-spin started (0 = off). */
  lossLimit: number
}

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ start: [settings: SpinataAutoSpinSettings] }>()

const COUNTS = [10, 25, 50, 100, 250, 500]
const WIN_LIMITS = [0, 10, 50, 100]
const LOSS_LIMITS = [0, 0.25, 0.5, 0.75]

const count = ref(50)
const stopOnFeature = ref(true)
const winLimit = ref(0)
const lossLimit = ref(0)

const sound = useSpinataSound()

function pickCount(n: number) {
  count.value = n
  sound.play('click')
}

function start() {
  sound.play('press')
  emit('start', { count: count.value, stopOnFeature: stopOnFeature.value, winLimit: winLimit.value, lossLimit: lossLimit.value })
  open.value = false
}

function close() {
  sound.play('click')
  open.value = false
}

function onKey(e: KeyboardEvent) {
  if (open.value && e.key === 'Escape') close()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="spn-modal">
      <div
        v-if="open"
        class="spn-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spn-auto-title"
        @click.self="close"
      >
        <div class="spn-modal__card">
          <header class="spn-modal__head">
            <h2 id="spn-auto-title">
              Auto spin
            </h2>
            <button
              class="spn-modal__x"
              aria-label="Close"
              @click="close"
            >
              <UIcon
                name="i-lucide-x"
                class="size-5"
              />
            </button>
          </header>

          <p class="spn-modal__label">
            Number of spins
          </p>
          <div class="spn-auto__counts">
            <button
              v-for="n in COUNTS"
              :key="n"
              class="spn-chip spn-chip--big"
              :class="{ 'spn-chip--on': count === n }"
              @click="pickCount(n)"
            >
              {{ n }}
            </button>
          </div>

          <p class="spn-modal__label">
            Stop auto spin
          </p>
          <label class="spn-auto__toggle">
            <input
              v-model="stopOnFeature"
              type="checkbox"
            >
            <span class="spn-auto__switch" />
            When free spins trigger
          </label>

          <div class="spn-auto__rule">
            <span>On a single win of</span>
            <div class="spn-auto__opts">
              <button
                v-for="w in WIN_LIMITS"
                :key="w"
                class="spn-chip"
                :class="{ 'spn-chip--on': winLimit === w }"
                @click="winLimit = w; sound.play('click')"
              >
                {{ w === 0 ? 'Off' : `${w}×` }}
              </button>
            </div>
          </div>

          <div class="spn-auto__rule">
            <span>If balance drops by</span>
            <div class="spn-auto__opts">
              <button
                v-for="l in LOSS_LIMITS"
                :key="l"
                class="spn-chip"
                :class="{ 'spn-chip--on': lossLimit === l }"
                @click="lossLimit = l; sound.play('click')"
              >
                {{ l === 0 ? 'Off' : `${l * 100}%` }}
              </button>
            </div>
          </div>

          <button
            class="spn-modal__go"
            @click="start"
          >
            Start {{ count }} spins
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.spn-auto__counts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 18px;
}
.spn-auto__toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: #f4e4ff;
  cursor: pointer;
  margin-bottom: 12px;
}
.spn-auto__toggle input { position: absolute; opacity: 0; pointer-events: none; }
.spn-auto__switch {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  transition: background 0.15s;
  flex-shrink: 0;
}
.spn-auto__switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s;
}
.spn-auto__toggle input:checked + .spn-auto__switch { background: linear-gradient(90deg, #ff3d7f, #ffb400); }
.spn-auto__toggle input:checked + .spn-auto__switch::after { transform: translateX(18px); }
.spn-auto__toggle input:focus-visible + .spn-auto__switch { outline: 2px solid #ffd23f; outline-offset: 2px; }
.spn-auto__rule {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 14px;
  color: #f4e4ff;
  margin-bottom: 10px;
}
.spn-auto__opts { display: flex; gap: 6px; }
</style>

<style>
/* Shared by the Spiñata modals (auto spin, rules, buy confirm). */
.spn-modal {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(8, 0, 16, 0.72);
  backdrop-filter: blur(4px);
}
.spn-modal__card {
  position: relative;
  width: min(440px, 100%);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 20px 20px 18px;
  border-radius: 22px;
  color: #f4e4ff;
  background:
    radial-gradient(120% 60% at 50% 0%, rgba(255, 61, 127, 0.22), transparent 60%),
    linear-gradient(180deg, #2c0b3f, #1a0526);
  border: 2px solid #f5b83d;
  box-shadow: 0 0 0 5px #5a1846, 0 0 0 7px rgba(245, 184, 61, 0.45), 0 30px 80px rgba(0, 0, 0, 0.65);
}
.spn-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.spn-modal__head h2 {
  font-family: 'Lilita One', 'Arial Black', system-ui, sans-serif;
  font-size: 28px;
  line-height: 1;
  color: #ffd23f;
  text-shadow: 0 3px 0 #6b1640;
  letter-spacing: 0.02em;
}
.spn-modal__x {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: #f4e4ff;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
}
.spn-modal__x:hover { background: rgba(255, 255, 255, 0.16); }
.spn-modal__label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255, 220, 160, 0.7);
  margin-bottom: 8px;
}
.spn-chip {
  min-width: 46px;
  padding: 6px 10px;
  border-radius: 10px;
  font-weight: 800;
  font-size: 13px;
  color: #f4e4ff;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: background 0.12s, transform 0.12s;
}
.spn-chip:hover { background: rgba(255, 255, 255, 0.14); }
.spn-chip:active { transform: scale(0.96); }
.spn-chip--big {
  padding: 12px 0;
  font-family: 'Lilita One', 'Arial Black', system-ui, sans-serif;
  font-size: 22px;
  font-weight: 400;
}
.spn-chip--on {
  color: #2a0616;
  background: linear-gradient(180deg, #ffe38a, #ffb400);
  border-color: #fff1b8;
  box-shadow: 0 0 16px rgba(255, 190, 40, 0.45);
}
.spn-modal__go {
  width: 100%;
  margin-top: 14px;
  padding: 14px 0;
  border-radius: 14px;
  font-family: 'Lilita One', 'Arial Black', system-ui, sans-serif;
  font-size: 22px;
  letter-spacing: 0.03em;
  color: #fff;
  text-shadow: 0 2px 0 #7a0f3a;
  background: linear-gradient(180deg, #ff5f9a, #e0185f 60%, #b10d49);
  border: 2px solid #ffc1d8;
  box-shadow: 0 6px 0 #6e0a30, 0 10px 24px rgba(224, 24, 95, 0.45);
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
}
.spn-modal__go:hover { filter: brightness(1.08); }
.spn-modal__go:active { transform: translateY(4px); box-shadow: 0 2px 0 #6e0a30, 0 4px 12px rgba(224, 24, 95, 0.4); }
.spn-modal__go:disabled { opacity: 0.45; cursor: not-allowed; }
.spn-modal-enter-active, .spn-modal-leave-active { transition: opacity 0.2s ease; }
.spn-modal-enter-active .spn-modal__card, .spn-modal-leave-active .spn-modal__card { transition: transform 0.25s cubic-bezier(0.2, 1.4, 0.4, 1); }
.spn-modal-enter-from, .spn-modal-leave-to { opacity: 0; }
.spn-modal-enter-from .spn-modal__card { transform: scale(0.9) translateY(12px); }
.spn-modal-leave-to .spn-modal__card { transform: scale(0.96); }
</style>
