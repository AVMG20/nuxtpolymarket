<script setup lang="ts">
interface Row {
    rank: number
    userId: string
    name: string
    emblem: string | null
    prestige: number
    incomePerDay: number
    buildings: number
    plots: number
    popCap: number
    happiness: number
    maxTier: number
    me: boolean
}

const emit = defineEmits<{ close: [] }>()

const { data, pending, refresh } = useAsyncData<{ rows: Row[], me: Row | null } | null>(
    'town-leaderboard',
    () => $fetch<{ rows: Row[], me: Row | null }>('/api/town/leaderboard' as string),
    { server: false, default: () => null }
)

const rows = computed(() => data.value?.rows ?? [])
const me = computed(() => data.value?.me ?? null)
const meListed = computed(() => rows.value.some(r => r.me))

function medal(rank: number) {
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <div class="g-window-head">
            <h2>👑 Mayors</h2>
            <div class="flex gap-2">
                <button class="g-icon g-icon-sm" :class="pending ? 'animate-spin' : ''" title="Refresh" @click="refresh()">↻</button>
                <button class="g-icon g-icon-sm" @click="emit('close')">✕</button>
            </div>
        </div>
        <div class="g-window-body">
            <div v-if="pending && !data" class="flex justify-center py-8"><span class="g-spinner" /></div>
            <div v-else-if="rows.length === 0" class="py-8 text-center text-sm opacity-60">No towns founded yet.</div>
            <div v-else class="space-y-1.5">
                <div v-for="r in rows" :key="r.userId" class="mayor" :class="r.me ? 'is-me' : ''">
                    <span class="mayor-rank" :class="r.rank <= 3 ? 'text-xl' : 'text-sm opacity-60'">{{ medal(r.rank) }}</span>
                    <div class="size-9 shrink-0"><ProfileEmblem :emblem="r.emblem" :name="r.name" :prestige="r.prestige" /></div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 truncate text-sm font-extrabold">
                            <NuxtLink :to="`/players/${r.userId}`" class="truncate hover:underline">{{ r.name }}</NuxtLink>
                            <PrestigeBadge :level="r.prestige" size="xs" />
                        </div>
                        <div class="text-[11px] opacity-60">{{ r.plots }} {{ r.plots === 1 ? 'plot' : 'plots' }} · {{ r.buildings }} buildings · tier {{ r.maxTier }} · 👥 {{ r.popCap }}</div>
                    </div>
                    <div class="text-right">
                        <div class="text-sm font-black tabular-nums" style="color: var(--g-green)">🪙 {{ formatNumber(r.incomePerDay) }}</div>
                        <div class="text-[10px] opacity-50">per day</div>
                    </div>
                </div>
            </div>
        </div>
        <div v-if="me && !meListed" class="border-t px-4 py-2 text-center text-xs opacity-70" style="border-color: var(--g-line)">
            You are <b>#{{ me.rank }}</b> at 🪙 {{ formatNumber(me.incomePerDay) }}/day
        </div>
    </div>
</template>

<style scoped>
.mayor { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid transparent; }
.mayor.is-me { background: rgba(79, 211, 106, 0.1); border-color: rgba(79, 211, 106, 0.4); }
.mayor-rank { width: 32px; text-align: center; flex-shrink: 0; }
</style>
