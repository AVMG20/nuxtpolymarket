<script setup lang="ts">
import type { LtFeedItem } from '~/composables/live-table'

const props = defineProps<{ messages: LtFeedItem[] }>()
const emit = defineEmits<{ send: [text: string] }>()

const draft = ref('')
const log = ref<HTMLElement | null>(null)

function send() {
    const text = draft.value.trim()
    if (!text) return
    emit('send', text)
    draft.value = ''
}

// Only follow the tail when the reader is already there — yanking the view down
// mid-scroll is how a chat loses the message someone was reading.
watch(() => props.messages.length, async () => {
    const el = log.value
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (!atBottom) return
    await nextTick()
    el.scrollTop = el.scrollHeight
})
</script>

<template>
    <div class="flex min-h-0 flex-col rounded-xl bg-elevated ring-1 ring-default">
        <h3 class="border-b border-default px-3 py-2 text-xs font-bold tracking-wider text-muted uppercase">
            Table chat
        </h3>
        <ul ref="log" class="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs leading-snug">
            <li v-for="item in messages" :key="item.id">
                <span class="font-bold text-primary">{{ item.name }}:</span>
                <span class="text-default"> {{ item.text }}</span>
            </li>
            <li v-if="!messages.length" class="text-muted">
                No messages yet.
            </li>
        </ul>
        <form class="flex gap-1 border-t border-default p-2" @submit.prevent="send">
            <input
                v-model="draft"
                maxlength="120"
                placeholder="Say something…"
                class="min-w-0 flex-1 rounded-md bg-default px-2 py-1 text-xs text-default placeholder:text-muted focus:ring-1 focus:ring-primary focus:outline-none"
            >
            <UButton type="submit" size="xs" color="neutral" variant="soft" icon="i-lucide-send" class="cursor-pointer" />
        </form>
    </div>
</template>
