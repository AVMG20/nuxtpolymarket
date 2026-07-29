<script setup lang="ts">
import { PathwardenEngine, type PathwardenGalleryCategory } from '~/utils/pathwarden-engine'
import { PATHWARDEN_SKINS } from '#shared/utils/gamelogic/pathwarden'

const props = defineProps<{ category: PathwardenGalleryCategory }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const selected = ref(0)
const defenseTier = ref(1)
const defenseSkin = ref('warden-stone')
const idleVariation = ref(0)
let engine: PathwardenEngine | null = null

const items: Record<PathwardenGalleryCategory, string[]> = {
  environment: ['Grassland', 'River crossing', 'Lake shore', 'Canyon', 'Forest road', 'Mountain pass', 'Road junction', 'Mist boundary'],
  scene: ['Farm', 'Pasture and farm', 'Mill', 'Inn', 'Keep'],
  defense: ['Ballista', 'Sun Mortar', 'Winter Spire', 'Ember Bastion', 'Storm Obelisk', 'Dawn Chapel'],
  enemy: ['Raider', 'Runner', 'Brute', 'Shaman', 'Boss'],
  idle: ['Market day', 'Lovers’ picnic', 'Hunter and deer', 'Travelling musician', 'Children at play', 'Shepherd’s crossing', 'Guard patrol', 'Peddler', 'Construction crew', 'Cat business', 'Bird life']
}

function select(index: number) {
  selected.value = index
}

watch(selected, (index) => {
  engine?.debugSetGallery(props.category, index)
})

watch([defenseTier, defenseSkin], () => {
  if (props.category === 'defense') engine?.debugSetDefenseGalleryOptions(defenseTier.value, defenseSkin.value)
})

watch(idleVariation, (variation) => {
  if (props.category === 'idle') engine?.debugSetIdleGalleryVariation(variation)
})

onMounted(() => {
  if (!canvas.value) return
  engine = new PathwardenEngine(canvas.value, {
    onState: () => {},
    onUpgrade: () => {},
    onAmbientStoryComplete: async () => {},
    onGameOver: async () => {}
  }, undefined, 1, 'warden-stone', undefined, true)
  engine.start()
  engine.debugSetGallery(props.category, selected.value)
  if (props.category === 'defense') engine.debugSetDefenseGalleryOptions(defenseTier.value, defenseSkin.value)
  if (props.category === 'idle') engine.debugSetIdleGalleryVariation(idleVariation.value)
})

onBeforeUnmount(() => engine?.destroy())
</script>

<template>
  <div class="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
    <aside class="space-y-1 rounded-xl border border-default bg-elevated/70 p-2">
      <div v-if="category === 'defense'" class="mb-3 space-y-2 border-b border-default px-1 pb-3">
        <label class="block text-[10px] font-black uppercase tracking-[0.16em] text-muted">Tier to render</label>
        <select v-model.number="defenseTier" class="w-full rounded-md border border-default bg-background px-2 py-1.5 text-sm text-default">
          <option v-for="tier in 5" :key="tier" :value="tier">Tier {{ tier }}</option>
        </select>
        <label class="block pt-1 text-[10px] font-black uppercase tracking-[0.16em] text-muted">Vanity skin</label>
        <select v-model="defenseSkin" class="w-full rounded-md border border-default bg-background px-2 py-1.5 text-sm text-default">
          <option v-for="skin in PATHWARDEN_SKINS" :key="skin.id" :value="skin.id">{{ skin.name }}</option>
        </select>
      </div>
      <div v-if="category === 'idle'" class="mb-3 space-y-2 border-b border-default px-1 pb-3">
        <label class="block text-[10px] font-black uppercase tracking-[0.16em] text-muted">Variation to render</label>
        <select v-model.number="idleVariation" class="w-full rounded-md border border-default bg-background px-2 py-1.5 text-sm text-default">
          <option v-for="variation in 5" :key="variation" :value="variation - 1">Variation {{ variation }}</option>
        </select>
      </div>
      <button
        v-for="(item, index) in items[category]"
        :key="item"
        class="w-full rounded-lg px-3 py-2 text-left text-sm transition"
        :class="selected === index ? 'bg-primary text-inverted shadow-lg' : 'text-muted hover:bg-background hover:text-default'"
        @click="select(index)"
      >
        {{ String(index + 1).padStart(2, '0') }} · {{ item }}
      </button>
    </aside>
    <div class="min-w-0 rounded-2xl border border-primary/30 bg-elevated p-3 shadow-2xl">
      <canvas ref="canvas" class="block aspect-[30/19] w-full rounded-xl bg-slate-800" aria-label="Pathwarden debug gallery canvas" />
      <div class="mt-3 flex items-center justify-between text-xs text-muted">
        <span>Live Pathwarden renderer · {{ items[category][selected] }}</span>
        <span>Use the list to switch</span>
      </div>
    </div>
  </div>
</template>
