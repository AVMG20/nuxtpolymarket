<script setup lang="ts">
import type { TownMilestoneView } from '~/composables/useTown'

const props = defineProps<{
    milestones: TownMilestoneView[]
    busy: boolean
}>()

const emit = defineEmits<{
    claim: [id: string]
    close: []
}>()

// Claimable first, then in-progress, then claimed at the bottom.
const ordered = computed(() => [...props.milestones].sort((a, b) => {
    const rank = (m: TownMilestoneView) => m.claimed ? 2 : m.complete ? 0 : 1
    return rank(a) - rank(b) || a.tier - b.tier
}))

const claimedCount = computed(() => props.milestones.filter(m => m.claimed).length)
const totalReward = computed(() => props.milestones.filter(m => m.claimed).reduce((s, m) => s + m.reward, 0))

function pct(m: TownMilestoneView) {
    return m.target > 0 ? Math.min(100, Math.round((m.current / m.target) * 100)) : 0
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <div class="g-window-head">
            <h2>🏆 Goals <span class="text-sm font-semibold opacity-50">{{ claimedCount }}/{{ milestones.length }}</span></h2>
            <button class="g-icon g-icon-sm" @click="emit('close')">✕</button>
        </div>
        <div class="g-window-body grid gap-2 sm:grid-cols-2">
            <div v-for="m in ordered" :key="m.id" class="goal" :class="m.claimed ? 'is-claimed' : m.complete ? 'is-ready' : ''">
                <span class="goal-emoji">{{ m.emoji }}</span>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between gap-2">
                        <b class="truncate text-sm">{{ m.title }}</b>
                        <span class="shrink-0 text-xs font-extrabold" style="color: var(--g-gold)">🪙 {{ formatNumber(m.reward) }}</span>
                    </div>
                    <p class="text-xs opacity-65">{{ m.description }}</p>
                    <div v-if="!m.claimed" class="mt-2 flex items-center gap-2">
                        <div class="g-progress flex-1"><i :style="{ width: `${pct(m)}%` }" /></div>
                        <span class="text-[11px] opacity-60 tabular-nums">{{ formatNumber(m.current) }}/{{ formatNumber(m.target) }}</span>
                    </div>
                    <button v-if="m.complete && !m.claimed" class="g-btn g-btn-gold mt-2 w-full py-2 text-xs" :disabled="busy" @click="emit('claim', m.id)">
                        🎁 Claim {{ formatNumber(m.reward) }} coins
                    </button>
                    <div v-else-if="m.claimed" class="mt-1 text-xs font-bold text-emerald-300">✓ Claimed</div>
                </div>
            </div>
        </div>
        <div class="border-t px-4 py-2 text-center text-xs opacity-70" style="border-color: var(--g-line)">
            Earned <b style="color: var(--g-gold)">🪙 {{ formatNumber(totalReward) }}</b> from goals
        </div>
    </div>
</template>

<style scoped>
.goal { display: flex; gap: 12px; padding: 12px; border-radius: 14px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--g-line); }
.goal.is-ready { background: rgba(245, 196, 81, 0.1); border-color: rgba(245, 196, 81, 0.5); box-shadow: 0 0 0 1px rgba(245, 196, 81, 0.2) inset; }
.goal.is-claimed { opacity: 0.55; }
.goal-emoji { width: 40px; height: 40px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; font-size: 22px; background: rgba(255, 255, 255, 0.08); flex-shrink: 0; }
</style>
