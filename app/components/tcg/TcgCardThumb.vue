<script setup lang="ts">
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

const alt = computed(() => props.bundle ?? `${props.legacySet}/${props.assetNumber}`)
</script>

<template>
    <img
        :src="src"
        :alt="alt"
        loading="lazy"
        class="aspect-[0.718] w-full rounded object-cover"
    >
</template>
