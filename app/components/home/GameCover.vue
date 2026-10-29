<script setup lang="ts">
import { navSlug } from '#shared/utils/nav-catalog'

const props = defineProps<{
  to: string
  icon: string
}>()

const slug = computed(() => navSlug(props.to))
const src = computed(() => `/images/games/${slug.value}.jpg`)

// A steady colour per game for the fallback art
const hue = computed(() => {
  let h = 0
  for (const ch of slug.value) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
})

const loaded = ref(false)
const failed = ref(false)
const img = ref<HTMLImageElement | null>(null)

// An image that settled before hydration never fires its events here
onMounted(() => {
  const el = img.value
  if (!el?.complete) return
  if (el.naturalWidth > 0) loaded.value = true
  else failed.value = true
})

watch(src, () => {
  loaded.value = false
  failed.value = false
})
</script>

<template>
  <div class="relative isolate overflow-hidden">
    <div
      class="absolute inset-0 -z-10"
      :style="{
        background: `radial-gradient(120% 90% at 85% 10%, hsl(${hue} 70% 32% / .9), transparent 60%), radial-gradient(90% 80% at 0% 100%, hsl(${(hue + 50) % 360} 65% 22%), transparent 70%), hsl(${hue} 35% 9%)`
      }"
    >
      <div class="absolute inset-0 opacity-[.07] [background-image:radial-gradient(circle,white_1px,transparent_1px)] [background-size:14px_14px]" />
      <UIcon
        :name="icon"
        class="absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6"
        :style="{ color: `hsl(${hue} 85% 72%)`, filter: `drop-shadow(0 0 18px hsl(${hue} 90% 60% / .55))` }"
      />
    </div>
    <img
      v-if="!failed"
      ref="img"
      :src="src"
      alt=""
      loading="lazy"
      decoding="async"
      draggable="false"
      class="absolute inset-0 size-full object-cover transition-[opacity,transform] duration-500 group-hover:scale-105"
      :class="loaded ? 'opacity-100' : 'opacity-0'"
      @load="loaded = true"
      @error="failed = true"
    >
    <slot />
  </div>
</template>
