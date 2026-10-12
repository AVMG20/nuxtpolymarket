<script setup lang="ts">
/**
 * One titled block on a wiki page, with an optional formula strip under the prose.
 *
 * Exists so the five wiki pages cannot drift into five different heading treatments — the same
 * argument as `CollectionCard`, applied to a document instead of a grid.
 */
defineProps<{
    title: string
    /** A one-line framing under the heading, when the title alone is not enough. */
    lead?: string
    icon?: string
}>()
</script>

<template>
  <section class="space-y-3">
    <div class="flex items-baseline gap-2">
      <UIcon
        v-if="icon"
        :name="icon"
        class="size-4 text-primary shrink-0 translate-y-0.5"
      />
      <div class="min-w-0">
        <h2 class="text-base font-medium text-highlighted">
          {{ title }}
        </h2>
        <p
          v-if="lead"
          class="text-sm text-muted mt-0.5"
        >
          {{ lead }}
        </p>
      </div>
    </div>

    <div class="space-y-3 text-sm text-muted leading-relaxed">
      <slot />
    </div>
  </section>
</template>
