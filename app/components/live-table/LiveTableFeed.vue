<script setup lang="ts">
import type { LtFeedItem } from '~/composables/live-table'
import { nameColor } from '~/utils/live-table/art'

const props = defineProps<{ items: LtFeedItem[], title?: string }>()

const log = ref<HTMLElement | null>(null)

// Only follow the tail when the reader is already there — yanking the view down
// mid-scroll loses whatever they were reading.
watch(() => props.items.length, async () => {
    const el = log.value
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (!atBottom) return
    await nextTick()
    el.scrollTop = el.scrollHeight
})

onMounted(async () => {
    await nextTick()
    if (log.value) log.value.scrollTop = log.value.scrollHeight
})
</script>

<template>
    <div class="flex min-h-0 flex-col rounded-xl bg-elevated ring-1 ring-default">
        <h3 class="border-b border-default px-3 py-2 text-xs font-bold tracking-wider text-muted uppercase">
            {{ title ?? 'Table feed' }}
        </h3>
        <ul ref="log" class="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs leading-snug">
            <li
                v-for="item in items"
                :key="item.id"
                :class="item.tone === 'win' ? 'text-success' : item.tone === 'loss' ? 'text-error' : 'text-muted'"
            >
                <template v-if="item.name">
                    <span class="font-semibold" :style="{ color: nameColor(item.name) }">{{ item.name }}</span>
                    <span>{{ item.text.startsWith(item.name) ? item.text.slice(item.name.length) : ` ${item.text}` }}</span>
                </template>
                <template v-else>{{ item.text }}</template>
            </li>
            <li v-if="!items.length" class="text-muted">
                Waiting for the first round.
            </li>
        </ul>
    </div>
</template>
