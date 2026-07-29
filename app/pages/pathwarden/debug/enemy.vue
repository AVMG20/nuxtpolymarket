<script setup lang="ts">
import DebugGallery from '~/components/pathwarden/DebugGallery.client.vue'
definePageMeta({ title: 'Pathwarden Enemy Gallery' })
</script>
<template><main class="mx-auto max-w-[1500px] px-4 py-6"><div class="mb-5 flex items-center justify-between"><div><p class="text-[10px] font-black uppercase tracking-[0.3em] text-error">Enemy gallery</p><h1 class="text-2xl font-black">Enemies</h1></div><UButton to="/pathwarden/debug" color="neutral" variant="soft">All galleries</UButton></div><ClientOnly><DebugGallery category="enemy" /></ClientOnly></main></template>
