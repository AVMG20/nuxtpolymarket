<script lang="ts" setup>
import { formatDistanceToNow } from 'date-fns'
import { CHAT_HISTORY_LIMIT, CHAT_MAX_LENGTH, sanitizeChatContent } from '#shared/utils/chat'

interface ChatMessage {
  id: string
  userId: string
  name: string
  content: string
  createdAt: string
}

const { user } = useAuth()

const open = ref(false)
const unread = ref(0)
const draft = ref('')
const messages = ref<ChatMessage[]>([])
const listEl = ref<HTMLElement | null>(null)
const inputWrapper = ref<{ textareaRef?: HTMLTextAreaElement } | null>(null)

// -- websocket ---------------------------------------------------------------

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let unmounted = false

function pushMessage(msg: ChatMessage) {
  if (messages.value.some(m => m.id === msg.id)) return
  messages.value.push(msg)
  if (messages.value.length > 200) messages.value.splice(0, messages.value.length - 200)
  if (open.value) scrollToBottom()
  else if (msg.userId !== user.value?.id) unread.value++
}

function connect() {
  if (unmounted || ws) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/api/chat/ws`)
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'message') pushMessage(data)
      else if (data.type === 'delete') messages.value = messages.value.filter(m => m.id !== data.id)
    } catch { /* ignore malformed frames */ }
  }
  ws.onclose = () => {
    ws = null
    if (!unmounted) reconnectTimer = setTimeout(connect, 3000)
  }
}

onMounted(async () => {
  connect()
  try {
    const history = await $fetch<ChatMessage[]>('/api/chat/messages')
    // prepend history, skipping anything that already arrived over the socket
    const seen = new Set(messages.value.map(m => m.id))
    messages.value = [...history.filter(m => !seen.has(m.id)), ...messages.value]
    hasMore.value = history.length >= CHAT_HISTORY_LIMIT
  } catch { /* history is best-effort; live messages still work */ }
})

// -- older-message pagination (scroll up to load) ------------------------------

const hasMore = ref(true)
const loadingOlder = ref(false)

function onListScroll() {
  if (listEl.value && listEl.value.scrollTop < 50) loadOlder()
}

async function loadOlder() {
  if (loadingOlder.value || !hasMore.value) return
  const oldest = messages.value[0]
  if (!oldest) return
  loadingOlder.value = true
  try {
    const older = await $fetch<ChatMessage[]>('/api/chat/messages', {
      query: { before: oldest.createdAt }
    })
    if (older.length < CHAT_HISTORY_LIMIT) hasMore.value = false
    if (older.length) {
      const el = listEl.value
      const prevHeight = el?.scrollHeight ?? 0
      const seen = new Set(messages.value.map(m => m.id))
      messages.value = [...older.filter(m => !seen.has(m.id)), ...messages.value]
      // keep the viewport anchored on the message the user was looking at
      await nextTick()
      if (el) el.scrollTop += el.scrollHeight - prevHeight
    }
  } catch { /* will retry on the next intersection */ } finally {
    loadingOlder.value = false
  }
}

onBeforeUnmount(() => {
  unmounted = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  ws?.close()
})

// -- ui ----------------------------------------------------------------------

function toggle() {
  open.value = !open.value
  if (open.value) {
    unread.value = 0
    scrollToBottom()
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

// ticks every 30s so relative timestamps stay fresh
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 30_000)
})
onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
})

function relative(date: string) {
  void now.value // reactivity hook
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

// -- user name colors ----------------------------------------------------------

// stable per-user color, hashed from the user id; self is always text-primary
const USER_COLORS = [
  'text-red-400',
  'text-orange-400',
  'text-amber-400',
  'text-lime-400',
  'text-emerald-400',
  'text-teal-400',
  'text-sky-400',
  'text-indigo-400',
  'text-violet-400',
  'text-fuchsia-400',
  'text-rose-400'
]

function nameColor(userId: string) {
  if (userId === user.value?.id) return 'text-primary'
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length]
}

// -- minimal formatting: **bold** __underline__ ~~strikethrough~~ -------------

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderContent(s: string) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
}

function wrapSelection(marker: string) {
  const el = inputWrapper.value?.textareaRef
  const start = el?.selectionStart ?? draft.value.length
  const end = el?.selectionEnd ?? draft.value.length
  const selected = draft.value.slice(start, end)
  draft.value = draft.value.slice(0, start) + marker + selected + marker + draft.value.slice(end)
  nextTick(() => {
    el?.focus()
    el?.setSelectionRange(start + marker.length, end + marker.length)
  })
}

// -- share tokens: [[coin:v]] [[gem:v]] [[profit:cat:v]] [[loss:cat:v]] --------

type Part
  = | { type: 'text', html: string }
    | { type: 'coin' | 'gem', value: number }
    | { type: 'stat', kind: 'profit' | 'loss', category: string, value: number }

const TOKEN_RE = /\[\[(coin|gem|profit|loss):([^\]]{1,40})\]\]/g

function parseContent(content: string): Part[] {
  const parts: Part[] = []
  let last = 0
  for (const match of content.matchAll(TOKEN_RE)) {
    const [full = '', kind = '', payload = ''] = match
    const index = match.index ?? 0
    if (index > last) parts.push({ type: 'text', html: renderContent(content.slice(last, index)) })
    if (kind === 'coin' || kind === 'gem') {
      const value = parseFloat(payload)
      if (isFinite(value)) parts.push({ type: kind, value })
      else parts.push({ type: 'text', html: renderContent(full) })
    } else {
      const sep = payload.lastIndexOf(':')
      const category = sep > 0 ? payload.slice(0, sep) : ''
      const value = parseFloat(payload.slice(sep + 1))
      if (category && isFinite(value)) {
        parts.push({ type: 'stat', kind: kind === 'profit' ? 'profit' : 'loss', category, value: Math.abs(value) })
      } else {
        parts.push({ type: 'text', html: renderContent(full) })
      }
    }
    last = index + full.length
  }
  if (last < content.length) parts.push({ type: 'text', html: renderContent(content.slice(last)) })
  return parts
}

function insertAtCursor(text: string) {
  const el = inputWrapper.value?.textareaRef
  const start = el?.selectionStart ?? draft.value.length
  const end = el?.selectionEnd ?? draft.value.length
  draft.value = draft.value.slice(0, start) + text + draft.value.slice(end)
  nextTick(() => {
    el?.focus()
    el?.setSelectionRange(start + text.length, start + text.length)
  })
}

const toast = useToast()

function insertCoin() {
  insertAtCursor(`[[coin:${parseFloat(user.value?.balance ?? '0')}]]`)
}

function insertGem() {
  insertAtCursor(`[[gem:${user.value?.gems ?? 0}]]`)
}

async function insertStat(kind: 'profit' | 'loss') {
  try {
    const stats = await $fetch<{
      best: { category: string, amount: number } | null
      worst: { category: string, amount: number } | null
    }>('/api/chat/stats')
    const stat = kind === 'profit' ? stats.best : stats.worst
    if (!stat || (kind === 'profit' ? stat.amount <= 0 : stat.amount >= 0)) {
      toast.add({ title: kind === 'profit' ? 'No profit today (yet)' : 'No losses today, nice', color: 'neutral' })
      return
    }
    insertAtCursor(`[[${kind}:${stat.category}:${Math.abs(stat.amount)}]]`)
  } catch { /* stats are best-effort */ }
}

function send() {
  const content = sanitizeChatContent(draft.value)
  if (!content || ws?.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'message', content }))
  draft.value = ''
}

function deleteMessage(id: string) {
  if (ws?.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'delete', id }))
}
</script>

<template>
  <!-- in-flow bottom-right on mobile, fixed bottom-right on desktop -->
  <div class="flex justify-end p-3 lg:p-0 lg:block lg:fixed lg:bottom-4 lg:right-4 lg:z-40">
    <div class="flex flex-col items-end gap-2">
      <div
        v-if="open"
        class="flex w-[calc(100vw-1.5rem)] max-w-80 flex-col overflow-hidden rounded-lg border border-default bg-default shadow-xl"
      >
        <div class="flex items-center justify-between border-b border-default px-3 py-2">
          <span class="text-sm font-semibold">Chat</span>
          <UButton
            aria-label="Close chat"
            color="neutral"
            icon="i-lucide-x"
            size="xs"
            variant="ghost"
            @click="toggle"
          />
        </div>

        <div
          ref="listEl"
          class="h-64 space-y-2 overflow-y-auto px-3 py-2"
          @scroll.passive="onListScroll"
        >
          <div
            v-if="loadingOlder"
            class="flex justify-center py-1"
          >
            <UIcon
              class="size-4 animate-spin text-muted"
              name="i-lucide-loader-2"
            />
          </div>
          <p
            v-if="!messages.length"
            class="py-4 text-center text-xs text-muted"
          >
            No messages yet
          </p>
          <div
            v-for="m in messages"
            :key="m.id"
            class="group text-sm"
          >
            <div class="flex items-baseline gap-2">
              <span
                class="truncate font-medium"
                :class="nameColor(m.userId)"
              >
                {{ m.name }}
              </span>
              <span class="shrink-0 text-[10px] text-muted">{{ relative(m.createdAt) }}</span>
              <UButton
                v-if="m.userId === user?.id"
                aria-label="Delete message"
                class="ms-auto shrink-0 opacity-60 hover:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                color="error"
                icon="i-lucide-trash-2"
                size="xs"
                variant="ghost"
                @click="deleteMessage(m.id)"
              />
            </div>
            <p class="whitespace-pre-line break-words">
              <template
                v-for="(part, i) in parseContent(m.content)"
                :key="i"
              >
                <!-- eslint-disable vue/no-v-html -- content is HTML-escaped in renderContent -->
                <span
                  v-if="part.type === 'text'"
                  v-html="part.html"
                />
                <!-- eslint-enable vue/no-v-html -->
                <CoinBalance
                  v-else-if="part.type === 'coin'"
                  class="inline-flex align-middle"
                  :value="part.value"
                />
                <GemBalance
                  v-else-if="part.type === 'gem'"
                  class="inline-flex align-middle"
                  :value="part.value"
                />
                <span
                  v-else-if="part.type === 'stat'"
                  class="inline-flex items-center gap-1 rounded bg-elevated px-1.5 py-0.5 align-middle text-xs font-medium"
                  :class="part.kind === 'profit' ? 'text-success' : 'text-error'"
                >
                  <UIcon
                    class="size-3.5 shrink-0"
                    :name="part.kind === 'profit' ? 'i-lucide-trending-up' : 'i-lucide-trending-down'"
                  />
                  {{ part.category }}
                  {{ (part.kind === 'profit' ? '+' : '-') + formatNumber(part.value) }}
                </span>
              </template>
            </p>
          </div>
        </div>

        <div class="border-t border-default p-2">
          <div class="mb-1.5 flex gap-0.5">
            <UButton
              aria-label="Bold"
              color="neutral"
              icon="i-lucide-bold"
              size="xs"
              variant="ghost"
              @click="wrapSelection('**')"
            />
            <UButton
              aria-label="Underline"
              color="neutral"
              icon="i-lucide-underline"
              size="xs"
              variant="ghost"
              @click="wrapSelection('__')"
            />
            <UButton
              aria-label="Strikethrough"
              color="neutral"
              icon="i-lucide-strikethrough"
              size="xs"
              variant="ghost"
              @click="wrapSelection('~~')"
            />
            <USeparator
              class="mx-1 h-5 self-center"
              orientation="vertical"
            />
            <UButton
              aria-label="Share coin balance"
              class="text-yellow-400"
              color="neutral"
              icon="i-lucide-coins"
              size="xs"
              variant="ghost"
              @click="insertCoin"
            />
            <UButton
              aria-label="Share gem balance"
              class="text-cyan-400"
              color="neutral"
              icon="i-lucide-gem"
              size="xs"
              variant="ghost"
              @click="insertGem"
            />
            <UButton
              aria-label="Share today's best profit"
              color="success"
              icon="i-lucide-trending-up"
              size="xs"
              variant="ghost"
              @click="insertStat('profit')"
            />
            <UButton
              aria-label="Share today's biggest loss"
              color="error"
              icon="i-lucide-trending-down"
              size="xs"
              variant="ghost"
              @click="insertStat('loss')"
            />
          </div>
          <div class="flex gap-1.5">
            <UTextarea
              ref="inputWrapper"
              v-model="draft"
              autoresize
              class="flex-1"
              :maxlength="CHAT_MAX_LENGTH"
              :maxrows="4"
              placeholder="Message…"
              :rows="1"
              size="sm"
              @keydown.enter.exact.prevent="send"
            />
            <UButton
              aria-label="Send"
              :disabled="!draft.trim()"
              icon="i-lucide-send"
              size="sm"
              @click="send"
            />
          </div>
        </div>
      </div>

      <div class="relative">
        <UButton
          :aria-label="open ? 'Close chat' : 'Open chat'"
          class="rounded-full shadow-lg"
          :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-message-circle'"
          size="lg"
          @click="toggle"
        />
        <span
          v-if="!open && unread > 0"
          class="pointer-events-none absolute -end-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-error text-[10px] font-semibold leading-none text-inverted"
        >
          {{ unread > 9 ? '9+' : unread }}
        </span>
      </div>
    </div>
  </div>
</template>
