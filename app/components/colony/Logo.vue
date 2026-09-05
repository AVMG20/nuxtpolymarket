<script setup lang="ts">
// A little glass jar with a bug inside — the colony's mark.
withDefaults(defineProps<{ size?: number }>(), { size: 36 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient
        id="colony-logo-glass"
        x1="0"
        y1="0"
        x2="1"
        y2="1"
      >
        <stop
          offset="0"
          stop-color="white"
          stop-opacity="0.35"
        />
        <stop
          offset="0.5"
          stop-color="white"
          stop-opacity="0.05"
        />
        <stop
          offset="1"
          stop-color="white"
          stop-opacity="0.2"
        />
      </linearGradient>
      <linearGradient
        id="colony-logo-soil"
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
          stop-color="#3b2416"
        />
      </linearGradient>
    </defs>
    <!-- lid -->
    <rect
      x="14"
      y="4"
      width="20"
      height="6"
      rx="2"
      fill="#f5b342"
    />
    <rect
      x="16"
      y="6"
      width="16"
      height="2"
      rx="1"
      fill="#c07f1c"
    />
    <!-- jar body -->
    <path
      d="M13 10h22v26a6 6 0 0 1-6 6H19a6 6 0 0 1-6-6V10z"
      fill="var(--ui-bg-elevated)"
      stroke="var(--ui-primary)"
      stroke-width="2"
    />
    <!-- soil -->
    <path
      d="M15 28c4-2 8 2 12 0s5-2 6 0v8a4 4 0 0 1-4 4H19a4 4 0 0 1-4-4v-8z"
      fill="url(#colony-logo-soil)"
    />
    <!-- sprout -->
    <path
      d="M24 28v-6"
      stroke="#6da35a"
      stroke-width="2"
      stroke-linecap="round"
    />
    <path
      d="M24 24c-3-1-4-4-3-6 3 0 4 3 3 6zM24 22c3-1 4-4 3-6-3 0-4 3-3 6z"
      fill="#6da35a"
    />
    <!-- bug -->
    <ellipse
      cx="28"
      cy="34"
      rx="4"
      ry="3"
      fill="var(--ui-primary)"
    />
    <circle
      cx="31.5"
      cy="33"
      r="1.8"
      fill="var(--ui-primary)"
    />
    <circle
      cx="32.2"
      cy="32.6"
      r="0.5"
      fill="white"
    />
    <path
      d="M25 33l-2-1.5M25 35l-2 1.5M28 31v-1.5"
      stroke="var(--ui-primary)"
      stroke-width="1"
      stroke-linecap="round"
    />
    <!-- glass highlight -->
    <path
      d="M13 10h22v26a6 6 0 0 1-6 6H19a6 6 0 0 1-6-6V10z"
      fill="url(#colony-logo-glass)"
    />
    <path
      d="M17 13v22"
      stroke="white"
      stroke-opacity="0.45"
      stroke-width="1.5"
      stroke-linecap="round"
    />
  </svg>
</template>
