<script setup lang="ts">
import type { AiContextStatus, AiMessageDto, AiToolCall } from '#shared/utils/ai'
import { AI_TOOL_CATALOG_BY_NAME } from '#shared/utils/ai-tools'

interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

interface Usage {
  used: number
  limit: number
  resetsAt: string
}

interface ConversationListResponse {
  conversations: Conversation[]
  usage: Usage
}

interface MessagesResponse {
  conversation: { id: string, title: string }
  messages: AiMessageDto[]
  context: AiContextStatus
}

type AiStreamEvent
  = { type: 'conversation', conversationId: string }
    | { type: 'delta', content: string }
    | { type: 'assistant_message', assistantMessageId: string }
    | { type: 'tool_result', toolCallId: string, result: Record<string, unknown> }
    | { type: 'done', conversationId: string }
    | { type: 'error', message: string }

const toast = useToast()
const { user, fetchSession } = useAuth()
const route = useRoute()
const router = useRouter()
const draft = ref('')
const pendingUserContent = ref('')
const streamingContent = ref('')
const chatScroll = ref<HTMLElement | null>(null)
const selectedId = ref(typeof route.query.chat === 'string' ? route.query.chat : '')
const messages = ref<AiMessageDto[]>([])
const context = ref<AiContextStatus | null>(null)
const sending = ref(false)
const loadingMessages = ref(false)
const historyOpen = ref(false)
const deleteOpen = ref(false)
const deleteTarget = ref<Conversation | null>(null)
const resolvingToolId = ref('')
const streamedToolResults = ref<Record<string, Record<string, unknown>>>({})
const autoApprove = useCookie<boolean>('ai_auto_approve', {
  default: () => false,
  sameSite: 'lax',
  maxAge: 60 * 60 * 24 * 365
})

const { data: listData, refresh: refreshConversations } = await useFetch<ConversationListResponse>('/api/ai/conversations', {
  default: () => ({ conversations: [], usage: { used: 0, limit: 300, resetsAt: '' } })
})

const conversations = computed(() => listData.value?.conversations ?? [])
const usage = computed(() => listData.value?.usage ?? { used: 0, limit: 300, resetsAt: '' })
const visibleMessages = computed(() => messages.value.filter(message => message.role !== 'tool'))
const showPendingUser = computed(() => Boolean(
  pendingUserContent.value
  && !visibleMessages.value.some(message => message.role === 'user' && message.content === pendingUserContent.value)
))
const hasPendingTools = computed(() => messages.value.some(message =>
  message.role === 'assistant' && message.toolCalls.some(call => !toolResult(call.id))
))
const promptDisabled = computed(() => sending.value || context.value?.blocked || usage.value.used >= usage.value.limit || hasPendingTools.value)

watch(streamingContent, scrollToBottom)
watch(() => messages.value.length, scrollToBottom)

watch(selectedId, async (id) => {
  if (!id) {
    messages.value = []
    context.value = null
    await router.replace({ query: {} })
    return
  }
  await router.replace({ query: { chat: id } })
  await loadMessages(id)
}, { immediate: true })

onMounted(() => {
  if (!selectedId.value && conversations.value[0]) selectedId.value = conversations.value[0].id
})

async function loadMessages(id = selectedId.value, showLoading = true) {
  if (!id) return
  if (showLoading) loadingMessages.value = true
  try {
    const response = await $fetch<MessagesResponse>(`/api/ai/conversations/${id}/messages`)
    messages.value = response.messages
    context.value = response.context
  } catch (error) {
    toast.add({ title: 'Could not load chat', description: errorText(error), color: 'error' })
  } finally {
    if (showLoading) loadingMessages.value = false
  }
}

async function newChat() {
  const conversation = await $fetch<Conversation>('/api/ai/conversations', { method: 'POST' })
  await refreshConversations()
  selectedId.value = conversation.id
  historyOpen.value = false
}

async function sendMessage() {
  const message = draft.value.trim()
  if (!message || promptDisabled.value) return
  draft.value = ''
  pendingUserContent.value = message
  streamingContent.value = ''
  sending.value = true
  try {
    let conversationId = selectedId.value
    await readAiStream('/api/ai/chat', {
      conversationId: selectedId.value || undefined,
      message
    }, (streamEvent) => {
      if (streamEvent.type === 'conversation') {
        conversationId = streamEvent.conversationId
        selectedId.value = streamEvent.conversationId
      }
      if (streamEvent.type === 'assistant_message' && conversationId === selectedId.value) {
        void loadMessages(conversationId, false)
      }
      if (streamEvent.type === 'tool_result') {
        streamedToolResults.value = {
          ...streamedToolResults.value,
          [streamEvent.toolCallId]: streamEvent.result
        }
      }
    })
    // Avoid rendering the streamed reply and its persisted copy together, and
    // keep the existing conversation mounted during the completion refresh.
    streamingContent.value = ''
    await Promise.all([loadMessages(conversationId, false), refreshConversations()])
    await fetchSession()
  } catch (error) {
    draft.value = message
    toast.add({ title: 'Message not sent', description: errorText(error), color: 'error' })
  } finally {
    pendingUserContent.value = ''
    streamingContent.value = ''
    sending.value = false
  }
}

async function readAiStream(url: string, body: Record<string, unknown>, onEvent?: (event: AiStreamEvent) => void) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    let message = response.statusText || 'AI request failed'
    try {
      const error = await response.json() as { statusMessage?: string, message?: string }
      message = error.statusMessage ?? error.message ?? message
    } catch {
      // Keep the HTTP status text when the response is not JSON.
    }
    throw new Error(message)
  }
  if (!response.body) throw new Error('The AI response stream is unavailable')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  function processEvent(rawEvent: string) {
    const data = rawEvent
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    const streamEvent = JSON.parse(data) as AiStreamEvent
    if (streamEvent.type === 'error') throw new Error(streamEvent.message)
    if (streamEvent.type === 'delta') streamingContent.value += streamEvent.content
    onEvent?.(streamEvent)
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() ?? ''
    for (const rawEvent of events) processEvent(rawEvent)
    if (done) break
  }
  if (buffer.trim()) processEvent(buffer)
}

function scrollToBottom() {
  nextTick(() => {
    const element = chatScroll.value
    if (element) element.scrollTop = element.scrollHeight
  })
}

function onPromptKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}

function requestDelete(conversation: Conversation) {
  deleteTarget.value = conversation
  deleteOpen.value = true
}

async function deleteConversation() {
  if (!deleteTarget.value) return
  const id = deleteTarget.value.id
  await $fetch(`/api/ai/conversations/${id}`, { method: 'DELETE' })
  deleteOpen.value = false
  deleteTarget.value = null
  if (selectedId.value === id) selectedId.value = ''
  await refreshConversations()
  if (!selectedId.value && conversations.value[0]) selectedId.value = conversations.value[0].id
}

function toolResult(toolCallId: string) {
  const streamedResult = streamedToolResults.value[toolCallId]
  if (streamedResult) return streamedResult
  const message = messages.value.find(item => item.role === 'tool' && item.toolCallId === toolCallId)
  if (!message) return null
  try {
    return JSON.parse(message.content) as Record<string, unknown>
  } catch {
    return { result: message.content }
  }
}

function requiresToolConfirmation(call: AiToolCall) {
  return AI_TOOL_CATALOG_BY_NAME[call.function.name]?.requiresConfirmation ?? true
}

function toolArguments(call: AiToolCall) {
  try {
    return JSON.parse(call.function.arguments) as Record<string, unknown>
  } catch {
    return {}
  }
}

function toolTitle(call: AiToolCall) {
  return call.function.name.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function toolDescription(call: AiToolCall) {
  const args = toolArguments(call)
  const casinoGames: Record<string, string> = {
    play_dice_rounds: 'dice',
    play_limbo_rounds: 'limbo',
    play_wheel_rounds: 'wheel',
    play_magichands_rounds: 'magichands',
    play_xenoslot_rounds: 'xenoslot',
    play_candymadness_rounds: 'candymadness',
    play_aethergates_rounds: 'aethergates',
    play_fireinthehole_rounds: 'fireinthehole',
    play_bookofshadows_rounds: 'bookofshadows',
    play_spinata_rounds: 'spinata'
  }
  const casinoGame = call.function.name === 'play_casino_rounds'
    ? String(args.game ?? 'casino')
    : casinoGames[call.function.name]
  if (casinoGame) {
    const bet = Number(args.bet ?? 0)
    const rounds = Number(args.rounds ?? 0)
    return `${casinoGame}: ${rounds} round${rounds === 1 ? '' : 's'} × ${formatNumber(bet, false)} coins (base stake ${formatNumber(bet * rounds, false)})`
  }
  if (call.function.name === 'play_blackjack') return `Play and fully resolve one blackjack hand with a ${formatNumber(Number(args.bet ?? 0), false)} coin base stake. Basic strategy may double or split when affordable.`
  if (call.function.name === 'manage_xeno_garden') {
    const requested = Array.isArray(args.requestedPlants) ? args.requestedPlants : []
    const mix = requested.map(plant => `${(plant as Record<string, unknown>).quantity ?? 0} × ${(plant as Record<string, unknown>).typeId ?? 'plant'}`).join(', ')
    return `Plant ${mix || 'the requested Xeno mix'}${args.harvestReady ? ' after harvesting ready plants' : ''}; ${args.fillRemaining === false ? 'leave remaining slots empty' : 'fill remaining slots with the money-first plan'}.`
  }
  if (call.function.name === 'run_xeno_dailies') return `Harvest ready slots, replant, and retain ${args.keepPerPlantType ?? 0} free plants of each type before selling surplus.`
  if (call.function.name === 'run_colony_dailies') return `Collect Colony loot and refill nutrition using ${args.feedMethod ?? 'coins'}.`
  if (call.function.name === 'sell_colony_resources') {
    const resource = args.itemTypeId ? ` ${args.itemTypeId}` : ' resources'
    return `Sell Colony${resource}, keeping ${args.keepQuantity ?? 0} of each selected resource.`
  }
  if (call.function.name === 'start_colony_upgrade') {
    const target = args.upgradeType === 'habitat' ? 'the Colony habitat' : `${args.upgradeType ?? 'Colony'} upgrade ${args.id ?? ''}`
    return `Start ${target}.`
  }
  if (call.function.name === 'find_best_hackops_mission') return 'Analyze available Hack Ops missions and choose the best squad. This does not dispatch a mission.'
  if (call.function.name === 'dispatch_hackops_mission') return `Dispatch ${Array.isArray(args.agentIds) ? args.agentIds.length : 0} agent(s) on Hack Ops mission ${args.templateId ?? ''}.`
  if (call.function.name === 'run_miner_dailies') return 'Collect available Miner cash and Factory gems, then open every remaining free lootbox. No paid lootboxes.'
  if (call.function.name === 'purchase_miner_upgrades') {
    const levels = Number(args.levels ?? 0)
    const label = String(args.upgrade ?? 'miner').replaceAll('_', ' ')
    return `Purchase ${levels} ${label} level${levels === 1 ? '' : 's'}. This may spend coins or gems and stops on the first failed purchase.`
  }
  if (call.function.name === 'trade_gems') return `${args.action === 'sell' ? 'Sell' : 'Buy'} ${args.gems} gem${Number(args.gems) === 1 ? '' : 's'} on the live Gem Market.`
  if (call.function.name === 'feed_colony') return `Fill Colony nutrition using ${args.method ?? 'coins'}.`
  if (call.function.name === 'call_game_api') return `${args.method} ${args.path}\n${JSON.stringify(args.body ?? {}, null, 2)}`
  return Object.keys(args).length ? JSON.stringify(args, null, 2) : 'No parameters.'
}

function toolResultSummary(result: Record<string, unknown>) {
  if (result.declined) return 'Declined by player'
  if (result.error) return `Failed: ${result.error}`
  if (typeof result.purchasedLevels === 'number') {
    const stopped = result.stoppedReason ? ` · Stopped: ${result.stoppedReason}` : ''
    return `Purchased ${result.purchasedLevels}/${result.requestedLevels} level(s)${stopped}`
  }
  if (typeof result.openedFreeLootboxes === 'number') {
    const errors = Array.isArray(result.errors) && result.errors.length ? ` · ${result.errors.length} issue(s)` : ''
    return `Collected Miner rewards · Opened ${result.openedFreeLootboxes}/${result.requestedFreeLootboxes} free lootboxes${errors}`
  }
  if (result.feedMethod) {
    const errors = Array.isArray(result.errors) && result.errors.length ? ` · ${result.errors.length} issue(s)` : ''
    return `Collected and fed with ${result.feedMethod}${errors}`
  }
  if (result.action === 'buy' && typeof result.cost === 'number') return `Bought ${result.gems} gem(s) for ${formatNumber(result.cost, false)} coins`
  if (result.action === 'sell' && typeof result.revenue === 'number') return `Sold ${result.gems} gem(s) for ${formatNumber(result.revenue, false)} coins`
  if (typeof result.net === 'number') return `Completed · Net ${result.net >= 0 ? '+' : ''}${formatNumber(result.net, false)} coins`
  return 'Completed successfully'
}

async function resolveTool(message: AiMessageDto, call: AiToolCall, approved: boolean) {
  if (!selectedId.value) return
  resolvingToolId.value = call.id
  streamingContent.value = ''
  try {
    await readAiStream('/api/ai/tools/execute', {
      conversationId: selectedId.value,
      assistantMessageId: message.id,
      toolCallId: call.id,
      approved
    }, (streamEvent) => {
      if (streamEvent.type === 'assistant_message' && selectedId.value) {
        void loadMessages(selectedId.value, false)
      }
      if (streamEvent.type !== 'tool_result') return
      streamedToolResults.value = {
        ...streamedToolResults.value,
        [streamEvent.toolCallId]: streamEvent.result
      }
      if (resolvingToolId.value === streamEvent.toolCallId) resolvingToolId.value = ''
    })
    await Promise.all([loadMessages(selectedId.value, false), refreshConversations()])
    await fetchSession()
  } catch (error) {
    toast.add({ title: 'Tool confirmation failed', description: errorText(error), color: 'error' })
  } finally {
    streamingContent.value = ''
    resolvingToolId.value = ''
  }
}

function errorText(error: unknown) {
  if (error && typeof error === 'object') {
    const data = error as { data?: { statusMessage?: string }, message?: string }
    return data.data?.statusMessage ?? data.message ?? 'Unknown error'
  }
  return 'Unknown error'
}

function selectConversation(id: string) {
  selectedId.value = id
  historyOpen.value = false
}

const starterPrompts = [
  {
    icon: 'i-lucide-book-open',
    title: 'Run 100 Book of Shadows spins',
    description: 'Wager 50 coins per spin, then summarize total staked, payout, net result, and hit rate.',
    prompt: 'Spin Book of Shadows 100 times using 50 coins per spin. Afterward, give me a concise summary of the total stake, total payout, net result, winning spins, and best multiplier.'
  },
  {
    icon: 'i-lucide-sprout',
    title: 'Complete my Xeno harvest',
    description: 'Harvest ready plants, replant the same stacks, and sell surplus while keeping a reserve.',
    prompt: 'Do my Xeno dailies: harvest every ready grid slot, replant the harvested plant stacks, and sell the remaining surplus while keeping 10 of each plant type in free inventory. Tell me exactly what happened.'
  },
  {
    icon: 'i-lucide-bug',
    title: 'Collect and feed my Colony',
    description: 'Check production, collect pending loot, and refill nutrition with the most sensible currency.',
    prompt: 'Check my Colony, calculate its estimated coin income per hour and time until starvation, collect all pending loot, then refill nutrition using coins unless I cannot afford it.'
  },
  {
    icon: 'i-lucide-terminal',
    title: 'Redeploy completed Hack Ops',
    description: 'Collect completed missions and send the same agents back to the same operations.',
    prompt: 'Do my Hack Ops dailies: collect every completed operation and redeploy the same agents on the same mission when possible. Summarize cash, gems, items, failures, and new completion times.'
  },
  {
    icon: 'i-lucide-chart-no-axes-combined',
    title: 'Optimize my idle income',
    description: 'Compare live Xeno, Colony, Hack Ops, and Miner production and suggest the best next move.',
    prompt: 'Read my live Xeno, Colony, Hack Ops, and Miner state. Compare their current expected income and identify the three highest-impact actions I can take next, including costs and payback reasoning.'
  },
  {
    icon: 'i-lucide-dices',
    title: 'Explain a casino session',
    description: 'Run a bounded session and report the outcome without pretending rapid play changes the odds.',
    prompt: 'Play 50 Dice rounds at 25 coins each with a 49% win chance. Then report total stake, payout, net result, observed win rate, and the theoretical RTP comparison.'
  }
]
</script>

<template>
  <div class="flex h-[calc(100svh-3.5rem)] min-h-0 bg-background lg:h-svh">
    <aside class="hidden w-72 shrink-0 flex-col border-r border-default bg-elevated/30 md:flex">
      <div class="border-b border-default p-3">
        <UButton block color="neutral" icon="i-lucide-plus" label="New chat" variant="ghost" @click="newChat" />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        <p v-if="!conversations.length" class="px-2 py-6 text-center text-sm text-muted">
          No chats yet
        </p>
        <div v-for="conversation in conversations" :key="conversation.id" class="group mb-1 flex items-center gap-1">
          <UButton
            class="min-w-0 flex-1 justify-start"
            :color="selectedId === conversation.id ? 'primary' : 'neutral'"
            :label="conversation.title"
            :variant="selectedId === conversation.id ? 'soft' : 'ghost'"
            @click="selectConversation(conversation.id)"
          />
          <UButton
            aria-label="Delete chat"
            class="shrink-0 opacity-0 group-hover:opacity-100"
            color="error"
            icon="i-lucide-trash-2"
            size="xs"
            variant="ghost"
            @click="requestDelete(conversation)"
          />
        </div>
      </div>
      <div class="space-y-2 border-t border-default p-3 text-xs text-muted">
        <div class="flex items-center justify-between">
          <span>Monthly prompts</span>
          <span>{{ usage.used }} / {{ usage.limit }}</span>
        </div>
        <div
          aria-label="Monthly prompt usage"
          class="h-1 overflow-hidden rounded-full bg-elevated"
          role="progressbar"
          :aria-valuemax="usage.limit"
          aria-valuemin="0"
          :aria-valuenow="usage.used"
        >
          <div
            class="h-full rounded-full bg-primary transition-[width]"
            :style="{ width: `${Math.min(100, usage.used / usage.limit * 100)}%` }"
          />
        </div>
        <p v-if="usage.resetsAt">Resets {{ new Date(usage.resetsAt).toLocaleDateString() }}</p>
      </div>
    </aside>

    <section class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-14.5 shrink-0 items-center gap-2 border-b border-default px-3 sm:px-4">
        <UButton class="md:hidden" color="neutral" icon="i-lucide-history" variant="ghost" @click="historyOpen = true" />
        <div class="min-w-0 flex-1">
          <p class="truncate font-semibold">{{ conversations.find(item => item.id === selectedId)?.title ?? 'AI Assistant' }}</p>
          <p class="text-xs text-muted">{{ usage.limit - usage.used }} prompts left this month</p>
        </div>
        <UButton color="neutral" icon="i-lucide-book-open" label="Wiki" to="/ai/wiki" variant="ghost" />
        <UPopover :content="{ side: 'bottom', align: 'end' }">
          <UButton aria-label="AI settings" color="neutral" icon="i-lucide-settings-2" variant="ghost" />
          <template #content>
            <div class="w-80 space-y-3 p-4">
              <div>
                <p class="font-medium">Tool approval</p>
                <p class="text-sm text-muted">Read-only tools run immediately. Actions that can change your account require confirmation unless auto-approval is enabled.</p>
              </div>
              <USwitch v-model="autoApprove" label="Execute tools without asking" />
              <UAlert
                v-if="autoApprove"
                color="warning"
                description="The assistant can spend coins and gems, sell inventory, and play up to 10,000 casino rounds per tool call without another prompt."
                icon="i-lucide-triangle-alert"
              />
            </div>
          </template>
        </UPopover>
      </header>

      <div ref="chatScroll" class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-6 sm:px-6">
          <div v-if="loadingMessages" class="flex flex-1 items-center justify-center">
            <UIcon class="size-6 animate-spin text-muted" name="i-lucide-loader-circle" />
          </div>

          <div v-else-if="!visibleMessages.length && !pendingUserContent && !sending" class="flex flex-1 flex-col items-center justify-center py-12 text-center">
            <div class="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/15">
              <UIcon class="size-7 text-primary" name="i-lucide-bot" />
            </div>
            <h1 class="text-2xl font-semibold">How can I help you play?</h1>
            <p class="mt-2 max-w-xl text-sm text-muted">Ask about strategies and earnings, check live game state, run idle dailies, or request authenticated game actions.</p>
            <div class="mt-6 grid w-full max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <button
                v-for="example in starterPrompts"
                :key="example.title"
                class="group rounded-xl border border-default bg-default p-4 text-left transition hover:border-primary hover:bg-elevated"
                type="button"
                @click="draft = example.prompt"
              >
                <div class="mb-3 flex size-9 items-center justify-center rounded-lg bg-primary/15 transition group-hover:bg-primary/20">
                  <UIcon class="size-4 text-primary" :name="example.icon" />
                </div>
                <p class="font-medium text-highlighted">{{ example.title }}</p>
                <p class="mt-1 text-sm leading-5 text-muted">{{ example.description }}</p>
              </button>
            </div>
          </div>

          <div v-else class="space-y-1">
            <UChatMessage
              v-for="message in visibleMessages"
              :id="message.id"
              :key="message.id"
              :role="message.role === 'user' ? 'user' : 'assistant'"
              :parts="[]"
              :side="message.role === 'user' ? 'right' : 'left'"
              :ui="message.role === 'user' ? { container: 'flex-row-reverse justify-start' } : undefined"
              :variant="message.role === 'user' ? 'soft' : 'naked'"
            >
              <template #leading>
                <ProfileEmblem v-if="message.role === 'user'" :emblem="user?.emblem" :name="user?.name" class="size-8 text-xs" />
                <UAvatar v-else icon="i-lucide-bot" size="md" />
              </template>
              <template #content>
                <p v-if="message.role === 'user' && message.content" class="whitespace-pre-wrap break-words leading-7">{{ message.content }}</p>
                <AiMarkdown v-else-if="message.content" :markdown="message.content" />
                <div v-if="message.toolCalls.length" class="mt-3 space-y-2">
                  <UCard v-for="call in message.toolCalls" :key="call.id" :ui="{ body: 'p-3 sm:p-4' }">
                    <div class="flex items-start gap-3">
                      <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                        <UIcon class="size-4 text-primary" name="i-lucide-wrench" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <p class="font-medium">{{ toolTitle(call) }}</p>
                          <UBadge
                            :color="toolResult(call.id)?.error ? 'error' : toolResult(call.id)?.declined ? 'neutral' : toolResult(call.id) ? 'success' : 'warning'"
                            size="sm"
                            variant="soft"
                          >
                            {{ toolResult(call.id) ? toolResultSummary(toolResult(call.id)!) : 'Approval required' }}
                          </UBadge>
                        </div>
                        <p class="mt-1 whitespace-pre-wrap break-words text-sm text-muted">{{ toolDescription(call) }}</p>
                        <div v-if="!toolResult(call.id) && requiresToolConfirmation(call)" class="mt-3 flex gap-2">
                          <UButton
                            :disabled="Boolean(resolvingToolId)"
                            :loading="resolvingToolId === call.id"
                            size="sm"
                            label="Approve"
                            @click="resolveTool(message, call, true)"
                          />
                          <UButton
                            :disabled="Boolean(resolvingToolId)"
                            color="neutral"
                            label="Decline"
                            size="sm"
                            variant="outline"
                            @click="resolveTool(message, call, false)"
                          />
                        </div>
                        <p v-else-if="!toolResult(call.id)" class="mt-3 text-sm text-muted">Running read-only lookup…</p>
                      </div>
                    </div>
                  </UCard>
                </div>
              </template>
            </UChatMessage>

            <UChatMessage
              v-if="showPendingUser"
              id="pending-user-message"
              :parts="[]"
              role="user"
              side="right"
              :ui="{ container: 'flex-row-reverse justify-start' }"
              variant="soft"
            >
              <template #leading>
                <ProfileEmblem :emblem="user?.emblem" :name="user?.name" class="size-8 text-xs" />
              </template>
              <template #content>
                <p class="whitespace-pre-wrap break-words leading-7">{{ pendingUserContent }}</p>
              </template>
            </UChatMessage>

            <UChatMessage
              v-if="streamingContent"
              id="streaming-assistant-message"
              :avatar="{ icon: 'i-lucide-bot' }"
              :parts="[]"
              role="assistant"
              side="left"
              variant="naked"
            >
              <template #content>
                <AiMarkdown :markdown="streamingContent" />
                <span aria-hidden="true" class="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary align-text-bottom" />
              </template>
            </UChatMessage>

            <div v-else-if="sending || resolvingToolId" class="flex items-center gap-2 py-4 text-sm text-muted">
              <UIcon class="size-4 animate-spin" name="i-lucide-loader-circle" />
              Thinking…
            </div>
          </div>
        </div>
      </div>

      <footer class="shrink-0 border-t border-default bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
        <div class="mx-auto max-w-4xl space-y-2">
          <UAlert
            v-if="context?.blocked"
            color="error"
            description="This chat reached its context limit. Start a new chat to continue."
            icon="i-lucide-circle-stop"
          />
          <UAlert
            v-else-if="context?.warning"
            color="warning"
            description="This chat is getting long. Start a new chat soon to keep answers fast and focused."
            icon="i-lucide-triangle-alert"
          />
          <UAlert
            v-else-if="usage.used >= usage.limit"
            color="error"
            description="Your 300 monthly prompts are used. The allowance resets automatically next month."
            icon="i-lucide-calendar-x"
          />
          <div class="rounded-xl border border-default bg-default p-2 shadow-sm">
            <UTextarea
              v-model="draft"
              autoresize
              class="w-full"
              :disabled="promptDisabled"
              :maxlength="2000"
              :maxrows="8"
              placeholder="Ask about Polynux or request a game action…"
              :rows="2"
              variant="none"
              @keydown="onPromptKeydown"
            />
            <div class="flex items-center justify-between px-1 pt-1">
              <span class="text-xs text-muted">Enter to send · Shift+Enter for a new line</span>
              <UButton
                aria-label="Send message"
                :disabled="!draft.trim() || promptDisabled"
                icon="i-lucide-arrow-up"
                :loading="sending"
                size="sm"
                @click="sendMessage"
              />
            </div>
          </div>
          <p class="text-center text-xs text-muted">The assistant can make mistakes. Game APIs remain authoritative.</p>
        </div>
      </footer>
    </section>

    <USlideover v-model:open="historyOpen" title="Chat history" side="left">
      <template #body>
        <UButton block class="mb-3" color="neutral" icon="i-lucide-plus" label="New chat" variant="ghost" @click="newChat" />
        <div v-for="conversation in conversations" :key="conversation.id" class="mb-1 flex items-center gap-1">
          <UButton
            class="min-w-0 flex-1 justify-start"
            color="neutral"
            :label="conversation.title"
            :variant="selectedId === conversation.id ? 'soft' : 'ghost'"
            @click="selectConversation(conversation.id)"
          />
          <UButton color="error" icon="i-lucide-trash-2" size="xs" variant="ghost" @click="requestDelete(conversation)" />
        </div>
      </template>
    </USlideover>

    <UModal
      v-model:open="deleteOpen"
      title="Delete chat"
      description="This permanently deletes the conversation and its messages."
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer>
        <UButton color="neutral" label="Cancel" variant="outline" @click="deleteOpen = false" />
        <UButton color="error" label="Delete" @click="deleteConversation" />
      </template>
    </UModal>
  </div>
</template>
