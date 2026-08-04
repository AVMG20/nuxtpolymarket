<script setup lang="ts">
import type { LtFeedItem } from '~/composables/live-table'

defineProps<{ items: LtFeedItem[], title?: string }>()
</script>

<template>
    <div class="flex min-h-0 flex-col rounded-xl bg-elevated ring-1 ring-default">
        <h3 class="border-b border-default px-3 py-2 text-xs font-bold tracking-wider text-muted uppercase">
            {{ title ?? 'Table feed' }}
        </h3>
        <ul class="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs leading-snug">
            <li
                v-for="item in items"
                :key="item.id"
                :class="item.tone === 'win' ? 'text-success' : item.tone === 'loss' ? 'text-error' : 'text-muted'"
            >
                {{ item.text }}
            </li>
            <li v-if="!items.length" class="text-muted">
                Waiting for the first round.
            </li>
        </ul>
    </div>
</template>
