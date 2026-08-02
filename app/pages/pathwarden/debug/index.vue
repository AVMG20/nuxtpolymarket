<script setup lang="ts">
definePageMeta({ title: 'Pathwarden Debug Galleries' })
const allowed = import.meta.dev
if (!allowed) await navigateTo('/pathwarden')

const galleries = [
  { label: 'Relic swapping', to: '/pathwarden/debug/relics', icon: 'i-lucide-wand-sparkles' },
  { label: 'Environment', to: '/pathwarden/debug/environment', icon: 'i-lucide-mountain' },
  { label: 'Scene buildings', to: '/pathwarden/debug/scene', icon: 'i-lucide-home' },
  { label: 'Defensive buildings', to: '/pathwarden/debug/defense', icon: 'i-lucide-shield' },
  { label: 'Enemies', to: '/pathwarden/debug/enemy', icon: 'i-lucide-skull' },
  { label: 'Idle animations', to: '/pathwarden/debug/idle', icon: 'i-lucide-users-round' }
]
</script>

<template>
  <main v-if="allowed" class="mx-auto max-w-5xl px-4 py-8">
    <p class="text-[10px] font-black uppercase tracking-[0.3em] text-error">Development only</p>
    <div class="mt-1 flex flex-wrap items-end justify-between gap-3">
      <div><h1 class="text-3xl font-black">Pathwarden debug galleries</h1><p class="mt-1 text-sm text-muted">Each category uses a dedicated canvas and the live game renderer.</p></div>
      <UButton to="/pathwarden" color="neutral" variant="soft" icon="i-lucide-arrow-left">Return to game</UButton>
    </div>
    <div class="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink v-for="gallery in galleries" :key="gallery.to" :to="gallery.to" class="rounded-xl border border-default bg-elevated p-5 transition hover:-translate-y-1 hover:border-primary hover:shadow-xl">
        <UIcon :name="gallery.icon" class="size-8 text-primary" /><h2 class="mt-4 font-black">{{ gallery.label }}</h2><p class="mt-1 text-xs text-muted">Open selectable live canvas gallery</p>
      </NuxtLink>
    </div>
  </main>
</template>
