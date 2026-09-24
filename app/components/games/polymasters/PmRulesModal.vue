<script setup lang="ts">
import { PM_MAX_WIN as MAX_WIN, PM_SAFE_LANDING_COST as SAFE_LANDING_COST, PM_TARGET_RTP as TARGET_RTP } from '#shared/utils/gamelogic/polymasters'
import { sfx } from '~/utils/polymasters/audio'

defineProps<{ icons: Record<string, string> }>()

const { state, money } = usePolyMastersGame()
const SPEEDS = PM_SPEEDS

function close() {
  sfx.click()
  state.showRules = false
}
</script>

<template>
  <div class="backdrop" @click.self="close">
    <div class="modal panel">
      <div class="head">
        <h2 class="display gold-text">How to play</h2>
        <button class="close round-btn" aria-label="Close" @click="close">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
        </button>
      </div>
      <div class="facts">
        <div><span class="label">RTP</span><b class="display">~{{ (TARGET_RTP * 100).toFixed(2) }}%</b></div>
        <div><span class="label">Max win</span><b class="display">x{{ MAX_WIN.toLocaleString() }}</b></div>
        <div><span class="label">Hit rate</span><b class="display">1 in 2.5</b></div>
        <div><span class="label">Bets</span><b class="display">{{ money(PM_MIN_BET) }} – {{ money(PM_MAX_BET) }}</b></div>
      </div>

      <section>
        <p>
          Set your bet and press <b>PLAY</b>. The plane takes off from the aircraft carrier and flies a random route over the
          ocean. Your <b>Counter Balance</b> starts equal to your bet and changes with everything the plane flies through.
        </p>
        <p>
          The round ends when the plane comes down. <b>Land on the island</b> and the Counter Balance is paid to your balance.
          <b>Splash into the sea</b> and the round is lost.
        </p>
      </section>

      <h3 class="display">Multipliers</h3>
      <div class="grid">
        <div v-for="v in [1, 2, 5, 10]" :key="'a' + v" class="sym"><img :src="icons['add' + v]" alt=""><span>Adds {{ v }}× bet</span></div>
        <div v-for="v in [2, 3, 4, 5]" :key="'m' + v" class="sym"><img :src="icons['mul' + v]" alt=""><span>Counter × {{ v }}</span></div>
      </div>
      <p class="note">Every collected multiplier lifts the plane higher, and the higher it flies at the end, the better its chance to reach the island.</p>

      <h3 class="display">Rockets</h3>
      <div class="rocket-row">
        <img :src="icons.rocket" alt="" class="rocket">
        <p>
          A rocket <b>divides the Counter Balance by 2</b> and knocks the plane down. Every hit costs altitude, and multipliers win
          it back. A hit while the plane is already <b>skimming the waves</b> sends it into the sea. A warning sign shows where a
          rocket is coming from.
        </p>
      </div>

      <h3 class="display">Boosters</h3>
      <div class="grid boosters">
        <div class="sym"><img :src="icons.nitro" alt=""><span><b>Nitro</b> — the plane speeds up and rockets bounce off its shield.</span></div>
        <div class="sym"><img :src="icons.laser" alt=""><span><b>Laser Gun</b> — shoots down every rocket in the plane's path for a stretch.</span></div>
        <div class="sym"><img :src="icons.magnet" alt=""><span><b>Magnet</b> — pulls in multipliers, keeps rockets away and pulls the plane toward the island.</span></div>
        <div class="sym"><img :src="icons.buoy" alt=""><span><b>Life Buoy</b> — bounces the plane back out of the water once, whether it was shot down or came up short.</span></div>
      </div>

      <h3 class="display">Safe Landing</h3>
      <p>
        Activate <b>Safe Landing</b> to buy a guaranteed touchdown: every round costs <b>{{ SAFE_LANDING_COST }}× your bet</b>, the plane
        never goes into the sea (it skims off the water when shot down low) and always lands on the island, paying its
        Counter Balance. The route is richer in multipliers; RTP is the same
        {{ (TARGET_RTP * 100).toFixed(2) }}%.
      </p>

      <h3 class="display">Speed</h3>
      <p>
        Four speeds: <span v-for="(s, i) in SPEEDS" :key="s.id">{{ s.label }}<template v-if="i < SPEEDS.length - 1">, </template></span>.
        You can switch any time, even mid-flight. Speed only changes how fast the round plays out: the result is decided at take-off
        and RTP is identical at every speed.
      </p>

      <h3 class="display">Other</h3>
      <ul>
        <li>The maximum win is x{{ MAX_WIN }} of the bet; the round ends immediately when the counter reaches it.</li>
        <li>Every round is decided and paid out by the server when the plane takes off; the flight only replays that result.</li>
        <li>Keyboard: <kbd>Space</kbd> to play.</li>
        <li>Bets and wins are paid in coins from your balance.</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: rgba(2, 10, 24, 0.65);
  backdrop-filter: blur(4px);
  animation: fade 0.2s;
}
.modal {
  position: relative;
  width: min(760px, calc(100cqw - 24px));
  max-height: calc(100cqh - 40px);
  overflow: auto;
  border-radius: 22px;
  padding: 26px 30px 30px;
  animation: pop 0.3s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.head {
  position: sticky;
  top: -26px;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: -26px -30px 14px;
  padding: 22px 30px 12px;
  background: linear-gradient(180deg, rgba(16, 44, 84, 0.98) 70%, rgba(16, 44, 84, 0));
  border-radius: 22px 22px 0 0;
}
.close {
  position: relative;
  z-index: 1;
  flex: none;
}
.close svg {
  width: 18px;
}
h2 {
  margin: 0;
  font-size: 40px;
  font-weight: 400;
}
h3 {
  margin: 22px 0 8px;
  font-weight: 400;
  font-size: 22px;
  color: var(--gold-2);
}
p,
li {
  line-height: 1.55;
  color: rgba(230, 242, 255, 0.9);
}
.facts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.facts > div {
  background: rgba(0, 0, 0, 0.25);
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.facts b {
  font-weight: 400;
  font-size: 20px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.grid.boosters {
  grid-template-columns: repeat(2, 1fr);
}
.sym {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.22);
  border-radius: 12px;
  padding: 8px;
  font-weight: 700;
  font-size: 14px;
}
.sym img {
  width: 52px;
  height: 52px;
  flex: none;
}
.note {
  font-size: 14px;
  opacity: 0.75;
}
.rocket-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.rocket {
  width: 110px;
}
kbd {
  padding: 1px 6px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.15);
  font-family: inherit;
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
@keyframes pop {
  from {
    transform: scale(0.9);
    opacity: 0;
  }
}
@container pm (max-width: 720px) {
  .facts,
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .grid.boosters {
    grid-template-columns: 1fr;
  }
  .modal {
    padding: 20px 16px;
  }
  .head {
    top: -20px;
    margin: -20px -16px 14px;
    padding: 18px 16px 10px;
  }
}
</style>
