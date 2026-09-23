<script setup lang="ts">
// Spiñata rules: paytable at the current bet, features, paylines and rules,
// all generated from the game constants.
import type { SpinPaySymbol } from '#shared/utils/gamelogic/spinata'
import {
  BONUS_PAY,
  PAYLINES,
  PAYTABLE,
  PINATA_POT_PRIZES,
  PINATA_POT_WEIGHTS,
  SCATTER_PAY,
  SPN_BONUS_TRIGGER,
  SPN_BUY_BONUS_COST,
  SPN_COLS,
  SPN_FREE_SPINS,
  SPN_LINES,
  SPN_MAX_WIN_MULT,
  SPN_ROWS,
  SPN_SCATTER_TRIGGER,
  SPN_TRACK_CAP,
  SPN_TRACK_START,
  SYMBOL_WEIGHTS
} from '#shared/utils/gamelogic/spinata'

const props = defineProps<{ bet: number, rtp: number }>()
const open = defineModel<boolean>('open', { default: false })

const sound = useSpinataSound()
const tab = ref<'pays' | 'features' | 'lines' | 'rules'>('pays')
const TABS = [
  { key: 'pays', label: 'Paytable' },
  { key: 'features', label: 'Features' },
  { key: 'lines', label: 'Paylines' },
  { key: 'rules', label: 'Rules' }
] as const

const NAMES: Record<SpinPaySymbol | 'wild', string> = {
  ten: '10', jack: 'J', queen: 'Q', king: 'K', ace: 'A',
  maracas: 'Maracas', cactus: 'Cactus', sombrero: 'Sombrero', flower: 'Flower', wild: 'Wild'
}

const lineBet = computed(() => props.bet / SPN_LINES)

const highs = (['wild', 'flower', 'sombrero', 'cactus', 'maracas'] as const).map(sym => ({ sym, pays: PAYTABLE[sym] }))
const lows = (['ace', 'king', 'queen', 'jack', 'ten'] as const).map(sym => ({ sym, pays: PAYTABLE[sym] }))

// Chance of SPN_SCATTER_TRIGGER+ scatters on one grid (binomial over the cells).
const freeSpinOdds = (() => {
  const total = Object.values(SYMBOL_WEIGHTS).reduce((a, b) => a + b, 0)
  const p = SYMBOL_WEIGHTS.scatter / total
  const cells = SPN_COLS * SPN_ROWS
  const choose = (n: number, k: number) => {
    let r = 1
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1)
    return r
  }
  let below = 0
  for (let k = 0; k < SPN_SCATTER_TRIGGER; k++) below += choose(cells, k) * p ** k * (1 - p) ** (cells - k)
  return Math.round(1 / (1 - below))
})()

const potTotalWeight = PINATA_POT_WEIGHTS.reduce((a, b) => a + b, 0)
const potOdds = PINATA_POT_PRIZES.map((prize, i) => ({ prize, pct: Math.round((PINATA_POT_WEIGHTS[i]! / potTotalWeight) * 100) }))

function coins(mult: number) {
  return formatNumber(mult * props.bet)
}

function linePath(rows: number[]) {
  return rows.map((r, c) => `${c === 0 ? 'M' : 'L'}${c * 10 + 5},${r * 10 + 5}`).join(' ')
}

function setTab(t: typeof tab.value) {
  tab.value = t
  sound.play('click')
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
        aria-labelledby="spn-info-title"
        @click.self="close"
      >
        <div class="spn-modal__card spn-info">
          <header class="spn-modal__head">
            <h2 id="spn-info-title">
              How to play
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

          <nav class="spn-info__tabs">
            <button
              v-for="t in TABS"
              :key="t.key"
              class="spn-info__tab"
              :class="{ 'spn-info__tab--on': tab === t.key }"
              @click="setTab(t.key)"
            >
              {{ t.label }}
            </button>
          </nav>

          <!-- Paytable -->
          <section
            v-if="tab === 'pays'"
            class="spn-info__body"
          >
            <p class="spn-info__note">
              Amounts at your current bet of <b>{{ formatNumber(bet) }}</b>. Line wins pay left to right on {{ SPN_LINES }} fixed lines, starting on the first reel.
            </p>
            <div class="spn-pay spn-pay--high">
              <div
                v-for="row in highs"
                :key="row.sym"
                class="spn-pay__card"
                :class="{ 'spn-pay__card--wild': row.sym === 'wild' }"
              >
                <img
                  :src="`/slots/spinata/${row.sym}.png`"
                  :alt="NAMES[row.sym]"
                >
                <div class="spn-pay__vals">
                  <p
                    v-for="n in [5, 4, 3]"
                    :key="n"
                  >
                    <span>{{ n }}</span>{{ formatNumber(row.pays[n - 3]! * lineBet) }}
                  </p>
                </div>
              </div>
            </div>
            <div class="spn-pay spn-pay--low">
              <div
                v-for="row in lows"
                :key="row.sym"
                class="spn-pay__card"
              >
                <img
                  :src="`/slots/spinata/${row.sym}.png`"
                  :alt="NAMES[row.sym]"
                >
                <div class="spn-pay__vals">
                  <p
                    v-for="n in [5, 4, 3]"
                    :key="n"
                  >
                    <span>{{ n }}</span>{{ formatNumber(row.pays[n - 3]! * lineBet) }}
                  </p>
                </div>
              </div>
            </div>
            <p class="spn-info__note">
              The Wild stands in for every symbol except the Scatter and the Piñata, and pays its own table above.
            </p>
          </section>

          <!-- Features -->
          <section
            v-else-if="tab === 'features'"
            class="spn-info__body"
          >
            <div class="spn-feat">
              <img
                src="/slots/spinata/scatter.png"
                alt="Scatter"
              >
              <div>
                <h3>Scatter: free spins</h3>
                <p>{{ SPN_SCATTER_TRIGGER }} or more Scatters anywhere start <b>{{ SPN_FREE_SPINS }} free spins</b>, on average once every {{ formatNumber(freeSpinOdds) }} spins. Scatters also pay anywhere:</p>
                <p class="spn-feat__pays">
                  <span
                    v-for="n in [3, 4, 5]"
                    :key="n"
                  >{{ n }} = {{ coins(SCATTER_PAY[n]!) }}</span>
                </p>
              </div>
            </div>

            <div class="spn-feat">
              <img
                src="/slots/spinata/pinata.png"
                alt="Piñata"
              >
              <div>
                <h3>Piñata prize</h3>
                <p>{{ SPN_BONUS_TRIGGER }} or more Piñatas anywhere break open for an instant prize. They don't need to be on a line.</p>
                <p class="spn-feat__pays">
                  <span
                    v-for="n in [3, 4, 5]"
                    :key="n"
                  >{{ n }} = {{ coins(BONUS_PAY[n]!) }}</span>
                </p>
              </div>
            </div>

            <div class="spn-feat spn-feat--fs">
              <img
                src="/slots/spinata/wild.png"
                alt="Wild"
              >
              <div>
                <h3>Free spins multiplier</h3>
                <p>The multiplier starts at ×{{ SPN_TRACK_START }}. Every Wild that lands adds +1, up to ×{{ SPN_TRACK_CAP }}, and it never resets during the feature. Line wins are multiplied by the value after that spin's Wilds are added.</p>
              </div>
            </div>

            <div class="spn-feat spn-feat--fs">
              <img
                src="/slots/spinata/pinata.png"
                alt="Piñata"
              >
              <div>
                <h3>Piñata pot</h3>
                <p>During free spins every Piñata, even a single one, drops a prize into the pot. The pot pays when the free spins end.</p>
                <p class="spn-feat__pays">
                  <span
                    v-for="o in potOdds"
                    :key="o.prize"
                  >{{ coins(o.prize) }} <small>{{ o.pct }}%</small></span>
                </p>
              </div>
            </div>

            <div class="spn-feat">
              <div class="spn-feat__icon">
                <UIcon
                  name="i-lucide-ticket"
                  class="size-8"
                />
              </div>
              <div>
                <h3>Buy free spins</h3>
                <p>Pay {{ SPN_BUY_BONUS_COST }}× your bet ({{ coins(SPN_BUY_BONUS_COST) }}) to land {{ SPN_SCATTER_TRIGGER }} Scatters on the next spin and go straight to the feature.</p>
              </div>
            </div>
          </section>

          <!-- Paylines -->
          <section
            v-else-if="tab === 'lines'"
            class="spn-info__body"
          >
            <p class="spn-info__note">
              {{ SPN_LINES }} fixed lines. Each needs 3 or more matching symbols from the leftmost reel.
            </p>
            <div class="spn-lines">
              <div
                v-for="(rows, i) in PAYLINES"
                :key="i"
                class="spn-lines__item"
              >
                <svg
                  viewBox="0 0 50 30"
                  aria-hidden="true"
                >
                  <template
                    v-for="c in SPN_COLS"
                    :key="c"
                  >
                    <rect
                      v-for="r in SPN_ROWS"
                      :key="r"
                      :x="(c - 1) * 10 + 1"
                      :y="(r - 1) * 10 + 1"
                      width="8"
                      height="8"
                      rx="1.5"
                      :class="rows[c - 1] === r - 1 ? 'on' : ''"
                    />
                  </template>
                  <path :d="linePath(rows)" />
                </svg>
                <span>{{ i + 1 }}</span>
              </div>
            </div>
          </section>

          <!-- Rules -->
          <section
            v-else
            class="spn-info__body spn-rules"
          >
            <ul>
              <li>{{ SPN_COLS }} reels, {{ SPN_ROWS }} rows and {{ SPN_LINES }} fixed paylines. Your line bet is the total bet divided by {{ SPN_LINES }}.</li>
              <li>Only the highest win on each line pays. Wins on different lines add up.</li>
              <li>Scatter and Piñata prizes are added to line wins.</li>
              <li>Scatters don't appear during free spins, so the feature can't retrigger. The instant Piñata prize is a base game feature; during free spins Piñatas fill the pot instead.</li>
              <li>A single round pays at most {{ formatNumber(SPN_MAX_WIN_MULT, false) }}× the bet.</li>
              <li>Theoretical return to player: {{ rtp }}%.</li>
              <li>Space spins. Press it again while the reels turn to stop them early.</li>
            </ul>
          </section>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.spn-info { width: min(760px, 100%); }
.spn-info__tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.3);
  margin-bottom: 14px;
}
.spn-info__tab {
  flex: 1;
  padding: 8px 4px;
  border-radius: 10px;
  font-weight: 800;
  font-size: 13px;
  color: rgba(244, 228, 255, 0.7);
  cursor: pointer;
}
.spn-info__tab:hover { color: #fff; }
.spn-info__tab--on {
  color: #2a0616;
  background: linear-gradient(180deg, #ffe38a, #ffb400);
}
.spn-info__body { font-size: 14px; line-height: 1.5; color: #eadcf5; }
.spn-info__note { color: rgba(234, 220, 245, 0.75); font-size: 13px; margin: 4px 0 12px; }
.spn-info__note b { color: #ffe38a; }

.spn-pay { display: grid; gap: 8px; margin-bottom: 10px; }
.spn-pay--high { grid-template-columns: repeat(5, 1fr); }
.spn-pay--low { grid-template-columns: repeat(5, 1fr); }
.spn-pay__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px 10px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02));
  border: 1px solid rgba(255, 210, 120, 0.18);
}
.spn-pay__card--wild {
  border-color: rgba(255, 210, 60, 0.7);
  box-shadow: 0 0 18px rgba(255, 190, 40, 0.25) inset;
}
.spn-pay__card img { width: 64px; height: 64px; object-fit: contain; filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.4)); }
.spn-pay--low .spn-pay__card img { width: 52px; height: 52px; }
.spn-pay__vals { width: 100%; padding: 0 6px; }
.spn-pay__vals p {
  display: flex;
  justify-content: space-between;
  font-weight: 800;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #fff3d0;
}
.spn-pay__vals span { color: rgba(255, 210, 120, 0.7); font-weight: 700; }

.spn-feat {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 210, 120, 0.15);
  margin-bottom: 10px;
}
.spn-feat--fs { border-color: rgba(255, 61, 127, 0.4); background: rgba(255, 61, 127, 0.07); }
.spn-feat img { width: 64px; height: 64px; object-fit: contain; flex-shrink: 0; }
.spn-feat__icon { width: 64px; height: 64px; display: grid; place-items: center; flex-shrink: 0; color: #ffd23f; }
.spn-feat h3 {
  font-family: 'Lilita One', 'Arial Black', system-ui, sans-serif;
  font-size: 19px;
  color: #ffd23f;
  margin-bottom: 2px;
}
.spn-feat b { color: #fff; }
.spn-feat__pays { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.spn-feat__pays span {
  padding: 2px 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  font-weight: 800;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #fff3d0;
}
.spn-feat__pays small { color: rgba(255, 210, 120, 0.7); font-weight: 700; }

.spn-lines { display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 8px; }
.spn-lines__item {
  position: relative;
  padding: 6px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.25);
}
.spn-lines__item svg { display: block; width: 100%; }
.spn-lines__item rect { fill: rgba(255, 255, 255, 0.07); }
.spn-lines__item rect.on { fill: rgba(255, 190, 40, 0.35); }
.spn-lines__item path { fill: none; stroke: #ff3d7f; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.spn-lines__item span {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 9px;
  font-weight: 800;
  color: rgba(255, 230, 180, 0.8);
}

.spn-rules ul { display: grid; gap: 8px; padding-left: 18px; list-style: disc; }
.spn-rules li::marker { color: #ff3d7f; }

@media (max-width: 560px) {
  .spn-pay--high, .spn-pay--low { grid-template-columns: repeat(3, 1fr); }
  .spn-feat img, .spn-feat__icon { width: 48px; height: 48px; }
}
</style>
