<script setup lang="ts">
import type { AetherSymbol } from '#shared/utils/gamelogic/aethergates'
import { AG_ORB_TIERS, AG_SYMBOL_INFO, agSymbolDataUrl } from '~/utils/slots/aethergates-art'

// Preview sheet for the procedurally drawn Aether Gates art: every symbol
// and orb tier at reel size and large, on the board colour and on white.

definePageMeta({ title: 'Aether Gates symbols' })
useHead({
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Cinzel+Decorative:wght@700;900&display=swap' }
  ]
})

const ids = Object.keys(AG_SYMBOL_INFO) as AetherSymbol[]
const ready = ref(false)

onMounted(async () => {
  try {
    await Promise.race([document.fonts.load('900 40px Cinzel'), new Promise(r => setTimeout(r, 1500))])
  } catch { /* fall back to Georgia */ }
  ready.value = true
})
</script>

<template>
  <div class="ag-sheet min-h-full p-6">
    <h1 class="mb-6 text-2xl font-black text-[#fde68a]">
      Aether Gates symbols
    </h1>
    <div
      v-if="ready"
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
    >
      <figure
        v-for="id in ids"
        :key="id"
        class="flex flex-col items-center gap-2 rounded-xl border border-[#fcd34d33] bg-[#0d0a24] p-3"
      >
        <img
          :src="agSymbolDataUrl(id, 256)"
          :alt="AG_SYMBOL_INFO[id].name"
          class="size-32"
        >
        <div class="flex gap-2">
          <img
            :src="agSymbolDataUrl(id, 128)"
            alt=""
            class="size-12"
          >
          <img
            :src="agSymbolDataUrl(id, 128)"
            alt=""
            class="size-12 rounded bg-white"
          >
        </div>
        <figcaption class="text-sm font-bold text-[#fde68a]">
          {{ AG_SYMBOL_INFO[id].name }} <span class="text-xs text-[#a5b4fc]">({{ id }})</span>
        </figcaption>
      </figure>
      <figure
        v-for="(tier, i) in AG_ORB_TIERS"
        :key="tier.label"
        class="flex flex-col items-center gap-2 rounded-xl border border-[#fcd34d33] bg-[#0d0a24] p-3"
      >
        <img
          :src="agSymbolDataUrl(`orb-${i}`, 256)"
          :alt="tier.label"
          class="size-32"
        >
        <figcaption class="text-sm font-bold text-[#fde68a]">
          {{ tier.label }} orb · ×{{ tier.min }}+
        </figcaption>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.ag-sheet {
  background: radial-gradient(ellipse at top, #241552, #07061c 70%);
}
</style>
