<script setup lang="ts">
// Candy-land scenery behind the cabinet: pastel sky, frosted hills, lollipop
// trees, candy canes and drifting sprinkles. Pure SVG + CSS, no images.
defineProps<{ bonus?: boolean }>()

// Cosmetic layout only.
const SPRINKLE_COLORS = ['#ff6fb5', '#ffd23a', '#5ee0a0', '#58c4ff', '#b77bff', '#ffffff']
const sprinkles = Array.from({ length: 34 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  delay: `${-((i * 1.7) % 14)}s`,
  duration: `${11 + (i % 7) * 1.6}s`,
  color: SPRINKLE_COLORS[i % SPRINKLE_COLORS.length],
  rot: `${(i * 47) % 180}deg`,
  size: 0.7 + (i % 4) * 0.18
}))

const lollipops = [
  { x: 90, y: 560, r: 44, h: 170, c1: '#ff5fa8', c2: '#fff0f7' },
  { x: 250, y: 610, r: 30, h: 120, c1: '#5ec8ff', c2: '#e9f8ff' },
  { x: 1180, y: 575, r: 50, h: 180, c1: '#ffb12e', c2: '#fff6e0' },
  { x: 1340, y: 620, r: 34, h: 130, c1: '#3fe07e', c2: '#eafff2' },
  { x: 1500, y: 560, r: 42, h: 160, c1: '#b45cff', c2: '#f5ecff' }
]
const canes = [
  { x: 400, y: 700, s: 1 },
  { x: 1060, y: 690, s: -1.1 }
]
</script>

<template>
  <div
    class="cm-backdrop"
    :class="{ 'cm-backdrop--bonus': bonus }"
    aria-hidden="true"
  >
    <svg
      class="cm-backdrop__scene"
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMax slice"
    >
      <defs>
        <linearGradient
          id="cmSky"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop
            offset="0"
            class="cm-sky-top"
          />
          <stop
            offset="0.55"
            class="cm-sky-mid"
          />
          <stop
            offset="1"
            class="cm-sky-low"
          />
        </linearGradient>
        <radialGradient
          id="cmSun"
          cx="0.5"
          cy="0.5"
          r="0.5"
        >
          <stop
            offset="0"
            stop-color="#fff6d8"
            stop-opacity="0.95"
          />
          <stop
            offset="0.4"
            stop-color="#ffc6e6"
            stop-opacity="0.45"
          />
          <stop
            offset="1"
            stop-color="#ffc6e6"
            stop-opacity="0"
          />
        </radialGradient>
        <linearGradient
          id="cmHillBack"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop
            offset="0"
            stop-color="#d9a4ff"
          />
          <stop
            offset="1"
            stop-color="#8a4fd6"
          />
        </linearGradient>
        <linearGradient
          id="cmHillMid"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop
            offset="0"
            stop-color="#ff9ccf"
          />
          <stop
            offset="1"
            stop-color="#c2408a"
          />
        </linearGradient>
        <linearGradient
          id="cmHillFront"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop
            offset="0"
            stop-color="#7a2a86"
          />
          <stop
            offset="1"
            stop-color="#2c0a3f"
          />
        </linearGradient>
        <pattern
          id="cmCane"
          width="22"
          height="22"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect
            width="22"
            height="22"
            fill="#fff"
          />
          <rect
            width="11"
            height="22"
            fill="#ff3d6e"
          />
        </pattern>
      </defs>

      <rect
        width="1600"
        height="900"
        fill="url(#cmSky)"
      />
      <circle
        cx="800"
        cy="250"
        r="420"
        fill="url(#cmSun)"
      />

      <!-- clouds -->
      <g
        class="cm-clouds"
        fill="#fff"
        opacity="0.55"
      >
        <g transform="translate(160 150)">
          <ellipse
            rx="90"
            ry="30"
          />
          <ellipse
            cx="-50"
            cy="-10"
            rx="50"
            ry="30"
          />
          <ellipse
            cx="40"
            cy="-22"
            rx="60"
            ry="38"
          />
        </g>
        <g transform="translate(1320 110) scale(1.2)">
          <ellipse
            rx="90"
            ry="30"
          />
          <ellipse
            cx="-50"
            cy="-10"
            rx="50"
            ry="30"
          />
          <ellipse
            cx="40"
            cy="-22"
            rx="60"
            ry="38"
          />
        </g>
        <g transform="translate(1040 260) scale(0.7)">
          <ellipse
            rx="90"
            ry="30"
          />
          <ellipse
            cx="40"
            cy="-22"
            rx="60"
            ry="38"
          />
        </g>
      </g>

      <!-- back hills -->
      <path
        d="M0 560 C 180 470 330 470 480 530 C 640 590 760 480 920 470 C 1100 460 1220 560 1380 520 C 1480 495 1560 480 1600 490 L1600 900 L0 900 Z"
        fill="url(#cmHillBack)"
      />
      <!-- frosting drips on the back hills -->
      <path
        d="M0 560 C 180 470 330 470 480 530 C 640 590 760 480 920 470 C 1100 460 1220 560 1380 520 C 1480 495 1560 480 1600 490 L1600 520 C 1560 515 1540 545 1520 520 C 1480 540 1440 545 1400 552 C 1380 580 1360 580 1350 552 C 1260 580 1220 570 1150 520 C 1130 548 1110 548 1100 510 C 1020 490 980 500 930 505 C 910 540 890 540 880 506 C 800 510 760 560 700 570 C 680 600 660 600 650 572 C 580 580 520 560 480 556 C 470 585 450 585 440 548 C 350 510 260 500 180 525 C 160 560 140 560 130 535 C 80 555 30 580 0 590 Z"
        fill="#fff5fb"
        opacity="0.9"
      />

      <!-- lollipop trees -->
      <g
        v-for="(l, i) in lollipops"
        :key="i"
        class="cm-lolly"
        :style="{ animationDelay: `${-i * 1.3}s`, transformOrigin: `${l.x}px ${l.y + l.h}px` }"
      >
        <rect
          :x="l.x - 5"
          :y="l.y"
          width="10"
          :height="l.h"
          rx="5"
          fill="#fff"
          opacity="0.95"
        />
        <circle
          :cx="l.x"
          :cy="l.y"
          :r="l.r"
          :fill="l.c2"
        />
        <path
          :d="`M ${l.x} ${l.y} m 0 -${l.r * 0.15} a ${l.r * 0.15} ${l.r * 0.15} 0 1 1 0 ${l.r * 0.3} a ${l.r * 0.35} ${l.r * 0.35} 0 1 1 0 -${l.r * 0.7} a ${l.r * 0.55} ${l.r * 0.55} 0 1 1 0 ${l.r * 1.1} a ${l.r * 0.78} ${l.r * 0.78} 0 1 1 0 -${l.r * 1.56}`"
          fill="none"
          :stroke="l.c1"
          :stroke-width="l.r * 0.2"
          stroke-linecap="round"
        />
        <ellipse
          :cx="l.x - l.r * 0.35"
          :cy="l.y - l.r * 0.4"
          :rx="l.r * 0.3"
          :ry="l.r * 0.16"
          fill="#fff"
          opacity="0.7"
          :transform="`rotate(-35 ${l.x - l.r * 0.35} ${l.y - l.r * 0.4})`"
        />
      </g>

      <!-- mid hills -->
      <path
        d="M0 700 C 200 620 380 640 560 690 C 720 735 880 650 1060 650 C 1240 650 1400 720 1600 680 L1600 900 L0 900 Z"
        fill="url(#cmHillMid)"
      />
      <!-- candy canes -->
      <g
        v-for="(c, i) in canes"
        :key="`cane-${i}`"
        :transform="`translate(${c.x} ${c.y}) scale(${c.s} ${Math.abs(c.s)})`"
      >
        <path
          d="M0 120 L0 0 A 34 34 0 0 1 68 0 L68 14"
          fill="none"
          stroke="#8a1840"
          stroke-width="24"
          stroke-linecap="round"
          opacity="0.35"
          transform="translate(4 6)"
        />
        <path
          d="M0 120 L0 0 A 34 34 0 0 1 68 0 L68 14"
          fill="none"
          stroke="url(#cmCane)"
          stroke-width="22"
          stroke-linecap="round"
        />
      </g>
      <!-- gumdrops -->
      <g opacity="0.95">
        <path
          d="M180 760 q 0 -60 45 -60 q 45 0 45 60 z"
          fill="#5ee0a0"
        />
        <path
          d="M1250 780 q 0 -70 52 -70 q 52 0 52 70 z"
          fill="#ffd23a"
        />
        <path
          d="M1420 770 q 0 -48 36 -48 q 36 0 36 48 z"
          fill="#58c4ff"
        />
        <ellipse
          cx="210"
          cy="722"
          rx="12"
          ry="7"
          fill="#fff"
          opacity="0.6"
        />
        <ellipse
          cx="1285"
          cy="728"
          rx="14"
          ry="8"
          fill="#fff"
          opacity="0.6"
        />
      </g>

      <!-- front chocolate ridge -->
      <path
        d="M0 810 C 240 760 420 800 640 800 C 900 800 1080 760 1300 780 C 1450 792 1540 800 1600 790 L1600 900 L0 900 Z"
        fill="url(#cmHillFront)"
      />
    </svg>

    <div class="cm-backdrop__sprinkles">
      <span
        v-for="(s, i) in sprinkles"
        :key="i"
        :style="{ 'left': s.left, 'animationDelay': s.delay, 'animationDuration': s.duration, 'background': s.color, '--rot': s.rot, '--sz': s.size }"
      />
    </div>
    <div class="cm-backdrop__veil" />
  </div>
</template>

<style scoped>
.cm-backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background: #2c0a3f;
}

.cm-backdrop__scene {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transition: filter 1.2s ease;
}

.cm-sky-top { stop-color: #ffb3dc; }
.cm-sky-mid { stop-color: #e6b8ff; }
.cm-sky-low { stop-color: #ffd6ec; }

.cm-backdrop--bonus .cm-backdrop__scene {
  filter: hue-rotate(-38deg) saturate(1.25) brightness(0.8);
}

.cm-clouds {
  animation: cm-drift 40s ease-in-out infinite alternate;
}

.cm-lolly {
  animation: cm-sway 6s ease-in-out infinite alternate;
}

@keyframes cm-drift {
  from { transform: translateX(-30px); }
  to { transform: translateX(30px); }
}

@keyframes cm-sway {
  from { transform: rotate(-1.6deg); }
  to { transform: rotate(1.6deg); }
}

.cm-backdrop__sprinkles span {
  position: absolute;
  top: -20px;
  width: calc(14px * var(--sz));
  height: calc(4px * var(--sz));
  border-radius: 4px;
  opacity: 0.75;
  animation-name: cm-fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

@keyframes cm-fall {
  from { transform: translateY(0) rotate(var(--rot)); }
  to { transform: translateY(110vh) rotate(calc(var(--rot) + 540deg)); }
}

/* darken the centre a touch so the cabinet reads first */
.cm-backdrop__veil {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 70% at 50% 45%, rgba(40, 6, 60, 0.28), transparent 70%),
    linear-gradient(180deg, rgba(40, 6, 60, 0) 60%, rgba(30, 4, 46, 0.55));
}

@media (prefers-reduced-motion: reduce) {
  .cm-clouds, .cm-lolly, .cm-backdrop__sprinkles span { animation: none; }
  .cm-backdrop__sprinkles { display: none; }
}
</style>
