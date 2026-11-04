<script setup lang="ts">
import type { RiftbornClassId } from '#shared/utils/gamelogic/riftborn'

/**
 * Hand-built SVG hero busts, one per class. Key light from the top left,
 * rim light in the class colour from behind on the right. Locked classes
 * render as a dark silhouette with a faint rim.
 */
defineProps<{
  classId: RiftbornClassId
  color: string
  locked?: boolean
}>()

const uid = useId()
const id = (name: string) => `rb-${uid}-${name}`
const url = (name: string) => `url(#${id(name)})`

/* SMIL orbits can't be paused from CSS, so they only run without reduced motion */
const motion = ref(false)
onMounted(() => {
  motion.value = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
})

const motes = [
  { x: 24, y: 196, d: 0, s: 1.8 },
  { x: 48, y: 204, d: 1.4, s: 1.3 },
  { x: 166, y: 200, d: 0.7, s: 1.7 },
  { x: 180, y: 190, d: 2.1, s: 1.2 },
  { x: 36, y: 180, d: 2.8, s: 1.2 },
  { x: 142, y: 206, d: 3.3, s: 1.5 },
  { x: 100, y: 204, d: 1.9, s: 1.1 },
  { x: 76, y: 200, d: 3.9, s: 1.4 }
]

/* Knight pauldrons: the lit one on the left, its shadowed mirror on the right */
const pauldrons = [
  { t: '', fill: 'kSteel', lit: true },
  { t: 'matrix(-1 0 0 1 200 0)', fill: 'kSteelD', lit: false }
]
const sunRays = Array.from({ length: 12 }, (_, i) => i * 30)
const mailRows = [134, 138, 142, 146, 150]

/* Ranger cloak leaves */
const leaves = [
  { x: 34, y: 172, r: -30 }, { x: 52, y: 160, r: -10 }, { x: 44, y: 188, r: 20 }, { x: 24, y: 192, r: -50 },
  { x: 150, y: 162, r: 30 }, { x: 166, y: 176, r: 50 }, { x: 150, y: 188, r: 10 }, { x: 176, y: 194, r: 70 },
  { x: 68, y: 182, r: -20 }, { x: 132, y: 182, r: 25 }
]

/* Voidwalker cloak stars */
const stars = [
  [22, 176, 0.8], [34, 190, 0.6], [46, 170, 1], [18, 196, 0.5], [58, 194, 0.7], [40, 160, 0.5],
  [152, 172, 0.9], [166, 186, 0.6], [178, 168, 0.5], [160, 196, 0.8], [142, 192, 0.5], [184, 192, 0.7]
] as const

/* Stormcaller rune ring */
const runes = Array.from({ length: 8 }, (_, i) => i * 45)
</script>

<template>
  <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" class="rb-portrait" :class="[classId, { locked }]" aria-hidden="true">
    <defs>
      <radialGradient :id="id('bg')" cx="50%" cy="40%" r="62%">
        <stop offset="0%" :stop-color="color" stop-opacity="0.5" />
        <stop offset="40%" :stop-color="color" stop-opacity="0.12" />
        <stop offset="100%" stop-color="#05030b" stop-opacity="0" />
      </radialGradient>
      <radialGradient :id="id('back')" cx="72%" cy="30%" r="55%">
        <stop offset="0%" :stop-color="color" stop-opacity="0.45" />
        <stop offset="100%" :stop-color="color" stop-opacity="0" />
      </radialGradient>
      <radialGradient :id="id('vign')" cx="50%" cy="45%" r="75%">
        <stop offset="55%" stop-color="#05030a" stop-opacity="0" />
        <stop offset="100%" stop-color="#05030a" stop-opacity="0.85" />
      </radialGradient>
      <linearGradient :id="id('floor')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.6" stop-color="#05030a" stop-opacity="0" />
        <stop offset="1" stop-color="#05030a" stop-opacity="0.75" />
      </linearGradient>
      <filter :id="id('bloom')" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="2.2" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter :id="id('glow')" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      <filter :id="id('sil')" x="-10%" y="-10%" width="120%" height="120%">
        <feMorphology in="SourceAlpha" operator="dilate" radius="1.1" result="d" />
        <feOffset in="d" dx="0.8" dy="-0.4" result="o" />
        <feFlood :flood-color="color" flood-opacity="0.4" />
        <feComposite in2="o" operator="in" result="rim" />
        <feFlood flood-color="#08060f" />
        <feComposite in2="SourceAlpha" operator="in" result="body" />
        <feMerge>
          <feMergeNode in="rim" />
          <feMergeNode in="body" />
        </feMerge>
      </filter>
    </defs>

    <!-- backdrop -->
    <rect width="200" height="200" fill="#07050d" />
    <rect width="200" height="200" :fill="url('bg')" />
    <rect width="200" height="200" :fill="url('back')" class="rb-backlight" />
    <g class="rb-ring" :stroke="color" fill="none">
      <circle cx="100" cy="86" r="74" stroke-opacity="0.28" stroke-width="0.8" stroke-dasharray="2 6" />
      <circle cx="100" cy="86" r="64" stroke-opacity="0.14" stroke-width="3" stroke-dasharray="18 10 4 10" />
    </g>

    <g class="rb-fig" :filter="locked ? url('sil') : undefined">
      <!-- ═══ KNIGHT ═══ -->
      <g v-if="classId === 'knight'">
        <defs>
          <linearGradient :id="id('kSteel')" x1="0" y1="0" x2="1" y2="0.35">
            <stop offset="0" stop-color="#f6f8fc" />
            <stop offset="0.3" stop-color="#b9c1d0" />
            <stop offset="0.65" stop-color="#5d667a" />
            <stop offset="1" stop-color="#22262f" />
          </linearGradient>
          <linearGradient :id="id('kSteelD')" x1="0" y1="0" x2="1" y2="0.35">
            <stop offset="0" stop-color="#6e7688" />
            <stop offset="0.5" stop-color="#363c4a" />
            <stop offset="1" stop-color="#15171d" />
          </linearGradient>
          <linearGradient :id="id('kHelm')" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#e9edf5" />
            <stop offset="0.28" stop-color="#c3cad8" />
            <stop offset="0.5" stop-color="#7d8698" />
            <stop offset="0.52" stop-color="#4b5263" />
            <stop offset="1" stop-color="#1e2129" />
          </linearGradient>
          <linearGradient :id="id('kGold')" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff4c4" />
            <stop offset="0.45" stop-color="#f5c451" />
            <stop offset="1" stop-color="#8a5a0c" />
          </linearGradient>
          <linearGradient :id="id('kCape')" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#8a1a2c" />
            <stop offset="1" stop-color="#22050c" />
          </linearGradient>
          <linearGradient :id="id('kTabard')" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#23336a" />
            <stop offset="1" stop-color="#090e22" />
          </linearGradient>
          <linearGradient :id="id('kLeather')" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#7a4a26" />
            <stop offset="1" stop-color="#2a160a" />
          </linearGradient>
          <clipPath :id="id('kHelmClip')">
            <path d="M66 64 L71 44 C84 35 116 35 129 44 L134 64 L136 104 L125 125 L100 134 L75 125 L64 104 Z" />
          </clipPath>
        </defs>

        <!-- cape -->
        <path d="M30 146 C24 170 20 188 12 200 L188 200 C180 188 176 170 170 146 Z" :fill="url('kCape')" />
        <path d="M40 160 C36 176 34 190 30 200 M160 160 C164 176 166 190 170 200 M58 168 L54 200 M142 168 L146 200" stroke="#14020a" stroke-width="2.5" fill="none" opacity="0.6" />

        <!-- greatsword over the shoulder -->
        <g>
          <path d="M37 62 L42 60 L58 100 L53 102 Z" :fill="url('kLeather')" />
          <path d="M40 67 L45 65 M43 74 L48 72 M46 81 L51 79 M49 88 L54 86 M52 95 L57 93" stroke="#f5c451" stroke-width="1.2" opacity="0.9" />
          <path d="M36 113 L76 95 L78 99 L60 108 L40 117 Z" :fill="url('kGold')" />
          <circle cx="57" cy="104" r="3.4" fill="#ff4d5e" stroke="#5a3a08" stroke-width="0.8" />
          <circle cx="56.2" cy="103" r="1" fill="#fff" opacity="0.8" />
          <circle cx="38" cy="58" r="6" :fill="url('kGold')" stroke="#5a3a08" stroke-width="0.8" />
          <circle cx="38" cy="58" r="2.4" :fill="color" />
          <circle cx="36" cy="56" r="1.6" fill="#fff" opacity="0.85" />
        </g>

        <!-- breastplate and tabard -->
        <path d="M54 150 C70 140 130 140 146 150 L154 200 L46 200 Z" :fill="url('kSteel')" />
        <path d="M100 142 L100 200" stroke="#1e2129" stroke-width="1" opacity="0.5" />
        <path d="M74 150 L126 150 L134 200 L66 200 Z" :fill="url('kTabard')" />
        <path d="M74 150 L126 150 L134 200 M66 200 L74 150" :stroke="url('kGold')" stroke-width="1.8" fill="none" />
        <g transform="translate(100 174)" class="rb-k-sun">
          <polygon v-for="a in sunRays" :key="a" points="-1.8,-8 1.8,-8 0,-14" :transform="`rotate(${a})`" :fill="url('kGold')" />
          <circle r="7" :fill="url('kGold')" />
          <circle r="4" fill="#fff4c4" opacity="0.6" />
        </g>
        <path d="M134 200 L126 150 L146 150" :stroke="color" stroke-width="1.2" fill="none" opacity="0.6" />

        <!-- mail gorget -->
        <path d="M68 130 C80 124 120 124 132 130 L140 152 C120 146 80 146 60 152 Z" fill="#1c1f28" />
        <g fill="none" stroke="#9aa3b8" stroke-width="0.8" opacity="0.8">
          <path v-for="(y, i) in mailRows" :key="y" :d="`M${66 - i * 1.5} ${y} q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0 q2.5 2.5 5 0`" />
        </g>
        <path d="M100 126 L140 152 L132 130 C122 125 110 124 100 124 Z" fill="#000" opacity="0.35" />

        <!-- pauldrons -->
        <g v-for="(p, i) in pauldrons" :key="i" :transform="p.t">
          <path d="M14 180 C18 162 36 154 64 158 L66 170 C42 168 28 172 16 188 Z" :fill="url(p.fill)" stroke="#0e1016" stroke-width="1" />
          <path d="M14 166 C16 148 36 140 66 144 L68 157 C42 154 28 158 16 172 Z" :fill="url(p.fill)" stroke="#0e1016" stroke-width="1" />
          <path d="M16 153 C14 128 38 110 72 116 C80 126 78 140 72 148 C52 141 32 144 16 153 Z" :fill="url(p.fill)" stroke="#0e1016" stroke-width="1" />
          <path d="M16 153 C32 144 52 141 72 148" :stroke="url('kGold')" stroke-width="2.6" fill="none" stroke-linecap="round" />
          <path d="M15 166 C28 158 42 154 67 157 M15 180 C28 172 42 168 65 170" :stroke="url('kGold')" stroke-width="1.4" fill="none" opacity="0.8" />
          <g :fill="url('kGold')">
            <circle cx="26" cy="145" r="1.7" />
            <circle cx="40" cy="140" r="1.7" />
            <circle cx="56" cy="140" r="1.7" />
            <circle cx="22" cy="160" r="1.3" />
            <circle cx="40" cy="154" r="1.3" />
          </g>
          <path v-if="p.lit" d="M28 132 C38 120 54 116 66 119" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.7" />
          <path v-else d="M16 152 C14 128 38 110 72 116" :stroke="color" stroke-width="1.6" fill="none" opacity="0.85" />
        </g>

        <!-- great helm -->
        <path d="M66 64 L71 44 C84 35 116 35 129 44 L134 64 L136 104 L125 125 L100 134 L75 125 L64 104 Z" :fill="url('kHelm')" stroke="#0e1016" stroke-width="1.2" />
        <g :clip-path="url('kHelmClip')">
          <path d="M64 104 L100 112 L136 104 L136 140 L64 140 Z" fill="#000" opacity="0.28" />
          <rect class="rb-k-glint" x="40" y="20" width="14" height="140" fill="#fff" opacity="0.4" transform="rotate(18 100 86)" />
        </g>
        <path d="M100 37 L100 134" stroke="#fff" stroke-width="1" opacity="0.45" />
        <path d="M101.5 37 L101.5 134" stroke="#0e1016" stroke-width="1" opacity="0.5" />
        <!-- crown band -->
        <path d="M68 58 C84 50 116 50 132 58 L133 65 C116 57 84 57 67 65 Z" :fill="url('kGold')" stroke="#5a3a08" stroke-width="0.6" />
        <g :fill="url('kGold')" stroke="#5a3a08" stroke-width="0.6">
          <path d="M76 55 L79 46 L82 54 Z" />
          <path d="M87 52.5 L90 42 L93 52 Z" />
          <path d="M96 51.5 L100 37 L104 51.5 Z" />
          <path d="M107 52 L110 42 L113 52.5 Z" />
          <path d="M118 54 L121 46 L124 55 Z" />
        </g>
        <circle cx="100" cy="56" r="2" fill="#ff4d5e" />
        <!-- T visor -->
        <path d="M71 78 C84 73 116 73 129 78 L129 86 C116 81 84 81 71 86 Z" fill="#05030a" />
        <path d="M95 82 L105 82 L104 114 L100 119 L96 114 Z" fill="#05030a" />
        <g :filter="url('bloom')" class="rb-k-visor">
          <path d="M74 80.5 C86 76.5 114 76.5 126 80.5 L126 83 C114 79 86 79 74 83 Z" :fill="color" />
          <path d="M98 83 L102 83 L101.5 110 L100 113 L98.5 110 Z" :fill="color" />
          <path d="M77 81.2 C88 78 112 78 123 81.2 M100 83 L100 108" stroke="#fff8dc" stroke-width="0.9" fill="none" />
        </g>
        <path d="M71 78 C84 73 116 73 129 78 M71 86 C84 81 96 81 95 82 M129 86 C116 81 104 81 105 82 M95 82 L96 114 L100 119 L104 114 L105 82" :stroke="url('kGold')" stroke-width="1.2" fill="none" />
        <g fill="#05030a">
          <circle cx="114" cy="100" r="1.3" /><circle cx="119" cy="98" r="1.3" /><circle cx="114" cy="106" r="1.3" /><circle cx="119" cy="104" r="1.3" /><circle cx="124" cy="102" r="1.3" />
          <circle cx="86" cy="100" r="1.3" /><circle cx="81" cy="98" r="1.3" /><circle cx="86" cy="106" r="1.3" /><circle cx="81" cy="104" r="1.3" /><circle cx="76" cy="102" r="1.3" />
        </g>
        <path d="M71 47 L67 64 L65 102" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.65" />
        <path d="M129 44 L134 64 L136 104 L125 125 L100 134" :stroke="color" stroke-width="1.6" fill="none" stroke-linejoin="round" />
      </g>

      <!-- ═══ RANGER ═══ -->
      <g v-else-if="classId === 'ranger'">
        <defs>
          <linearGradient :id="id('rWood')" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#b07a44" />
            <stop offset="1" stop-color="#3e2310" />
          </linearGradient>
          <linearGradient :id="id('rHood')" x1="0" y1="0" x2="1" y2="0.2">
            <stop offset="0" stop-color="#4f8a5c" />
            <stop offset="0.45" stop-color="#2a5234" />
            <stop offset="1" stop-color="#0c1a10" />
          </linearGradient>
          <linearGradient :id="id('rCloak')" x1="0" y1="0" x2="1" y2="0.6">
            <stop offset="0" stop-color="#3b6b45" />
            <stop offset="0.55" stop-color="#1b3322" />
            <stop offset="1" stop-color="#08100a" />
          </linearGradient>
          <radialGradient :id="id('rVoid')" cx="50%" cy="70%" r="65%">
            <stop offset="0" stop-color="#16261a" />
            <stop offset="1" stop-color="#020403" />
          </radialGradient>
          <linearGradient :id="id('rLeather')" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#8a5a32" />
            <stop offset="1" stop-color="#3a200e" />
          </linearGradient>
        </defs>

        <!-- bow behind -->
        <path d="M146 8 C178 40 192 80 188 112 C186 140 172 170 148 196" :stroke="url('rWood')" stroke-width="5.5" fill="none" stroke-linecap="round" />
        <path d="M146 8 C141 4 138 6 136 10 M148 196 C143 200 140 198 138 194" stroke="#3e2310" stroke-width="3" fill="none" stroke-linecap="round" />
        <path d="M144 10 L146 194" stroke="#e8f0d8" stroke-width="0.7" opacity="0.7" />
        <path d="M186 98 L190 100 M186 104 L190 106 M186 110 L190 112 M186 116 L190 118 M186 122 L190 124" stroke="#d9c49a" stroke-width="1.2" />

        <!-- quiver and arrows -->
        <g transform="rotate(-22 52 120)">
          <g v-for="(x, i) in [42, 48, 54, 60]" :key="x">
            <path :d="`M${x} 70 L${x} ${38 - (i % 2) * 6}`" stroke="#d9c49a" stroke-width="1.4" />
            <path :d="`M${x} ${38 - (i % 2) * 6} l-3.5 -2 l0 -10 l3.5 4 z`" :fill="i % 2 ? '#e8f0d8' : color" />
            <path :d="`M${x} ${38 - (i % 2) * 6} l3.5 -2 l0 -10 l-3.5 4 z`" :fill="i % 2 ? '#b8c4a8' : '#3a9a5c'" />
          </g>
          <rect x="36" y="66" width="30" height="96" rx="6" :fill="url('rLeather')" stroke="#1e1006" stroke-width="1" />
          <rect x="35" y="70" width="32" height="5" rx="1.5" fill="#c9a24a" />
          <rect x="35" y="140" width="32" height="5" rx="1.5" fill="#c9a24a" />
          <path d="M40 80 L40 136" stroke="#fff" stroke-width="1.6" opacity="0.35" stroke-linecap="round" />
        </g>

        <!-- cloak -->
        <path d="M10 200 C14 168 38 146 72 138 L128 138 C162 146 186 168 190 200 Z" :fill="url('rCloak')" />
        <g :fill="color" opacity="0.22">
          <path v-for="(l, i) in leaves" :key="i" d="M0 -5 C3 -2 3 2 0 5 C-3 2 -3 -2 0 -5 Z" :transform="`translate(${l.x} ${l.y}) rotate(${l.r}) scale(1.4)`" />
        </g>
        <path d="M44 166 C50 180 52 192 50 200 M156 166 C150 180 148 192 150 200 M100 150 L100 200" stroke="#050a06" stroke-width="2" fill="none" opacity="0.5" />
        <path d="M128 138 C162 146 186 168 190 200" :stroke="color" stroke-width="1.6" fill="none" opacity="0.85" />
        <!-- strap and leaf brooch -->
        <path d="M58 144 L66 140 L150 200 L136 200 Z" :fill="url('rLeather')" />
        <path d="M62 142 L144 200" stroke="#c9a24a" stroke-width="0.8" stroke-dasharray="2 3" />
        <g transform="translate(100 152)">
          <path d="M0 -9 C7 -4 7 4 0 9 C-7 4 -7 -4 0 -9 Z" fill="#d9b04a" stroke="#5a3a08" stroke-width="0.8" />
          <path d="M0 -8 L0 8" stroke="#5a3a08" stroke-width="0.8" />
          <circle r="2.4" :fill="color" :filter="url('bloom')" />
        </g>

        <!-- hood -->
        <path d="M48 146 C42 110 54 74 80 52 C92 42 102 32 112 22 C112 36 118 48 128 58 C148 80 156 112 152 146 C134 132 66 132 48 146 Z" :fill="url('rHood')" stroke="#071009" stroke-width="1.2" />
        <path d="M108 30 C112 44 122 56 132 66 C146 86 152 112 150 140 L100 140 Z" fill="#000" opacity="0.25" />
        <path d="M60 120 C58 100 64 82 76 68 M140 122 C142 102 136 84 124 70" stroke="#0a160d" stroke-width="2" fill="none" opacity="0.6" />
        <path d="M112 22 C112 36 118 48 128 58 C148 80 156 112 152 146" :stroke="color" stroke-width="1.6" fill="none" />
        <path d="M80 52 C66 66 54 86 50 112" stroke="#9fe0ae" stroke-width="1.6" fill="none" opacity="0.5" stroke-linecap="round" />
        <!-- face opening -->
        <path d="M70 132 C68 104 78 80 100 72 C122 80 132 104 130 132 C120 142 80 142 70 132 Z" :fill="url('rVoid')" />
        <path d="M70 132 C68 104 78 80 100 72 C122 80 132 104 130 132" stroke="#0a160d" stroke-width="2.5" fill="none" />
        <!-- mask -->
        <path d="M78 116 C90 122 110 122 122 116 L124 132 C112 140 88 140 76 132 Z" fill="#1e3a26" stroke="#0a160d" stroke-width="0.8" />
        <path d="M78 116 C90 122 110 122 122 116" stroke="#7fd09a" stroke-width="0.9" fill="none" opacity="0.6" />
        <path d="M92 122 L90 136 M108 122 L110 136" stroke="#0a160d" stroke-width="0.8" fill="none" opacity="0.6" />
        <!-- eyes -->
        <g :filter="url('bloom')" class="rb-eyes">
          <path d="M83 103 L95 104 L93 107 L85 106 Z" :fill="color" />
          <path d="M117 103 L105 104 L107 107 L115 106 Z" :fill="color" />
          <path d="M86 104.5 L92 105" stroke="#eaffef" stroke-width="0.8" />
          <path d="M114 104.5 L108 105" stroke="#eaffef" stroke-width="0.8" />
        </g>
      </g>

      <!-- ═══ PYROMANCER ═══ -->
      <g v-else-if="classId === 'pyromancer'">
        <defs>
          <linearGradient :id="id('pRobe')" x1="0" y1="0" x2="1" y2="0.5">
            <stop offset="0" stop-color="#6a1a14" />
            <stop offset="0.5" stop-color="#3a0c0a" />
            <stop offset="1" stop-color="#120304" />
          </linearGradient>
          <linearGradient :id="id('pHair')" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="#5a0a06" />
            <stop offset="0.5" stop-color="#d43a12" />
            <stop offset="0.85" stop-color="#ff8a2b" />
            <stop offset="1" stop-color="#ffd27a" />
          </linearGradient>
          <linearGradient :id="id('pFlame')" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="#ff4d1a" />
            <stop offset="0.55" stop-color="#ffb627" />
            <stop offset="1" stop-color="#fff4c4" stop-opacity="0.2" />
          </linearGradient>
          <linearGradient :id="id('pSkin')" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#5a2c22" />
            <stop offset="0.55" stop-color="#b8664a" />
            <stop offset="1" stop-color="#f0a070" />
          </linearGradient>
          <linearGradient :id="id('pGold')" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff0b0" />
            <stop offset="1" stop-color="#b8780e" />
          </linearGradient>
          <radialGradient :id="id('pBall')" cx="50%" cy="50%" r="50%">
            <stop offset="0" stop-color="#fff" />
            <stop offset="0.3" stop-color="#fff0a0" />
            <stop offset="0.6" stop-color="#ff9a2b" />
            <stop offset="0.85" stop-color="#ff4d1a" stop-opacity="0.8" />
            <stop offset="1" stop-color="#ff2a00" stop-opacity="0" />
          </radialGradient>
        </defs>

        <!-- rising flame hair -->
        <path d="M64 142 C52 130 46 112 50 94 C44 98 40 104 38 112 C34 90 42 70 58 60 C54 52 56 44 62 36 C64 46 70 50 76 50 C78 40 86 32 94 26 C92 34 94 40 98 44 C102 36 110 30 120 26 C116 34 116 42 122 48 C128 44 134 40 142 38 C138 46 138 54 142 60 C156 70 164 88 162 112 C160 104 156 98 150 94 C154 112 148 130 136 142 Z" :fill="url('pHair')" class="rb-p-mane" />
        <path d="M70 138 C62 120 62 98 72 82 C80 72 90 68 100 68 C110 68 120 72 128 82 C138 98 138 120 130 138 Z" fill="#3a0604" opacity="0.7" />
        <g class="rb-p-hair" stroke="#ffd27a" stroke-width="1" fill="none" stroke-linecap="round" opacity="0.75">
          <path d="M58 120 C50 100 54 80 66 66" />
          <path d="M66 70 C70 58 78 50 88 44" />
          <path d="M142 120 C150 100 146 80 134 66" />
          <path d="M134 70 C130 58 122 50 112 44" />
        </g>
        <g :fill="url('pHair')" class="rb-p-hair">
          <path d="M58 122 C44 112 40 96 44 78 C48 94 54 104 64 108 Z" />
          <path d="M142 122 C156 112 160 96 156 78 C152 94 146 104 136 108 Z" />
        </g>

        <!-- robe -->
        <path d="M14 200 C20 166 46 148 76 142 L124 142 C154 148 180 166 186 200 Z" :fill="url('pRobe')" />
        <path d="M66 146 L58 200 M134 146 L142 200" :stroke="url('pGold')" stroke-width="1.6" fill="none" />
        <g :stroke="url('pGold')" stroke-width="1" fill="none" opacity="0.85">
          <path d="M64 160 l4 -4 l4 4 l-4 4 z M62 176 l4 -4 l4 4 l-4 4 z M60 192 l4 -4 l4 4 l-4 4 z" />
          <path d="M136 160 l4 -4 l4 4 l-4 4 z M138 176 l4 -4 l4 4 l-4 4 z" />
          <path d="M84 150 C90 156 110 156 116 150 M88 158 L100 166 L112 158" />
        </g>
        <g :filter="url('bloom')" class="rb-p-runes">
          <circle cx="100" cy="178" r="6" :stroke="color" stroke-width="1.2" fill="none" />
          <path d="M100 172 L100 184 M94 178 L106 178" :stroke="color" stroke-width="1" />
        </g>
        <!-- high collar -->
        <path d="M74 146 L52 104 C64 110 76 120 86 136 Z" :fill="url('pRobe')" stroke="#e0a040" stroke-width="1" />
        <path d="M126 146 L148 104 C136 110 124 120 114 136 Z" :fill="url('pRobe')" stroke="#e0a040" stroke-width="1" />
        <path d="M148 104 C136 110 124 120 114 136" :stroke="color" stroke-width="1.4" fill="none" />
        <!-- neck and face -->
        <path d="M92 118 L108 118 L111 142 L89 142 Z" fill="#3a160e" />
        <path d="M84 92 C84 72 91 64 100 64 C109 64 116 72 116 92 C116 110 108 124 100 127 C92 124 84 110 84 92 Z" :fill="url('pSkin')" />
        <path d="M84 92 C84 110 92 124 100 127 C95 118 90 106 90 92 C90 78 94 70 100 64 C91 64 84 72 84 92 Z" fill="#1e0806" opacity="0.5" />
        <path d="M113 96 C113 108 109 117 104 122" stroke="#ffc080" stroke-width="1.6" fill="none" opacity="0.75" stroke-linecap="round" />
        <path d="M86 87 Q91 84 96 87.5 M114 87 Q109 84 104 87.5" stroke="#2a0806" stroke-width="1.6" fill="none" stroke-linecap="round" />
        <path d="M100 93 L98.5 104 L101.5 105.5" stroke="#4a1a10" stroke-width="0.9" fill="none" />
        <path d="M95 114 Q100 112.5 105 114 Q100 117.5 95 114 Z" fill="#b0302a" />
        <path d="M96.5 114.3 Q100 113.6 103.5 114.3" stroke="#ff9a80" stroke-width="0.5" fill="none" />
        <path d="M86 93 Q91 89.5 96 92.5 M114 93 Q109 89.5 104 92.5" stroke="#1a0402" stroke-width="1.3" fill="none" stroke-linecap="round" />
        <g :filter="url('bloom')" class="rb-eyes">
          <path d="M86.5 93 Q91 89.6 95.5 93 Q91 96 86.5 93 Z" fill="#ffe29a" />
          <path d="M113.5 93 Q109 89.6 104.5 93 Q109 96 113.5 93 Z" fill="#ffe29a" />
          <circle cx="91" cy="93" r="1.2" fill="#fff" />
          <circle cx="109" cy="93" r="1.2" fill="#fff" />
          <path d="M86 98 Q87.5 101 86.5 105 M114 98 Q112.5 101 113.5 105" :stroke="color" stroke-width="0.9" fill="none" stroke-linecap="round" />
        </g>
        <!-- fringe -->
        <path d="M84 86 C84 72 91 64 100 64 C109 64 116 72 116 86 C112 78 107 74 101 74 C96 78 90 80 84 86 Z" :fill="url('pHair')" />
        <path d="M85 94 C81 108 78 124 70 142 C78 138 83 128 86 116 Z" :fill="url('pHair')" />
        <path d="M115 94 C119 108 122 124 130 142 C122 138 117 128 114 116 Z" :fill="url('pHair')" />
        <!-- flaming crown -->
        <g class="rb-p-crown">
          <path d="M84 68 C80 56 84 46 88 38 C89 48 93 54 92 68 Z" :fill="url('pFlame')" />
          <path d="M92 66 C88 48 94 30 100 16 C103 30 109 48 108 66 Z" :fill="url('pFlame')" />
          <path d="M108 68 C107 54 111 48 112 38 C116 46 120 56 116 68 Z" :fill="url('pFlame')" />
          <path d="M78 72 C73 64 75 58 77 52 C79 60 83 64 83 72 Z" :fill="url('pFlame')" />
          <path d="M122 72 C127 64 125 58 123 52 C121 60 117 64 117 72 Z" :fill="url('pFlame')" />
        </g>
        <path d="M79 72 C90 66 110 66 121 72 L120 78 C110 73 90 73 80 78 Z" :fill="url('pGold')" stroke="#5a3008" stroke-width="0.6" />
        <circle cx="100" cy="72" r="2.4" fill="#ff2a00" :filter="url('bloom')" />

        <!-- raised hand with fireball -->
        <path d="M140 200 C140 178 138 160 142 150 L162 148 C168 164 172 182 178 200 Z" :fill="url('pRobe')" />
        <path d="M162 148 C168 164 172 182 178 200" :stroke="color" stroke-width="1.4" fill="none" />
        <g class="rb-p-ball">
          <circle cx="154" cy="104" r="28" :fill="color" opacity="0.4" :filter="url('glow')" />
          <g class="rb-p-tongues" :fill="url('pFlame')">
            <path d="M154 74 C148 86 143 94 144 104 L164 104 C165 94 160 86 154 74 Z" />
            <path d="M136 86 C138 96 138 102 143 110 L150 100 C146 95 141 92 136 86 Z" />
            <path d="M172 86 C170 96 170 102 165 110 L158 100 C162 95 167 92 172 86 Z" />
          </g>
          <circle cx="154" cy="107" r="15" :fill="url('pBall')" />
        </g>
        <path d="M140 150 C136 142 138 132 144 128 L148 126 L147 116 C147 113 151 113 151 116 L152 124 L154 112 C154 109 158 109 158 112 L158 124 L161 114 C161 111 165 112 164 115 L163 126 L167 120 C169 118 172 120 170 123 L166 136 C166 144 164 148 162 150 Z" fill="#2c120a" />
        <path d="M147 116 C147 113 151 113 151 116 M154 112 C154 109 158 109 158 112 M161 114 C161 111 165 112 164 115 M167 120 C169 118 172 120 170 123" :stroke="color" stroke-width="1.2" fill="none" stroke-linecap="round" />
        <path class="rb-p-haze" d="M138 80 C144 74 148 82 154 76 C160 70 164 78 170 72" stroke="#fff4c4" stroke-width="1" fill="none" opacity="0.3" />
      </g>

      <!-- ═══ STORMCALLER ═══ -->
      <g v-else-if="classId === 'stormcaller'">
        <defs>
          <linearGradient :id="id('sRobe')" x1="0" y1="0" x2="1" y2="0.5">
            <stop offset="0" stop-color="#2e4a86" />
            <stop offset="0.5" stop-color="#172648" />
            <stop offset="1" stop-color="#060a18" />
          </linearGradient>
          <linearGradient :id="id('sHood')" x1="0" y1="0" x2="1" y2="0.2">
            <stop offset="0" stop-color="#3c5e9e" />
            <stop offset="0.5" stop-color="#1c2e58" />
            <stop offset="1" stop-color="#070c1c" />
          </linearGradient>
          <linearGradient :id="id('sBeard')" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.5" stop-color="#c8d4e6" />
            <stop offset="1" stop-color="#5c6a82" />
          </linearGradient>
          <linearGradient :id="id('sSkin')" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#8a6a5a" />
            <stop offset="1" stop-color="#3a2a26" />
          </linearGradient>
          <radialGradient :id="id('sOrb')" cx="40%" cy="40%" r="60%">
            <stop offset="0" stop-color="#fff" />
            <stop offset="0.4" stop-color="#bff0ff" />
            <stop offset="1" :stop-color="color" />
          </radialGradient>
        </defs>

        <!-- staff -->
        <path d="M168 200 L172 44" stroke="#3a2a1e" stroke-width="5" stroke-linecap="round" />
        <path d="M167 200 L171 44" stroke="#7a5a3e" stroke-width="1.4" />
        <rect x="166.5" y="70" width="8" height="3" rx="1" fill="#c8d4e6" />
        <rect x="167" y="110" width="8" height="3" rx="1" fill="#c8d4e6" />
        <path d="M172 46 C160 40 160 26 166 20 M172 46 C184 40 184 26 178 20" stroke="#c8d4e6" stroke-width="2" fill="none" stroke-linecap="round" />
        <circle cx="172" cy="32" r="16" :fill="color" opacity="0.5" :filter="url('glow')" class="rb-s-orbglow" />
        <circle cx="172" cy="32" r="8.5" :fill="url('sOrb')" />
        <g :stroke="color" stroke-width="1.3" fill="none" stroke-linejoin="round" :filter="url('bloom')">
          <path class="rb-arc a1" d="M172 32 L184 26 L180 20 L192 12" />
          <path class="rb-arc a2" d="M172 32 L160 36 L164 44 L152 50" />
          <path class="rb-arc a3" d="M172 32 L178 46 L186 44 L190 56" />
        </g>

        <!-- robe -->
        <path d="M12 200 C18 166 44 146 74 140 L126 140 C156 146 182 166 188 200 Z" :fill="url('sRobe')" />
        <path d="M30 168 l6 -8 l2 6 l6 -8 M156 160 l6 8 l2 -6 l6 8" :stroke="color" stroke-width="1.4" fill="none" opacity="0.8" />
        <path d="M126 140 C156 146 182 166 188 200" :stroke="color" stroke-width="1.6" fill="none" opacity="0.85" />
        <!-- sleeves and hands -->
        <path d="M30 200 C34 184 44 172 58 168 L72 176 C64 184 58 192 56 200 Z" :fill="url('sRobe')" stroke="#05081a" stroke-width="1" />
        <path d="M170 200 C166 184 156 172 142 168 L128 176 C136 184 142 192 144 200 Z" :fill="url('sRobe')" stroke="#05081a" stroke-width="1" />
        <g class="rb-s-hand">
          <path d="M56 176 C54 166 60 160 68 160 C74 162 76 170 72 178 Z" fill="#5a4440" />
          <path d="M66 162 L74 150 M70 164 L80 156 M72 168 L82 164 M72 173 L80 174" stroke="#6a5048" stroke-width="3" stroke-linecap="round" />
          <path d="M74 150 L80 156 M82 164 L80 174" :stroke="color" stroke-width="1" stroke-linecap="round" opacity="0.8" />
          <path d="M144 176 C146 166 140 160 132 160 C126 162 124 170 128 178 Z" fill="#3a2c2a" />
          <path d="M134 162 L126 150 M130 164 L120 156 M128 168 L118 164 M128 173 L120 174" stroke="#4a3832" stroke-width="3" stroke-linecap="round" />
          <path d="M126 150 L120 156 M118 164 L120 174" :stroke="color" stroke-width="1" stroke-linecap="round" opacity="0.8" />
        </g>

        <!-- hood -->
        <path d="M52 146 C46 108 60 68 100 48 C140 68 154 108 148 146 C132 132 68 132 52 146 Z" :fill="url('sHood')" stroke="#050818" stroke-width="1.2" />
        <path d="M100 48 C140 68 154 108 148 146 L100 140 Z" fill="#000" opacity="0.22" />
        <path d="M100 48 C140 68 154 108 148 146" :stroke="color" stroke-width="1.6" fill="none" />
        <path d="M100 50 C70 66 56 96 54 124" stroke="#9fc4ff" stroke-width="1.4" fill="none" opacity="0.45" stroke-linecap="round" />
        <path d="M70 134 C68 104 78 82 100 74 C122 82 132 104 130 134 C120 140 80 140 70 134 Z" fill="#05060e" />
        <!-- face -->
        <path d="M84 96 C84 84 92 78 100 78 C108 78 116 84 116 96 L114 112 L86 112 Z" :fill="url('sSkin')" />
        <path d="M84 96 C84 84 92 78 100 78 C108 78 116 84 116 96 L116 92 C108 86 92 86 84 92 Z" fill="#05060e" opacity="0.7" />
        <path d="M100 90 L97 104 L101 106" stroke="#2a1c18" stroke-width="1" fill="none" />
        <path d="M82 90 C88 86 94 88 98 92 L96 94 C92 91 86 92 82 94 Z M118 90 C112 86 106 88 102 92 L104 94 C108 91 114 92 118 94 Z" fill="#eef4ff" />
        <g :filter="url('bloom')" class="rb-eyes">
          <ellipse cx="91" cy="97" rx="3.6" ry="1.6" :fill="color" />
          <ellipse cx="109" cy="97" rx="3.6" ry="1.6" :fill="color" />
        </g>
        <!-- beard -->
        <path d="M80 104 C76 130 82 160 92 190 C96 198 104 198 108 190 C118 160 124 130 120 104 C112 116 88 116 80 104 Z" :fill="url('sBeard')" />
        <g stroke="#8090aa" stroke-width="0.8" fill="none" opacity="0.7">
          <path d="M88 118 C88 140 92 164 98 186 M100 118 L100 192 M112 118 C112 140 108 164 102 186 M82 112 C82 130 86 150 92 170 M118 112 C118 130 114 150 108 170" />
        </g>
        <path d="M84 108 C90 104 96 106 100 110 C104 106 110 104 116 108 C112 116 104 114 100 112 C96 114 88 116 84 108 Z" fill="#fff" stroke="#9aa6bc" stroke-width="0.6" />
        <!-- lightning between the hands -->
        <circle cx="100" cy="162" r="18" :fill="color" opacity="0.35" :filter="url('glow')" class="rb-s-orbglow" />
        <g :stroke="color" stroke-width="2.4" fill="none" stroke-linejoin="round" :filter="url('bloom')">
          <path class="rb-arc a1" d="M80 156 L90 150 L94 160 L106 148 L110 158 L120 154" />
          <path class="rb-arc a2" d="M82 166 L92 170 L98 158 L106 170 L114 162 L120 166" />
          <path class="rb-arc a3" d="M80 174 L90 166 L100 176 L110 164 L120 172" />
        </g>
        <g stroke="#fff" stroke-width="0.8" fill="none" stroke-linejoin="round">
          <path class="rb-arc a1" d="M80 156 L90 150 L94 160 L106 148 L110 158 L120 154" />
          <path class="rb-arc a2" d="M82 166 L92 170 L98 158 L106 170 L114 162 L120 166" />
        </g>
        <!-- storm runes -->
        <g class="rb-s-runes" :stroke="color" stroke-width="1" fill="none" opacity="0.7">
          <g v-for="a in runes" :key="a" :transform="`rotate(${a} 100 86) translate(100 14)`">
            <path d="M-2 -3 L2 -3 L-1 1 L2 1 L-2 5" />
          </g>
        </g>
      </g>

      <!-- ═══ NECROMANCER ═══ -->
      <g v-else-if="classId === 'necromancer'">
        <defs>
          <linearGradient :id="id('nRobe')" x1="0" y1="0" x2="1" y2="0.5">
            <stop offset="0" stop-color="#3a2a52" />
            <stop offset="0.5" stop-color="#1c1430" />
            <stop offset="1" stop-color="#07040c" />
          </linearGradient>
          <linearGradient :id="id('nBone')" x1="0" y1="0" x2="1" y2="0.3">
            <stop offset="0" stop-color="#fffaf0" />
            <stop offset="0.45" stop-color="#d8cfbc" />
            <stop offset="1" stop-color="#6a604e" />
          </linearGradient>
          <radialGradient :id="id('nWisp')" cx="50%" cy="60%" r="60%">
            <stop offset="0" stop-color="#fff" />
            <stop offset="0.4" :stop-color="color" />
            <stop offset="1" :stop-color="color" stop-opacity="0" />
          </radialGradient>
        </defs>

        <!-- tattered mantle -->
        <path d="M8 200 L12 176 L18 184 L22 164 L30 172 C40 152 58 142 76 138 L124 138 C142 142 160 152 170 172 L178 164 L182 184 L188 176 L192 200 Z" :fill="url('nRobe')" />
        <path d="M124 138 C142 142 160 152 170 172 L178 164 L182 184 L188 176" :stroke="color" stroke-width="1.4" fill="none" opacity="0.8" />
        <!-- ribcage ornament -->
        <g :stroke="url('nBone')" stroke-width="2.6" fill="none" stroke-linecap="round">
          <path d="M100 148 L100 196" />
          <path d="M100 156 C90 154 80 158 76 166 M100 156 C110 154 120 158 124 166" />
          <path d="M100 168 C88 166 78 170 74 180 M100 168 C112 166 122 170 126 180" />
          <path d="M100 180 C90 178 82 182 80 192 M100 180 C110 178 118 182 120 192" />
        </g>
        <!-- hood -->
        <path d="M50 146 C44 106 58 64 100 44 C142 64 156 106 150 146 L140 138 L136 148 L128 136 C112 132 88 132 72 136 L64 148 L60 138 Z" :fill="url('nRobe')" stroke="#05030a" stroke-width="1.2" />
        <path d="M100 44 C142 64 156 106 150 146 L140 138 L136 148 L128 136 L100 134 Z" fill="#000" opacity="0.25" />
        <path d="M100 44 C142 64 156 106 150 146" :stroke="color" stroke-width="1.6" fill="none" />
        <path d="M70 134 C68 104 78 80 100 72 C122 80 132 104 130 134 C120 140 80 140 70 134 Z" fill="#040208" />
        <!-- bone crown -->
        <g :fill="url('nBone')" stroke="#3a3026" stroke-width="0.7">
          <path d="M80 72 L74 46 L86 68 Z" />
          <path d="M88 66 L86 36 L95 64 Z" />
          <path d="M96 64 L100 24 L104 64 Z" />
          <path d="M105 64 L114 36 L112 66 Z" />
          <path d="M114 68 L126 46 L120 72 Z" />
          <path d="M78 74 C90 66 110 66 122 74 L120 80 C110 74 90 74 80 80 Z" />
        </g>
        <!-- skull mask -->
        <path d="M80 92 C80 74 90 68 100 68 C110 68 120 74 120 92 C120 104 116 110 113 114 L111 128 L89 128 L87 114 C84 110 80 104 80 92 Z" :fill="url('nBone')" stroke="#3a3026" stroke-width="0.8" />
        <path d="M100 68 C110 68 120 74 120 92 C120 104 116 110 113 114 L111 128 L100 128 Z" fill="#2a2030" opacity="0.3" />
        <path d="M84 94 C84 86 90 84 96 88 C97 94 94 100 88 100 C85 100 84 98 84 94 Z" fill="#0a0612" />
        <path d="M116 94 C116 86 110 84 104 88 C103 94 106 100 112 100 C115 100 116 98 116 94 Z" fill="#0a0612" />
        <g :filter="url('bloom')" class="rb-eyes">
          <circle cx="90.5" cy="93" r="2.6" :fill="color" />
          <circle cx="109.5" cy="93" r="2.6" :fill="color" />
        </g>
        <path d="M100 100 L97 108 L100 110 L103 108 Z" fill="#0a0612" />
        <path d="M90 118 L110 118 M92 114 L92 126 M96 114 L96 127 M100 114 L100 127 M104 114 L104 127 M108 114 L108 126" stroke="#3a3026" stroke-width="0.9" />
        <path d="M84 80 L90 86 L88 90 M116 104 L112 108" stroke="#3a3026" stroke-width="0.7" fill="none" />
        <path d="M84 82 C84 76 90 72 96 71" stroke="#fff" stroke-width="1.4" fill="none" opacity="0.7" stroke-linecap="round" />

        <!-- skeletal hand with a soul -->
        <g stroke="#3a3026" stroke-width="0.6" :fill="url('nBone')">
          <path d="M36 200 L40 168 L46 168 L44 200 Z" />
          <path d="M34 168 C32 160 38 154 44 156 C50 156 52 162 50 168 Z" />
          <path d="M35 160 L30 148 L32 146 L38 158 Z" />
          <path d="M39 156 L37 140 L40 139 L42 155 Z" />
          <path d="M43 156 L45 140 L48 141 L46 156 Z" />
          <path d="M47 158 L53 146 L55 148 L50 160 Z" />
        </g>
        <path d="M24 200 L28 176 L33 182 L37 170 L43 178 L48 170 L52 180 L56 200 Z" :fill="url('nRobe')" stroke="#05030a" stroke-width="1" />
        <path d="M48 170 L52 180 L56 200" :stroke="color" stroke-width="1" fill="none" opacity="0.7" />
        <g class="rb-n-held">
          <circle cx="42" cy="128" r="12" :fill="color" opacity="0.5" :filter="url('glow')" />
          <path d="M42 112 C48 120 50 128 46 134 C44 137 40 137 38 134 C34 128 38 122 42 112 Z" :fill="url('nWisp')" />
        </g>
        <!-- soul wisps -->
        <g class="rb-n-wisps">
          <path class="w1" d="M150 120 C156 112 156 104 150 96 C158 100 162 110 158 120 C156 124 152 124 150 120 Z" :fill="url('nWisp')" />
          <path class="w2" d="M160 80 C164 74 164 68 160 62 C166 66 168 74 165 80 C164 83 161 83 160 80 Z" :fill="url('nWisp')" />
          <path class="w3" d="M28 90 C32 84 32 78 28 72 C34 76 36 84 33 90 C32 93 29 93 28 90 Z" :fill="url('nWisp')" />
        </g>
      </g>

      <!-- ═══ VOIDWALKER ═══ -->
      <g v-else-if="classId === 'voidwalker'">
        <defs>
          <linearGradient :id="id('vArmor')" x1="0" y1="0" x2="1" y2="0.4">
            <stop offset="0" stop-color="#5a5078" />
            <stop offset="0.35" stop-color="#2a2440" />
            <stop offset="1" stop-color="#08060e" />
          </linearGradient>
          <linearGradient :id="id('vHelm')" x1="0" y1="0" x2="1" y2="0.2">
            <stop offset="0" stop-color="#6a5e8e" />
            <stop offset="0.3" stop-color="#2c2444" />
            <stop offset="1" stop-color="#05040a" />
          </linearGradient>
          <linearGradient :id="id('vCloak')" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#1a0c30" />
            <stop offset="1" stop-color="#05020c" />
          </linearGradient>
          <linearGradient :id="id('vVisor')" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" :stop-color="color" stop-opacity="0.6" />
            <stop offset="0.5" stop-color="#ffe0f2" />
            <stop offset="1" :stop-color="color" stop-opacity="0.6" />
          </linearGradient>
          <radialGradient :id="id('vOrb')" cx="40%" cy="35%" r="65%">
            <stop offset="0" stop-color="#2a1a3a" />
            <stop offset="0.6" stop-color="#05020a" />
            <stop offset="1" :stop-color="color" />
          </radialGradient>
          <radialGradient :id="id('vNeb')" cx="30%" cy="70%" r="70%">
            <stop offset="0" :stop-color="color" stop-opacity="0.35" />
            <stop offset="1" :stop-color="color" stop-opacity="0" />
          </radialGradient>
        </defs>

        <!-- star-field mantle with a high collar -->
        <path d="M6 200 C8 170 30 148 62 140 L138 140 C170 148 192 170 194 200 Z" :fill="url('vCloak')" />
        <path d="M66 144 C44 124 36 92 42 54 C54 82 70 104 90 120 Z" :fill="url('vCloak')" />
        <path d="M134 144 C156 124 164 92 158 54 C146 82 130 104 110 120 Z" :fill="url('vCloak')" />
        <path d="M6 200 C8 170 30 148 62 140 L138 140 C170 148 192 170 194 200 Z M66 144 C44 124 36 92 42 54 C54 82 70 104 90 120 Z M134 144 C156 124 164 92 158 54 C146 82 130 104 110 120 Z" :fill="url('vNeb')" />
        <g fill="#fff" class="rb-v-stars">
          <circle v-for="(s, i) in stars" :key="i" :cx="s[0]" :cy="s[1]" :r="s[2]" :style="{ animationDelay: `${(i * 0.37) % 3}s` }" />
          <circle cx="50" cy="80" r="0.7" /><circle cx="56" cy="104" r="0.9" /><circle cx="148" cy="84" r="0.8" /><circle cx="152" cy="110" r="0.6" /><circle cx="46" cy="116" r="0.5" />
        </g>
        <path d="M42 54 C36 92 44 124 66 144" stroke="#e8c8ff" stroke-width="1" fill="none" opacity="0.4" />
        <path d="M158 54 C164 92 156 124 134 144 M138 140 C170 148 192 170 194 200" :stroke="color" stroke-width="1.6" fill="none" />

        <!-- chest plate -->
        <path d="M58 150 C70 140 130 140 142 150 L150 200 L50 200 Z" :fill="url('vArmor')" stroke="#05040a" stroke-width="1" />
        <path d="M100 146 L100 200 M74 154 L88 176 L86 200 M126 154 L112 176 L114 200" stroke="#05040a" stroke-width="1.2" fill="none" />
        <path d="M100 150 L92 166 L100 184 L108 166 Z" :fill="color" :filter="url('bloom')" class="rb-v-core" />
        <path d="M100 156 L96 166 L100 176 L104 166 Z" fill="#fff" opacity="0.85" />
        <!-- angular pauldrons -->
        <path d="M14 172 L26 138 L70 128 L80 146 L58 160 Z" :fill="url('vArmor')" stroke="#05040a" stroke-width="1" />
        <path d="M14 186 L20 168 L58 160 L62 172 Z" fill="#1a1528" stroke="#05040a" stroke-width="1" />
        <path d="M186 172 L174 138 L130 128 L120 146 L142 160 Z" fill="#120e1e" stroke="#05040a" stroke-width="1" />
        <path d="M186 186 L180 168 L142 160 L138 172 Z" fill="#0c0a14" stroke="#05040a" stroke-width="1" />
        <path d="M28 140 L68 131" stroke="#fff" stroke-width="1.8" opacity="0.55" stroke-linecap="round" />
        <path d="M186 172 L174 138 L130 128" :stroke="color" stroke-width="1.5" fill="none" stroke-linejoin="round" />
        <!-- void cracks -->
        <g :stroke="color" stroke-width="1.3" fill="none" stroke-linejoin="round" :filter="url('bloom')" class="rb-v-cracks">
          <path d="M30 152 L40 146 L44 151 L56 142" />
          <path d="M144 140 L152 148 L160 144 L170 152" />
          <path d="M66 182 L76 176 L80 184 L92 176" />
          <path d="M120 192 L128 184 L136 188" />
        </g>
        <!-- neck -->
        <path d="M86 124 L114 124 L119 146 L81 146 Z" fill="#14101e" />
        <path d="M84 131 L116 131 M83 138 L117 138" stroke="#3a3256" stroke-width="1.2" />
        <!-- faceless helm -->
        <path d="M74 72 C76 52 87 40 100 38 C113 40 124 52 126 72 L130 98 L119 120 L100 132 L81 120 L70 98 Z" :fill="url('vHelm')" stroke="#05040a" stroke-width="1.2" />
        <path d="M100 38 C113 40 124 52 126 72 L130 98 L119 120 L100 132 L100 104 Z" fill="#000" opacity="0.3" />
        <path d="M70 98 L84 106 L100 112 L116 106 L130 98" stroke="#05040a" stroke-width="1" fill="none" />
        <path d="M82 120 L88 108 M118 120 L112 108 M100 38 L100 74" stroke="#8a7eb0" stroke-width="0.8" opacity="0.45" fill="none" />
        <!-- V visor -->
        <path d="M74 80 L100 96 L126 80 L124 90 L100 106 L76 90 Z" fill="#05030a" />
        <path d="M77 83 L100 98 L123 83 L122 88 L100 102.5 L78 88 Z" :fill="url('vVisor')" :filter="url('bloom')" class="rb-v-visor" />
        <path d="M80 85.5 L100 99 L120 85.5" stroke="#fff" stroke-width="0.9" fill="none" opacity="0.9" class="rb-v-visor" />
        <path d="M82 60 C86 50 93 44 100 42" stroke="#fff" stroke-width="2.4" fill="none" opacity="0.75" stroke-linecap="round" />
        <ellipse cx="84" cy="68" rx="2.5" ry="6" fill="#fff" opacity="0.18" transform="rotate(25 84 68)" />
        <path d="M100 38 C113 40 124 52 126 72 L130 98 L119 120 L100 132" :stroke="color" stroke-width="1.6" fill="none" stroke-linejoin="round" />
        <!-- the rift splitting the helm -->
        <path d="M110 42 L114 54 L109 60 L117 72 L112 80" :stroke="color" stroke-width="1.6" fill="none" stroke-linejoin="round" :filter="url('bloom')" class="rb-v-cracks" />
        <path d="M110 42 L114 54 L109 60 L117 72 L112 80" stroke="#fff" stroke-width="0.6" fill="none" stroke-linejoin="round" />
      </g>
    </g>

    <!-- foreground effects -->
    <g v-if="!locked" class="rb-fx">
      <!-- void orbs -->
      <template v-if="classId === 'voidwalker'">
        <g v-for="(o, i) in [0, 1, 2]" :key="o">
          <circle r="7" :fill="color" opacity="0.4" :filter="url('glow')" :cx="motion ? 0 : [40, 160, 100][i]" :cy="motion ? 0 : [84, 70, 40][i]">
            <animateMotion v-if="motion" dur="7s" repeatCount="indefinite" :begin="`-${i * 2.33}s`" path="M100 40 C150 40 170 70 160 94 C150 114 50 114 40 94 C30 70 50 40 100 40 Z" />
          </circle>
          <circle r="5" :fill="url('vOrb')" :stroke="color" stroke-width="0.8" :cx="motion ? 0 : [40, 160, 100][i]" :cy="motion ? 0 : [84, 70, 40][i]">
            <animateMotion v-if="motion" dur="7s" repeatCount="indefinite" :begin="`-${i * 2.33}s`" path="M100 40 C150 40 170 70 160 94 C150 114 50 114 40 94 C30 70 50 40 100 40 Z" />
            <animate v-if="motion" attributeName="r" dur="7s" repeatCount="indefinite" :begin="`-${i * 2.33}s`" values="3;5;6.5;5;3" keyTimes="0;0.25;0.5;0.75;1" />
          </circle>
        </g>
      </template>
      <circle
        v-for="(m, i) in motes"
        :key="i"
        class="rb-mote"
        :cx="m.x"
        :cy="m.y"
        :r="m.s"
        :fill="classId === 'stormcaller' ? '#dff6ff' : color"
        :style="{ animationDelay: `${m.d}s` }"
      />
    </g>

    <rect width="200" height="200" :fill="url('vign')" pointer-events="none" />
    <rect width="200" height="200" :fill="url('floor')" pointer-events="none" />
  </svg>
</template>

<style scoped>
.rb-portrait {
  display: block;
  width: 100%;
  height: 100%;
}
.rb-portrait.locked .rb-ring,
.rb-portrait.locked .rb-backlight {
  opacity: 0.25;
}
.rb-portrait * {
  transform-box: view-box;
}
.rb-ring {
  transform-origin: 100px 86px;
  animation: rb-spin 30s linear infinite;
}
.rb-backlight {
  animation: rb-breathe 4s ease-in-out infinite;
}
.rb-eyes {
  animation: rb-glow 3.2s ease-in-out infinite;
}
.rb-mote {
  opacity: 0;
  animation: rb-rise 4.5s ease-in infinite;
}

/* knight */
.rb-k-visor {
  animation: rb-glow 2.6s ease-in-out infinite;
}
.rb-k-glint {
  transform-origin: 100px 86px;
  animation: rb-glint 5s ease-in-out infinite;
}

/* pyromancer */
.rb-p-crown path,
.rb-p-tongues path {
  transform-origin: center bottom;
  transform-box: fill-box;
  animation: rb-flicker 0.7s ease-in-out infinite alternate;
}
.rb-p-crown path:nth-child(2n),
.rb-p-tongues path:nth-child(2n) {
  animation-duration: 0.55s;
  animation-delay: -0.2s;
}
.rb-p-hair path {
  transform-origin: center;
  transform-box: fill-box;
  animation: rb-flicker 1.1s ease-in-out infinite alternate;
}
.rb-p-ball {
  transform-origin: 155px 106px;
  animation: rb-throb 1.4s ease-in-out infinite;
}
.rb-p-haze {
  animation: rb-haze 1.8s ease-in-out infinite;
}

/* stormcaller */
.rb-arc {
  animation: rb-arc 1.3s steps(1) infinite;
}
.rb-arc.a2 {
  animation-delay: -0.45s;
}
.rb-arc.a3 {
  animation-delay: -0.9s;
}
.rb-s-orbglow {
  animation: rb-glow 1.2s ease-in-out infinite;
}
.rb-s-runes {
  transform-origin: 100px 86px;
  animation: rb-spin 40s linear infinite reverse;
}

/* necromancer */
.rb-n-wisps path {
  transform-box: fill-box;
  transform-origin: center;
  animation: rb-wisp 3.6s ease-in-out infinite;
}
.rb-n-wisps .w2 {
  animation-delay: -1.2s;
}
.rb-n-wisps .w3 {
  animation-delay: -2.4s;
}
.rb-n-held {
  animation: rb-bob 2.8s ease-in-out infinite;
}

/* voidwalker */
.rb-v-cracks,
.rb-v-core {
  animation: rb-glow 1.8s ease-in-out infinite;
}
.rb-v-visor {
  animation: rb-glow 2.4s ease-in-out infinite;
}
.rb-v-scan {
  animation: rb-scan 2.6s ease-in-out infinite;
}
.rb-v-stars circle {
  animation: rb-twinkle 3s ease-in-out infinite;
}

.locked * {
  animation-play-state: paused;
}

@keyframes rb-spin {
  to { transform: rotate(360deg); }
}
@keyframes rb-breathe {
  50% { opacity: 0.55; }
}
@keyframes rb-glow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
@keyframes rb-rise {
  0% { transform: translateY(0); opacity: 0; }
  20% { opacity: 0.9; }
  100% { transform: translateY(-130px); opacity: 0; }
}
@keyframes rb-glint {
  0%, 60% { transform: translateX(-60px) rotate(18deg); }
  85%, 100% { transform: translateX(120px) rotate(18deg); }
}
@keyframes rb-flicker {
  from { transform: scale(1, 1); }
  to { transform: scale(0.9, 1.12); }
}
@keyframes rb-throb {
  50% { transform: scale(1.08); }
}
@keyframes rb-haze {
  0%, 100% { transform: translateY(0); opacity: 0.1; }
  50% { transform: translateY(-6px); opacity: 0.4; }
}
@keyframes rb-arc {
  0% { opacity: 1; }
  12% { opacity: 0.2; }
  20% { opacity: 1; }
  45% { opacity: 0; }
  70% { opacity: 0.9; }
}
@keyframes rb-wisp {
  0%, 100% { transform: translateY(0) scale(1); opacity: 0.9; }
  50% { transform: translateY(-8px) scale(1.12); opacity: 0.5; }
}
@keyframes rb-bob {
  50% { transform: translateY(-4px); }
}
@keyframes rb-scan {
  0%, 100% { transform: translateX(0); opacity: 0; }
  10% { opacity: 0.9; }
  50% { transform: translateX(36px); opacity: 0.9; }
  60% { opacity: 0; }
}
@keyframes rb-twinkle {
  50% { opacity: 0.2; }
}
@media (prefers-reduced-motion: reduce) {
  .rb-portrait * { animation: none !important; }
}
</style>
