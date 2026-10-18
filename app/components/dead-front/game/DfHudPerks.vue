<template>
    <div class="df-perks">
        <TransitionGroup name="df-perk">
            <div
                v-for="p in perks"
                :key="p.id"
                class="slot"
                :class="{ fresh: pulse.id === p.id }"
                :style="{ '--c': p.color }"
                :title="p.name"
            >
                <span v-if="pulse.id === p.id" :key="pulse.key" class="flash" aria-hidden="true" />
                <DfPixelPerk :perk="p.id" :color="p.color" :size="40" />
            </div>
        </TransitionGroup>
    </div>
</template>

<script setup lang="ts">
// The perks you have drunk: a block tile per perk, framed in its colour, with
// the bottle as a pixel sprite so it stays crisp at any size.
import type { DfHudState, DfHudPerk } from '~/utils/dead-front/engine/hud'
import DfPixelPerk from '~/components/dead-front/ui/DfPixelPerk.vue'

defineProps<{ perks: DfHudPerk[], pulse: DfHudState['perkPulse'] }>()
</script>

<style scoped>
.df-perks {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    min-height: 52px;
}

.slot {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 52px;
    background: color-mix(in srgb, var(--c) 18%, rgba(8, 10, 12, 0.8));
    box-shadow:
        0 -3px 0 #000, 0 3px 0 #000, -3px 0 0 #000, 3px 0 0 #000,
        inset 0 -4px 0 color-mix(in srgb, var(--c) 70%, #000),
        inset 0 2px 0 rgba(255, 255, 255, 0.08);
}

.flash {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--c) 60%, #fff);
    animation: df-perk-flash 0.6s steps(4, end) forwards;
    pointer-events: none;
}

.df-perk-enter-active {
    animation: df-perk-in 0.55s cubic-bezier(0.3, 1.7, 0.5, 1);
}

.df-perk-leave-active {
    animation: df-perk-out 0.4s steps(4, end) forwards;
}

@keyframes df-perk-flash {
    0% { opacity: 0.9; }
    100% { opacity: 0; }
}

@keyframes df-perk-in {
    0% { transform: translateY(-36px) scale(0.5); opacity: 0; }
    40% { opacity: 1; }
    100% { transform: none; }
}

@keyframes df-perk-out {
    0% { transform: none; opacity: 1; }
    100% { transform: translateY(14px); opacity: 0; filter: grayscale(1); }
}
</style>
