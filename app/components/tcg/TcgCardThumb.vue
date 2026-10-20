<script setup lang="ts">
import { isLandscapeBundle } from '#shared/utils/tcg/landscape'

const props = defineProps<{
    bundle?: string | null
    /** Legacy scan folder ('base1') — takes precedence over bundle. */
    legacySet?: string | null
    assetNumber?: string | null
}>()

const src = computed(() => {
    const base = (useRuntimeConfig().public as { pokemonApiBase?: string }).pokemonApiBase
        ?? 'http://127.0.0.1:8080'
    return props.legacySet
        ? `${base}/images/legacy/${props.legacySet}/${props.assetNumber}.png`
        : `${base}/images/cards/${props.bundle}.png`
})

// LEGEND and BREAK faces are drawn sideways; they keep the portrait slot and
// lie down inside it — the card turned a quarter clockwise, as wide as the
// slot, so 71.8% of its width before turning.
const landscape = computed(() => !props.legacySet && isLandscapeBundle(props.bundle))

const alt = computed(() => props.bundle ?? `${props.legacySet}/${props.assetNumber}`)
</script>

<template>
    <div v-if="landscape" class="relative aspect-[0.718] w-full">
        <img
            :src="src"
            :alt="alt"
            loading="lazy"
            class="absolute top-1/2 left-1/2 aspect-[0.718] w-[71.8%] -translate-1/2 rotate-90 rounded object-cover"
        >
    </div>
    <img
        v-else
        :src="src"
        :alt="alt"
        loading="lazy"
        class="aspect-[0.718] w-full rounded object-cover"
    >
</template>
