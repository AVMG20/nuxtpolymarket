<script setup lang="ts">
// The Aether Gates marquee logo: a glowing portal behind gilded lettering with a
// light sweep across it. Pure inline SVG.
defineProps<{ bonus?: boolean }>()
const uid = `ag${Math.random().toString(36).slice(2, 8)}`
const id = (name: string) => `${uid}-${name}`
</script>

<template>
  <svg
    class="ag-logo"
    viewBox="0 0 640 190"
    role="img"
    aria-label="Aether Gates"
  >
    <defs>
      <linearGradient
        :id="id('gold')"
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop
          offset="0"
          stop-color="#fffbe0"
        />
        <stop
          offset="0.3"
          stop-color="#ffd966"
        />
        <stop
          offset="0.55"
          stop-color="#c27c12"
        />
        <stop
          offset="0.62"
          stop-color="#8a520c"
        />
        <stop
          offset="0.8"
          stop-color="#f4c54c"
        />
        <stop
          offset="1"
          stop-color="#fff0b3"
        />
      </linearGradient>
      <linearGradient
        :id="id('shine')"
        x1="0"
        y1="0"
        x2="1"
        y2="0.2"
        gradientUnits="objectBoundingBox"
      >
        <stop
          offset="0"
          stop-color="#fff"
          stop-opacity="0"
        />
        <stop
          offset="0.45"
          stop-color="#fff"
          stop-opacity="0"
        />
        <stop
          offset="0.5"
          stop-color="#fff"
          stop-opacity="0.85"
        />
        <stop
          offset="0.55"
          stop-color="#fff"
          stop-opacity="0"
        />
        <stop
          offset="1"
          stop-color="#fff"
          stop-opacity="0"
        />
        <animateTransform
          attributeName="gradientTransform"
          type="translate"
          values="-1 0; 1 0; 1 0"
          keyTimes="0; 0.4; 1"
          dur="5s"
          repeatCount="indefinite"
        />
      </linearGradient>
      <radialGradient
        :id="id('portal')"
        cx="0.5"
        cy="0.5"
        r="0.5"
      >
        <stop
          offset="0"
          :stop-color="bonus ? '#fdf4ff' : '#ecfeff'"
        />
        <stop
          offset="0.25"
          :stop-color="bonus ? '#e879f9' : '#67e8f9'"
        />
        <stop
          offset="0.6"
          stop-color="#4f46e5"
        />
        <stop
          offset="1"
          stop-color="#1e1b4b"
          stop-opacity="0"
        />
      </radialGradient>
      <linearGradient
        :id="id('ribbon')"
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop
          offset="0"
          stop-color="#3d4fe0"
        />
        <stop
          offset="1"
          stop-color="#121758"
        />
      </linearGradient>
      <filter
        :id="id('glow')"
        x="-20%"
        y="-40%"
        width="140%"
        height="180%"
      >
        <feGaussianBlur
          stdDeviation="6"
          result="b"
        />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter
        :id="id('drop')"
        x="-10%"
        y="-20%"
        width="120%"
        height="150%"
      >
        <feDropShadow
          dx="0"
          dy="4"
          stdDeviation="3"
          flood-color="#000"
          flood-opacity="0.7"
        />
      </filter>
    </defs>

    <!-- portal glow behind the lettering -->
    <g class="ag-logo-portal">
      <circle
        cx="320"
        cy="78"
        r="74"
        :fill="`url(#${id('portal')})`"
        opacity="0.5"
      />
      <g
        class="ag-logo-swirl"
        fill="none"
        stroke="#e0fbff"
        stroke-opacity="0.25"
        stroke-width="2"
      >
        <path d="M320 78 m-8 0 a 20 20 0 1 1 30 -12" />
        <path d="M320 78 m8 0 a 34 34 0 1 1 -48 22" />
        <path d="M320 78 m0 -12 a 52 52 0 1 1 -40 70" />
      </g>
    </g>
    <!-- lightning either side -->
    <g
      :filter="`url(#${id('glow')})`"
      class="ag-logo-bolts"
    >
      <path
        d="M150 20 L128 70 L146 70 L120 128 L168 58 L148 58 L170 20 Z"
        fill="#fde68a"
      />
      <path
        d="M490 20 L512 70 L494 70 L520 128 L472 58 L492 58 L470 20 Z"
        fill="#fde68a"
      />
    </g>

    <!-- AETHER -->
    <g :filter="`url(#${id('drop')})`">
      <text
        x="320"
        y="104"
        text-anchor="middle"
        class="ag-logo-word"
        :fill="`url(#${id('gold')})`"
        stroke="#2a1402"
        stroke-width="5"
        paint-order="stroke"
      >AETHER</text>
    </g>
    <text
      x="320"
      y="104"
      text-anchor="middle"
      class="ag-logo-word"
      :fill="`url(#${id('shine')})`"
    >AETHER</text>

    <!-- GATES ribbon -->
    <g :filter="`url(#${id('drop')})`">
      <path
        d="M196 122 H444 L430 146 L444 170 H196 L210 146 Z"
        :fill="`url(#${id('ribbon')})`"
        stroke="#e7b53c"
        stroke-width="3"
      />
      <text
        x="320"
        y="158"
        text-anchor="middle"
        class="ag-logo-sub"
        :fill="`url(#${id('gold')})`"
        stroke="#1a0f02"
        stroke-width="2.5"
        paint-order="stroke"
      >GATES</text>
    </g>
  </svg>
</template>

<style scoped>
.ag-logo {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.ag-logo-word {
  font-family: 'Cinzel Decorative', 'Cinzel', Georgia, serif;
  font-size: 84px;
  font-weight: 900;
  letter-spacing: 4px;
}

.ag-logo-sub {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 32px;
  font-weight: 900;
  letter-spacing: 14px;
}

.ag-logo-swirl {
  transform-origin: 320px 78px;
  animation: ag-logo-spin 14s linear infinite;
}

.ag-logo-bolts {
  animation: ag-logo-flicker 4s steps(1) infinite;
}

@keyframes ag-logo-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes ag-logo-flicker {
  0%, 100% {
    opacity: 0.9;
  }
  46% {
    opacity: 0.35;
  }
  48% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
  52% {
    opacity: 0.95;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ag-logo-swirl,
  .ag-logo-bolts {
    animation: none;
  }
}
</style>
