<script setup lang="ts">
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

// Roads are drawn by the scene rather than modelled, so they have no portrait.
const EMOJI: Record<string, string> = { road: '🛣️' }
const emoji = computed(() => props.id ? EMOJI[props.id] : undefined)

// Building portraits are rendered from the same 3D model the map uses, once
// per look, so a menu icon can never drift from the building it stands for.
const src = computed(() => {
    if (!props.id) return undefined
    if (props.kind !== 'building') return `/town/resources/${props.id}.svg`
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
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 12%));
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
