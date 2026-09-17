<script setup lang="ts">
const softStudio = useSoftStudio()

useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [{ rel: 'icon', href: '/favicon.ico' }],
  htmlAttrs: {
    lang: 'en',
    'data-theme-style': () => softStudio.value ? 'soft-studio' : undefined
  }
})

useSeoMeta({
  title: 'Polynux',
  description: 'Your game hub'
})
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator color="var(--ui-primary)" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
