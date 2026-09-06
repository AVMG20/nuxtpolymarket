<script setup lang="ts">
import { townBuildingPortrait } from '~/utils/town/appearance'
const props = withDefaults(defineProps<{
    id: string | undefined
    kind?: 'resource' | 'building'
    label?: string
    level?: number
}>(), {
    kind: 'resource',
    level: 1,
    label: undefined
})

// Buildings drawn by the scene rather than modelled have no artwork file;
// they fall back to a glyph instead of a broken image.
const EMOJI: Record<string, string> = { road: '🛣️' }
const emoji = computed(() => props.id ? EMOJI[props.id] : undefined)
</script>

<template>
    <span v-if="emoji" class="town-asset town-asset-emoji" :class="{ 'town-asset-building': kind === 'building' }" :title="label ?? id">{{ emoji }}</span>
    <img
        v-else-if="id"
        :src="kind === 'building' ? townBuildingPortrait(id, level) : `/town/resources/${id}.svg`"
        :alt="label ?? id"
        class="town-asset"
        :class="{ 'town-asset-building': kind === 'building' }"
        draggable="false"
        width="64"
        height="64"
    >
</template>

<style scoped>
.town-asset {
    display: inline-block;
    width: 1.5em;
    height: 1.5em;
    flex-shrink: 0;
    object-fit: contain;
    vertical-align: middle;
    filter: drop-shadow(0 2px 2px rgb(0 0 0 / 18%));
}
.town-asset-building {
    width: 1.8em;
    height: 1.8em;
}
.town-asset-emoji {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1em;
    line-height: 1;
    filter: none;
}
</style>
