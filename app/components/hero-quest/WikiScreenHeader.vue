<script setup lang="ts">
/**
 * The top of a screen article: its name, what it is for, where its menu button is and when it
 * opens. The last two are read from `HQ_SCREEN_DOCS` and `FEATURE_UNLOCKS`, so every article
 * states them the same way and none can fall behind the unlock schedule.
 */
const props = defineProps<{
    id: HqScreenId
}>()

const doc = computed(() => HQ_SCREEN_DOCS.find(screen => screen.id === props.id)!)
</script>

<template>
  <div class="space-y-3">
    <div class="space-y-2">
      <h1 class="text-xl font-semibold text-highlighted">
        {{ doc.label }}
      </h1>
      <p class="text-sm text-muted">
        {{ doc.summary }}
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <UBadge
        color="neutral"
        variant="subtle"
        icon="i-lucide-lock-open"
      >
        {{ hqScreenUnlockText(id) }}
      </UBadge>
      <UBadge
        color="neutral"
        variant="subtle"
        icon="i-lucide-mouse-pointer-click"
      >
        Menu button: {{ doc.button }}
      </UBadge>
    </div>
  </div>
</template>
