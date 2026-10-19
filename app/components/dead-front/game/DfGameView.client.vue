<template>
    <div
        ref="rootEl"
        class="df-game df-theme fixed inset-0 overflow-hidden bg-black select-none"
        :class="{ 'cursor-none': hud.locked }"
    >
        <div ref="canvasEl" class="absolute inset-0" />

        <DfHud :hud="hud" />

        <!-- squad chat: T or Enter to talk, Enter sends, Escape drops it -->
        <form v-if="chatOpen" class="df-chat-box absolute" @submit.prevent="sendChat">
            <span class="df-chat-label">Say</span>
            <input
                ref="chatInput"
                v-model="chatText"
                class="df-chat-input"
                maxlength="200"
                autocomplete="off"
                spellcheck="false"
                @keydown.esc.prevent="closeChat"
                @blur="closeChat"
            >
        </form>

        <!-- click to take your post -->
        <Transition name="df-fade">
            <div
                v-if="!hud.locked && !paused"
                class="df-overlay absolute inset-0 flex cursor-pointer flex-col items-center justify-center px-4"
                @click="play"
            >
                <div class="df-overlay-lockup">
                    <DfTitleLockup />
                </div>
                <div class="df-sub">{{ hud.started ? 'The chapel at Sainte-Croix · night' : 'Waiting for the line to form…' }}</div>
                <div class="df-click">
                    <span class="df-click-lamp" aria-hidden="true" />
                    Click to take your post
                </div>
                <div class="df-keys">
                    <span v-for="k in keys" :key="k.what"><kbd v-for="c in k.keys" :key="c" class="df-key" :class="{ 'df-key--wide': c.length > 2 }">{{ c }}</kbd> {{ k.what }}</span>
                </div>
            </div>
        </Transition>

        <DfPauseMenu
            v-if="paused"
            :settings="settings"
            :solo="solo"
            @resume="play"
            @leave="leave"
            @update:settings="onSettings"
        />
    </div>
</template>

<script setup lang="ts">
// The in-match view: mounts the engine on a canvas, overlays the HUD, the
// click-to-play prompt and the pause menu. Props/emits are a contract with
// the page (perks agent).
import type { DfMatchStart, DfPlayerSnap } from '#shared/utils/dead-front/protocol'
import type { DfProfileView } from '#shared/utils/dead-front/types'
import type { DfNet } from '~/utils/dead-front/net'
import { createDfEngine } from '~/utils/dead-front/engine'
import type { DfEngine } from '~/utils/dead-front/engine'
import { dfCreateHudState, dfHudFeedLine, dfHudPruneFeed, dfHudPushFeed } from '~/utils/dead-front/engine/hud'
import type { DfHudFeedContext } from '~/utils/dead-front/engine/hud'
import { dfPlayerColor } from '~/utils/dead-front/engine/avatars'
import { DF_POWERUP_NAMES } from '~/utils/dead-front/engine/powerups'
import { DF_MAP } from '#shared/utils/dead-front/map'
import { DF_WEAPONS } from '#shared/utils/dead-front/weapons'
import { dfLoadSettings, dfSaveSettings } from '~/utils/dead-front/engine/settings'
import type { DfSettings } from '~/utils/dead-front/engine/settings'
import DfHud from './DfHud.vue'
import DfPauseMenu from './DfPauseMenu.vue'
import DfTitleLockup from '~/components/dead-front/ui/DfTitleLockup.vue'

const keys = [
    { keys: ['W', 'A', 'S', 'D'], what: 'move' },
    { keys: ['Shift'], what: 'sprint' },
    { keys: ['C'], what: 'crouch' },
    { keys: ['Space'], what: 'jump' },
    { keys: ['LMB'], what: 'fire' },
    { keys: ['RMB'], what: 'aim' },
    { keys: ['R'], what: 'reload' },
    { keys: ['F'], what: 'use' },
    { keys: ['V'], what: 'knife' },
    { keys: ['G'], what: 'grenade' },
    { keys: ['1', '2', 'Wheel'], what: 'swap' },
    { keys: ['Tab'], what: 'ledger' },
    { keys: ['T'], what: 'chat' }
]

const props = defineProps<{
    net: DfNet
    start: DfMatchStart
    profile: DfProfileView
}>()

const emit = defineEmits<{
    /** Player chose to leave the match from the pause menu. */
    leave: []
}>()

const rootEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLElement | null>(null)
const hud = reactive(dfCreateHudState())
const settings = ref<DfSettings>(dfLoadSettings())
const paused = ref(false)
/** Alone in the match: the pause menu says the war waits for you. */
const solo = ref(true)
let engine: DfEngine | null = null
let everLocked = false

watch(() => hud.locked, (locked) => {
    if (locked) {
        everLocked = true
        paused.value = false
    } else if (everLocked) {
        paused.value = true
    }
})

function play(): void {
    paused.value = false
    engine?.lock()
}

function leave(): void {
    engine?.unlock()
    emit('leave')
}

// In-match chat: the box takes the keyboard while the pointer stays locked.
const chatOpen = ref(false)
const chatText = ref('')
const chatInput = ref<HTMLInputElement | null>(null)

function openChat(): void {
    chatOpen.value = true
    chatText.value = ''
    engine?.setTyping(true)
    nextTick(() => chatInput.value?.focus())
}

function closeChat(): void {
    if (!chatOpen.value) return
    chatOpen.value = false
    engine?.setTyping(false)
}

function sendChat(): void {
    const text = chatText.value.trim()
    if (text) props.net.send({ t: 'chat', text })
    closeChat()
}

function onKeyDown(e: KeyboardEvent): void {
    if (chatOpen.value || !hud.locked || e.repeat) return
    if (e.code !== 'KeyT' && e.code !== 'Enter') return
    // keep the key itself out of the box
    e.preventDefault()
    openChat()
}

watch(() => hud.locked, (locked) => {
    if (!locked) closeChat()
})

function onSettings(s: DfSettings): void {
    settings.value = s
    dfSaveSettings(s)
    engine?.applySettings(s)
}

// Squad feed: built here from the snapshot events (the engine leaves it alone).
let feedPlayers: readonly DfPlayerSnap[] = []
const feedCtx: DfHudFeedContext = {
    me: props.start.you,
    name: pid => feedPlayers.find(p => p.pid === pid)?.name ?? 'A soldier',
    color: pid => dfPlayerColor(pid),
    doorLabel: id => DF_MAP.doors.find(d => d.id === id)?.label ?? null,
    trapLabel: id => DF_MAP.traps?.find(t => t.id === id)?.label ?? null,
    weaponName: id => DF_WEAPONS[id as keyof typeof DF_WEAPONS]?.name ?? 'weapon',
    powerupName: kind => DF_POWERUP_NAMES[kind] ?? 'a power-up'
}
const offSnap = props.net.on('snap', (m) => {
    feedPlayers = m.s.players
    solo.value = m.s.players.length <= 1
    for (const ev of m.s.events) {
        const line = dfHudFeedLine(ev, feedCtx)
        if (line) dfHudPushFeed(hud.feed, line, performance.now())
    }
})
const feedTimer = setInterval(() => dfHudPruneFeed(hud.feed, performance.now()), 500)

onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    if (!canvasEl.value) return
    try {
        engine = createDfEngine({
            container: canvasEl.value,
            net: props.net,
            start: props.start,
            profile: props.profile,
            hud,
            hudRoot: () => rootEl.value,
            settings: settings.value
        })
    } catch (e) {
        console.error('[dead-front] engine failed to start', e)
        useToast().add({ title: 'Dead Front could not start', description: 'WebGL may be unavailable in this browser.', color: 'error' })
    }
})

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    offSnap()
    clearInterval(feedTimer)
    engine?.dispose()
    engine = null
})
</script>

<style scoped>
.df-chat-box {
    left: clamp(12px, 1.6vw, 28px);
    bottom: calc(38% - 2.6rem);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: min(24rem, 60vw);
    padding: 0.3rem 0.55rem;
    background: var(--df-hud-bg);
    box-shadow: 0 -2px 0 #000, 0 2px 0 #000, -2px 0 0 #000, 2px 0 0 #000;
}

.df-chat-label {
    font-family: var(--df-font-stencil);
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #ffb45c;
}

.df-chat-input {
    flex: 1;
    min-width: 0;
    font-family: var(--df-font-type);
    font-size: 0.85rem;
    color: #f1e8cf;
    background: transparent;
    border: 0;
    outline: none;
}

.df-game {
    font-family: var(--df-font-serif);
    color: var(--df-chalk);
}

.df-overlay {
    gap: 0.6rem;
    background:
        radial-gradient(ellipse at center, rgba(20, 14, 8, 0.25) 0%, rgba(4, 5, 6, 0.86) 75%),
        rgba(0, 0, 0, 0.3);
}

.df-overlay-lockup {
    width: min(38rem, 90vw);
}

.df-sub {
    margin-top: 0.2rem;
    font-family: var(--df-font-type);
    font-size: 0.95rem;
    letter-spacing: 0.06em;
    color: var(--df-chalk-2);
}

.df-click {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin-top: 1.6rem;
    padding: 0.75rem 1.5rem 0.8rem;
    font-family: var(--df-font-stencil);
    font-size: 1.15rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #fff2dc;
    background: #b3271b;
    box-shadow:
        inset 0 3px 0 rgba(255, 170, 140, 0.45), inset 0 -6px 0 rgba(60, 0, 0, 0.55),
        0 -3px 0 #000, 0 3px 0 #000, -3px 0 0 #000, 3px 0 0 #000, 0 10px 0 rgba(0, 0, 0, 0.45);
    animation: df-breathe 1.6s steps(2, end) infinite;
}

.df-click-lamp {
    width: 10px;
    height: 10px;
    background: #ffd978;
    box-shadow: 0 0 0 2px #3a0703;
}

.df-keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.8rem 1.4rem;
    max-width: 46rem;
    margin-top: 2.2rem;
    padding: 0 1rem;
    font-family: var(--df-font-type);
    font-size: 0.82rem;
    color: var(--df-chalk-2);
}

.df-keys span {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
}

.df-keys .df-key {
    font-size: 0.72rem;
}

@keyframes df-breathe {
    0%, 100% { filter: brightness(0.92); }
    50% { filter: brightness(1.12); }
}

.df-fade-enter-active,
.df-fade-leave-active {
    transition: opacity 0.25s ease;
}

.df-fade-enter-from,
.df-fade-leave-to {
    opacity: 0;
}

@media (max-height: 640px) {
    .df-keys {
        display: none;
    }
}
</style>
