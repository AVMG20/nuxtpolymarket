<script setup lang="ts">
// Rail Tycoon — one picture in a build picker: the scene drawn by the map's own tile rules.
import { RT_PICKER_H, RT_PICKER_W, rtDrawPickerScene, type RtPickerScene } from '~/utils/rail-tycoon/picker'

const props = defineProps<{ scene: RtPickerScene }>()

const canvas = ref<HTMLCanvasElement | null>(null)

async function draw() {
  if (!canvas.value) return
  try {
    await rtDrawPickerScene(canvas.value, props.scene)
  } catch {
    // the button's label still says what it is
  }
}

onMounted(draw)
watch(() => JSON.stringify(props.scene), draw)
</script>

<template>
  <canvas ref="canvas" class="rt-picker-picture" :width="RT_PICKER_W" :height="RT_PICKER_H" aria-hidden="true" />
</template>

<style scoped>
.rt-picker-picture {
  display: block;
  width: 68px;
  height: 64px;
  image-rendering: pixelated;
}
</style>
