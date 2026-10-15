<script setup lang="ts">
/**
 * The screens: one article per menu scene (issue #28), with a row of links to all of them in the
 * menu band's own order. The list is `HQ_SCREEN_DOCS`, so a new scene needs an article before it
 * can appear here.
 */
const route = useRoute()

const links = computed(() => [
    { label: 'Overview', to: '/hero-quest/wiki/screens', icon: 'i-lucide-layout-grid' },
    ...HQ_SCREEN_DOCS.map(screen => ({ label: screen.label, to: hqScreenWikiPath(screen.id), icon: screen.icon }))
])
</script>

<template>
  <div>
    <div class="px-4 sm:px-6 pt-3">
      <div class="max-w-3xl mx-auto flex flex-wrap gap-1">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="flex items-center gap-1 px-2 py-1 text-[0.6875rem] font-medium rounded-md transition-colors"
          :class="route.path === link.to
            ? 'bg-elevated text-highlighted'
            : 'text-muted hover:text-default'"
        >
          <UIcon
            :name="link.icon"
            class="size-3"
          />
          {{ link.label }}
        </NuxtLink>
      </div>
    </div>

    <NuxtPage />
  </div>
</template>
