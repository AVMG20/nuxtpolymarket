<script setup lang="ts">
// Dumpster Dive pick game. The server already decided what comes out of each
// pick (`dive.picks`, in order); whichever can the player clicks shows the
// next one. Autoplay and "Pick for me" choose cans on a timer.
import type { TphDive, TphDiveItem } from '#shared/utils/gamelogic/trashpanda'
import { DIVE_BINS } from '#shared/utils/gamelogic/trashpanda'
import type { TphSoundEvent } from '~/utils/slots/trashpanda-synth'
import { tphArtDataUrl } from '~/utils/slots/trashpanda-art'

const props = defineProps<{
  dive: TphDive
  bet: number
  /** What the dive pays; below `dive.total` only when the max win cuts it. */
  payout: number
  auto: boolean
  turbo: boolean
  play: (event: TphSoundEvent, intensity?: number) => void
}>()

const emit = defineEmits<{ done: [], shake: [], pot: [pot: number] }>()

interface Can {
  item: TphDiveItem | null
  state: 'closed' | 'opening' | 'open' | 'leftover'
  ateDonut: boolean
}

const cans = ref<Can[]>(Array.from({ length: DIVE_BINS }, () => ({ item: null, state: 'closed', ateDonut: false })))
const pickIndex = ref(0)
const pot = ref(0)
const potPulse = ref(0)
const shield = ref(false)
const keyFound = ref(false)
const finished = ref(false)
const summary = ref(false)
const busy = ref(false)
const autoPick = ref(props.auto)
/** Space / skip while already auto-picking: pick faster. */
const fast = ref(false)
const note = ref('Pick a trash can. Find cash, dodge the guard dogs.')
const noteTone = ref<'idle' | 'good' | 'bad'>('idle')
let destroyed = false
let autoTimer: ReturnType<typeof setTimeout> | null = null

const art = {
  can: tphArtDataUrl('can-closed', 160),
  dog: tphArtDataUrl('dog', 160),
  donut: tphArtDataUrl('donut', 160),
  key: tphArtDataUrl('key', 160),
  double: tphArtDataUrl('double', 160),
  coins: tphArtDataUrl('coins', 160),
  cash: tphArtDataUrl('cash', 160),
  bag: tphArtDataUrl('bag', 160)
}

function itemArt(item: TphDiveItem): string {
  if (item.kind === 'cash') return item.value >= 25 ? art.bag : item.value >= 5 ? art.cash : art.coins
  return art[item.kind]
}

function itemLabel(item: TphDiveItem, ateDonut = false): string {
  if (ateDonut) return 'Ate your donut'
  switch (item.kind) {
    case 'cash': return formatNumber(item.value * props.bet)
    case 'double': return 'Double!'
    case 'donut': return 'Donut'
    case 'key': return 'Golden key'
    case 'dog': return 'Guard dog'
  }
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms * (props.turbo ? 0.5 : 1) * (fast.value ? 0.4 : 1)))

function cashTier(value: number) {
  return value >= 50 ? 4 : value >= 25 ? 3 : value >= 10 ? 2 : value >= 5 ? 1 : 0
}

async function open(index: number) {
  const can = cans.value[index]
  if (!can || can.state !== 'closed' || busy.value || finished.value || destroyed) return
  const pick = props.dive.picks[pickIndex.value]
  if (!pick) return
  busy.value = true
  pickIndex.value++
  can.state = 'opening'
  props.play('lid-rattle')
  await wait(260)
  if (destroyed) return
  can.item = pick.item
  can.ateDonut = pick.ateDonut
  can.state = 'open'
  props.play('bin-open')
  await wait(140)

  const item = pick.item
  if (item.kind === 'cash') {
    props.play('cash', cashTier(item.value))
    note.value = `${formatNumber(item.value * props.bet)} in the trash!`
    noteTone.value = 'good'
  } else if (item.kind === 'double') {
    props.play('double')
    note.value = 'Double! The haul is doubled'
    noteTone.value = 'good'
  } else if (item.kind === 'donut') {
    props.play('donut')
    note.value = 'A donut. The next dog eats it instead of you'
    noteTone.value = 'good'
  } else if (item.kind === 'key') {
    props.play('key')
    note.value = `Golden key! Night Heist free spins after the dive`
    noteTone.value = 'good'
    keyFound.value = true
  } else if (pick.ateDonut) {
    props.play('dog-eat')
    note.value = 'The guard dog ate your donut. Keep digging'
    noteTone.value = 'idle'
  } else {
    props.play('dog-bark')
    emit('shake')
    note.value = 'Busted! The guard dog chased you off'
    noteTone.value = 'bad'
  }
  if (pick.pot !== pot.value) emit('pot', pick.pot)
  pot.value = pick.pot
  potPulse.value++
  shield.value = pick.shield

  const last = pickIndex.value >= props.dive.picks.length
  if (last) {
    if (item.kind !== 'dog') {
      note.value = 'Only dogs left. Clean getaway!'
      noteTone.value = 'good'
    }
    await finish()
  }
  busy.value = false
  scheduleAuto()
}

async function finish() {
  finished.value = true
  stopAuto()
  await wait(900)
  if (destroyed) return
  // Show what the other cans held.
  const left = [...props.dive.leftovers]
  for (const can of cans.value) {
    if (can.state !== 'closed') continue
    const item = left.shift()
    if (!item) break
    can.item = item
    can.state = 'leftover'
  }
  await wait(1300)
  if (destroyed) return
  summary.value = true
  props.play('dive-end')
  await wait(props.auto ? 1600 : 2600)
  if (!destroyed) emit('done')
}

function stopAuto() {
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = null
}

function scheduleAuto() {
  stopAuto()
  if (!autoPick.value || finished.value || destroyed) return
  autoTimer = setTimeout(() => {
    const closed = cans.value.map((c, i) => (c.state === 'closed' ? i : -1)).filter(i => i >= 0)
    // Cosmetic: which can gets opened doesn't change what comes out.
    const i = closed[Math.floor(Math.random() * closed.length)]
    if (i !== undefined) void open(i)
  }, (props.turbo ? 380 : 750) * (fast.value ? 0.4 : 1))
}

function toggleAuto() {
  autoPick.value = !autoPick.value
  props.play('click')
  if (autoPick.value) scheduleAuto()
  else stopAuto()
}

/** Skip button / Space: finish picking on autopilot, fast. */
function hurry() {
  if (summary.value) {
    emit('done')
    return
  }
  if (!autoPick.value) {
    toggleAuto()
    return
  }
  fast.value = true
  if (!busy.value) scheduleAuto()
}

defineExpose({ hurry })

onMounted(() => {
  scheduleAuto()
})

onBeforeUnmount(() => {
  destroyed = true
  stopAuto()
})
</script>

<template>
  <div class="tph-dive">
    <div class="tph-dive__head">
      <p class="tph-dive__title">
        Dumpster Dive
      </p>
      <div class="tph-dive__stats">
        <span :key="potPulse" class="tph-dive__pot">
          <span class="tph-dive__pot-label">Haul</span>
          {{ formatNumber(pot * bet) }}
        </span>
        <span class="tph-dive__perk" :class="{ 'is-on': shield }" title="Donut: the next dog eats it">
          <img :src="art.donut" alt="Donut">
        </span>
        <span class="tph-dive__perk" :class="{ 'is-on': keyFound }" title="Golden key: free spins after the dive">
          <img :src="art.key" alt="Golden key">
        </span>
      </div>
    </div>

    <div class="tph-dive__grid">
      <button
        v-for="(can, i) in cans"
        :key="i"
        type="button"
        class="tph-can"
        :class="[`is-${can.state}`, can.item ? `has-${can.item.kind}` : '']"
        :disabled="can.state !== 'closed' || finished || busy"
        :aria-label="can.item ? itemLabel(can.item, can.ateDonut) : `Trash can ${i + 1}`"
        @click="open(i)"
      >
        <img v-if="can.state === 'closed' || can.state === 'opening'" :src="art.can" alt="" class="tph-can__img">
        <template v-else-if="can.item">
          <img :src="itemArt(can.item)" alt="" class="tph-can__img tph-can__item">
          <span class="tph-can__label">{{ itemLabel(can.item, can.ateDonut) }}</span>
        </template>
      </button>
    </div>

    <div class="tph-dive__foot">
      <p class="tph-dive__note" :class="`is-${noteTone}`">
        {{ note }}
      </p>
      <button v-if="!finished" type="button" class="tph-dive__auto" :class="{ 'is-on': autoPick }" @click="toggleAuto">
        <UIcon :name="autoPick ? 'i-lucide-pause' : 'i-lucide-hand'" class="size-4" />
        {{ autoPick ? 'Picking…' : 'Pick for me' }}
      </button>
    </div>

    <Transition name="tph-dive-pop">
      <div v-if="summary" class="tph-dive__summary" @click="emit('done')">
        <p class="tph-dive__kicker">
          {{ dive.cleared ? 'Clean getaway' : 'Dive over' }}
        </p>
        <p class="tph-dive__total">
          {{ formatNumber(payout) }}
        </p>
        <p v-if="dive.keyFound" class="tph-dive__sub">
          + the golden key opens a Night Heist
        </p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.tph-dive {
  position: absolute;
  inset: 0;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px 12px;
  background:
    radial-gradient(ellipse 80% 55% at 50% 40%, rgba(74, 222, 128, 0.16), transparent 70%),
    linear-gradient(180deg, rgba(14, 9, 34, 0.94), rgba(10, 6, 24, 0.97));
  container-type: inline-size;
  font-family: 'Fredoka', system-ui, sans-serif;
}

.tph-dive__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.tph-dive__title {
  font-family: 'Bangers', 'Arial Black', sans-serif;
  font-size: clamp(24px, 5.2cqw, 40px);
  line-height: 1;
  letter-spacing: 0.04em;
  color: #86efac;
  -webkit-text-stroke: 2px #1a1030;
  paint-order: stroke fill;
  text-shadow: 3px 4px 0 #1a1030;
  transform: rotate(-2deg);
}

.tph-dive__stats {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tph-dive__pot {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
  border: 2px solid rgba(250, 204, 21, 0.5);
  font-family: 'Lilita One', sans-serif;
  font-size: clamp(16px, 3.6cqw, 24px);
  color: #fde047;
  animation: tph-pot 0.4s cubic-bezier(0.2, 1.8, 0.4, 1);
}

.tph-dive__pot-label {
  font-family: 'Fredoka', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #d9d3f5;
}

@keyframes tph-pot {
  from { transform: scale(1.25); }
  to { transform: scale(1); }
}

.tph-dive__perk {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.4);
  border: 2px solid rgba(255, 255, 255, 0.1);
  opacity: 0.35;
  filter: grayscale(1);
  transition: all 0.3s;
}

.tph-dive__perk img { width: 28px; height: 28px; }

.tph-dive__perk.is-on {
  opacity: 1;
  filter: none;
  border-color: #fde047;
  box-shadow: 0 0 14px rgba(250, 204, 21, 0.6);
}

.tph-dive__grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.tph-can {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 0;
  border-radius: 14px;
  background: radial-gradient(ellipse at 50% 80%, rgba(255, 255, 255, 0.06), transparent 70%);
  transition: transform 0.15s, background 0.2s;
}

.tph-can:not(:disabled) { cursor: pointer; }
.tph-can:not(:disabled):hover { transform: translateY(-3px) rotate(-2deg); background: radial-gradient(ellipse at 50% 80%, rgba(250, 204, 21, 0.18), transparent 70%); }
.tph-can:not(:disabled):hover .tph-can__img { filter: drop-shadow(0 0 10px rgba(250, 204, 21, 0.7)); }

.tph-can__img {
  width: auto;
  height: 100%;
  max-height: 100%;
  max-width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  pointer-events: none;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.5));
}

.tph-can.is-opening .tph-can__img { animation: tph-rattle 0.26s linear; }

.tph-can.is-open .tph-can__item { animation: tph-reveal 0.45s cubic-bezier(0.2, 1.8, 0.4, 1); }

.tph-can.is-leftover { opacity: 0.45; filter: grayscale(0.6); }
.tph-can.is-leftover .tph-can__img { transform: scale(0.8); }

.tph-can.is-open.has-dog { background: radial-gradient(ellipse at 50% 60%, rgba(244, 63, 94, 0.35), transparent 70%); }
.tph-can.is-open.has-key,
.tph-can.is-open.has-double { background: radial-gradient(ellipse at 50% 60%, rgba(232, 121, 249, 0.35), transparent 70%); }
.tph-can.is-open.has-cash { background: radial-gradient(ellipse at 50% 60%, rgba(250, 204, 21, 0.25), transparent 70%); }
.tph-can.is-open.has-donut { background: radial-gradient(ellipse at 50% 60%, rgba(249, 168, 212, 0.3), transparent 70%); }

.tph-can__label {
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 100%;
  padding: 1px 8px;
  border-radius: 999px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'Lilita One', sans-serif;
  font-size: clamp(11px, 2.6cqw, 17px);
  color: #fff;
  background: rgba(26, 16, 48, 0.85);
  border: 1.5px solid rgba(255, 255, 255, 0.2);
}

.has-dog .tph-can__label { color: #fda4af; }
.has-cash .tph-can__label { color: #fde047; }
.has-key .tph-can__label, .has-double .tph-can__label { color: #f5d0fe; }

@keyframes tph-rattle {
  0%, 100% { transform: rotate(0); }
  20% { transform: rotate(-8deg) translateY(-2px); }
  40% { transform: rotate(7deg); }
  60% { transform: rotate(-6deg) translateY(-3px); }
  80% { transform: rotate(5deg); }
}

@keyframes tph-reveal {
  from { transform: scale(0.2) translateY(30%); opacity: 0; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}

.tph-dive__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 32px;
}

.tph-dive__note {
  flex: 1;
  min-width: 0;
  font-size: clamp(12px, 2.4cqw, 15px);
  font-weight: 600;
  color: #d9d3f5;
}

.tph-dive__note.is-good { color: #fde047; }
.tph-dive__note.is-bad { color: #fda4af; }

.tph-dive__auto {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: #f5f3ff;
  background: rgba(196, 181, 253, 0.14);
  border: 1.5px solid rgba(196, 181, 253, 0.3);
  white-space: nowrap;
}

.tph-dive__auto.is-on { background: rgba(34, 197, 94, 0.25); border-color: #4ade80; }

.tph-dive__summary {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: radial-gradient(ellipse at 50% 50%, rgba(12, 6, 30, 0.9), rgba(12, 6, 30, 0.7) 60%, rgba(12, 6, 30, 0.4));
  cursor: pointer;
}

.tph-dive__kicker {
  font-family: 'Bangers', sans-serif;
  font-size: clamp(22px, 5cqw, 36px);
  letter-spacing: 0.06em;
  color: #86efac;
  -webkit-text-stroke: 2px #1a1030;
  paint-order: stroke fill;
}

.tph-dive__total {
  font-family: 'Lilita One', sans-serif;
  font-size: clamp(38px, 10cqw, 72px);
  color: #fde047;
  -webkit-text-stroke: 4px #1a1030;
  paint-order: stroke fill;
  text-shadow: 3px 5px 0 #1a1030, 0 0 24px rgba(250, 204, 21, 0.6);
}

.tph-dive__sub {
  font-weight: 700;
  color: #f5d0fe;
}

.tph-dive-pop-enter-active { transition: opacity 0.25s, transform 0.35s cubic-bezier(0.2, 1.5, 0.4, 1); }
.tph-dive-pop-enter-from { opacity: 0; transform: scale(0.85); }

@container (max-width: 420px) {
  .tph-dive { padding: 8px; gap: 6px; }
  .tph-dive__perk { width: 28px; height: 28px; }
  .tph-dive__perk img { width: 20px; height: 20px; }
  .tph-dive__auto { padding: 4px 10px; font-size: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .tph-can__img, .tph-can__item, .tph-dive__pot { animation: none !important; }
}
</style>
