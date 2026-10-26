<script setup lang="ts">
import { NAV_FOLDER_NAME_MAX } from '#shared/utils/nav-layout'

const { state, settle } = useNavFolderDialog()
const name = ref('')

watch(() => state.value.open, (open) => {
  if (open) name.value = state.value.name ?? ''
})

function onOpenChange(open: boolean) {
  if (!open && state.value.open) settle(null)
}

function submit() {
  settle(name.value.trim())
}
</script>

<template>
  <UModal
    :open="state.open"
    :title="state.title"
    :ui="{ content: 'max-w-sm' }"
    @update:open="onOpenChange"
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <UInput
          v-model="name"
          autofocus
          placeholder="Folder name"
          icon="i-lucide-folder"
          :maxlength="NAV_FOLDER_NAME_MAX"
          class="w-full"
        />
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="settle(null)" />
          <UButton type="submit" :label="state.confirmLabel ?? 'Save'" />
        </div>
      </form>
    </template>
  </UModal>
</template>
