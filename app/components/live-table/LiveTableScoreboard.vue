<script setup lang="ts">
import type { LtScoreEntry } from '#shared/utils/live-table/types'

defineProps<{ entries: LtScoreEntry[], youId: string | null }>()
</script>

<template>
    <div class="flex min-h-0 flex-col rounded-xl bg-elevated ring-1 ring-default">
        <h3 class="border-b border-default px-3 py-2 text-xs font-bold tracking-wider text-muted uppercase">
            Session
        </h3>
        <ul class="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs">
            <li
                v-for="entry in entries"
                :key="entry.userId"
                class="flex items-center gap-2 rounded-md px-1.5 py-1"
                :class="{ 'bg-primary/10 ring-1 ring-primary/30': entry.userId === youId }"
            >
                <span class="flex-1 truncate font-semibold" :class="entry.seated ? 'text-default' : 'text-muted'">
                    {{ entry.name }}
                </span>
                <span v-if="entry.winStreak > 1" class="rounded bg-warning/20 px-1 text-[10px] font-bold text-warning">
                    {{ entry.winStreak }}
                </span>
                <span
                    class="font-mono tabular-nums"
                    :class="entry.net > 0 ? 'text-success' : entry.net < 0 ? 'text-error' : 'text-muted'"
                >{{ entry.net > 0 ? '+' : '' }}{{ formatNumber(entry.net) }}</span>
            </li>
            <li v-if="!entries.length" class="text-muted">
                Nobody has played yet.
            </li>
        </ul>
    </div>
</template>
