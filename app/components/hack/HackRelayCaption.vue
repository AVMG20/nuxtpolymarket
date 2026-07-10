<script setup lang="ts">
import { stripDeliveryTags, type VoiceHandle } from '~/composables/useAudio'

// RELAY's teletyped caption, synced to a voice clip via useAudio. Captions
// always run to completion regardless of whether the clip is muted, missing
// (no VO recorded yet), or blocked by autoplay policy — audio is enhancement,
// captions are not optional. See PLAN.md §5.2/§5.3.
const props = withDefaults(defineProps<{
  /** Clip name under public/hack/sound/voice/, without extension. */
  voiceName: string
  text: string
  autoplay?: boolean
  /** Beat before playback starts (your ask: ~200-400ms so it "pops" after the surface appears). */
  delayMs?: number
  /** Skip audio + teletype entirely and show the full stripped text at once —
   * for a repeat view of a one-shot line already heard this session. Wins
   * over `autoplay` when both are set. */
  instant?: boolean
}>(), {
  autoplay: true,
  delayMs: 300,
  instant: false
})

const emit = defineEmits<{ ended: [] }>()

const audio = useAudio('hack')
const caption = ref('')
// playVoice strips bracket delivery tags (TTS-only) before teletyping, so the
// caption's final length can be shorter than props.text — track completion via
// the onEnd callback instead of comparing against the raw prop length.
const done = ref(false)
let handle: VoiceHandle | null = null

function play() {
  handle?.cancel()
  caption.value = ''
  done.value = false
  handle = audio.playVoice(props.voiceName, {
    captionsRef: caption,
    text: props.text,
    delayMs: props.delayMs,
    onEnd: () => {
      done.value = true
      emit('ended')
    }
  })
}

function showInstant() {
  handle?.cancel()
  done.value = true
  caption.value = stripDeliveryTags(props.text)
  emit('ended')
}

watch(() => [props.voiceName, props.text, props.instant], () => {
  if (props.instant) showInstant()
  else if (props.autoplay) play()
}, { immediate: true })

function stop() {
  handle?.cancel()
  done.value = true
}

onUnmounted(() => handle?.cancel())

defineExpose({ play, stop, showInstant })
</script>

<template>
  <p class="hack-captions">
    {{ caption }}<span
      v-if="!done"
      class="hack-cursor"
    />
  </p>
</template>
