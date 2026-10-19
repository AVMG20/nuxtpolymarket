<template>
    <div class="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <!-- open squads: dispatch slips on the board -->
        <section v-if="!lobby">
            <header class="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p class="df-eyebrow">Orders of the night</p>
                    <h2 class="df-h mt-1 text-3xl text-[var(--df-chalk)]">Open squads</h2>
                    <p class="mt-1 text-sm italic text-[var(--df-chalk-2)]">Join a squad heading out, or raise your own.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <DfButton tone="paper" icon="user" :disabled="!online" @click="emit('solo')">Go solo</DfButton>
                    <DfButton tone="blood" icon="plus" :disabled="!online" @click="emit('send', { t: 'create' })">Raise a squad</DfButton>
                </div>
            </header>

            <TransitionGroup v-if="lobbies.length" tag="ul" name="df-slip" class="grid gap-5 sm:grid-cols-2">
                <li
                    v-for="(l, i) in lobbies"
                    :key="l.id"
                    class="df-slip df-paper"
                    :class="{ playing: l.state === 'playing' }"
                    :style="{ animationDelay: `${i * 50}ms` }"
                >
                    <div class="flex items-start justify-between gap-3">
                        <p class="df-eyebrow">Dispatch № {{ slipNo(l.id) }}</p>
                        <span
                            class="df-stamp df-stamp-land"
                            :class="l.state === 'playing' ? '' : 'df-stamp--green'"
                            :style="{ '--df-tilt': `${i % 2 ? 5 : -6}deg` }"
                        >
                            {{ l.state === 'playing' ? `In the field · R${l.round}` : 'Mustering' }}
                        </span>
                    </div>
                    <h3 class="df-slip-name mt-2 truncate">{{ l.hostName }}'s squad</h3>
                    <div class="mt-3 flex items-center justify-between gap-3">
                        <div class="flex items-center gap-1" :aria-label="`${l.players} of ${l.maxPlayers} soldiers`">
                            <DfIcon
                                v-for="n in l.maxPlayers"
                                :key="n"
                                name="helmet"
                                :size="22"
                                class="df-helm"
                                :class="{ on: n <= l.players }"
                            />
                            <span class="df-type ml-1.5 text-xs text-[var(--df-ink-2)]">{{ l.players }}/{{ l.maxPlayers }}</span>
                        </div>
                        <DfButton
                            tone="blood"
                            size="sm"
                            :disabled="!online || l.state !== 'lobby' || l.players >= l.maxPlayers"
                            @click="emit('send', { t: 'join', id: l.id })"
                        >
                            {{ l.state !== 'lobby' ? 'Engaged' : l.players >= l.maxPlayers ? 'Full' : 'Join' }}
                        </DfButton>
                    </div>
                </li>
            </TransitionGroup>
            <div v-else class="df-empty">
                <svg viewBox="0 0 120 60" width="120" height="60" aria-hidden="true" class="mx-auto">
                    <path d="M6 44c18-3 30 3 48-1s34 2 60-2" class="wire" />
                    <path d="M18 30l-4 22M18 30l5 22M98 28l-4 24M98 28l5 24" class="post" />
                    <path d="M30 41l4 4M34 41l-4 4M52 42l4 4M56 42l-4 4M74 41l4 4M78 41l-4 4" class="wire" />
                </svg>
                <p class="df-type mt-3 text-sm text-[var(--df-chalk-2)]">No squads out tonight.</p>
                <p class="mt-1 text-sm italic text-[var(--df-chalk-3)]">Raise one and others can join.</p>
            </div>
        </section>

        <!-- your squad: the enlistment roll -->
        <section v-else class="df-roll df-paper">
            <header class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p class="df-eyebrow">Roll of the squad · Sainte-Croix</p>
                    <h2 class="df-h mt-1 text-3xl">Your squad</h2>
                    <p class="df-type mt-1 text-xs text-[var(--df-ink-2)]">{{ lobby.members.length }}/4 soldiers · the C.O. gives the order</p>
                </div>
                <DfButton tone="ghost" icon="leave" @click="emit('send', { t: 'leave' })">Leave</DfButton>
            </header>

            <ol class="df-lines mt-5">
                <li v-for="(m, i) in lobby.members" :key="m.userId" class="df-line">
                    <span class="df-line-no">{{ i + 1 }}.</span>
                    <span class="min-w-0 flex-1 truncate" :class="{ 'font-bold': m.userId === me }">
                        {{ m.name }}<span v-if="m.userId === me" class="df-you"> (you)</span>
                    </span>
                    <span v-if="m.away" class="df-awaiting">reconnecting</span>
                    <span v-if="m.host" class="df-co df-brass"><DfIcon name="crown" :size="12" /> C.O.</span>
                    <span
                        v-if="m.ready"
                        :key="`r-${m.userId}`"
                        class="df-seal df-stamp-land"
                        :style="{ '--df-tilt': `${(i * 7) % 11 - 6}deg` }"
                    >
                        <svg viewBox="0 0 60 60" width="46" height="46" aria-hidden="true">
                            <path :d="sealPath" class="wax" />
                            <circle cx="30" cy="30" r="17" class="ring" />
                            <path d="M21 31l6 6 12-14" class="tick" />
                        </svg>
                        <span class="sr-only">Ready</span>
                    </span>
                    <span v-else-if="!m.away" class="df-awaiting">awaiting</span>
                </li>
                <li v-for="n in 4 - lobby.members.length" :key="`empty-${n}`" class="df-line vacant">
                    <span class="df-line-no">{{ lobby.members.length + n }}.</span>
                    <span class="flex-1">— vacant —</span>
                </li>
            </ol>

            <div class="mt-6 flex flex-wrap items-center gap-3">
                <DfButton
                    v-if="isHost"
                    tone="blood"
                    size="lg"
                    icon="swords"
                    :disabled="!online || !allReady"
                    @click="emit('send', { t: 'start' })"
                >
                    Go over the top
                </DfButton>
                <DfButton
                    v-else
                    :tone="meReady ? 'paper' : 'blood'"
                    size="lg"
                    :icon="meReady ? 'x' : 'check'"
                    :disabled="!online"
                    @click="emit('send', { t: 'ready', ready: !meReady })"
                >
                    {{ meReady ? 'Stand down' : 'Ready up' }}
                </DfButton>
                <span v-if="isHost && !allReady" class="df-type text-xs text-[var(--df-ink-2)]">Waiting for every man to ready up</span>
            </div>
        </section>

        <!-- field telephone -->
        <aside class="df-phone df-board-dark df-rivets flex min-h-72 flex-col">
            <div class="flex items-center gap-2.5">
                <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" class="df-phone-icon">
                    <path d="M6 12c0-4 4-6 10-6s10 2 10 6l-3 2-3-3h-8l-3 3z" />
                    <rect x="8" y="16" width="16" height="11" rx="2" />
                    <circle cx="16" cy="21.5" r="3" class="dial" />
                </svg>
                <div>
                    <h3 class="df-h text-base text-[var(--df-chalk)]">Field telephone</h3>
                    <p class="df-eyebrow !text-[0.58rem]">{{ lobby ? 'Line open to your squad' : 'No line' }}</p>
                </div>
                <span class="df-lamp ml-auto" :class="{ on: !!lobby && online }" aria-hidden="true" />
            </div>
            <div ref="chatEl" class="df-scroll mt-4 flex-1 space-y-1.5 overflow-y-auto pr-1" style="max-height: 18rem">
                <p v-if="!chat.length" class="df-type text-xs text-[var(--df-chalk-3)]">
                    {{ lobby ? 'Say something to your squad.' : 'Join a squad to talk.' }}
                </p>
                <p v-for="(c, i) in chat" :key="i" class="df-msg break-words">
                    <b>{{ c.name }}</b> {{ c.text }}
                </p>
            </div>
            <form class="df-compose mt-3 flex items-center gap-2" @submit.prevent="sendChat">
                <input v-model="draft" class="df-input flex-1" placeholder="Message the squad" :maxlength="200" :disabled="!lobby || !online" aria-label="Message">
                <DfButton type="submit" tone="paper" size="sm" icon="send" :disabled="!lobby || !online || !draft.trim()" aria-label="Send" />
            </form>
        </aside>
    </div>
</template>

<script setup lang="ts">
import type { DfClientMsg, DfLobbyState, DfLobbySummary } from '#shared/utils/dead-front/protocol'
import DfButton from '~/components/dead-front/ui/DfButton.vue'
import DfIcon from '~/components/dead-front/ui/DfIcon.vue'

const props = defineProps<{
    lobbies: DfLobbySummary[]
    lobby: DfLobbyState | null
    chat: { name: string, text: string }[]
    me: string | null
    online: boolean
}>()

const emit = defineEmits<{
    send: [msg: DfClientMsg]
    solo: []
}>()

const draft = ref('')
const chatEl = ref<HTMLElement | null>(null)

const self = computed(() => props.lobby?.members.find(m => m.userId === props.me))
const isHost = computed(() => !!self.value?.host)
const meReady = computed(() => !!self.value?.ready)
const allReady = computed(() => !!props.lobby?.members.every(m => m.ready))

// A scalloped wax seal outline.
const sealPath = (() => {
    const pts: string[] = []
    for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2
        const r = i % 2 ? 24 : 27
        pts.push(`${(30 + Math.cos(a) * r).toFixed(1)} ${(30 + Math.sin(a) * r).toFixed(1)}`)
    }
    return `M${pts.join('L')}Z`
})()

function slipNo(id: string): string {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
    return String(100 + (h % 900))
}

function sendChat() {
    const text = draft.value.trim()
    if (!text) return
    emit('send', { t: 'chat', text })
    draft.value = ''
}

watch(() => props.chat.length, async () => {
    await nextTick()
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight
})
</script>

<style scoped>
.df-slip {
    padding: 1.1rem 1.1rem 1rem;
    transition: transform 0.15s steps(3);
    animation: df-rise-in 0.4s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
}

.df-slip:hover {
    transform: translateY(-3px);
}

.df-slip.playing {
    filter: saturate(0.6) brightness(0.88);
}

.df-slip-name {
    font-family: var(--df-font-stencil);
    font-size: 1.35rem;
    letter-spacing: 0.06em;
    line-height: 1.15;
    color: var(--df-ink);
}

.df-helm {
    color: rgba(60, 40, 15, 0.28);
    transition: color 0.3s, transform 0.3s;
}

.df-helm.on {
    color: #3f5a26;
}

.df-empty {
    padding: 2.5rem 1rem 2rem;
    text-align: center;
    border: 2px dashed rgba(236, 226, 198, 0.16);
}

.df-empty .wire {
    fill: none;
    stroke: #8d8a7f;
    stroke-width: 1.4;
    stroke-linecap: round;
}

.df-empty .post {
    fill: none;
    stroke: #6a5236;
    stroke-width: 3;
    stroke-linecap: round;
}

/* enlistment roll */
.df-roll {
    padding: 1.4rem 1.4rem 1.5rem;
}

.df-lines {
    border-top: 3px solid rgba(110, 30, 20, 0.45);
}

.df-line {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-height: 3.4rem;
    padding: 0.3rem 0.2rem;
    font-family: var(--df-font-type);
    font-size: 1rem;
    border-bottom: 2px solid rgba(60, 40, 15, 0.14);
    animation: df-ink-in 0.5s ease-out both;
}

.df-line.vacant {
    color: rgba(60, 40, 15, 0.4);
    font-style: italic;
}

.df-line-no {
    width: 1.5rem;
    color: var(--df-blood);
    font-family: var(--df-font-serif);
}

.df-you {
    font-weight: 400;
    color: var(--df-ink-3);
    font-size: 0.8rem;
}

.df-co {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.45rem;
    font-family: var(--df-font-stencil);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
}

.df-seal {
    display: inline-flex;
    width: 46px;
    height: 46px;
    margin: -6px 0;
    transform: rotate(var(--df-tilt, -6deg));
    filter: drop-shadow(0 2px 2px rgba(60, 0, 0, 0.45));
}

.df-seal .wax {
    fill: #9c1c12;
}

.df-seal .ring {
    fill: none;
    stroke: rgba(255, 200, 180, 0.35);
    stroke-width: 1.5;
}

.df-seal .tick {
    fill: none;
    stroke: #f5d9c4;
    stroke-width: 3.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 30;
    stroke-dashoffset: 30;
    animation: df-seal-tick 0.35s 0.25s ease-out forwards;
}

.df-awaiting {
    font-family: var(--df-font-type);
    font-size: 0.72rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(60, 40, 15, 0.45);
    animation: df-await 2s ease-in-out infinite;
}

/* field telephone */
.df-phone {
    padding: 1.1rem 1.1rem 1rem;
}

.df-phone-icon path,
.df-phone-icon rect {
    fill: #2d2a22;
    stroke: var(--df-brass);
    stroke-width: 1.3;
}

.df-phone-icon .dial {
    fill: none;
    stroke: var(--df-brass-hi);
    stroke-width: 1.3;
}

.df-lamp {
    width: 10px;
    height: 10px;
    background: #3a2a1a;
    box-shadow: 0 0 0 2px #000;
}

.df-lamp.on {
    background: #ffb45c;
    box-shadow: 0 0 0 2px #000, 0 0 10px #ff9a2e;
    animation: df-lamp 3s ease-in-out infinite;
}

.df-msg {
    padding: 0.3rem 0.55rem;
    font-family: var(--df-font-type);
    font-size: 0.8rem;
    color: #2a1d0c;
    background: var(--df-paper);
    box-shadow: inset 4px 0 0 var(--df-blood);
    animation: df-tape-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}

.df-msg b {
    color: var(--df-blood);
    margin-right: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}

.df-compose {
    padding: 0.35rem;
    background: var(--df-paper);
    box-shadow: 0 0 0 2px #000;
}

.df-compose .df-input {
    background: transparent;
}

.df-slip-enter-from,
.df-slip-leave-to {
    opacity: 0;
    transform: translateY(12px);
}

.df-slip-leave-active {
    transition: opacity 0.25s, transform 0.25s;
}

@keyframes df-seal-tick {
    to { stroke-dashoffset: 0; }
}

@keyframes df-await {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 1; }
}

@keyframes df-lamp {
    0%, 100% { opacity: 1; }
    47% { opacity: 0.85; }
    50% { opacity: 0.6; }
    53% { opacity: 0.95; }
}

@keyframes df-tape-in {
    0% { opacity: 0; transform: translateX(-12px); }
    100% { opacity: 1; transform: none; }
}
</style>
