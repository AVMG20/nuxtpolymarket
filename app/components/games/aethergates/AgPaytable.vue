<script setup lang="ts">
import type { AetherPaySymbol } from '#shared/utils/gamelogic/aethergates'
import {
  AETHER_MULT_VALUES_BASE,
  AETHER_MULT_VALUES_BONUS,
  AETHER_MULTIPLIER_WEIGHT,
  AETHER_PAY_SYMBOLS,
  AETHER_SCATTER_WEIGHT,
  AETHER_SYMBOL_WEIGHTS,
  AG_BONUS_CHANCE_COST,
  AG_BUY_FREESPINS_COST,
  AG_BUY_SUPERBONUS_COST,
  AG_CELLS,
  AG_COLS,
  AG_FREE_SPINS,
  AG_FREE_SPINS_SUPER,
  AG_MAX_WIN_MULT,
  AG_MIN_MATCH,
  AG_RETRIGGER_SPINS,
  AG_ROWS,
  AG_SCATTER_TRIGGER,
  AG_SCATTER_TRIGGER_SUPER,
  aetherPayMult
} from '#shared/utils/gamelogic/aethergates'
import { AG_ORB_TIERS, AG_SYMBOL_INFO, agSymbolDataUrl } from '~/utils/slots/aethergates-art'

// Paytable and rules, generated from the live game constants.

const props = defineProps<{ bet: number }>()
const emit = defineEmits<{ close: [] }>()

const tab = ref<'pays' | 'features' | 'info'>('pays')
const showCoins = ref(true)

// Count brackets the paytable steps at; the last one is a full board.
const BRACKETS = [
  { label: '8–9', count: 8 },
  { label: '10–11', count: 10 },
  { label: '12–14', count: 12 },
  { label: '15–19', count: 15 },
  { label: '20–24', count: 20 },
  { label: '25–29', count: 25 },
  { label: '30', count: 30 }
]

const rows = [...AETHER_PAY_SYMBOLS].reverse().map((sym: AetherPaySymbol) => ({
  sym,
  name: AG_SYMBOL_INFO[sym].name,
  pays: BRACKETS.map(b => aetherPayMult(sym, b.count))
}))

function pay(mult: number): string {
  return showCoins.value ? formatNumber(mult * props.bet, true, 0) : `${formatNumber(mult, false, 0)}×`
}

const orbRanges = AG_ORB_TIERS.map((tier, i) => {
  const next = AG_ORB_TIERS[i + 1]?.min ?? Infinity
  const base = AETHER_MULT_VALUES_BASE.filter(v => v >= tier.min && v < next)
  const bonus = AETHER_MULT_VALUES_BONUS.filter(v => v >= tier.min && v < next)
  return { i, tier, base, bonus }
})

// Chance a paid spin lands 3+ gates in the first drop (binomial over the cells).
const bonusOdds = computed(() => {
  const total = Object.values(AETHER_SYMBOL_WEIGHTS).reduce((a, b) => a + b, 0) + AETHER_SCATTER_WEIGHT + AETHER_MULTIPLIER_WEIGHT
  const p = AETHER_SCATTER_WEIGHT / total
  const choose = (n: number, k: number) => {
    let r = 1
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1)
    return r
  }
  let below = 0
  for (let k = 0; k < AG_SCATTER_TRIGGER; k++) below += choose(AG_CELLS, k) * p ** k * (1 - p) ** (AG_CELLS - k)
  return Math.round(1 / (1 - below))
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    class="ag-pt-scrim"
    @click.self="emit('close')"
  >
    <div
      class="ag-pt"
      role="dialog"
      aria-label="Paytable and rules"
    >
      <header class="ag-pt-head">
        <h2>Paytable &amp; rules</h2>
        <button
          class="ag-pt-x"
          aria-label="Close"
          @click="emit('close')"
        >
          <UIcon
            name="i-lucide-x"
            class="size-4"
          />
        </button>
      </header>
      <nav class="ag-pt-tabs">
        <button
          v-for="t in (['pays', 'features', 'info'] as const)"
          :key="t"
          :class="{ 'is-on': tab === t }"
          @click="tab = t"
        >
          {{ t === 'pays' ? 'Pays' : t === 'features' ? 'Features' : 'Game info' }}
        </button>
      </nav>

      <div class="ag-pt-body">
        <!-- PAYS -->
        <section v-if="tab === 'pays'">
          <p class="ag-pt-lead">
            Land <b>{{ AG_MIN_MATCH }} or more</b> of the same symbol <b>anywhere</b> on the {{ AG_COLS }}×{{ AG_ROWS }} grid. There are no paylines.
            Every symbol type that reaches {{ AG_MIN_MATCH }} pays in the same step.
          </p>
          <div class="ag-pt-toggle">
            <span>Show pays as</span>
            <button
              :class="{ 'is-on': showCoins }"
              @click="showCoins = true"
            >
              Coins at bet {{ formatNumber(bet, true, 0) }}
            </button>
            <button
              :class="{ 'is-on': !showCoins }"
              @click="showCoins = false"
            >
              × bet
            </button>
          </div>
          <div class="ag-pt-table-wrap">
            <table class="ag-pt-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th
                    v-for="b in BRACKETS"
                    :key="b.label"
                  >
                    {{ b.label }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in rows"
                  :key="row.sym"
                >
                  <td class="ag-pt-sym">
                    <img
                      :src="agSymbolDataUrl(row.sym, 96)"
                      :alt="row.name"
                    >
                    <span>{{ row.name }}</span>
                  </td>
                  <td
                    v-for="(p, i) in row.pays"
                    :key="i"
                  >
                    {{ pay(p) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="ag-pt-note">
            Column headings are how many matching symbols are on the grid.
          </p>
        </section>

        <!-- FEATURES -->
        <section v-else-if="tab === 'features'">
          <div class="ag-pt-card">
            <h3>Tumbles</h3>
            <p>Winning symbols shatter and the rest fall down. New symbols drop in from the top, and the grid pays again if it forms new wins. One spin can chain many tumbles.</p>
          </div>

          <div class="ag-pt-card">
            <h3>
              <img
                :src="agSymbolDataUrl('orb-2', 64)"
                alt=""
              > Storm orbs &amp; the multiplier meter
            </h3>
            <p>
              Storm orbs carry a multiplier. They never form part of a win. When a tumble step pays, every orb on the grid strikes the meter and adds its value to it.
              When the tumbles end, the spin's total win is multiplied by the meter.
            </p>
            <p>
              Orbs in the base game carry ×{{ AETHER_MULT_VALUES_BASE[0] }} to ×{{ AETHER_MULT_VALUES_BASE[AETHER_MULT_VALUES_BASE.length - 1] }}.
              In free spins they land more often and can carry up to ×{{ AETHER_MULT_VALUES_BONUS[AETHER_MULT_VALUES_BONUS.length - 1] }}.
              The meter resets on every paid spin.
            </p>
            <div class="ag-pt-orbs">
              <div
                v-for="o in orbRanges"
                :key="o.i"
                class="ag-pt-orb"
              >
                <img
                  :src="agSymbolDataUrl(`orb-${o.i}`, 96)"
                  :alt="o.tier.label"
                >
                <span>{{ o.bonus.length ? `×${o.bonus[0]}–${o.bonus[o.bonus.length - 1]}` : '' }}</span>
                <small>{{ o.base.length ? 'base & free spins' : 'free spins only' }}</small>
              </div>
            </div>
          </div>

          <div class="ag-pt-card">
            <h3>
              <img
                :src="agSymbolDataUrl('scatter', 64)"
                alt=""
              > Free spins
            </h3>
            <ul>
              <li><b>{{ AG_SCATTER_TRIGGER }}</b> Aether Gates anywhere on a paid spin award <b>{{ AG_FREE_SPINS }} free spins</b>.</li>
              <li><b>{{ AG_SCATTER_TRIGGER_SUPER }} or more</b> gates award the <b>Super Bonus</b>: {{ AG_FREE_SPINS_SUPER }} free spins.</li>
              <li>The multiplier meter carries over from the triggering spin and <b>never resets</b> during the feature.</li>
              <li>The first time {{ AG_SCATTER_TRIGGER }} or more gates land during the feature you get <b>+{{ AG_RETRIGGER_SPINS }} spins</b>. This happens at most once; after that no more gates appear.</li>
              <li>Gates only count on the first drop of a spin, never in tumbles.</li>
            </ul>
          </div>

          <div class="ag-pt-card">
            <h3>Feature buys</h3>
            <ul>
              <li><b>Buy Free Spins</b> ({{ AG_BUY_FREESPINS_COST }}× bet): start {{ AG_FREE_SPINS }} free spins straight away.</li>
              <li><b>Buy Super Bonus</b> ({{ AG_BUY_SUPERBONUS_COST }}× bet): start the {{ AG_FREE_SPINS_SUPER }}-spin Super Bonus.</li>
              <li><b>Bonus Chance</b> ({{ AG_BONUS_CHANCE_COST }}× bet per spin): gates land about twice as often while it's on.</li>
            </ul>
          </div>
        </section>

        <!-- INFO -->
        <section v-else>
          <dl class="ag-pt-facts">
            <div><dt>Grid</dt><dd>{{ AG_COLS }} reels × {{ AG_ROWS }} rows, pay anywhere</dd></div>
            <div><dt>Minimum win</dt><dd>{{ AG_MIN_MATCH }} matching symbols</dd></div>
            <div><dt>Return to player</dt><dd>about 96–98%</dd></div>
            <div><dt>Free spins frequency</dt><dd>about 1 in {{ formatNumber(bonusOdds) }} paid spins</dd></div>
            <div><dt>Maximum win</dt><dd>{{ formatNumber(AG_MAX_WIN_MULT, false, 0) }}× bet per round</dd></div>
          </dl>
          <div class="ag-pt-card">
            <h3>Controls</h3>
            <ul>
              <li><b>Space</b> spins. Tap the grid during a big-win count to skip it.</li>
              <li><b>Turbo</b> speeds up drops and tumbles. It doesn't change results.</li>
              <li><b>Autoplay</b> runs a set number of spins and can stop on free spins or a big win.</li>
              <li>Every outcome is decided on the server before the reels drop; the animation only shows it.</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ag-pt-scrim {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(3, 2, 12, 0.72);
  backdrop-filter: blur(4px);
}

.ag-pt {
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  max-height: min(86vh, 820px);
  border-radius: 18px;
  border: 2px solid #c9942d;
  background: linear-gradient(180deg, #1f1450, #0b0724);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7), 0 0 0 4px rgba(59, 29, 0, 0.8);
  color: #e0e7ff;
  overflow: hidden;
}

.ag-pt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 8px;
}

.ag-pt-head h2 {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 22px;
  font-weight: 900;
  color: #fde68a;
  letter-spacing: 0.05em;
}

.ag-pt-x {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  color: #fde68a;
  background: rgba(255, 255, 255, 0.06);
}

.ag-pt-tabs {
  display: flex;
  gap: 6px;
  padding: 0 18px 10px;
  border-bottom: 1px solid rgba(253, 230, 138, 0.15);
}

.ag-pt-tabs button {
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  color: rgba(224, 231, 255, 0.7);
}

.ag-pt-tabs button.is-on {
  background: linear-gradient(180deg, #fcd34d, #b7791f);
  color: #2a1402;
}

.ag-pt-body {
  overflow-y: auto;
  padding: 16px 18px 22px;
}

.ag-pt-lead {
  font-size: 14px;
  line-height: 1.55;
}

.ag-pt-lead b,
.ag-pt-card b {
  color: #fde68a;
}

.ag-pt-toggle {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 12px 0;
  font-size: 12px;
  color: rgba(224, 231, 255, 0.6);
}

.ag-pt-toggle button {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(253, 230, 138, 0.25);
  font-weight: 800;
  color: #fef3c7;
}

.ag-pt-toggle button.is-on {
  background: rgba(252, 211, 77, 0.2);
  border-color: #fcd34d;
}

.ag-pt-table-wrap {
  overflow-x: auto;
  border-radius: 12px;
  border: 1px solid rgba(253, 230, 138, 0.18);
}

.ag-pt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.ag-pt-table th {
  padding: 8px 8px;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-align: right;
  color: rgba(199, 210, 254, 0.7);
  background: rgba(255, 255, 255, 0.04);
  white-space: nowrap;
}

.ag-pt-table th:first-child {
  text-align: left;
}

.ag-pt-table td {
  padding: 4px 8px;
  text-align: right;
  font-weight: 800;
  color: #fef3c7;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  white-space: nowrap;
}

.ag-pt-table tr:nth-child(even) td {
  background: rgba(255, 255, 255, 0.025);
}

.ag-pt-sym {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left !important;
  color: #e0e7ff !important;
  font-weight: 700 !important;
}

.ag-pt-sym img {
  width: 40px;
  height: 40px;
}

.ag-pt-note {
  margin-top: 8px;
  font-size: 12px;
  color: rgba(224, 231, 255, 0.55);
}

.ag-pt-card {
  margin-bottom: 12px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(253, 230, 138, 0.14);
  background: rgba(255, 255, 255, 0.035);
  font-size: 14px;
  line-height: 1.55;
}

.ag-pt-card h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-family: 'Cinzel', Georgia, serif;
  font-size: 16px;
  font-weight: 900;
  color: #fde68a;
}

.ag-pt-card h3 img {
  width: 32px;
  height: 32px;
}

.ag-pt-card p + p {
  margin-top: 8px;
}

.ag-pt-card ul {
  display: grid;
  gap: 6px;
  padding-left: 18px;
  list-style: disc;
}

.ag-pt-orbs {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin-top: 12px;
}

.ag-pt-orb {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.ag-pt-orb img {
  width: 54px;
  height: 54px;
}

.ag-pt-orb span {
  font-weight: 900;
  color: #fef3c7;
  font-size: 13px;
}

.ag-pt-orb small {
  font-size: 10px;
  color: rgba(224, 231, 255, 0.55);
}

.ag-pt-facts {
  display: grid;
  gap: 6px;
  margin-bottom: 14px;
}

.ag-pt-facts div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
  font-size: 14px;
}

.ag-pt-facts dt {
  color: rgba(224, 231, 255, 0.65);
}

.ag-pt-facts dd {
  font-weight: 800;
  color: #fef3c7;
  text-align: right;
}

@media (max-width: 520px) {
  .ag-pt-orbs {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
