<script setup lang="ts">
defineProps<{
  icon: string
  kicker: string
  title: string
  subtitle?: string
}>()
</script>

<template>
  <header class="flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-3">
      <div class="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
        <UIcon :name="icon" class="size-6" />
      </div>
      <div class="min-w-0">
        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
          {{ kicker }}
        </p>
        <h1 class="text-xl font-bold leading-tight">
          {{ title }}
        </h1>
        <p v-if="subtitle" class="mt-0.5 text-sm text-muted">
          {{ subtitle }}
        </p>
      </div>
    </div>
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-2">
      <slot />
    </div>
  </header>
</template>
