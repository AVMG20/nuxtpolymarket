<template>
    <div class="df-pause df-theme absolute inset-0 z-30 flex items-center justify-center p-4">
        <div class="sheet df-paper">
            <p class="df-eyebrow">Field desk · Sainte-Croix</p>
            <h2 class="df-h mt-1 text-3xl">{{ view === 'main' ? 'Stood down' : 'Settings' }}</h2>
            <p class="df-type mt-1 text-xs text-[var(--df-ink-2)]">The match keeps running while you're away.</p>

            <Transition name="df-page" mode="out-in">
                <div v-if="view === 'main'" key="main" class="mt-6 flex flex-col gap-3">
                    <DfButton tone="blood" size="lg" icon="play" block @click="emit('resume')">Back to the line</DfButton>
                    <DfButton tone="paper" size="lg" icon="gear" block @click="view = 'settings'">Settings</DfButton>
                    <DfButton tone="ghost" size="lg" icon="leave" block @click="emit('leave')">Leave the match</DfButton>
                </div>

                <div v-else key="settings" class="mt-6 flex flex-col gap-6">
                    <DfSettingsForm :settings="settings" @update:settings="emit('update:settings', $event)" />
                    <DfButton tone="paper" icon="back" block @click="view = 'main'">Back</DfButton>
                </div>
            </Transition>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { DfSettings } from '~/utils/dead-front/engine/settings'
import DfButton from '~/components/dead-front/ui/DfButton.vue'
import DfSettingsForm from '~/components/dead-front/ui/DfSettingsForm.vue'

defineProps<{ settings: DfSettings }>()
const emit = defineEmits<{
    'resume': []
    'leave': []
    'update:settings': [DfSettings]
}>()

const view = ref<'main' | 'settings'>('main')
</script>

<style scoped>
.df-pause {
    background:
        radial-gradient(60% 60% at 50% 45%, rgba(30, 20, 10, 0.3), rgba(0, 0, 0, 0.82) 80%),
        rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(3px) saturate(0.6);
    animation: df-fade 0.2s ease-out;
}

.sheet {
    width: 100%;
    max-width: 27rem;
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
    padding: 1.6rem 1.5rem 1.5rem;
    animation: df-sheet-in 0.3s cubic-bezier(0.2, 1.3, 0.4, 1);
}

.df-page-enter-active,
.df-page-leave-active {
    transition: opacity 0.15s, transform 0.15s steps(3);
}

.df-page-enter-from {
    opacity: 0;
    transform: translateX(12px);
}

.df-page-leave-to {
    opacity: 0;
    transform: translateX(-12px);
}

@keyframes df-fade {
    from { opacity: 0; }
}

@keyframes df-sheet-in {
    0% { opacity: 0; transform: translateY(18px); }
    100% { opacity: 1; transform: none; }
}
</style>
