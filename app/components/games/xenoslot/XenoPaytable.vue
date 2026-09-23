<script setup lang="ts">
// Xeno Slot rules and paytable, built from the live game constants so the
// numbers can't drift from the math in shared/utils/gamelogic/xenoslot.ts.
import type { SlotSymbol } from '#shared/utils/gamelogic/xenoslot'
import {
  BONUS_FREE_SPINS,
  BONUS_TRIGGER_COUNT,
  PAYTABLE,
  SYMBOL_WEIGHTS,
  XENOSLOT_BUY_BONUS_COST,
  XENOSLOT_CELLS,
  XENOSLOT_LINES,
  XENOSLOT_MAX_WIN_MULT
} from '#shared/utils/gamelogic/xenoslot'
import { XENO_SYMBOLS, xenoArtDataUrl, type XenoArtId } from '~/utils/slots/xenoslot-art'
import { XENO_LINE_COLORS, XENO_PAYLINES } from '~/utils/slots/xenoslot-lines'

const props = defineProps<{
  bet: number
  rtp: string
  volatility: number
}>()

const open = defineModel<boolean>('open', { default: false })

const tab = ref<'pays' | 'bonus' | 'info'>('pays')

const PAY_ORDER: Exclude<SlotSymbol, 'bonus'>[] = ['wild', 'diamond', 'seven', 'bell', 'ace', 'king', 'queen', 'jack', 'ten']

// PAYTABLE is in line bets; a line bet is bet / XENOSLOT_LINES.
const rows = computed(() => PAY_ORDER.map(sym => ({
  sym,
  name: XENO_SYMBOLS[sym].name,
  color: XENO_SYMBOLS[sym].color,
  pays: PAYTABLE[sym].map(p => p * props.bet / XENOSLOT_LINES)
})))

const premium = computed(() => rows.value.slice(0, 4))
const royals = computed(() => rows.value.slice(4))

// Chance of 3+ portals across all cells, each cell an independent draw.
const bonusOdds = computed(() => {
  const total = Object.values(SYMBOL_WEIGHTS).reduce((a, b) => a + b, 0)
  const p = SYMBOL_WEIGHTS.bonus / total
  const q = 1 - p
  const choose = (n: number, k: number) => {
    let r = 1
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1)
    return r
  }
  let pLess = 0
  for (let k = 0; k < BONUS_TRIGGER_COUNT; k++) pLess += choose(XENOSLOT_CELLS, k) * p ** k * q ** (XENOSLOT_CELLS - k)
  const pTrigger = 1 - pLess
  return pTrigger > 0 ? Math.round(1 / pTrigger) : 0
})

const art = (id: XenoArtId) => xenoArtDataUrl(id, 128)

const COIN_TIERS: { id: XenoArtId, label: string }[] = [
  { id: 'coin-bronze', label: 'under 1×' },
  { id: 'coin-silver', label: '1× to 5×' },
  { id: 'coin-gold', label: '5× to 25×' },
  { id: 'coin-xenium', label: '25× and up' }
]

const CORES: XenoArtId[] = ['core-2', 'core-5', 'core-10']
</script>

<template>
  <UModal
    v-model:open="open"
    title="Paytable & rules"
    description="How Xeno Slot pays"
    :ui="{ overlay: 'bg-[#05010f]/75 backdrop-blur-sm', content: 'xs-modal max-w-2xl', header: 'hidden', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <div class="xs-pt">
        <div class="xs-pt__head">
          <p class="xs-pt__title">
            Paytable
          </p>
          <div class="xs-pt__tabs" role="tablist">
            <button
              v-for="t in ([['pays', 'Pays'], ['bonus', 'Hold & Win'], ['info', 'Game info']] as const)"
              :key="t[0]"
              role="tab"
              :aria-selected="tab === t[0]"
              class="xs-pt__tab"
              :class="{ 'is-active': tab === t[0] }"
              @click="tab = t[0]"
            >
              {{ t[1] }}
            </button>
          </div>
          <button class="xs-pt__close" aria-label="Close" @click="open = false">
            <UIcon name="i-lucide-x" class="size-5" />
          </button>
        </div>

        <div class="xs-pt__scroll">
          <!-- Pays -->
          <section v-if="tab === 'pays'" class="space-y-5">
            <p class="xs-pt__lead">
              Line wins pay left to right from the first reel. Amounts are for your current bet of
              <strong>{{ formatNumber(bet) }}</strong>. Only the best win on each line pays.
            </p>

            <div class="xs-pt__premium">
              <div v-for="row in premium" :key="row.sym" class="xs-pt__card" :style="{ '--c': row.color }">
                <img :src="art(row.sym)" :alt="row.name" class="xs-pt__art">
                <div class="min-w-0 flex-1">
                  <p class="xs-pt__name">
                    {{ row.name }}
                  </p>
                  <dl class="xs-pt__pays">
                    <template v-for="(amount, i) in row.pays" :key="i">
                      <dt>{{ 3 + i }}×</dt>
                      <dd :class="{ 'is-top': i === 2 }">
                        {{ formatNumber(amount) }}
                      </dd>
                    </template>
                  </dl>
                </div>
              </div>
            </div>

            <div class="xs-pt__royals">
              <div v-for="row in royals" :key="row.sym" class="xs-pt__royal">
                <img :src="art(row.sym)" :alt="row.name" class="size-12">
                <dl class="xs-pt__pays xs-pt__pays--stack">
                  <template v-for="(amount, i) in row.pays" :key="i">
                    <dt>{{ 3 + i }}×</dt>
                    <dd :class="{ 'is-top': i === 2 }">
                      {{ formatNumber(amount) }}
                    </dd>
                  </template>
                </dl>
              </div>
            </div>

            <div class="xs-pt__specials">
              <div class="xs-pt__special">
                <img :src="art('wild')" alt="Alien Wild" class="size-14 shrink-0">
                <p><strong>Alien Wild</strong> stands in for every symbol except the Portal. Five Wilds on a line is the top line win.</p>
              </div>
              <div class="xs-pt__special">
                <img :src="art('bonus')" alt="Portal" class="size-14 shrink-0">
                <p><strong>Portal</strong> pays nothing on a line. {{ BONUS_TRIGGER_COUNT }} or more anywhere on the reels start Hold &amp; Win.</p>
              </div>
            </div>

            <div>
              <p class="xs-pt__h">
                {{ XENOSLOT_LINES }} fixed paylines
              </p>
              <div class="xs-pt__lines">
                <div v-for="(line, i) in XENO_PAYLINES" :key="i" class="xs-pt__line">
                  <svg viewBox="0 0 50 30" class="w-full" aria-hidden="true">
                    <rect
                      v-for="c in 15"
                      :key="c"
                      :x="((c - 1) % 5) * 10 + 1"
                      :y="Math.floor((c - 1) / 5) * 10 + 1"
                      width="8"
                      height="8"
                      rx="1.5"
                      :fill="line[(c - 1) % 5] === Math.floor((c - 1) / 5) ? XENO_LINE_COLORS[i] : 'rgba(255,255,255,0.08)'"
                    />
                  </svg>
                  <span :style="{ color: XENO_LINE_COLORS[i] }">{{ i + 1 }}</span>
                </div>
              </div>
            </div>
          </section>

          <!-- Hold & Win -->
          <section v-else-if="tab === 'bonus'" class="space-y-5">
            <p class="xs-pt__lead">
              Land {{ BONUS_TRIGGER_COUNT }}+ Portals (about 1 in {{ formatNumber(bonusOdds) }} spins). Each Portal becomes a coin and you get
              <strong>{{ BONUS_FREE_SPINS }} bonus spins</strong> on the same grid. Every spin, each empty cell can land a coin, a multiplier core or a UFO.
            </p>

            <div class="xs-pt__step">
              <div class="flex shrink-0 -space-x-3">
                <img v-for="c in COIN_TIERS" :key="c.id" :src="art(c.id)" alt="" class="size-11">
              </div>
              <div>
                <p class="xs-pt__name">
                  Coins
                </p>
                <p>Stick to the board and carry a value in × bet. The metal shows the value:</p>
                <ul class="xs-pt__tiers">
                  <li v-for="c in COIN_TIERS" :key="c.id">
                    <img :src="art(c.id)" alt="" class="size-5">{{ c.label }}
                  </li>
                </ul>
              </div>
            </div>

            <div class="xs-pt__step">
              <div class="flex shrink-0 -space-x-3">
                <img v-for="c in CORES" :key="c" :src="art(c)" alt="" class="size-11">
              </div>
              <div>
                <p class="xs-pt__name">
                  Multiplier cores ×2, ×5, ×10
                </p>
                <p>Multiply every coin in the 8 surrounding cells, then disappear. Two cores next to the same coin stack.</p>
              </div>
            </div>

            <div class="xs-pt__step">
              <img :src="art('ufo-on')" alt="" class="size-16 shrink-0">
              <div>
                <p class="xs-pt__name">
                  UFO collector
                </p>
                <p>Beams up every coin on the board and adds their total to your win, then clears the grid for the spins that are left. Two UFOs in one spin each collect the full board.</p>
              </div>
            </div>

            <p class="xs-pt__note">
              <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0" />
              Coins only pay when a UFO collects them. Coins still on the board after the last spin pay nothing.
            </p>

            <div class="xs-pt__step">
              <UIcon name="i-lucide-shopping-cart" class="size-8 shrink-0 text-[#facc15]" />
              <div>
                <p class="xs-pt__name">
                  Buy bonus
                </p>
                <p>Start Hold &amp; Win straight away for {{ XENOSLOT_BUY_BONUS_COST }}× your bet ({{ formatNumber(bet * XENOSLOT_BUY_BONUS_COST) }} now), with {{ BONUS_TRIGGER_COUNT }} starting coins.</p>
              </div>
            </div>
          </section>

          <!-- Info -->
          <section v-else class="space-y-4">
            <dl class="xs-pt__facts">
              <div><dt>Grid</dt><dd>5 reels × 3 rows</dd></div>
              <div><dt>Paylines</dt><dd>{{ XENOSLOT_LINES }}, fixed</dd></div>
              <div><dt>RTP</dt><dd>{{ rtp }}</dd></div>
              <div><dt>Volatility</dt><dd>{{ volatility }} / 5</dd></div>
              <div><dt>Max win</dt><dd>{{ formatNumber(XENOSLOT_MAX_WIN_MULT, false) }}× bet</dd></div>
              <div><dt>Bonus odds</dt><dd>about 1 in {{ formatNumber(bonusOdds) }}</dd></div>
            </dl>
            <ul class="xs-pt__list">
              <li>Your bet is split evenly across the {{ XENOSLOT_LINES }} lines.</li>
              <li>Line wins and the bonus add together. The total per round is capped at {{ formatNumber(XENOSLOT_MAX_WIN_MULT, false) }}× bet.</li>
              <li>Every outcome is drawn on the server before the reels start. Turbo, quick stop and skipping animations never change a result.</li>
              <li>Space spins. Press it again while the reels turn to stop them early.</li>
            </ul>
          </section>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style>
/* Teleported modal content, so these are global and namespaced. */
.xs-modal {
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, rgba(124, 58, 237, 0.28), transparent 70%),
    linear-gradient(180deg, #160b2e, #0a0518);
  border: 1px solid rgba(196, 181, 253, 0.25);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 30px 80px rgba(0, 0, 0, 0.7), 0 0 60px rgba(168, 85, 247, 0.25);
  color: #ddd6fe;
}

.xs-pt {
  display: flex;
  flex-direction: column;
  max-height: min(80vh, 760px);
}

.xs-pt__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid rgba(196, 181, 253, 0.14);
}

.xs-pt__title {
  font-family: 'Audiowide', sans-serif;
  font-size: 20px;
  letter-spacing: 0.04em;
  background: linear-gradient(180deg, #f7fee7, #a3e635 55%, #22d3ee);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.xs-pt__tabs {
  display: flex;
  gap: 4px;
  margin-left: auto;
  padding: 3px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(196, 181, 253, 0.15);
}

.xs-pt__tab {
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #a78bfa;
  transition: background 0.15s, color 0.15s;
}

.xs-pt__tab:hover { color: #ede9fe; }

.xs-pt__tab.is-active {
  color: #1a0b2e;
  background: linear-gradient(180deg, #d9f99d, #84cc16);
  box-shadow: 0 0 12px rgba(163, 230, 53, 0.45);
}

.xs-pt__close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  color: #c4b5fd;
  transition: background 0.15s;
}

.xs-pt__close:hover { background: rgba(255, 255, 255, 0.08); }

.xs-pt__scroll {
  overflow-y: auto;
  padding: 16px 18px 20px;
  font-size: 14px;
  line-height: 1.5;
}

.xs-pt__lead { color: #c4b5fd; }
.xs-pt__lead strong, .xs-pt__scroll strong { color: #f5f3ff; }

.xs-pt__h {
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #a78bfa;
}

.xs-pt__premium {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
}

.xs-pt__card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--c) 16%, transparent), rgba(0, 0, 0, 0.3));
  border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
}

.xs-pt__art {
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.5));
}

.xs-pt__name {
  font-weight: 800;
  color: #f5f3ff;
  letter-spacing: 0.02em;
}

.xs-pt__pays {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 10px;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}

.xs-pt__pays dt { color: #8b7fb8; font-weight: 700; }
.xs-pt__pays dd { color: #e9d5ff; text-align: right; font-family: 'Chakra Petch', monospace; font-weight: 700; font-size: 13px; }
.xs-pt__pays dd.is-top { color: #fde047; }

.xs-pt__royals {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.xs-pt__royal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 6px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(196, 181, 253, 0.12);
}

.xs-pt__pays--stack { width: 100%; font-size: 12px; }

.xs-pt__specials {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.xs-pt__special, .xs-pt__step {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(196, 181, 253, 0.14);
  color: #c4b5fd;
}

.xs-pt__lines {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.xs-pt__line {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.3);
  font-family: 'Orbitron', monospace;
  font-weight: 800;
  font-size: 12px;
}

.xs-pt__tiers {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 6px;
  font-size: 12px;
}

.xs-pt__tiers li { display: inline-flex; align-items: center; gap: 4px; color: #e9d5ff; }

.xs-pt__note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(250, 204, 21, 0.08);
  border: 1px solid rgba(250, 204, 21, 0.3);
  color: #fde68a;
  font-size: 13px;
}

.xs-pt__facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}

.xs-pt__facts > div {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(196, 181, 253, 0.14);
}

.xs-pt__facts dt {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8b7fb8;
}

.xs-pt__facts dd {
  font-family: 'Chakra Petch', monospace;
  font-weight: 700;
  color: #f5f3ff;
}

.xs-pt__list {
  display: grid;
  gap: 6px;
  padding-left: 18px;
  list-style: disc;
  color: #c4b5fd;
}

@media (max-width: 520px) {
  .xs-pt__head { flex-wrap: wrap; }
  .xs-pt__tabs { order: 3; margin-left: 0; width: 100%; justify-content: space-between; }
  .xs-pt__royals { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .xs-pt__lines { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
