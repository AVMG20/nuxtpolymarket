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

const tab = ref('pays')
const tabs = [
  { label: 'Symbol pays', value: 'pays', icon: 'i-lucide-coins' },
  { label: 'Hold & Win', value: 'bonus', icon: 'i-lucide-orbit' },
  { label: 'Game info', value: 'info', icon: 'i-lucide-info' }
]

const PAY_ORDER: Exclude<SlotSymbol, 'bonus'>[] = ['wild', 'diamond', 'seven', 'bell', 'ace', 'king', 'queen', 'jack', 'ten']

// PAYTABLE is in line bets; a line bet is bet / XENOSLOT_LINES.
const rows = computed(() => PAY_ORDER.map(sym => ({
  sym,
  name: XENO_SYMBOLS[sym].name,
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
    :ui="{ overlay: 'bg-default/80 backdrop-blur-sm', content: 'xs-modal max-w-2xl', header: 'hidden', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <div class="xs-pt">
        <div class="xs-pt__head">
          <div>
            <p class="xs-pt__h">Xeno Slot</p>
            <p class="xs-pt__title">Flight manual</p>
          </div>
          <UButton color="neutral" variant="ghost" icon="i-lucide-x" aria-label="Close paytable" class="ml-auto" @click="open = false" />
        </div>

        <UTabs v-model="tab" :items="tabs" :ui="{ list: 'mx-4 mt-4', content: 'xs-pt__scroll' }" class="min-h-0 gap-0">
          <template #content="{ item }">
            <!-- Pays -->
            <section v-if="item.value === 'pays'" class="space-y-5">
              <p class="xs-pt__lead">
                Line wins pay left to right from the first reel. Amounts are for your current bet of
                <strong>{{ formatNumber(bet) }}</strong>. Only the best win on each line pays.
              </p>

              <div class="xs-pt__premium">
                <div v-for="row in premium" :key="row.sym" class="xs-pt__card">
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
                  <img :src="art(row.sym)" :alt="row.name" class="size-16">
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
            <section v-else-if="item.value === 'bonus'" class="space-y-5">
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
                <UIcon name="i-lucide-shopping-cart" class="size-8 shrink-0 text-warning" />
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
          </template>
        </UTabs>
      </div>
    </template>
  </UModal>
</template>

<style>
/* Teleported content: keep every selector scoped to this handbook. */
.xs-modal {
  --ui-primary: var(--color-lime-400);
  --ui-secondary: var(--color-violet-400);
  background: color-mix(in srgb, var(--ui-secondary) 9%, var(--ui-bg));
  color: var(--ui-text);
  border: 1px solid var(--ui-border-accented);
  border-radius: 24px;
  font-family: var(--font-sans), system-ui, sans-serif;
}
.xs-pt { display: flex; flex-direction: column; max-height: min(85dvh, 820px); }
.xs-pt__head { display: flex; align-items: center; gap: 12px; padding: 22px 24px 18px; border-bottom: 1px solid var(--ui-border); }
.xs-pt__title { font-size: 25px; font-weight: 600; line-height: 1.15; letter-spacing: -0.025em; color: var(--ui-text-highlighted); }
.xs-pt__h { margin-bottom: 6px; font-size: 10px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ui-text-muted); }
.xs-pt__scroll { overflow-y: auto; min-height: 0; padding: 20px 24px 24px; font-size: 14px; line-height: 1.65; scrollbar-width: thin; }
.xs-pt__lead { color: var(--ui-text-muted); }
.xs-pt__scroll strong { color: var(--ui-text-highlighted); font-weight: 600; }
.xs-pt__premium { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.xs-pt__card { display: flex; align-items: center; gap: 14px; padding: 16px 12px; border-radius: 16px; background: var(--ui-bg-elevated); border: 1px solid var(--ui-border); }
.xs-pt__art { width: 88px; height: 88px; flex-shrink: 0; filter: drop-shadow(0 6px 5px color-mix(in srgb, var(--ui-bg-inverted) 12%, transparent)); }
.xs-pt__name { font-weight: 600; color: var(--ui-text-highlighted); margin-bottom: 4px; }
.xs-pt__pays { display: grid; grid-template-columns: auto 1fr; column-gap: 10px; font-variant-numeric: tabular-nums; font-size: 13px; }
.xs-pt__pays dt { color: var(--ui-text-muted); }
.xs-pt__pays dd { color: var(--ui-text-highlighted); text-align: right; font-weight: 600; }
.xs-pt__pays dd.is-top { color: var(--ui-primary); }
.xs-pt__royals { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.xs-pt__royal { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px; border-radius: 14px; background: var(--ui-bg-muted); border: 1px solid var(--ui-border); }
.xs-pt__royal-name { font-size: 12px; color: var(--ui-text-highlighted); font-weight: 500; text-align: center; }
.xs-pt__pays--stack { width: 100%; margin-top: 4px; font-size: 12px; }
.xs-pt__specials { display: grid; gap: 10px; }
.xs-pt__special, .xs-pt__step { display: flex; align-items: center; gap: 14px; padding: 16px; border-radius: 14px; background: var(--ui-bg-muted); border: 1px solid var(--ui-border); color: var(--ui-text-muted); }
.xs-pt__step { align-items: flex-start; }
.xs-pt__tiers { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 12px; font-size: 13px; }
.xs-pt__tiers li { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-text); }
.xs-pt__items { display: grid; gap: 8px; margin-top: 12px; }
.xs-pt__items li { display: flex; align-items: center; gap: 8px; }
.xs-pt__facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.xs-pt__facts > div { padding: 14px; border-radius: 12px; background: var(--ui-bg-muted); border: 1px solid var(--ui-border); }
.xs-pt__facts dt { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ui-text-muted); }
.xs-pt__facts dd { font-size: 17px; font-weight: 600; color: var(--ui-text-highlighted); }
.xs-pt__list { display: grid; gap: 8px; padding-left: 18px; list-style: disc; color: var(--ui-text-muted); }
@media (max-width: 520px) {
  .xs-pt__head { padding: 18px 16px; }
  .xs-pt__scroll { padding: 16px; }
  .xs-pt__premium { grid-template-columns: 1fr; }
  .xs-pt__facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .xs-pt__step { gap: 10px; padding: 12px; }
  .xs-pt__step > img { width: 44px; height: 44px; }
}
.xs-pt__title { font-family: 'Audiowide', sans-serif; font-size: 21px; }
.xs-pt__lines { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.xs-pt__line { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px; border-radius: 10px; background: var(--ui-bg-muted); font-size: 12px; font-weight: 600; }
.xs-pt__note { display: flex; align-items: flex-start; gap: 8px; padding: 14px; border-radius: 12px; color: var(--ui-warning); background: color-mix(in srgb, var(--ui-warning) 8%, transparent); border: 1px solid color-mix(in srgb, var(--ui-warning) 25%, transparent); }
@media (max-width: 520px) {
  .xs-pt__royals, .xs-pt__lines { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
