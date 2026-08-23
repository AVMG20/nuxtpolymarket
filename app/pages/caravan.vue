<script setup lang="ts">
import { TIERS } from '#shared/utils/caravan/config'
import { tierProgress } from '#shared/utils/caravan/state'

/**
 * Shell for the caravan game: the top bar with tier, coins and the live larder,
 * plus the nav between the map and the management screens. Every child page
 * shares one state snapshot through useCaravan().
 */

definePageMeta({ layout: 'default' })
useHead({ title: 'Caravan' })

const { state, load, truncated, sound } = useCaravan()
const tier = computed(() => TIERS[(state.value?.tier ?? 1) - 1] ?? TIERS[0]!)
const progress = computed(() => (state.value ? tierProgress(state.value) : null))

const links = [
    { label: 'Map', to: '/caravan', icon: 'i-lucide-map' },
    { label: 'Workers', to: '/caravan/workers', icon: 'i-lucide-users' },
    { label: 'Market', to: '/caravan/market', icon: 'i-lucide-handshake' },
    { label: 'Refinery', to: '/caravan/refinery', icon: 'i-lucide-flame' },
    { label: 'Workshop', to: '/caravan/workshop', icon: 'i-lucide-hammer' },
    { label: 'Research', to: '/caravan/research', icon: 'i-lucide-flask-conical' }
]

onMounted(() => { void load() })
</script>

<template>
    <div class="caravan-shell flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
        <header class="relative z-20 flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-default/60 bg-elevated/40 px-4 py-2.5 backdrop-blur">
            <div class="flex items-center gap-3">
                <div
                    class="grid size-9 place-items-center rounded-lg border"
                    :style="{ borderColor: tier.glow + '66', backgroundColor: tier.color + '1a' }"
                >
                    <UIcon name="i-lucide-tent" class="size-5" :style="{ color: tier.glow }" />
                </div>
                <div class="leading-tight">
                    <div class="text-sm font-semibold" :style="{ color: tier.glow }">T{{ state?.tier ?? 1 }}</div>
                    <div class="text-[11px] text-muted">of {{ TIERS.length }}</div>
                </div>
            </div>

            <nav class="flex items-center gap-1">
                <UButton
                    v-for="link in links"
                    :key="link.to"
                    :to="link.to"
                    :icon="link.icon"
                    :label="link.label"
                    size="sm"
                    color="neutral"
                    :variant="$route.path === link.to ? 'soft' : 'ghost'"
                />
            </nav>

            <!-- The site sidebar already carries coins and gems; repeating them
                 here just made the same number appear three times on one screen. -->
            <div class="ml-auto flex shrink-0 items-center gap-2">
                <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :icon="sound.muted.value ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
                    :aria-label="sound.muted.value ? 'Unmute' : 'Mute'"
                    @click="sound.setMuted(!sound.muted.value)"
                />
            </div>
        </header>

        <UAlert
            v-if="truncated"
            color="warning"
            variant="subtle"
            icon="i-lucide-hourglass"
            class="shrink-0 rounded-none border-x-0"
            title="Your caravan idled"
            description="Offline progress is capped at 24 hours. Anything past that was time your workers spent standing still."
        />

        <div v-if="progress && (progress.resourcesMet && progress.nodesMet)" class="shrink-0 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm">
            <span class="font-medium text-primary">You can advance to {{ progress.nextTier?.name }}.</span>
            <UButton to="/caravan/research" variant="link" size="sm" label="Go to the tier board" trailing-icon="i-lucide-arrow-right" />
        </div>

        <div class="flex min-h-0 flex-1">
            <div class="relative min-w-0 flex-1">
                <NuxtPage />
            </div>
            <CaravanResourcePanel />
        </div>
    </div>
</template>

<style scoped>
/*
 * Tailwind 4 no longer gives buttons a pointer cursor, and Nuxt UI leaves it to
 * the app. Rather than sprinkle `cursor-pointer` across every control and miss
 * some, set it once for anything interactive inside the game and make disabled
 * controls say so.
 */
.caravan-shell :deep(button:not(:disabled)),
.caravan-shell :deep(a[href]),
.caravan-shell :deep([role='button']:not([aria-disabled='true'])),
.caravan-shell :deep([role='option']),
.caravan-shell :deep([role='tab']),
.caravan-shell :deep(summary),
.caravan-shell :deep(label:has(input[type='checkbox']:not(:disabled))),
.caravan-shell :deep(input[type='checkbox']:not(:disabled)),
.caravan-shell :deep(input[type='radio']:not(:disabled)),
.caravan-shell :deep(select:not(:disabled)) {
    cursor: pointer;
}

.caravan-shell :deep(button:disabled),
.caravan-shell :deep([aria-disabled='true']) {
    cursor: not-allowed;
}

.caravan-shell {
    background:
        radial-gradient(1200px 600px at 50% -10%, rgb(from var(--ui-primary) r g b / 0.07), transparent 70%),
        var(--ui-bg);
}
</style>
