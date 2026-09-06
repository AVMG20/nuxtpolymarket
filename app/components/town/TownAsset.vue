<script setup lang="ts">
withDefaults(defineProps<{
    id: string | undefined
    kind?: 'resource' | 'building'
    label?: string
}>(), {
    kind: 'resource',
    label: undefined
})
</script>

<template>
    <img
        v-if="id"
        :src="`/town/${kind === 'building' ? 'buildings' : 'resources'}/${id}.${kind === 'building' ? 'png' : 'svg'}`"
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
</style>
