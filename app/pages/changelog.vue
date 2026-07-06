<script setup lang="ts">
definePageMeta({
    title: 'Changelog'
})

const PAGE_SIZE = 5

const { data: entries } = await useAsyncData('changelog', () => $fetch('/api/changelog'))

const visibleCount = ref(PAGE_SIZE)
const visibleEntries = computed(() => entries.value?.slice(0, visibleCount.value) ?? [])
const hasMore = computed(() => visibleCount.value < (entries.value?.length ?? 0))

function loadMore() {
    visibleCount.value += PAGE_SIZE
}

function formatDate(date: string) {
    return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
</script>

<template>
  <div class="p-6 max-w-3xl mx-auto">
    <div class="mb-8">
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-scroll-text" class="size-6 text-primary" />
        Changelog
      </h1>
      <p class="text-sm text-muted mt-0.5">Whats new on Polynux</p>
    </div>

    <div v-if="visibleEntries.length" class="space-y-6">
      <UCard v-for="entry in visibleEntries" :key="entry.title + entry.date">
        <template #header>
          <h2 class="text-lg font-bold">{{ entry.title }}</h2>
          <p class="text-xs text-muted mt-0.5">{{ formatDate(entry.date) }}</p>
        </template>

        <div class="changelog-body" v-html="entry.html" />
      </UCard>

      <div v-if="hasMore" class="flex justify-center pt-2">
        <UButton
            color="neutral"
            icon="i-lucide-chevron-down"
            label="Load more"
            variant="soft"
            @click="loadMore"
        />
      </div>
    </div>

    <UEmpty
        v-else
        description="No changelog entries yet"
        icon="i-lucide-scroll-text"
    />
  </div>
</template>

<style scoped>
.changelog-body :deep(p) {
    margin-bottom: 0.75rem;
}

.changelog-body :deep(p:last-child) {
    margin-bottom: 0;
}

.changelog-body :deep(a) {
    color: var(--ui-primary);
    text-decoration: underline;
}

.changelog-body :deep(strong) {
    font-weight: 600;
}

.changelog-body :deep(ul),
.changelog-body :deep(ol) {
    margin: 0.75rem 0;
    padding-left: 1.25rem;
}

.changelog-body :deep(ul) {
    list-style-type: disc;
}

.changelog-body :deep(ol) {
    list-style-type: decimal;
}
</style>
