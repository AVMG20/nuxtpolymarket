<template>
    <div class="df-theme df-page relative isolate min-h-[calc(100dvh-4rem)] overflow-hidden">
        <!-- the night: sky, searchlight, star shell, fog, horizon, embers, grain -->
        <div class="df-sky" aria-hidden="true" />
        <div class="df-searchlight" aria-hidden="true" />
        <div class="df-starshell" aria-hidden="true" />
        <div class="df-fog" aria-hidden="true" />
        <svg class="df-horizon" viewBox="0 0 1600 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
            <path
                d="M0 220V168c40-4 70 2 110-6l18-34 6 30c30 2 60-8 96-4l10-22 4 24c60 4 110-10 170-6 22-46 30-56 34-58v-40h8v40l10 16 4-26h6l2 30c14 18 20 30 26 46 50 2 90-12 140-8l12-48 4 40 10-30 6 34c40 8 90-6 140-2 30-14 60-22 96-18l16-60 5 52 8-30 5 34c60 6 120-4 170 4l16-28 6 30c50-2 90 6 130 2V220z"
                fill="#060707"
            />
            <path d="M0 196c140-8 260 6 400-2s300 10 460 0 360 8 520-2 220 4 220 4V220H0z" fill="#030404" />
            <g stroke="#0c0d0d" stroke-width="2" fill="none">
                <path d="M120 186l8 -18 8 18M300 190l8 -16 8 16M760 188l8 -18 8 18M1180 186l8 -18 8 18M1420 190l8 -16 8 16" />
                <path d="M120 176c60 6 120-8 196 6M760 178c80 6 160-6 236 4M1180 176c80 8 160-4 248 6" stroke-dasharray="3 4" />
            </g>
        </svg>
        <div class="df-embers" aria-hidden="true">
            <span v-for="n in 16" :key="n" :style="emberStyle(n)" />
        </div>

        <div class="relative mx-auto max-w-6xl px-4 pt-6 pb-16 sm:pt-10">
            <header class="mb-6 text-center sm:mb-8">
                <DfTitleLockup />
                <p class="df-tagline mx-auto mt-3 max-w-lg">
                    The dead walk out of no man's land every night. Hold the chapel with up to three others for as many rounds as you can.
                </p>
                <div v-if="profile" class="mt-5 flex flex-wrap justify-center gap-2.5 sm:gap-3">
                    <div v-for="(s, i) in record" :key="s.label" class="df-plaque df-brass" :style="{ animationDelay: `${0.5 + i * 0.08}s` }">
                        <span class="df-plaque-label">{{ s.label }}</span>
                        <b class="df-plaque-value"><DfCountUp :value="s.value" :delay="600 + i * 90" :compact="s.compact" /></b>
                    </div>
                </div>
            </header>

            <!-- the telegraph line -->
            <Transition name="df-tape">
                <div v-if="status !== 'open'" class="df-tape mb-6">
                    <span class="df-tape-dot" :class="status" />
                    <span class="df-tape-text">
                        {{ status === 'connecting' ? (attempts ? `RECONNECTING TO THE LINE · ATTEMPT ${attempts} · STOP` : 'CONNECTING TO THE LINE · STOP') : 'THE LINE IS DOWN · STOP' }}
                    </span>
                    <DfButton tone="paper" size="sm" icon="refresh" class="ml-auto" @click="reconnect">Reconnect</DfButton>
                </div>
            </Transition>

            <DfMenuEnd v-if="end" :end="end" :perk-xp-after="endPerkXp" :in-lobby="!!lobby" @close="end = null" />

            <template v-else>
                <nav class="df-tabs" role="tablist" aria-label="Dead Front menu">
                    <button
                        v-for="t in tabs"
                        :key="t.value"
                        type="button"
                        role="tab"
                        class="df-tab"
                        :class="{ active: tab === t.value }"
                        :aria-selected="tab === t.value"
                        @click="tab = t.value"
                    >
                        <DfIcon :name="t.icon" :size="16" class="df-tab-icon" />
                        <span>{{ t.label }}</span>
                    </button>
                </nav>
                <div class="df-dossier">
                    <div :key="tab" class="df-dossier-inner">
                        <DfMenuHowTo v-if="tab === 'play' && showHowTo" dismissable class="mb-7" @dismiss="dismissHowTo" />
                        <DfMenuPlay
                            v-if="tab === 'play'"
                            :lobbies="lobbies"
                            :lobby="lobby"
                            :chat="chat"
                            :me="me"
                            :online="status === 'open'"
                            @send="send"
                            @solo="solo"
                        />
                        <template v-else-if="profile">
                            <DfMenuArmory v-if="tab === 'armory'" :profile="profile" @update="profile = $event" />
                            <DfMenuResearch v-else-if="tab === 'research'" :profile="profile" @update="profile = $event" />
                        </template>
                        <DfMenuBriefing v-if="tab === 'briefing'" />
                        <section v-if="tab === 'settings'" class="df-paper df-settings-sheet mx-auto">
                            <p class="df-eyebrow">Kit & drill</p>
                            <h2 class="df-h mt-1 text-3xl">Settings</h2>
                            <p class="df-type mt-1 text-xs text-[var(--df-ink-2)]">Saved in this browser. You can also change them mid-match from the pause menu (Esc).</p>
                            <DfSettingsForm class="mt-6" :settings="settings" @update:settings="onSettings" />
                        </section>
                        <div v-if="!profile && (tab === 'armory' || tab === 'research')" class="df-paper mx-auto max-w-md rounded-sm px-6 py-8 text-center">
                            <p class="df-type text-sm">{{ profileError ? 'Your service record could not be fetched.' : 'Fetching your service record…' }}</p>
                            <DfButton v-if="profileError" class="mt-4" tone="paper" icon="refresh" @click="loadProfile">Retry</DfButton>
                        </div>
                    </div>
                </div>
            </template>
        </div>

        <!-- development only: /dead-front?hud previews the HUD with mock state -->
        <Teleport v-if="devHud && DfHudPreview" to="body">
            <component :is="DfHudPreview" />
        </Teleport>

        <!-- the match covers the whole window, above the site chrome -->
        <Teleport to="body">
            <div v-if="start && net" class="fixed inset-0 z-[200]">
                <DfGameView :key="gameKey" :net="net" :start="start" :profile="profile ?? fallbackProfile" @leave="send({ t: 'leave' })" />
            </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
import { DfNet } from '~/utils/dead-front/net'
import type { DfNetStatus } from '~/utils/dead-front/net'
import DfMenuPlay from '~/components/dead-front/menu/DfMenuPlay.vue'
import DfMenuArmory from '~/components/dead-front/menu/DfMenuArmory.vue'
import DfMenuResearch from '~/components/dead-front/menu/DfMenuResearch.vue'
import DfMenuBriefing from '~/components/dead-front/menu/DfMenuBriefing.vue'
import DfMenuEnd from '~/components/dead-front/menu/DfMenuEnd.vue'
import DfMenuHowTo from '~/components/dead-front/menu/DfMenuHowTo.vue'
import DfSettingsForm from '~/components/dead-front/ui/DfSettingsForm.vue'
import { dfLoadSettings, dfSaveSettings } from '~/utils/dead-front/engine/settings'
import type { DfSettings } from '~/utils/dead-front/engine/settings'
import DfTitleLockup from '~/components/dead-front/ui/DfTitleLockup.vue'
import DfButton from '~/components/dead-front/ui/DfButton.vue'
import DfIcon from '~/components/dead-front/ui/DfIcon.vue'
import DfCountUp from '~/components/dead-front/ui/DfCountUp.vue'
import type { DfIconName } from '~/components/dead-front/ui/icons'
import '~/components/dead-front/ui/df-theme.css'
import type { DfClientMsg, DfLobbyState, DfLobbySummary, DfMatchEnd, DfMatchStart } from '#shared/utils/dead-front/protocol'
import type { DfProfileView } from '#shared/utils/dead-front/types'

useHead({
    title: 'Dead Front',
    link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&family=Special+Elite&family=Stardos+Stencil:wght@400;700&display=swap' }
    ]
})

// Errors only (the site toaster); never success toasts.
const toast = useToast()

// The match (three.js, the engine, the world) loads only when a match starts,
// so the menus stay light and open even if the game bundle is still loading.
const DfGameView = defineAsyncComponent({
    loader: () => import('~/components/dead-front/game/DfGameView.client.vue'),
    onError(e, retry, fail, attempts) {
        if (attempts <= 2) {
            retry()
            return
        }
        fail()
        console.error('[dead-front] the match failed to load', e)
        toast.add({ title: 'The match could not load. Try reloading the page.', color: 'error' })
        start.value = null
        send({ t: 'leave' })
    }
})
const DfHudPreview = import.meta.dev ? defineAsyncComponent(() => import('~/components/dead-front/game/DfHudPreview.vue')) : null
const route = useRoute()
const devHud = computed(() => import.meta.dev && import.meta.client && route.query.hud !== undefined)

type DfTab = 'play' | 'armory' | 'research' | 'briefing' | 'settings'
const tabs: { label: string, value: DfTab, icon: DfIconName }[] = [
    { label: 'Play', value: 'play', icon: 'swords' },
    { label: 'Armory', value: 'armory', icon: 'crosshair' },
    { label: 'Research', value: 'research', icon: 'flask' },
    { label: 'Briefing', value: 'briefing', icon: 'scroll' },
    { label: 'Settings', value: 'settings', icon: 'gear' }
]
const tab = ref<DfTab>('play')

const net = shallowRef<DfNet | null>(null)
const status = ref<DfNetStatus>('closed')
const attempts = ref(0)
const me = ref<string | null>(null)
const lobbies = ref<DfLobbySummary[]>([])
const lobby = ref<DfLobbyState | null>(null)
const chat = ref<{ name: string, text: string }[]>([])
const start = shallowRef<DfMatchStart | null>(null)
const gameKey = ref(0)
const end = shallowRef<DfMatchEnd | null>(null)
const profile = ref<DfProfileView | null>(null)
const profileError = ref(false)
const pendingSolo = ref(false)

// Settings live in this browser; the match reads them again when it mounts.
const settings = ref<DfSettings>(dfLoadSettings())
function onSettings(s: DfSettings) {
    settings.value = s
    dfSaveSettings(s)
}

// First-time guidance on the Play tab until the first match or until dismissed.
const HOWTO_KEY = 'dead-front:howto-dismissed'
const howToDismissed = ref(false)
const showHowTo = computed(() => !!profile.value && profile.value.gamesPlayed === 0 && !howToDismissed.value)
function dismissHowTo() {
    howToDismissed.value = true
    try {
        localStorage.setItem(HOWTO_KEY, '1')
    } catch {
        // storage blocked: it just shows again next visit
    }
}

const fallbackProfile: DfProfileView = {
    unlockedWeapons: ['m1911'],
    weaponXp: {},
    loadout: { startWeapon: 'm1911', attachments: {} },
    researchPerk: null,
    perkXp: {},
    perkMods: {},
    gamesPlayed: 0,
    bestRound: 0,
    totalKills: 0,
    eggsCompleted: 0
}

const record = computed(() => {
    const p = profile.value
    if (!p) return []
    const rows = [
        { label: 'Best round', value: p.bestRound, compact: false },
        { label: 'Matches', value: p.gamesPlayed, compact: false },
        { label: 'Kills', value: p.totalKills, compact: true }
    ]
    if (p.eggsCompleted) rows.push({ label: 'Arc Generators', value: p.eggsCompleted, compact: false })
    return rows
})

const endPerkXp = computed(() => {
    const perk = end.value?.progress?.perk
    if (!perk || !profile.value) return null
    return profile.value.perkXp[perk] ?? 0
})

async function loadProfile() {
    profileError.value = false
    try {
        profile.value = await apiFetch<DfProfileView>('/api/dead-front/profile')
    } catch (e) {
        profileError.value = true
        toast.add({ title: apiErrorMessage(e, 'Could not load your Dead Front profile'), color: 'error' })
    }
}

function send(msg: DfClientMsg) {
    net.value?.send(msg)
}

function solo() {
    pendingSolo.value = true
    send({ t: 'create' })
}

function reconnect() {
    net.value?.close()
    net.value?.connect()
}

function emberStyle(n: number) {
    // Deterministic spread so the embers don't jump between renders.
    const x = (n * 37) % 100
    const d = 9 + ((n * 13) % 9)
    const delay = -((n * 7) % 17)
    const drift = ((n * 29) % 80) - 20
    return { 'left': `${x}%`, 'animationDuration': `${d}s`, 'animationDelay': `${delay}s`, '--drift': `${drift}px` }
}

const offs: (() => void)[] = []

onMounted(() => {
    try {
        howToDismissed.value = localStorage.getItem(HOWTO_KEY) === '1'
    } catch {
        // storage blocked
    }
    void loadProfile()
    const n = new DfNet()
    net.value = n
    offs.push(
        n.onStatus((s) => {
            status.value = s
            attempts.value = n.attempts
        }),
        n.on('hello', (m) => {
            me.value = m.userId
        }),
        n.on('lobbies', (m) => {
            lobbies.value = m.lobbies
        }),
        n.on('lobby', (m) => {
            const prev = lobby.value?.id
            lobby.value = m.lobby
            if (!m.lobby || m.lobby.id !== prev) chat.value = []
            if (pendingSolo.value && m.lobby && m.lobby.state === 'lobby') {
                pendingSolo.value = false
                if (m.lobby.members.length === 1) send({ t: 'start' })
            }
        }),
        n.on('chat', (m) => {
            chat.value = [...chat.value.slice(-99), { name: m.name, text: m.text }]
        }),
        n.on('start', (m) => {
            end.value = null
            start.value = m.start
            gameKey.value++
        }),
        n.on('end', (m) => {
            start.value = null
            end.value = m.end
            tab.value = 'play'
            void loadProfile()
        }),
        n.on('error', (m) => {
            pendingSolo.value = false
            toast.add({ title: m.message, color: 'error' })
        })
    )
    n.connect()
})

onBeforeUnmount(() => {
    for (const off of offs) off()
    offs.length = 0
    net.value?.close()
    net.value = null
})
</script>

<style scoped>
.df-page {
    background: var(--df-night);
}

.df-sky {
    position: absolute;
    inset: 0;
    z-index: -3;
    background:
        radial-gradient(70% 45% at 50% 8%, rgba(255, 150, 70, 0.1), transparent 70%),
        radial-gradient(60% 40% at 15% 100%, rgba(150, 40, 20, 0.16), transparent 70%),
        radial-gradient(60% 40% at 90% 95%, rgba(255, 140, 60, 0.08), transparent 70%),
        linear-gradient(180deg, #0a0d11 0%, #0d0f10 40%, #15120d 80%, #1c160f 100%);
}

.df-searchlight {
    position: absolute;
    left: 50%;
    bottom: -10%;
    z-index: -3;
    width: 26vmax;
    height: 120vmax;
    transform-origin: 50% 100%;
    background: linear-gradient(0deg, rgba(220, 230, 255, 0.07), rgba(220, 230, 255, 0.015) 70%, transparent);
    clip-path: polygon(46% 100%, 54% 100%, 100% 0, 0 0);
    filter: blur(6px);
    animation: df-sweep 26s ease-in-out infinite alternate;
    pointer-events: none;
}

.df-starshell {
    position: absolute;
    top: 8%;
    left: 12%;
    z-index: -2;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #fff4d6;
    box-shadow: 0 0 22px 8px rgba(255, 210, 140, 0.55), 0 0 140px 60px rgba(255, 160, 80, 0.12);
    animation: df-starshell 18s linear infinite;
    pointer-events: none;
}

.df-fog {
    position: absolute;
    inset: -20% -40%;
    z-index: -2;
    pointer-events: none;
    background:
        radial-gradient(40% 18% at 20% 72%, rgba(170, 160, 140, 0.1), transparent 70%),
        radial-gradient(35% 14% at 70% 82%, rgba(170, 160, 140, 0.09), transparent 70%),
        radial-gradient(30% 12% at 50% 62%, rgba(170, 160, 140, 0.06), transparent 70%);
    filter: blur(14px);
    animation: df-drift 38s ease-in-out infinite alternate;
}

.df-horizon {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: -2;
    width: 100%;
    height: 220px;
    pointer-events: none;
}

.df-embers {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
}

/* embers are little square blocks, like the world's sparks */
.df-embers span {
    position: absolute;
    bottom: -10px;
    width: 4px;
    height: 4px;
    background: #ffb45c;
    box-shadow: 0 0 6px #ff8a2e;
    opacity: 0;
    animation-name: df-rise;
    animation-timing-function: linear;
    animation-iteration-count: infinite;
}

.df-tagline {
    font-family: var(--df-font-serif);
    font-style: italic;
    font-size: 1.05rem;
    line-height: 1.5;
    color: var(--df-chalk-2);
}

.df-plaque {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 7.2rem;
    padding: 0.4rem 0.9rem 0.45rem;
    animation: df-plaque-in 0.45s cubic-bezier(0.2, 1.4, 0.4, 1) both;
}

.df-plaque-label {
    font-family: var(--df-font-type);
    font-size: 0.6rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    opacity: 0.85;
}

.df-plaque-value {
    font-family: var(--df-font-stencil);
    font-size: 1.4rem;
    line-height: 1.1;
    letter-spacing: 0.06em;
}

/* the line status */
.df-tape {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.45rem 0.6rem 0.45rem 0.9rem;
    color: #1f170e;
    background: var(--df-paper);
    box-shadow: 0 -3px 0 #000, 0 3px 0 #000, -3px 0 0 #000, 3px 0 0 #000;
}

.df-tape-text {
    font-family: var(--df-font-type);
    font-size: 0.85rem;
    letter-spacing: 0.12em;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.df-tape-dot {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
    background: var(--df-blood-hi);
    animation: df-blink 1s steps(2) infinite;
}

.df-tape-dot.connecting {
    background: #e2a23a;
}

.df-tape-enter-active,
.df-tape-leave-active {
    transition: transform 0.25s steps(4), opacity 0.25s;
}

.df-tape-enter-from,
.df-tape-leave-to {
    transform: translateX(-30px);
    opacity: 0;
}

/* tabs: block keys along the top of the panel */
.df-tabs {
    position: relative;
    z-index: 1;
    display: flex;
    gap: 6px;
    padding: 0 0.5rem 0;
    overflow-x: auto;
    scrollbar-width: none;
}

.df-tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.65rem 1.05rem 0.6rem;
    font-family: var(--df-font-stencil);
    font-size: 0.95rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--df-chalk-2);
    background: #1a1e21;
    box-shadow: inset 0 3px 0 rgba(255, 255, 255, 0.06), inset 0 0 0 2px #000;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.15s, background-color 0.15s;
}

.df-tab:hover:not(.active) {
    color: var(--df-chalk);
    background: #23292d;
}

.df-tab:focus-visible {
    outline: 3px solid var(--df-lamp);
    outline-offset: -3px;
}

.df-tab.active {
    z-index: 2;
    color: #1f170e;
    background: var(--df-paper);
    box-shadow: inset 0 3px 0 rgba(255, 255, 245, 0.6), inset 0 0 0 2px #000;
}

.df-tab.active .df-tab-icon {
    color: var(--df-blood);
}

/* the panel the menus sit in */
.df-dossier {
    position: relative;
    margin-top: 6px;
    padding: 0.6rem;
    background: var(--df-blocks), linear-gradient(180deg, #14171a, #0e1012);
    box-shadow:
        0 -3px 0 #000, 0 3px 0 #000, -3px 0 0 #000, 3px 0 0 #000,
        inset 0 3px 0 0 var(--df-paper),
        0 12px 0 rgba(0, 0, 0, 0.4);
}

.df-dossier-inner {
    position: relative;
    padding: 1.1rem 0.4rem 0.6rem;
    animation: df-dossier-in 0.3s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}

.df-settings-sheet {
    max-width: 30rem;
    padding: 1.6rem 1.5rem 1.6rem;
}

@media (min-width: 640px) {
    .df-dossier {
        padding: 0.75rem 1rem 1rem;
    }

    .df-dossier-inner {
        padding: 1.4rem 0.6rem 0.6rem;
    }
}

@media (max-width: 560px) {
    .df-tab {
        padding: 0.6rem 0.75rem 0.55rem;
        font-size: 0.8rem;
        letter-spacing: 0.1em;
    }

    .df-tab-icon {
        display: none;
    }
}

@keyframes df-drift {
    from { transform: translateX(-6%); }
    to { transform: translateX(6%); }
}

@keyframes df-rise {
    0% { transform: translate(0, 0); opacity: 0; }
    10% { opacity: 0.8; }
    100% { transform: translate(var(--drift, 40px), -85vh); opacity: 0; }
}

@keyframes df-sweep {
    from { transform: translateX(-50%) rotate(-38deg); }
    to { transform: translateX(-50%) rotate(30deg); }
}

@keyframes df-starshell {
    0% { transform: translate(0, 0); opacity: 0; }
    6% { opacity: 1; }
    60% { opacity: 0.9; }
    80% { transform: translate(60px, 38vh); opacity: 0; }
    100% { transform: translate(60px, 38vh); opacity: 0; }
}


@keyframes df-plaque-in {
    0% { opacity: 0; transform: translateY(-10px) rotate(-2deg); }
    100% { opacity: 1; transform: none; }
}

@keyframes df-blink {
    to { visibility: hidden; }
}

@keyframes df-dossier-in {
    0% { opacity: 0; transform: translateY(8px); }
    100% { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
    .df-fog,
    .df-embers span,
    .df-searchlight,
    .df-starshell {
        animation: none;
    }

    .df-starshell,
    .df-embers {
        display: none;
    }
}
</style>
