<script setup lang="ts">
// Autoplay settings, the same in every slot. The last choice is remembered.
import SlotDialog from '~/components/slots/SlotDialog.vue'
import {
  SLOT_AUTO_COUNTS,
  SLOT_AUTO_LOSS_STOPS,
  SLOT_AUTO_WIN_STOPS,
  type SlotAutoSettings,
  type SlotTheme
} from '~/utils/slots/slot-controls'

const props = defineProps<{
  theme: SlotTheme
  /** What one autoplay spin costs. */
  spinCost: number
  balance: number
}>()

const emit = defineEmits<{ start: [settings: SlotAutoSettings] }>()
const open = defineModel<boolean>('open', { default: false })

const STORAGE_KEY = 'slot-autoplay'

const settings = reactive<SlotAutoSettings>({ count: 50, stopOnBonus: false, stopOnWinX: 0, stopOnLossPct: 0 })

onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<SlotAutoSettings> | null
    if (!saved) return
    if ((SLOT_AUTO_COUNTS as readonly number[]).includes(saved.count ?? -1)) settings.count = saved.count!
    if ((SLOT_AUTO_WIN_STOPS as readonly number[]).includes(saved.stopOnWinX ?? -1)) settings.stopOnWinX = saved.stopOnWinX!
    if ((SLOT_AUTO_LOSS_STOPS as readonly number[]).includes(saved.stopOnLossPct ?? -1)) settings.stopOnLossPct = saved.stopOnLossPct!
    settings.stopOnBonus = saved.stopOnBonus === true
  } catch { /* storage blocked or corrupt */ }
})

const total = computed(() => props.spinCost * settings.count)
const affordable = computed(() => Math.floor(props.balance / Math.max(props.spinCost, 1e-9)))

function start() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch { /* storage blocked */ }
  open.value = false
  emit('start', { ...settings })
}
</script>

<template>
  <SlotDialog
    v-model:open="open"
    :theme="theme"
    title="Autoplay"
  >
    <fieldset class="sa-group">
      <legend class="sa-label">
        Spins
      </legend>
      <div class="sa-chips sa-chips--3">
        <button
          v-for="n in SLOT_AUTO_COUNTS"
          :key="n"
          type="button"
          class="sa-chip"
          :class="{ 'is-on': settings.count === n }"
          :aria-pressed="settings.count === n"
          @click="settings.count = n"
        >
          {{ n }}
        </button>
      </div>
    </fieldset>

    <fieldset class="sa-group">
      <legend class="sa-label">
        Stop on a single win of
      </legend>
      <div class="sa-chips sa-chips--5">
        <button
          v-for="x in SLOT_AUTO_WIN_STOPS"
          :key="x"
          type="button"
          class="sa-chip"
          :class="{ 'is-on': settings.stopOnWinX === x }"
          :aria-pressed="settings.stopOnWinX === x"
          @click="settings.stopOnWinX = x"
        >
          {{ x === 0 ? 'Off' : `${x}×` }}
        </button>
      </div>
    </fieldset>

    <fieldset class="sa-group">
      <legend class="sa-label">
        Stop if balance drops by
      </legend>
      <div class="sa-chips sa-chips--5">
        <button
          v-for="p in SLOT_AUTO_LOSS_STOPS"
          :key="p"
          type="button"
          class="sa-chip"
          :class="{ 'is-on': settings.stopOnLossPct === p }"
          :aria-pressed="settings.stopOnLossPct === p"
          @click="settings.stopOnLossPct = p"
        >
          {{ p === 0 ? 'Off' : `${p}%` }}
        </button>
      </div>
    </fieldset>

    <button
      type="button"
      role="switch"
      class="sa-switch"
      :aria-checked="settings.stopOnBonus"
      @click="settings.stopOnBonus = !settings.stopOnBonus"
    >
      <span>Stop when a bonus starts</span>
      <span
        class="sa-switch__track"
        :class="{ 'is-on': settings.stopOnBonus }"
      />
    </button>

    <p class="sa-note">
      {{ settings.count }} × {{ formatNumber(spinCost) }} = <b>{{ formatNumber(total) }}</b>
      <template v-if="affordable < settings.count">
        · your balance covers {{ formatNumber(affordable, false) }}
      </template>
    </p>

    <button
      type="button"
      class="sa-go"
      data-autofocus
      :disabled="affordable < 1"
      @click="start"
    >
      <UIcon
        name="i-lucide-play"
        class="size-4"
      />
      Start {{ settings.count }} spins
    </button>
  </SlotDialog>
</template>

<style scoped>
.sa-group {
  margin: 0 0 14px;
  padding: 0;
  border: 0;
}

.sa-label {
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--sc-muted);
}

.sa-chips {
  display: grid;
  gap: 6px;
}

.sa-chips--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.sa-chips--5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }

.sa-chip {
  height: 38px;
  border-radius: 10px;
  font-family: var(--sc-number-font);
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--sc-text);
  background: var(--sc-control);
  transition: background-color 0.15s, color 0.15s, transform 0.1s;
}

.sa-chip:hover { background: color-mix(in srgb, var(--sc-control), var(--sc-text) 10%); }
.sa-chip:active { transform: scale(0.96); }
.sa-chip.is-on { color: var(--sc-on-accent); background: var(--sc-accent); }
.sa-chip:focus-visible, .sa-switch:focus-visible, .sa-go:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

.sa-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 4px 0;
  font-size: 14px;
  color: var(--sc-text);
}

.sa-switch__track {
  position: relative;
  width: 40px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--sc-control);
  transition: background-color 0.18s;
}

.sa-switch__track::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--sc-muted);
  transition: transform 0.18s, background-color 0.18s;
}

.sa-switch__track.is-on { background: var(--sc-accent); }
.sa-switch__track.is-on::after { transform: translateX(16px); background: var(--sc-on-accent); }

.sa-note {
  margin-top: 14px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--sc-muted);
}

.sa-note b { color: var(--sc-text); font-weight: 700; }

.sa-go {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 46px;
  margin-top: 12px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 800;
  color: var(--sc-on-accent);
  background: linear-gradient(180deg, var(--sc-accent), var(--sc-accent-deep));
  transition: filter 0.15s, transform 0.1s;
}

.sa-go:hover:not(:disabled) { filter: brightness(1.08); }
.sa-go:active:not(:disabled) { transform: scale(0.98); }
.sa-go:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
