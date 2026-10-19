<template>
    <div class="df-pause df-theme absolute inset-0 z-30 flex items-center justify-center p-4">
        <div class="sheet df-paper">
            <p class="df-eyebrow">Field desk · Sainte-Croix</p>
            <div v-if="view === 'main' && solo" class="df-paused mt-2" aria-live="polite">
                <span class="df-paused-bars" aria-hidden="true"><i /><i /></span>
                <h2 class="df-h text-4xl">Paused</h2>
            </div>
            <h2 v-else class="df-h mt-1 text-3xl">{{ view === 'main' ? 'Stood down' : 'Settings' }}</h2>
            <p class="df-type mt-1 text-xs text-[var(--df-ink-2)]">
                {{ solo ? 'The match is paused. The dead will wait for you.' : 'The match keeps running while you\'re away.' }}
            </p>

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

withDefaults(defineProps<{ settings: DfSettings, solo?: boolean }>(), { solo: false })
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

.df-paused {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.df-paused-bars {
    display: inline-flex;
    gap: 0.3rem;
    animation: df-paused-blink 1.6s steps(2, jump-none) infinite;
}

.df-paused-bars i {
    display: block;
    width: 0.45rem;
    height: 1.9rem;
    background: var(--df-blood, #8f1d14);
    box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.35);
}

@keyframes df-paused-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
    .df-paused-bars {
        animation: none;
    }
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
