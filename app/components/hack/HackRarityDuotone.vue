<script setup lang="ts">
import { RARITY_ORDER, type HackRarity } from '#shared/utils/hack-config'

// Per-rarity duotone that recolors a white-on-transparent sigil into the rarity
// hue: luminance → a two-stop RGB ramp (black → tinted). Tuned values approved in
// the art-direction preview (tint 1, shadow 0, contrast 0.75). Rendered once by
// the hack shell; agent avatars reference these filters by id.
const TINT = 1
const SHADOW = 0
const CONTRAST = 0.75

const RARITY_TINT: Record<HackRarity, string> = {
  ghost: '#a1a1aa',
  operative: '#4ade80',
  specialist: '#38bdf8',
  elite: '#fbbf24',
  phantom: '#fb7185'
}

function channelTable(c: number): string {
  const hi = 255 - (255 - c) * TINT
  const lo = c * SHADOW
  const mid = (lo + hi) / 2
  const clamp = (v: number) => Math.max(0, Math.min(255, v)) / 255
  return `${clamp(mid + (lo - mid) * CONTRAST).toFixed(4)} ${clamp(mid + (hi - mid) * CONTRAST).toFixed(4)}`
}

const filters = computed(() =>
  RARITY_ORDER.map((rarity) => {
    const hex = RARITY_TINT[rarity]
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    return { rarity, r: channelTable(rgb[0]!), g: channelTable(rgb[1]!), b: channelTable(rgb[2]!) }
  })
)
</script>

<template>
  <svg
    aria-hidden="true"
    focusable="false"
    width="0"
    height="0"
    style="position: absolute; width: 0; height: 0; overflow: hidden"
  >
    <filter
      v-for="f in filters"
      :id="`hack-duo-${f.rarity}`"
      :key="f.rarity"
      color-interpolation-filters="sRGB"
    >
      <feColorMatrix
        type="matrix"
        values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0"
      />
      <feComponentTransfer>
        <feFuncR
          type="table"
          :tableValues="f.r"
        />
        <feFuncG
          type="table"
          :tableValues="f.g"
        />
        <feFuncB
          type="table"
          :tableValues="f.b"
        />
      </feComponentTransfer>
    </filter>
  </svg>
</template>
