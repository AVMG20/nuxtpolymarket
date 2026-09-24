<script setup lang="ts">
import { sfx } from '~/utils/polymasters/audio'

defineProps<{ fullscreen: boolean, fullscreenSupported: boolean }>()
const emit = defineEmits<{ 'toggle-fullscreen': [] }>()

const { state, money, setSfx, setMusic } = usePolyMastersGame()

function toggleFullscreen() {
  sfx.click()
  emit('toggle-fullscreen')
}

function chipClass(m: number) {
  if (m <= 0) return 'lost'
  if (m >= 50) return 'epic'
  if (m >= 10) return 'big'
  if (m >= 2) return 'good'
  return 'small'
}
</script>

<template>
  <header class="top">
    <div class="logo">
      <svg class="logo-plane" viewBox="0 0 64 40" aria-hidden="true">
        <path d="M6 22 L40 18 L52 12 L56 18 L46 24 L8 27 Z" fill="#e53935" stroke="#6a0a10" stroke-width="1.5" />
        <rect x="22" y="8" width="5" height="26" rx="2" fill="#fff6e8" stroke="#6a0a10" stroke-width="1.2" />
        <rect x="4" y="12" width="8" height="10" rx="2" fill="#e53935" stroke="#6a0a10" stroke-width="1.2" />
        <ellipse cx="58" cy="20" rx="2" ry="12" fill="rgba(255,255,255,.7)" />
      </svg>
      <div class="logo-text">
        <span class="display gold-text">POLY</span>
        <span class="two display">MASTERS</span>
      </div>
    </div>

    <div class="right">
      <div class="history" aria-label="Last results">
        <TransitionGroup name="chip">
          <span v-for="h in state.history.slice(0, 10)" :key="h.id" class="chip" :class="chipClass(h.mult)" :title="h.win > 0 ? `Won ${money(h.win)}` : 'Splashed into the sea'">
            <svg v-if="h.mult <= 0" class="splash" viewBox="0 0 24 24" aria-label="Splash">
              <path d="M12 3c3 4.2 5 7.2 5 9.6A5 5 0 0 1 7 12.6C7 10.2 9 7.2 12 3z" fill="currentColor" />
              <path d="M3 20c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
            <template v-else>x{{ h.mult >= 100 ? h.mult.toFixed(0) : h.mult.toFixed(2) }}</template>
          </span>
        </TransitionGroup>
      </div>
      <div class="buttons">
        <button class="round-btn" :class="{ off: !state.sfx }" title="Sound effects" aria-label="Sound effects" @click="setSfx(!state.sfx)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
            <path v-if="state.sfx" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
            <path v-else d="M17 9l5 6M22 9l-5 6" />
          </svg>
        </button>
        <button class="round-btn" :class="{ off: !state.music }" title="Music" aria-label="Music" @click="setMusic(!state.music)">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 17.5a2.5 2.5 0 1 1-2.5-2.5c.5 0 1 .1 1.5.4V5l11-2v12.5a2.5 2.5 0 1 1-2.5-2.5c.5 0 1 .1 1.5.4V7.2L9 8.8z" />
            <path v-if="!state.music" d="M3 3l18 18" stroke="#ff6b6b" stroke-width="2.5" />
          </svg>
        </button>
        <button class="round-btn" title="Rules" aria-label="Rules" @click="(state.showRules = true), sfx.click()">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5.5" r="2.2" /><rect x="10" y="9.5" width="4" height="11" rx="1.6" /></svg>
        </button>
        <button v-if="fullscreenSupported" class="round-btn" :title="fullscreen ? 'Exit fullscreen' : 'Fullscreen'" :aria-label="fullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="toggleFullscreen">
          <svg v-if="fullscreen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: max(12px, env(safe-area-inset-top)) 16px 0;
  pointer-events: none;
}
.top > * {
  pointer-events: auto;
}
.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}
.logo-plane {
  width: 58px;
  filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.4));
  animation: bob 3s ease-in-out infinite;
}
.logo-text {
  display: flex;
  align-items: baseline;
  line-height: 1;
}
.logo-text .display {
  font-size: 34px;
}
.two {
  background: linear-gradient(180deg, #ff8a78, #e0242c 55%, #8a0e14);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 3px 0 #fff) drop-shadow(0 5px 8px rgba(0, 0, 0, 0.4));
}
@keyframes bob {
  50% {
    transform: translateY(-4px) rotate(-3deg);
  }
}
.right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}
.buttons {
  display: flex;
  gap: 8px;
  order: -1;
}
.round-btn.off {
  filter: grayscale(0.8) brightness(0.8);
}
.history {
  /* chips that do not fit wrap onto a hidden second row, so a chip is never cut in half */
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  height: 28px;
  max-width: min(60cqw, 640px);
  overflow: hidden;
}
.chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 28px;
  min-width: 64px;
  padding: 0 10px;
  font-family: var(--display);
  font-size: 14px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  border-radius: 999px;
  background: rgba(6, 22, 48, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15);
}
.chip.small {
  color: #bfe3ff;
}
.chip.good {
  color: var(--green);
}
.chip.big {
  color: var(--gold-2);
  border-color: rgba(255, 213, 74, 0.5);
}
.chip.epic {
  color: #fff;
  background: linear-gradient(180deg, #c77dff, #6a1fb0);
  border-color: #e7c6ff;
}
.chip.lost {
  color: #7fd0ff;
  opacity: 0.85;
}
.splash {
  width: 16px;
  height: 16px;
}
.chip-enter-active {
  transition: all 0.35s cubic-bezier(0.2, 1.6, 0.4, 1);
}
.chip-enter-from {
  opacity: 0;
  transform: scale(0.3);
}
.chip-move {
  transition: transform 0.3s;
}
@container pm (max-width: 720px) {
  .logo-text .display {
    font-size: 24px;
  }
  .logo-plane {
    width: 40px;
  }
  .history {
    max-width: 52cqw;
  }
  .chip:nth-child(n + 5) {
    display: none;
  }
  .buttons .round-btn {
    width: 34px;
    height: 34px;
  }
  .buttons {
    gap: 6px;
  }
}
@container pm (max-width: 400px) {
  .logo-text .display {
    font-size: 20px;
  }
  .logo-plane {
    display: none;
  }
}
</style>
