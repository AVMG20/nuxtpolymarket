<script setup lang="ts">
// Rail Tycoon — the chooser's Join with an invite form: takes a bare code or a whole invite link.
// The chooser sends the join and puts a refusal in `error`; it may also fill in `code` (a failed
// invite from the cookie, kept for a retry).
import { isRtInviteCode } from '#shared/utils/rail-tycoon/limits'

const props = defineProps<{
  connected: boolean
  busy: boolean
  /** A join is waiting on the server. */
  joining: boolean
}>()

const emit = defineEmits<{
  join: [inviteCode: string]
}>()

const code = defineModel<string>('code', { required: true })
const error = defineModel<string | null>('error', { required: true })

/** What the player typed or pasted: a bare code or a whole invite link, uppercased. */
const input = computed(() => {
  const text = code.value.trim()
  const fromLink = /\/rail-tycoon\/invite\/([0-9a-z]+)\/?$/i.exec(text)
  return (fromLink ? fromLink[1]! : text).toUpperCase()
})
const canJoin = computed(() => props.connected && !props.busy && isRtInviteCode(input.value))

function join() {
  if (canJoin.value) emit('join', input.value)
}
</script>

<template>
  <form class="rtc-panel" aria-labelledby="rtc-join-h" @submit.prevent="join">
    <h2 id="rtc-join-h">Join with an invite</h2>
    <label class="rtc-field">
      <span>Invite link or code</span>
      <input
        v-model="code"
        type="text"
        class="rtc-input rtc-mono"
        data-field="invite-code"
        placeholder="Paste an invite link"
        autocomplete="off"
        spellcheck="false"
        @input="error = null"
      >
    </label>
    <p v-if="error" class="rtc-hint rtc-hint-bad" role="alert">{{ error }}</p>
    <button type="submit" class="rtc-btn rtc-btn-main rtc-btn-wide" data-action="join" :disabled="!canJoin">
      <UIcon :name="joining ? 'i-lucide-loader-circle' : 'i-lucide-log-in'" class="size-4" :class="{ 'animate-spin': joining }" />
      Join world
    </button>
  </form>
</template>
