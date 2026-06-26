<script setup lang="ts">
import { getPlantSprite, plantSheetUrl, PLANT_SHEET_GEOMETRY } from '#shared/utils/xeno'

const props = withDefaults(defineProps<{
  /** Plant type id (or hybrid typeId — resolves to its first resource). */
  id?: string | null
  /** Pixel size of the square icon (number → px, or any CSS length string). */
  size?: number | string
  /** Emoji shown when the id has no sprite mapping. */
  fallback?: string
  /** Extra zoom-in (fraction cropped off each side) to tighten the framing. */
  inset?: number
}>(), {
  size: 32,
  fallback: '🌱',
  inset: 0,
})

const sprite = computed(() => getPlantSprite(props.id))

const dimension = computed(() =>
  typeof props.size === 'number' ? `${props.size}px` : props.size,
)

/** Numeric pixel size used for the sprite crop math. */
const px = computed(() => {
  const n = typeof props.size === 'number' ? props.size : parseFloat(props.size)
  return Number.isFinite(n) ? n : 32
})

const style = computed(() => {
  const base: Record<string, string> = {
    width: dimension.value,
    height: dimension.value,
  }
  const s = sprite.value
  if (!s) {
    base.fontSize = `calc(${dimension.value} * 0.82)`
    return base
  }
  const g = PLANT_SHEET_GEOMETRY[s.sheet]
  const win = g.win * (1 - 2 * props.inset)
  // Centre of this cell in the source image (px).
  const cx = g.x0 + s.col * g.dx
  const cy = g.y0 + s.row * g.dy
  // Scale so the `win`-px crop window fills the `E`-px element, then offset so
  // the cell centre lands at the element centre.
  const E = px.value
  const scale = E / win
  base.backgroundImage = `url(${plantSheetUrl(s.sheet)})`
  base.backgroundSize = `${g.w * scale}px ${g.h * scale}px`
  base.backgroundPosition = `${E / 2 - cx * scale}px ${E / 2 - cy * scale}px`
  return base
})
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center align-middle leading-none select-none overflow-hidden"
    :class="sprite ? 'rounded-md bg-no-repeat' : ''"
    :style="style"
  >{{ sprite ? '' : fallback }}</span>
</template>
