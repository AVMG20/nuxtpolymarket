<script setup lang="ts">
// Named for what actually turned out to be the shared modal: none of the six
// slots have a buy-bonus confirmation dialog (buy bonus fires the spin
// directly on click, in every game that has it). The modal every slot does
// share is this auto-spin count picker. See the migration report for detail.
defineProps<{
  options: number[]
}>()

const emit = defineEmits<{ pick: [count: number] }>()

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <UModal v-model:open="open" title="Auto Spin">
    <template #body>
      <div class="space-y-4">
        <slot name="description" />
        <div class="grid grid-cols-5 gap-2">
          <UButton
            v-for="count in options"
            :key="count"
            block
            color="neutral"
            variant="soft"
            @click="emit('pick', count)"
          >
            {{ count }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
