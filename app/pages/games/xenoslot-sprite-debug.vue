<script setup lang="ts">
// Preview sheet for Xeno Slot's procedural artwork: every painted symbol,
// coin, collector and multiplier at reel size and small size, plus the
// motion-blur variant used while the reels spin.
import { loadXenoFonts, paintXenoArt, xenoMotionBlur, xenoArtDataUrl, type XenoArtId } from '~/utils/slots/xenoslot-art'

const ids: XenoArtId[] = [
  'ten', 'jack', 'queen', 'king', 'ace', 'bell', 'seven', 'diamond', 'wild', 'bonus',
  'coin-bronze', 'coin-silver', 'coin-gold', 'coin-xenium', 'ufo', 'ufo-on', 'core-2', 'core-5', 'core-10'
]
const big = ref<Record<string, string>>({})
const small = ref<Record<string, string>>({})
const blur = ref<Record<string, string>>({})

onMounted(async () => {
  await loadXenoFonts()
  for (const id of ids) {
    big.value[id] = xenoArtDataUrl(id, 256)
    small.value[id] = xenoArtDataUrl(id, 64)
    blur.value[id] = xenoMotionBlur(paintXenoArt(id, 256)).toDataURL()
  }
})
</script>

<template>
  <div class="xs-debug min-h-full p-6">
    <h1 class="mb-4 text-lg font-bold text-white">
      Xeno Slot artwork
    </h1>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
      <div v-for="id in ids" :key="id" class="flex flex-col items-center gap-2 rounded-xl bg-black/30 p-3">
        <img v-if="big[id]" :src="big[id]" :alt="id" class="size-32">
        <div class="flex items-center gap-2">
          <img v-if="small[id]" :src="small[id]" :alt="id" class="size-8">
          <img v-if="blur[id]" :src="blur[id]" :alt="`${id} blur`" class="size-12">
        </div>
        <code class="text-xs text-white/60">{{ id }}</code>
      </div>
    </div>
  </div>
</template>

<style scoped>
.xs-debug {
  font-family: 'Orbitron', sans-serif;
  background: radial-gradient(ellipse at 50% 20%, #2a1250, #0a0618 70%);
}

.xs-debug h1 {
  font-family: 'Audiowide', sans-serif;
}
</style>
