<script setup lang="ts">
import { pirateCannonTier } from '#shared/utils/gamelogic/pirates'

// A classic side-view naval cannon for the Armory, hand-drawn in inline SVG
// in the same style as UpgradeArt and AbilityArt: bold outlines, gradients,
// no glow. Each tier gets its own metal, length and trim so the progression
// reads at a glance; the tier colour only shows up as muted bands and trim.

const props = defineProps<{ tierId: string }>()

interface CannonSpec {
  /** Barrel length forward of the trunnion, in viewBox units. */
  length: number
  /** Half thickness at the breech and at the muzzle. */
  breech: number
  muzzle: number
  /** Metal gradient, top to bottom. */
  metal: [string, string, string]
  /** Reinforce rings, as offsets from the trunnion. */
  bands: number[]
  /** How strongly the tier colour tints the bands (0..1). */
  tint: number
  wood: [string, string]
  swivel?: boolean
  rivets?: boolean
  ornate?: boolean
  /** Barrel elevation in degrees. */
  elevation: number
}

const SPECS: Record<string, CannonSpec> = {
  swivel: { length: 30, breech: 5, muzzle: 3.6, metal: ['#9a9da3', '#555a61', '#24272c'], bands: [-16, 12], tint: 0.3, wood: ['#b07a45', '#5e3a1a'], swivel: true, elevation: -14 },
  carronade: { length: 28, breech: 8, muzzle: 6, metal: ['#e6bd74', '#a8752d', '#4a3010'], bands: [-18, 10], tint: 0.35, wood: ['#b07a45', '#5e3a1a'], elevation: -8 },
  culverin: { length: 48, breech: 6, muzzle: 4, metal: ['#a4aab0', '#5b6168', '#23272c'], bands: [-20, 2, 28], tint: 0.3, wood: ['#b07a45', '#5e3a1a'], elevation: -9 },
  longgun: { length: 50, breech: 6.4, muzzle: 4.2, metal: ['#c3cfdb', '#70808f', '#2a3440'], bands: [-20, 4, 30], tint: 0.4, wood: ['#a9733f', '#553417'], elevation: -9 },
  basilisk: { length: 46, breech: 8, muzzle: 5.4, metal: ['#a19ab5', '#5a5370', '#2a2637'], bands: [-24, -10, 6, 20, 32], tint: 0.45, wood: ['#9a6a3a', '#4c2e14'], elevation: -8 },
  mythril: { length: 48, breech: 6.8, muzzle: 4.6, metal: ['#e4f5ec', '#95c7b4', '#3d6f60'], bands: [-20, 6, 30], tint: 0.4, wood: ['#a9733f', '#553417'], elevation: -9 },
  adamantite: { length: 46, breech: 8.2, muzzle: 5.6, metal: ['#9a7cc4', '#533a7a', '#211436'], bands: [-24, -6, 14, 30], tint: 0.5, wood: ['#8b5e34', '#3f2410'], rivets: true, elevation: -8 },
  leviathan: { length: 44, breech: 8, muzzle: 5.6, metal: ['#c9928a', '#7a4438', '#31160f'], bands: [-22, 0, 20], tint: 0.5, wood: ['#8b5e34', '#3f2410'], ornate: true, elevation: -10 }
}

const uid = useId()
const gid = (key: string) => `cn-${uid}-${key}`
const tier = computed(() => pirateCannonTier(props.tierId))
const spec = computed(() => SPECS[tier.value.id] ?? SPECS.culverin!)

function mixHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const channel = (shift: number) => Math.round(((pa >> shift) & 255) + (((pb >> shift) & 255) - ((pa >> shift) & 255)) * t)
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`
}

const accent = computed(() => pirateHex(tier.value.shotColor))
/** Band colour: the tier colour sunk into the metal, never bright. */
const bandColor = computed(() => mixHex(spec.value.metal[1], accent.value, spec.value.tint))
const bandEdge = computed(() => mixHex(bandColor.value, '#000000', 0.45))
const gold = '#e9bd4f'

/** Barrel half thickness at an offset from the trunnion. */
function thickness(x: number) {
  const s = spec.value
  const t = (x + 30) / (s.length + 30)
  return s.breech + (s.muzzle - s.breech) * Math.max(0, Math.min(1, t))
}

const barrelPath = computed(() => {
  const s = spec.value
  const L = s.length
  const tb = s.breech
  const tm = s.muzzle
  // Breech is rounded; the body tapers to just short of the muzzle swell.
  return `M-30,${-tb} L${L - 7},${-tm} L${L - 7},${tm} L-30,${tb} A${tb},${tb} 0 0 1 -30,${-tb} Z`
})

const bands = computed(() => spec.value.bands.map(x => ({ x, h: thickness(x) + 1.2 })))
</script>

<template>
  <svg viewBox="0 0 120 72" class="pr-art" role="img" :aria-label="tier.name">
    <defs>
      <linearGradient :id="gid('metal')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="spec.metal[0]" />
        <stop offset="45%" :stop-color="spec.metal[1]" />
        <stop offset="100%" :stop-color="spec.metal[2]" />
      </linearGradient>
      <linearGradient :id="gid('band')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="mixHex(bandColor, '#ffffff', 0.25)" />
        <stop offset="50%" :stop-color="bandColor" />
        <stop offset="100%" :stop-color="bandEdge" />
      </linearGradient>
      <linearGradient :id="gid('wood')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="spec.wood[0]" />
        <stop offset="100%" :stop-color="spec.wood[1]" />
      </linearGradient>
      <linearGradient :id="gid('wheel')" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" :stop-color="mixHex(spec.wood[0], '#ffffff', 0.15)" />
        <stop offset="100%" :stop-color="spec.wood[1]" />
      </linearGradient>
      <linearGradient :id="gid('gold')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fbe7a1" />
        <stop offset="50%" :stop-color="gold" />
        <stop offset="100%" stop-color="#8a5a12" />
      </linearGradient>
    </defs>

    <!-- Deck shadow -->
    <ellipse cx="58" cy="64" rx="44" ry="4" fill="#000" opacity="0.35" />

    <!-- Swivel gun: an iron post and yoke bolted to the rail, with a tiller at the breech -->
    <g v-if="spec.swivel" stroke="#15110d" stroke-width="1.8" stroke-linejoin="round">
      <rect x="46" y="58" width="26" height="5" rx="1.5" :fill="`url(#${gid('wood')})`" />
      <path d="M57 58 V42 H63 V58 Z" fill="#4a4f56" />
      <path d="M52 36 C52 30 68 30 68 36 V44 H64 V38 H56 V44 H52 Z" fill="#5b6067" />
      <g :transform="`translate(60 36) rotate(${spec.elevation})`">
        <path d="M-32 0 L-46 11" stroke="#3b2a1a" stroke-width="3" stroke-linecap="round" />
        <path :d="barrelPath" :fill="`url(#${gid('metal')})`" />
        <rect v-for="band in bands" :key="band.x" :x="band.x - 1.6" :y="-band.h" width="3.2" :height="band.h * 2" rx="0.8" :fill="`url(#${gid('band')})`" />
        <rect :x="spec.length - 8" :y="-spec.muzzle - 1.6" width="9" :height="spec.muzzle * 2 + 3.2" rx="2" :fill="`url(#${gid('metal')})`" />
        <ellipse :cx="spec.length + 1" cy="0" rx="1.4" :ry="spec.muzzle * 0.55" fill="#0b0a09" stroke="none" />
        <circle cx="-34" cy="0" r="2.8" :fill="spec.metal[1]" />
        <ellipse cx="-20" :cy="-spec.breech + 1" rx="1.2" ry="0.7" fill="#0b0a09" stroke="none" />
        <path :d="`M-26 ${-spec.breech + 1.6} L${spec.length - 10} ${-spec.muzzle + 1.4}`" stroke="#fff" stroke-opacity="0.35" stroke-width="1.2" stroke-linecap="round" />
        <circle cx="0" cy="0" r="3" :fill="spec.metal[2]" />
      </g>
      <circle cx="60" cy="42" r="1.4" fill="#9aa0a6" stroke="none" />
    </g>

    <!-- Truck carriage guns -->
    <g v-else transform="translate(-4 0)" stroke="#15110d" stroke-width="1.8" stroke-linejoin="round">
      <!-- Far wheels -->
      <circle cx="36" cy="52" r="8" :fill="spec.wood[1]" />
      <circle cx="74" cy="51" r="9" :fill="spec.wood[1]" />
      <!-- Bed and far cheek -->
      <rect x="24" y="50" width="62" height="7" rx="1.5" :fill="`url(#${gid('wood')})`" />
      <path d="M31 50 L33 41 L42 41 L44 35 L76 35 L81 44 L84 50 Z" :fill="spec.wood[1]" />
      <!-- Quoin wedge under the breech -->
      <path d="M31 41 L43 41 L43 36 Z" :fill="mixHex(spec.wood[0], '#ffffff', 0.2)" />
      <!-- Barrel -->
      <g :transform="`translate(56 36) rotate(${spec.elevation})`">
        <path :d="barrelPath" :fill="`url(#${gid('metal')})`" />
        <!-- Reinforce rings -->
        <rect v-for="band in bands" :key="band.x" :x="band.x - 1.8" :y="-band.h" width="3.6" :height="band.h * 2" rx="0.9" :fill="`url(#${gid('band')})`" />
        <g v-if="spec.rivets" fill="#d8c8f0" stroke="none">
          <template v-for="band in bands" :key="`r${band.x}`">
            <circle :cx="band.x" :cy="-band.h + 1.6" r="0.75" />
            <circle :cx="band.x" :cy="band.h - 1.6" r="0.75" />
          </template>
        </g>
        <!-- Gold filigree along the chase -->
        <g v-if="spec.ornate" fill="none" :stroke="gold" stroke-width="1.1" stroke-linecap="round">
          <path :d="`M4 -3 c3 -3 6 3 9 0 s6 -3 9 0 s6 3 9 0 s6 -3 8 0`" />
          <path :d="`M4 3 c3 3 6 -3 9 0 s6 3 9 0 s6 -3 9 0 s6 3 8 0`" />
          <path d="M-26 -5 q4 -3 6 0 M-26 5 q4 3 6 0" />
        </g>
        <!-- Muzzle: a plain swell, or the Leviathan's serpent head -->
        <g v-if="spec.ornate">
          <!-- Serpent head: crested skull, open jaw with the bore as its throat -->
          <path :d="`M${spec.length - 8},${-spec.muzzle - 1.5} C${spec.length - 2},${-spec.muzzle - 9} ${spec.length + 6},${-spec.muzzle - 9} ${spec.length + 10},${-spec.muzzle - 3} L${spec.length + 16},-1.5 L${spec.length + 8},1.5 L${spec.length - 8},${spec.muzzle + 1.5} Z`" :fill="`url(#${gid('gold')})`" />
          <path :d="`M${spec.length - 2},${spec.muzzle} L${spec.length + 4},${spec.muzzle + 1} L${spec.length + 13},${spec.muzzle + 5} L${spec.length + 3},${spec.muzzle + 4} Z`" :fill="`url(#${gid('gold')})`" />
          <path :d="`M${spec.length + 2},-0.5 L${spec.length + 10},0 L${spec.length + 6},${spec.muzzle + 2.5} L${spec.length + 1},${spec.muzzle + 0.5} Z`" fill="#1a0b08" stroke="none" />
          <path :d="`M${spec.length + 8},0 l-0.8 2.4 M${spec.length + 4},${spec.muzzle + 2} l0.8 -2.2`" stroke="#fff5d6" stroke-width="1" stroke-linecap="round" />
          <path :d="`M${spec.length - 4},${-spec.muzzle - 5} l-1 -6 l4 4 M${spec.length + 2},${-spec.muzzle - 7.5} l0 -5 l3 4`" :fill="`url(#${gid('gold')})`" stroke-linejoin="round" />
          <circle :cx="spec.length + 3" :cy="-spec.muzzle - 2.5" r="1.7" :fill="accent" stroke="#2a1608" stroke-width="0.8" />
          <circle :cx="spec.length + 3.5" :cy="-spec.muzzle - 2.5" r="0.6" fill="#1a0b08" stroke="none" />
        </g>
        <g v-else>
          <rect :x="spec.length - 9" :y="-spec.muzzle - 1.8" width="10" :height="spec.muzzle * 2 + 3.6" rx="2.2" :fill="`url(#${gid('metal')})`" />
          <ellipse :cx="spec.length + 1" cy="0" rx="1.6" :ry="spec.muzzle * 0.6" fill="#0b0a09" stroke="none" />
        </g>
        <!-- Cascabel knob and neck -->
        <rect x="-38" y="-2" width="6" height="4" rx="1" :fill="spec.metal[1]" />
        <circle cx="-39" cy="0" r="3.2" :fill="`url(#${gid('metal')})`" />
        <!-- Touch-hole -->
        <ellipse cx="-22" :cy="-spec.breech + 1" rx="1.3" ry="0.8" fill="#0b0a09" stroke="none" />
        <!-- Highlight along the top of the tube -->
        <path :d="`M-27 ${-spec.breech + 1.8} L${spec.length - 12} ${-spec.muzzle + 1.5}`" stroke="#fff" stroke-opacity="0.32" stroke-width="1.4" stroke-linecap="round" />
      </g>
      <!-- Near cheek, stepped down toward the breech, over the barrel's lower half -->
      <path d="M28 50 L30 40 L40 40 L42 33 L74 33 L79 42 L82 50 Z" :fill="`url(#${gid('wood')})`" />
      <path d="M31 47 H79 M42 38 H72" :stroke="spec.wood[1]" stroke-width="1" stroke-linecap="round" />
      <!-- Trunnion cap -->
      <circle cx="56" cy="36" r="3.6" :fill="`url(#${gid('band')})`" />
      <circle cx="56" cy="36" r="1.2" fill="#15110d" stroke="none" />
      <!-- Near wheels -->
      <circle cx="33" cy="54" r="8.5" :fill="`url(#${gid('wheel')})`" />
      <circle cx="33" cy="54" r="2.2" :fill="spec.metal[2]" />
      <circle cx="71" cy="53" r="9.5" :fill="`url(#${gid('wheel')})`" />
      <circle cx="71" cy="53" r="2.4" :fill="spec.metal[2]" />
      <path d="M33 45.5 V62.5 M24.5 54 H41.5 M71 43.5 V62.5 M61.5 53 H80.5" :stroke="spec.wood[1]" stroke-width="1" />
      <!-- Iron tyre highlight -->
      <path d="M27 48.5 A8.5 8.5 0 0 1 39 48.5 M64.5 47 A9.5 9.5 0 0 1 77.5 47" stroke="#fff" stroke-opacity="0.22" stroke-width="1.2" fill="none" />
      <!-- Cannonball waiting by the wheel -->
      <circle cx="16" cy="59" r="4" fill="#2b2a2a" />
      <circle cx="14.6" cy="57.6" r="1.2" fill="#fff" fill-opacity="0.3" stroke="none" />
    </g>
  </svg>
</template>

<style scoped>
.pr-art { display: block; overflow: visible; }
</style>
