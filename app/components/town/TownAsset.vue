<script setup lang="ts">
import { townBuildingPortrait } from '~/utils/town/appearance'
import { townRenderedPortrait } from '~/utils/town/portrait'
import type { TownBuildingId } from '#shared/utils/gamelogic/town'

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

// Roads are drawn by the scene rather than modelled, so they have no artwork
// file and never will.
const EMOJI: Record<string, string> = { road: '🛣️' }
const emoji = computed(() => props.id ? EMOJI[props.id] : undefined)

/**
 * Buildings whose artwork has not been drawn yet. They are rendered from their
 * own 3D model instead of showing a glyph, so every entry in the build menu
 * looks like the same kind of thing. Drop a PNG in and this list goes away.
 */
const AWAITING_ARTWORK = new Set(['bathhouse', 'theatre'])

const src = computed(() => {
    if (!props.id) return undefined
    if (props.kind !== 'building') return `/town/resources/${props.id}.svg`
    if (!AWAITING_ARTWORK.has(props.id)) return townBuildingPortrait(props.id, props.level)
    return townRenderedPortrait(props.id as TownBuildingId, props.level) ?? undefined
})
</script>

<template>
    <span v-if="emoji" class="town-asset town-asset-emoji" :class="{ 'town-asset-building': kind === 'building' }" :title="label ?? id">{{ emoji }}</span>
    <img
        v-else-if="src"
        :src="src"
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
