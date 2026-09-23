<script setup lang="ts">
import { pirateAbility } from '#shared/utils/gamelogic/pirates'

// Hand-drawn round medallions for the six right-click abilities. Pure inline
// SVG; motion is CSS and stops under prefers-reduced-motion.

const props = withDefaults(defineProps<{
  id: string
  framed?: boolean
  animated?: boolean
  /** Greys the medallion out (ability cooling down or not owned). */
  dimmed?: boolean
}>(), { framed: true, animated: true, dimmed: false })

const uid = useId()
const accent = computed(() => pirateAbilityHex(props.id))
const name = computed(() => pirateAbility(props.id).name)
const gid = (key: string) => `ab-${uid}-${key}`
const SHELLS = [{ x: 20, y: 14 }, { x: 34, y: 8 }, { x: 44, y: 18 }]
</script>

<template>
  <svg viewBox="0 0 64 64" class="pr-art" :class="{ 'is-animated': animated && !dimmed, 'is-dimmed': dimmed }" role="img" :aria-label="name">
    <defs>
      <radialGradient :id="gid('bg')" cx="50%" cy="38%" r="70%">
        <stop offset="0%" :stop-color="accent" stop-opacity="0.42" />
        <stop offset="60%" stop-color="#0b1c29" />
        <stop offset="100%" stop-color="#050d14" />
      </radialGradient>
      <linearGradient :id="gid('brass')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffe29a" />
        <stop offset="45%" stop-color="#c9973c" />
        <stop offset="100%" stop-color="#6b4a1c" />
      </linearGradient>
      <linearGradient :id="gid('wood')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c98a4b" />
        <stop offset="100%" stop-color="#6b3f1c" />
      </linearGradient>
      <radialGradient :id="gid('fire')" cx="50%" cy="55%" r="60%">
        <stop offset="0%" stop-color="#fffbe0" />
        <stop offset="40%" stop-color="#fbbf24" />
        <stop offset="100%" stop-color="#dc2626" stop-opacity="0" />
      </radialGradient>
      <linearGradient :id="gid('water')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#bfeaff" />
        <stop offset="50%" stop-color="#3b9be0" />
        <stop offset="100%" stop-color="#0b3a66" />
      </linearGradient>
      <clipPath :id="gid('clip')">
        <circle cx="32" cy="32" r="25" />
      </clipPath>
    </defs>

    <g v-if="framed">
      <circle cx="32" cy="32" r="30" :fill="`url(#${gid('brass')})`" />
      <circle cx="32" cy="32" r="26.5" :fill="`url(#${gid('bg')})`" stroke="#2a1a08" stroke-width="1.5" />
      <g fill="#2a1a08" opacity="0.55">
        <circle cx="32" cy="4" r="1.2" /><circle cx="60" cy="32" r="1.2" /><circle cx="32" cy="60" r="1.2" /><circle cx="4" cy="32" r="1.2" />
      </g>
    </g>

    <g :clip-path="framed ? `url(#${gid('clip')})` : undefined">
      <!-- Powder Keg: a keg bursting open -->
      <g v-if="id === 'bomb'">
        <circle class="a-burst" cx="32" cy="32" r="16" :fill="`url(#${gid('fire')})`" />
        <g stroke="#2a160a" stroke-width="1.5" stroke-linejoin="round">
          <path d="M22 26 C22 23 42 23 42 26 V42 C42 46 22 46 22 42 Z" :fill="`url(#${gid('wood')})`" />
          <path d="M22 30 C27 32 37 32 42 30 M22 38 C27 40 37 40 42 38" stroke="#3a3a3a" stroke-width="2" fill="none" />
        </g>
        <path d="M32 24 C33 18 38 17 40 13" stroke="#e7d7a7" stroke-width="1.6" fill="none" />
        <path class="a-flicker" d="M40 8 L41 11.5 L44.5 10.5 L42 13 L45 15 L41 14.5 L40 18 L39 14.5 L35 15 L38 13 L35.5 10.5 L39 11.5 Z" fill="#fde68a" />
      </g>

      <!-- Hunter's Chain: warheads orbiting a target -->
      <g v-else-if="id === 'seekers'">
        <circle cx="32" cy="32" r="5" fill="none" :stroke="accent" stroke-width="1.5" />
        <path d="M32 24 v4 M32 36 v4 M24 32 h4 M36 32 h4" :stroke="accent" stroke-width="1.5" />
        <g class="a-orbit">
          <g v-for="i in 4" :key="i" :transform="`rotate(${i * 90} 32 32)`">
            <path d="M32 10 l3 5 v6 h-6 v-6 Z" fill="#fecdd3" :stroke="accent" stroke-width="1.2" stroke-linejoin="round" />
            <circle cx="32" cy="23" r="1.8" :fill="accent" />
          </g>
        </g>
      </g>

      <!-- Ghostly Consort: an escort ship fading in -->
      <g v-else-if="id === 'consort'" class="a-bob">
        <path d="M31 14 V42" stroke="#bae6fd" stroke-width="2" />
        <path d="M32 16 C42 19 44 29 42 38 H32 Z" fill="#e0f2fe" opacity="0.6" stroke="#7dd3fc" stroke-width="1.2" />
        <path d="M30 19 C24 22 22 30 23 38 H30 Z" fill="#e0f2fe" opacity="0.45" stroke="#7dd3fc" stroke-width="1.2" />
        <path d="M15 41 H49 L44 49 H20 Z" fill="#38bdf8" opacity="0.65" stroke="#e0f2fe" stroke-width="1.3" stroke-linejoin="round" />
        <path class="a-glint" d="M10 52 C18 48 24 55 32 51 C40 47 46 55 54 50" :stroke="accent" stroke-width="1.8" fill="none" />
      </g>

      <!-- Kraken's Maw: a spinning whirlpool -->
      <g v-else-if="id === 'maelstrom'">
        <g class="a-spin" fill="none" stroke-linecap="round">
          <path d="M32 32 m-22 0 a22 22 0 0 1 22 -22" :stroke="accent" stroke-width="3" opacity="0.5" />
          <path d="M32 32 m18 0 a18 18 0 0 1 -18 18" :stroke="accent" stroke-width="3" opacity="0.6" />
          <path d="M32 32 m0 -14 a14 14 0 0 1 14 14" stroke="#a5f3fc" stroke-width="2.6" opacity="0.75" />
          <path d="M32 32 m0 10 a10 10 0 0 1 -10 -10" stroke="#a5f3fc" stroke-width="2.4" opacity="0.85" />
          <path d="M32 32 m6 0 a6 6 0 0 1 -6 6" stroke="#ecfeff" stroke-width="2" />
        </g>
        <circle cx="32" cy="32" r="3.2" fill="#042f2e" stroke="#ecfeff" stroke-width="1" />
      </g>

      <!-- Hellfire Barrage: shells falling through a burning sky -->
      <g v-else-if="id === 'firestorm'">
        <circle class="a-burst" cx="32" cy="44" r="14" :fill="`url(#${gid('fire')})`" />
        <g class="a-fall">
          <g v-for="(s, i) in SHELLS" :key="i">
            <path :d="`M${s.x - 6} ${s.y - 10} L${s.x} ${s.y}`" stroke="#fb923c" stroke-width="3" stroke-linecap="round" opacity="0.7" />
            <circle :cx="s.x" :cy="s.y" r="3.6" fill="#1f1308" stroke="#fde68a" stroke-width="1.2" />
          </g>
        </g>
        <path d="M14 50 C20 46 22 52 28 48 C32 45 36 52 42 47 C46 44 50 49 52 48" stroke="#7c2d12" stroke-width="2" fill="none" />
      </g>

      <!-- Rogue Wave: a towering curling wave -->
      <g v-else-if="id === 'tidal'">
        <g class="a-surge">
          <path d="M6 50 C10 34 20 20 34 18 C46 16 54 24 52 32 C50 38 42 38 40 33 C38 28 44 26 46 29 C44 24 36 24 34 30 C31 38 40 46 58 46 V58 H6 Z" :fill="`url(#${gid('water')})`" stroke="#e0f2fe" stroke-width="1.4" stroke-linejoin="round" />
          <path d="M14 42 C18 32 26 26 34 25" stroke="#e0f2fe" stroke-width="1.6" fill="none" opacity="0.8" />
          <g fill="#fff">
            <circle cx="46" cy="22" r="1.5" /><circle cx="51" cy="26" r="1.1" /><circle cx="42" cy="18" r="1" />
          </g>
        </g>
      </g>
    </g>

    <circle v-if="framed" class="a-glow" cx="32" cy="32" r="26.5" fill="none" :stroke="accent" stroke-width="1.4" />
  </svg>
</template>

<style scoped>
.pr-art { display: block; overflow: visible; transition: filter 0.2s, opacity 0.2s; }
.is-dimmed { filter: grayscale(0.85) brightness(0.6); }

.is-animated .a-burst { animation: pr-burst 1.6s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
.is-animated .a-flicker { animation: pr-flicker 0.3s steps(2) infinite; transform-origin: 40px 13px; }
.is-animated .a-orbit { animation: pr-spin 6s linear infinite; transform-origin: 32px 32px; }
.is-animated .a-bob { animation: pr-bob 2.6s ease-in-out infinite; }
.is-animated .a-glint { animation: pr-drift 3s ease-in-out infinite; }
.is-animated .a-spin { animation: pr-spin 3.2s linear infinite; transform-origin: 32px 32px; }
.is-animated .a-fall { animation: pr-fall 1.4s ease-in infinite; }
.is-animated .a-surge { animation: pr-surge 2.4s ease-in-out infinite; transform-origin: 32px 58px; }
.is-animated .a-glow { animation: pr-glow 2.4s ease-in-out infinite; }

@keyframes pr-burst { 0%, 100% { transform: scale(0.85); opacity: 0.7; } 50% { transform: scale(1.12); opacity: 1; } }
@keyframes pr-flicker { 0% { transform: scale(1); } 100% { transform: scale(1.2) rotate(10deg); } }
@keyframes pr-spin { to { transform: rotate(360deg); } }
@keyframes pr-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2.5px); } }
@keyframes pr-drift { 0%, 100% { transform: translateX(-2px); } 50% { transform: translateX(2px); } }
@keyframes pr-fall { 0% { transform: translate(-3px, -6px); opacity: 0; } 25% { opacity: 1; } 100% { transform: translate(3px, 6px); opacity: 0.9; } }
@keyframes pr-surge { 0%, 100% { transform: scale(1) translateX(0); } 50% { transform: scale(1.04, 1.08) translateX(2px); } }
@keyframes pr-glow { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.9; } }

@media (prefers-reduced-motion: reduce) {
  .pr-art * { animation: none !important; }
}
</style>
