<script setup lang="ts">
import type { GhostToggles } from '~/utils/nitro-rush/types'

defineProps<{ musicOn: boolean, sfxOn: boolean, ghosts: GhostToggles, isFullscreen: boolean }>()
defineEmits<{ music: [], sfx: [], ghost: [kind: keyof GhostToggles], fullscreen: [] }>()

const GHOST_KINDS: readonly { id: keyof GhostToggles, label: string }[] = [
    { id: 'best', label: 'My best lap' },
    { id: 'record', label: 'Track record' },
    { id: 'live', label: 'Live racers' }
]
const ghostMenu = ref(false)
</script>

<template>
  <div class="absolute right-3 top-3 flex gap-1.5 sm:right-5 sm:top-5">
    <button class="nr-icon-btn" :aria-label="musicOn ? 'Mute music' : 'Unmute music'" @click="$emit('music')">
      <UIcon :name="musicOn ? 'i-lucide-music' : 'i-lucide-music-2'" class="size-4" :class="{ 'opacity-40': !musicOn }" />
    </button>
    <button class="nr-icon-btn" :aria-label="sfxOn ? 'Mute sound' : 'Unmute sound'" @click="$emit('sfx')">
      <UIcon :name="sfxOn ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" class="size-4" />
    </button>
    <div class="relative">
      <button class="nr-icon-btn" aria-label="Ghosts" title="Ghosts" :aria-expanded="ghostMenu" @click="ghostMenu = !ghostMenu">
        <UIcon name="i-lucide-ghost" class="size-4" :class="{ 'opacity-40': !ghosts.best && !ghosts.record && !ghosts.live }" />
      </button>
      <div v-if="ghostMenu" class="nr-menu">
        <button
          v-for="k in GHOST_KINDS"
          :key="k.id"
          class="nr-menu-item"
          role="menuitemcheckbox"
          :aria-checked="ghosts[k.id]"
          @click="$emit('ghost', k.id)"
        >
          <UIcon :name="ghosts[k.id] ? 'i-lucide-square-check' : 'i-lucide-square'" class="size-4 shrink-0" />
          {{ k.label }}
        </button>
      </div>
    </div>
    <button class="nr-icon-btn" aria-label="Fullscreen" @click="$emit('fullscreen')">
      <UIcon :name="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'" class="size-4" />
    </button>
  </div>
</template>
