<script setup lang="ts">
// Trash Panda Heist rules and paytable, built from the live game constants so
// the numbers can't drift from shared/utils/gamelogic/trashpanda.ts. The
// measured figures come from scripts/slot-rtp.ts (20M spins, 2M per buy).
import type { TphPaySymbol } from '#shared/utils/gamelogic/trashpanda'
import {
  DIVE_BINS,
  DIVE_CASH,
  DIVE_DOGS,
  DIVE_KEY_SPINS,
  FS_AWARD,
  FS_RETRIGGER_SPINS,
  FS_TRIGGER,
  FS_WILD_MULTS,
  PAYTABLE,
  TPH_BUY_DIVE_COST,
  TPH_BUY_FREE_SPINS_COST,
  TPH_COLS,
  TPH_MAX_WIN_MULT,
  TPH_ROWS,
  TPH_WAYS
} from '#shared/utils/gamelogic/trashpanda'
import { TPH_SYMBOLS, tphArtDataUrl, type TphArtId } from '~/utils/slots/trashpanda-art'
import { TPH_STATS } from '~/utils/slots/trashpanda-stats'

const props = defineProps<{ bet: number }>()

const open = defineModel<boolean>('open', { default: false })
const tab = ref<'pays' | 'features' | 'info'>('pays')

const PREMIUM: TphPaySymbol[] = ['boss', 'gem', 'bag', 'cash']
const LOW: TphPaySymbol[] = ['donut', 'pizza', 'apple', 'can', 'banana', 'fish']

const row = (sym: TphPaySymbol) => ({
  sym,
  name: TPH_SYMBOLS[sym].name,
  color: TPH_SYMBOLS[sym].color,
  pays: PAYTABLE[sym].map(p => p * props.bet)
})

const premium = computed(() => PREMIUM.map(row))
const lows = computed(() => LOW.map(row))

const art = (id: TphArtId) => tphArtDataUrl(id, 128)

const multOdds = computed(() => {
  const total = FS_WILD_MULTS.reduce((a, m) => a + m.weight, 0)
  return FS_WILD_MULTS.map(m => ({ mult: m.mult, pct: Math.round(m.weight / total * 100) }))
})

const cashRange = computed(() => {
  const values = DIVE_CASH.map(c => c.value)
  return { min: Math.min(...values), max: Math.max(...values) }
})

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
</script>

<template>
  <UModal
    v-model:open="open"
    title="Paytable & rules"
    description="How Trash Panda Heist pays"
    :ui="{ overlay: 'bg-[#0a0618]/75 backdrop-blur-sm', content: 'tph-modal max-w-2xl', header: 'hidden', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <div class="tph-pt">
        <div class="tph-pt__head">
          <p class="tph-pt__title">
            Paytable
          </p>
          <div class="tph-pt__tabs" role="tablist">
            <button
              v-for="t in ([['pays', 'Pays'], ['features', 'Bonuses'], ['info', 'Game info']] as const)"
              :key="t[0]"
              role="tab"
              :aria-selected="tab === t[0]"
              class="tph-pt__tab"
              :class="{ 'is-active': tab === t[0] }"
              @click="tab = t[0]"
            >
              {{ t[1] }}
            </button>
          </div>
          <button class="tph-pt__close" aria-label="Close" @click="open = false">
            <UIcon name="i-lucide-x" class="size-5" />
          </button>
        </div>

        <div class="tph-pt__scroll">
          <section v-if="tab === 'pays'" class="space-y-5">
            <p class="tph-pt__lead">
              {{ formatNumber(TPH_WAYS, false) }} ways. A symbol wins when it lands on 3 or more reels in a row, starting from the left, in any row.
              Two of it on one reel doubles the ways. Amounts are per way at your bet of <strong>{{ formatNumber(bet) }}</strong>.
            </p>

            <div class="tph-pt__premium">
              <div v-for="r in premium" :key="r.sym" class="tph-pt__card" :style="{ '--c': r.color }">
                <img :src="art(r.sym)" :alt="r.name" class="tph-pt__art">
                <div class="min-w-0 flex-1">
                  <p class="tph-pt__name">
                    {{ r.name }}
                  </p>
                  <dl class="tph-pt__pays">
                    <template v-for="(amount, i) in r.pays" :key="i">
                      <dt>{{ 3 + i }} reels</dt>
                      <dd :class="{ 'is-top': i === 2 }">
                        {{ formatNumber(amount) }}
                      </dd>
                    </template>
                  </dl>
                </div>
              </div>
            </div>

            <div class="tph-pt__lows">
              <div v-for="r in lows" :key="r.sym" class="tph-pt__low">
                <img :src="art(r.sym)" :alt="r.name" class="size-12">
                <dl class="tph-pt__pays tph-pt__pays--stack">
                  <template v-for="(amount, i) in r.pays" :key="i">
                    <dt>{{ 3 + i }}</dt>
                    <dd :class="{ 'is-top': i === 2 }">
                      {{ formatNumber(amount) }}
                    </dd>
                  </template>
                </dl>
              </div>
            </div>

            <div class="tph-pt__specials">
              <div class="tph-pt__special">
                <img :src="art('wild')" alt="Mask Wild" class="size-14 shrink-0">
                <p><strong>Mask Wild</strong> lands on reels 2 to 5 and stands in for every paying symbol.</p>
              </div>
              <div class="tph-pt__special">
                <img :src="art('safe')" alt="Safe" class="size-14 shrink-0">
                <p><strong>Safe</strong>: {{ FS_TRIGGER }} or more anywhere start the Night Heist free spins.</p>
              </div>
              <div class="tph-pt__special">
                <img :src="art('bin')" alt="Dumpster" class="size-14 shrink-0">
                <p><strong>Dumpster</strong> lands on reels 1, 3 and 5. One on each starts the Dumpster Dive.</p>
              </div>
            </div>
          </section>

          <section v-else-if="tab === 'features'" class="space-y-5">
            <div class="tph-pt__step">
              <img :src="art('wild5')" alt="" class="size-16 shrink-0">
              <div>
                <p class="tph-pt__name">
                  Night Heist free spins
                </p>
                <p>
                  {{ FS_TRIGGER }}, 4 or 5 Safes award {{ FS_AWARD[3] }}, {{ FS_AWARD[4] }} or {{ FS_AWARD[5] }} free spins (about 1 in {{ TPH_STATS.freeSpinsOdds }} spins).
                  Every Wild that lands carries a multiplier and <strong>sticks</strong> until the feature ends.
                  A win's multiplier is the <strong>sum</strong> of the Wilds in it, so two ×3 Wilds make a ×6 win.
                  {{ FS_TRIGGER }}+ Safes during the feature add {{ FS_RETRIGGER_SPINS }} spins.
                </p>
                <ul class="tph-pt__tiers">
                  <li v-for="m in multOdds" :key="m.mult">
                    <img :src="art(`wild${m.mult}` as TphArtId)" alt="" class="size-6">×{{ m.mult }} · {{ m.pct }}%
                  </li>
                </ul>
              </div>
            </div>

            <div class="tph-pt__step">
              <img :src="art('can-closed')" alt="" class="size-16 shrink-0">
              <div>
                <p class="tph-pt__name">
                  Dumpster Dive
                </p>
                <p>
                  A Dumpster on reels 1, 3 and 5 opens {{ DIVE_BINS }} trash cans (about 1 in {{ TPH_STATS.diveOdds }} spins). Pick cans until a guard dog catches you.
                  There are {{ DIVE_DOGS }} dogs. Cans can hold:
                </p>
                <ul class="tph-pt__items">
                  <li><img :src="art('coins')" alt="" class="size-7"><span><strong>Cash</strong> {{ cashRange.min }}× to {{ cashRange.max }}× bet</span></li>
                  <li><img :src="art('double')" alt="" class="size-7"><span><strong>Double</strong> doubles the haul so far</span></li>
                  <li><img :src="art('donut')" alt="" class="size-7"><span><strong>Donut</strong> the next dog eats it and you keep digging</span></li>
                  <li><img :src="art('key')" alt="" class="size-7"><span><strong>Golden key</strong> {{ DIVE_KEY_SPINS }} Night Heist free spins after the dive</span></li>
                  <li><img :src="art('dog')" alt="" class="size-7"><span><strong>Guard dog</strong> ends the dive. You keep the haul</span></li>
                </ul>
                <p class="mt-2">
                  The can you pick doesn't change the result. What comes out is decided before the reels stop.
                </p>
              </div>
            </div>

            <div class="tph-pt__step">
              <UIcon name="i-lucide-shopping-cart" class="size-8 shrink-0 text-[#4ade80]" />
              <div>
                <p class="tph-pt__name">
                  Buy a bonus
                </p>
                <p>
                  Night Heist: {{ TPH_BUY_FREE_SPINS_COST }}× bet ({{ formatNumber(bet * TPH_BUY_FREE_SPINS_COST) }}) for {{ FS_AWARD[3] }} free spins, RTP {{ pct(TPH_STATS.buyFreeSpinsRtp) }}.<br>
                  Dumpster Dive: {{ TPH_BUY_DIVE_COST }}× bet ({{ formatNumber(bet * TPH_BUY_DIVE_COST) }}), RTP {{ pct(TPH_STATS.buyDiveRtp) }}.
                </p>
              </div>
            </div>
          </section>

          <section v-else class="space-y-4">
            <dl class="tph-pt__facts">
              <div><dt>Grid</dt><dd>{{ TPH_COLS }} reels × {{ TPH_ROWS }} rows</dd></div>
              <div><dt>Ways</dt><dd>{{ formatNumber(TPH_WAYS, false) }}</dd></div>
              <div><dt>RTP</dt><dd>{{ pct(TPH_STATS.rtp) }}</dd></div>
              <div><dt>Volatility</dt><dd>High · {{ TPH_STATS.volatility }} / 5</dd></div>
              <div><dt>Max win</dt><dd>{{ formatNumber(TPH_MAX_WIN_MULT, false) }}× bet</dd></div>
              <div><dt>Any win</dt><dd>{{ pct(TPH_STATS.hitRate) }} of spins</dd></div>
            </dl>
            <div>
              <p class="tph-pt__h">
                Where the RTP comes from
              </p>
              <dl class="tph-pt__facts">
                <div><dt>Base game</dt><dd>{{ pct(TPH_STATS.baseRtp) }}</dd></div>
                <div><dt>Dumpster Dive</dt><dd>{{ pct(TPH_STATS.diveRtp) }}</dd></div>
                <div><dt>Night Heist</dt><dd>{{ pct(TPH_STATS.freeSpinsRtp) }}</dd></div>
              </dl>
            </div>
            <ul class="tph-pt__list">
              <li>Base wins, the dive and free spins add up. A round pays at most {{ formatNumber(TPH_MAX_WIN_MULT, false) }}× bet; free spins stop once that is reached.</li>
              <li>RTP is measured over {{ TPH_STATS.rounds }} simulated spins of the real game code.</li>
              <li>Every outcome is drawn on the server before the reels start. Turbo, quick stop and skipping never change a result.</li>
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
.tph-modal {
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, rgba(250, 204, 21, 0.14), transparent 70%),
    linear-gradient(180deg, #1b1238, #0d0820);
  border: 1px solid rgba(196, 181, 253, 0.25);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7);
  color: #d9d3f5;
  font-family: 'Fredoka', system-ui, sans-serif;
}

.tph-pt { display: flex; flex-direction: column; max-height: min(80vh, 760px); }

.tph-pt__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid rgba(196, 181, 253, 0.14);
}

.tph-pt__title {
  font-family: 'Bangers', sans-serif;
  font-size: 28px;
  letter-spacing: 0.05em;
  color: #fde047;
  -webkit-text-stroke: 1.5px #1a1030;
  paint-order: stroke fill;
  text-shadow: 2px 3px 0 #1a1030;
}

.tph-pt__tabs {
  display: flex;
  gap: 4px;
  margin-left: auto;
  padding: 3px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(196, 181, 253, 0.15);
}

.tph-pt__tab {
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: #a8a2cf;
  transition: background 0.15s, color 0.15s;
}

.tph-pt__tab:hover { color: #f5f3ff; }
.tph-pt__tab.is-active { color: #1a1030; background: linear-gradient(180deg, #fef08a, #facc15); }

.tph-pt__close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  color: #c4b5fd;
}

.tph-pt__close:hover { background: rgba(255, 255, 255, 0.08); }

.tph-pt__scroll { overflow-y: auto; padding: 16px 18px 20px; font-size: 14px; line-height: 1.5; }
.tph-pt__lead { color: #c9c2ec; }
.tph-pt__scroll strong { color: #fff; }

.tph-pt__h {
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #a8a2cf;
}

.tph-pt__premium {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
}

.tph-pt__card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--c) 16%, transparent), rgba(0, 0, 0, 0.3));
  border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
}

.tph-pt__art { width: 64px; height: 64px; flex-shrink: 0; }
.tph-pt__name { font-weight: 700; color: #fff; }

.tph-pt__pays {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 10px;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}

.tph-pt__pays dt { color: #8f88b8; font-weight: 600; }
.tph-pt__pays dd { color: #ede9fe; text-align: right; font-family: 'Lilita One', sans-serif; }
.tph-pt__pays dd.is-top { color: #fde047; }

.tph-pt__lows {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}

.tph-pt__low {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 6px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(196, 181, 253, 0.12);
}

.tph-pt__pays--stack { width: 100%; font-size: 12px; }

.tph-pt__specials { display: grid; gap: 10px; }

.tph-pt__special, .tph-pt__step {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(196, 181, 253, 0.14);
  color: #c9c2ec;
}

.tph-pt__step { align-items: flex-start; }

.tph-pt__tiers { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; font-size: 13px; }
.tph-pt__tiers li { display: inline-flex; align-items: center; gap: 4px; color: #ede9fe; }

.tph-pt__items { display: grid; gap: 4px; margin-top: 8px; }
.tph-pt__items li { display: flex; align-items: center; gap: 8px; }

.tph-pt__facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}

.tph-pt__facts > div {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(196, 181, 253, 0.14);
}

.tph-pt__facts dt {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8f88b8;
}

.tph-pt__facts dd { font-family: 'Lilita One', sans-serif; color: #fff; }

.tph-pt__list { display: grid; gap: 6px; padding-left: 18px; list-style: disc; color: #c9c2ec; }

@media (max-width: 520px) {
  .tph-pt__head { flex-wrap: wrap; }
  .tph-pt__tabs { order: 3; margin-left: 0; width: 100%; justify-content: space-between; }
  .tph-pt__lows { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
