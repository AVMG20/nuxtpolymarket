<script lang="ts">
import { getPlantArt, plantGenome, plantGrowScale, PLANT_PIVOT, type PlantPath, type PlantStage } from '#shared/utils/xeno'

/*
 * Shared geometry: on the client every art layer (the soil, and each plant's
 * plant and air layers per stage) is written once into one hidden <svg><defs>
 * and icons render a <use> per layer. A list of 300 icons then costs a handful
 * of nodes each instead of 10-25 paths and up to 10 KB of path data each.
 * SSR (and the hydration pass that must match it) renders the paths inline.
 */
const SVG_NS = 'http://www.w3.org/2000/svg'
let spriteDefs: SVGDefsElement | null = null
const spriteIds = new Map<string, string>()

function spriteId(key: string, paths: PlantPath[]): string | null {
  if (!paths.length) return null
  if (!spriteDefs?.isConnected) {
    const sheet = document.createElementNS(SVG_NS, 'svg')
    sheet.setAttribute('aria-hidden', 'true')
    sheet.setAttribute('width', '0')
    sheet.setAttribute('height', '0')
    sheet.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
    spriteDefs = document.createElementNS(SVG_NS, 'defs')
    sheet.appendChild(spriteDefs)
    document.body.appendChild(sheet)
    spriteIds.clear()
  }
  const known = spriteIds.get(key)
  if (known) return known
  const id = `xeno-plant-${spriteIds.size}`
  const g = document.createElementNS(SVG_NS, 'g')
  g.id = id
  g.setAttribute('stroke-linecap', 'round')
  g.setAttribute('stroke-linejoin', 'round')
  for (const p of paths) {
    const el = document.createElementNS(SVG_NS, 'path')
    el.setAttribute('d', p.d)
    el.setAttribute('fill', p.fill ?? 'none')
    if (p.stroke) el.setAttribute('stroke', p.stroke)
    if (p.width != null) el.setAttribute('stroke-width', String(p.width))
    if (p.strokeOpacity != null) el.setAttribute('stroke-opacity', String(p.strokeOpacity))
    if (p.opacity != null) el.setAttribute('opacity', String(p.opacity))
    g.appendChild(el)
  }
  spriteDefs.appendChild(g)
  spriteIds.set(key, id)
  return id
}
</script>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  /** Plant type id or hybrid typeId (hybrids draw one stem per resource). */
  id?: string | null
  /** Pixel size of the square icon (number → px, or any CSS length string). */
  size?: number | string
  /** Emoji shown when the id isn't a known plant. */
  fallback?: string
  /** Extra zoom-in (fraction cropped off each side) to tighten the framing. */
  inset?: number
  /** Growth stage to draw. */
  stage?: PlantStage
  /** Overall growth progress (0..1): grows the plant smoothly within its stage. */
  progress?: number
  /** Draw a theme-aware silhouette (undiscovered species). */
  silhouette?: boolean
  /** Gentle sway of the stem and leaves; the soil never moves. */
  animated?: boolean
}>(), {
  size: 32,
  fallback: '🌱',
  inset: 0,
  stage: 'ready',
  silhouette: false,
  animated: false,
})

const art = computed(() => getPlantArt(props.id, props.stage, props.silhouette))

// Inline paths during SSR and hydration (so the markup matches), shared
// sprite <use>s from then on.
const nuxtApp = useNuxtApp()
const spriteMode = ref(import.meta.client && !nuxtApp.isHydrating)
onMounted(() => {
  spriteMode.value = true
})

const sprite = computed(() => {
  const a = art.value
  if (!spriteMode.value || !a) return null
  const key = `${props.id}|${props.stage}|${props.silhouette ? 1 : 0}`
  return {
    ground: spriteId(`ground|${props.silhouette ? 1 : 0}`, a.ground),
    plant: spriteId(key, a.plant),
    air: spriteId(`${key}|air`, a.air),
  }
})

const dimension = computed(() =>
  typeof props.size === 'number' ? `${props.size}px` : props.size,
)

const box = computed(() => {
  const i = Math.max(0, Math.min(0.4, props.inset || 0)) * 100
  return { i, viewBox: `${i} ${i} ${100 - 2 * i} ${100 - 2 * i}` }
})

/** Shared by the grow and sway groups: both pivot where the stem meets the soil. */
const origin = computed(() => `${PLANT_PIVOT[0] - box.value.i}px ${PLANT_PIVOT[1] - box.value.i}px`)

const growStyle = computed(() => {
  const s = plantGrowScale(props.stage, props.progress)
  return s === 1
    ? { transformOrigin: origin.value }
    : { transformOrigin: origin.value, transform: `scale(${s})` }
})

const swayStyle = computed(() => {
  if (!props.animated) return undefined
  const g = plantGenome(props.id)
  return {
    transformOrigin: origin.value,
    animationDuration: `${(g?.swayDuration ?? 4.2).toFixed(2)}s`,
    animationDelay: `${(g?.swayDelay ?? 0).toFixed(2)}s`,
  }
})
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center align-middle leading-none select-none"
    :class="{ 'xeno-plant-sil': silhouette && art }"
    :style="art ? { width: dimension, height: dimension } : { width: dimension, height: dimension, fontSize: `calc(${dimension} * 0.82)` }"
  >
    <svg
      v-if="art && sprite"
      :viewBox="box.viewBox"
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
    >
      <use v-if="sprite.ground" :href="`#${sprite.ground}`" />
      <g class="xeno-plant-grow" :style="growStyle">
        <g :class="{ 'xeno-plant-sway': animated }" :style="swayStyle">
          <use v-if="sprite.plant" :href="`#${sprite.plant}`" />
        </g>
      </g>
      <use v-if="sprite.air" :href="`#${sprite.air}`" />
    </svg>
    <svg
      v-else-if="art"
      :viewBox="box.viewBox"
      width="100%"
      height="100%"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path
        v-for="(p, i) in art.ground"
        :key="`g${i}`"
        :d="p.d"
        :fill="p.fill ?? 'none'"
        :stroke="p.stroke"
        :stroke-width="p.width"
        :opacity="p.opacity"
      />
      <g class="xeno-plant-grow" :style="growStyle">
        <g :class="{ 'xeno-plant-sway': animated }" :style="swayStyle">
          <path
            v-for="(p, i) in art.plant"
            :key="i"
            :d="p.d"
            :fill="p.fill ?? 'none'"
            :stroke="p.stroke"
            :stroke-width="p.width"
            :stroke-opacity="p.strokeOpacity"
            :opacity="p.opacity"
          />
        </g>
      </g>
      <path
        v-for="(p, i) in art.air"
        :key="`a${i}`"
        :d="p.d"
        :fill="p.fill"
        :opacity="p.opacity"
      />
    </svg>
    <template v-else>{{ fallback }}</template>
  </span>
</template>

<style scoped>
/* Silhouettes paint in currentColor; the dark rule is fully global so it
   can't compile down to a bare `.dark` selector. */
.xeno-plant-sil {
  color: var(--xeno-silhouette, #c4c7cf);
}
:global(.dark .xeno-plant-sil) {
  color: var(--xeno-silhouette, #464a53);
}
.xeno-plant-grow,
.xeno-plant-sway {
  transform-box: view-box;
}
.xeno-plant-grow {
  transition: transform 0.9s cubic-bezier(0.25, 0.8, 0.3, 1);
}
.xeno-plant-sway {
  animation: xeno-plant-sway 4.2s ease-in-out infinite alternate;
}
@keyframes xeno-plant-sway {
  from { transform: rotate(-1.4deg); }
  to { transform: rotate(1.4deg); }
}
@media (prefers-reduced-motion: reduce) {
  .xeno-plant-sway { animation: none; }
  .xeno-plant-grow { transition: none; }
}
</style>
