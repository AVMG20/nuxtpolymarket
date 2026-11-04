<script setup lang="ts">
// Rail Tycoon — the chooser's drawing editor for one of the owner's worlds: draw, save, or remove
// the drawing. The chooser saves it; Escape or a click outside closes it unless a save is running.
import type { EmblemData } from '#shared/utils/emblem'
import type { RtWorldSummary } from '#shared/utils/rail-tycoon/protocol'

const props = defineProps<{
  world: RtWorldSummary
  /** The world's drawing now, or null for none. */
  current: string | null
  saving: boolean
}>()

const emit = defineEmits<{
  save: [value: EmblemData | null]
  close: []
}>()

const draft = ref<string | null>(props.current)

function close() {
  if (!props.saving) emit('close')
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div class="rtc-overlay" role="dialog" aria-label="World drawing" @click.self="close">
    <div class="rtc-notice rtc-avatar-editor">
      <h2>Drawing for {{ world.name }}</h2>
      <p>Everyone in the world sees it above its name, and so does the lobby when it is public.</p>
      <ProfileEmblemEditor
        :loading="saving"
        :model-value="draft"
        @save="emit('save', $event)"
        @update:model-value="draft = JSON.stringify($event)"
      />
      <div class="rtc-confirm-actions rtc-avatar-actions">
        <button
          v-if="current"
          type="button"
          class="rtc-btn rtc-btn-danger"
          data-action="clear-avatar"
          :disabled="saving"
          @click="emit('save', null)"
        >
          <UIcon name="i-lucide-eraser" class="size-4" /> Remove drawing
        </button>
        <button type="button" class="rtc-btn" :disabled="saving" @click="close">Close</button>
      </div>
    </div>
  </div>
</template>
