<script setup lang="ts">
// The colony nest — a cutaway mound that grows one chamber per habitat
// level. Under construction, a crane and dust show on the newest chamber.
const props = withDefaults(defineProps<{
  level: number
  maxLevel?: number
  building?: boolean
  size?: number
}>(), { maxLevel: 6, building: false, size: 200 })

// Chamber positions inside the mound, laid out so each new level digs a
// little deeper / wider. Index = level - 1.
const CHAMBERS: Array<{ x: number; y: number; r: number }> = [
  { x: 100, y: 118, r: 16 },
  { x: 66, y: 134, r: 13 },
  { x: 136, y: 138, r: 13 },
  { x: 84, y: 162, r: 12 },
  { x: 122, y: 166, r: 12 },
  { x: 100, y: 88, r: 12 }
]

const chambers = computed(() => CHAMBERS.slice(0, Math.max(1, Math.min(props.maxLevel, props.level))))
const nextChamber = computed(() => props.level < props.maxLevel ? CHAMBERS[props.level] : null)

// Tunnels connect each chamber to the previous one.
const tunnels = computed(() => chambers.value.slice(1).map((c, i) => {
  const prev = chambers.value[i]!
  return `M${prev.x} ${prev.y} Q${(prev.x + c.x) / 2 + (i % 2 ? 10 : -10)} ${(prev.y + c.y) / 2} ${c.x} ${c.y}`
}))

const moundHeight = computed(() => 60 + Math.min(props.maxLevel, props.level) * 6)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 200 200"
    fill="none"
    aria-hidden="true"
    class="colony-nest"
  >
    <defs>
      <linearGradient
        id="colony-nest-sky"
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop
          offset="0"
          stop-color="var(--ui-primary)"
          stop-opacity="0.18"
        />
        <stop
          offset="1"
          stop-color="var(--ui-primary)"
          stop-opacity="0"
        />
      </linearGradient>
      <linearGradient
        id="colony-nest-soil"
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop
          offset="0"
          stop-color="#7a5230"
        />
        <stop
          offset="1"
          stop-color="#2a1a10"
        />
      </linearGradient>
      <radialGradient id="colony-nest-chamber">
        <stop
          offset="0"
          stop-color="#f5b342"
          stop-opacity="0.45"
        />
        <stop
          offset="1"
          stop-color="#1a1206"
        />
      </radialGradient>
    </defs>
    <!-- sky -->
    <rect
      width="200"
      height="110"
      fill="url(#colony-nest-sky)"
    />
    <!-- sun -->
    <circle
      cx="160"
      cy="34"
      r="12"
      fill="#f5b342"
      fill-opacity="0.9"
      class="colony-nest-sun"
    />
    <!-- ground -->
    <path
      d="M0 108Q50 100 100 106T200 108V200H0z"
      fill="url(#colony-nest-soil)"
    />
    <!-- grass -->
    <g
      stroke="#6da35a"
      stroke-width="2"
      stroke-linecap="round"
    >
      <path d="M14 106l-2-8M18 105l2-9M40 104l-1-7M172 106l-3-8M178 106l2-8M62 105l1-6" />
    </g>
    <!-- mound -->
    <path
      :d="`M40 108 Q100 ${108 - moundHeight} 160 108z`"
      fill="#8a5a2b"
    />
    <path
      :d="`M50 108 Q100 ${108 - moundHeight + 12} 150 108z`"
      fill="#5a381a"
      fill-opacity="0.5"
    />
    <!-- entrance -->
    <ellipse
      cx="100"
      :cy="108 - moundHeight * 0.55"
      rx="8"
      ry="6"
      fill="#1a1206"
    />
    <!-- tunnels -->
    <path
      v-for="(d, i) in tunnels"
      :key="i"
      :d="d"
      stroke="#1a1206"
      stroke-width="7"
      stroke-linecap="round"
    />
    <path
      :d="`M100 ${108 - moundHeight * 0.55} L100 ${CHAMBERS[0]!.y}`"
      stroke="#1a1206"
      stroke-width="7"
      stroke-linecap="round"
    />
    <!-- chambers -->
    <g
      v-for="(c, i) in chambers"
      :key="i"
      class="colony-nest-chamber"
      :style="{ animationDelay: `${i * 0.4}s` }"
    >
      <circle
        :cx="c.x"
        :cy="c.y"
        :r="c.r"
        fill="url(#colony-nest-chamber)"
      />
      <text
        :x="c.x"
        :y="c.y + 4"
        text-anchor="middle"
        font-size="11"
      >{{ ['🐛', '🪲', '🦗', '🕷️', '🪳', '🐝'][i] }}</text>
    </g>
    <!-- next chamber (dashed, or under construction) -->
    <g v-if="nextChamber">
      <circle
        :cx="nextChamber.x"
        :cy="nextChamber.y"
        :r="nextChamber.r"
        :stroke="building ? '#f5b342' : 'var(--ui-text-muted)'"
        stroke-width="1.5"
        stroke-dasharray="4 3"
        :class="building ? 'colony-nest-building' : ''"
        fill="#1a1206"
        :fill-opacity="building ? 0.6 : 0.25"
      />
      <text
        v-if="building"
        :x="nextChamber.x"
        :y="nextChamber.y + 4"
        text-anchor="middle"
        font-size="11"
        class="colony-nest-building"
      >🔨</text>
      <text
        v-else
        :x="nextChamber.x"
        :y="nextChamber.y + 4"
        text-anchor="middle"
        font-size="10"
        fill="var(--ui-text-muted)"
        font-weight="900"
      >?</text>
    </g>
    <!-- level flag on top -->
    <path
      :d="`M100 ${108 - moundHeight} v-18`"
      stroke="#6b4423"
      stroke-width="2"
    />
    <path
      :d="`M101 ${108 - moundHeight - 18} h14 l-3 4 3 4 h-14z`"
      fill="var(--ui-primary)"
      class="colony-nest-flag"
    />
    <text
      :x="108"
      :y="108 - moundHeight - 11"
      text-anchor="middle"
      font-size="6"
      font-weight="900"
      fill="white"
    >{{ level }}</text>
  </svg>
</template>

<style scoped>
.colony-nest { overflow: visible; }
.colony-nest-chamber { animation: colony-glow-pulse 3s ease-in-out infinite; }
.colony-nest-building { animation: colony-glow-pulse 0.6s ease-in-out infinite; }
.colony-nest-sun { animation: colony-glow-pulse 4s ease-in-out infinite; filter: drop-shadow(0 0 8px #f5b342); }
.colony-nest-flag { transform-origin: 101px 0; animation: colony-wiggle 1.6s ease-in-out infinite; }
</style>
