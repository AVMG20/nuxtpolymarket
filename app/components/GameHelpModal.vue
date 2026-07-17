<script setup lang="ts">
defineProps<{
  title: string
  ui?: { content?: string }
}>()

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="ui">
    <template #body>
      <ul class="text-sm text-muted space-y-2 list-disc list-inside">
        <slot />
      </ul>
    </template>
  </UModal>
</template>
