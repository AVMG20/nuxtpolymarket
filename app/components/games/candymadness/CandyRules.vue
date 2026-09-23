<script setup lang="ts">
// Rules and paytable for Candy Madness. Every figure comes from the live game
// constants, so this panel can't drift from the maths.
import {
  CM_BONUS_HUNT_COST,
  CM_BUY_FREESPINS_COST,
  CM_COLS,
  CM_FREE_SPINS,
  CM_MAX_WIN_MULT,
  CM_MIN_CLUSTER,
  CM_MULT_CAP,
  CM_MULT_START,
  CM_ROWS,
  CM_SCATTER_TRIGGER
} from '#shared/utils/gamelogic/candymadness'
import { CANDY_INFO, candyDataUrl } from '~/utils/slots/candymadness-art'
import {
  CANDY_BONUS_ODDS,
  CANDY_HUNT_BONUS_ODDS,
  CANDY_PAY_SIZES,
  candyPaytable,
  formatPayMult
} from '~/utils/slots/candymadness-ui'

const open = defineModel<boolean>('open', { default: false })
defineProps<{ bet: number }>()

const rows = candyPaytable()
const tab = ref<'rules' | 'pays'>('rules')

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="cmr">
      <div
        v-if="open"
        class="cmr"
        @click.self="open = false"
      >
        <div
          class="cmr__panel"
          role="dialog"
          aria-label="Candy Madness rules"
        >
          <header class="cmr__head">
            <div class="cmr__tabs">
              <button
                :class="{ on: tab === 'rules' }"
                @click="tab = 'rules'"
              >
                How to play
              </button>
              <button
                :class="{ on: tab === 'pays' }"
                @click="tab = 'pays'"
              >
                Paytable
              </button>
            </div>
            <button
              class="cmr__close"
              aria-label="Close"
              @click="open = false"
            >
              <UIcon name="i-lucide-x" />
            </button>
          </header>

          <div
            v-if="tab === 'rules'"
            class="cmr__body"
          >
            <section class="cmr__step">
              <span class="cmr__num">1</span>
              <div>
                <h3>Match clusters</h3>
                <p>
                  The board is {{ CM_COLS }}×{{ CM_ROWS }}. Connect <b>{{ CM_MIN_CLUSTER }} or more</b> of the same candy
                  side by side (not diagonally) to win. Bigger clusters pay more.
                </p>
              </div>
            </section>
            <section class="cmr__step">
              <span class="cmr__num">2</span>
              <div>
                <h3>Tumbles</h3>
                <p>
                  Winning candies pop, everything above falls down and new candies drop in. This repeats until
                  nothing new matches, so one spin can win several times.
                </p>
              </div>
            </section>
            <section class="cmr__step">
              <span class="cmr__num">3</span>
              <div>
                <h3>Multiplier spots</h3>
                <p>
                  Each square where a candy pops lights up as a <b>×{{ CM_MULT_START }}</b> spot. Every later pop on the
                  same square doubles it, up to <b>×{{ formatNumber(CM_MULT_CAP, false) }}</b>. When the tumbles stop,
                  all spots are <b>added together</b> and your spin's total win is multiplied by that sum.
                </p>
              </div>
            </section>
            <section class="cmr__step cmr__step--bonus">
              <img
                :src="candyDataUrl('scatter', 96)"
                alt=""
                class="cmr__lolly"
              >
              <div>
                <h3>Free spins</h3>
                <p>
                  Land <b>{{ CM_SCATTER_TRIGGER }} or more lollipops</b> anywhere for <b>{{ CM_FREE_SPINS }} free spins</b>
                  (about 1 in {{ formatNumber(CANDY_BONUS_ODDS, false) }} spins). During free spins the multiplier spots
                  <b>stay on the board</b> and keep growing, so late spins can pay far more than early ones.
                </p>
              </div>
            </section>

            <div class="cmr__grid">
              <div class="cmr__card">
                <h4>Buy Free Spins</h4>
                <p>Costs <b>{{ CM_BUY_FREESPINS_COST }}× bet</b>. Skips the base game and starts {{ CM_FREE_SPINS }} free spins.</p>
                <span class="cmr__price">{{ formatNumber(bet * CM_BUY_FREESPINS_COST) }}</span>
              </div>
              <div class="cmr__card">
                <h4>Bonus Hunter</h4>
                <p>
                  Each spin costs <b>{{ CM_BONUS_HUNT_COST }}× bet</b> and always drops at least one lollipop. Free spins
                  land about 1 in {{ formatNumber(CANDY_HUNT_BONUS_ODDS, false) }} spins.
                </p>
                <span class="cmr__price">{{ formatNumber(bet * CM_BONUS_HUNT_COST) }} / spin</span>
              </div>
            </div>

            <ul class="cmr__facts">
              <li><span>Return to player</span><b>98%</b></li>
              <li><span>Max win</span><b>{{ formatNumber(CM_MAX_WIN_MULT, false) }}× bet</b></li>
              <li><span>Controls</span><b>Space spins</b></li>
            </ul>
          </div>

          <div
            v-else
            class="cmr__body"
          >
            <p class="cmr__note">
              Wins per cluster, in × your bet, before multiplier spots. The multiplier sum is where the real money is.
            </p>
            <div class="cmr__table-wrap">
              <table class="cmr__table">
                <thead>
                  <tr>
                    <th />
                    <th
                      v-for="n in CANDY_PAY_SIZES"
                      :key="n"
                    >
                      {{ n }}{{ n === CANDY_PAY_SIZES[CANDY_PAY_SIZES.length - 1] ? '+' : '' }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in rows"
                    :key="row.sym"
                  >
                    <th>
                      <img
                        :src="candyDataUrl(row.sym, 96)"
                        :alt="CANDY_INFO[row.sym].name"
                        :title="CANDY_INFO[row.sym].name"
                      >
                    </th>
                    <td
                      v-for="(p, i) in row.pays"
                      :key="i"
                      :class="{ top: i === row.pays.length - 1 }"
                    >
                      {{ formatPayMult(p) }}×
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="cmr__note">
              At your current bet of {{ formatNumber(bet) }}, a 15+ cluster of hearts pays
              {{ formatNumber(bet * (rows[0]?.pays[CANDY_PAY_SIZES.length - 1] ?? 0)) }} before multipliers.
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cmr {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(20, 2, 30, 0.72);
  backdrop-filter: blur(4px);
}

.cmr__panel {
  width: min(620px, 100%);
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  border-radius: 26px;
  color: #fbeaff;
  background: linear-gradient(180deg, #4a1466 0%, #2b0a3d 100%);
  border: 3px solid #ff8ccb;
  box-shadow: 0 0 0 5px #5a1650, 0 0 0 8px #ffd35a, 0 30px 80px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  font-family: 'Fredoka', system-ui, sans-serif;
}

.cmr__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 10px 18px;
  background: linear-gradient(180deg, rgba(255, 140, 203, 0.18), transparent);
}

.cmr__tabs {
  display: flex;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.3);
}

.cmr__tabs button {
  padding: 7px 16px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 14px;
  color: #e7c4f5;
  cursor: pointer;
}

.cmr__tabs button.on {
  color: #4a0b3d;
  background: linear-gradient(180deg, #ffe38a, #ffb52e);
  box-shadow: 0 2px 0 #b26a00;
}

.cmr__close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
  cursor: pointer;
}

.cmr__close:hover { background: rgba(255, 255, 255, 0.2); }

.cmr__body {
  overflow-y: auto;
  padding: 6px 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cmr__step {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.cmr__step h3 {
  font-family: 'Lilita One', system-ui, sans-serif;
  font-size: 19px;
  letter-spacing: 0.02em;
  color: #ffd35a;
}

.cmr__step p {
  font-size: 14.5px;
  line-height: 1.5;
  color: #efd6fa;
}

.cmr__step b { color: #fff; }

.cmr__num {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin-top: 2px;
  border-radius: 50%;
  font-family: 'Lilita One', system-ui, sans-serif;
  color: #4a0b3d;
  background: radial-gradient(circle at 35% 30%, #fff 0%, #ff9fd3 40%, #e0338a 100%);
  box-shadow: 0 2px 0 #7d1350;
}

.cmr__step--bonus {
  padding: 12px;
  border-radius: 16px;
  background: linear-gradient(90deg, rgba(255, 111, 209, 0.18), rgba(255, 211, 90, 0.12));
  border: 1px solid rgba(255, 211, 90, 0.35);
}

.cmr__lolly {
  width: 48px;
  height: 48px;
  flex: none;
}

.cmr__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 520px) {
  .cmr__grid { grid-template-columns: 1fr; }
}

.cmr__card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.cmr__card h4 {
  font-weight: 700;
  color: #fff;
}

.cmr__card p {
  font-size: 13px;
  line-height: 1.45;
  color: #dcc0ea;
}

.cmr__price {
  align-self: flex-start;
  margin-top: auto;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 700;
  color: #ffe38a;
  background: rgba(255, 211, 90, 0.12);
}

.cmr__facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.cmr__facts li {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  text-align: center;
}

.cmr__facts span {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #c9a6db;
}

.cmr__facts b { font-size: 15px; color: #fff; }

.cmr__note {
  font-size: 13px;
  line-height: 1.45;
  color: #d9bde8;
}

.cmr__table-wrap {
  overflow-x: auto;
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.25);
}

.cmr__table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.cmr__table thead th {
  padding: 8px 6px;
  font-size: 12px;
  font-weight: 700;
  color: #ffd35a;
  text-align: right;
  white-space: nowrap;
}

.cmr__table tbody th {
  padding: 4px 8px;
}

.cmr__table tbody th img {
  width: 40px;
  height: 40px;
  display: block;
}

.cmr__table tbody tr:nth-child(odd) { background: rgba(255, 255, 255, 0.04); }

.cmr__table td {
  padding: 4px 8px;
  text-align: right;
  font-size: 13px;
  color: #e7cdf3;
  white-space: nowrap;
}

.cmr__table td.top {
  font-weight: 700;
  color: #fff;
}

.cmr-enter-active, .cmr-leave-active { transition: opacity 0.2s; }
.cmr-enter-active .cmr__panel { transition: transform 0.3s cubic-bezier(0.3, 1.5, 0.5, 1); }
.cmr-enter-from, .cmr-leave-to { opacity: 0; }
.cmr-enter-from .cmr__panel { transform: scale(0.9) translateY(10px); }
</style>
