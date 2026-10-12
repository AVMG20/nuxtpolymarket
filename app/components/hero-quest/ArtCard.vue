<script setup lang="ts">
import type { ArtAsset } from '~/utils/hero-quest-art/catalog'
import { registerCard, downloadStrip } from '~/utils/hero-quest-art/gallery'

/** One asset, animated in place at an integer scale chosen from its size. */
const props = defineProps<{ asset: ArtAsset }>()

const canvas = ref<HTMLCanvasElement | null>(null)
const scale = computed(() => {
  const w = props.asset.w
  return w <= 32 ? 4 : w <= 96 ? 3 : w <= 170 ? 2 : 1
})
let release: (() => void) | null = null

onMounted(() => { release = registerCard(canvas.value!, props.asset) })
onBeforeUnmount(() => release?.())
</script>

<template>
  <div class="rounded-md border border-default bg-default/60 p-2 flex flex-col gap-1.5 min-w-0">
    <div
      class="flex items-center justify-center rounded-sm overflow-hidden"
      :class="asset.opaque ? '' : 'bg-elevated'"
    >
      <canvas
        ref="canvas"
        class="block max-w-full h-auto"
        :style="{ width: `${asset.w * scale}px`, aspectRatio: `${asset.w} / ${asset.h}`, imageRendering: 'pixelated' }"
      />
    </div>
    <div class="flex items-start gap-1">
      <div class="min-w-0 flex-1">
        <p class="text-xs text-highlighted leading-snug">
          {{ asset.label }}
        </p>
        <p class="text-[10px] text-muted font-mono truncate">
          {{ asset.id }} · {{ asset.frames }}f
        </p>
      </div>
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-lucide-download"
        aria-label="Download PNG strip"
        @click="downloadStrip(asset)"
      />
    </div>
  </div>
</template>
