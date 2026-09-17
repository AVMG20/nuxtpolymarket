<script setup lang="ts">
import { useLiveTableSound } from '~/composables/live-table-sound'

const { soundEnabled, soundVolume, bgEnabled, bgVolume } = useLiveTableSound()
</script>

<template>
    <div class="flex items-center gap-3 rounded-lg border border-default bg-elevated px-2.5 py-1.5 text-xs">
        <div class="flex items-center gap-1.5">
            <UButton
                :icon="soundEnabled ? 'i-lucide-volume-2' : 'i-lucide-volume-x'"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="soundEnabled ? 'Mute SFX' : 'Unmute SFX'"
                @click="soundEnabled = !soundEnabled; void 0"
            />
            <span class="hidden text-muted sm:inline">SFX</span>
            <USlider
                v-model="soundVolume"
                :min="0"
                :max="100"
                :disabled="!soundEnabled"
                size="xs"
                class="w-16 sm:w-24"
                aria-label="SFX volume"
            />
            <span class="w-7 text-right font-mono text-[11px] text-muted">{{ soundVolume }}%</span>
        </div>
        <div class="h-4 w-px bg-default" />
        <div class="flex items-center gap-1.5">
            <UButton
                :icon="bgEnabled ? 'i-lucide-music' : 'i-lucide-music-off'"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="bgEnabled ? 'Mute ambience' : 'Unmute ambience'"
                @click="bgEnabled = !bgEnabled; void 0"
            />
            <span class="hidden text-muted sm:inline">Ambient</span>
            <USlider
                v-model="bgVolume"
                :min="0"
                :max="100"
                :disabled="!bgEnabled"
                size="xs"
                class="w-16 sm:w-24"
                aria-label="Ambient volume"
            />
            <span class="w-7 text-right font-mono text-[11px] text-muted">{{ bgVolume }}%</span>
        </div>
    </div>
</template>
