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

// -- preferences (cookie-persisted) --------------------------------------------

type ChatPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
interface ChatPrefs {
  position: ChatPosition
  width: number
  height: number
}

const DEFAULT_PREFS: ChatPrefs = { position: 'bottom-right', width: 320, height: 420 }
const prefs = useCookie<ChatPrefs>('chat-prefs', { default: () => ({ ...DEFAULT_PREFS }) })

const POSITIONS: { value: ChatPosition, icon: string }[] = [
  { value: 'top-left', icon: 'i-lucide-arrow-up-left' },
  { value: 'top-right', icon: 'i-lucide-arrow-up-right' },
  { value: 'bottom-left', icon: 'i-lucide-arrow-down-left' },
  { value: 'bottom-right', icon: 'i-lucide-arrow-down-right' }
]

const position = computed<ChatPosition>(() => prefs.value?.position ?? 'bottom-right')

function setPosition(p: ChatPosition) {
  prefs.value = { ...DEFAULT_PREFS, ...prefs.value, position: p }
}

function resetSize() {
  prefs.value = { ...DEFAULT_PREFS, ...prefs.value, width: DEFAULT_PREFS.width, height: DEFAULT_PREFS.height }
}

// position prefs only apply on desktop; on mobile the widget stays in flow
const wrapperPos = computed(() => ({
  'top-left': 'lg:top-4 lg:left-4',
  'top-right': 'lg:top-4 lg:right-4',
  'bottom-left': 'lg:bottom-4 lg:left-4',
  'bottom-right': 'lg:bottom-4 lg:right-4'
})[position.value])

const stackCls = computed(() => [
  position.value.startsWith('top') ? 'lg:flex-col-reverse' : '',
  position.value.endsWith('left') ? 'lg:items-start' : ''
])

const isDesktop = ref(false)
onMounted(() => {
  const mq = window.matchMedia('(min-width: 1024px)')
  isDesktop.value = mq.matches
  mq.addEventListener('change', (e) => {
    isDesktop.value = e.matches
  })
})

const panelStyle = computed(() => {
  if (!isDesktop.value) return undefined
  return {
    width: `${prefs.value?.width ?? DEFAULT_PREFS.width}px`,
    height: `${prefs.value?.height ?? DEFAULT_PREFS.height}px`
  }
})

// persist the size when the user drags the native resize handle
const panelEl = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null
let saveSizeTimer: ReturnType<typeof setTimeout> | null = null

watch(open, (isOpen) => {
  if (!isOpen) {
    resizeObserver?.disconnect()
    resizeObserver = null
    return
  }
  nextTick(() => {
    if (!panelEl.value || !isDesktop.value) return
    resizeObserver = new ResizeObserver(() => {
      if (saveSizeTimer) clearTimeout(saveSizeTimer)
      saveSizeTimer = setTimeout(() => {
        const el = panelEl.value
        if (!el) return
        const width = Math.round(el.offsetWidth)
        const height = Math.round(el.offsetHeight)
        const current = prefs.value ?? DEFAULT_PREFS
        if (Math.abs(width - current.width) > 2 || Math.abs(height - current.height) > 2) {
          prefs.value = { ...DEFAULT_PREFS, ...current, width, height }
        }
      }, 250)
    })
    resizeObserver.observe(panelEl.value)
  })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (saveSizeTimer) clearTimeout(saveSizeTimer)
})

// drag handle in the header: resizes from the corner opposite the anchor;
// the ResizeObserver above takes care of persisting the final size
function startHandleResize(e: PointerEvent) {
  const el = panelEl.value
  if (!el || !isDesktop.value) return
  e.preventDefault()
  const startX = e.clientX
  const startY = e.clientY
  const startW = el.offsetWidth
  const startH = el.offsetHeight
  const signX = position.value.endsWith('right') ? -1 : 1
  const signY = position.value.startsWith('bottom') ? -1 : 1
  const onMove = (ev: PointerEvent) => {
    const width = Math.min(576, Math.max(256, startW + (ev.clientX - startX) * signX))
    const height = Math.min(window.innerHeight * 0.8, Math.max(288, startH + (ev.clientY - startY) * signY))
    el.style.width = `${width}px`
    el.style.height = `${height}px`
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
const unread = ref(0)
const draft = ref('')
const messages = ref<ChatMessage[]>([])
const listEl = ref<HTMLElement | null>(null)
const inputWrapper = ref<{ textareaRef?: HTMLTextAreaElement } | null>(null)

// -- websocket ---------------------------------------------------------------

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let unmounted = false

function pushMessage(msg: ChatMessage, countsAsUnread = true) {
  if (messages.value.some(m => m.id === msg.id)) return
  messages.value.push(msg)
  if (messages.value.length > 200) messages.value.splice(0, messages.value.length - 200)
  if (open.value) scrollToBottom()
  else if (countsAsUnread && msg.userId !== user.value?.id) unread.value++
}

function connect() {
  if (unmounted || ws) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/api/chat/ws`)
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'message') {
        // a message that tags you counts via the mention tracker, not unread
        const mentionsMe = !!user.value?.id && String(data.content).includes(`[[tag:${user.value.id}:`)
        pushMessage(data, !mentionsMe)
        if (mentionsMe) {
          unseenMentions.value.push({ messageId: data.id })
          nextTick(() => checkMentionsSeen())
        }
      } else if (data.type === 'delete') {
        messages.value = messages.value.filter(m => m.id !== data.id)
        unseenMentions.value = unseenMentions.value.filter(m => m.messageId !== data.id)
      }
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
  try {
    unseenMentions.value = await $fetch<{ messageId: string }[]>('/api/chat/mentions')
  } catch { /* mentions are best-effort */ }
})

// -- older-message pagination (scroll up to load) ------------------------------

const hasMore = ref(true)
const loadingOlder = ref(false)

function onListScroll() {
  if (listEl.value && listEl.value.scrollTop < 50) loadOlder()
  checkMentionsSeen()
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

// regular unread resets on open; mention count sticks until actually seen
const badgeCount = computed(() => unread.value + unseenMentions.value.length)

function scrollToBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
    checkMentionsSeen()
  })
}

// -- @mentions -----------------------------------------------------------------

const unseenMentions = ref<{ messageId: string }[]>([])
const highlightId = ref<string | null>(null)

async function markMentionSeen(messageId: string) {
  unseenMentions.value = unseenMentions.value.filter(m => m.messageId !== messageId)
  try {
    await $fetch('/api/chat/mentions/seen', { method: 'POST', body: { messageId } })
  } catch { /* will show again on next load, better than losing it */ }
}

// a mention counts as seen once its message has actually been inside the
// visible part of the list while the chat is open
function checkMentionsSeen() {
  if (!open.value || !unseenMentions.value.length || !listEl.value) return
  const listRect = listEl.value.getBoundingClientRect()
  for (const mention of [...unseenMentions.value]) {
    const el = listEl.value.querySelector(`[data-msg-id="${mention.messageId}"]`)
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.top >= listRect.top - 4 && r.bottom <= listRect.bottom + 4) {
      markMentionSeen(mention.messageId)
    }
  }
}

// scroll (and page back as far as needed) to the oldest unseen mention
const jumpingToMention = ref(false)
async function jumpToMention() {
  const target = unseenMentions.value[0]
  if (!target || jumpingToMention.value) return
  jumpingToMention.value = true
  try {
    let guard = 25
    while (!messages.value.some(m => m.id === target.messageId) && hasMore.value && guard-- > 0) {
      await loadOlder()
    }
    await nextTick()
    const el = listEl.value?.querySelector(`[data-msg-id="${target.messageId}"]`)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      highlightId.value = target.messageId
      setTimeout(() => {
        if (highlightId.value === target.messageId) highlightId.value = null
      }, 2000)
    }
    // clears it even if the message was deleted in the meantime
    markMentionSeen(target.messageId)
  } finally {
    jumpingToMention.value = false
  }
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
    | { type: 'tag', userId: string, name: string }

const TOKEN_RE = /\[\[(coin|gem|profit|loss|tag):([^\]]{1,100})\]\]/g

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
    } else if (kind === 'tag') {
      const sep = payload.indexOf(':')
      const userId = sep > 0 ? payload.slice(0, sep) : ''
      const name = payload.slice(sep + 1)
      if (userId && name) parts.push({ type: 'tag', userId, name })
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

// -- @ autocomplete ------------------------------------------------------------

const mentionQuery = ref<string | null>(null)
const mentionIndex = ref(0)
const allUsers = ref<{ id: string, name: string }[] | null>(null)
let usersLoading = false

async function ensureUsers() {
  if (allUsers.value || usersLoading) return
  usersLoading = true
  try {
    allUsers.value = await $fetch<{ id: string, name: string }[]>('/api/chat/users')
  } catch { /* dropdown just stays empty */ } finally {
    usersLoading = false
  }
}

const mentionMatches = computed(() => {
  if (mentionQuery.value === null || !allUsers.value) return []
  const q = mentionQuery.value.toLowerCase()
  return allUsers.value.filter(u => u.name.toLowerCase().includes(q)).slice(0, 5)
})

// look for an "@query" immediately before the cursor
watch(draft, () => {
  const el = inputWrapper.value?.textareaRef
  if (!el) {
    mentionQuery.value = null
    return
  }
  const beforeCursor = draft.value.slice(0, el.selectionStart ?? draft.value.length)
  const match = beforeCursor.match(/@(\w{0,20})$/)
  if (match) {
    mentionQuery.value = match[1] ?? ''
    mentionIndex.value = 0
    ensureUsers()
  } else {
    mentionQuery.value = null
  }
})

function selectMention(u: { id: string, name: string }) {
  const el = inputWrapper.value?.textareaRef
  const cursor = el?.selectionStart ?? draft.value.length
  const queryLength = (mentionQuery.value?.length ?? 0) + 1 // +1 for the @
  const start = cursor - queryLength
  const token = `[[tag:${u.id}:${u.name.replace(/[[\]:]/g, '')}]] `
  draft.value = draft.value.slice(0, start) + token + draft.value.slice(cursor)
  mentionQuery.value = null
  nextTick(() => {
    el?.focus()
    el?.setSelectionRange(start + token.length, start + token.length)
  })
}

function onInputKeydown(e: KeyboardEvent) {
  if (mentionMatches.value.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      mentionIndex.value = (mentionIndex.value + 1) % mentionMatches.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      mentionIndex.value = (mentionIndex.value - 1 + mentionMatches.value.length) % mentionMatches.value.length
      return
    }
    if (e.key === 'Escape') {
      mentionQuery.value = null
      return
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault()
      const pick = mentionMatches.value[mentionIndex.value]
      if (pick) selectMention(pick)
      return
    }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
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
  <!-- in-flow bottom-right on mobile, fixed to the preferred corner on desktop -->
  <div
    class="flex justify-end p-3 lg:p-0 lg:block lg:fixed lg:z-40"
    :class="wrapperPos"
  >
    <div
      class="flex flex-col items-end gap-2"
      :class="stackCls"
    >
      <div
        v-if="open"
        ref="panelEl"
        class="relative flex w-[calc(100vw-1.5rem)] max-w-90 flex-col overflow-hidden rounded-lg border border-default bg-default shadow-xl lg:max-h-[80vh] lg:min-h-72 lg:min-w-64 lg:max-w-[36rem] lg:resize"
        :style="panelStyle"
      >
        <UButton
          v-if="unseenMentions.length"
          class="absolute left-1/2 top-11 z-10 -translate-x-1/2 rounded-full shadow-md"
          icon="i-lucide-at-sign"
          :label="`${unseenMentions.length} mention${unseenMentions.length > 1 ? 's' : ''}`"
          :loading="jumpingToMention"
          size="xs"
          trailing-icon="i-lucide-arrow-up"
          @click="jumpToMention"
        />
        <div class="flex items-center justify-between border-b border-default px-3 py-2">
          <div
            class="flex select-none items-center gap-1.5 lg:cursor-nwse-resize lg:touch-none"
            title="Drag to resize"
            @pointerdown="startHandleResize"
          >
            <UIcon
              class="hidden size-3.5 text-muted lg:block"
              name="i-lucide-grip"
            />
            <span class="text-sm font-semibold">Chat</span>
          </div>
          <div class="flex items-center gap-0.5">
            <UPopover :content="{ side: 'bottom', align: 'end', sideOffset: 6 }">
              <UButton
                aria-label="Chat settings"
                color="neutral"
                icon="i-lucide-settings-2"
                size="xs"
                variant="ghost"
              />
              <template #content>
                <div class="w-44 space-y-2 p-2">
                  <p class="px-1 text-xs font-medium text-muted">
                    Position
                  </p>
                  <div class="grid grid-cols-2 gap-1">
                    <UButton
                      v-for="p in POSITIONS"
                      :key="p.value"
                      :aria-label="`Move chat to ${p.value.replace('-', ' ')}`"
                      block
                      :color="position === p.value ? 'primary' : 'neutral'"
                      :icon="p.icon"
                      size="xs"
                      :variant="position === p.value ? 'solid' : 'soft'"
                      @click="setPosition(p.value)"
                    />
                  </div>
                  <USeparator />
                  <UButton
                    block
                    color="neutral"
                    icon="i-lucide-rotate-ccw"
                    label="Reset size"
                    size="xs"
                    variant="ghost"
                    @click="resetSize"
                  />
                </div>
              </template>
            </UPopover>
            <UButton
              aria-label="Close chat"
              color="neutral"
              icon="i-lucide-x"
              size="xs"
              variant="ghost"
              @click="toggle"
            />
          </div>
        </div>

        <div
          ref="listEl"
          class="h-72 space-y-2 overflow-y-auto px-3 py-2 lg:h-auto lg:min-h-0 lg:flex-1"
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
            class="group -mx-1 rounded-md px-1 text-sm transition-colors duration-500"
            :class="highlightId === m.id ? 'bg-primary/15' : ''"
            :data-msg-id="m.id"
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
                  v-else-if="part.type === 'tag'"
                  class="inline-flex items-center rounded px-1 align-middle font-medium"
                  :class="part.userId === user?.id ? 'bg-primary/20 text-primary' : 'bg-elevated text-highlighted'"
                >
                  @{{ part.name }}
                </span>
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
          <div class="relative flex gap-1.5">
            <div
              v-if="mentionMatches.length"
              class="absolute bottom-full left-0 z-10 mb-1.5 w-56 overflow-hidden rounded-md border border-default bg-default shadow-lg"
            >
              <button
                v-for="(u, i) in mentionMatches"
                :key="u.id"
                class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-elevated"
                :class="i === mentionIndex ? 'bg-elevated' : ''"
                type="button"
                @mousedown.prevent="selectMention(u)"
              >
                <UIcon
                  class="size-3.5 shrink-0 text-muted"
                  name="i-lucide-at-sign"
                />
                <span
                  class="truncate"
                  :class="nameColor(u.id)"
                >{{ u.name }}</span>
              </button>
            </div>
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
              @blur="mentionQuery = null"
              @keydown="onInputKeydown"
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
          v-if="!open && badgeCount > 0"
          class="pointer-events-none absolute -end-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-error text-[10px] font-semibold leading-none text-inverted"
        >
          {{ badgeCount > 9 ? '9+' : badgeCount }}
        </span>
      </div>
    </div>
  </div>
</template>
