<script setup lang="ts">
// Ember Portals rules and paytable, built from the live game constants so the
// numbers can't drift from shared/utils/gamelogic/emberportals.ts. Measured
// figures come from ~/utils/slots/emberportals-stats.
import type { EpPaySymbol } from '#shared/utils/gamelogic/emberportals'
import {
  EP_ANTE_COST,
  EP_BRACKETS,
  EP_BUY_COST,
  EP_COLS,
  EP_MAX_WIN_MULT,
  EP_MIN_CLUSTER,
  EP_PAY_SYMBOLS,
  EP_ROWS,
  EP_WILD_MAX_MULT,
  FS_AWARD,
  FS_MAX_SPINS,
  FS_RETRIGGER_SPINS,
  FS_TRIGGER,
  PAYTABLE
} from '#shared/utils/gamelogic/emberportals'
import { EP_SYMBOLS, epArtDataUrl } from '~/utils/slots/emberportals-art'
import { EP_STATS } from '~/utils/slots/emberportals-stats'

const props = defineProps<{ bet: number, fontVars: Record<string, string> }>()

const open = defineModel<boolean>('open', { default: false })
const tab = ref('pays')
const tabs = [
  { label: 'Symbol pays', value: 'pays', icon: 'i-lucide-coins' },
  { label: 'Portals & bonus', value: 'features', icon: 'i-lucide-orbit' },
  { label: 'Game info', value: 'info', icon: 'i-lucide-info' }
]

const bracketLabels = EP_BRACKETS.map((start, i) => {
  const next = EP_BRACKETS[i + 1]
  if (next === undefined) return `${start}+`
  return next - 1 > start ? `${start}-${next - 1}` : `${start}`
})

const rows = computed(() => [...EP_PAY_SYMBOLS].reverse().map((sym: EpPaySymbol) => ({
  sym,
  name: EP_SYMBOLS[sym].name,
  pays: PAYTABLE[sym].map(p => p * props.bet)
})))

const art = (id: Parameters<typeof epArtDataUrl>[0]) => epArtDataUrl(id, 128)
const awards = FS_AWARD.map((spins, i) => ({ scatters: FS_TRIGGER + i, spins }))
const pct = (v: number) => `${(v * 100).toFixed(1)}%`
</script>

<template>
  <UModal
    v-model:open="open"
    title="Paytable & rules"
    description="How Ember Portals pays"
    :ui="{ overlay: 'bg-default/80 backdrop-blur-sm', content: 'ep-modal max-w-2xl', header: 'hidden', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <div class="ep-pt" :style="fontVars">
        <div class="ep-pt__head">
          <img :src="art('logo')" alt="" class="ep-pt__logo">
          <div class="min-w-0">
            <p class="ep-pt__h">
              Ember Portals
            </p>
            <p class="ep-pt__title">
              The portal keeper's notes
            </p>
          </div>
          <UButton color="neutral" variant="ghost" icon="i-lucide-x" aria-label="Close paytable" class="ml-auto" @click="open = false" />
        </div>

        <UTabs v-model="tab" :items="tabs" color="primary" :ui="{ list: 'mx-4 mt-4', content: 'ep-pt__scroll' }" class="min-h-0 gap-0">
          <template #content="{ item }">
            <section v-if="item.value === 'pays'" class="space-y-4">
              <p class="ep-pt__lead">
                {{ EP_MIN_CLUSTER }} or more matching symbols joined up, down, left or right form a cluster. Bigger clusters pay more.
                Amounts are for your bet of <strong>{{ formatNumber(bet) }}</strong>.
              </p>

              <div class="ep-pt__cards">
                <div v-for="r in rows" :key="r.sym" class="ep-pt__card">
                  <img :src="art(r.sym)" :alt="r.name" class="ep-pt__art">
                  <div class="min-w-0 flex-1">
                    <p class="ep-pt__name">
                      {{ r.name }}
                    </p>
                    <dl class="ep-pt__pays">
                      <div v-for="(amount, i) in r.pays" :key="i">
                        <dt>{{ bracketLabels[i] }}</dt>
                        <dd :class="{ 'is-top': i === r.pays.length - 1 }">
                          {{ formatNumber(amount) }}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>

              <div class="ep-pt__specials">
                <div class="ep-pt__special">
                  <img :src="art('wild')" :alt="EP_SYMBOLS.wild.name" class="size-14 shrink-0">
                  <p><strong>{{ EP_SYMBOLS.wild.name }}</strong> is wild and joins any cluster it touches. It never lands on its own: winning clusters open it.</p>
                </div>
                <div class="ep-pt__special">
                  <img :src="art('scatter')" alt="" class="size-14 shrink-0">
                  <p><strong>{{ EP_SYMBOLS.scatter.name }}</strong> is the scatter: {{ FS_TRIGGER }} or more anywhere once the tumbles stop start the free spins.</p>
                </div>
              </div>
            </section>

            <section v-else-if="item.value === 'features'" class="space-y-4">
              <div class="ep-pt__step">
                <img :src="art('wild')" alt="" class="size-16 shrink-0">
                <div>
                  <p class="ep-pt__name">
                    Tumbles and portals
                  </p>
                  <ul class="ep-pt__list">
                    <li>Winning symbols burn away, symbols above fall down and new ones drop in until no cluster is left.</li>
                    <li>A winning cluster without a Portal opens one (<strong>×1</strong>) on one of its cells.</li>
                    <li>A Portal in a win multiplies it, grows by <strong>+1</strong> and jumps to a cell of that win.</li>
                    <li>Portals in the same win <strong>merge</strong>: their multipliers add up, plus 1. A Portal tops out at ×{{ formatNumber(EP_WILD_MAX_MULT, false) }}.</li>
                    <li>Portals hold their cell while symbols fall past them. In the base game they close when the tumbles stop.</li>
                  </ul>
                </div>
              </div>

              <div class="ep-pt__step">
                <img :src="art('scatter')" alt="" class="size-16 shrink-0">
                <div>
                  <p class="ep-pt__name">
                    Free spins
                  </p>
                  <p>
                    About 1 in {{ EP_STATS.freeSpinsOdds }} spins. Portals <strong>stay open for the whole feature</strong> and keep growing.
                    {{ FS_TRIGGER }}+ scatters during the feature add {{ FS_RETRIGGER_SPINS }} spins, up to {{ FS_MAX_SPINS }} in total.
                  </p>
                  <ul class="ep-pt__awards">
                    <li v-for="a in awards" :key="a.scatters">
                      <strong>{{ a.scatters }}{{ a.scatters === FS_TRIGGER + FS_AWARD.length - 1 ? '+' : '' }}</strong> scatters · {{ a.spins }} spins
                    </li>
                  </ul>
                </div>
              </div>

              <div class="ep-pt__step">
                <UIcon name="i-lucide-flame" class="size-8 shrink-0 text-primary" />
                <div>
                  <p class="ep-pt__name">
                    Extra chance
                  </p>
                  <p>
                    Turn it on to bet {{ EP_ANTE_COST }}× ({{ formatNumber(bet * EP_ANTE_COST) }} a spin). Scatters land more often: free spins about 1 in {{ EP_STATS.anteFreeSpinsOdds }} spins. RTP {{ pct(EP_STATS.anteRtp) }}.
                  </p>
                </div>
              </div>

              <div class="ep-pt__step">
                <UIcon name="i-lucide-shopping-cart" class="size-8 shrink-0 text-primary" />
                <div>
                  <p class="ep-pt__name">
                    Buy free spins
                  </p>
                  <p>
                    {{ EP_BUY_COST }}× bet ({{ formatNumber(bet * EP_BUY_COST) }}) for at least {{ FS_AWARD[0] }} free spins. RTP {{ pct(EP_STATS.buyRtp) }}.
                  </p>
                </div>
              </div>
            </section>

            <section v-else class="space-y-4">
              <dl class="ep-pt__facts">
                <div><dt>Grid</dt><dd>{{ EP_COLS }} × {{ EP_ROWS }}</dd></div>
                <div><dt>Wins</dt><dd>Clusters of {{ EP_MIN_CLUSTER }}+</dd></div>
                <div><dt>RTP</dt><dd>{{ pct(EP_STATS.rtp) }}</dd></div>
                <div><dt>Volatility</dt><dd>High · {{ EP_STATS.volatility }} / 5</dd></div>
                <div><dt>Max win</dt><dd>{{ formatNumber(EP_MAX_WIN_MULT, false) }}× bet</dd></div>
                <div><dt>Any win</dt><dd>{{ pct(EP_STATS.hitRate) }} of spins</dd></div>
              </dl>
              <div>
                <p class="ep-pt__h">
                  Where the RTP comes from
                </p>
                <dl class="ep-pt__facts">
                  <div><dt>Base game</dt><dd>{{ pct(EP_STATS.baseRtp) }}</dd></div>
                  <div><dt>Free spins</dt><dd>{{ pct(EP_STATS.freeSpinsRtp) }}</dd></div>
                  <div><dt>Buy</dt><dd>{{ pct(EP_STATS.buyRtp) }}</dd></div>
                </dl>
              </div>
              <ul class="ep-pt__list">
                <li>A round pays at most {{ formatNumber(EP_MAX_WIN_MULT, false) }}× bet; free spins stop once that is reached.</li>
                <li>RTP is measured over {{ EP_STATS.rounds }} simulated spins of the real game code.</li>
                <li>Every outcome is drawn on the server before the symbols drop. Turbo and skipping never change a result.</li>
                <li>Space spins. Press it again to skip ahead.</li>
              </ul>
            </section>
          </template>
        </UTabs>
      </div>
    </template>
  </UModal>
</template>

<style>
/* Teleported content: keep every selector scoped to this page. */
.ep-modal {
  background: var(--ui-bg);
  color: var(--ui-text);
  border: 1px solid var(--ui-border-accented);
  border-radius: 22px;
}
.ep-pt { display: flex; flex-direction: column; max-height: min(85dvh, 820px); font-family: var(--ep-ui, system-ui, sans-serif); }
.ep-pt__head { display: flex; align-items: center; gap: 12px; padding: 18px 22px 16px; border-bottom: 1px solid var(--ui-border); }
.ep-pt__logo { width: 64px; height: auto; flex-shrink: 0; }
.ep-pt__title { font-family: var(--ep-display, Georgia, serif); font-size: 22px; font-weight: 700; line-height: 1.15; color: var(--ui-text-highlighted); }
.ep-pt__h { margin-bottom: 4px; font-size: 10px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ui-text-muted); }
.ep-pt__scroll { overflow-y: auto; min-height: 0; padding: 18px 22px 22px; font-size: 14px; line-height: 1.6; scrollbar-width: thin; }
.ep-pt__lead { color: var(--ui-text-muted); }
.ep-pt__scroll strong { color: var(--ui-text-highlighted); font-weight: 600; }
.ep-pt__cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ep-pt__card { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 14px; background: var(--ui-bg-elevated); border: 1px solid var(--ui-border); }
.ep-pt__art { width: 64px; height: 64px; flex-shrink: 0; }
.ep-pt__name { font-weight: 600; color: var(--ui-text-highlighted); margin-bottom: 4px; }
.ep-pt__pays { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px 10px; font-size: 12px; font-variant-numeric: tabular-nums; }
.ep-pt__pays > div { display: flex; justify-content: space-between; gap: 4px; }
.ep-pt__pays dt { color: var(--ui-text-muted); }
.ep-pt__pays dd { color: var(--ui-text-highlighted); font-weight: 600; }
.ep-pt__pays dd.is-top { color: var(--ui-primary); }
.ep-pt__specials { display: grid; gap: 10px; }
.ep-pt__special, .ep-pt__step { display: flex; align-items: center; gap: 14px; padding: 14px; border-radius: 14px; background: var(--ui-bg-muted); border: 1px solid var(--ui-border); color: var(--ui-text-muted); }
.ep-pt__step { align-items: flex-start; }
.ep-pt__list { display: grid; gap: 6px; padding-left: 18px; list-style: disc; color: var(--ui-text-muted); }
.ep-pt__awards { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 10px; font-size: 13px; color: var(--ui-text); }
.ep-pt__facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.ep-pt__facts > div { padding: 12px; border-radius: 12px; background: var(--ui-bg-muted); border: 1px solid var(--ui-border); }
.ep-pt__facts dt { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ui-text-muted); }
.ep-pt__facts dd { font-size: 16px; font-weight: 600; color: var(--ui-text-highlighted); }
@media (max-width: 560px) {
  .ep-pt__head { padding: 14px 16px; }
  .ep-pt__logo { width: 48px; }
  .ep-pt__scroll { padding: 14px 16px; }
  .ep-pt__cards { grid-template-columns: 1fr; }
  .ep-pt__facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ep-pt__step { gap: 10px; padding: 12px; }
  .ep-pt__step > img { width: 44px; height: 44px; }
}
</style>
