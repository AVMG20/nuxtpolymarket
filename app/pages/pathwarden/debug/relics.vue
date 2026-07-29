<script setup lang="ts">
import RelicSwapDebug from '~/components/pathwarden/RelicSwapDebug.client.vue'

definePageMeta({ title: 'Pathwarden Relic Swap Debug' })
const allowed = import.meta.dev
if (!allowed) await navigateTo('/pathwarden')
</script>

<template>
  <main v-if="allowed" class="mx-auto max-w-6xl px-4 py-8">
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-[10px] font-black uppercase tracking-[0.3em] text-error">Development only</p>
        <h1 class="mt-1 text-3xl font-black">Relic swap debug</h1>
        <p class="mt-1 text-sm text-muted">Compare same-type rebinding, same-element different effects, different elements, stack preservation risk, tower levels, and Arcanist upgrades.</p>
      </div>
      <UButton to="/pathwarden/debug" color="neutral" variant="soft" icon="i-lucide-arrow-left">All debug galleries</UButton>
    </div>
    <RelicSwapDebug />
  </main>
</template>
