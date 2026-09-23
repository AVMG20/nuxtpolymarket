<script setup lang="ts">
import { piratePowerUp, type PiratePowerUpId } from '#shared/utils/gamelogic/pirates'

// Hand-drawn badge art for each salvage upgrade, framed in its rarity colour.
// Pure inline SVG; motion is CSS and stops under prefers-reduced-motion.

const props = withDefaults(defineProps<{
  id: PiratePowerUpId
  /** Draw the rarity badge frame behind the illustration. */
  framed?: boolean
  animated?: boolean
}>(), { framed: true, animated: true })

const uid = useId()
const rarityColor = computed(() => piratePowerUpHex(props.id))
const name = computed(() => piratePowerUp(props.id).name)
const gid = (key: string) => `pu-${uid}-${key}`
</script>

<template>
  <svg viewBox="0 0 64 64" class="pr-art" :class="{ 'is-animated': animated }" role="img" :aria-label="name">
    <defs>
      <radialGradient :id="gid('bg')" cx="50%" cy="40%" r="70%">
        <stop offset="0%" :stop-color="rarityColor" stop-opacity="0.38" />
        <stop offset="55%" stop-color="#0b1c29" />
        <stop offset="100%" stop-color="#050d14" />
      </radialGradient>
      <linearGradient :id="gid('rim')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fff" stop-opacity="0.9" />
        <stop offset="35%" :stop-color="rarityColor" />
        <stop offset="100%" :stop-color="rarityColor" stop-opacity="0.55" />
      </linearGradient>
      <linearGradient :id="gid('wood')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c98a4b" />
        <stop offset="100%" stop-color="#7a4a22" />
      </linearGradient>
      <linearGradient :id="gid('iron')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#9aa6b2" />
        <stop offset="100%" stop-color="#3a444f" />
      </linearGradient>
      <radialGradient :id="gid('glass')" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#e0f7ff" stop-opacity="0.9" />
        <stop offset="50%" stop-color="#4fb6e8" stop-opacity="0.55" />
        <stop offset="100%" stop-color="#123a5c" stop-opacity="0.9" />
      </radialGradient>
      <radialGradient :id="gid('fire')" cx="50%" cy="60%" r="60%">
        <stop offset="0%" stop-color="#fff7c2" />
        <stop offset="45%" stop-color="#fbbf24" />
        <stop offset="100%" stop-color="#ea580c" stop-opacity="0" />
      </radialGradient>
    </defs>

    <g v-if="framed">
      <path d="M32 2 L58 12 V34 C58 48 46 58 32 62 C18 58 6 48 6 34 V12 Z" :fill="`url(#${gid('bg')})`" :stroke="`url(#${gid('rim')})`" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M32 6 L54 14.5 V34 C54 45.5 44 54 32 57.8 C20 54 10 45.5 10 34 V14.5 Z" fill="none" :stroke="rarityColor" stroke-opacity="0.35" stroke-width="1" />
      <circle class="a-halo" cx="32" cy="32" r="18" :fill="rarityColor" opacity="0.12" />
    </g>

    <!-- Oak Planking: three nailed planks with a repair plus -->
    <g v-if="id === 'oak-planking'" stroke="#2a160a" stroke-width="1.6" stroke-linejoin="round">
      <rect x="14" y="17" width="34" height="8" rx="2" :fill="`url(#${gid('wood')})`" transform="rotate(-6 31 21)" />
      <rect x="14" y="27" width="36" height="8" rx="2" :fill="`url(#${gid('wood')})`" />
      <rect x="13" y="37" width="34" height="8" rx="2" :fill="`url(#${gid('wood')})`" transform="rotate(5 30 41)" />
      <g fill="#d9d2c4" stroke="none">
        <circle cx="18" cy="21" r="1.3" /><circle cx="44" cy="19" r="1.3" />
        <circle cx="18" cy="31" r="1.3" /><circle cx="46" cy="31" r="1.3" />
        <circle cx="17" cy="40" r="1.3" /><circle cx="43" cy="43" r="1.3" />
      </g>
      <path d="M22 22 q6 -2 12 0 M24 31 q8 1.5 16 0 M21 41 q7 1.5 14 1" stroke="#5a3417" stroke-width="0.9" fill="none" />
      <g class="a-pulse" transform-origin="46 44">
        <circle cx="46" cy="44" r="7.5" fill="#15803d" stroke="#052e16" />
        <path d="M46 40 v8 M42 44 h8" stroke="#dcfce7" stroke-width="2.4" stroke-linecap="round" />
      </g>
      <path class="a-shine" d="M14 17 l6 0 l-10 28 l-6 0 Z" fill="#fff" opacity="0.25" stroke="none" />
    </g>

    <!-- Quick Hands: a cannon with a spinning reload arrow -->
    <g v-else-if="id === 'quick-hands'">
      <g class="a-spin-slow" transform-origin="32 30">
        <path d="M32 14 A16 16 0 1 1 17.5 23" fill="none" :stroke="rarityColor" stroke-width="3" stroke-linecap="round" />
        <path d="M13 19 L19 25 L21.5 17.5 Z" :fill="rarityColor" />
      </g>
      <g stroke="#111" stroke-width="1.5" stroke-linejoin="round">
        <path d="M16 36 L42 28 L45 36 L19 44 Z" :fill="`url(#${gid('iron')})`" />
        <rect x="41" y="27" width="6" height="11" rx="2" transform="rotate(-17 44 32)" fill="#4b5563" />
        <circle cx="22" cy="46" r="6" :fill="`url(#${gid('wood')})`" />
        <circle cx="22" cy="46" r="1.8" fill="#2a160a" />
      </g>
      <circle class="a-flash" cx="49" cy="30" r="4" :fill="`url(#${gid('fire')})`" />
    </g>

    <!-- Following Wind: a billowing sail with drifting wind lines -->
    <g v-else-if="id === 'following-wind'">
      <path d="M26 12 V52" stroke="#6b4423" stroke-width="3" stroke-linecap="round" />
      <path class="a-billow" transform-origin="26 32" d="M27 15 C44 18 47 30 44 46 C38 44 32 44 27 46 Z" fill="#f3ead2" stroke="#8a7a58" stroke-width="1.5" stroke-linejoin="round" />
      <path d="M29 22 C36 24 39 30 38 38" stroke="#c9b98f" stroke-width="1.2" fill="none" />
      <g class="a-wind" :stroke="rarityColor" stroke-width="2.2" stroke-linecap="round" fill="none">
        <path d="M6 22 H18 q4 0 4 -3" />
        <path d="M4 32 H20" />
        <path d="M7 42 H17 q4 0 4 3" />
      </g>
    </g>

    <!-- Crow's Nest: lookout basket on a mast with a glinting spyglass -->
    <g v-else-if="id === 'crows-nest'">
      <path d="M24 10 V56" stroke="#6b4423" stroke-width="3.2" stroke-linecap="round" />
      <path d="M15 24 H33 L31 32 H17 Z" :fill="`url(#${gid('wood')})`" stroke="#2a160a" stroke-width="1.5" stroke-linejoin="round" />
      <path d="M17 27 H31" stroke="#5a3417" stroke-width="1" />
      <path d="M22 12 l10 3 l-10 3 Z" fill="#ef4444" stroke="#450a0a" stroke-width="0.8" />
      <g transform="rotate(-18 40 38)">
        <rect x="30" y="34" width="22" height="7" rx="2" fill="#b8892f" stroke="#3b2608" stroke-width="1.3" />
        <rect x="30" y="34" width="6" height="7" rx="1.5" fill="#8a6420" />
        <rect x="46" y="33" width="7" height="9" rx="2" fill="#d4a84a" stroke="#3b2608" stroke-width="1.3" />
      </g>
      <g class="a-sparkle" transform-origin="54 31">
        <path d="M54 25 L55.4 29.6 L60 31 L55.4 32.4 L54 37 L52.6 32.4 L48 31 L52.6 29.6 Z" fill="#fff" />
      </g>
      <path d="M8 48 C18 44 30 52 40 48 C48 45 54 49 58 47" :stroke="rarityColor" stroke-opacity="0.6" stroke-width="1.6" fill="none" />
    </g>

    <!-- Tide Ward: a shield carrying a breaking wave -->
    <g v-else-if="id === 'tide-ward'">
      <g class="a-pulse" transform-origin="32 33">
        <path d="M32 13 L47 19 V32 C47 42 40 48 32 51 C24 48 17 42 17 32 V19 Z" fill="#0e4a63" :stroke="rarityColor" stroke-width="2.4" stroke-linejoin="round" />
        <path d="M20 38 C24 32 28 30 32 33 C34 27 40 26 44 30 C40 30 38 33 40 37 C44 40 45 44 43 46 C36 50 26 50 21 44 Z" fill="#5ee6d8" stroke="#07343f" stroke-width="1.2" />
        <path d="M23 42 C28 44 34 44 40 42" stroke="#e0fbff" stroke-width="1.4" fill="none" />
      </g>
      <circle class="a-ring" cx="32" cy="33" r="21" fill="none" :stroke="rarityColor" stroke-width="1.5" />
    </g>

    <!-- Blast Powder: a powder keg with a sparking fuse -->
    <g v-else-if="id === 'blast-powder'">
      <g stroke="#2a160a" stroke-width="1.6" stroke-linejoin="round">
        <path d="M18 24 C18 20 46 20 46 24 V46 C46 51 18 51 18 46 Z" :fill="`url(#${gid('wood')})`" />
        <path d="M18 29 C24 31 40 31 46 29 M18 41 C24 43 40 43 46 41" stroke="#3a3a3a" stroke-width="2.4" fill="none" />
        <ellipse cx="32" cy="23" rx="14" ry="3.5" fill="#a86b35" />
      </g>
      <text x="32" y="38.5" text-anchor="middle" font-size="8" font-weight="900" fill="#2a160a" font-family="Georgia, serif">XXX</text>
      <path d="M32 21 C34 14 40 14 42 10" stroke="#e7d7a7" stroke-width="1.8" fill="none" stroke-linecap="round" />
      <g class="a-flicker" transform-origin="42 10">
        <circle cx="42" cy="10" r="5" :fill="`url(#${gid('fire')})`" />
        <path d="M42 4 L43 8.5 L47.5 7 L44 10.5 L48 13 L43 12 L42 16 L41 12 L36.5 13 L40 10.5 L37 7 L41 8.5 Z" fill="#fde68a" />
      </g>
    </g>

    <!-- Stormglass: a glass orb holding a lightning storm -->
    <g v-else-if="id === 'stormglass'">
      <path d="M22 50 H42 L39 44 H25 Z" fill="#b8892f" stroke="#3b2608" stroke-width="1.4" stroke-linejoin="round" />
      <circle cx="32" cy="29" r="15" :fill="`url(#${gid('glass')})`" stroke="#cfe9ff" stroke-width="1.6" />
      <path class="a-bolt" d="M34 17 L26 30 H32 L28 41 L38 26 H32 Z" fill="#fef9c3" :stroke="rarityColor" stroke-width="1.2" stroke-linejoin="round" />
      <ellipse cx="27" cy="22" rx="4" ry="2.4" fill="#fff" opacity="0.55" transform="rotate(-30 27 22)" />
      <g class="a-arcs" :stroke="rarityColor" stroke-width="1.6" fill="none" stroke-linecap="round">
        <path d="M12 20 l4 3 l-3 2 l5 3" />
        <path d="M52 22 l-4 3 l3 2 l-5 3" />
      </g>
    </g>

    <!-- Ghost Crew: a spectral sloop bobbing on ethereal water -->
    <g v-else-if="id === 'ghost-crew'">
      <g class="a-bob">
        <path d="M31 12 V40" stroke="#c4b5fd" stroke-width="2" opacity="0.85" />
        <path d="M32 14 C42 17 44 27 42 36 H32 Z" fill="#ede9fe" opacity="0.55" stroke="#c4b5fd" stroke-width="1.2" />
        <path d="M30 17 C23 20 21 28 22 36 H30 Z" fill="#ede9fe" opacity="0.4" stroke="#c4b5fd" stroke-width="1.2" />
        <path d="M14 40 H50 L45 48 H20 Z" fill="#a78bfa" opacity="0.7" stroke="#ede9fe" stroke-width="1.4" stroke-linejoin="round" />
        <circle cx="26" cy="44" r="1.4" fill="#fff" /><circle cx="32" cy="44" r="1.4" fill="#fff" /><circle cx="38" cy="44" r="1.4" fill="#fff" />
      </g>
      <path class="a-drift" d="M8 53 C16 49 22 56 30 52 C38 48 44 56 56 51" :stroke="rarityColor" stroke-width="1.8" fill="none" opacity="0.8" />
    </g>

    <!-- Titan Shot: an enormous cannonball with an expanding shockwave -->
    <g v-else-if="id === 'titan-shot'">
      <circle class="a-shock" cx="32" cy="32" r="12" fill="none" :stroke="rarityColor" stroke-width="2.5" />
      <circle class="a-shock a-shock-2" cx="32" cy="32" r="12" fill="none" :stroke="rarityColor" stroke-width="2" />
      <circle cx="32" cy="32" r="14" fill="#1f2937" stroke="#000" stroke-width="1.6" />
      <circle cx="32" cy="32" r="14" :fill="rarityColor" opacity="0.18" />
      <ellipse cx="27" cy="26" rx="5" ry="3" fill="#fff" opacity="0.35" transform="rotate(-30 27 26)" />
      <path d="M26 36 l4 -3 l3 4 l4 -5" stroke="#fde68a" stroke-width="1.3" fill="none" opacity="0.9" />
    </g>

    <!-- Kraken's Heart: a beating heart wrapped in a tentacle -->
    <g v-else-if="id === 'krakens-heart'">
      <g class="a-beat" transform-origin="32 34">
        <path d="M32 50 C18 40 13 32 15 24 C17 17 26 15 32 22 C38 15 47 17 49 24 C51 32 46 40 32 50 Z" fill="#dc2626" stroke="#450a0a" stroke-width="1.8" stroke-linejoin="round" />
        <path d="M22 24 C24 21 27 21 29 23" stroke="#fecaca" stroke-width="1.6" fill="none" stroke-linecap="round" />
      </g>
      <path d="M10 44 C18 50 26 30 34 36 C40 40 38 48 46 46 C52 44 52 36 48 34" fill="none" stroke="#7c3aed" stroke-width="4.5" stroke-linecap="round" />
      <path d="M10 44 C18 50 26 30 34 36 C40 40 38 48 46 46 C52 44 52 36 48 34" fill="none" stroke="#c4b5fd" stroke-width="1" stroke-dasharray="0.1 4" stroke-linecap="round" />
      <circle class="a-halo" cx="32" cy="34" r="20" fill="none" :stroke="rarityColor" stroke-width="1.2" />
    </g>
  </svg>
</template>

<style scoped>
.pr-art { display: block; overflow: visible; }
.pr-art * { transform-box: fill-box; }

.is-animated .a-halo { animation: pr-halo 2.4s ease-in-out infinite; transform-origin: center; }
.is-animated .a-pulse { animation: pr-pulse 2s ease-in-out infinite; transform-box: view-box; }
.is-animated .a-shine { animation: pr-shine 3.2s ease-in-out infinite; }
.is-animated .a-spin-slow { animation: pr-spin 2.4s linear infinite; transform-box: view-box; }
.is-animated .a-flash { animation: pr-flash 2.4s ease-out infinite; transform-origin: center; }
.is-animated .a-billow { animation: pr-billow 2.2s ease-in-out infinite; transform-box: view-box; }
.is-animated .a-wind { animation: pr-wind 1.6s linear infinite; }
.is-animated .a-sparkle { animation: pr-sparkle 2.6s ease-in-out infinite; transform-box: view-box; }
.is-animated .a-ring { animation: pr-ring 2.2s ease-out infinite; transform-origin: center; }
.is-animated .a-flicker { animation: pr-flicker 0.35s steps(2) infinite; transform-box: view-box; }
.is-animated .a-bolt { animation: pr-bolt 1.8s steps(1) infinite; }
.is-animated .a-arcs { animation: pr-bolt 1.8s steps(1) infinite 0.25s; }
.is-animated .a-bob { animation: pr-bob 2.6s ease-in-out infinite; }
.is-animated .a-drift { animation: pr-drift 3s ease-in-out infinite; }
.is-animated .a-shock { animation: pr-shock 1.8s ease-out infinite; transform-origin: center; }
.is-animated .a-shock-2 { animation-delay: 0.9s; }
.is-animated .a-beat { animation: pr-beat 1.1s ease-in-out infinite; transform-box: view-box; }

@keyframes pr-halo { 0%, 100% { opacity: 0.08; transform: scale(0.92); } 50% { opacity: 0.22; transform: scale(1.06); } }
@keyframes pr-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }
@keyframes pr-shine { 0%, 60% { transform: translateX(0); opacity: 0; } 70% { opacity: 0.3; } 100% { transform: translateX(46px); opacity: 0; } }
@keyframes pr-spin { to { transform: rotate(360deg); } }
@keyframes pr-flash { 0%, 70% { opacity: 0; transform: scale(0.4); } 76% { opacity: 1; transform: scale(1.4); } 100% { opacity: 0; transform: scale(1.8); } }
@keyframes pr-billow { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(1.1); } }
@keyframes pr-wind { 0% { transform: translateX(-6px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(8px); opacity: 0; } }
@keyframes pr-sparkle { 0%, 55%, 100% { transform: scale(0); opacity: 0; } 70% { transform: scale(1); opacity: 1; } 85% { transform: scale(0.4) rotate(45deg); opacity: 0.6; } }
@keyframes pr-ring { 0% { transform: scale(0.8); opacity: 0.8; } 100% { transform: scale(1.25); opacity: 0; } }
@keyframes pr-flicker { 0% { transform: scale(1) rotate(0deg); } 100% { transform: scale(1.18) rotate(12deg); } }
@keyframes pr-bolt { 0%, 40%, 52%, 100% { opacity: 1; } 44%, 48%, 80% { opacity: 0.2; } }
@keyframes pr-bob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-2.5px) rotate(2deg); } }
@keyframes pr-drift { 0%, 100% { transform: translateX(-2px); } 50% { transform: translateX(2px); } }
@keyframes pr-shock { 0% { transform: scale(1); opacity: 0.9; } 100% { transform: scale(2.1); opacity: 0; } }
@keyframes pr-beat { 0%, 30%, 60%, 100% { transform: scale(1); } 15% { transform: scale(1.12); } 45% { transform: scale(1.07); } }

@media (prefers-reduced-motion: reduce) {
  .pr-art * { animation: none !important; }
}
</style>
