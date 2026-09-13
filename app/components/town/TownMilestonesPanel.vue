<script setup lang="ts">
import TownCoin from '~/components/town/TownCoin.vue'
import type { TownMilestoneView } from '~/composables/useTown'

const props = defineProps<{
    milestones: TownMilestoneView[]
    busy: boolean
}>()

const emit = defineEmits<{
    claim: [id: string]
    close: []
}>()

/**
 * A chain shows one card: its first unclaimed step, or the last step once the
 * whole chain is done. Fifty goals would otherwise be a wall of near-duplicates.
 */
const visible = computed(() => {
    const out: TownMilestoneView[] = []
    const chains = new Map<string, TownMilestoneView[]>()
    for (const m of props.milestones) {
        if (!m.chain) { out.push(m); continue }
        const list = chains.get(m.chain) ?? []
        list.push(m)
        chains.set(m.chain, list)
    }
    for (const list of chains.values()) {
        list.sort((a, b) => (a.step ?? 0) - (b.step ?? 0))
        out.push(list.find(m => !m.claimed) ?? list[list.length - 1]!)
    }
    return out
})

// Claimable first, then in-progress, then claimed at the bottom.
const ordered = computed(() => [...visible.value].sort((a, b) => {
    const rank = (m: TownMilestoneView) => m.claimed ? 2 : m.complete ? 0 : 1
    return rank(a) - rank(b) || a.tier - b.tier
}))

const claimedCount = computed(() => props.milestones.filter(m => m.claimed).length)
const totalReward = computed(() => props.milestones.filter(m => m.claimed).reduce((s, m) => s + m.reward, 0))
const totalGems = computed(() => props.milestones.filter(m => m.claimed).reduce((s, m) => s + m.gems, 0))

function pct(m: TownMilestoneView) {
    return m.target > 0 ? Math.min(100, Math.round((m.current / m.target) * 100)) : 0
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <div class="g-window-head">
            <h2>Goals <span class="g-tag">{{ claimedCount }}/{{ milestones.length }}</span></h2>
            <button class="g-icon g-icon-sm" @click="emit('close')"><UIcon name="i-lucide-x" /></button>
        </div>
        <div class="g-window-body grid gap-2 sm:grid-cols-2">
            <div v-for="m in ordered" :key="m.id" class="g-sec goal" :class="m.claimed ? 'is-claimed' : m.complete ? 'is-ready' : ''">
                <span class="goal-emoji">{{ m.emoji }}</span>
                <div class="min-w-0 flex-1">
                    <div class="flex items-start justify-between gap-2">
                        <b class="goal-title">
                            {{ m.title }}
                            <span v-if="m.chain && m.steps" class="goal-step" :data-tip="`Step ${m.step} of ${m.steps}`">{{ m.step }}/{{ m.steps }}</span>
                        </b>
                        <span class="goal-reward">
                            <span v-if="m.gems" class="g-tag g-tag-gem"><UIcon name="i-lucide-gem" /> {{ m.gems }}</span>
                            <span v-if="m.reward" class="g-tag g-tag-gold"><TownCoin /> {{ formatNumber(m.reward) }}</span>
                        </span>
                    </div>
                    <p class="goal-desc">{{ m.description }}</p>
                    <div v-if="!m.claimed" class="mt-2 flex items-center gap-2">
                        <div class="g-progress flex-1"><i :style="{ width: `${pct(m)}%` }" /></div>
                        <span class="goal-count">{{ formatNumber(m.current) }}/{{ formatNumber(m.target) }}</span>
                    </div>
                    <button v-if="m.complete && !m.claimed" class="g-btn g-btn-gold g-btn-sm mt-2 w-full" :disabled="busy" @click="emit('claim', m.id)">
                        Claim
                    </button>
                    <span v-else-if="m.claimed" class="g-tag g-tag-green mt-2"><UIcon name="i-lucide-check" /> Claimed</span>
                </div>
            </div>
        </div>
        <div class="goal-foot">
            <span class="g-label">Earned</span>
            <span v-if="totalGems" class="g-tag g-tag-gem"><UIcon name="i-lucide-gem" /> {{ totalGems }}</span>
            <span v-if="totalReward" class="g-tag g-tag-gold"><TownCoin /> {{ formatNumber(totalReward) }}</span>
            <span v-if="!totalGems && !totalReward" class="goal-foot-none">nothing yet</span>
        </div>
    </div>
</template>

<style scoped>
.goal { display: flex; gap: 12px; align-items: flex-start; }
.goal.is-ready {
    background: var(--g-gold-bg);
    border-color: color-mix(in srgb, var(--g-gold) 55%, transparent);
}
.goal.is-claimed { opacity: 0.5; }
.goal-emoji {
    width: 40px; height: 40px; flex-shrink: 0;
    border-radius: var(--g-radius-sm);
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 21px; line-height: 1;
    background: var(--g-fill);
}
.goal-title { font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.goal-step { padding: 1px 5px; border-radius: var(--g-radius-xs); background: var(--g-fill-2); font-size: 10px; font-weight: 600; color: var(--g-muted); font-variant-numeric: tabular-nums; }
.goal-reward { display: inline-flex; flex-shrink: 0; gap: 4px; }
.goal-desc { margin-top: 2px; font-size: 11px; color: var(--g-text-2); }
.goal-count { font-size: 11px; color: var(--g-muted); font-variant-numeric: tabular-nums; }

.goal-foot {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 8px 16px;
    border-top: 1px solid var(--g-line);
}
.goal-foot-none { font-size: 11.5px; color: var(--g-muted); }
</style>
