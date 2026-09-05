<script setup lang="ts">
// A lab specimen jar: a bug floating in glowing liquid, bubbles rising.
// Fill level and glow colour follow research level; `boiling` cranks it up.
const props = withDefaults(defineProps<{
  emoji: string
  /** 0..1 — how full the jar's glow-liquid is */
  fill?: number
  color?: string
  boiling?: boolean
  size?: number
}>(), { fill: 0.4, color: 'var(--ui-primary)', boiling: false, size: 96 })

const bubbles = Array.from({ length: 6 }, (_, i) => ({
  id: i,
  x: 24 + (i * 37) % 44,
  r: 1.2 + (i % 3) * 0.7,
  dur: `${2.2 + (i % 4) * 0.6}s`,
  delay: `${-(i * 0.7)}s`
}))

const liquidTop = computed(() => 82 - Math.max(0.08, Math.min(1, props.fill)) * 56)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 96 96"
    fill="none"
    aria-hidden="true"
    class="colony-jar"
    :class="{ 'colony-jar-boiling': boiling }"
    :style="{ '--jar-color': color }"
  >
    <defs>
      <clipPath :id="`jar-clip-${emoji.codePointAt(0)}`">
        <path d="M24 22h48v52a10 10 0 0 1-10 10H34a10 10 0 0 1-10-10V22z" />
      </clipPath>
    </defs>
    <!-- shadow -->
    <ellipse
      cx="48"
      cy="88"
      rx="24"
      ry="3.5"
      fill="black"
      fill-opacity="0.3"
    />
    <!-- jar glass back -->
    <path
      d="M24 22h48v52a10 10 0 0 1-10 10H34a10 10 0 0 1-10-10V22z"
      fill="var(--ui-bg)"
      fill-opacity="0.6"
    />
    <!-- liquid -->
    <g :clip-path="`url(#jar-clip-${emoji.codePointAt(0)})`">
      <rect
        class="colony-jar-liquid"
        x="24"
        :y="liquidTop"
        width="48"
        height="70"
        :fill="color"
        fill-opacity="0.35"
      />
      <ellipse
        class="colony-jar-surface"
        cx="48"
        :cy="liquidTop"
        rx="24"
        ry="3"
        :fill="color"
        fill-opacity="0.55"
      />
      <circle
        v-for="b in bubbles"
        :key="b.id"
        class="colony-jar-bubble"
        :cx="b.x"
        cy="82"
        :r="b.r"
        fill="white"
        fill-opacity="0.55"
        :style="{ '--dur': b.dur, '--delay': b.delay }"
      />
    </g>
    <!-- bug -->
    <text
      class="colony-jar-bug"
      x="48"
      y="58"
      text-anchor="middle"
      font-size="26"
      dominant-baseline="middle"
    >{{ emoji }}</text>
    <!-- glass front + rim -->
    <path
      d="M24 22h48v52a10 10 0 0 1-10 10H34a10 10 0 0 1-10-10V22z"
      stroke="var(--ui-border)"
      stroke-width="2"
    />
    <path
      d="M30 28v40"
      stroke="white"
      stroke-opacity="0.35"
      stroke-width="2"
      stroke-linecap="round"
    />
    <path
      d="M66 30v10"
      stroke="white"
      stroke-opacity="0.2"
      stroke-width="2"
      stroke-linecap="round"
    />
    <!-- lid -->
    <rect
      x="20"
      y="14"
      width="56"
      height="10"
      rx="3"
      fill="#9ca3af"
    />
    <rect
      x="24"
      y="10"
      width="48"
      height="6"
      rx="2"
      fill="#d1d5db"
    />
    <rect
      x="28"
      y="17"
      width="40"
      height="2"
      rx="1"
      fill="#6b7280"
    />
    <!-- label -->
    <rect
      x="34"
      y="66"
      width="28"
      height="9"
      rx="1.5"
      fill="#fef3c7"
      fill-opacity="0.9"
    />
    <path
      d="M38 70h20M38 72.5h14"
      stroke="#92400e"
      stroke-width="1"
      stroke-opacity="0.6"
    />
  </svg>
</template>

<style scoped>
.colony-jar { overflow: visible; filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.35)); }
.colony-jar-bug { animation: colony-jar-hover 3s ease-in-out infinite; transform-origin: 48px 58px; filter: drop-shadow(0 0 6px var(--jar-color)); }
.colony-jar-boiling .colony-jar-bug { animation-duration: 0.6s; }
.colony-jar-bubble { animation: colony-bubble var(--dur) ease-in var(--delay) infinite; }
.colony-jar-boiling .colony-jar-bubble { animation-duration: 0.7s; }
.colony-jar-liquid { transition: y 0.6s ease-out; }
.colony-jar-surface { animation: colony-jar-slosh 2.4s ease-in-out infinite; transform-origin: 48px 50px; transition: cy 0.6s ease-out; }
@keyframes colony-jar-hover {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50% { transform: translateY(-4px) rotate(3deg); }
}
@keyframes colony-jar-slosh {
  0%, 100% { transform: scaleX(1); }
  50% { transform: scaleX(0.94); }
}
</style>
