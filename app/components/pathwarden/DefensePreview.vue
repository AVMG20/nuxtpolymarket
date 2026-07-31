<script setup lang="ts">
import type { PathwardenDefenseBlueprint } from '#shared/utils/gamelogic/pathwarden'

const props = defineProps<{
  defense: PathwardenDefenseBlueprint
  compact?: boolean
}>()

const roofPoints = computed(() => {
  if (props.defense.archetype === 'spire') return '80,27 103,72 80,96 57,72'
  if (props.defense.archetype === 'mortar') return '47,70 80,53 113,70 80,88'
  return '51,69 80,54 109,69 80,84'
})
</script>

<template>
  <div class="defense-preview" :class="{ compact }" :style="{ '--defense-color': defense.color }">
    <svg viewBox="0 0 160 132" role="img" :aria-label="`${defense.name} model preview`">
      <defs>
        <linearGradient :id="`ground-${defense.id}`" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="var(--ui-color-success-400)" />
          <stop offset="1" stop-color="var(--ui-color-success-700)" />
        </linearGradient>
        <filter :id="`glow-${defense.id}`">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <ellipse cx="80" cy="112" rx="56" ry="13" fill="rgb(15 23 42 / .28)" />
      <path d="M22 89 80 60l58 29-58 31z" :fill="`url(#ground-${defense.id})`" />
      <path d="m22 89 58 31v8L22 97z" fill="var(--ui-color-success-800)" />
      <path d="m138 89-58 31v8l58-31z" fill="var(--ui-color-success-900)" />
      <path d="M48 66 80 50l32 16v39L80 121l-32-16z" fill="var(--ui-color-neutral-500)" />
      <path d="m48 66 32 16v39l-32-16z" fill="var(--ui-color-neutral-600)" />
      <path d="m112 66-32 16v39l32-16z" fill="var(--ui-color-neutral-400)" />
      <path :d="`M${roofPoints.replaceAll(' ', ' L')} Z`" :fill="defense.color" opacity=".92" />

      <g v-if="defense.family === 'sun'">
        <ellipse cx="80" cy="77" rx="35" ry="14" fill="var(--defense-color)" />
        <path d="M45 77v31q35 23 70 0V77q-35 22-70 0" fill="var(--ui-color-neutral-500)" />
        <ellipse cx="80" cy="107" rx="35" ry="13" fill="var(--ui-color-neutral-600)" />
      </g>
      <g v-else-if="defense.family === 'winter'">
        <path d="m80 13 22 58-8 47H66l-9-46z" fill="var(--defense-color)" stroke="var(--ui-color-neutral-100)" stroke-width="2" />
        <path d="m80 13 4 96-18 9z" fill="rgb(255 255 255 / .24)" />
      </g>
      <g v-else-if="defense.family === 'ember'">
        <path d="M50 72 80 55l30 17v44l-30 14-30-14z" fill="var(--ui-color-neutral-700)" />
        <path d="M57 65V29h13v34M90 62V21h13v48" fill="var(--ui-color-neutral-900)" />
        <path d="M58 26q7-25 13 0M91 18q8-24 13 2" fill="var(--defense-color)" />
      </g>
      <g v-else-if="defense.family === 'storm'">
        <path d="m62 120 8-67 10-31 4 44 13-39-6 92z" fill="var(--ui-color-neutral-700)" stroke="var(--defense-color)" stroke-width="4" />
        <path d="m77 54 14 15-12 16 12 17" fill="none" stroke="var(--defense-color)" stroke-width="5" />
      </g>
      <g v-else-if="defense.family === 'dawn'">
        <path d="M48 77q32-44 64 0v37l-32 16-32-16z" fill="var(--ui-color-neutral-300)" />
        <circle cx="80" cy="43" :r="11 + defense.tier" :fill="defense.color" />
        <path d="M80 17v12M54 43h13M93 43h13M62 24l9 9M98 24l-9 9" stroke="var(--defense-color)" stroke-width="4" />
      </g>
      <g v-else-if="defense.family === 'venom'">
        <path d="M81 122Q55 92 84 70T78 34" fill="none" stroke="var(--ui-color-success-900)" :stroke-width="16 + defense.tier" stroke-linecap="round" />
        <g fill="var(--defense-color)">
          <ellipse cx="56" cy="69" rx="20" ry="9" transform="rotate(-28 56 69)" />
          <ellipse cx="104" cy="57" rx="21" ry="9" transform="rotate(25 104 57)" />
          <ellipse cx="76" cy="34" rx="18" ry="9" />
        </g>
      </g>
      <g v-else-if="defense.family === 'gale'">
        <path d="m57 119 12-62h22l12 62z" fill="var(--ui-color-neutral-400)" />
        <g transform="translate(80 55)" fill="var(--defense-color)">
          <path d="M-4 4 1-35 11-42 6-3zM4-4 35 1 42 11 3 6zM4 4-1 35-11 42-6 3zM-4-4-35-1-42-11-3-6z" />
          <circle r="8" fill="var(--ui-color-neutral-800)" />
        </g>
      </g>
      <g v-else-if="defense.family === 'prism'">
        <path d="m80 11 32 64-16 49H64L48 75z" fill="var(--defense-color)" stroke="var(--ui-color-neutral-100)" stroke-width="2" />
        <path d="m80 11 4 100-20 13-16-49z" fill="rgb(255 255 255 / .2)" />
      </g>
      <g v-else-if="defense.family === 'siege'">
        <path d="M39 77 80 57l41 20v42l-41 15-41-15z" fill="var(--ui-color-neutral-700)" />
        <path d="M39 77h82v16H39z" fill="var(--defense-color)" />
        <g fill="var(--ui-color-neutral-200)">
          <rect v-for="x in [43, 61, 79, 97, 115]" :key="x" :x="x" y="65" width="9" height="17" />
        </g>
      </g>

      <g v-if="defense.archetype === 'ballista'" transform="translate(80 58)">
        <ellipse cy="8" rx="20" ry="8" fill="var(--ui-color-neutral-700)" />
        <path d="M-31-8 Q-20 8-31 23M31-8Q20 8 31 23M-31-8 0 8 31-8M-31 23 0 8 31 23" fill="none" stroke="var(--defense-color)" stroke-width="4" />
        <path d="M-8 6h48" stroke="var(--ui-color-neutral-900)" stroke-width="7" stroke-linecap="round" />
        <path d="m42 6-13-7v14z" :fill="defense.color" />
      </g>
      <g v-else-if="defense.archetype === 'mortar'" transform="translate(80 62)">
        <ellipse cy="9" rx="23" ry="10" fill="var(--ui-color-neutral-700)" />
        <path d="M-8 4 28-18" stroke="var(--ui-color-neutral-900)" stroke-width="17" stroke-linecap="round" />
        <path d="M-6 1 27-19" stroke="var(--defense-color)" stroke-width="8" stroke-linecap="round" />
        <ellipse cx="28" cy="-19" rx="7" ry="9" :fill="defense.color" />
      </g>
      <g v-else :filter="`url(#glow-${defense.id})`">
        <path d="M80 20 97 55 87 81 67 71 61 46z" :fill="defense.color" stroke="var(--ui-color-neutral-100)" stroke-width="2" />
        <path d="m80 20 7 51-20 0z" fill="rgb(255 255 255 / .22)" />
      </g>

      <g v-if="defense.family === 'gale'" :stroke="defense.color" stroke-width="5" stroke-linecap="round">
        <path d="M80 55v-25M80 55l24 8M80 55 61 72M80 55 65 34" />
      </g>
      <path v-if="defense.family === 'venom'" d="M52 65Q80 30 108 65L80 51Z" :fill="defense.color" />
      <g v-if="defense.tier > 1" :fill="defense.color">
        <circle v-for="index in defense.tier - 1" :key="index" :cx="56 + index * (48 / defense.tier)" cy="91" r="4" />
      </g>
      <g v-if="defense.tier >= 2">
        <path d="M51 82V43m58 39V43" stroke="var(--ui-color-neutral-100)" stroke-width="2" />
        <path d="m51 43-18 8 18 8zm58 0 18 8-18 8z" :fill="defense.color" />
      </g>
      <g v-if="defense.tier >= 3">
        <path d="M31 91 49 81l14 8v32l-17 8-15-8zM129 91l-18-10-14 8v32l17 8 15-8z" fill="var(--ui-color-neutral-600)" />
        <path d="m31 91 18-10 14 8-17 9zm98 0-18-10-14 8 17 9z" :fill="defense.color" />
      </g>
      <ellipse v-if="defense.tier >= 4" cx="80" cy="73" rx="52" ry="19" fill="none" :stroke="defense.color" stroke-width="4" />
      <path v-if="defense.tier === 5" d="m80 12 9 18 20 3-15 14 4 20-18-10-18 10 4-20-15-14 20-3z" fill="var(--ui-color-neutral-100)" :stroke="defense.color" stroke-width="3" />
    </svg>
    <span class="preview-tier">Tier {{ defense.tier }}</span>
  </div>
</template>

<style scoped>
.defense-preview {
  position: relative;
  overflow: hidden;
  min-height: 10rem;
  border-radius: .9rem;
  background:
    radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--defense-color) 24%, transparent), transparent 44%),
    linear-gradient(155deg, color-mix(in srgb, var(--ui-bg-elevated) 92%, var(--defense-color)), var(--ui-bg));
}

svg { width: 100%; height: 100%; min-height: 10rem; }
.compact, .compact svg { min-height: 6rem; }
.preview-tier {
  position: absolute;
  right: .55rem;
  top: .55rem;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  padding: .15rem .45rem;
  background: color-mix(in srgb, var(--ui-bg) 86%, transparent);
  color: var(--ui-text-muted);
  font-size: .65rem;
  font-weight: 800;
}
</style>
