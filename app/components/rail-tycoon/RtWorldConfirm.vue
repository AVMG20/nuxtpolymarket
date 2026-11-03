<script setup lang="ts">
// Rail Tycoon — the chooser's in-app confirmation under a world row: Stop asks once, Delete wants the
// world's name typed. Browser dialogs would block automation and look foreign.
const props = defineProps<{
  kind: 'stop' | 'delete'
  name: string
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const typed = ref('')
const matches = computed(() => props.kind === 'stop' || typed.value === props.name)

function confirm() {
  if (matches.value) emit('confirm')
}
</script>

<template>
  <div class="rtc-confirm" role="alertdialog" :aria-label="kind === 'stop' ? 'Stop world' : 'Delete world'">
    <template v-if="kind === 'stop'">
      <p>Stop <b>{{ name }}</b>? It closes for everyone: nobody can build or join, and it stays open to watch.</p>
      <div class="rtc-confirm-actions">
        <button type="button" class="rtc-btn rtc-btn-danger" data-action="confirm-stop" @click="confirm">Stop the world</button>
        <button type="button" class="rtc-btn" @click="emit('cancel')">Cancel</button>
      </div>
    </template>
    <template v-else>
      <p>Delete <b>{{ name }}</b> for good? Every company in it is lost. Type the world's name to confirm.</p>
      <input
        v-model="typed"
        type="text"
        class="rtc-input"
        data-field="delete-name"
        :placeholder="name"
        autocomplete="off"
        @keydown.enter="confirm"
      >
      <div class="rtc-confirm-actions">
        <button type="button" class="rtc-btn rtc-btn-danger" data-action="confirm-delete" :disabled="!matches" @click="confirm">
          Delete the world
        </button>
        <button type="button" class="rtc-btn" @click="emit('cancel')">Cancel</button>
      </div>
    </template>
  </div>
</template>
