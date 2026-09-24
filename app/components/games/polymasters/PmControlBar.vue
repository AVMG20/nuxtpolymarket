<script setup lang="ts">
import { PM_SAFE_LANDING_COST as SAFE_LANDING_COST } from '#shared/utils/gamelogic/polymasters'
import { parseAmount } from '#shared/utils/parse-amount'
import { amountShorthand } from '~/composables/amount-input'
import { sfx } from '~/utils/polymasters/audio'

const { state, balance, money, stake, betLocked, changeBet, setBet, setSpeed, toggleSafe, play, startAuto, stopAuto, dismissResult } = usePolyMastersGame()
const SPEEDS = PM_SPEEDS
const AUTO_OPTIONS = PM_AUTO_OPTIONS
const BET_PRESETS = [10, 100, 1_000, 10_000, 100_000, 1_000_000]

const bar = ref<HTMLElement>()
defineExpose({ bar })
const betMenu = ref(false)
const autoMenu = ref(false)
const betGroup = ref<HTMLElement>()
const autoGroup = ref<HTMLElement>()
const flying = computed(() => state.phase === 'flying')
const locked = computed(() => betLocked())

const safePrice = computed(() => state.bet * SAFE_LANDING_COST)

// The bet field shows the compact amount (2,5K). While focused it holds
// shorthand the parser reads back exactly (2.5k, since `2,5K` isn't input
// syntax), and only a valid amount becomes the bet, so clearing the field to
// type a new number doesn't snap it back to the minimum mid-edit.
const betFocused = ref(false)
const betText = ref(money(state.bet))
const betPreview = computed(() => {
  if (!betFocused.value) return ''
  const v = Math.floor(parseAmount(betText.value) ?? 0)
  return v >= PM_MIN_BET ? money(v) : ''
})

function onBetFocus(e: FocusEvent) {
  betFocused.value = true
  betText.value = amountShorthand(state.bet)
  betMenu.value = true
  const input = e.target as HTMLInputElement
  void nextTick(() => input.select())
}

function onBetInput() {
  const v = Math.floor(parseAmount(betText.value) ?? 0)
  if (v >= PM_MIN_BET && v !== state.bet) setBet(v)
}

function onBetBlur() {
  betFocused.value = false
  betText.value = money(state.bet)
}

function endBetEdit(e: KeyboardEvent) {
  betMenu.value = false
  ;(e.target as HTMLInputElement).blur()
}

watch(() => state.bet, (v) => {
  if (!betFocused.value) betText.value = money(v)
})

function pickBet(v: number) {
  setBet(v)
  sfx.click()
}

function maxBet() {
  const perBet = state.safe ? SAFE_LANDING_COST : 1
  pickBet(Math.max(PM_MIN_BET, Math.floor(balance.value / perBet)))
}

function onPointerDown(e: PointerEvent) {
  const target = e.target as Node
  if (betMenu.value && !betGroup.value?.contains(target)) betMenu.value = false
  if (autoMenu.value && !autoGroup.value?.contains(target)) autoMenu.value = false
}
onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))
watch(locked, (v) => {
  if (v) betMenu.value = false
})

function onPlay() {
  if (state.auto.active) {
    stopAuto()
    sfx.click()
    return
  }
  if (state.phase === 'result') dismissResult()
  void play()
}

function chooseAuto(n: number) {
  autoMenu.value = false
  sfx.click()
  startAuto(n)
}
</script>

<template>
  <footer ref="bar" class="bar">
    <div class="group balance panel">
      <div class="label">Balance</div>
      <div class="big display" :title="formatNumber(balance, false)">{{ money(balance) }}</div>
    </div>

    <div ref="betGroup" class="group bet panel">
      <div class="label">{{ state.safe ? `Bet · stake ${money(stake())}` : 'Bet' }}</div>
      <div class="row">
        <button class="round-btn" :disabled="locked || state.bet <= PM_MIN_BET" aria-label="Decrease bet" @click="changeBet(-1)">
          <svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="3" rx="1.5" fill="currentColor" /></svg>
        </button>
        <input
          v-model="betText"
          class="bet-value display"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          aria-label="Bet amount"
          :disabled="locked"
          @focus="onBetFocus"
          @input="onBetInput"
          @blur="onBetBlur"
          @keydown.enter="endBetEdit"
          @keydown.esc="endBetEdit"
        >
        <button class="round-btn" :disabled="locked || state.bet >= PM_MAX_BET" aria-label="Increase bet" @click="changeBet(1)">
          <svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="3" rx="1.5" fill="currentColor" /><rect x="10.5" y="5" width="3" height="14" rx="1.5" fill="currentColor" /></svg>
        </button>
      </div>
      <Transition name="menu">
        <div v-if="betMenu" class="menu panel bet-menu">
          <div class="bet-summary">
            <span>Bet <b>{{ betPreview || money(state.bet) }}</b></span>
            <span>Safe Landing <b>{{ money(safePrice) }}</b></span>
          </div>
          <button v-for="b in BET_PRESETS" :key="b" :class="{ on: b === state.bet }" @pointerdown.prevent @click="pickBet(b)">{{ money(b) }}</button>
          <button @pointerdown.prevent @click="pickBet(state.bet / 2)">½</button>
          <button @pointerdown.prevent @click="pickBet(state.bet * 2)">2×</button>
          <button @pointerdown.prevent @click="maxBet">MAX</button>
        </div>
      </Transition>
    </div>

    <div class="play-wrap">
      <button class="play" :class="{ flying, auto: state.auto.active, safe: state.safe }" :disabled="!state.ready || (flying && !state.auto.active)" @click="onPlay">
        <span class="ring" />
        <span v-if="state.auto.active" class="play-label display">STOP<small>{{ state.auto.left + 1 }} left</small></span>
        <span v-else-if="flying" class="play-label display"><svg class="spin" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 1-9 9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg></span>
        <span v-else class="play-label display">
          <svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>
          PLAY
        </span>
      </button>
    </div>

    <div class="group speed panel">
      <div class="label">Speed · {{ SPEEDS.find((s) => s.id === state.speed)?.label }}</div>
      <div class="row seg">
        <button v-for="s in SPEEDS" :key="s.id" :class="{ on: state.speed === s.id }" :title="s.label" @click="setSpeed(s.id)">
          <svg viewBox="0 0 24 24" :style="{ width: 12 + s.id * 2 + 'px' }">
            <path v-for="k in s.id" :key="k" :d="`M${2 + (k - 1) * 5} 5l7 7-7 7`" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </div>

    <div class="group extras">
      <div ref="autoGroup" class="auto-wrap">
        <button class="pill panel" :class="{ on: state.auto.active }" :disabled="flying && !state.auto.active" @click="state.auto.active ? stopAuto() : (autoMenu = !autoMenu), sfx.click()">
          <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" /><path d="M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span class="auto-text">AUTO</span>
        </button>
        <Transition name="menu">
          <div v-if="autoMenu" class="menu panel auto-menu">
            <button v-for="n in AUTO_OPTIONS" :key="n" @click="chooseAuto(n)">{{ n }} rounds</button>
          </div>
        </Transition>
      </div>
      <button class="pill safe-btn" :class="{ on: state.safe }" :disabled="locked" :title="`Safe Landing: every round costs ${SAFE_LANDING_COST}× bet (${money(safePrice)}) and always lands`" @click="toggleSafe">
        <span class="safe-icon">🛬</span>
        <span class="safe-text">
          <b class="display"><span class="long">SAFE LANDING</span><span class="short">SAFE</span></b>
          <small>{{ state.safe ? `ACTIVE · ${money(safePrice)}` : `Buy · ${money(safePrice)}` }}</small>
          <small class="short">{{ state.safe ? `ON · ${money(safePrice)}` : money(safePrice) }}</small>
        </span>
      </button>
    </div>
  </footer>
</template>

<style scoped>
.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  grid-template-columns: 1fr auto auto auto 1fr;
  align-items: end;
  gap: 12px;
  padding: 0 16px max(14px, env(safe-area-inset-bottom));
  background: linear-gradient(180deg, transparent, rgba(3, 14, 32, 0.55) 45%, rgba(3, 14, 32, 0.8));
  padding-top: 40px;
}
.group {
  position: relative;
  border-radius: 16px;
  padding: 8px 14px 10px;
}
.balance {
  justify-self: start;
  min-width: 160px;
}
.big {
  font-size: 26px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.bet-value {
  field-sizing: content;
  min-width: 110px;
  max-width: 240px;
  padding: 6px 10px;
  border: 0;
  border-radius: 10px;
  font-size: 24px;
  color: #fff;
  text-align: center;
  font-variant-numeric: tabular-nums;
  background: rgba(0, 0, 0, 0.3);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.4);
  outline: none;
  cursor: text;
  user-select: text;
  -webkit-user-select: text;
}
.bet-value:focus {
  box-shadow:
    inset 0 2px 6px rgba(0, 0, 0, 0.4),
    0 0 0 2px var(--gold-2);
}
.bet-value:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.menu {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  border-radius: 14px;
  padding: 8px;
  display: grid;
  gap: 4px;
  z-index: 20;
}
.bet-menu {
  grid-template-columns: repeat(3, 1fr);
  width: 270px;
}
.bet-summary {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 4px 6px;
  font-size: 12px;
  font-weight: 800;
  color: rgba(190, 220, 255, 0.75);
}
.bet-summary span {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.bet-summary b {
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.menu button {
  padding: 8px 6px;
  border-radius: 8px;
  font-weight: 900;
  background: rgba(255, 255, 255, 0.06);
}
.menu button:hover,
.menu button.on {
  background: linear-gradient(180deg, var(--gold-2), var(--gold-3));
  color: #3a2200;
}
.menu-enter-active,
.menu-leave-active {
  transition: all 0.18s;
}
.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}

/* play button */
.play-wrap {
  padding: 0 6px;
}
.play {
  position: relative;
  width: 124px;
  height: 124px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 30%, #7dff9a 0%, #1fc15a 45%, #0b7a33 100%);
  box-shadow:
    inset 0 4px 0 rgba(255, 255, 255, 0.45),
    inset 0 -8px 0 rgba(0, 0, 0, 0.25),
    0 0 0 6px rgba(255, 213, 74, 0.9),
    0 0 0 10px rgba(120, 70, 0, 0.6),
    0 14px 30px rgba(0, 0, 0, 0.5),
    0 0 50px rgba(80, 255, 140, 0.45);
  transition:
    transform 0.15s,
    filter 0.15s;
  animation: breathe 2.2s ease-in-out infinite;
}
.play:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: scale(1.04);
}
.play:active:not(:disabled) {
  transform: scale(0.95);
}
.play.safe {
  background: radial-gradient(circle at 50% 30%, #aef2ff 0%, #22a8e0 45%, #0b4f7a 100%);
  box-shadow:
    inset 0 4px 0 rgba(255, 255, 255, 0.45),
    inset 0 -8px 0 rgba(0, 0, 0, 0.25),
    0 0 0 6px rgba(127, 232, 255, 0.9),
    0 0 0 10px rgba(0, 50, 90, 0.6),
    0 14px 30px rgba(0, 0, 0, 0.5),
    0 0 50px rgba(127, 232, 255, 0.45);
}
.play.flying {
  animation: none;
  filter: saturate(0.6) brightness(0.85);
}
.play.auto {
  background: radial-gradient(circle at 50% 30%, #ff9a8a 0%, #e0242c 50%, #7a0a10 100%);
  filter: none;
}
.play-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 26px;
  line-height: 1;
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.35);
}
.play-label svg {
  width: 38px;
  height: 38px;
  filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.3));
}
.play-label small {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 4px;
}
.spin {
  animation: spin 0.8s linear infinite;
}
.ring {
  position: absolute;
  inset: -16px;
  border-radius: 50%;
  border: 2px dashed rgba(255, 213, 74, 0.5);
  animation: spin 12s linear infinite;
  pointer-events: none;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes breathe {
  50% {
    box-shadow:
      inset 0 4px 0 rgba(255, 255, 255, 0.45),
      inset 0 -8px 0 rgba(0, 0, 0, 0.25),
      0 0 0 6px rgba(255, 213, 74, 1),
      0 0 0 10px rgba(120, 70, 0, 0.6),
      0 14px 30px rgba(0, 0, 0, 0.5),
      0 0 80px rgba(80, 255, 140, 0.7);
  }
}

/* speed */
.seg {
  gap: 4px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 12px;
  padding: 4px;
}
.seg button {
  width: 44px;
  height: 34px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.15s;
}
.seg button.on {
  color: #3a2200;
  background: linear-gradient(180deg, var(--gold-1), var(--gold-2) 50%, var(--gold-3));
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.2);
}
.seg svg {
  height: 18px;
}

/* extras */
.extras {
  justify-self: end;
  display: flex;
  gap: 10px;
  align-items: stretch;
  padding: 0;
}
.auto-wrap {
  position: relative;
}
.auto-menu {
  width: 140px;
}
.pill {
  height: 100%;
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-radius: 16px;
  font-family: var(--display);
  font-size: 18px;
}
.pill svg {
  width: 22px;
  height: 22px;
}
.pill.on {
  color: var(--gold-2);
  box-shadow: 0 0 0 2px var(--gold-2), 0 0 20px rgba(255, 213, 74, 0.4);
}
.pill:disabled {
  opacity: 0.5;
}
.safe-btn {
  background: linear-gradient(180deg, #ffe066, #f2a51c 55%, #b86a00);
  color: #3a1e00;
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, 0.5),
    inset 0 -3px 0 rgba(0, 0, 0, 0.25),
    0 8px 20px rgba(0, 0, 0, 0.35);
  position: relative;
  overflow: hidden;
}
.safe-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
  animation: pm-shine 2.8s ease-in-out infinite;
}
.safe-btn.on {
  background: linear-gradient(180deg, #aef2ff, #22a8e0 55%, #0b4f7a);
  color: #fff;
  box-shadow: 0 0 0 3px #7fe8ff, 0 0 30px rgba(127, 232, 255, 0.6);
}
.safe-icon {
  font-size: 22px;
}
.safe-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  max-width: 100%;
  line-height: 1.05;
}
.safe-text b {
  font-weight: 400;
  font-size: 17px;
  white-space: nowrap;
}
.safe-text small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ui);
  font-size: 11px;
  font-weight: 900;
  opacity: 0.85;
}

@container pm (max-width: 1160px) {
  .bar {
    grid-template-columns: 1fr auto 1fr;
    grid-template-areas:
      'bal play bet'
      'speed play extras';
    row-gap: 8px;
  }
  .balance {
    grid-area: bal;
  }
  .bet {
    grid-area: bet;
    justify-self: end;
  }
  .play-wrap {
    grid-area: play;
    align-self: center;
  }
  .speed {
    grid-area: speed;
    justify-self: start;
  }
  .extras {
    grid-area: extras;
  }
}
/* ---------------------------------------------------------------- phone portrait:
   compact two-row deck, PLAY in the middle spanning both rows */
.short {
  display: none;
}
@container pm (max-width: 720px) and (orientation: portrait) {
  .bar {
    grid-template-columns: minmax(0, 1fr) 84px minmax(0, 1fr);
    grid-template-areas:
      'bal play bet'
      'speed play extras';
    align-items: stretch;
    gap: 6px;
    padding: 18px 8px max(8px, env(safe-area-inset-bottom));
    background: linear-gradient(180deg, transparent, rgba(3, 14, 32, 0.6) 30%, rgba(3, 14, 32, 0.85));
  }
  .group {
    min-width: 0;
    border-radius: 12px;
    padding: 4px 8px 5px;
  }
  .label {
    font-size: 9px;
    letter-spacing: 0.1em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .balance {
    grid-area: bal;
    min-width: 0;
    width: 100%;
  }
  .big {
    font-size: 16px;
    white-space: nowrap;
  }
  .bet {
    grid-area: bet;
    width: 100%;
    justify-self: stretch;
  }
  .bet .row {
    gap: 4px;
    margin-top: 2px;
    justify-content: space-between;
  }
  .bar .round-btn {
    width: 26px;
    height: 26px;
    flex: none;
  }
  .bar .round-btn svg {
    width: 15px;
    height: 15px;
  }
  .bet-value {
    field-sizing: fixed;
    width: 0;
    min-width: 0;
    flex: 1;
    padding: 3px 2px;
    font-size: 15px;
    border-radius: 8px;
  }
  .bet-menu {
    width: 220px;
    left: auto;
    right: 0;
    transform: none;
  }
  .play-wrap {
    grid-area: play;
    align-self: center;
    justify-self: center;
    padding: 0;
  }
  .play {
    width: 80px;
    height: 80px;
  }
  .ring {
    inset: -8px;
  }
  .play-label {
    font-size: 16px;
  }
  .play-label svg {
    width: 26px;
    height: 26px;
  }
  .play-label small {
    font-size: 10px;
  }
  .speed {
    grid-area: speed;
    justify-self: stretch;
  }
  .seg {
    margin-top: 2px;
    padding: 2px;
    gap: 2px;
    justify-content: space-between;
  }
  .seg button {
    flex: 1;
    width: auto;
    min-width: 0;
    height: 24px;
    border-radius: 7px;
  }
  .seg svg {
    height: 14px;
  }
  .extras {
    grid-area: extras;
    justify-self: stretch;
    gap: 4px;
  }
  .auto-wrap {
    flex: none;
  }
  .auto-menu {
    left: 0;
    transform: none;
  }
  .pill {
    min-height: 0;
    height: 100%;
    padding: 0 8px;
    border-radius: 12px;
    font-size: 13px;
  }
  .pill svg {
    width: 18px;
    height: 18px;
  }
  .auto-text,
  .safe-icon,
  .long,
  .safe-text small:not(.short) {
    display: none;
  }
  .short {
    display: inline;
  }
  .safe-btn {
    flex: 1;
    justify-content: center;
    min-width: 0;
  }
  .safe-text {
    align-items: center;
  }
  .safe-text b {
    font-size: 13px;
  }
  .safe-text small.short {
    display: block;
    font-size: 9px;
  }
}
@container pm (max-height: 600px) {
  .bar {
    grid-template-columns: auto auto 1fr auto auto;
    grid-template-areas: 'bal bet play speed extras';
    align-items: end;
    gap: 8px;
    padding-top: 18px;
    padding-left: max(10px, env(safe-area-inset-left));
    padding-right: max(10px, env(safe-area-inset-right));
  }
  .play-wrap {
    justify-self: center;
    align-self: end;
  }
  .play {
    width: 76px;
    height: 76px;
  }
  .ring {
    inset: -10px;
  }
  .play-label {
    font-size: 17px;
  }
  .play-label svg {
    width: 24px;
    height: 24px;
  }
  .group {
    padding: 4px 10px 6px;
  }
  .balance {
    min-width: 0;
  }
  .big {
    font-size: 17px;
  }
  .bet-value {
    min-width: 76px;
    font-size: 17px;
    padding: 4px 6px;
  }
  .bar .round-btn {
    width: 30px;
    height: 30px;
  }
  .seg button {
    width: 30px;
    height: 28px;
  }
  .pill {
    min-height: 44px;
    padding: 0 10px;
    font-size: 14px;
  }
  .auto-text,
  .safe-icon {
    display: none;
  }
  .safe-text b {
    font-size: 13px;
  }
}
</style>
