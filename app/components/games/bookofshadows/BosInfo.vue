<script setup lang="ts">
// Paytable, feature and rules for Book of Shadows, generated from the game's
// real constants so it can never drift from what the server pays.
import type { SlotSymbol } from '#shared/utils/gamelogic/bookofshadows'
import {
  BONUS_RETRIGGER_BOOKS,
  BONUS_RETRIGGER_SPINS,
  BONUS_SPINS,
  BONUS_TIERS,
  BONUS_TRIGGER_COUNT,
  BOS_BUY_BONUS_COST,
  BOS_COLS,
  BOS_MAX_WIN_MULT,
  BOS_MIN_CONNECTION,
  BOS_ROWS,
  PAYTABLE
} from '#shared/utils/gamelogic/bookofshadows'
import { bosIconStyle } from '~/utils/bookofshadows-sprite'
import BosDialog from './BosDialog.vue'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  bet: number
  history: { payout: number, bet: number, bonus: boolean }[]
}>()

type Tab = 'pays' | 'feature' | 'rules' | 'history'
const tab = ref<Tab>('pays')
const TABS: { id: Tab, label: string }[] = [
  { id: 'pays', label: 'Paytable' },
  { id: 'feature', label: 'Free Spins' },
  { id: 'rules', label: 'Rules' },
  { id: 'history', label: 'History' }
]

const NAMES: Record<SlotSymbol, string> = {
  book: 'Book',
  hood: 'Hood',
  scythe: 'Scythe',
  orb: 'Orb',
  sword: 'Sword',
  ace: 'Ace',
  king: 'King',
  queen: 'Queen',
  jack: 'Jack',
  ten: 'Ten',
  bonuswild: 'Wild column'
}

const ORDER: SlotSymbol[] = ['book', 'hood', 'scythe', 'orb', 'sword', 'ace', 'king', 'queen', 'jack', 'ten']
const rows = computed(() => ORDER.map(id => ({ id, name: NAMES[id], pays: PAYTABLE[id] })))

const tierWeight = BONUS_TIERS.reduce((sum, t) => sum + t.weight, 0)
const tiers = BONUS_TIERS.map(t => ({ ...t, odds: `1 in ${Math.round(tierWeight / t.weight)}` }))

const x = (n: number) => `${formatNumber(n, false)}×`
const at = (mult: number) => formatNumber(mult * props.bet)
</script>

<template>
  <BosDialog
    v-model:open="open"
    title="How to play"
  >
    <template #tabs>
      <nav class="bos-info-tabs">
        <button
          v-for="t in TABS"
          :key="t.id"
          type="button"
          class="bos-info-tab"
          :class="{ 'bos-info-tab-on': tab === t.id }"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </nav>
    </template>

    <!-- Paytable -->
    <div v-if="tab === 'pays'">
      <p class="bos-info-lead">
        Pays for {{ BOS_MIN_CONNECTION }}, 4 or 5 connected reels, shown at your bet of <strong>{{ formatNumber(bet) }}</strong>. The small figure is the multiple of your bet.
      </p>
      <div class="bos-pay-grid">
        <div
          v-for="row in rows"
          :key="row.id"
          class="bos-pay-card"
          :class="{ 'bos-pay-card-wild': row.id === 'book' }"
        >
          <div class="bos-pay-art">
            <span :style="bosIconStyle(row.id, false, 58)" />
          </div>
          <div class="bos-pay-body">
            <p class="bos-pay-name">
              {{ row.name }}
              <span
                v-if="row.id === 'book'"
                class="bos-pay-tag"
              >Wild · Scatter</span>
            </p>
            <ol class="bos-pay-list">
              <li
                v-for="(mult, i) in row.pays"
                :key="i"
              >
                <span class="bos-pay-reels">{{ i + BOS_MIN_CONNECTION }}</span>
                <strong>{{ at(mult) }}</strong>
                <em>{{ x(mult) }}</em>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>

    <!-- Free spins -->
    <div
      v-else-if="tab === 'feature'"
      class="bos-info-prose"
    >
      <h3>Trigger</h3>
      <p>{{ BONUS_TRIGGER_COUNT }} or more Books anywhere on the reels award <strong>{{ BONUS_SPINS }} free spins</strong>, played at the bet that triggered them.</p>

      <h3>The symbol draw</h3>
      <p>Before the first spin, one symbol is drawn. Its multiplier applies to every wild run for the whole feature.</p>
      <div class="bos-tier-grid">
        <div
          v-for="t in tiers"
          :key="t.id"
          class="bos-tier"
        >
          <span :style="bosIconStyle(t.symbol, true, 44)" />
          <strong>×{{ t.multiplier }}</strong>
          <span class="bos-tier-name">{{ t.label }}</span>
          <span class="bos-tier-odds">{{ t.odds }}</span>
        </div>
      </div>

      <h3>Wild columns</h3>
      <p>On each free spin, every reel without a wild column has a small chance to land a wild seal. The seal fills the whole reel and stays there until the feature ends.</p>

      <h3>Wild runs</h3>
      <p>A connection made only of wilds (wild columns and Books), starting on reel 1, pays the wild rate times the drawn multiplier:</p>
      <table class="bos-info-table">
        <thead>
          <tr>
            <th>Reels</th>
            <th>Wild rate</th>
            <th>At your bet</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(mult, i) in PAYTABLE.bonuswild"
            :key="i"
          >
            <td>{{ i + BOS_MIN_CONNECTION }}</td>
            <td>{{ x(mult) }}</td>
            <td>{{ at(mult) }} × drawn multiplier</td>
          </tr>
        </tbody>
      </table>
      <p>Wild columns also stand in for any symbol in ordinary wins. Those wins pay their normal paytable value.</p>

      <h3>Extra spins</h3>
      <p>{{ BONUS_RETRIGGER_BOOKS }} Books on a single free spin add <strong>{{ BONUS_RETRIGGER_SPINS }} spins</strong>. This happens at most once per feature; Books stop appearing after it.</p>

      <h3>Buy feature</h3>
      <p>Start the free spins straight away for <strong>{{ BOS_BUY_BONUS_COST }}× bet</strong> ({{ formatNumber(BOS_BUY_BONUS_COST * bet) }} at your bet).</p>
    </div>

    <!-- Rules -->
    <div
      v-else-if="tab === 'rules'"
      class="bos-info-prose"
    >
      <h3>Connections</h3>
      <p>The grid has {{ BOS_COLS }} reels and {{ BOS_ROWS }} rows. A win starts on the leftmost reel and runs to the right. On each next reel, the same symbol must sit in the same row or one row up or down, so a path can zigzag.</p>
      <p>{{ BOS_MIN_CONNECTION }}, 4 or 5 connected reels pay. Every connection on the grid pays, and the amounts add up.</p>

      <h3>The Book</h3>
      <p>The Book is wild: it stands in for every symbol. It is also the scatter that starts the free spins.</p>

      <h3>Limits</h3>
      <p>All pays are multiples of your total bet. One round, including its free spins, pays at most <strong>{{ formatNumber(BOS_MAX_WIN_MULT, false) }}× bet</strong>.</p>
      <p>Volatility is very high: long dry spells, with most of the value in the feature.</p>

      <h3>Controls</h3>
      <ul>
        <li><kbd>Space</kbd> spins. Press it again while the reels turn to stop them early.</li>
        <li>Turbo shortens every animation.</li>
        <li>Autoplay runs a set number of spins and can stop on the feature or a big win.</li>
      </ul>
    </div>

    <!-- History -->
    <div v-else>
      <p
        v-if="!history.length"
        class="bos-info-lead"
      >
        No spins yet this session.
      </p>
      <table
        v-else
        class="bos-info-table"
      >
        <thead>
          <tr>
            <th>Round</th>
            <th>Cost</th>
            <th>Win</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(h, i) in history"
            :key="i"
          >
            <td>{{ h.bonus ? 'Free spins' : 'Spin' }}</td>
            <td>{{ formatNumber(h.bet) }}</td>
            <td :class="{ 'bos-info-win': h.payout > 0 }">
              {{ formatNumber(h.payout) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </BosDialog>
</template>

<style scoped>
.bos-info-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  border-bottom: 1px solid rgba(214, 170, 90, 0.2);
  padding: 8px 14px 0;
}

.bos-info-tab {
  border-bottom: 2px solid transparent;
  padding: 8px 12px;
  color: rgba(232, 217, 189, 0.6);
  font-family: Cinzel, Georgia, serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  white-space: nowrap;
  cursor: pointer;
}

.bos-info-tab:hover {
  color: #f3e3c3;
}

.bos-info-tab-on {
  border-color: #f0c36a;
  color: #ffe6a8;
}

.bos-info-lead {
  margin-bottom: 14px;
  color: rgba(232, 217, 189, 0.75);
  font-size: 13px;
  line-height: 1.55;
}

.bos-info-lead strong {
  color: #ffe6a8;
}

.bos-pay-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}

.bos-pay-card {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid rgba(214, 170, 90, 0.2);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(40, 26, 14, 0.6), rgba(10, 6, 4, 0.6));
  padding: 10px 12px;
}

.bos-pay-card-wild {
  grid-column: 1 / -1;
  border-color: rgba(157, 255, 106, 0.4);
  background: linear-gradient(90deg, rgba(40, 60, 16, 0.5), rgba(10, 6, 4, 0.6));
}

.bos-pay-art {
  display: grid;
  width: 62px;
  height: 62px;
  flex: 0 0 auto;
  place-items: center;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.6));
}

.bos-pay-art > span {
  display: block;
}

.bos-pay-body {
  min-width: 0;
  flex: 1;
}

.bos-pay-name {
  font-family: Cinzel, Georgia, serif;
  font-size: 14px;
  font-weight: 900;
  color: #f3e3c3;
}

.bos-pay-tag {
  margin-left: 6px;
  border-radius: 999px;
  background: rgba(157, 255, 106, 0.16);
  padding: 2px 8px;
  color: #c4ff9e;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.bos-pay-list {
  margin-top: 4px;
  display: grid;
  gap: 1px;
}

.bos-pay-card-wild .bos-pay-list {
  grid-template-columns: repeat(3, max-content);
  column-gap: 26px;
}

.bos-pay-list li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.bos-pay-reels {
  width: 12px;
  color: #bfa47a;
  font-weight: 800;
}

.bos-pay-list strong {
  color: #ffe6a8;
  font-weight: 800;
}

.bos-pay-list em {
  color: rgba(232, 217, 189, 0.45);
  font-size: 11px;
  font-style: normal;
}

.bos-info-prose {
  font-size: 14px;
  line-height: 1.6;
  color: rgba(232, 217, 189, 0.85);
}

.bos-info-prose h3 {
  margin: 18px 0 4px;
  color: #ffd98a;
  font-family: Cinzel, Georgia, serif;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.bos-info-prose h3:first-child {
  margin-top: 0;
}

.bos-info-prose p + p {
  margin-top: 8px;
}

.bos-info-prose strong {
  color: #fff0c8;
}

.bos-info-prose ul {
  display: grid;
  gap: 4px;
  padding-left: 18px;
  list-style: disc;
}

.bos-info-prose kbd {
  border: 1px solid rgba(214, 170, 90, 0.45);
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.4);
  padding: 1px 6px;
  font-size: 12px;
}

.bos-tier-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 8px;
  margin: 10px 0 4px;
}

.bos-tier {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  border: 1px solid rgba(214, 170, 90, 0.2);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.3);
  padding: 8px 4px;
}

.bos-tier > span:first-child {
  display: block;
  margin-bottom: 2px;
}

.bos-tier strong {
  color: #ffe6a8;
  font-family: Cinzel, Georgia, serif;
  font-size: 15px;
}

.bos-tier-name {
  font-size: 11px;
  font-weight: 700;
}

.bos-tier-odds {
  color: rgba(232, 217, 189, 0.5);
  font-size: 10px;
}

.bos-info-table {
  width: 100%;
  margin: 8px 0;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.bos-info-table th {
  border-bottom: 1px solid rgba(214, 170, 90, 0.3);
  padding: 6px 8px;
  color: #bfa47a;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-align: left;
  text-transform: uppercase;
}

.bos-info-table td {
  border-bottom: 1px solid rgba(214, 170, 90, 0.1);
  padding: 6px 8px;
}

.bos-info-win {
  color: #ffe6a8;
  font-weight: 800;
}
</style>
