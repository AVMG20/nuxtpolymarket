<script setup lang="ts">
import type { FireBonusSymbol } from '#shared/utils/gamelogic/fireinthehole'
import { FITH_BUY_BONUS_COST, FITH_FREE_SPINS, FITH_MAX_CASCADES, FITH_MAX_LINES, FITH_MAX_WIN_MULT, FITH_MIN_CONNECTION, FITH_SCATTERS_FOR_BONUS, FITH_STARTING_LINES } from '#shared/utils/gamelogic/fireinthehole'
import { FITH_BONUS_FREQUENCY_LABEL, FITH_BOOST_RANGE, FITH_COIN_RANGE, FITH_PAY_ORDER, FITH_RTP_LABEL, FITH_SYMBOL_LABEL, FITH_SYMBOL_PAY, FITH_WIN_TIERS, fithChainMultiplier } from '~/utils/fireinthehole-paytable'
import FithSymbolIcon from './FithSymbolIcon.vue'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ bet: number }>()

const tab = ref<'pays' | 'features' | 'bonus' | 'info'>('pays')
const TABS = [
    { id: 'pays', label: 'Paytable' },
    { id: 'features', label: 'Dynamite' },
    { id: 'bonus', label: 'Free spins' },
    { id: 'info', label: 'Game info' }
] as const

const SIZES = [FITH_MIN_CONNECTION, 8, 12]

const pays = computed(() => FITH_PAY_ORDER.map(symbol => ({
    symbol,
    name: FITH_SYMBOL_LABEL[symbol],
    each: FITH_SYMBOL_PAY[symbol],
    groups: SIZES.map(size => ({ size, amount: FITH_SYMBOL_PAY[symbol] * size * props.bet }))
})))

const chain = Array.from({ length: FITH_MAX_CASCADES }, (_, i) => fithChainMultiplier(i))

const BONUS_SYMBOLS: { symbol: FireBonusSymbol, name: string, text: string }[] = [
    { symbol: 'coin', name: 'Gold coin', text: `Worth ${FITH_COIN_RANGE.min}x to ${FITH_COIN_RANGE.max}x your bet. It stays on the board until the bonus ends.` },
    { symbol: 'boost', name: 'Boost', text: `Stays on the board. Every spin it adds its value (${FITH_BOOST_RANGE.min}x to ${FITH_BOOST_RANGE.max}x) to every coin and collector. It pays nothing itself.` },
    { symbol: 'double', name: 'Double', text: 'Doubles every coin and collector on the board, then disappears.' },
    { symbol: 'collector', name: 'Collector', text: 'Stays on the board and pulls in the value of every coin. One can land per spin, only once a coin is showing.' }
]

function close() {
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
    <Transition name="fith-info">
      <div
        v-if="open"
        class="fith-info-backdrop"
        @click.self="close"
      >
        <section
          class="fith-info"
          role="dialog"
          aria-modal="true"
          aria-label="Paytable and rules"
        >
          <header class="fith-info-head">
            <h2>Paytable & rules</h2>
            <button
              class="fith-info-close"
              aria-label="Close"
              @click="close"
            >
              <UIcon
                name="i-lucide-x"
                class="size-5"
              />
            </button>
          </header>

          <nav class="fith-info-tabs">
            <button
              v-for="t in TABS"
              :key="t.id"
              :class="{ active: tab === t.id }"
              @click="tab = t.id"
            >
              {{ t.label }}
            </button>
          </nav>

          <div class="fith-info-body">
            <template v-if="tab === 'pays'">
              <p class="lead">
                Connect {{ FITH_MIN_CONNECTION }} or more matching symbols that touch up, down, left or right. Every symbol in the group pays, so bigger groups pay more.
              </p>
              <div class="pay-table">
                <div class="pay-row pay-row-head">
                  <span />
                  <span>Each</span>
                  <span
                    v-for="size in SIZES"
                    :key="size"
                  >{{ size }} in a group</span>
                </div>
                <div
                  v-for="row in pays"
                  :key="row.symbol"
                  class="pay-row"
                >
                  <span class="pay-sym">
                    <FithSymbolIcon
                      :symbol="row.symbol"
                      :size="40"
                    />
                    <b>{{ row.name }}</b>
                  </span>
                  <span class="pay-mult">{{ row.each }}x</span>
                  <span
                    v-for="g in row.groups"
                    :key="g.size"
                    class="pay-amount"
                  >{{ formatNumber(g.amount) }}</span>
                </div>
              </div>
              <p class="note">
                Amounts are for your current bet of {{ formatNumber(bet, false) }}.
              </p>

              <h3>Cascades</h3>
              <p>
                Winning symbols crumble and everything above drops down, with new rock falling in from the top. Each new win in the same spin pays a bigger multiplier. A spin can cascade up to {{ FITH_MAX_CASCADES }} times.
              </p>
              <div class="chain">
                <span
                  v-for="(m, i) in chain"
                  :key="i"
                >x{{ m.toFixed(2) }}</span>
              </div>
            </template>

            <template v-else-if="tab === 'features'">
              <div class="feature">
                <FithSymbolIcon
                  symbol="bomb"
                  :size="64"
                />
                <div>
                  <h3>Dynamite is wild</h3>
                  <p>
                    It stands in for any symbol to complete a group. When it's part of a win it explodes and clears the 8 tiles around it. Symbols caught in the blast pay as if they won, and any dynamite in range goes off too. Lanterns survive the blast.
                  </p>
                </div>
              </div>
              <div class="feature">
                <FithSymbolIcon
                  symbol="rock"
                  :size="64"
                />
                <div>
                  <h3>Dig deeper</h3>
                  <p>
                    The mine opens with {{ FITH_STARTING_LINES }} rows. Every stick of dynamite that explodes in the bottom 2 open rows breaks through one more row, down to {{ FITH_MAX_LINES }}. New rows never hold dynamite. The next spin starts at {{ FITH_STARTING_LINES }} rows again.
                  </p>
                </div>
              </div>
              <div class="feature">
                <FithSymbolIcon
                  symbol="scatter"
                  :size="64"
                />
                <div>
                  <h3>Lanterns</h3>
                  <p>
                    Lanterns don't pay on their own. Once the cascades stop, {{ FITH_SCATTERS_FOR_BONUS }} or more lanterns on the board start {{ FITH_FREE_SPINS }} free spins.
                  </p>
                </div>
              </div>
            </template>

            <template v-else-if="tab === 'bonus'">
              <p class="lead">
                {{ FITH_FREE_SPINS }} free spins, played on every row you opened during the spin that triggered them. Each empty tile can catch a drop. More rows means more tiles.
              </p>
              <div
                v-for="b in BONUS_SYMBOLS"
                :key="b.symbol"
                class="feature"
              >
                <FithSymbolIcon
                  :symbol="b.symbol"
                  :size="56"
                />
                <div>
                  <h3>{{ b.name }}</h3>
                  <p>{{ b.text }}</p>
                </div>
              </div>
              <p class="note">
                After the last free spin you win the total of every coin and collector on the board.
              </p>
              <h3>Buy free spins</h3>
              <p>
                Pay {{ FITH_BUY_BONUS_COST }}x your bet ({{ formatNumber(bet * FITH_BUY_BONUS_COST, false) }}) to start the bonus right away with {{ FITH_STARTING_LINES }} rows open.
              </p>
            </template>

            <template v-else>
              <dl class="facts">
                <div><dt>Max win</dt><dd>{{ formatNumber(FITH_MAX_WIN_MULT, false) }}x bet</dd></div>
                <div><dt>Return to player</dt><dd>{{ FITH_RTP_LABEL }}</dd></div>
                <div><dt>Free spins</dt><dd>about {{ FITH_BONUS_FREQUENCY_LABEL }} spins</dd></div>
                <div><dt>Volatility</dt><dd>Very high</dd></div>
                <div><dt>Grid</dt><dd>6 columns, {{ FITH_STARTING_LINES }} to {{ FITH_MAX_LINES }} rows</dd></div>
              </dl>
              <p class="note">
                Return to player was measured over 300,000 simulated spins. Most of it comes from the free spins, so expect long quiet runs between big hits.
              </p>
              <h3>Win celebrations</h3>
              <div class="chain">
                <span
                  v-for="t in FITH_WIN_TIERS"
                  :key="t.id"
                >{{ t.label }} {{ t.min }}x+</span>
              </div>
              <h3>Controls</h3>
              <ul>
                <li><kbd>Space</kbd> spins. Press it again during a drop to land the rocks at once.</li>
                <li>Turbo shortens every animation.</li>
                <li>Auto spin plays a set number of spins and stops if your balance runs short.</li>
              </ul>
            </template>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fith-info-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(6, 3, 1, 0.72);
  backdrop-filter: blur(4px);
}

.fith-info {
  display: flex;
  flex-direction: column;
  width: min(640px, 100%);
  max-height: min(760px, calc(100dvh - 32px));
  overflow: hidden;
  border: 2px solid #7a4a1d;
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(255, 190, 90, 0.06), transparent 30%),
    linear-gradient(180deg, #221710, #140d08);
  box-shadow: 0 0 0 4px #2b1a0d, 0 0 0 5px #9a6a2e, 0 30px 80px rgba(0, 0, 0, 0.7);
  color: #e9dcc6;
}

.fith-info-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 10px;
}

.fith-info-head h2 {
  margin: 0;
  font-family: 'Rye', Georgia, serif;
  font-size: 24px;
  color: #ffd66b;
  text-shadow: 0 2px 0 #5a2d06;
}

.fith-info-close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  color: #e9dcc6;
  background: rgba(255, 255, 255, 0.06);
}

.fith-info-close:hover {
  background: rgba(255, 255, 255, 0.12);
}

.fith-info-tabs {
  display: flex;
  gap: 4px;
  padding: 0 14px;
  border-bottom: 1px solid rgba(255, 200, 120, 0.15);
  overflow-x: auto;
}

.fith-info-tabs button {
  padding: 9px 12px;
  border-bottom: 2px solid transparent;
  color: #b9a58a;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.fith-info-tabs button.active {
  border-color: #ffb238;
  color: #ffd66b;
}

.fith-info-body {
  overflow-y: auto;
  padding: 16px 18px 22px;
  font-size: 14px;
  line-height: 1.55;
}

.fith-info-body h3 {
  margin: 18px 0 6px;
  font-family: 'Rye', Georgia, serif;
  font-size: 17px;
  color: #ffc857;
}

.feature h3 {
  margin-top: 0;
}

.fith-info-body p {
  margin: 0 0 8px;
}

.lead {
  color: #f3e7d3;
}

.note {
  color: #a8957b;
  font-size: 12.5px;
}

.pay-table {
  display: grid;
  gap: 4px;
  margin: 12px 0 6px;
}

.pay-row {
  display: grid;
  grid-template-columns: minmax(120px, 1.6fr) 0.8fr repeat(3, 1fr);
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  font-variant-numeric: tabular-nums;
}

.pay-row-head {
  background: none;
  color: #a8957b;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.pay-sym {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pay-mult {
  color: #ffd66b;
  font-weight: 800;
}

.pay-amount {
  font-weight: 700;
}

.chain {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.chain span {
  padding: 3px 9px;
  border: 1px solid rgba(255, 178, 56, 0.35);
  border-radius: 999px;
  background: rgba(255, 140, 30, 0.08);
  color: #ffd66b;
  font-size: 12px;
  font-weight: 800;
}

.feature {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 200, 120, 0.08);
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 8px;
  margin: 0 0 10px;
}

.facts div {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}

.facts dt {
  color: #a8957b;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.facts dd {
  margin: 2px 0 0;
  color: #ffd66b;
  font-size: 17px;
  font-weight: 800;
}

ul {
  margin: 0;
  padding-left: 18px;
  list-style: disc;
}

li {
  margin-bottom: 4px;
}

kbd {
  padding: 1px 6px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 12px;
}

.fith-info-enter-active,
.fith-info-leave-active {
  transition: opacity 180ms ease;
}

.fith-info-enter-active .fith-info,
.fith-info-leave-active .fith-info {
  transition: transform 220ms cubic-bezier(0.2, 1.3, 0.4, 1);
}

.fith-info-enter-from,
.fith-info-leave-to {
  opacity: 0;
}

.fith-info-enter-from .fith-info {
  transform: scale(0.92) translateY(10px);
}

@media (max-width: 520px) {
  .pay-row {
    grid-template-columns: minmax(96px, 1.4fr) 0.8fr repeat(3, 1fr);
    font-size: 12px;
  }

  .pay-sym b {
    display: none;
  }
}
</style>
