<script setup lang="ts">
import { CarGallery } from '~/utils/nitro-rush/car-gallery'
import { CARS, findPaint, PAINTS, type CarId, type PaintId } from '~/utils/nitro-rush/config'

/** The paint and the cars to pick from, each car turning slowly in that paint. */
const props = defineProps<{
    car: CarId
    paint: PaintId
}>()
const emit = defineEmits<{ select: [id: CarId], paint: [id: PaintId], open: [open: boolean] }>()

const paintLabel = computed(() => findPaint(props.paint).label)

const stages = new Map<CarId, HTMLCanvasElement>()
/** Cars the gallery has built and compiled; the rest show a placeholder. */
const ready = reactive(new Set<CarId>())
let gallery: CarGallery | null = null

onMounted(() => {
    emit('open', true)
    gallery = new CarGallery(findPaint(props.paint).color, id => ready.add(id))
    for (const c of CARS) {
        const stage = stages.get(c.id)
        if (stage) gallery.add(c.id, stage)
    }
})

watch(() => props.paint, id => gallery?.setPaint(findPaint(id).color))

onBeforeUnmount(() => {
    gallery?.dispose()
    gallery = null
    emit('open', false)
})
</script>

<template>
  <div>
    <!-- Above the cars: it applies to all of them, and stays in reach as the list of cars grows. -->
    <section>
      <div class="mb-1.5 flex items-baseline justify-between gap-3">
        <h3 class="nr-group">PAINT</h3>
        <span class="nr-blurb">{{ paintLabel }}</span>
      </div>
      <div class="nr-paints">
        <button
          v-for="p in PAINTS"
          :key="p.id"
          class="nr-swatch"
          :class="{ 'is-active': paint === p.id }"
          :style="{ '--swatch': `#${p.color.toString(16).padStart(6, '0')}` }"
          :aria-label="p.label"
          :aria-pressed="paint === p.id"
          :title="p.label"
          @click="$emit('paint', p.id)"
        />
      </div>
    </section>
    <section class="mt-5">
      <h3 class="nr-group mb-1.5">CAR</h3>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        <button
          v-for="c in CARS"
          :key="c.id"
          class="nr-track nr-car"
          :class="{ 'is-active': car === c.id }"
          :aria-pressed="car === c.id"
          @click="$emit('select', c.id)"
        >
          <canvas :ref="el => { if (el) stages.set(c.id, el as HTMLCanvasElement) }" class="nr-car-stage" :class="{ 'is-loading': !ready.has(c.id) }" aria-hidden="true" />
          <span class="nr-track-name">{{ c.label }}</span>
        </button>
      </div>
    </section>
  </div>
</template>
