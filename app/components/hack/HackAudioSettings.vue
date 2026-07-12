<script setup lang="ts">
// Voice/SFX/Music mute + volume, persisted per PLAN.md §5.2/§9. Lives in the
// HackOps tab bar — the global sidebar owns the theme switcher, not this.
const audio = useAudio('hack')

const audioEnabled = computed({
  get: () => !audio.masterMuted.value,
  set: (v: boolean) => { audio.masterMuted.value = !v }
})

const channelMeta = [
  { key: 'voice' as const, label: 'Voice', icon: 'i-lucide-mic' },
  { key: 'sfx' as const, label: 'SFX', icon: 'i-lucide-volume-2' },
  { key: 'music' as const, label: 'Music', icon: 'i-lucide-music' }
]

// reactive() so nested computed refs auto-unwrap on template access — same
// pattern useAudio() itself uses for `channels`, needed for v-model to bind
// to a per-key computed rather than the ref object itself.
const channelEnabled = reactive({
  voice: computed({ get: () => !audio.channels.voice.muted, set: (v: boolean) => { audio.channels.voice.muted = !v } }),
  sfx: computed({ get: () => !audio.channels.sfx.muted, set: (v: boolean) => { audio.channels.sfx.muted = !v } }),
  music: computed({ get: () => !audio.channels.music.muted, set: (v: boolean) => { audio.channels.music.muted = !v } })
})
</script>

<template>
  <UPopover>
    <UButton
      size="sm"
      color="neutral"
      variant="ghost"
      :icon="audioEnabled ? 'i-lucide-volume-2' : 'i-lucide-volume-x'"
    />
    <template #content>
      <div class="p-3.5 w-64 space-y-3.5">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold">Audio</span>
          <USwitch v-model="audioEnabled" />
        </div>

        <div
          v-for="ch in channelMeta"
          :key="ch.key"
          class="space-y-1.5"
          :class="!audioEnabled && 'opacity-40'"
        >
          <div class="flex items-center justify-between text-sm">
            <span class="flex items-center gap-1.5 text-muted">
              <UIcon
                :name="ch.icon"
                class="size-3.5"
              />{{ ch.label }}
            </span>
            <USwitch
              v-model="channelEnabled[ch.key]"
              :disabled="!audioEnabled"
            />
          </div>
          <USlider
            v-model="audio.channels[ch.key].volume"
            :min="0"
            :max="1"
            :step="0.05"
            :disabled="!audioEnabled || audio.channels[ch.key].muted"
          />
        </div>
      </div>
    </template>
  </UPopover>
</template>
