<script setup lang="ts">
// The control bar every slot shares: balance, bet, max, spin, auto, turbo,
// buy bonus, sound, info and the win meter, in the same order and sizes in
// every game. Games keep their own logic (bet ladder, costs, sounds) and
// react to the events; only the colours come from the game's theme.
//
// Space spins, stops or skips (never while typing or with a dialog open).
import SlotAutoSpinDialog from '~/components/slots/SlotAutoSpinDialog.vue'
import SlotBuyDialog from '~/components/slots/SlotBuyDialog.vue'
import {
  slotAmount,
  slotThemeVars,
  type SlotAutoSettings,
  type SlotBuyOption,
  type SlotSpinMode,
  type SlotTheme
} from '~/utils/slots/slot-controls'

const props = withDefaults(defineProps<{
  theme: SlotTheme
  balance: number
  bet: number
  betMin: number
  betMax: number
  /** Bet, max and buy are locked while a round or autoplay runs. */
  betLocked: boolean
  /** Small line under the bet, e.g. the line bet or an ante cost. */
  betHint?: string
  win: number
  winLabel?: string
  /** Small line under the win, e.g. "120 × 4". */
  winNote?: string
  /** Bump this to replay the win meter's pop. */
  winPulse?: number
  /** Bump this to shake the balance (not enough coins). */
  balanceShake?: number
  spinMode: SlotSpinMode
  /** Only applies to spinMode 'spin': e.g. not loaded yet or balance too low. */
  spinDisabled?: boolean
  /** Autoplay spins left; 0 when autoplay is off. */
  autoLeft: number
  autoDisabled?: boolean
  /** What one autoplay spin costs; defaults to the bet. */
  spinCost?: number
  turbo: boolean
  buys?: SlotBuyOption[]
  buyDisabled?: boolean
  /** A game dialog (paytable, rules) is open: leave Space alone. */
  spaceBlocked?: boolean
  /** Runs before Space presses spin; return true when the game handled it (closing an overlay, skipping a big win). */
  interceptSpace?: () => boolean
}>(), {
  betHint: '',
  winLabel: 'Win',
  winNote: '',
  winPulse: 0,
  balanceShake: 0,
  spinDisabled: false,
  autoDisabled: false,
  spinCost: undefined,
  buys: () => [],
  buyDisabled: false,
  spaceBlocked: false,
  interceptSpace: undefined
})

const emit = defineEmits<{
  'spin': []
  'bet-down': []
  'bet-up': []
  'bet-max': []
  'bet-set': [value: number]
  'auto-start': [settings: SlotAutoSettings]
  'auto-stop': []
  'toggle-turbo': []
  'buy': [id: string]
  'info': []
  /** A menu or dialog opened: play the game's click. */
  'ui-click': []
}>()

const soundOn = defineModel<boolean>('soundOn', { required: true })
const volume = defineModel<number>('volume', { required: true })
/** Only games with music bind this; the Music slider is hidden otherwise. */
const musicVolume = defineModel<number | undefined>('musicVolume', { default: undefined })

const themeStyle = computed(() => slotThemeVars(props.theme))
const hasMusic = computed(() => musicVolume.value !== undefined)
const autoOn = computed(() => props.autoLeft > 0)

// --- bet -------------------------------------------------------------------
const editing = ref(false)
const draft = ref(props.bet)
const draftText = useAmountInput(draft, { integer: true, shorthand: true })
const betInput = ref<HTMLInputElement>()
const betPreview = computed(() => (editing.value ? amountPreview(draftText.value, true) : ''))

function editBet() {
  if (props.betLocked) return
  draft.value = props.bet
  draftText.value = String(props.bet)
  editing.value = true
  nextTick(() => {
    betInput.value?.focus()
    betInput.value?.select()
  })
}

function commitBet() {
  if (!editing.value) return
  editing.value = false
  if (draft.value > 0 && draft.value !== props.bet) emit('bet-set', draft.value)
}

function cancelBet() {
  editing.value = false
}

watch(() => props.betLocked, (locked) => {
  if (locked) editing.value = false
})

// --- spin ------------------------------------------------------------------
const spinBlocked = computed(() => {
  if (autoOn.value) return false
  if (props.spinMode === 'wait') return true
  return props.spinMode === 'spin' && props.spinDisabled
})

const spinLabel = computed(() => {
  if (autoOn.value) return `Stop autoplay, ${props.autoLeft} spins left`
  if (props.spinMode === 'stop') return 'Stop reels'
  if (props.spinMode === 'skip') return 'Skip'
  if (props.spinMode === 'wait') return 'Playing'
  return 'Spin'
})

function pressSpin() {
  if (autoOn.value) {
    emit('auto-stop')
    return
  }
  if (spinBlocked.value) return
  emit('spin')
}

// --- auto / buy / sound ----------------------------------------------------
const showAuto = ref(false)
const showBuy = ref(false)
const showSound = ref(false)
const soundWrap = ref<HTMLElement>()

function pressAuto() {
  if (autoOn.value) {
    emit('auto-stop')
    return
  }
  if (props.autoDisabled) return
  emit('ui-click')
  showAuto.value = true
}

function startAuto(settings: SlotAutoSettings) {
  emit('auto-start', settings)
}

function pressBuy() {
  if (props.buyDisabled || !props.buys.length) return
  emit('ui-click')
  showBuy.value = true
}

function toggleSoundPanel() {
  showSound.value = !showSound.value
  if (showSound.value) emit('ui-click')
}

const buyPrice = computed(() => {
  if (!props.buys.length) return ''
  const min = Math.min(...props.buys.map(b => b.cost))
  return props.buys.length > 1 ? `from ${formatNumber(min)}` : formatNumber(min)
})

const soundIcon = computed(() => (!soundOn.value || volume.value <= 0 ? 'i-lucide-volume-x' : volume.value < 40 ? 'i-lucide-volume-1' : 'i-lucide-volume-2'))

function onPointerDown(e: PointerEvent) {
  if (showSound.value && soundWrap.value && !soundWrap.value.contains(e.target as Node)) showSound.value = false
}

// Close the buy dialog if a round starts from elsewhere (autoplay, Space).
watch(() => props.buyDisabled, (disabled) => {
  if (disabled) showBuy.value = false
})

// --- keyboard --------------------------------------------------------------
const winEl = ref<HTMLElement>()
defineExpose({ winEl })

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
}

function spaceIgnored(e: KeyboardEvent) {
  return e.code !== 'Space' || isTyping(e.target) || props.spaceBlocked || showAuto.value || showBuy.value
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showSound.value) {
    showSound.value = false
    return
  }
  if (spaceIgnored(e)) return
  e.preventDefault()
  if (e.repeat) return
  // A focused button would click again on keyup.
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur()
  if (props.interceptSpace?.()) return
  pressSpin()
}

function onKeyup(e: KeyboardEvent) {
  if (!spaceIgnored(e)) e.preventDefault()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  window.addEventListener('pointerdown', onPointerDown, { capture: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  window.removeEventListener('pointerdown', onPointerDown, { capture: true })
})
</script>

<template>
  <div
    class="sc"
    :style="themeStyle"
  >
    <div class="sc-grid">
      <!-- Balance and win, read left to right -->
      <div class="sc-zone sc-zone--meters">
        <div
          :key="`bal${balanceShake}`"
          class="sc-meter sc-a-bal"
          :class="{ 'is-shake': balanceShake > 0 }"
        >
          <span class="sc-label">Balance</span>
          <span class="sc-value">
            <span class="sc-wide">{{ slotAmount(balance) }}</span>
            <span class="sc-narrow">{{ slotAmount(balance, true) }}</span>
          </span>
        </div>
        <span class="sc-divider" aria-hidden="true" />
        <div
          ref="winEl"
          class="sc-meter sc-meter--win sc-a-win"
          :class="{ 'is-hot': win > 0 }"
          aria-live="polite"
        >
          <span class="sc-label">{{ winLabel }}</span>
          <span
            :key="`win${winPulse}`"
            class="sc-value"
            :class="{ 'is-pop': winPulse > 0 && win > 0 }"
          >{{ slotAmount(win) }}</span>
          <span
            v-if="winNote"
            class="sc-meter__note"
          >{{ winNote }}</span>
        </div>
      </div>

      <!-- Bet · SPIN · auto/turbo, with the spin button dead centre -->
      <div class="sc-zone sc-zone--play">
        <div
          class="sc-bet sc-a-bet"
          :class="{ 'is-locked': betLocked }"
        >
          <div class="sc-bet__col">
            <span class="sc-label">Bet</span>
            <div class="sc-bet__row">
              <button
                type="button"
                class="sc-step"
                aria-label="Lower bet"
                :disabled="betLocked || bet <= betMin"
                @click="emit('bet-down')"
              >
                <UIcon
                  name="i-lucide-minus"
                  class="size-4"
                />
              </button>
              <input
                v-if="editing"
                ref="betInput"
                v-model="draftText"
                class="sc-bet__input"
                inputmode="decimal"
                autocomplete="off"
                aria-label="Bet amount"
                @blur="commitBet"
                @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                @keydown.esc.prevent="cancelBet"
              >
              <button
                v-else
                type="button"
                class="sc-bet__value"
                :disabled="betLocked"
                :aria-label="`Bet ${formatNumber(bet, false)}, click to type a bet`"
                title="Click to type a bet (10k, 2.5m)"
                @click="editBet"
              >
                {{ formatNumber(bet) }}
              </button>
              <button
                type="button"
                class="sc-step"
                aria-label="Raise bet"
                :disabled="betLocked || bet >= betMax"
                @click="emit('bet-up')"
              >
                <UIcon
                  name="i-lucide-plus"
                  class="size-4"
                />
              </button>
            </div>
            <output
              v-if="betPreview"
              class="sc-bet__preview"
            >{{ betPreview }}</output>
            <span
              v-else-if="betHint"
              class="sc-bet__hint"
            >{{ betHint }}</span>
          </div>
          <button
            type="button"
            class="sc-tile sc-tile--max"
            :disabled="betLocked"
            aria-label="Max bet"
            @click="emit('bet-max')"
          >
            <UIcon
              name="i-lucide-chevrons-up"
              class="sc-tile__icon"
            />
            <span class="sc-tile__label">Max</span>
          </button>
        </div>
        <button
          type="button"
          class="sc-spin sc-a-spin"
          :class="[`is-${autoOn ? 'auto' : spinMode}`]"
          :disabled="spinBlocked"
          :aria-label="spinLabel"
          @click="pressSpin"
        >
          <span class="sc-spin__face">
            <template v-if="autoOn">
              <span class="sc-spin__count">{{ autoLeft }}</span>
              <span class="sc-spin__text">Stop</span>
            </template>
            <template v-else-if="spinMode === 'stop'">
              <UIcon
                name="i-lucide-square"
                class="sc-spin__icon sc-spin__icon--sm"
              />
              <span class="sc-spin__text">Stop</span>
            </template>
            <template v-else-if="spinMode === 'skip'">
              <UIcon
                name="i-lucide-fast-forward"
                class="sc-spin__icon sc-spin__icon--sm"
              />
              <span class="sc-spin__text">Skip</span>
            </template>
            <UIcon
              v-else-if="spinMode === 'wait'"
              name="i-lucide-loader-circle"
              class="sc-spin__icon animate-spin"
            />
            <UIcon
              v-else
              name="i-lucide-rotate-cw"
              class="sc-spin__icon sc-spin__icon--turn"
            />
          </span>
        </button>
        <div class="sc-mods">
          <button
            type="button"
            class="sc-tile sc-a-auto"
            :class="{ 'is-on': autoOn }"
            :disabled="!autoOn && autoDisabled"
            :aria-label="autoOn ? 'Stop autoplay' : 'Autoplay'"
            @click="pressAuto"
          >
            <UIcon
              :name="autoOn ? 'i-lucide-square' : 'i-lucide-repeat'"
              class="sc-tile__icon"
            />
            <span class="sc-tile__label">{{ autoOn ? 'Stop' : 'Auto' }}</span>
          </button>
          <button
            type="button"
            class="sc-tile sc-a-turbo"
            :class="{ 'is-on': turbo }"
            :aria-pressed="turbo"
            aria-label="Turbo"
            @click="emit('toggle-turbo')"
          >
            <UIcon
              name="i-lucide-zap"
              class="sc-tile__icon"
            />
            <span class="sc-tile__label">Turbo</span>
          </button>
        </div>
      </div>

      <!-- Buy bonus and the quiet utilities -->
      <div class="sc-zone sc-zone--extra">
        <button
          v-if="buys.length"
          type="button"
          class="sc-buy sc-a-buy"
          :disabled="buyDisabled"
          :aria-label="`Buy bonus, ${buyPrice}`"
          @click="pressBuy"
        >
          <span class="sc-buy__label">Buy bonus</span>
          <span class="sc-buy__price">{{ buyPrice }}</span>
        </button>
        <div class="sc-utils">
          <button
            type="button"
            class="sc-icon sc-a-info"
            aria-label="Paytable and rules"
            title="Paytable and rules"
            @click="emit('info')"
          >
            <UIcon
              name="i-lucide-info"
              class="size-5"
            />
          </button>
          <div
            ref="soundWrap"
            class="sc-sound sc-a-sound"
          >
            <button
              type="button"
              class="sc-icon"
              :class="{ 'is-open': showSound }"
              :aria-expanded="showSound"
              aria-haspopup="true"
              aria-label="Sound settings"
              title="Sound"
              @click="toggleSoundPanel"
            >
              <UIcon
                :name="soundIcon"
                class="size-5"
              />
            </button>
            <Transition name="sc-pop">
              <div
                v-if="showSound"
                class="sc-sound__panel"
                role="group"
                aria-label="Sound settings"
              >
                <button
                  type="button"
                  role="switch"
                  class="sc-sound__row sc-sound__switch"
                  :aria-checked="soundOn"
                  @click="soundOn = !soundOn"
                >
                  <span>Sound</span>
                  <span
                    class="sc-switch"
                    :class="{ 'is-on': soundOn }"
                  />
                </button>
                <label class="sc-sound__row">
                  <span>Effects</span>
                  <input
                    v-model.number="volume"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    class="sc-range"
                    :style="{ '--fill': `${volume}%` }"
                    :disabled="!soundOn"
                    aria-label="Effects volume"
                  >
                </label>
                <label
                  v-if="hasMusic"
                  class="sc-sound__row"
                >
                  <span>Music</span>
                  <input
                    v-model.number="musicVolume"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    class="sc-range"
                    :style="{ '--fill': `${musicVolume}%` }"
                    :disabled="!soundOn"
                    aria-label="Music volume"
                  >
                </label>
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </div>

    <SlotAutoSpinDialog
      v-model:open="showAuto"
      :theme="theme"
      :spin-cost="spinCost ?? bet"
      :balance="balance"
      @start="startAuto"
    />
    <SlotBuyDialog
      v-if="buys.length"
      v-model:open="showBuy"
      :theme="theme"
      :options="buys"
      :balance="balance"
      @buy="emit('buy', $event)"
    />
  </div>
</template>

<style scoped>
.sc {
  container-type: inline-size;
  container-name: sc;
  width: 100%;
  color: var(--sc-text);
  font-family: var(--sc-font);
}

/* Wide cabinets, one row in three zones:
   balance · win  |  bet · SPIN · auto/turbo  |  buy bonus · info/sound
   The outer columns share the leftover width equally, so the spin button
   always sits in the middle of the cabinet. */
.sc-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  column-gap: 16px;
  padding: 12px 16px;
  border-radius: 22px;
  background: var(--sc-surface);
}

.sc-zone { display: flex; min-width: 0; align-items: center; }
.sc-zone--meters { gap: 14px; }
.sc-zone--extra { justify-content: flex-end; gap: 10px; }

/* Bet and the auto/turbo pair get equal-width halves around the spin. */
.sc-zone--play {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  column-gap: 14px;
}

.sc-zone--play > .sc-bet { justify-self: end; }
.sc-mods { display: flex; justify-self: start; gap: 6px; }
.sc-utils { display: flex; flex-direction: column; gap: 2px; }
.sc-utils .sc-icon { width: 30px; height: 30px; }
.sc-utils .sc-icon :deep(svg), .sc-utils .sc-icon > span { width: 17px; height: 17px; }

.sc-divider {
  width: 1px;
  height: 34px;
  flex-shrink: 0;
  background: var(--sc-line, color-mix(in srgb, var(--sc-text) 14%, transparent));
}

/* ── meters ─────────────────────────────────────────────────────────── */
.sc-meter {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
  padding: 0;
}


.sc-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  line-height: 1.2;
  text-transform: uppercase;
  color: var(--sc-muted);
}

.sc-value {
  max-width: 100%;
  overflow: hidden;
  font-family: var(--sc-number-font);
  font-size: 19px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-meter--win .sc-value { color: var(--sc-muted); transition: color 0.2s; }
.sc-meter--win.is-hot .sc-value { color: var(--sc-win); text-shadow: 0 0 14px color-mix(in srgb, var(--sc-win) 45%, transparent); }
.sc-value.is-pop { animation: sc-pop 0.35s cubic-bezier(0.2, 1.6, 0.4, 1); }

.sc-meter__note {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--sc-muted);
  white-space: nowrap;
}

.sc-narrow { display: none; }
.is-shake { animation: sc-shake 0.4s; }

/* ── bet ────────────────────────────────────────────────────────────── */
.sc-bet {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.sc-bet__col {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.sc-bet__row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--sc-control);
}

.sc-step {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  color: var(--sc-text);
  transition: background-color 0.15s, transform 0.1s, opacity 0.15s;
}

.sc-step:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-text) 14%, transparent); }
.sc-step:active:not(:disabled) { transform: scale(0.88); }
.sc-step:disabled { opacity: 0.3; cursor: not-allowed; }

.sc-bet__value,
.sc-bet__input {
  width: 76px;
  height: 30px;
  border-radius: 8px;
  font-family: var(--sc-number-font);
  font-size: 17px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--sc-text);
  background: transparent;
}

.sc-bet__value { cursor: text; transition: background-color 0.15s; }
.sc-bet__value:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-text) 8%, transparent); }
.sc-bet__value:disabled { cursor: not-allowed; opacity: 0.7; }
.sc-bet__input { outline: 2px solid var(--sc-accent); background: color-mix(in srgb, #000 30%, transparent); }

.sc-bet__hint,
.sc-bet__preview {
  position: absolute;
  top: 100%;
  left: 50%;
  z-index: 2;
  margin-top: 3px;
  transform: translateX(-50%);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
  white-space: nowrap;
  color: var(--sc-muted);
}

.sc-bet__preview {
  padding: 1px 7px;
  border-radius: 6px;
  color: var(--sc-on-accent);
  background: var(--sc-accent);
  font-weight: 700;
}

/* ── tiles & icon buttons ───────────────────────────────────────────── */
.sc-tile {
  display: flex;
  width: 54px;
  height: 50px;
  flex-shrink: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border-radius: 14px;
  color: var(--sc-text);
  background: var(--sc-control);
  transition: background-color 0.15s, color 0.15s, transform 0.1s, opacity 0.15s;
}

.sc-tile__icon { width: 18px; height: 18px; }

.sc-tile__label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  line-height: 1;
  text-transform: uppercase;
}

.sc-tile:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-control), var(--sc-text) 12%); }
.sc-tile:active:not(:disabled) { transform: scale(0.94); }
.sc-tile:disabled { opacity: 0.35; cursor: not-allowed; }
.sc-tile.is-on { color: var(--sc-on-accent); background: var(--sc-accent); }
.sc-tile.is-on:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-accent), #fff 12%); }

.sc-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 50%;
  color: var(--sc-muted);
  transition: color 0.15s, background-color 0.15s, transform 0.1s;
}

.sc-icon:hover, .sc-icon.is-open { color: var(--sc-text); background: var(--sc-control); }
.sc-icon:active { transform: scale(0.92); }

.sc :is(button, input):focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

/* ── buy bonus ──────────────────────────────────────────────────────── */
.sc-buy {
  position: relative;
  display: flex;
  min-width: 118px;
  height: 50px;
  flex-shrink: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0 14px;
  overflow: hidden;
  border-radius: 14px;
  color: var(--sc-on-buy);
  background: linear-gradient(180deg, color-mix(in srgb, var(--sc-buy), #fff 22%) 0%, var(--sc-buy) 50%, color-mix(in srgb, var(--sc-buy), #000 28%) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 4px 16px color-mix(in srgb, var(--sc-buy) 40%, transparent);
  transition: transform 0.1s, filter 0.15s, opacity 0.15s;
}

.sc-buy::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, transparent 35%, rgba(255, 255, 255, 0.45) 50%, transparent 65%);
  transform: translateX(-120%);
  animation: sc-shine 4s ease-in-out 1s infinite;
  pointer-events: none;
}

.sc-buy__label {
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.1em;
  line-height: 1;
  text-transform: uppercase;
}

.sc-buy__price {
  font-family: var(--sc-number-font);
  font-size: 16px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  white-space: nowrap;
}

.sc-buy:hover:not(:disabled) { filter: brightness(1.1); }
.sc-buy:active:not(:disabled) { transform: scale(0.95); }
.sc-buy:disabled { opacity: 0.4; filter: grayscale(0.4); cursor: not-allowed; box-shadow: none; }
.sc-buy:disabled::after { animation: none; }

/* ── spin ───────────────────────────────────────────────────────────── */
.sc-spin {
  position: relative;
  width: 84px;
  height: 84px;
  flex-shrink: 0;
  border-radius: 50%;
  padding: 5px;
  background: color-mix(in srgb, var(--sc-accent) 22%, transparent);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45), 0 0 0 1px color-mix(in srgb, var(--sc-accent) 40%, transparent);
  transition: transform 0.12s, filter 0.2s, box-shadow 0.3s;
}

.sc-spin__face {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: 50%;
  color: var(--sc-on-accent);
  background: radial-gradient(circle at 50% 28%, color-mix(in srgb, var(--sc-accent), #fff 30%) 0%, var(--sc-accent) 45%, var(--sc-accent-deep) 100%);
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.35), inset 0 -4px 10px rgba(0, 0, 0, 0.3);
}

.sc-spin__icon { width: 34px; height: 34px; }
.sc-spin__icon--sm { width: 20px; height: 20px; }
.sc-spin__icon--turn { transition: transform 0.45s cubic-bezier(0.3, 1.4, 0.5, 1); }

.sc-spin__text {
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.14em;
  line-height: 1;
  text-transform: uppercase;
}

.sc-spin__count {
  font-family: var(--sc-number-font);
  font-size: 22px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.sc-spin.is-spin:not(:disabled) { animation: sc-breathe 2.6s ease-in-out infinite; }
.sc-spin:hover:not(:disabled) { filter: brightness(1.08); }
.sc-spin:hover:not(:disabled) .sc-spin__icon--turn { transform: rotate(120deg); }
.sc-spin:active:not(:disabled) { transform: scale(0.93); }
.sc-spin:disabled { cursor: not-allowed; filter: grayscale(0.7) brightness(0.7); }
.sc-spin.is-wait:disabled { filter: none; opacity: 0.85; }
.sc-spin:is(.is-stop, .is-skip, .is-auto) .sc-spin__face {
  background: radial-gradient(circle at 50% 28%, color-mix(in srgb, var(--sc-accent-deep), #fff 18%) 0%, var(--sc-accent-deep) 60%, color-mix(in srgb, var(--sc-accent-deep), #000 35%) 100%);
  color: #fff;
}

/* ── sound popover ──────────────────────────────────────────────────── */
.sc-sound { position: relative; }

.sc-sound__panel {
  position: absolute;
  right: 0;
  bottom: calc(100% + 10px);
  z-index: 30;
  display: grid;
  width: 220px;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--sc-panel);
  box-shadow: 0 0 0 1px var(--sc-line), 0 16px 40px rgba(0, 0, 0, 0.5);
}

.sc-sound__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--sc-text);
}

.sc-sound__switch { width: 100%; }

.sc-switch {
  position: relative;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--sc-control);
  transition: background-color 0.18s;
}

.sc-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--sc-muted);
  transition: transform 0.18s, background-color 0.18s;
}

.sc-switch.is-on { background: var(--sc-accent); }
.sc-switch.is-on::after { transform: translateX(16px); background: var(--sc-on-accent); }

.sc-range {
  width: 120px;
  height: 4px;
  border-radius: 999px;
  appearance: none;
  background: linear-gradient(90deg, var(--sc-accent) var(--fill), var(--sc-control) var(--fill));
  cursor: pointer;
}

.sc-range:disabled { opacity: 0.35; cursor: not-allowed; }

.sc-range::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  appearance: none;
  background: var(--sc-text);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}

.sc-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: 50%;
  background: var(--sc-text);
}

.sc-pop-enter-active, .sc-pop-leave-active { transition: opacity 0.15s, transform 0.18s; }
.sc-pop-enter-from, .sc-pop-leave-to { opacity: 0; transform: translateY(6px); }

@keyframes sc-breathe {
  0%, 100% { box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45), 0 0 0 1px color-mix(in srgb, var(--sc-accent) 40%, transparent), 0 0 0 0 color-mix(in srgb, var(--sc-accent) 0%, transparent); }
  50% { box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45), 0 0 0 1px color-mix(in srgb, var(--sc-accent) 55%, transparent), 0 0 22px 2px color-mix(in srgb, var(--sc-accent) 45%, transparent); }
}

@keyframes sc-shine {
  0%, 70% { transform: translateX(-120%); }
  100% { transform: translateX(120%); }
}

@keyframes sc-pop {
  0% { transform: scale(1); }
  40% { transform: scale(1.14); }
  100% { transform: scale(1); }
}

@keyframes sc-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-4px); }
  40%, 80% { transform: translateX(4px); }
}

/* ── mid widths: same zones, tighter ────────────────────────────────── */
@container sc (max-width: 900px) {
  .sc-grid { column-gap: 10px; padding: 10px 12px; }
  .sc-zone--play { column-gap: 10px; }
  .sc-zone--meters { gap: 10px; }
  .sc-tile { width: 46px; height: 46px; }
  .sc-buy { min-width: 96px; height: 46px; padding: 0 10px; }
  .sc-buy__price { font-size: 14px; }
  .sc-value { font-size: 16px; }
  .sc-wide { display: none; }
  .sc-narrow { display: inline; }
  .sc-spin { width: 76px; height: 76px; }
  .sc-bet__value, .sc-bet__input { width: 58px; }
}

/* ── phones: meters on top, the play row, then buy + utilities ──────── */
@container sc (max-width: 640px) {
  .sc-grid {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 10px 10px 12px;
    border-radius: 18px;
  }

  .sc-zone--meters { justify-content: space-between; padding: 0 4px; }
  .sc-zone--meters .sc-divider { display: none; }
  .sc-zone--meters .sc-meter--win { align-items: flex-end; text-align: right; }
  /* Too narrow for equal halves around the spin: pack the row and centre it. */
  .sc-zone--play { display: flex; justify-content: center; gap: 6px; }
  .sc-bet { gap: 4px; }
  .sc-zone--extra { justify-content: stretch; }
  .sc-zone--extra .sc-buy { flex: 1; min-width: 0; height: 42px; flex-direction: row; gap: 10px; }
  .sc-utils { flex-direction: row; gap: 6px; }
  .sc-utils .sc-icon { width: 42px; height: 42px; border-radius: 12px; color: var(--sc-text); background: var(--sc-control); }
  .sc-bet { padding-bottom: 12px; }
  .sc-value { font-size: 15px; }
  .sc-label { font-size: 9px; letter-spacing: 0.12em; }
  .sc-tile { width: 44px; height: 44px; border-radius: 12px; }
  .sc-tile__label { font-size: 9px; }
  .sc-tile--max { width: 40px; }
  .sc-spin { width: 70px; height: 70px; padding: 4px; }
  .sc-spin__icon { width: 28px; height: 28px; }
  .sc-step { width: 28px; height: 28px; }
  .sc-bet__value, .sc-bet__input { width: 52px; font-size: 15px; }
  .sc-sound__panel { right: 0; left: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .sc-spin.is-spin:not(:disabled), .sc-value.is-pop, .is-shake, .sc-buy::after { animation: none; }
}
</style>
