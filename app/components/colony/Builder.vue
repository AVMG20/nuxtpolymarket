<script setup lang="ts">
// A beetle in a hard hat. `busy` swings the hammer and drops sparks;
// `ready` waves a flag; otherwise it naps.
withDefaults(defineProps<{ busy?: boolean; ready?: boolean; size?: number }>(), { busy: false, ready: false, size: 72 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 80 80"
    fill="none"
    aria-hidden="true"
    class="colony-builder"
    :class="{ 'colony-builder-busy': busy, 'colony-builder-ready': ready }"
  >
    <!-- shadow -->
    <ellipse
      cx="40"
      cy="66"
      rx="20"
      ry="4"
      fill="black"
      fill-opacity="0.25"
    />
    <!-- legs -->
    <g
      stroke="#3b2416"
      stroke-width="2.5"
      stroke-linecap="round"
    >
      <path d="M26 54l-7 8M32 58l-4 9M48 58l4 9M54 54l7 8" />
    </g>
    <!-- body -->
    <ellipse
      cx="40"
      cy="46"
      rx="18"
      ry="15"
      fill="#8a5a2b"
    />
    <path
      d="M40 32v29"
      stroke="#5a381a"
      stroke-width="2"
    />
    <ellipse
      cx="33"
      cy="44"
      rx="4"
      ry="3"
      fill="#5a381a"
    />
    <ellipse
      cx="47"
      cy="48"
      rx="3"
      ry="2.5"
      fill="#5a381a"
    />
    <!-- head -->
    <circle
      cx="40"
      cy="28"
      r="9"
      fill="#a3682f"
    />
    <circle
      cx="36.5"
      cy="27"
      r="2"
      fill="#1a1206"
    />
    <circle
      cx="43.5"
      cy="27"
      r="2"
      fill="#1a1206"
    />
    <circle
      cx="37"
      cy="26.4"
      r="0.7"
      fill="white"
    />
    <circle
      cx="44"
      cy="26.4"
      r="0.7"
      fill="white"
    />
    <path
      class="colony-builder-mouth"
      d="M37 32q3 2.5 6 0"
      stroke="#1a1206"
      stroke-width="1.4"
      stroke-linecap="round"
    />
    <!-- antennae -->
    <path
      d="M35 21q-4-6-8-5M45 21q4-6 8-5"
      stroke="#3b2416"
      stroke-width="1.6"
      stroke-linecap="round"
    />
    <!-- hard hat -->
    <path
      d="M29 24a11 11 0 0 1 22 0z"
      fill="#f5b342"
    />
    <rect
      x="26"
      y="23"
      width="28"
      height="4"
      rx="2"
      fill="#e09a2b"
    />
    <rect
      x="38"
      y="15"
      width="4"
      height="8"
      rx="1.5"
      fill="#ffd27a"
    />
    <!-- hammer (busy) -->
    <g
      v-if="busy"
      class="colony-builder-hammer"
    >
      <path
        d="M58 44l10-14"
        stroke="#6b4423"
        stroke-width="3"
        stroke-linecap="round"
      />
      <rect
        x="62"
        y="22"
        width="12"
        height="8"
        rx="2"
        fill="#9ca3af"
        transform="rotate(-54 68 26)"
      />
    </g>
    <g
      v-if="busy"
      class="colony-builder-sparks"
    >
      <circle
        cx="70"
        cy="20"
        r="1.5"
        fill="#ffd27a"
      />
      <circle
        cx="74"
        cy="26"
        r="1.2"
        fill="#f5b342"
      />
      <circle
        cx="66"
        cy="16"
        r="1"
        fill="#fff"
      />
    </g>
    <!-- flag (ready) -->
    <g
      v-if="ready"
      class="colony-builder-flag"
    >
      <path
        d="M60 44V22"
        stroke="#6b4423"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      <path
        d="M61 22h14l-4 5 4 5H61z"
        fill="var(--ui-color-success-500)"
      />
    </g>
    <!-- zzz (idle) -->
    <g
      v-if="!busy && !ready"
      class="colony-builder-zzz"
      fill="var(--ui-text-muted)"
      font-size="9"
      font-weight="900"
    >
      <text
        x="54"
        y="22"
      >z</text>
      <text
        x="60"
        y="14"
        font-size="7"
      >z</text>
    </g>
  </svg>
</template>

<style scoped>
.colony-builder { overflow: visible; }
.colony-builder-busy { animation: colony-bob 0.5s ease-in-out infinite; }
.colony-builder-hammer { transform-origin: 58px 44px; animation: colony-hammer 0.5s ease-in-out infinite; }
.colony-builder-sparks { animation: colony-glow-pulse 0.5s ease-in-out infinite; }
.colony-builder-flag { transform-origin: 60px 44px; animation: colony-wiggle 0.9s ease-in-out infinite; }
.colony-builder-zzz { animation: colony-glow-pulse 2.4s ease-in-out infinite; }
.colony-builder-ready { animation: colony-bob 0.9s ease-in-out infinite; }
</style>
